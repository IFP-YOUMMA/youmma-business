/**
 * colis/envois.js — Envois groupés (étape 16, maquette ColisEnvoi) : #/envois (liste, « Nouvel envoi ») et
 * #/envois/<id> (bandeau Colis · Poids · Recette · Frais · Bénéfice, manifeste, le voyage, les frais du voyage,
 * composer l'envoi avec les colis en attente, « Faire partir », « Marquer arrivé »).
 * Le manifeste imprimé est le document de la douane : A4 portrait, tous les colis, en-tête de tableau répété.
 * Montants : ceux de detail_envoi (jamais recalculés ici) ; une monnaie par ligne.
 */
import { sb } from '../supabase.js';
import { etat } from '../state.js';
import { naviguer } from '../router.js';
import { esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, confirmer, lireNombre, formatNombre, formatDate, dateISO } from '../utils.js';
import { api, chargerAgences, agenceDe, champ, formatTel, montant, nomDevise, poids as poidsTexte, iconeColis, MODES } from './commun.js';
import { imprimerColis } from './etiquettes.js';

const COLONNES_ENVOI = 'id, numero, reference, mode, statut, agence_depart, agence_arrivee, transporteur, chauffeur, chauffeur_tel, immatriculation, depart_prevu, depart_le, arrivee_prevue, arrivee_le, frais, note, created_at';
const enRoute = (st) => st === 'en_route';
const arrive = (st) => ['arrive', 'termine', 'arrivee'].includes(st);
const libelleEnvoi = (e) => `${e.mode === 'avion' ? 'Vol' : 'Camion'} ${champ(e, 'immatriculation', 'reference') || ''}`.trim();
const libelleStatut = (st) => (arrive(st) ? ['Arrivé', 'vert'] : enRoute(st) ? ['En route', 'bleu'] : ['En préparation', 'gris']);

/* =========================================================================
   Liste
   ========================================================================= */

