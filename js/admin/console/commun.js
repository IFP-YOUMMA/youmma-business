/**
 * admin/console/commun.js — Console de direction (étape 19) : ce que voit celui qui regarde, et les outils partagés.
 *
 * Tout part de console_accueil() : { moi: { nom, role, portee, peut_gerer_acces }, espaces: [...] }. La base ne renvoie
 * que les espaces que la personne a le droit de voir : la navigation, les portes et les chiffres sont construits à partir
 * de cette réponse, jamais d'une liste écrite ici. Un espace absent n'a ni porte, ni page, ni appel à la base.
 */
import { sb } from '../../supabase.js';
import { esc, icone, formatNombre, formatGNF, normaliserTelephone } from '../../utils.js';

/** Réponse de console_accueil (chargée au démarrage, rechargée sur l'accueil). */
export const direction = { accueil: null };

export const moi = () => direction.accueil?.moi || {};

/**
 * Marché en veille : clé marche_en_veille de direction_accueil(), lue une fois. Les liens qui mènent au marché naissent
 * cachés (data-lien-marche) et ne s'affichent que sur un « false » explicite : rallumé en base, ils reviennent seuls.
 */
let veille = null;
export function marcheEnVeille() {
  if (!veille) {
    veille = sb.rpc('direction_accueil').then(({ data, error }) => {
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data)?.marche_en_veille !== false;
    }).catch(() => true);
  }
  return veille;
}
export function montrerLiensMarche(racine = document) {
  marcheEnVeille().then((v) => { if (!v) racine.querySelectorAll('[data-lien-marche]').forEach((a) => { a.hidden = false; }); });
}
/** Espaces visibles : les affaires communes d'abord (le marché du monde), puis l'affaire seule (YOUMMA Business). */
export const espaces = () => [...(direction.accueil?.espaces || [])].sort((a, b) => Number(b.commun) - Number(a.commun) || a.ordre - b.ordre);
export const espace = (code) => espaces().find((e) => e.code === code) || null;
export const peutGererAcces = () => Boolean(moi().peut_gerer_acces);
export const estSuperAdmin = () => moi().role === 'super_admin';

/**
 * Montant d'un espace. Les licences se paient en GNF ; les commissions du marché sont dans la monnaie des vendeurs
 * (FCFA pour Dakar et Abidjan). console_accueil et console_boutiques ne disent pas la monnaie : voir le rapport.
 */
export const montantEspace = (e, n) => (e?.facturation === 'licence' ? formatGNF(Number(n) || 0) : `${formatNombre(Number(n) || 0)} FCFA`);
export const montantDevise = (n, devise) => (devise === 'GNF' ? formatGNF(Number(n) || 0) : `${formatNombre(Number(n) || 0)} ${devise === 'XOF' ? 'FCFA' : esc(devise || '')}`);

/** Drapeau renvoyé par la base : l'emoji, affiché comme du texte, jamais en image ; vide : rien. */
export const drapeau = (d) => (d ? `<span class="cs-drapeau">${esc(d)}</span>` : '');

/** Un visage par personne concernée : deux pour une affaire commune, un pour l'affaire seule. */
export const visages = (e) => `<span class="cs-visages" title="${e.commun ? 'Affaire commune' : 'Votre affaire seule'}">${icone('client', 15, 2)}${e.commun ? icone('client', 15, 2) : ''}</span>`;

/** En-tête d'une page de la console, aux couleurs de l'espace. */
export function entete({ titre, sous = '', couleur = '#0A3D33', retour = '#/accueil', badges = '', actions = '' }) {
  return `<header class="cs-entete" style="--cs-couleur:${esc(couleur)}">
    <a class="cs-retour" href="${esc(retour)}" aria-label="Retour">${icone('retour', 20, 2)}</a>
    <div class="cs-entete-titres"><h1>${esc(titre)}</h1>${sous ? `<span>${esc(sous)}</span>` : ''}</div>
    <div class="cs-entete-actions">${badges}${actions}</div>
  </header>`;
}

