/**
 * livraisons.js — Livraisons & camions (module « livraisons », étape 13, maquette Livraisons).
 *
 *  - écran #/ventes?onglet=livraisons (onglet de « Caisse & ventes ») : résumé du jour, liste (tableau sur ordinateur, cartes sur téléphone), actions ;
 *  - fenêtre « Organiser la livraison » (depuis une vente, une commande en ligne ou libre) → creer_livraison ;
 *  - « Faire partir » → partir_livraison (SMS au chauffeur avec son lien d/<jeton>, client prévenu) ;
 *  - Mes véhicules : écriture directe dans la table vehicules (gérant).
 * Sécurité : la colonne « jeton » n'est jamais lue par l'appli (le lien ne sort que de partir_livraison).
 */
import { sb } from './supabase.js';
import { etat, estGerant } from './state.js';
import {
  esc, icone, toast, confirmer, ouvrirModale, boutonOccupe, messageErreur, lireNombre, copierTexte,
  formatNombre, formatGNF, formatQuantite, formatDate, formatTelephone, formatNumeroVente, normaliserTelephone, dateISO
} from './utils.js';
import { ouvrirDocument } from './documents/donnees.js';

const STATUTS = {
  a_charger: { libelle: 'À charger', classe: 'a-charger' },
  en_route: { libelle: 'En route', classe: 'en-route' },
  livree: { libelle: 'Livrée', classe: 'livree' },
  annulee: { libelle: 'Annulée', classe: 'annulee' }
};
const ORDRE = { a_charger: 0, en_route: 1, livree: 2, annulee: 3 };
const TYPES_VEHICULE = { camion: ['Camion', '🚚'], tricycle: ['Tricycle', '🛺'], moto: ['Moto', '🏍️'], voiture: ['Voiture', '🚗'], autre: ['Autre', '🚛'] };
/** Colonnes de vehicules lues par l'appli. */
const COLONNES_VEHICULE = 'id, nom, type, immatriculation, chauffeur, telephone, frais_voyage, capacite, actif';

