/**
 * colis/commun.js — Logistique de colis Dakar ⇄ Guinée (étape 16) : appels à la base, formats, libellés.
 *
 * Toutes les fonctions de la base passent par ici (un seul endroit à ajuster si une signature change).
 * Signatures vérifiées sur la base (noms des paramètres) : tarif_colis, tableau_colis, mes_colis, suivi_interne,
 * changer_statut_colis, retirer_colis, colis_dans_envoi, partir_envoi, arriver_envoi, frais_envoi, detail_envoi,
 * modifier_taux, ouvrir_session_photo, session_photo, deposer_photo_session, suivi_colis, suivi_par_numero.
 * SUPPOSÉES (non vérifiables sans la base) : enregistrer_colis et creer_envoi — voir plus bas.
 *
 * Règles : aucun prix calculé ici (tarif_colis et montants figés dans le colis), jamais de FCFA + GNF additionnés,
 * le jeton du lien de suivi ne vient que de enregistrer_colis ou de suivi_interne.
 */
import { sb } from '../supabase.js';
import { etat } from '../state.js';
import { formatNombre, formatDate, esc } from '../utils.js';

export const premiere = (d) => (Array.isArray(d) ? d[0] : d) ?? null;
/** Première valeur définie parmi plusieurs noms de champ (la réponse de la base peut nommer un peu autrement). */
export const champ = (o, ...cles) => { for (const c of cles) if (o?.[c] !== undefined && o?.[c] !== null) return o[c]; return undefined; };

async function rpc(nom, params) {
  const { data, error } = await sb.rpc(nom, params);
  if (error) throw error;
  return data;
}

/* ------------------------------------------------------------ Appels */

export const api = {
  tableau: () => rpc('tableau_colis', { p_boutique: etat.boutique.id }).then(premiere),
  liste: ({ filtre = null, agence = null, recherche = null, limite = 50 } = {}) =>
    rpc('mes_colis', { p_boutique: etat.boutique.id, p_filtre: filtre, p_agence: agence, p_recherche: recherche || null, p_limite: limite })
      .then((d) => (Array.isArray(d) ? d : champ(d, 'colis', 'lignes') || [])),
  tarif: ({ depart, arrivee, mode, poids, supplements = [] }) =>
    rpc('tarif_colis', { p_boutique: etat.boutique.id, p_depart: depart, p_arrivee: arrivee, p_mode: mode, p_poids: poids, p_supplements: supplements }).then(premiere),
  fiche: (id) => rpc('suivi_interne', { p_colis: id }).then(premiere),
  statut: (id, statut, note = null, lieu = null) => rpc('changer_statut_colis', { p_colis: id, p_statut: statut, p_note: note, p_lieu: lieu }),
  retirer: (id, { recuPar, piece, montant = null, mode = null, signature = null }) =>
    rpc('retirer_colis', { p_colis: id, p_recu_par: recuPar, p_piece: piece, p_montant: montant, p_mode: mode, p_signature: signature }).then(premiere),
  envoi: (id) => rpc('detail_envoi', { p_envoi: id }).then(premiere),
  dansEnvoi: (envoi, ids, retirer = false) => rpc('colis_dans_envoi', { p_envoi: envoi, p_colis: ids, p_retirer: retirer }),
  partir: (envoi) => rpc('partir_envoi', { p_envoi: envoi }).then(premiere),
  arriver: (envoi) => rpc('arriver_envoi', { p_envoi: envoi }).then(premiere),
  frais: (envoi, frais) => rpc('frais_envoi', { p_envoi: envoi, p_frais: frais }),
  taux: (de, vers, taux) => rpc('modifier_taux', { p_boutique: etat.boutique.id, p_de: de, p_vers: vers, p_taux: taux }),
  sessionPhoto: () => rpc('ouvrir_session_photo', { p_boutique: etat.boutique.id }).then(premiere),
  lireSessionPhoto: (jeton) => rpc('session_photo', { p_jeton: jeton }).then(premiere),

  /**
   * SUPPOSÉ : les noms des paramètres de enregistrer_colis ne sont pas lisibles par l'API publique ; ils suivent les
   * colonnes de la table colis (expediteur_nom, destinataire_tel, valeur_declaree, paye, paye_mode…) et tarif_colis
   * (p_depart, p_arrivee, p_mode, p_poids, p_supplements). À ajuster ici si la base les nomme autrement.
   */
  enregistrer: (c) => rpc('enregistrer_colis', {
    p_boutique: etat.boutique.id, p_depart: c.depart, p_arrivee: c.arrivee, p_mode: c.mode,
    p_expediteur_nom: c.expediteurNom, p_expediteur_tel: c.expediteurTel, p_destinataire_nom: c.destinataireNom, p_destinataire_tel: c.destinataireTel,
    p_contenu: c.contenu, p_contenu_douane: c.contenuDouane || null, p_poids: c.poids, p_nb_colis: c.nbColis, p_valeur_declaree: c.valeurDeclaree ?? null,
    p_supplements: c.supplements, p_paye: c.paye, p_paye_mode: c.payeMode || null, p_photo_bascule: c.photoBascule, p_photo_contenu: c.photoContenu
  }).then(premiere),
  /** SUPPOSÉ également (mêmes raisons) : colonnes de la table envois. */
  creerEnvoi: (e) => rpc('creer_envoi', {
    p_boutique: etat.boutique.id, p_depart: e.depart, p_arrivee: e.arrivee, p_mode: e.mode, p_reference: e.reference || null,
    p_transporteur: e.transporteur || null, p_chauffeur: e.chauffeur || null, p_chauffeur_tel: e.chauffeurTel || null,
    p_immatriculation: e.immatriculation || null, p_depart_prevu: e.departPrevu || null, p_arrivee_prevue: e.arriveePrevue || null
  }).then(premiere)
};

