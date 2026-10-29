/**
 * colis/fiche.js — Fiche d'un colis (étape 16), #/colis/<id> : parcours en 6 étapes et registre complet
 * (colis_evenements, jamais effacé), les deux photos, les montants figés, changer le statut (« problème » et
 * « annulé » exigent un motif ; un colis retiré est fermé), réimprimer l'étiquette, envoyer le lien de suivi,
 * et « Remettre le colis » (retirer_colis : qui retire, pièce d'identité, montant pré-rempli si non payé,
 * signature au doigt) suivi d'un reçu imprimable. Le SMS à l'expéditeur part tout seul (base).
 */
import { sb } from '../supabase.js';
import { esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, lireNombre, formatNombre, formatDate, copierTexte, confirmer } from '../utils.js';
import {
  api, chargerAgences, agenceDe, champ, formatTel, montant, pastilleStatut, iconeColis, lienSuivi, dateHeure, STATUTS, MODES, MODES_PAIEMENT_COLIS
} from './commun.js';
import { imprimerColis } from './etiquettes.js';

/** Les six étapes publiques du parcours (le registre détaillé garde tout le reste). */
export const ETAPES = [
  ['recu', 'Reçu'], ['entrepot', 'En entrepôt'], ['charge', 'Chargé'], ['arrive', 'Arrivé'], ['a_retirer', 'Prêt à retirer'], ['retire', 'Retiré']
];
const RANG = { recu: 0, entrepot: 1, charge: 2, en_route: 2, arrive: 3, a_retirer: 4, retire: 5 };

/** URL d'une photo : bascule (bucket public colis), contenu (bucket privé bons → lien signé 10 min). */
async function urlPhoto(chemin, prive) {
  if (!chemin) return null;
  if (/^https?:/.test(chemin)) return chemin;
  // Photo prise par la session téléphone : déposée dans colis/sessions/…
  if (!prive || chemin.startsWith('sessions/')) return sb.storage.from('colis').getPublicUrl(chemin).data.publicUrl;
  const { data } = await sb.storage.from('bons').createSignedUrl(chemin, 600);
  return data?.signedUrl || null;
}

