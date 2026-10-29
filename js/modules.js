/**
 * modules.js — Modules de la boutique selon son activité (étape 11). Seule source de vérité : la RPC
 * mes_modules(p_boutique) → { activite: { code, nom, emoji, couleur, unites, vocab }, formule, actifs, lecture_seule, modules }.
 *
 *  - gardé en mémoire et dans le navigateur (par boutique) pour démarrer hors ligne ; sans réseau ni copie : socle seul ;
 *  - rechargé au choix de la boutique, au retour au premier plan, après choisir_module / changer_activite et
 *    dès qu'une action est refusée avec MODULE_INACTIF ;
 *  - l'événement « modules:change » (sur window) permet à chaque écran de se redessiner.
 * La base refuse elle-même les opérations d'un module inactif : l'interface ne fait que masquer.
 */
import { sb } from './supabase.js';
import { lireStockage, ecrireStockage } from './utils.js';

/** Toujours présents, quelle que soit l'activité ou la formule. */
export const SOCLE = ['tableau_de_bord', 'caisse', 'stock', 'ventes', 'clients', 'depenses', 'rapports', 'vendeurs', 'documents', 'parametres'];

/**
 * Activité « logistique » (étape 16 : envoi de colis Dakar ⇄ Guinée) : la base met à 0 ventes, stock, clients et
 * documents ; ces écrans du socle disparaissent donc pour elle (l'accueil devient « Colis »).
 */
const MASQUES_LOGISTIQUE = ['tableau_de_bord', 'caisse', 'ventes', 'stock', 'clients', 'documents', 'rapports'];
export const estLogistique = () => courant.donnees?.activite?.code === 'logistique';

/** Écrans (routes) qui appartiennent à un module. */
export const MODULE_DE_ROUTE = {
  aujourdhui: 'tableau_de_bord',
  caisse: 'caisse',
  ventes: 'ventes',
  stock: 'stock',
  clients: 'clients',
  rapports: 'rapports',
  colis: 'colis',
  'nouveau-colis': 'colis',
  envois: 'envois',
  transit: 'colis',
  recevoir: 'colis',
  peser: 'colis',
  comptes: 'colis',
  chantiers: 'chantiers',
  proformas: 'devis',
  devis: 'devis',
  messages: 'messages',
  'boutique-en-ligne': 'boutique_en_ligne'
};

/** Modules dont les écrans restent consultables en lecture seule (encaisser, consulter). */
const ROUTES_LECTURE = ['chantiers'];

const VOCAB_DEFAUT = { article: 'Article', articles: 'Articles', menu: 'Stock', sans_stock: false };
const cle = (id) => `yb_modules_${id}`;

let courant = { boutique: null, donnees: null };
let enCours = null;
let dernierChargement = 0;

function normaliser(r) {
  const d = (Array.isArray(r) ? r[0] : r) || {};
  return {
    activite: d.activite || null,
    formule: d.formule || null,
    actifs: Array.isArray(d.actifs) ? d.actifs : [],
    lecture_seule: Array.isArray(d.lecture_seule) ? d.lecture_seule : [],
    modules: Array.isArray(d.modules) ? d.modules : [],
    // Étape 14 : vrai si le membre connecté est le propriétaire (bénéfice, marge et valeur du stock).
    proprietaire: typeof d.proprietaire === 'boolean' ? d.proprietaire : null
  };
}

function signaler() {
  window.dispatchEvent(new CustomEvent('modules:change', { detail: courant.donnees }));
}

/** Installe un résultat de mes_modules (aussi renvoyé par choisir_module et changer_activite). */
export function appliquerModules(idBoutique, resultat, { annoncer = true } = {}) {
  const donnees = normaliser(resultat);
  const avant = JSON.stringify(courant.boutique === idBoutique ? courant.donnees : null);
  courant = { boutique: idBoutique, donnees };
  ecrireStockage(cle(idBoutique), donnees);
  if (annoncer && avant !== JSON.stringify(donnees)) signaler();
  return donnees;
}

/**
 * Charge les modules de la boutique (réseau, sinon copie locale, sinon socle seul).
 * Renvoie les données ; deux appels simultanés partagent la même requête.
 */
