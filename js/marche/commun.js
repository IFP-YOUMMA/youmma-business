/**
 * marche/commun.js — Le marché du monde, côté bureau (étape 21) : appels, statuts, formats.
 *
 * Un client de Conakry achète chez un vendeur de Dakar, verse tout au bureau de Conakry ; YOUMMA paie le vendeur à
 * Dakar, récupère la marchandise et l'expédie comme un colis ordinaire ; le transport se paie au retrait, après pesée.
 * Tous les montants viennent de la base, chacun dans sa monnaie : rien n'est recalculé ici, aucune commission non plus.
 */
import { sb } from '../supabase.js';
import { etat } from '../state.js';
import { esc, formatNombre, messageErreur } from '../utils.js';
import { codeDuDrapeau } from '../lib/drapeaux.js';

export const premiere = (d) => (Array.isArray(d) ? d[0] : d) ?? null;

async function rpc(nom, params) {
  const { data, error } = await sb.rpc(nom, params);
  if (error) throw error;
  return data;
}

/** Boutique du marché : la boutique active (bureau) ou celle passée par la porte verte de la direction. */
export const boutiqueId = () => etat.boutique?.id;

export const api = {
  tableau: () => rpc('tableau_marche', { p_boutique: boutiqueId() }).then(premiere),
  liste: ({ filtre = null, recherche = null, limite = 100 } = {}) =>
    rpc('commandes_marche_liste', { p_boutique: boutiqueId(), p_filtre: filtre, p_recherche: recherche || null, p_limite: limite }).then((d) => d || []),
  /** Détail d'une commande par son jeton (un membre de la boutique y voit commission et a_reverser). */
  commande: (jeton) => rpc('commande_marche', { p_jeton: jeton }).then(premiere),
  encaisser: (commande, mode, montant, compte = null) =>
    rpc('encaisser_commande_marche', { p_commande: commande, p_mode: mode, p_montant: montant, p_compte: compte }).then(premiere),
  payerLigne: (ligne, mode, recue) => rpc('payer_ligne_marche', { p_ligne: ligne, p_mode: mode, p_recue: recue }).then(premiere),
  reglerFournisseur: (fournisseur, mode, recue) => rpc('regler_fournisseur', { p_fournisseur: fournisseur, p_mode: mode, p_recue: recue }).then(premiere),
  expedier: (c) => rpc('expedier_commande_marche', {
    p_commande: c.commande, p_depart: c.depart, p_mode: c.mode, p_poids: c.poids, p_longueur: c.longueur, p_largeur: c.largeur,
    p_hauteur: c.hauteur, p_nb: c.nb, p_photo_bascule: c.photoBascule, p_photo_contenu: c.photoContenu
  }).then(premiere),
  litige: (commande, motif, annuler) => rpc('litige_commande_marche', { p_commande: commande, p_motif: motif, p_annuler: annuler }).then(premiere)
};

/** Messages d'erreur du marché, en clair pour le bureau (sinon le message général de l'appli). */
const ERREURS = {
  MODE_INVALIDE: 'Ce mode de paiement n’est pas accepté. Choisissez-en un dans la liste.',
  DEJA_VERSEE: 'Ce versement est déjà enregistré.',
  DEJA_PAYEE: 'Cette ligne est déjà payée au fournisseur.',
  NON_VERSEE: 'Le client n’a pas encore versé : encaissez d’abord.',
  LIGNES_NON_PAYEES: 'Tous les fournisseurs doivent être payés avant d’expédier.',
  MONTANT_INVALIDE: 'Le montant ne correspond pas à ce que le client doit verser.'
};
export function erreurMarche(err) {
  const brut = String(err?.message || err || '');
  const code = Object.keys(ERREURS).find((c) => brut.includes(c));
  return code ? ERREURS[code] : messageErreur(err);
}

/** Onglets du bureau = filtres de commandes_marche_liste (null : toutes). */
export const FILTRES = [
  [null, 'Toutes'],
  ['a_verser', 'À verser'],
  ['a_payer', 'Fournisseur à payer'],
  ['a_expedier', 'À expédier'],
  ['en_cours', 'En cours'],
  ['litige', 'Litiges']
];

/**
 * Libellé et couleur d'un statut de commande. Les codes connus viennent des réponses de la base ; un code inconnu
 * s'affiche tel qu'il arrive, lisible, en gris (rien n'est inventé).
 */
const STATUTS = {
  a_verser: ['À verser', 'orange'],
  versee: ['Fournisseur à payer', 'orange'],
  a_payer: ['Fournisseur à payer', 'orange'],
  payee: ['Fournisseur payé', 'vert'],
  fournisseur_paye: ['Fournisseur payé', 'vert'],
  a_expedier: ['À expédier', 'vert'],
  expediee: ['Au bureau de Dakar', 'bleu'],
  en_route: ['En route', 'bleu'],
  a_retirer: ['À retirer', 'vert'],
  retiree: ['Retirée', 'gris'],
  litige: ['Litige', 'rouge'],
  annulee: ['Annulée', 'gris']
};
export function statut(code) {
  const s = STATUTS[code];
  if (s) return s;
  const lisible = String(code || '—').replace(/_/g, ' ');
  return [lisible.charAt(0).toUpperCase() + lisible.slice(1), 'gris'];
}
export const pastilleStatut = (code) => { const [l, c] = statut(code); return `<span class="mc-statut ${c}">${esc(l)}</span>`; };

export const nomDevise = (d) => (d === 'XOF' ? 'FCFA' : d || '');
/** Montant tel que la base l'a donné, dans sa monnaie : « 797 500 GNF », « 55 000 FCFA ». */
export const montant = (n, devise) => `${formatNombre(Number(n) || 0)} ${nomDevise(devise)}`.trim();

/** Pays d'un vendeur à partir du drapeau renvoyé par la base (🇸🇳 → SN), pour modes_de_paiement('fournisseur', pays). */
export const paysDuDrapeau = (drapeau) => codeDuDrapeau(drapeau) || null;
/** Pays de la caisse à partir de sa monnaie, quand elle est propre à un seul pays (GNF → GN) ; sinon aucun. */
export const paysDeLaCaisse = (devise) => ({ GNF: 'GN' }[devise] || null);

/** Lien public de suivi d'une commande (page a/, sans compte). */
export function lienSuivi(jeton) {
  if (!jeton) return null;
  const base = location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, '');
  return `${base}a/?c=${encodeURIComponent(jeton)}`;
}
