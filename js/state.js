/**
 * state.js — État partagé de l'application : session, boutiques de l'utilisateur,
 * boutique active, membre courant (rôle) et calcul de la licence.
 */
import { sb } from './supabase.js';
import { lireStockage, ecrireStockage, ecartJours, capitaliser } from './utils.js';

const CLE_BOUTIQUE_ACTIVE = 'yb_boutique_active';
export const COLONNES_BOUTIQUE = 'id, nom, type_activite, ville, commune, telephone, logo_url, licence_formule, licence_fin, modules, compteur_ventes, message_recu, created_at';

/** État global (une seule instance). */
export const etat = {
  session: null,
  /** Administrateur de la plateforme YOUMMA (vérifié une fois après connexion). */
  adminPlateforme: false,
  /** [{ boutique, membre }] */
  boutiques: [],
  boutique: null,
  membre: null,
  /** État de la licence de la boutique active (RPC etat_licence) : { formule, fin, jours_restants, etat, … }. */
  licence: null,
  /** État de la plateforme (RPC etat_plateforme) : { maintenance, message, support_whatsapp }. */
  plateforme: null
};

/** Utilisateur Supabase connecté (ou null). */
export function utilisateur() {
  return etat.session?.user ?? null;
}

/** Récupère la session enregistrée par Supabase dans le navigateur. */
export async function chargerSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  etat.session = data.session;
  return etat.session;
}

/** Charge les boutiques dont l'utilisateur est membre actif, puis réactive la dernière utilisée. */
export async function chargerBoutiques() {
  etat.boutiques = [];
  etat.boutique = null;
  etat.membre = null;
  const uid = utilisateur()?.id;
  if (!uid) return etat.boutiques;
  etat.adminPlateforme = await verifierAdminPlateforme();

  const { data: membres, error } = await sb
    .from('membres')
    .select('id, boutique_id, role, nom, telephone, actif')
    .eq('user_id', uid)
    .eq('actif', true);
  if (error) throw error;
  if (!membres.length) return etat.boutiques;

  const { data: boutiques, error: erreurBoutiques } = await sb
    .from('boutiques')
    .select(COLONNES_BOUTIQUE)
    .in('id', membres.map((m) => m.boutique_id))
    .order('created_at');
  if (erreurBoutiques) throw erreurBoutiques;

  etat.boutiques = boutiques.map((b) => ({ boutique: b, membre: membres.find((m) => m.boutique_id === b.id) }));
  if (etat.boutiques.length) {
    const memorisee = lireStockage(CLE_BOUTIQUE_ACTIVE);
    const existe = etat.boutiques.some((x) => x.boutique.id === memorisee);
    choisirBoutique(existe ? memorisee : etat.boutiques[0].boutique.id);
  }
  return etat.boutiques;
}