export async function chargerModules(idBoutique, { annoncer = true } = {}) {
  if (!idBoutique) return null;
  if (courant.boutique !== idBoutique) {
    // Copie locale d'abord : le menu s'affiche tout de suite (et hors ligne).
    const copie = lireStockage(cle(idBoutique));
    courant = { boutique: idBoutique, donnees: copie ? normaliser(copie) : null };
  }
  if (enCours?.boutique === idBoutique) return enCours.promesse;
  const promesse = (async () => {
    try {
      const { data, error } = await sb.rpc('mes_modules', { p_boutique: idBoutique });
      if (error) throw error;
      dernierChargement = Date.now();
      return appliquerModules(idBoutique, data, { annoncer });
    } catch (err) {
      console.warn('[YOUMMA] Modules non rechargés :', err?.message || err);
      // Ni réseau ni copie : socle seul (les écrans des modules restent masqués jusqu'au prochain chargement).
      if (!courant.donnees) courant.donnees = normaliser({});
      return courant.donnees;
    } finally {
      enCours = null;
    }
  })();
  enCours = { boutique: idBoutique, promesse };
  return promesse;
}

export const modulesCharges = () => Boolean(courant.donnees);
/** Vrai si les modules de cette boutique sont connus (copie locale ou réseau). */
export const modulesPour = (idBoutique) => courant.boutique === idBoutique && Boolean(courant.donnees);
export const donneesModules = () => courant.donnees;

/** Propriétaire selon la base (null si la réponse ne le dit pas : l'appelant se rabat sur le rôle). */
export const proprietaireSelonModules = () => (typeof courant.donnees?.proprietaire === 'boolean' ? courant.donnees.proprietaire : null);

/** Vrai si le module est disponible (socle ou actif). */
export function aModule(code) {
  if (SOCLE.includes(code)) return !(estLogistique() && MASQUES_LOGISTIQUE.includes(code)) || Boolean(courant.donnees?.actifs?.includes(code));
  return Boolean(courant.donnees?.actifs?.includes(code));
}

/** Module plus actif mais avec des opérations en cours : consulter et encaisser seulement. */
export function enLectureSeule(code) {
  return !aModule(code) && Boolean(courant.donnees?.lecture_seule?.includes(code));
}

/** Visible (actif ou en lecture seule). */
export const moduleVisible = (code) => aModule(code) || enLectureSeule(code);

/** actif · inactif · formule · option · bloque · bientot (ou 'socle'). « option » : option payante non payée (étape 14b). */
export function etatModule(code) {
  if (SOCLE.includes(code)) return 'socle';
  return courant.donnees?.modules?.find((m) => m.code === code)?.etat || (aModule(code) ? 'actif' : 'inactif');
}

/** Données d'un module (option_payante, prix_mois, incluse_formules, depend_de, option_fin…) ou null. */
export function infoModule(code) {
  return courant.donnees?.modules?.find((m) => m.code === code) || null;
}

/** Formule de la boutique selon mes_modules (essai, essentiel, pro, premium). */
export const formuleModules = () => courant.donnees?.formule || null;

/** Option payante pas encore payée : l'écran affiche la page d'activation au lieu de refuser. */
export const enOption = (code) => etatModule(code) === 'option';

export function activite() {
  return courant.donnees?.activite || null;
}

/** Vocabulaire de l'activité : vocab('articles') → « Modèles ». */
export function vocab(cleVocab) {
  const v = courant.donnees?.activite?.vocab || {};
  return v[cleVocab] ?? VOCAB_DEFAUT[cleVocab];
}

/** Unités proposées pour l'activité (sinon null : l'écran garde sa liste habituelle). */
export function unites() {
  const u = courant.donnees?.activite?.unites;
  return Array.isArray(u) && u.length ? u : null;
}

/** Module requis par une route (ou null) ; accès : 'ok' | 'lecture' | 'option' (page d'activation) | 'refuse'. */
export function accesRoute(route) {
  const code = MODULE_DE_ROUTE[route];
  if (!code) return 'ok';
  if (aModule(code)) return 'ok';
  if (enOption(code)) return 'option';
  if (ROUTES_LECTURE.includes(route) && enLectureSeule(code)) return 'lecture';
  return 'refuse';
}

/* Rechargements automatiques : retour au premier plan, refus MODULE_INACTIF d'une action. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && courant.boutique && Date.now() - dernierChargement > 30000) chargerModules(courant.boutique);
});
window.addEventListener('yb:module-inactif', () => { if (courant.boutique) chargerModules(courant.boutique); });

const FEMININS = ['prestation', 'référence', 'reference', 'pièce', 'piece', 'formule', 'marchandise', 'boisson'];
/** « un modèle », « une prestation » : vocabulaire précédé du bon article (minuscules). */
export function unArticle(cleVocab = 'article') {
  const mot = String(vocab(cleVocab) || '').toLowerCase();
  return `${FEMININS.some((f) => mot.startsWith(f)) ? 'une' : 'un'} ${mot}`;
}