export function afficherFicheColis(conteneur, id) {
  const s = { r: null, c: null, agences: [], evenements: [] };
  conteneur.innerHTML = `<div class="page page-colis-fiche"><div class="squelette" style="height:420px"></div></div>`;

  async function charger() {
    try {
      const [r, agences] = await Promise.all([api.fiche(id), chargerAgences()]);
      if (!conteneur.isConnected) return;
      s.r = r || {};
      s.c = s.r.colis || s.r;
      s.agences = agences;
      s.evenements = (champ(s.r, 'evenements', 'parcours', 'historique') || []).slice().sort((a, b) => String(a.created_at || a.le).localeCompare(String(b.created_at || b.le)));
      render();
    } catch (err) {
      conteneur.innerHTML = `<div class="page"><p class="bloc-erreur">${esc(messageErreur(err))}</p><a class="btn btn-secondaire" href="#/colis">Retour aux colis</a></div>`;
    }
  }

  function render() {
    const c = s.c;
    const dep = agenceDe(s.agences, champ(c, 'agence_depart', 'depart'));
    const arr = agenceDe(s.agences, champ(c, 'agence_arrivee', 'arrivee'));
    const envoi = s.r.envoi || c.envoi || null;
    const ferme = ['retire', 'annule'].includes(c.statut);
    const lien = lienSuivi(champ(s.r, 'lien'), champ(s.r, 'jeton'));
    const du = champ(c, 'du_montant');
    const rang = RANG[c.statut] ?? -1;
    const quand = (statut) => s.evenements.filter((e) => e.statut === statut || (statut === 'charge' && e.statut === 'en_route')).at(-1);
    conteneur.innerHTML = `
      <div class="page page-colis-fiche">
        <header class="col-fiche-entete">
          <a href="#/colis" class="btn-icone" aria-label="Retour aux colis">${icone('retour', 20, 2)}</a>
          <div class="col-fiche-titres"><h1>${esc(c.numero)}</h1><span class="discret">${esc(dep?.ville || '')} → ${esc(arr?.ville || '')} · ${esc(MODES[c.mode]?.libelle || '')} · déposé le ${esc(formatDate(c.created_at, 'court'))}</span></div>
          ${pastilleStatut(c.statut)}
        </header>
        <div class="col-fiche-actions">
          ${c.statut === 'a_retirer' ? `<button type="button" class="btn btn-primaire" data-action="remettre">${iconeColis('colis', 18)} Remettre le colis</button>` : ''}
          <a class="btn btn-secondaire" href="#/colis/${encodeURIComponent(c.id)}/etiquette">${icone('imprimante', 17, 2)} Étiquettes</a>
          ${lien ? `<button type="button" class="btn btn-secondaire" data-action="copier">${icone('copier', 17, 2)} Lien de suivi</button>
            <a class="btn btn-whatsapp" href="https://wa.me/${esc(String(c.destinataire_tel || '').replace(/\D/g, ''))}?text=${encodeURIComponent(`Bonjour, voici le suivi de votre colis ${c.numero} : ${lien}`)}" target="_blank" rel="noopener">${icone('whatsapp', 17, 2)} Envoyer au destinataire</a>` : ''}
          ${ferme ? '' : '<button type="button" class="btn btn-secondaire" data-action="statut">Changer le statut</button>'}
        </div>
        <div class="col-fiche-grille">
          <div class="col-fiche-gauche">
            <section class="carte col-bloc">
              <h2>Le parcours</h2>
              <ol class="col-parcours">${ETAPES.map(([code, libelle], i) => {
                const ev = quand(code);
                const fait = i <= rang && !['probleme', 'annule'].includes(c.statut) ? true : Boolean(ev);
                return `<li class="${fait ? 'fait' : ''} ${i === rang ? 'courant' : ''}"><span class="col-puce"></span><span><strong>${esc(libelle)}</strong>${ev ? `<span>${esc(dateHeure(ev.created_at || ev.le))}${ev.lieu ? ` · ${esc(ev.lieu)}` : ''}</span>` : ''}</span></li>`;
              }).join('')}</ol>
              ${['probleme', 'annule'].includes(c.statut) ? `<p class="col-alerte-statut">${icone('alerte', 16, 2)} ${esc(STATUTS[c.statut].libelle)} : ${esc(c.motif || s.evenements.at(-1)?.note || '')}</p>` : ''}
              <details class="col-registre"><summary>Registre complet (${s.evenements.length})</summary>
                <ul>${s.evenements.map((e) => `<li><span>${esc(dateHeure(e.created_at || e.le))}</span><strong>${esc(STATUTS[e.statut]?.libelle || e.statut)}</strong>${e.lieu ? `<span>${esc(e.lieu)}</span>` : ''}${e.note ? `<span class="discret">${esc(e.note)}</span>` : ''}${e.par_nom ? `<span class="discret">par ${esc(e.par_nom)}</span>` : ''}</li>`).join('') || '<li class="discret">Aucun évènement.</li>'}</ul></details>
            </section>
            <section class="carte col-bloc">
              <h2>Les deux photos</h2>
              ${c.photos_effacees ? '<p class="discret">Les photos ne sont plus conservées (plus d’un mois après le retrait).</p>' : `
              <div class="col-photos-fiche">
                <figure><a data-ref="lien-bascule" target="_blank" rel="noopener"><img data-ref="photo-bascule" alt="Le colis sur la bascule"></a><figcaption>Sur la bascule · visible sur le suivi</figcaption></figure>
                <figure><a data-ref="lien-contenu" target="_blank" rel="noopener"><img data-ref="photo-contenu" alt="Le contenu du colis"></a><figcaption>Le contenu · bureau seulement</figcaption></figure>
              </div>`}
            </section>
          </div>
          <div class="col-fiche-droite">
            <section class="carte col-bloc">
              <h2>Paiement</h2>
              ${c.paye
                ? `<div class="col-paiement paye"><span>Payé au départ</span><strong>${esc(montant(c.montant, c.devise))}</strong>${c.paye_mode ? `<span class="discret">${esc(MODES_PAIEMENT_COLIS.find(([m]) => m === c.paye_mode)?.[1] || c.paye_mode)}${c.paye_le ? ` · ${esc(formatDate(c.paye_le, 'court'))}` : ''}</span>` : ''}</div>`
                : `<div class="col-paiement a-payer"><span>À payer au retrait</span><strong>${esc(montant(du ?? c.montant, champ(c, 'du_devise') || c.devise))}</strong>${du !== undefined && champ(c, 'du_devise') !== c.devise ? `<span class="discret">soit ${esc(montant(c.montant, c.devise))} au départ, figé au dépôt</span>` : ''}</div>`}
              ${c.statut === 'retire' ? `<p class="discret">Retiré le ${esc(dateHeure(c.retire_le))}${c.recu_par ? ` par ${esc(c.recu_par)}` : ''}.</p>` : ''}
            </section>
            <section class="carte col-bloc">
              <h2>Le colis</h2>
              <dl class="col-infos">
                <div><dt>Expéditeur</dt><dd><strong>${esc(c.expediteur_nom || '')}</strong><span>${esc(formatTel(c.expediteur_tel, { indicatif: true }))}</span></dd></div>
                <div><dt>Destinataire</dt><dd><strong>${esc(c.destinataire_nom || '')}</strong><span>${esc(formatTel(c.destinataire_tel, { indicatif: true }))}</span><span class="discret">Retrait : ${esc(arr?.nom || arr?.ville || '')}</span></dd></div>
                <div><dt>Contenu</dt><dd>${esc(c.contenu || '')}${c.contenu_douane && c.contenu_douane !== c.contenu ? `<span class="discret">Douane : ${esc(c.contenu_douane)}</span>` : ''}</dd></div>
                <div><dt>Poids</dt><dd>${formatNombre(c.poids, 2)} kg pesés${Number(c.poids_facture) > Number(c.poids) ? ` · facturé ${formatNombre(c.poids_facture, 2)} kg` : ''}</dd></div>
                <div><dt>Nombre de colis</dt><dd>${formatNombre(c.nb_colis || 1)}</dd></div>
                ${c.valeur_declaree ? `<div><dt>Valeur déclarée</dt><dd>${esc(montant(c.valeur_declaree, c.devise))}</dd></div>` : ''}
                <div><dt>Envoi</dt><dd>${envoi ? `<a href="#/envois/${encodeURIComponent(envoi.id || c.envoi_id)}">${esc(champ(envoi, 'numero', 'reference') || 'Voir l’envoi')}${champ(envoi, 'immatriculation') ? ` · ${esc(envoi.immatriculation)}` : ''}</a>` : c.envoi_id ? `<a href="#/envois/${encodeURIComponent(c.envoi_id)}">Voir l’envoi</a>` : '<span class="discret">Pas encore dans un envoi</span>'}</dd></div>
              </dl>
            </section>
          </div>
        </div>
        <section class="col-recu-impression" data-zone="recu" hidden></section>
      </div>`;
    if (!c.photos_effacees) {
      urlPhoto(c.photo_bascule, false).then((u) => { const img = conteneur.querySelector('[data-ref="photo-bascule"]'); if (u && img) { img.src = u; img.parentElement.href = u; } });
      urlPhoto(c.photo_contenu, true).then((u) => { const img = conteneur.querySelector('[data-ref="photo-contenu"]'); if (u && img) { img.src = u; img.parentElement.href = u; } });
    }
  }

  /* ---------------- Changer le statut */

  function changerStatut() {
    const c = s.c;
    const permis = ['recu', 'entrepot', 'charge', 'en_route', 'arrive', 'a_retirer', 'probleme', 'annule'].filter((x) => x !== c.statut);
    const { el, fermer } = ouvrirModale({
      titre: `Statut de ${c.numero}`,
      contenu: `<form class="form-modale" novalidate>
        <div class="champ"><label for="col-statut">Nouveau statut</label><select id="col-statut" class="input">${permis.map((x) => `<option value="${x}">${esc(STATUTS[x].libelle)}</option>`).join('')}</select></div>
        <div class="champ"><label for="col-note" data-ref="libelle-note">Note (facultatif)</label><input id="col-note" class="input" maxlength="200"></div>
        <div class="champ"><label for="col-lieu">Lieu (facultatif)</label><input id="col-lieu" class="input" maxlength="80" placeholder="Ex. Entrepôt de Colobane"></div>
        <p class="discret">Chaque changement est gardé dans le registre du colis, qu’on n’efface jamais.</p>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`
    });
    const select = el.querySelector('#col-statut');
    const motif = () => ['probleme', 'annule'].includes(select.value);
    select.addEventListener('change', () => { el.querySelector('[data-ref="libelle-note"]').textContent = motif() ? 'Motif (obligatoire)' : 'Note (facultatif)'; });
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const note = el.querySelector('#col-note').value.trim();
      const z = el.querySelector('.erreur-form');
      if (motif() && !note) { z.textContent = 'Indiquez le motif.'; z.hidden = false; return; }
      if (select.value === 'annule' && !(await confirmer(`Annuler le colis ${c.numero} ? Il ne sera pas supprimé : il reste dans le registre avec ce motif.`, { libelleOk: 'Annuler le colis', danger: true }))) return;
      boutonOccupe(el.querySelector('[type=submit]'), true);
      try { await api.statut(c.id, select.value, note || null, el.querySelector('#col-lieu').value.trim() || null); fermer(); toast('Statut enregistré.', 'succes'); charger(); }
      catch (err) { boutonOccupe(el.querySelector('[type=submit]'), false); z.textContent = messageErreur(err); z.hidden = false; }
    });
  }

  /* ---------------- Remise du colis */

  function remettre() {
    const c = s.c;
    const du = champ(c, 'du_montant') ?? c.montant;
    const devise = champ(c, 'du_devise') || c.devise;
    const { el, fermer } = ouvrirModale({
      titre: `Remettre ${c.numero}`,
      variante: 'large',
      contenu: `<form class="form-modale" novalidate>
        <div class="rangee-champs">
          <div class="champ"><label for="rem-nom">Qui retire</label><input id="rem-nom" class="input" maxlength="80" value="${esc(c.destinataire_nom || '')}" required></div>
          <div class="champ"><label for="rem-piece">Pièce d’identité</label><input id="rem-piece" class="input" maxlength="60" placeholder="Ex. CNI 123456789" required></div>
        </div>
        ${c.paye ? '<p class="col-paiement paye"><span>Déjà payé au départ</span><strong>Rien à encaisser</strong></p>' : `
        <div class="rangee-champs">
          <div class="champ"><label for="rem-montant">Montant encaissé (${esc(devise)})</label><input id="rem-montant" class="input col-gros" type="text" inputmode="numeric" value="${esc(formatNombre(du))}"></div>
          <div class="champ"><label for="rem-mode">Mode de paiement</label><select id="rem-mode" class="input">${MODES_PAIEMENT_COLIS.map(([m, l]) => `<option value="${m}">${esc(l)}</option>`).join('')}</select></div>
        </div>`}
        <div class="champ"><span class="etiquette">Signature au doigt</span>
          <canvas class="col-signature" width="640" height="220" data-ref="signature" aria-label="Zone de signature"></canvas>
          <button type="button" class="btn-lien" data-action="effacer-signature">Effacer la signature</button></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Remettre le colis</button></div>
      </form>`
    });
    const toile = el.querySelector('[data-ref="signature"]');
    const signe = monterSignature(toile);
    el.querySelector('[data-action="effacer-signature"]').addEventListener('click', () => signe.effacer());
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const z = el.querySelector('.erreur-form');
      const erreur = (t) => { z.textContent = t; z.hidden = !t; };
      const recuPar = el.querySelector('#rem-nom').value.trim();
      const piece = el.querySelector('#rem-piece').value.trim();
      if (!recuPar || !piece) return erreur('Le nom et la pièce d’identité sont obligatoires.');
      let montantEncaisse = null;
      let mode = null;
      if (!c.paye) {
        montantEncaisse = lireNombre(el.querySelector('#rem-montant').value);
        mode = el.querySelector('#rem-mode').value;
        if (montantEncaisse === null || montantEncaisse <= 0) return erreur('Indiquez le montant encaissé.');
      }
      if (!signe.signe()) return erreur('Faites signer la personne qui retire le colis.');
      erreur('');
      const bouton = el.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Remise…');
      try {
        await api.retirer(c.id, { recuPar, piece, montant: montantEncaisse, mode, signature: toile.toDataURL('image/png') });
        fermer();
        toast('Colis remis. L’expéditeur est prévenu par SMS.', 'succes', 6000);
        await charger();
        recu({ recuPar, piece, montant: montantEncaisse, devise, mode });
      } catch (err) { boutonOccupe(bouton, false); erreur(messageErreur(err)); }
    });
  }

  /** Reçu de remise (imprimable), après retirer_colis. */
  function recu({ recuPar, piece, montant: m, devise, mode }) {
    const c = s.c;
    const z = conteneur.querySelector('[data-zone="recu"]');
    z.innerHTML = `<article class="col-recu">
      <strong class="col-recu-titre">Reçu de remise</strong>
      <span>${esc(c.numero)} · ${esc(formatDate(new Date(), 'complet'))}</span>
      <span>Remis à <strong>${esc(recuPar)}</strong> (${esc(piece)})</span>
      <span>${esc(c.contenu || '')} · ${formatNombre(c.poids_facture || c.poids, 2)} kg</span>
      <strong>${m ? `Encaissé : ${esc(montant(m, devise))} · ${esc(MODES_PAIEMENT_COLIS.find(([x]) => x === mode)?.[1] || '')}` : 'Payé au départ : rien encaissé'}</strong>
      <span class="discret">Logiciel YOUMMA Business</span></article>`;
    const { el, fermer } = ouvrirModale({
      titre: 'Colis remis',
      contenu: `<p class="texte-modale">Le colis <strong>${esc(c.numero)}</strong> est remis. Un SMS part tout seul à l’expéditeur.</p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Fermer</button><button type="button" class="btn btn-primaire" data-action="imprimer-recu">${icone('imprimante', 17, 2)} Imprimer le reçu</button></div>`
    });
    el.querySelector('[data-action="imprimer-recu"]').addEventListener('click', () => { fermer(); imprimerColis(z); });
  }

  conteneur.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-action]')?.dataset.action;
    if (a === 'statut') changerStatut();
    if (a === 'remettre') remettre();
    if (a === 'copier') toast(await copierTexte(lienSuivi(champ(s.r, 'lien'), champ(s.r, 'jeton'))) ? 'Lien de suivi copié.' : 'Copie impossible.', 'succes');
  });
  charger();
}

/** Signature au doigt (comme les bons de livraison de l'étape 13). */
export function monterSignature(toile) {
  const ctx = toile.getContext('2d');
  ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0E1F1A';
  let dessine = false;
  let points = 0;
  const pos = (e) => { const r = toile.getBoundingClientRect(); return [(e.clientX - r.left) * (toile.width / r.width), (e.clientY - r.top) * (toile.height / r.height)]; };
  toile.addEventListener('pointerdown', (e) => { dessine = true; try { toile.setPointerCapture(e.pointerId); } catch { /* ancien navigateur */ } ctx.beginPath(); ctx.moveTo(...pos(e)); e.preventDefault(); });
  toile.addEventListener('pointermove', (e) => { if (!dessine) return; ctx.lineTo(...pos(e)); ctx.stroke(); points++; e.preventDefault(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => toile.addEventListener(t, () => { dessine = false; }));
  return { signe: () => points > 8, effacer: () => { ctx.clearRect(0, 0, toile.width, toile.height); points = 0; } };
}
