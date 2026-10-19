/**
 * detourage-worker.js — Détourage d'une photo hors du fil principal (Web Worker module).
 *
 * Moteur : onnxruntime-web 1.20.1 (MIT, js/vendor/onnxruntime/), backend WebAssembly, 1 fil.
 * Modèle : U²-Netp (Apache-2.0, models/u2netp.onnx, 4,4 Mo), entrée 1×3×320×320.
 * Le modèle est téléchargé à la première utilisation (progression envoyée à la page),
 * puis gardé dans le cache « yb-detourage-v1 » (jamais dans le pré-cache du service worker).
 *
 * Messages reçus  : { image: ImageBitmap }
 * Messages envoyés : { type: 'progres', etape, valeur 0..1 } · { type: 'fini', blob, largeur, hauteur, ms }
 *                    · { type: 'erreur', code, message }
 */
import * as ort from './vendor/onnxruntime/ort.wasm.min.mjs';

const URL_MODELE = new URL('../models/u2netp.onnx', import.meta.url).href;
const TAILLE_MODELE = 4574861;
const CACHE = 'yb-detourage-v1';
const COTE = 320;
const COTE_MAX = 1080;
const TAILLE_MAX = 600 * 1024;
const MOYENNE = [0.485, 0.456, 0.406];
const ECART = [0.229, 0.224, 0.225];

ort.env.wasm.wasmPaths = new URL('./vendor/onnxruntime/', import.meta.url).href;
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

let session = null;
const envoyer = (m, transfert) => self.postMessage(m, transfert || []);

async function chargerModele() {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch { /* sans cache */ }
  const enCache = cache ? await cache.match(URL_MODELE).catch(() => null) : null;
  if (enCache) {
    envoyer({ type: 'progres', etape: 'modele', valeur: 1 });
    return new Uint8Array(await enCache.arrayBuffer());
  }
  const reponse = await fetch(URL_MODELE);
  if (!reponse.ok) throw Object.assign(new Error(`Modèle indisponible (${reponse.status})`), { code: 'MODELE_INDISPONIBLE' });
  const total = Number(reponse.headers.get('content-length')) || TAILLE_MODELE;
  const lecteur = reponse.body.getReader();
  const morceaux = [];
  let recu = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    morceaux.push(value);
    recu += value.length;
    envoyer({ type: 'progres', etape: 'modele', valeur: Math.min(1, recu / total) });
  }
  const tampon = new Uint8Array(recu);
  let pos = 0;
  for (const m of morceaux) { tampon.set(m, pos); pos += m.length; }
  try { await cache?.put(URL_MODELE, new Response(tampon.slice(), { headers: { 'Content-Type': 'application/octet-stream' } })); } catch { /* quota */ }
  return tampon;
}

/** Image → tenseur 1×3×320×320 normalisé comme à l'entraînement (÷ max, puis moyenne / écart ImageNet). */
function preparer(image) {
  const c = new OffscreenCanvas(COTE, COTE);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, COTE, COTE);
  const px = ctx.getImageData(0, 0, COTE, COTE).data;
  let max = 1;
  for (let i = 0; i < px.length; i += 4) max = Math.max(max, px[i], px[i + 1], px[i + 2]);
  const n = COTE * COTE;
  const donnees = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) donnees[k * n + i] = (px[i * 4 + k] / max - MOYENNE[k]) / ECART[k];
  }
  return new ort.Tensor('float32', donnees, [1, 3, COTE, COTE]);
}

/** Sortie du réseau → masque 320×320 (canal alpha, 0..255), normalisé min-max. */
function masque(sortie) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of sortie) { if (v < min) min = v; if (v > max) max = v; }
  const etendue = max - min || 1;
  const c = new OffscreenCanvas(COTE, COTE);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(COTE, COTE);
  let couverture = 0;
  for (let i = 0; i < sortie.length; i++) {
    const a = Math.round(((sortie[i] - min) / etendue) * 255);
    img.data[i * 4 + 3] = a;
    if (a > 128) couverture++;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, couverture: couverture / sortie.length };
}

async function encoderPng(canvas) {
  return canvas.convertToBlob({ type: 'image/png' });
}

async function detourer(image) {
  const debut = performance.now();
  if (!session) {
    envoyer({ type: 'progres', etape: 'modele', valeur: 0 });
    const modele = await chargerModele();
    envoyer({ type: 'progres', etape: 'preparation', valeur: 0 });
    session = await ort.InferenceSession.create(modele, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  }
  envoyer({ type: 'progres', etape: 'analyse', valeur: 0 });
  const entree = preparer(image);
  const resultats = await session.run({ [session.inputNames[0]]: entree });
  const sortie = resultats[session.outputNames[0]].data;
  const m = masque(sortie);
  if (m.couverture < 0.01 || m.couverture > 0.985) {
    throw Object.assign(new Error('Aucun objet net détecté sur la photo.'), { code: 'DETOURAGE_VIDE' });
  }
  envoyer({ type: 'progres', etape: 'finition', valeur: 0 });

  // Image en taille réelle (1080 px max) + masque agrandi et adouci → PNG transparent.
  const echelle = Math.min(1, COTE_MAX / Math.max(image.width, image.height));
  const L = Math.max(1, Math.round(image.width * echelle));
  const H = Math.max(1, Math.round(image.height * echelle));
  const plein = new OffscreenCanvas(L, H);
  const ctx = plein.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, L, H);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.filter = `blur(${Math.max(0.6, L / 900).toFixed(2)}px)`; // bords adoucis
  ctx.drawImage(m.canvas, 0, 0, L, H);
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';

  // Recadrage au plus près (alpha > 24), marge 2 %.
  const d = ctx.getImageData(0, 0, L, H).data;
  let x0 = L; let y0 = H; let x1 = -1; let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < L; x++) {
      if (d[(y * L + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) throw Object.assign(new Error('Aucun objet net détecté sur la photo.'), { code: 'DETOURAGE_VIDE' });
  const marge = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02);
  x0 = Math.max(0, x0 - marge); y0 = Math.max(0, y0 - marge);
  x1 = Math.min(L - 1, x1 + marge); y1 = Math.min(H - 1, y1 + marge);
  let l = x1 - x0 + 1;
  let h = y1 - y0 + 1;
  let final = new OffscreenCanvas(l, h);
  final.getContext('2d').drawImage(plein, x0, y0, l, h, 0, 0, l, h);
  let blob = await encoderPng(final);
  // Moins de 600 Ko : on réduit la taille si besoin (le PNG ne se compresse pas par « qualité »).
  for (let essai = 0; blob.size > TAILLE_MAX && essai < 6; essai++) {
    const f = Math.sqrt(TAILLE_MAX / blob.size) * 0.95;
    const nl = Math.max(1, Math.round(l * f));
    const nh = Math.max(1, Math.round(h * f));
    const reduit = new OffscreenCanvas(nl, nh);
    const rc = reduit.getContext('2d');
    rc.imageSmoothingQuality = 'high';
    rc.drawImage(final, 0, 0, nl, nh);
    final = reduit; l = nl; h = nh;
    blob = await encoderPng(final);
  }
  return { blob, largeur: l, hauteur: h, ms: Math.round(performance.now() - debut) };
}

self.onmessage = async (e) => {
  const { image } = e.data || {};
  try {
    if (!image) throw Object.assign(new Error('Image manquante'), { code: 'IMAGE_MANQUANTE' });
    const r = await detourer(image);
    image.close?.();
    envoyer({ type: 'fini', ...r });
  } catch (err) {
    envoyer({ type: 'erreur', code: err?.code || 'ECHEC', message: String(err?.message || err) });
  }
};