/** « 2026-10-20T15:00 » (heure locale, dans une heure arrondie) pour un champ datetime-local. */
function dansUneHeure() {
  const d = new Date(Date.now() + 36e5);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:00`;
}
const heure = (iso) => (iso ? formatDate(iso, 'heure') : '');
const lienWhatsApp = (tel, texte) => `https://wa.me/${normaliserTelephone(tel || '') || ''}?text=${encodeURIComponent(texte)}`;

/**
 * Ligne de mes_livraisons : { id, numero, client_nom, telephone, adresse, repere, statut, frais, frais_payes, contenu,
 * prevue_le, created_at, partie_le, livree_le, recu_par, a_bon, vente_id, vente_numero ("V-0412"), vehicule (nom),
 * vehicule_type, chauffeur, chauffeur_tel, rang } — liste déjà triée par la base.
 */
function normaliserLivraison(l) {
  return { ...l, frais: Number(l.frais) || 0, vehicule_nom: l.vehicule || '' };
}
/** « V-0412 » (déjà formaté par la base) ; un nombre est formaté comme ailleurs. */
const numeroVente = (n) => (n === null || n === undefined || n === '' ? '' : typeof n === 'number' ? formatNumeroVente(n) : String(n));
/** Lien Maps : adresse + repère. */
const lienMaps = (l) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([l.adresse, l.repere].filter(Boolean).join(', '))}`;

/** Texte « Quand » : prévue / partie / livrée. */
function quand(l) {
  if (l.statut === 'livree') return `Livrée ${l.livree_le ? `à ${heure(l.livree_le)}` : ''}${l.recu_par ? ` · ${l.recu_par}` : ''}`;
  if (l.statut === 'en_route') return `En route${l.partie_le ? ` depuis ${heure(l.partie_le)}` : ''}`;
  if (l.statut === 'annulee') return `Annulée${l.motif ? ` · ${l.motif}` : ''}`;
  return l.prevue_le ? `Prévue ${formatDate(l.prevue_le, 'court')} ${heure(l.prevue_le)}` : 'À organiser';
}

/* =========================================================================
   Écran des livraisons (onglet de « Caisse & ventes »)
   ========================================================================= */

export function afficherLivraisons(conteneur) {
  const boutique = etat.boutique;
  const gerant = estGerant();
  const s = { jour: dateISO(), resume: {}, liste: [], vehicules: [], charge: false };
  conteneur.innerHTML = `
    <div class="page page-livraisons">
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour seul-ordi" href="#/aujourdhui">← Aujourd’hui</a>
          <h1>Livraisons</h1>
          <span>Camions, chauffeurs et bons signés</span>
        </div>
        <div class="dash-entete-actions">
          <label class="champ-jour"><span class="sr-only">Jour</span><input type="date" class="input" data-ref="jour" value="${s.jour}" max="${dateISO(30)}"></label>
          <button type="button" class="btn btn-primaire" data-action="nouvelle">${icone('plus', 18, 2.4)} Nouvelle livraison</button>
        </div>
      </header>
      <section class="kpis-livraisons" data-zone="resume">${'<div class="carte kpi-client"><span class="squelette" style="height:40px"></span></div>'.repeat(4)}</section>
      <section class="carte liste-livraisons" aria-label="Livraisons" data-zone="liste"><div class="squelette" style="height:160px"></div></section>
      <div class="rangee-livraisons">
        <section class="carte bloc-vehicules"><div class="bloc-entete"><h2>Mes véhicules</h2>${gerant ? `<button type="button" class="btn btn-secondaire btn-petit" data-action="vehicule">${icone('plus', 16, 2.4)} Ajouter</button>` : ''}</div>
          <div data-zone="vehicules"></div>
          <p class="discret">Les frais de livraison s’ajoutent à la vente. Les frais du véhicule sont proposés à chaque voyage.</p></section>
        <section class="carte bloc-arrivee"><h2>À l’arrivée</h2>
          <p>Le chauffeur ouvre le lien reçu par SMS, fait signer le client du doigt et prend le bon en photo.</p>
          <p class="discret">Vous recevez : « Livraison L-0001 remise à … à 11 h 05 ».</p></section>
      </div>
    </div>`;
  const zone = (n) => conteneur.querySelector(`[data-zone="${n}"]`);

  function renderResume() {
    const r = s.resume;
    const aCharger = s.liste.filter((l) => l.statut === 'a_charger');
    const enRoute = s.liste.filter((l) => l.statut === 'en_route');
    const livrees = s.liste.filter((l) => l.statut === 'livree');
    const cartes = [
      ['À charger', r.a_charger ?? aCharger.length, aCharger[0] ? [aCharger[0].vehicule_nom, aCharger[0].prevue_le ? heure(aCharger[0].prevue_le) : ''].filter(Boolean).join(' · ') : 'Rien à charger', 'encre-alerte'],
      ['En route', r.en_route ?? enRoute.length, enRoute[0] ? [enRoute[0].vehicule_nom, enRoute[0].adresse].filter(Boolean).join(' · ') : 'Aucun véhicule dehors', 'encre-route'],
      [s.jour === dateISO() ? 'Livrées aujourd’hui' : 'Livrées ce jour', r.livrees ?? livrees.length, `${livrees.filter((l) => l.recu_par).length} bon(s) signé(s)`, 'encre-succes'],
      ['Frais encaissés', formatNombre(Number(r.frais) || 0), 'GNF ce jour', 'encre-primaire']
    ];
    zone('resume').innerHTML = cartes.map(([libelle, valeur, sous, encre]) => `
      <div class="carte kpi-livraison"><span class="kpi-libelle">${esc(libelle)}</span><strong class="kpi-livraison-valeur">${esc(String(valeur))}</strong><span class="kpi-livraison-sous ${encre}">${esc(sous)}</span></div>`).join('');
  }

  function actionsHTML(l) {
    const a = [];
    if (l.statut === 'a_charger') a.push(`<button type="button" class="btn btn-primaire btn-petit" data-partir="${esc(l.id)}">${icone('camion', 16, 2)} Faire partir</button>`);
    if (l.statut === 'en_route') a.push(`<button type="button" class="btn btn-primaire btn-petit" data-livree="${esc(l.id)}">${icone('valide', 16, 2.4)} Marquer livrée</button>`);
    a.push(`<button type="button" class="btn btn-secondaire btn-petit" data-fiche="${esc(l.id)}">Fiche</button>`);
    if (l.vente_id) a.push(`<button type="button" class="btn btn-secondaire btn-petit" data-bon="${esc(l.id)}">${icone('document', 16, 2)} Voir le bon</button>`);
    if (l.statut === 'livree' && l.frais > 0 && !l.frais_payes && gerant) a.push(`<button type="button" class="btn btn-secondaire btn-petit" data-frais="${esc(l.id)}">Frais payés au chauffeur</button>`);
    if (l.statut === 'livree' && l.frais > 0 && l.frais_payes) a.push('<span class="tag-frais-payes">Frais payés</span>');
    if (['a_charger', 'en_route'].includes(l.statut)) a.push(`<button type="button" class="btn-lien btn-lien-danger" data-annuler="${esc(l.id)}">Annuler</button>`);
    return a.join('');
  }

  function renderListe() {
    if (!s.liste.length) {
      zone('liste').innerHTML = `<div class="etat-vide etat-vide-large"><p>Aucune livraison ${s.jour === dateISO() ? 'aujourd’hui' : 'ce jour'}.</p><button type="button" class="btn btn-primaire" data-action="nouvelle">Organiser une livraison</button></div>`;
      return;
    }
    const tries = [...s.liste].sort((a, b) => (ORDRE[a.statut] ?? 9) - (ORDRE[b.statut] ?? 9) || String(a.prevue_le || a.created_at).localeCompare(String(b.prevue_le || b.created_at)));
    const pastille = (l) => `<span class="statut-livraison ${STATUTS[l.statut]?.classe || ''}">${esc(STATUTS[l.statut]?.libelle || l.statut)}</span>`;
    zone('liste').innerHTML = `
      <div class="tableau-cadre seul-ordi"><table class="tableau-livraisons">
        <thead><tr><th>Vente</th><th>Client / adresse</th><th>Véhicule</th><th>Chauffeur</th><th>Quand</th><th>État</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${tries.map((l) => `<tr>
          <td><strong>${esc(numeroVente(l.vente_numero) || l.numero || '—')}</strong><span class="discret lv-ligne">${esc(l.numero || '')}</span></td>
          <td><strong>${esc(l.client_nom || '—')}</strong><span class="discret lv-ligne">${esc([l.adresse, l.repere].filter(Boolean).join(' · '))}</span></td>
          <td>${esc(l.vehicule_nom || '—')}</td>
          <td>${esc(l.chauffeur || '—')}${l.chauffeur_tel ? `<span class="discret lv-ligne">${esc(formatTelephone(l.chauffeur_tel))}</span>` : ''}</td>
          <td class="discret">${esc(quand(l))}</td>
          <td>${pastille(l)}</td>
          <td><div class="actions-livraison">${actionsHTML(l)}</div></td></tr>`).join('')}</tbody>
      </table></div>
      <ul class="cartes-livraisons seul-mobile">${tries.map((l) => `
        <li class="carte-livraison">
          <div class="carte-livraison-haut"><strong>${esc(l.client_nom || '—')}</strong>${pastille(l)}</div>
          <span class="discret">${esc([numeroVente(l.vente_numero), l.numero].filter(Boolean).join(' · '))}</span>
          ${l.adresse || l.repere ? `<span>${esc([l.adresse, l.repere].filter(Boolean).join(' · '))}</span>` : ''}
          <span class="discret">${esc([l.vehicule_nom, l.chauffeur].filter(Boolean).join(' · '))}${l.frais ? ` · ${esc(formatGNF(l.frais))}` : ''}</span>
          <span class="discret">${esc(quand(l))}</span>
          <div class="actions-livraison">${actionsHTML(l)}${l.chauffeur_tel ? `<a class="btn btn-secondaire btn-petit" href="tel:+${esc(normaliserTelephone(l.chauffeur_tel) || '')}">${icone('telephone', 16, 2)} Appeler le chauffeur</a>` : ''}</div>
        </li>`).join('')}</ul>`;
  }

  function renderVehicules() {
    const liste = s.vehicules;
    zone('vehicules').innerHTML = liste.length ? `<ul class="liste-vehicules">${liste.map((v) => `
      <li class="ligne-vehicule ${v.actif === false ? 'inactif' : ''}">
        <span class="vehicule-emoji" aria-hidden="true">${TYPES_VEHICULE[v.type]?.[1] || '🚚'}</span>
        <span class="ae-textes"><strong>${esc(v.nom)}</strong><span class="discret">${esc([v.chauffeur, v.telephone ? formatTelephone(v.telephone) : '', v.immatriculation, v.actif === false ? 'désactivé' : ''].filter(Boolean).join(' · '))}</span></span>
        <strong class="vehicule-frais">${v.frais_voyage ? `${formatNombre(v.frais_voyage)} / voyage` : '—'}</strong>
        ${gerant ? `<button type="button" class="btn-icone btn-icone-clair" data-vehicule="${esc(v.id)}" aria-label="Modifier ${esc(v.nom)}">${icone('crayon', 16, 2)}</button>` : ''}
      </li>`).join('')}</ul>` : `<p class="discret">Aucun véhicule.${gerant ? ' Ajoutez vos camions, tricycles ou motos avec leur chauffeur et le prix du voyage.' : ''}</p>`;
  }

  async function charger() {
    const { data, error } = await sb.rpc('mes_livraisons', { p_boutique: boutique.id, p_statut: null, p_jour: s.jour });
    if (!conteneur.isConnected) return;
    if (error) { zone('liste').innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(error))}</p>`; return; }
    const r = (Array.isArray(data) ? data[0] : data) || {};
    s.vehicules = (r.vehicules || []).map((v) => ({ ...v, actif: v.actif ?? true }));
    if (gerant) {
      // Tous les véhicules (désactivés compris) pour la gestion.
      const v = await sb.from('vehicules').select(COLONNES_VEHICULE).eq('boutique_id', boutique.id).order('nom');
      if (!v.error) s.vehicules = v.data || [];
    }
    s.resume = r.resume || {};
    s.liste = (r.liste || []).map(normaliserLivraison);
    s.charge = true;
    renderResume(); renderListe(); renderVehicules();
  }

  async function action(fn, bouton, message) {
    boutonOccupe(bouton, true, '…');
    const { error } = await fn();
    if (error) { boutonOccupe(bouton, false); toast(messageErreur(error), 'erreur'); return; }
    if (message) toast(message, 'succes');
    charger();
  }

  conteneur.addEventListener('click', async (e) => {
    const b = e.target.closest('button, a');
    if (!b) return;
    if (b.dataset.action === 'nouvelle') { ouvrirOrganiserLivraison({ apres: charger }); return; }
    if (b.dataset.action === 'vehicule') { ouvrirVehicule(null, charger); return; }
    if (b.dataset.vehicule) { ouvrirVehicule(s.vehicules.find((v) => v.id === b.dataset.vehicule), charger); return; }
    const l = s.liste.find((x) => x.id === (b.dataset.partir || b.dataset.livree || b.dataset.bon || b.dataset.frais || b.dataset.annuler || b.dataset.fiche));
    if (!l) return;
    if (b.dataset.fiche) { ouvrirFicheLivraison(l.id); return; }
    if (b.dataset.partir) { fairePartir(l, b); return; }
    if (b.dataset.livree) {
      if (await confirmer(`Marquer la livraison ${l.numero} comme livrée (sans signature du client) ?`, { titre: 'Livraison faite', libelleOk: 'Marquer livrée' })) {
        action(() => sb.rpc('changer_livraison', { p_livraison: l.id, p_statut: 'livree', p_motif: null }), b, `Livraison ${l.numero} livrée.`);
      }
      return;
    }
    if (b.dataset.bon) { ouvrirDocument({ type: 'bon_livraison', vente: l.vente_id, retour: '#/ventes?onglet=livraisons' }); return; }
    if (b.dataset.frais) { action(() => sb.rpc('payer_frais_livraison', { p_livraison: l.id, p_paye: true }), b, `Frais de ${formatGNF(l.frais)} payés au chauffeur.`); return; }
    if (b.dataset.annuler) ouvrirAnnulation(l, charger);
  });
  conteneur.querySelector('[data-ref="jour"]').addEventListener('change', (e) => { s.jour = e.target.value || dateISO(); charger(); });

  /** partir_livraison : SMS au chauffeur (lien) et au client ; le lien s'affiche au cas où le SMS n'arrive pas. */
  async function fairePartir(l, bouton) {
    boutonOccupe(bouton, true, 'Envoi…');
    const { data, error } = await sb.rpc('partir_livraison', { p_livraison: l.id });
    boutonOccupe(bouton, false);
    if (error) { toast(messageErreur(error), 'erreur'); return; }
    // partir_livraison → { lien, chauffeur } : chauffeur = numéro du chauffeur, ou null (lien à copier seulement).
    const r = (Array.isArray(data) ? data[0] : data) || {};
    const telChauffeur = r.chauffeur || null;
    const texte = `Livraison ${l.numero} pour ${l.client_nom || 'le client'}${l.adresse ? ` (${l.adresse})` : ''} : ouvrez ce lien à l’arrivée pour faire signer le client : ${r.lien}`;
    const { el } = ouvrirModale({
      titre: `Livraison ${l.numero} partie`,
      contenu: `
        <p class="texte-modale">${telChauffeur ? `Le lien a été envoyé par SMS au chauffeur (${esc(formatTelephone(telChauffeur))}), et le client est prévenu.` : 'Le chauffeur n’a pas de numéro : copiez le lien et donnez-le-lui.'}</p>
        <div class="lien-chauffeur"><span class="lien-texte">${esc(r.lien || '')}</span></div>
        ${telChauffeur ? '<p class="discret">Si le SMS n’arrive pas, envoyez le lien autrement :</p>' : ''}
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire" data-copier>${icone('copier', 18, 2)} Copier</button>
          ${telChauffeur ? `<a class="btn btn-whatsapp" href="${esc(lienWhatsApp(telChauffeur, texte))}" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} Envoyer sur WhatsApp</a>` : ''}
          <button type="button" class="btn btn-primaire" data-fermer>Terminé</button>
        </div>`
    });
    el.querySelector('[data-copier]').addEventListener('click', async () => toast(await copierTexte(r.lien || '') ? 'Lien copié.' : 'Copie impossible.', 'info'));
    charger();
  }

  charger();
}