export const kpi = (libelle, valeur, sous = '', ton = '') => `<div class="carte cs-kpi"><span class="etiquette-carte">${esc(libelle)}</span>
  <strong class="cs-kpi-valeur ${ton}">${valeur}</strong>${sous ? `<span class="cs-kpi-sous ${ton}">${sous}</span>` : ''}</div>`;

/** Erreurs de la console affichées telles qu'elles sont décidées, jamais « une erreur est survenue ». */
const MESSAGES = {
  MODE_INVALIDE: 'Ce mode de paiement n’est pas accepté. Rechargez la page et choisissez-en un dans la liste.',
  COMPTE_INTROUVABLE: 'Cette personne doit d’abord ouvrir l’application une fois avec ce numéro.',
  SUPER_ADMIN_UNIQUE: 'Il ne peut y avoir qu’un seul super administrateur.',
  SUPER_ADMIN_PROTEGE: 'On ne ferme pas l’accès du super administrateur.',
  PAS_SOI_MEME: 'Vous ne pouvez pas fermer votre propre accès.',
  ESPACE_INTERDIT: 'Cet espace ne fait pas partie de vos accès.',
  COMMISSION_REQUISE: 'La commission est obligatoire pour un vendeur du marché : sans elle, il ne rapporte rien.',
  BOUTIQUE_HORS_MARCHE: 'Une boutique de YOUMMA Business ne peut pas être reliée au marché.',
  BOUTIQUE_DEJA_LIEE: 'Cette boutique alimente déjà un autre fournisseur du marché.',
  ACCES_REFUSE: 'Action réservée au super administrateur.'
};
export function erreurConsole(err) {
  const brut = String(err?.message || err || '');
  const code = Object.keys(MESSAGES).find((c) => brut.includes(c));
  return code ? MESSAGES[code] : brut || 'Action impossible.';
}

/** « aujourd’hui », « hier », « il y a 22 jours », « jamais » : le dernier usage de l'application. */
export function dernierUsage(date) {
  if (!date) return 'jamais';
  const j = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (!Number.isFinite(j) || j <= 0) return 'aujourd’hui';
  return j === 1 ? 'hier' : `il y a ${j} jours`;
}

/** Affiches publiées sur 30 jours : rouge sous 10 (il ne publie plus), orange sous 15, vert au-delà. */
export const SEUIL_AFFICHES = 10;
export function etatAffiches(n) {
  const v = Number(n) || 0;
  if (v < SEUIL_AFFICHES) return ['Ne publie plus', 'rouge'];
  if (v < 15) return ['Publie peu', 'orange'];
  return ['Publie bien', 'vert'];
}

/** Formules (nom, prix mensuel) : lues telles quelles, pour la colonne « par mois » des licences. */
let formules = null;
export async function chargerFormulesConsole() {
  if (formules) return formules;
  const { data } = await sb.from('formules').select('code, nom, prix_mois').order('ordre');
  formules = Object.fromEntries((data || []).map((f) => [f.code, f]));
  return formules;
}

/**
 * Numéro saisi → chiffres internationaux (224…, 221…, 225…). Un numéro guinéen sans indicatif est complété ; un numéro
 * étranger doit porter son indicatif (+221, 00225…). Renvoie null si ce n'est pas un numéro.
 */
export function telInternational(saisie) {
  const guineen = normaliserTelephone(saisie);
  if (guineen) return guineen;
  let c = String(saisie || '').trim().replace(/[\s.\-()]/g, '');
  if (c.startsWith('+')) c = c.slice(1);
  else if (c.startsWith('00')) c = c.slice(2);
  return /^[1-9]\d{10,14}$/.test(c) ? c : null;
}

/** « 6 jours », « 3 mois », « expirée ». */
export function finDans(jours) {
  const j = Number(jours);
  if (!Number.isFinite(j)) return '—';
  if (j < 0) return 'expirée';
  if (j < 60) return `${j} jour${j > 1 ? 's' : ''}`;
  if (j > 3650) return 'sans fin';
  return `${Math.round(j / 30)} mois`;
}
