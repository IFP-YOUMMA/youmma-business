/**
 * images.js — Compression des photos dans le navigateur et envoi dans le bucket public « produits ».
 *
 *  - photos d'articles : 1080 px max, JPEG ~0,8, moins de 300 Ko ;
 *  - logo de la boutique : 512 px max ;
 *  - chemin obligatoire : <boutique_id>/<nom-de-fichier> (règle Storage côté serveur).
 */
import { sb } from './supabase.js';
import { etat } from './state.js';

const BUCKET_PRODUITS = 'produits';

/** Charge une image (avec l'orientation de l'appareil photo si le navigateur la gère). */
export async function chargerImage(fichier) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(fichier, { imageOrientation: 'from-image' }); } catch { /* repli ci-dessous */ }
  }
  const url = URL.createObjectURL(fichier);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Dessine l'image réduite (côté le plus long = cote px) sur fond blanc et l'encode en JPEG. */
export function encoderJpeg(image, cote, qualite) {
  const echelle = Math.min(1, cote / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * echelle));
  canvas.height = Math.max(1, Math.round(image.height * echelle));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF'; // les PNG transparents ne deviennent pas noirs
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resoudre, rejeter) => {
    canvas.toBlob((blob) => (blob ? resoudre(blob) : rejeter(new Error('Compression impossible'))), 'image/jpeg', qualite);
  });
}

/** Essaie [côté, qualité] dans l'ordre jusqu'à passer sous tailleMax octets. */
export async function compresserAvecEssais(fichier, essais, tailleMax) {
  const image = await chargerImage(fichier);
  try {
    let blob = null;
    for (const [cote, qualite] of essais) {
      blob = await encoderJpeg(image, cote, qualite);
      if (blob.size <= tailleMax) break;
    }
    return blob;
  } finally {
    image.close?.();
  }
}

const TAILLE_MAX_ARTICLE = 300 * 1024;
const ESSAIS_ARTICLE = [[1080, 0.8], [1080, 0.7], [1080, 0.6], [900, 0.6], [720, 0.55], [600, 0.5]];
const ESSAIS_LOGO = [[512, 0.85], [512, 0.75], [400, 0.7], [320, 0.65]];

/** Photo d'article : 1080 px max, JPEG ~0,8, < 300 Ko. */
export const compresserPhotoArticle = (fichier) => compresserAvecEssais(fichier, ESSAIS_ARTICLE, TAILLE_MAX_ARTICLE);
/** Logo : 512 px max. */
export const compresserLogo = (fichier) => compresserAvecEssais(fichier, ESSAIS_LOGO, 150 * 1024);

/** Chemin du fichier dans le bucket si l'URL publique vient de ce bucket (sinon null). */
export function cheminDansBucket(url) {
  const m = String(url || '').match(/\/storage\/v1\/object\/public\/produits\/([^?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Envoie une image (JPEG par défaut, PNG pour les photos sans fond) dans le bucket « produits ». */
export async function envoyerImage(nom, blob, contentType = 'image/jpeg') {
  const chemin = `${etat.boutique.id}/${nom}`;
  const { error } = await sb.storage.from(BUCKET_PRODUITS).upload(chemin, blob, { contentType, upsert: true, cacheControl: '31536000' });
  if (error) throw error;
  return sb.storage.from(BUCKET_PRODUITS).getPublicUrl(chemin).data.publicUrl;
}

/** Supprime l'ancienne image si elle était dans le bucket de la boutique (échec silencieux). */
export async function supprimerImage(url) {
  const chemin = cheminDansBucket(url);
  if (!chemin || !chemin.startsWith(`${etat.boutique.id}/`)) return;
  const { error } = await sb.storage.from(BUCKET_PRODUITS).remove([chemin]);
  if (error) console.warn('[YOUMMA] Ancienne photo non supprimée :', error);
}

/**
 * Photo d'un article : compresse, envoie (<boutique>/<produit>-<horodatage>.jpg), met à jour
 * produits.photo_url puis supprime l'ancienne photo. Renvoie { url, taille }.
 */
export async function changerPhotoArticle(produit, fichier) {
  const blob = await compresserPhotoArticle(fichier);
  const url = await envoyerImage(`${produit.id}-${Date.now()}.jpg`, blob);
  const { error } = await sb.from('produits').update({ photo_url: url }).eq('id', produit.id);
  if (error) throw error;
  if (produit.photo_url && produit.photo_url !== url) await supprimerImage(produit.photo_url);
  return { url, taille: blob.size };
}

/**
 * Remplace la photo d'un article par une image déjà prête (JPEG compressé ou PNG sans fond) :
 * <boutique>/<produit>-<horodatage>.<ext>, produits.photo_url, ancienne photo supprimée.
 */
export async function remplacerPhotoArticle(produit, blob, extension = 'jpg') {
  const type = extension === 'png' ? 'image/png' : 'image/jpeg';
  const url = await envoyerImage(`${produit.id}-${Date.now()}.${extension}`, blob, type);
  const { error } = await sb.from('produits').update({ photo_url: url }).eq('id', produit.id);
  if (error) throw error;
  if (produit.photo_url && produit.photo_url !== url) await supprimerImage(produit.photo_url);
  return { url, taille: blob.size };
}

/** Retire la photo d'un article (colonne vidée, fichier supprimé du bucket). */
export async function retirerPhotoArticle(produit) {
  const { error } = await sb.from('produits').update({ photo_url: null }).eq('id', produit.id);
  if (error) throw error;
  await supprimerImage(produit.photo_url);
}

/** Logo de la boutique : <boutique>/logo-<horodatage>.jpg → boutiques.logo_url. */
export async function changerLogo(fichier) {
  const blob = await compresserLogo(fichier);
  const ancien = etat.boutique.logo_url;
  const url = await envoyerImage(`logo-${Date.now()}.jpg`, blob);
  const { error } = await sb.from('boutiques').update({ logo_url: url }).eq('id', etat.boutique.id);
  if (error) throw error;
  etat.boutique.logo_url = url;
  if (ancien && ancien !== url) await supprimerImage(ancien);
  return { url, taille: blob.size };
}

/** Ouvre le sélecteur de fichier (appareil photo proposé sur téléphone) et renvoie le fichier choisi. */
export function choisirImage() {
  return new Promise((resoudre) => {
    const champ = document.createElement('input');
    champ.type = 'file';
    champ.accept = 'image/*';
    champ.addEventListener('change', () => resoudre(champ.files?.[0] || null), { once: true });
    champ.click();
  });
}