/* =========================================================================
   Fiche d'une livraison (bon_livraison) : client, adresse, véhicule, reçu par, signature, photo du bon
   ========================================================================= */

/**
 * bon_livraison(p_livraison) → { numero, vente_id, vente_numero, client, telephone, adresse, repere, contenu, frais,
 * frais_payes, statut, vehicule, vehicule_type, chauffeur, chauffeur_tel, recu_par, signature, photo_path,
 * prevue_le, partie_le, livree_le, note }. La signature ne se lit que par cette fonction.
 */
export async function chargerBonLivraison(idLivraison) {
  const { data, error } = await sb.rpc('bon_livraison', { p_livraison: idLivraison });
  if (error) throw error;
  const b = (Array.isArray(data) ? data[0] : data) || null;
  if (!b) return null;
  const photoUrl = b.photo_path ? await sb.storage.from('bons').createSignedUrl(b.photo_path, 3600).then((x) => x.data?.signedUrl || null, () => null) : null;
  return { ...b, frais: Number(b.frais) || 0, photoUrl };
}

async function ouvrirFicheLivraison(idLivraison) {
  let b;
  try { b = await chargerBonLivraison(idLivraison); } catch (err) { toast(messageErreur(err), 'erreur'); return; }
  if (!b) { toast(messageErreur('LIVRAISON_INTROUVABLE'), 'erreur'); return; }
  const tel = normaliserTelephone(b.telephone || '');
  const info = (libelle, valeur) => (valeur ? `<div class="fiche-info"><dt>${esc(libelle)}</dt><dd>${valeur}</dd></div>` : '');
  const { el } = ouvrirModale({
    titre: `Livraison ${b.numero}`,
    variante: 'large',
    contenu: `
      <div class="fiche-livraison">
        <div class="fiche-livraison-haut"><strong>${esc(b.client || '—')}</strong><span class="statut-livraison ${STATUTS[b.statut]?.classe || ''}">${esc(STATUTS[b.statut]?.libelle || b.statut)}</span></div>
        <div class="actions-livraison">
          ${tel ? `<a class="btn btn-primaire" href="tel:+${esc(tel)}">${icone('telephone', 18, 2)} Appeler le client</a>` : ''}
          ${b.adresse || b.repere ? `<a class="btn btn-secondaire" href="${esc(lienMaps(b))}" target="_blank" rel="noopener">${icone('enLigne', 18, 2)} Ouvrir dans Maps</a>` : ''}
          ${b.vente_id ? `<button type="button" class="btn btn-secondaire" data-bon-fiche>${icone('document', 18, 2)} Voir le bon</button>` : ''}
          ${b.photoUrl ? `<a class="btn btn-secondaire" href="${esc(b.photoUrl)}" target="_blank" rel="noopener">${icone('photo', 18, 2)} Photo du bon</a>` : ''}
        </div>
        <dl class="fiche-infos">
          ${info('Adresse', esc([b.adresse, b.repere].filter(Boolean).join(' · ')))}
          ${info('Téléphone', esc(b.telephone ? formatTelephone(b.telephone) : ''))}
          ${info('Vente', esc(numeroVente(b.vente_numero)))}
          ${info('Contenu', esc(b.contenu || ''))}
          ${info('Véhicule', esc([b.vehicule, b.chauffeur, b.chauffeur_tel ? formatTelephone(b.chauffeur_tel) : ''].filter(Boolean).join(' · ')))}
          ${info('Frais', b.frais ? `${esc(formatGNF(b.frais))}${b.frais_payes ? ' · payés au chauffeur' : ''}` : '')}
          ${info('Prévue', esc(b.prevue_le ? `${formatDate(b.prevue_le, 'court')} ${heure(b.prevue_le)}` : ''))}
          ${info('Partie', esc(b.partie_le ? `${formatDate(b.partie_le, 'court')} ${heure(b.partie_le)}` : ''))}
          ${info('Livrée', esc(b.livree_le ? `${formatDate(b.livree_le, 'court')} ${heure(b.livree_le)}` : ''))}
          ${info('Reçu par', esc(b.recu_par || ''))}
          ${info('Note', esc(b.note || ''))}
        </dl>
        ${b.signature ? `<div class="fiche-livraison-signature"><span class="discret">Signature du client</span><img src="${esc(b.signature)}" alt="Signature du client"></div>` : ''}
      </div>`
  });
  el.querySelector('[data-bon-fiche]')?.addEventListener('click', () => ouvrirDocument({ type: 'bon_livraison', vente: b.vente_id, retour: '#/ventes?onglet=livraisons' }));
}