/* ------------------------------------------------------------ Bureaux (agences) */

let agencesPromesse = null;
let agencesBoutique = null;
/** Bureaux de la boutique (table agences), en cache le temps de la session. */
export function chargerAgences({ forcer = false } = {}) {
  if (forcer || !agencesPromesse || agencesBoutique !== etat.boutique?.id) {
    agencesBoutique = etat.boutique?.id;
    agencesPromesse = sb.from('agences').select('id, code, nom, ville, pays, drapeau, adresse, telephone, horaires, devise, actif')
      .eq('boutique_id', etat.boutique.id).order('code')
      .then(({ data, error }) => { if (error) throw error; return data || []; })
      .catch((err) => { agencesPromesse = null; throw err; });
  }
  return agencesPromesse;
}
/** Agence par id, par code ou objet déjà complet. */
export function agenceDe(agences, ref) {
  if (!ref) return null;
  if (typeof ref === 'object') return ref.id ? agences.find((a) => a.id === ref.id) || ref : ref;
  return agences.find((a) => a.id === ref || a.code === ref) || null;
}
/** Code pays à 2 lettres (SN, GN) : le drapeau en émoji ne s'affiche pas sur tous les ordinateurs. */
export const codePays = (a) => (a?.pays && String(a.pays).length <= 3 ? String(a.pays).toUpperCase().slice(0, 2) : /s[ée]n[ée]gal/i.test(a?.pays || '') ? 'SN' : /guin/i.test(a?.pays || '') ? 'GN' : (a?.devise === 'XOF' ? 'SN' : 'GN'));

/* ------------------------------------------------------------ Formats */