export function afficherEnvois(conteneur, params) {
  const id = params.get('id');
  if (id) return afficherEnvoi(conteneur, id);
  conteneur.innerHTML = `
    <div class="page page-envois">
      <header class="page-entete"><div class="page-titres"><h1>Envois</h1><span>Camions et vols : grouper les colis, les faire partir, les faire arriver.</span></div>
        <button type="button" class="btn btn-primaire" data-action="nouveau">${icone('plus', 16, 2.6)} Nouvel envoi</button></header>
      <section class="col-envois-liste" data-zone="liste"><span class="squelette" style="height:240px"></span></section>
    </div>`;
  const zone = conteneur.querySelector('[data-zone="liste"]');
  (async () => {
    const [agences, res] = await Promise.all([chargerAgences().catch(() => []), sb.from('envois').select(COLONNES_ENVOI).eq('boutique_id', etat.boutique.id).order('created_at', { ascending: false }).limit(60)]);
    if (!conteneur.isConnected) return;
    if (res.error) { zone.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(res.error))}</p>`; return; }
    const groupes = [['En cours', res.data.filter((e) => !arrive(e.statut))], ['Arrivés', res.data.filter((e) => arrive(e.statut))]];
    zone.innerHTML = groupes.map(([titre, l]) => `<h2 class="col-groupe">${titre} <span class="discret">${l.length}</span></h2>
      ${l.length ? `<div class="col-cartes-envois">${l.map((e) => {
        const [lib, cl] = libelleStatut(e.statut);
        const dep = agenceDe(agences, e.agence_depart);
        const arr = agenceDe(agences, e.agence_arrivee);
        return `<a class="carte col-carte-envoi" href="#/envois/${encodeURIComponent(e.id)}">
          <span class="col-envoi-icone">${iconeColis(MODES[e.mode]?.icone || 'camion', 20)}</span>
          <span class="col-envoi-textes"><strong>${esc(e.numero || e.reference || 'Envoi')} — ${esc(libelleEnvoi(e))}</strong>
            <span>${esc(dep?.ville || '')} → ${esc(arr?.ville || '')}${e.depart_le ? ` · parti le ${esc(formatDate(e.depart_le, 'jourMois'))}` : e.depart_prevu ? ` · départ prévu le ${esc(formatDate(e.depart_prevu, 'jourMois'))}` : ''}</span></span>
          <span class="col-statut ${cl}">${lib}</span></a>`;
      }).join('')}</div>` : '<p class="col-vide">Aucun.</p>'}`).join('');
  })();
  conteneur.addEventListener('click', (e) => { if (e.target.closest('[data-action="nouveau"]')) ouvrirNouvelEnvoi(); });
  if (params.get('nouveau')) ouvrirNouvelEnvoi();
  return undefined;
}

/** Nouvel envoi : trajet, mode, véhicule ou vol, transporteur, chauffeur, dates prévues → creer_envoi. */
async function ouvrirNouvelEnvoi() {
  const agences = await chargerAgences();
  const dep = agences.find((a) => a.devise === 'XOF') || agences[0];
  const arr = agences.find((a) => a.id !== dep?.id);
  const options = (choisi) => agences.map((a) => `<option value="${a.id}" ${a.id === choisi?.id ? 'selected' : ''}>${esc(a.ville || a.nom)}</option>`).join('');
  const { el, fermer } = ouvrirModale({
    titre: 'Nouvel envoi',
    variante: 'large',
    contenu: `<form class="form-modale" novalidate>
      <div class="rangee-champs">
        <div class="champ"><label for="env-dep">Départ</label><select id="env-dep" class="input">${options(dep)}</select></div>
        <div class="champ"><label for="env-arr">Arrivée</label><select id="env-arr" class="input">${options(arr)}</select></div>
        <div class="champ"><label for="env-mode">Mode</label><select id="env-mode" class="input"><option value="route">Route (camion)</option><option value="avion">Avion (vol)</option></select></div>
      </div>
      <div class="rangee-champs">
        <div class="champ"><label for="env-ref">Immatriculation ou n° de vol</label><input id="env-ref" class="input" maxlength="30" placeholder="Ex. GN-4821 ou SN 3041"></div>
        <div class="champ"><label for="env-transp">Transporteur</label><input id="env-transp" class="input" maxlength="80"></div>
      </div>
      <div class="rangee-champs">
        <div class="champ"><label for="env-chauffeur">Chauffeur</label><input id="env-chauffeur" class="input" maxlength="80"></div>
        <div class="champ"><label for="env-tel">Téléphone du chauffeur</label><input id="env-tel" class="input" type="tel" inputmode="tel" maxlength="20"></div>
      </div>
      <div class="rangee-champs">
        <div class="champ"><label for="env-depart">Départ prévu</label><input id="env-depart" class="input" type="date" min="${dateISO()}"></div>
        <div class="champ"><label for="env-arrivee">Arrivée prévue</label><input id="env-arrivee" class="input" type="date" min="${dateISO()}"></div>
      </div>
      <p class="erreur-form" role="alert" hidden></p>
      <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Créer l’envoi</button></div>
    </form>`
  });
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (sel) => el.querySelector(sel).value.trim();
    const z = el.querySelector('.erreur-form');
    if (v('#env-dep') === v('#env-arr')) { z.textContent = 'Le départ et l’arrivée doivent être deux bureaux différents.'; z.hidden = false; return; }
    const mode = v('#env-mode');
    boutonOccupe(el.querySelector('[type=submit]'), true);
    try {
      const r = await api.creerEnvoi({
        depart: v('#env-dep'), arrivee: v('#env-arr'), mode, reference: v('#env-ref'), immatriculation: mode === 'route' ? v('#env-ref') : null,
        transporteur: v('#env-transp'), chauffeur: v('#env-chauffeur'), chauffeurTel: v('#env-tel').replace(/\D/g, '') || null,
        departPrevu: v('#env-depart') || null, arriveePrevue: v('#env-arrivee') || null
      });
      fermer();
      naviguer(`envois/${encodeURIComponent(champ(r, 'id', 'envoi_id') || r)}`);
    } catch (err) { boutonOccupe(el.querySelector('[type=submit]'), false); z.textContent = messageErreur(err); z.hidden = false; }
  });
}

/* =========================================================================
   Un envoi
   ========================================================================= */

function afficherEnvoi(conteneur, id) {
  const s = { r: null, envoi: null, colis: [], totaux: {}, agences: [], attente: [], frais: [] };
  conteneur.innerHTML = `<div class="page page-envoi"><div class="squelette" style="height:420px"></div></div>`;

  async function charger() {
    try {
      const [r, agences] = await Promise.all([api.envoi(id), chargerAgences()]);
      if (!conteneur.isConnected) return;
      s.r = r || {};
      s.envoi = s.r.envoi || s.r;
      s.colis = champ(s.r, 'colis', 'lignes') || [];
      s.totaux = s.r.totaux || s.r;
      s.agences = agences;
      const lignesFrais = [champ(s.envoi, 'frais'), champ(s.r, 'frais')].find(Array.isArray) || [];
      s.frais = lignesFrais.map((f) => ({ nom: f.nom, montant: Number(f.montant) || 0 }));
      if (!enRoute(s.envoi.statut) && !arrive(s.envoi.statut)) {
        const dep = agenceDe(agences, s.envoi.agence_depart);
        s.attente = (await api.liste({ filtre: 'attente', agence: dep?.id || null, limite: 200 }).catch(() => []))
          .filter((c) => !c.envoi_id && (!c.agence_arrivee || c.agence_arrivee === s.envoi.agence_arrivee || c.agence_arrivee?.id === s.envoi.agence_arrivee));
      } else s.attente = [];
      render();
    } catch (err) {
      conteneur.innerHTML = `<div class="page"><p class="bloc-erreur">${esc(messageErreur(err))}</p><a class="btn btn-secondaire" href="#/envois">Retour aux envois</a></div>`;
    }
  }

  const devise = () => champ(s.totaux, 'devise') || agenceDe(s.agences, s.envoi.agence_depart)?.devise || 'XOF';

  function render() {
    const e = s.envoi;
    const t = s.totaux;
    const dep = agenceDe(s.agences, e.agence_depart);
    const arr = agenceDe(s.agences, e.agence_arrivee);
    const nb = Number(champ(t, 'nb_colis', 'nb')) || s.colis.length;
    const poidsTotal = Number(champ(t, 'poids', 'poids_total')) || 0;
    const recette = Number(champ(t, 'recette')) || 0;
    const frais = Number(champ(t, 'frais_total', 'total_frais')) || s.frais.reduce((x, f) => x + f.montant, 0);
    const benefice = champ(t, 'benefice') ?? recette - frais;
    const [lib, cl] = libelleStatut(e.statut);
    const preparation = !enRoute(e.statut) && !arrive(e.statut);
    const kpi = (l, v, sous, classe = '') => `<div class="carte col-kpi"><span class="etiquette-carte">${esc(l)}</span><strong class="nombre-gros ${classe}">${v}</strong><span class="col-kpi-sous">${sous}</span></div>`;
    conteneur.innerHTML = `
      <div class="page page-envoi">
        <header class="col-envoi-entete no-print">
          <a href="#/envois" class="btn-icone" aria-label="Retour aux envois">${icone('retour', 20, 2)}</a>
          <div class="page-titres"><h1>Envoi ${esc(e.numero || e.reference || '')} — ${esc(libelleEnvoi(e))}</h1>
            <span>${esc(dep?.ville || '')} → ${esc(arr?.ville || '')}${e.depart_le ? ` · parti le ${esc(formatDate(e.depart_le, 'jourMois'))} à ${esc(formatDate(e.depart_le, 'heure').replace(':00', ' h'))}` : ''}${e.arrivee_prevue ? ` · arrivée prévue le ${esc(formatDate(e.arrivee_prevue, 'jourMois'))}` : ''} · <span class="col-statut ${cl}">${lib}</span></span></div>
          <div class="col-envoi-boutons">
            <button type="button" class="btn btn-secondaire" data-action="manifeste">${icone('imprimante', 17, 2)} Imprimer le manifeste</button>
            ${preparation ? `<button type="button" class="btn btn-primaire" data-action="partir" ${s.colis.length ? '' : 'disabled'}>Faire partir</button>` : ''}
            ${enRoute(e.statut) ? `<button type="button" class="btn btn-primaire" data-action="arriver">Marquer arrivé à ${esc(arr?.ville || 'destination')}</button>` : ''}
          </div>
        </header>
        <section class="col-kpis cinq no-print">
          ${kpi('Colis', formatNombre(nb), nb ? `${formatNombre(s.colis.length)} affichés ici` : 'Ajoutez des colis')}
          ${kpi('Poids total', poidsTexte(poidsTotal).replace(',00', ''), nb ? `moyenne ${poidsTexte(poidsTotal / nb).replace(',00', '')}` : '—')}
          ${kpi('Recette', esc(montant(recette, devise())), champ(t, 'recette_arrivee') ? `dont ${esc(montant(t.recette_arrivee, devise()))} à l’arrivée` : 'colis de cet envoi')}
          ${kpi('Frais du voyage', esc(montant(frais, devise())), s.frais.map((f) => f.nom).slice(0, 3).join(', ').toLowerCase() || 'aucun frais saisi')}
          ${kpi('Bénéfice', benefice !== undefined ? esc(montant(benefice, devise())) : '—', benefice !== undefined && recette ? `${Math.round((benefice / recette) * 100)} % de marge` : '', benefice < 0 ? 'texte-danger' : 'texte-succes')}
        </section>
        <div class="col-envoi-grille no-print">
          <div class="col-envoi-gauche">
            <section class="carte col-manifeste">
              <div class="col-carte-entete"><h2>Manifeste — les colis de cet envoi</h2></div>
              ${s.colis.length ? `<div class="tableau-cadre"><table class="col-tableau">
                <thead><tr><th>N°</th><th>Expéditeur</th><th>Destinataire</th><th>Contenu</th><th class="droite">kg</th><th class="droite">Montant</th><th>Paiement</th>${preparation ? '<th></th>' : ''}</tr></thead>
                <tbody>${s.colis.map((c) => `<tr><td><a class="col-num" href="#/colis/${encodeURIComponent(c.id)}">${esc(c.numero)}</a></td><td>${esc(c.expediteur_nom || '')}</td><td>${esc(c.destinataire_nom || '')}</td><td>${esc(c.contenu_douane || c.contenu || '')}</td>
                  <td class="droite">${formatNombre(champ(c, 'poids_facture', 'poids') || 0, 2)}</td><td class="droite"><strong>${formatNombre(c.montant)}</strong></td><td>${c.paye ? 'Payé' : 'À l’arrivée'}</td>
                  ${preparation ? `<td><button type="button" class="btn-lien btn-lien-danger" data-retirer="${esc(c.id)}">Retirer</button></td>` : ''}</tr>`).join('')}</tbody>
                <tfoot><tr><td colspan="4"><strong>Total (${formatNombre(nb)} colis)</strong></td><td class="droite"><strong>${formatNombre(poidsTotal, 2)}</strong></td><td class="droite"><strong>${formatNombre(recette)}</strong></td><td colspan="${preparation ? 2 : 1}">${esc(nomDevise(devise()))}</td></tr></tfoot>
              </table></div>` : '<p class="col-vide">Aucun colis dans cet envoi pour l’instant.</p>'}
            </section>
            ${preparation ? `<section class="carte col-composer">
              <div class="col-carte-entete"><h2>Colis en attente à ${esc(dep?.ville || 'au départ')}</h2>
                <button type="button" class="btn btn-secondaire btn-petit" data-action="ajouter" disabled>Ajouter à l’envoi</button></div>
              ${s.attente.length ? `<ul class="col-attente">${s.attente.map((c) => `<li><label><input type="checkbox" value="${esc(c.id)}">
                <span class="col-num">${esc(c.numero)}</span><span>${esc(c.expediteur_nom || '')} → ${esc(c.destinataire_nom || '')}</span><span class="droite">${formatNombre(champ(c, 'poids_facture', 'poids') || 0, 2)} kg</span></label></li>`).join('')}</ul>
                <button type="button" class="btn-lien" data-action="tout-cocher">Tout cocher</button>` : '<p class="col-vide">Aucun colis en attente pour ce trajet.</p>'}
            </section>` : ''}
          </div>
          <div class="col-envoi-droite">
            <section class="carte col-voyage">
              <div class="col-carte-entete"><h2>Le voyage</h2><button type="button" class="btn-lien" data-action="voyage">Modifier</button></div>
              <dl class="col-infos">
                <div><dt>Transporteur</dt><dd>${esc(e.transporteur || '—')}</dd></div>
                <div><dt>Chauffeur</dt><dd>${esc(e.chauffeur || '—')}${e.chauffeur_tel ? `<span>${esc(formatTel(e.chauffeur_tel))}</span>` : ''}</dd></div>
                <div><dt>${e.mode === 'avion' ? 'Vol' : 'Immatriculation'}</dt><dd>${esc(champ(e, 'immatriculation', 'reference') || '—')}</dd></div>
                <div><dt>Départ prévu</dt><dd>${e.depart_prevu ? esc(formatDate(e.depart_prevu, 'court')) : '—'}</dd></div>
                <div><dt>Départ réel</dt><dd>${e.depart_le ? esc(formatDate(e.depart_le, 'complet')) : '—'}</dd></div>
                <div><dt>Arrivée prévue</dt><dd>${e.arrivee_prevue ? esc(formatDate(e.arrivee_prevue, 'court')) : '—'}</dd></div>
                ${e.arrivee_le ? `<div><dt>Arrivé le</dt><dd>${esc(formatDate(e.arrivee_le, 'complet'))}</dd></div>` : ''}
              </dl>
            </section>
            <section class="carte col-frais">
              <h2>Frais du voyage</h2>
              <div data-zone="frais">${fraisHTML()}</div>
              <button type="button" class="btn-ajout-pointille" data-action="ajouter-frais">+ Ajouter un frais</button>
              <button type="button" class="btn btn-secondaire btn-bloc" data-action="enregistrer-frais" hidden>Enregistrer les frais</button>
            </section>
            ${enRoute(e.statut) ? `<p class="col-note-arrivee"><strong>À l’arrivée :</strong> « Marquer arrivé » fait passer les ${formatNombre(nb)} colis en « à retirer » et envoie un SMS à chaque destinataire, avec le numéro de suivi et le montant à payer.</p>` : ''}
          </div>
        </div>
        ${manifesteImpression()}
      </div>`;
  }

  function fraisHTML() {
    return `${s.frais.map((f, i) => `<div class="col-frais-ligne" data-frais="${i}">
      <input class="input" value="${esc(f.nom)}" data-champ="nom" aria-label="Nom du frais" placeholder="Ex. Carburant">
      <input class="input droite" value="${f.montant ? esc(formatNombre(f.montant)) : ''}" data-champ="montant" inputmode="numeric" aria-label="Montant" placeholder="0">
      <button type="button" class="btn-icone" data-supprimer-frais="${i}" aria-label="Supprimer ce frais">×</button></div>`).join('') || '<p class="discret">Location du camion, carburant, douane, manutention, péages…</p>'}
      ${s.frais.length ? `<div class="col-frais-total"><span>Total</span><strong>${esc(montant(s.frais.reduce((t, f) => t + (Number(f.montant) || 0), 0), devise()))}</strong></div>` : ''}`;
  }

  /** Le manifeste imprimé (douane) : en-tête de l'agence, trajet, véhicule, date, tous les colis, totaux, signature et cachet. */
  function manifesteImpression() {
    const e = s.envoi;
    const dep = agenceDe(s.agences, e.agence_depart);
    const arr = agenceDe(s.agences, e.agence_arrivee);
    const poidsTotal = s.colis.reduce((t, c) => t + (Number(champ(c, 'poids_facture', 'poids')) || 0), 0);
    const valeurs = s.colis.reduce((t, c) => t + (Number(c.valeur_declaree) || 0), 0);
    return `<section class="col-manifeste-impression col-feuille-a4-flux">
      <header class="man-entete"><div><strong>${esc(etat.boutique.nom.toUpperCase())}</strong><span>${esc([dep, arr].filter(Boolean).map((a) => `${a.ville || a.nom} ${formatTel(a.telephone)}`).join(' · '))}</span></div>
        <div class="droite"><strong>MANIFESTE DE CHARGEMENT</strong><span>Envoi ${esc(e.numero || e.reference || '')} · ${esc(formatDate(e.depart_le || e.depart_prevu || new Date(), 'court'))}</span></div></header>
      <div class="man-trajet"><span><strong>Départ :</strong> ${esc(dep?.ville || '')}${dep?.adresse ? `, ${esc(dep.adresse)}` : ''}</span><span><strong>Arrivée :</strong> ${esc(arr?.ville || '')}${arr?.adresse ? `, ${esc(arr.adresse)}` : ''}</span>
        <span><strong>${e.mode === 'avion' ? 'Vol' : 'Véhicule'} :</strong> ${esc(champ(e, 'immatriculation', 'reference') || '—')}</span><span><strong>Transporteur :</strong> ${esc(e.transporteur || '—')}</span><span><strong>Chauffeur :</strong> ${esc(e.chauffeur || '—')} ${esc(formatTel(e.chauffeur_tel))}</span></div>
      <table class="man-tableau">
        <thead><tr><th>N°</th><th>Expéditeur</th><th>Destinataire</th><th>Contenu déclaré</th><th class="droite">Colis</th><th class="droite">Poids (kg)</th><th class="droite">Valeur déclarée</th></tr></thead>
        <tbody>${s.colis.map((c, i) => `<tr><td>${i + 1}. ${esc(c.numero)}</td><td>${esc(c.expediteur_nom || '')}</td><td>${esc(c.destinataire_nom || '')}</td><td>${esc(c.contenu_douane || c.contenu || '')}</td>
          <td class="droite">${formatNombre(c.nb_colis || 1)}</td><td class="droite">${formatNombre(champ(c, 'poids_facture', 'poids') || 0, 2)}</td><td class="droite">${c.valeur_declaree ? formatNombre(c.valeur_declaree) : '—'}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4"><strong>Total : ${formatNombre(s.colis.length)} colis</strong></td><td class="droite"><strong>${formatNombre(s.colis.reduce((t, c) => t + (Number(c.nb_colis) || 1), 0))}</strong></td><td class="droite"><strong>${formatNombre(poidsTotal, 2)}</strong></td><td class="droite"><strong>${valeurs ? `${formatNombre(valeurs)} ${esc(nomDevise(devise()))}` : '—'}</strong></td></tr></tfoot>
      </table>
      <div class="man-signatures"><div><span>Signature du responsable de l’agence</span></div><div><span>Signature du transporteur</span></div><div><span>Cachet</span></div></div>
      <p class="man-pied">Manifeste établi avec YOUMMA Business · ${esc(formatDate(new Date(), 'complet'))}</p>
    </section>`;
  }

  /* ---------------- Actions */

  async function partir(bouton) {
    if (!(await confirmer(`Faire partir l’envoi avec ${s.colis.length} colis ? Les colis passent « en route ».`, { libelleOk: 'Faire partir' }))) return;
    boutonOccupe(bouton, true, 'Départ…');
    try { await api.partir(id); toast('Envoi parti.', 'succes'); charger(); } catch (err) { boutonOccupe(bouton, false); toast(messageErreur(err), 'erreur', 6000); }
  }

  async function arriver(bouton) {
    const nb = Number(champ(s.totaux, 'nb_colis', 'nb')) || s.colis.length;
    const arr = agenceDe(s.agences, s.envoi.agence_arrivee);
    if (!(await confirmer(`${nb} colis vont passer en « à retirer » et ${nb} SMS vont partir.`, { titre: `Marquer arrivé à ${arr?.ville || 'destination'}`, libelleOk: 'Marquer arrivé' }))) return;
    boutonOccupe(bouton, true, 'Arrivée…');
    try {
      const r = await api.arriver(id);
      const n = champ(r || {}, 'colis_a_retirer', 'nb') ?? nb;
      ouvrirModale({ titre: 'Envoi arrivé', contenu: `<p class="texte-modale"><strong>${formatNombre(n)} colis</strong> sont maintenant « à retirer ». Les destinataires sont prévenus par SMS.</p><div class="modale-actions"><button type="button" class="btn btn-primaire" data-fermer>Compris</button></div>` });
      charger();
    } catch (err) { boutonOccupe(bouton, false); toast(messageErreur(err), 'erreur', 6000); }
  }

  function lireFrais() {
    conteneur.querySelectorAll('[data-frais]').forEach((l) => {
      const i = Number(l.dataset.frais);
      s.frais[i] = { nom: l.querySelector('[data-champ="nom"]').value.trim(), montant: lireNombre(l.querySelector('[data-champ="montant"]').value) || 0 };
    });
  }
  function majFrais() {
    conteneur.querySelector('[data-zone="frais"]').innerHTML = fraisHTML();
    conteneur.querySelector('[data-action="enregistrer-frais"]').hidden = false;
  }

  function modifierVoyage() {
    const e = s.envoi;
    const { el, fermer } = ouvrirModale({
      titre: 'Le voyage',
      contenu: `<form class="form-modale" novalidate>
        <div class="champ"><label for="v-ref">${e.mode === 'avion' ? 'N° de vol' : 'Immatriculation'}</label><input id="v-ref" class="input" value="${esc(champ(e, 'immatriculation', 'reference') || '')}"></div>
        <div class="rangee-champs"><div class="champ"><label for="v-transp">Transporteur</label><input id="v-transp" class="input" value="${esc(e.transporteur || '')}"></div>
          <div class="champ"><label for="v-ch">Chauffeur</label><input id="v-ch" class="input" value="${esc(e.chauffeur || '')}"></div></div>
        <div class="rangee-champs"><div class="champ"><label for="v-tel">Téléphone du chauffeur</label><input id="v-tel" class="input" type="tel" value="${esc(formatTel(e.chauffeur_tel))}"></div>
          <div class="champ"><label for="v-arr">Arrivée prévue</label><input id="v-arr" class="input" type="date" value="${esc(String(e.arrivee_prevue || '').slice(0, 10))}"></div></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`
    });
    el.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const v = (sel) => el.querySelector(sel).value.trim();
      const maj = { transporteur: v('#v-transp') || null, chauffeur: v('#v-ch') || null, chauffeur_tel: v('#v-tel').replace(/\D/g, '') || null, arrivee_prevue: v('#v-arr') || null };
      if (e.mode === 'avion') maj.reference = v('#v-ref') || null; else maj.immatriculation = v('#v-ref') || null;
      boutonOccupe(el.querySelector('[type=submit]'), true);
      const { error } = await sb.from('envois').update(maj).eq('id', id);
      if (error) { boutonOccupe(el.querySelector('[type=submit]'), false); const z = el.querySelector('.erreur-form'); z.textContent = messageErreur(error); z.hidden = false; return; }
      fermer(); toast('Voyage enregistré.', 'succes'); charger();
    });
  }

  conteneur.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-action]')?.dataset.action;
    const bouton = e.target.closest('button');
    if (a === 'manifeste') imprimerColis(conteneur.querySelector('.col-manifeste-impression'));
    if (a === 'partir') partir(bouton);
    if (a === 'arriver') arriver(bouton);
    if (a === 'voyage') modifierVoyage();
    if (a === 'tout-cocher') conteneur.querySelectorAll('.col-attente input').forEach((c) => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    if (a === 'ajouter') {
      const ids = [...conteneur.querySelectorAll('.col-attente input:checked')].map((c) => c.value);
      if (!ids.length) return;
      boutonOccupe(bouton, true);
      try { await api.dansEnvoi(id, ids); toast(`${ids.length} colis ajouté${ids.length > 1 ? 's' : ''} à l’envoi.`, 'succes'); charger(); } catch (err) { boutonOccupe(bouton, false); toast(messageErreur(err), 'erreur'); }
    }
    const retirer = e.target.closest('[data-retirer]');
    if (retirer) {
      try { await api.dansEnvoi(id, [retirer.dataset.retirer], true); toast('Colis retiré de l’envoi.', 'succes'); charger(); } catch (err) { toast(messageErreur(err), 'erreur'); }
    }
    if (a === 'ajouter-frais') { lireFrais(); s.frais.push({ nom: '', montant: 0 }); majFrais(); conteneur.querySelector('[data-frais]:last-child [data-champ="nom"]')?.focus(); }
    const sup = e.target.closest('[data-supprimer-frais]');
    if (sup) { lireFrais(); s.frais.splice(Number(sup.dataset.supprimerFrais), 1); majFrais(); }
    if (a === 'enregistrer-frais') {
      lireFrais();
      const frais = s.frais.filter((f) => f.nom && f.montant > 0);
      boutonOccupe(bouton, true);
      try { await api.frais(id, frais); toast('Frais enregistrés.', 'succes'); charger(); } catch (err) { boutonOccupe(bouton, false); toast(messageErreur(err), 'erreur'); }
    }
  });
  conteneur.addEventListener('input', (e) => { if (e.target.closest('[data-frais]')) conteneur.querySelector('[data-action="enregistrer-frais"]').hidden = false; });
  conteneur.addEventListener('change', (e) => {
    if (e.target.closest('.col-attente')) {
      const n = conteneur.querySelectorAll('.col-attente input:checked').length;
      const b = conteneur.querySelector('[data-action="ajouter"]');
      b.disabled = !n;
      b.textContent = n ? `Ajouter ${n} colis à l’envoi` : 'Ajouter à l’envoi';
    }
  });
  charger();
}