/* =========================================================================
   Annulation (motif obligatoire)
   ========================================================================= */

function ouvrirAnnulation(l, apres) {
  const { el, fermer } = ouvrirModale({
    titre: `Annuler la livraison ${l.numero}`,
    contenu: `<form class="form-modale" novalidate>
      <div class="champ"><label for="ann-motif">Motif</label><input id="ann-motif" class="input" type="text" maxlength="160" placeholder="Ex. client absent, report à demain" required></div>
      <p class="erreur-form" role="alert" hidden></p>
      <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Retour</button><button type="submit" class="btn btn-danger">Annuler la livraison</button></div>
    </form>`
  });
  const form = el.querySelector('form');
  form.querySelector('#ann-motif').focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const motif = form.querySelector('#ann-motif').value.trim();
    const z = form.querySelector('.erreur-form');
    if (!motif) { z.textContent = messageErreur('MOTIF_REQUIS'); z.hidden = false; return; }
    const bouton = form.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Annulation…');
    const { error } = await sb.rpc('changer_livraison', { p_livraison: l.id, p_statut: 'annulee', p_motif: motif });
    if (error) { boutonOccupe(bouton, false); z.textContent = messageErreur(error); z.hidden = false; return; }
    fermer();
    toast(`Livraison ${l.numero} annulée.`, 'succes');
    apres();
  });
}