/** Téléphone lisible selon l'indicatif : « 77 123 45 67 » (Sénégal), « 620 53 82 90 » (Guinée). */
export function formatTel(tel, { indicatif = false } = {}) {
  const c = String(tel || '').replace(/\D/g, '');
  if (!c) return '';
  if (/^221\d{9}$/.test(c) || /^7\d{8}$/.test(c)) {
    const l = c.slice(-9);
    return `${indicatif ? '+221 ' : ''}${l.slice(0, 2)} ${l.slice(2, 5)} ${l.slice(5, 7)} ${l.slice(7)}`;
  }
  if (/^224\d{9}$/.test(c) || /^6\d{8}$/.test(c)) {
    const l = c.slice(-9);
    return `${indicatif ? '+224 ' : ''}${l.slice(0, 3)} ${l.slice(3, 5)} ${l.slice(5, 7)} ${l.slice(7)}`;
  }
  return tel;
}
/** Saisie → chiffres bruts avec indicatif (221… ou 224…), ou null si le numéro n'est ni sénégalais ni guinéen. */
export function normaliserTel(saisie) {
  let c = String(saisie || '').replace(/\D/g, '');
  if (c.startsWith('00')) c = c.slice(2);
  if (/^7[05678]\d{7}$/.test(c)) c = `221${c}`;
  else if (/^6\d{8}$/.test(c)) c = `224${c}`;
  return /^2217[05678]\d{7}$/.test(c) || /^2246\d{8}$/.test(c) ? c : null;
}

export const nomDevise = (devise) => (devise === 'XOF' ? 'FCFA' : devise || '');
/** « 105 200 FCFA » — un montant, une monnaie. Jamais d'addition entre monnaies. */
export const montant = (n, devise) => `${formatNombre(n)} ${nomDevise(devise)}`.trim();
export const montantHTML = (n, devise, classe = 'col-montant') => `<span class="${classe}"><strong>${formatNombre(n)}</strong> <span class="col-devise">${esc(nomDevise(devise))}</span></span>`;
export const poids = (kg) => `${formatNombre(kg, 2)} kg`;
export const numeroSansTirets = (numero) => String(numero || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
export const dateHeure = (d) => (d ? `${formatDate(d, 'court')} · ${formatDate(d, 'heure')}` : '');

/* ------------------------------------------------------------ Statuts */

export const STATUTS = {
  recu: { libelle: 'Reçu', classe: 'gris' },
  entrepot: { libelle: 'En entrepôt', classe: 'gris' },
  charge: { libelle: 'Chargé', classe: 'bleu' },
  en_route: { libelle: 'En route', classe: 'bleu' },
  arrive: { libelle: 'Arrivé', classe: 'vert' },
  a_retirer: { libelle: 'À retirer', classe: 'or' },
  retire: { libelle: 'Retiré', classe: 'vert' },
  probleme: { libelle: 'Problème', classe: 'rouge' },
  annule: { libelle: 'Annulé', classe: 'rouge' }
};
export const pastilleStatut = (statut) => {
  const s = STATUTS[statut] || { libelle: statut || '—', classe: 'gris' };
  return `<span class="col-statut ${s.classe}">${esc(s.libelle)}</span>`;
};
export const MODES = { avion: { libelle: 'Avion', icone: 'avion' }, route: { libelle: 'Route', icone: 'camion' } };
export const MODES_PAIEMENT_COLIS = [['especes', 'Espèces'], ['orange_money', 'Orange Money'], ['wave', 'Wave'], ['mtn_momo', 'MoMo']];

/** Icônes propres au métier (traits 1,7, jamais remplies). */
export function iconeColis(nom, taille = 18) {
  const d = {
    avion: 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z',
    camion: 'M2 6h11v10H2zM13 9h4l4 4v3h-8zM6 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01',
    colis: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
    fleche: 'M4 12h14M13 6l6 6-6 6',
    balance: 'M4 20h16M6 20V9h12v11M9 9V6h6v3',
    photo: 'M4 7h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'
  }[nom] || '';
  return `<svg width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

/** Adresse publique du suivi (le lien renvoyé par la base, sinon reconstruit avec le jeton). */
export function lienSuivi(lien, jeton) {
  if (lien && /^https?:/.test(lien)) return lien;
  const racine = new URL('./', location.href.split('#')[0]).href;
  if (lien) return new URL(String(lien).replace(/^\//, ''), racine).href;
  return jeton ? `${racine}c/${encodeURIComponent(jeton)}` : null;
}