/** Vrai si l'utilisateur connecté est administrateur de la plateforme YOUMMA (faux en cas d'erreur). */
async function verifierAdminPlateforme() {
  try {
    const { data, error } = await sb.rpc('est_admin_plateforme');
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Active une boutique (et mémorise le choix). Renvoie false si l'id est inconnu. */
export function choisirBoutique(id) {
  const entree = etat.boutiques.find((x) => x.boutique.id === id);
  if (!entree) return false;
  etat.boutique = entree.boutique;
  etat.membre = entree.membre;
  etat.licence = null;
  ecrireStockage(CLE_BOUTIQUE_ACTIVE, id);
  return true;
}

/** Réinitialise l'état (déconnexion). */
export function viderEtat() {
  etat.session = null;
  etat.adminPlateforme = false;
  etat.licence = null;
  etat.boutiques = [];
  etat.boutique = null;
  etat.membre = null;
}

/** Vrai si le membre courant peut gérer le stock et les articles (propriétaire ou gérant). */
/* ------------------------------------------------------------ Droits par rôle */

const RESPONSABLES = ['proprietaire', 'gerant'];

/**
 * Qui peut faire quoi. Seule source de vérité côté interface : utiliser peut('…') partout.
 * (La sécurité réelle reste assurée par la RLS et les fonctions serveur.)
 */
const DROITS = {
  voir_chiffres_globaux: RESPONSABLES, // tableau de bord complet (CA, stock, crédits globaux)
  voir_toutes_ventes: RESPONSABLES,    // sinon : uniquement ses propres ventes
  voir_prix_achat: RESPONSABLES,
  gerer_stock: RESPONSABLES,           // ajouter / modifier / entrée / inventaire
  annuler_vente: RESPONSABLES,
  supprimer_depense: RESPONSABLES,
  rapports: RESPONSABLES,
  equipe: RESPONSABLES,                // inviter, désactiver / réactiver un vendeur
  nommer_gerant: ['proprietaire'],
  parametres_boutique: RESPONSABLES,   // « Ma boutique » et « Mes boutiques »
  ouvrir_boutique: ['proprietaire'],
  // Chantiers : tout le monde ouvre un chantier, fait des enlèvements et des versements, imprime.
  annuler_versement: RESPONSABLES,
  cloturer_chantier: RESPONSABLES,     // clôturer et rouvrir
  modifier_chantier: RESPONSABLES,
  // Messages SMS, campagnes, fournisseurs.
  'messages.voir': RESPONSABLES,
  'messages.modifier': RESPONSABLES,
  'campagnes.envoyer': RESPONSABLES,
  'fournisseurs.gerer': RESPONSABLES,
  'clients.relancer': ['proprietaire', 'gerant', 'vendeur'], // le serveur limite à 1 relance par jour et par client
  // Boutique en ligne, commandes, promos, photos, affiche du jour.
  'commandes.voir': ['proprietaire', 'gerant', 'vendeur'],
  'commandes.traiter': ['proprietaire', 'gerant', 'vendeur'], // confirmer, prête, livrer, refuser une nouvelle
  'commandes.annuler': RESPONSABLES,                           // annuler après confirmation
  'boutique_en_ligne.gerer': RESPONSABLES,
  'articles.photo': RESPONSABLES,
  'articles.promo': RESPONSABLES,
  'affiche.modifier': RESPONSABLES,
  'affiche.partager': ['proprietaire', 'gerant', 'vendeur'],
  // Documents A4 (facture, reçu, bon de livraison), devis et réglages des documents.
  'documents.imprimer': ['proprietaire', 'gerant', 'vendeur'],
  'devis.creer': ['proprietaire', 'gerant', 'vendeur'],
  'devis.statut': ['proprietaire', 'gerant', 'vendeur'],
  'documents.reglages': RESPONSABLES
};

/** Vrai si le membre courant a le droit demandé dans la boutique active. */
export function peut(action) {
  return (DROITS[action] || []).includes(etat.membre?.role);
}

/** Gérant ou propriétaire de la boutique active. */
export function estGerant() {
  return RESPONSABLES.includes(etat.membre?.role);
}

export function estProprietaire() {
  return etat.membre?.role === 'proprietaire';
}

export const LIBELLES_ROLES = { proprietaire: 'Propriétaire', gerant: 'Gérant', vendeur: 'Vendeur' };

const FORMULES = { essai: 'Essai', essentiel: 'Essentiel', pro: 'Pro', premium: 'Premium' };
/** Durée de référence de chaque formule (pour la barre de progression). */
const DUREES_JOURS = { essai: 14 };
const DUREE_PAR_DEFAUT = 30;

/**
 * Informations de licence d'une boutique :
 * { formule, fin, joursRestants, expiree, progression (0 → 1) }.
 */
export function infosLicence(boutique = etat.boutique) {
  const code = String(boutique?.licence_formule || 'essai').toLowerCase();
  const formule = FORMULES[code] || capitaliser(code);
  const fin = boutique?.licence_fin || null;
  if (!fin) return { formule, fin: null, joursRestants: null, expiree: false, progression: 0 };

  // licence_fin peut être une date (AAAA-MM-JJ, valable toute la journée) ou un horodatage précis.
  const ecart = ecartJours(fin);
  const expiree = String(fin).length <= 10 ? ecart < 0 : new Date(fin).getTime() < Date.now();
  const joursRestants = expiree ? 0 : Math.max(0, ecart);
  const duree = DUREES_JOURS[code] || DUREE_PAR_DEFAUT;
  return { formule, fin, joursRestants, expiree, progression: Math.min(1, Math.max(0, joursRestants / duree)) };
}

/** Vrai si la licence de la boutique active a expiré. */
export function licenceExpiree() {
  // État serveur (délai de grâce, suspension) s'il est connu ; sinon la date de fin.
  if (etat.licence?.etat) return etat.licence.etat === 'lecture_seule' || etat.licence.etat === 'suspendue';
  return infosLicence().expiree;
}