/* =========================================================================
   Véhicules (écriture directe, gérant)
   ========================================================================= */

function ouvrirVehicule(v, apres) {
  const creation = !v;
  const x = v || { nom: '', type: 'camion', immatriculation: '', chauffeur: '', telephone: '', frais_voyage: '', capacite: '', actif: true };
  const { el, fermer } = ouvrirModale({
    titre: creation ? 'Ajouter un véhicule' : `Modifier ${x.nom}`,
    contenu: `<form class="form-modale" novalidate>
      <div class="rangee-champs">
        <div class="champ"><label for="veh-nom">Nom</label><input id="veh-nom" class="input" maxlength="60" value="${esc(x.nom)}" placeholder="Ex. Camion 10 tonnes" required></div>
        <div class="champ"><label for="veh-type">Type</label><select id="veh-type" class="input">${Object.entries(TYPES_VEHICULE).map(([c, [l]]) => `<option value="${c}" ${c === x.type ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="rangee-champs">
        <div class="champ"><label for="veh-chauffeur">Chauffeur</label><input id="veh-chauffeur" class="input" maxlength="60" value="${esc(x.chauffeur || '')}" placeholder="Ex. Sékou"></div>
        <div class="champ"><label for="veh-tel">Téléphone du chauffeur</label><input id="veh-tel" class="input" type="tel" inputmode="tel" value="${esc(x.telephone ? formatTelephone(x.telephone) : '')}" placeholder="620 00 00 00"><small class="aide">Le lien de chaque livraison lui est envoyé par SMS.</small></div>
      </div>
      <div class="rangee-champs">
        <div class="champ"><label for="veh-frais">Frais par voyage (GNF)</label><input id="veh-frais" class="input" type="text" inputmode="numeric" value="${x.frais_voyage ? esc(formatNombre(x.frais_voyage)) : ''}" placeholder="Ex. 250 000"></div>
        <div class="champ"><label for="veh-immat">Immatriculation (facultatif)</label><input id="veh-immat" class="input" maxlength="20" value="${esc(x.immatriculation || '')}"></div>
      </div>
      <div class="champ"><label for="veh-capacite">Capacité (facultatif)</label><input id="veh-capacite" class="input" maxlength="40" value="${esc(x.capacite ?? '')}" placeholder="Ex. 10 tonnes"></div>
      ${creation ? '' : `<label class="case-option"><input type="checkbox" id="veh-actif" ${x.actif !== false ? 'checked' : ''}> <span>Véhicule actif (proposé pour les livraisons)</span></label>`}
      <p class="erreur-form" role="alert" hidden></p>
      <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
    </form>`
  });
  const form = el.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const z = form.querySelector('.erreur-form');
    const montrer = (m) => { z.textContent = m; z.hidden = !m; };
    const nom = form.querySelector('#veh-nom').value.trim();
    const telSaisi = form.querySelector('#veh-tel').value.trim();
    const telephone = telSaisi ? normaliserTelephone(telSaisi) : null;
    if (!nom) return montrer('Donnez un nom au véhicule.');
    if (telSaisi && !telephone) return montrer('Numéro de téléphone invalide (ex. 620 00 00 00).');
    const frais = lireNombre(form.querySelector('#veh-frais').value);
    if (frais !== null && frais < 0) return montrer('Frais invalides.');
    const capaciteTexte = form.querySelector('#veh-capacite').value.trim();
    const donnees = {
      nom, type: form.querySelector('#veh-type').value, chauffeur: form.querySelector('#veh-chauffeur').value.trim() || null, telephone,
      frais_voyage: frais === null ? 0 : Math.round(frais), immatriculation: form.querySelector('#veh-immat').value.trim() || null,
      capacite: capaciteTexte || null, actif: creation ? true : form.querySelector('#veh-actif').checked
    };
    const bouton = form.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Enregistrement…');
    const requete = creation ? sb.from('vehicules').insert({ ...donnees, boutique_id: etat.boutique.id }) : sb.from('vehicules').update(donnees).eq('id', v.id);
    const { error } = await requete.select('id').single();
    if (error) { boutonOccupe(bouton, false); montrer(messageErreur(error)); return; }
    fermer();
    toast(creation ? `Véhicule « ${nom} » ajouté.` : 'Véhicule enregistré.', 'succes');
    apres();
  });
}

/* =========================================================================
   « Organiser la livraison » (depuis une vente, une commande en ligne, ou libre)
   ========================================================================= */

/** Résumé du contenu d'une vente : « 20 sacs Ciment, 2 tonnes Fer à béton ». */
async function contenuVente(idVente) {
  const { data } = await sb.from('ventes_lignes').select('nom_produit, unite, quantite').eq('vente_id', idVente);
  return (data || []).map((l) => `${formatQuantite(Number(l.quantite), String(l.unite || '').toLowerCase())} ${l.nom_produit}`).join(', ');
}

/** Véhicules actifs de la boutique (caisse : case « Le client veut être livré »). */
export async function vehiculesActifs() {
  const { data } = await sb.from('vehicules').select(COLONNES_VEHICULE).eq('boutique_id', etat.boutique.id).eq('actif', true).order('nom');
  return data || [];
}

/**
 * Caisse (étape 14) : livraison d'une vente qui vient d'être validée (creer_livraison), puis frais reportés sur la
 * vente (ventes.frais_livraison et total) s'ils n'y sont pas déjà. Lève l'erreur de creer_livraison.
 * Renvoie { livraison, fraisReportes } (fraisReportes : false si la vente n'a pas pu être mise à jour).
 */
export async function creerLivraisonVente({ vente, client = null, adresse, repere = null, vehicule = null, frais = 0, prevue = null }) {
  const contenu = await contenuVente(vente.id).catch(() => '');
  const { data, error } = await sb.rpc('creer_livraison', {
    p_boutique: etat.boutique.id, p_vente: vente.id, p_client: client?.id || null, p_nom: client?.nom || 'Client comptoir',
    p_telephone: client?.telephone || null, p_adresse: adresse, p_repere: repere || null, p_vehicule: vehicule || null,
    p_frais: Math.round(frais) || 0, p_prevue: prevue, p_contenu: contenu || null, p_note: null
  });
  if (error) throw error;
  const livraison = (Array.isArray(data) ? data[0] : data) || {};
  let fraisReportes = true;
  if (frais > 0) {
    const { data: v, error: erreurLecture } = await sb.from('ventes').select('total, frais_livraison').eq('id', vente.id).maybeSingle();
    const deja = Number(v?.frais_livraison) || 0;
    if (erreurLecture || !v) fraisReportes = false;
    else if (deja !== Math.round(frais)) {
      const { error: erreurMaj } = await sb.from('ventes')
        .update({ frais_livraison: Math.round(frais), total: (Number(v.total) || 0) - deja + Math.round(frais) }).eq('id', vente.id);
      fraisReportes = !erreurMaj;
    }
  }
  return { livraison, fraisReportes };
}

/**
 * vente : { id, numero, client_id } (facultatif) ; commande : { nom, telephone, adresse, vente_id } (facultatif).
 * Sans vente : choix dans les ventes du jour, ou livraison libre.
 */
export async function ouvrirOrganiserLivraison({ vente = null, commande = null, apres = () => {} } = {}) {
  const boutique = etat.boutique;
  const [vehiculesRes, ventesRes] = await Promise.all([
    sb.from('vehicules').select(COLONNES_VEHICULE).eq('boutique_id', boutique.id).eq('actif', true).order('nom'),
    vente || commande?.vente_id ? Promise.resolve({ data: [] })
      : sb.from('ventes').select('id, numero, client_id, total, created_at').eq('boutique_id', boutique.id).eq('statut', 'validee').gte('created_at', `${dateISO()}T00:00:00`).order('created_at', { ascending: false }).limit(50)
  ]);
  const vehicules = vehiculesRes.data || [];
  const ventesJour = ventesRes.data || [];
  const s = { vente: vente || (commande?.vente_id ? { id: commande.vente_id } : null), client_id: vente?.client_id || null };

  const { el, fermer } = ouvrirModale({
    titre: 'Organiser la livraison',
    variante: 'large',
    contenu: `<form class="form-modale" novalidate>
      ${vente || commande ? '' : `
        <div class="champ"><label for="liv-vente">Vente</label>
          <select id="liv-vente" class="input"><option value="">Livraison libre (sans vente)</option>
            ${ventesJour.map((v) => `<option value="${esc(v.id)}">${esc(formatNumeroVente(v.numero))} · ${esc(formatGNF(v.total))} · ${esc(formatDate(v.created_at, 'heure'))}</option>`).join('')}
          </select><small class="aide">Ventes du jour. Le client et le contenu se remplissent tout seuls.</small></div>`}
      ${s.vente?.numero ? `<p class="texte-modale">Vente <strong>${esc(formatNumeroVente(s.vente.numero))}</strong></p>` : ''}
      <div class="rangee-champs">
        <div class="champ"><label for="liv-nom">Client</label><input id="liv-nom" class="input" maxlength="100" value="${esc(commande?.nom || '')}" required></div>
        <div class="champ"><label for="liv-tel">Téléphone du client</label><input id="liv-tel" class="input" type="tel" inputmode="tel" value="${esc(commande?.telephone ? formatTelephone(commande.telephone) : '')}" placeholder="620 00 00 00"></div>
      </div>
      <div class="rangee-champs">
        <div class="champ"><label for="liv-adresse">Adresse</label><input id="liv-adresse" class="input" maxlength="200" value="${esc(commande?.adresse || '')}" placeholder="Ex. Kipé, derrière la mosquée" required></div>
        <div class="champ"><label for="liv-repere">Repère (facultatif)</label><input id="liv-repere" class="input" maxlength="200" placeholder="Ex. portail bleu"></div>
      </div>
      <div class="rangee-champs">
        <div class="champ"><label for="liv-vehicule">Véhicule</label>
          <select id="liv-vehicule" class="input"><option value="">Aucun / à choisir</option>
            ${vehicules.map((v) => `<option value="${esc(v.id)}" data-frais="${Number(v.frais_voyage) || 0}">${esc(v.nom)}${v.chauffeur ? ` · ${esc(v.chauffeur)}` : ''}</option>`).join('')}
          </select>${vehicules.length ? '' : '<small class="aide">Ajoutez vos véhicules dans Livraisons › Mes véhicules.</small>'}</div>
        <div class="champ"><label for="liv-frais">Frais de livraison (GNF)</label><input id="liv-frais" class="input" type="text" inputmode="numeric" placeholder="Frais du véhicule"></div>
      </div>
      <div class="champ"><label for="liv-prevue">Prévue le</label><input id="liv-prevue" class="input" type="datetime-local" value="${dansUneHeure()}"></div>
      <div class="champ"><label for="liv-contenu">Contenu</label><textarea id="liv-contenu" class="input" rows="2" maxlength="500" placeholder="Résumé de la vente si vide"></textarea></div>
      <div class="champ"><label for="liv-note">Note pour le chauffeur (facultatif)</label><input id="liv-note" class="input" maxlength="200"></div>
      <p class="erreur-form" role="alert" hidden></p>
      <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Créer la livraison</button></div>
    </form>`
  });
  const form = el.querySelector('form');
  const champ = (id) => form.querySelector(`#${id}`);

  /** Pré-remplissage depuis la vente : client, téléphone, contenu. */
  async function remplirDepuisVente(idVente) {
    if (!idVente) { s.vente = null; s.client_id = null; return; }
    const { data: v } = await sb.from('ventes').select('id, numero, client_id').eq('id', idVente).maybeSingle();
    if (!v) return;
    s.vente = v; s.client_id = v.client_id;
    const [client, contenu] = await Promise.all([
      v.client_id ? sb.from('clients').select('nom, telephone').eq('id', v.client_id).maybeSingle().then((r) => r.data) : null,
      contenuVente(v.id)
    ]);
    if (!form.isConnected) return;
    if (client && !champ('liv-nom').value) champ('liv-nom').value = client.nom;
    if (client?.telephone && !champ('liv-tel').value) champ('liv-tel').value = formatTelephone(client.telephone);
    if (!champ('liv-contenu').value) champ('liv-contenu').value = contenu;
  }
  if (s.vente?.id) remplirDepuisVente(s.vente.id);
  champ('liv-vente')?.addEventListener('change', (e) => remplirDepuisVente(e.target.value));
  champ('liv-vehicule').addEventListener('change', (e) => {
    const frais = e.target.selectedOptions[0]?.dataset.frais;
    champ('liv-frais').placeholder = frais ? `${formatNombre(frais)} (frais du véhicule)` : 'Frais du véhicule';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const z = form.querySelector('.erreur-form');
    const montrer = (m) => { z.textContent = m; z.hidden = !m; };
    const nom = champ('liv-nom').value.trim();
    const telSaisi = champ('liv-tel').value.trim();
    const telephone = telSaisi ? normaliserTelephone(telSaisi) : null;
    const adresse = champ('liv-adresse').value.trim();
    if (!nom) return montrer('Indiquez le client.');
    if (telSaisi && !telephone) return montrer('Numéro du client invalide (ex. 620 00 00 00).');
    if (!adresse) return montrer('Indiquez l’adresse de livraison.');
    const frais = lireNombre(champ('liv-frais').value);
    if (frais !== null && frais < 0) return montrer('Frais invalides.');
    const prevue = champ('liv-prevue').value;
    montrer('');
    const bouton = form.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Création…');
    const { data, error } = await sb.rpc('creer_livraison', {
      p_boutique: boutique.id, p_vente: s.vente?.id || null, p_client: s.client_id, p_nom: nom, p_telephone: telephone,
      p_adresse: adresse, p_repere: champ('liv-repere').value.trim() || null, p_vehicule: champ('liv-vehicule').value || null,
      p_frais: frais === null ? null : Math.round(frais), p_prevue: prevue ? new Date(prevue).toISOString() : null,
      p_contenu: champ('liv-contenu').value.trim() || null, p_note: champ('liv-note').value.trim() || null
    });
    if (error) { boutonOccupe(bouton, false); montrer(messageErreur(error)); return; }
    const r = (Array.isArray(data) ? data[0] : data) || {};
    fermer();
    toast(`Livraison ${r.numero || ''} créée.`, 'succes', 6000, { libelle: 'Voir les livraisons', href: '#/ventes?onglet=livraisons' });
    apres(r);
  });
}
