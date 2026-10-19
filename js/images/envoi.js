/**
 * envoi.js — Envoi des images préparées par l'outil (js/images/outil.js) et mise à jour de la base.
 * Règles : nom de fichier unique (horodatage), cacheControl d'un an, ancien fichier (grand et mini)
 * supprimé à chaque remplacement ; en cas de refus de la base (quota de photos), les fichiers
 * qui viennent d'être envoyés sont retirés.
 * Buckets : « produits » (public : logo, photos, couverture, logos de paiement et partenaires),
 * « documents » (privé : cachet, signature), « bons » (privé, géré par l'écran d'enlèvement).
 */
import { sb } from '../supabase.js';
import { etat } from '../state.js';

const PUBLIC = 'produits';
const UN_AN = '31536000';

/** Chemin dans le bucket public si l'URL vient de ce bucket et de la boutique active (sinon null). */
export function cheminPublic(url, idBoutique = etat.boutique?.id) {
  const m = String(url || '').match(/\/storage\/v1\/object\/public\/produits\/([^?#]+)/);
  if (!m) return null;
  const chemin = decodeURIComponent(m[1]);
  return chemin.startsWith(`${idBoutique}/`) ? chemin : null;
}

const horodatage = () => `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

async function envoyer(bucket, chemin, sortie, { upsert = false, cache = UN_AN } = {}) {
  const { error } = await sb.storage.from(bucket).upload(chemin, sortie.blob, { contentType: sortie.type, upsert, cacheControl: cache });
  if (error) throw error;
  return chemin;
}
const urlPublique = (chemin) => sb.storage.from(PUBLIC).getPublicUrl(chemin).data.publicUrl;

/** Supprime des fichiers publics de la boutique (URL ou chemins) ; échec silencieux (nettoyage hebdomadaire). */
export async function supprimerPublics(...urls) {
  const chemins = urls.flat().map((u) => (String(u || '').startsWith('http') ? cheminPublic(u) : u)).filter(Boolean);
  if (!chemins.length) return;
  const { error } = await sb.storage.from(PUBLIC).remove(chemins);
  if (error) console.warn('[YOUMMA] Ancienne image non supprimée :', error);
}

/** Envoie la grande image (et la miniature) sous <boutique>/<prefixe>-<horodatage>[-mini].<ext>. */
async function envoyerSorties(prefixe, sorties) {
  const base = `${etat.boutique.id}/${prefixe}-${horodatage()}`;
  const chemins = {};
  try {
    for (const [cle, s] of Object.entries(sorties)) {
      chemins[cle] = await envoyer(PUBLIC, `${base}${cle === 'mini' ? '-mini' : ''}.${s.extension}`, s);
    }
  } catch (err) {
    await supprimerPublics(Object.values(chemins));
    throw err;
  }
  return { chemins, urls: Object.fromEntries(Object.entries(chemins).map(([k, c]) => [k, urlPublique(c)])) };
}

/* ------------------------------------------------------------ Logo */

export async function enregistrerLogo(sorties) {
  const { chemins, urls } = await envoyerSorties('logo', sorties);
  const ancien = etat.boutique.logo_url;
  const { error } = await sb.from('boutiques').update({ logo_url: urls.grande }).eq('id', etat.boutique.id);
  if (error) { await supprimerPublics(Object.values(chemins)); throw error; }
  etat.boutique.logo_url = urls.grande;
  if (ancien && ancien !== urls.grande) await supprimerPublics(ancien);
  return { url: urls.grande };
}

export async function retirerLogo() {
  const ancien = etat.boutique.logo_url;
  const { error } = await sb.from('boutiques').update({ logo_url: null }).eq('id', etat.boutique.id);
  if (error) throw error;
  etat.boutique.logo_url = null;
  await supprimerPublics(ancien);
}

/* ------------------------------------------------------------ Photos d'articles (grande + miniature) */

export async function enregistrerPhotoArticle(produit, sorties) {
  const { chemins, urls } = await envoyerSorties(produit.id, sorties);
  const { error } = await sb.from('produits').update({ photo_url: urls.grande, photo_mini_url: urls.mini || null }).eq('id', produit.id);
  if (error) { await supprimerPublics(Object.values(chemins)); throw error; }
  const anciens = [produit.photo_url, produit.photo_mini_url].filter((u) => u && u !== urls.grande && u !== urls.mini);
  await supprimerPublics(anciens);
  return { url: urls.grande, mini: urls.mini || null, taille: sorties.grande.blob.size, tailleMini: sorties.mini?.blob.size || 0 };
}

export async function retirerPhotoArticle(produit) {
  const { error } = await sb.from('produits').update({ photo_url: null, photo_mini_url: null }).eq('id', produit.id);
  if (error) throw error;
  await supprimerPublics(produit.photo_url, produit.photo_mini_url);
}

/** Miniature seule (« Générer les miniatures manquantes ») : la grande photo est gardée. */
export async function enregistrerMiniature(produit, sortie) {
  const { chemins, urls } = await envoyerSorties(produit.id, { mini: sortie });
  const { error } = await sb.from('produits').update({ photo_mini_url: urls.mini }).eq('id', produit.id);
  if (error) { await supprimerPublics(Object.values(chemins)); throw error; }
  if (produit.photo_mini_url && produit.photo_mini_url !== urls.mini) await supprimerPublics(produit.photo_mini_url);
  return urls.mini;
}

/* ------------------------------------------------------------ Couverture de la vitrine */

export async function enregistrerCouverture(sorties, ancien = {}) {
  const { chemins, urls } = await envoyerSorties('couverture', sorties);
  const { error } = await sb.rpc('modifier_couverture', { p_boutique: etat.boutique.id, p_url: urls.grande, p_mini: urls.mini || null });
  if (error) { await supprimerPublics(Object.values(chemins)); throw error; }
  await supprimerPublics(ancien.couverture_url, ancien.couverture_mini);
  return { url: urls.grande, mini: urls.mini };
}

export async function retirerCouverture(ancien = {}) {
  const { error } = await sb.rpc('modifier_couverture', { p_boutique: etat.boutique.id, p_url: null, p_mini: null });
  if (error) throw error;
  await supprimerPublics(ancien.couverture_url, ancien.couverture_mini);
}

/* ------------------------------------------------------------ Logos de paiement et partenaires */

/** Envoie un petit logo (paiement-om-…, paiement-momo-…, partenaire-…) et renvoie son URL publique. */
export async function envoyerLogoAnnexe(prefixe, sorties) {
  const { urls } = await envoyerSorties(prefixe, sorties);
  return urls.grande;
}

/* ------------------------------------------------------------ Cachet et signature (bucket privé) */

export async function envoyerImageDocument(nom, sortie) {
  return envoyer('documents', `${etat.boutique.id}/${nom}.png`, { ...sortie, type: 'image/png' }, { upsert: true, cache: '60' });
}

export async function supprimerImageDocument(chemin) {
  if (!chemin) return;
  const { error } = await sb.storage.from('documents').remove([chemin]);
  if (error) console.warn('[YOUMMA] Image du document non supprimée :', error);
}

/* ------------------------------------------------------------ Quota et espace utilisé */

/** { utilisees, max } (formule de la boutique) ; null si indisponible. */
export async function quotaPhotos(idBoutique = etat.boutique?.id) {
  const { data, error } = await sb.rpc('quota_photos', { p_boutique: idBoutique });
  if (error) return null;
  return (Array.isArray(data) ? data[0] : data) || null;
}

/** Fichiers d'un dossier de bucket (et taille totale), via storage.list. */
export async function listerDossier(bucket, dossier) {
  const fichiers = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await sb.storage.from(bucket).list(dossier, { limit: 1000, offset: page * 1000 });
    if (error) break;
    fichiers.push(...(data || []).filter((f) => f.id || f.metadata));
    if (!data || data.length < 1000) break;
  }
  return { fichiers, octets: fichiers.reduce((t, f) => t + (Number(f.metadata?.size) || 0), 0) };
}
