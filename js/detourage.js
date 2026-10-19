/**
 * detourage.js — « Retirer le fond » d'une photo d'article, dans le navigateur.
 *
 * Le travail est fait par js/detourage-worker.js (onnxruntime-web + U²-Netp), chargé seulement
 * à la demande. L'écran reste utilisable ; « Annuler » arrête le worker immédiatement.
 * Utilisé par l’outil d’image (js/images/outil.js, étape « Nettoyer » des photos d’articles) :
 * le résultat (PNG transparent) est ensuite recadré, compressé et envoyé par l’outil.
 */

const ETAPES = {
  modele: 'Téléchargement de l’outil de détourage (4,4 Mo, une seule fois)…',
  preparation: 'Préparation…',
  analyse: 'Analyse de la photo…',
  finition: 'Découpe et finition…'
};

let worker = null;

/** Vrai si le navigateur peut détourer (Worker module, OffscreenCanvas, WebAssembly). */
export function detourageDisponible() {
  return typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && typeof WebAssembly === 'object'
    && typeof createImageBitmap === 'function';
}

function arreterWorker() {
  worker?.terminate();
  worker = null;
}

/**
 * Détoure une image (Blob/File). onProgres({ etape, valeur, texte }) ; signal : AbortSignal.
 * Renvoie { blob, largeur, hauteur, ms }.
 */
export function detourer(source, { onProgres = () => {}, signal } = {}) {
  return new Promise((resoudre, rejeter) => {
    if (!detourageDisponible()) { rejeter(Object.assign(new Error('NON_SUPPORTE'), { code: 'NON_SUPPORTE' })); return; }
    if (signal?.aborted) { rejeter(new DOMException('Annulé', 'AbortError')); return; }
    if (!worker) worker = new Worker(new URL('./detourage-worker.js', import.meta.url), { type: 'module' });
    const w = worker;
    const surAnnulation = () => { arreterWorker(); rejeter(new DOMException('Annulé', 'AbortError')); };
    signal?.addEventListener('abort', surAnnulation, { once: true });
    const finir = () => { signal?.removeEventListener('abort', surAnnulation); w.onmessage = null; w.onerror = null; };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progres') onProgres({ ...m, texte: ETAPES[m.etape] || '' });
      if (m.type === 'fini') { finir(); resoudre(m); }
      if (m.type === 'erreur') { finir(); rejeter(Object.assign(new Error(m.message), { code: m.code })); }
    };
    w.onerror = (e) => { finir(); arreterWorker(); rejeter(Object.assign(new Error(e.message || 'Erreur du détourage'), { code: 'ECHEC' })); };
    createImageBitmap(source, { imageOrientation: 'from-image' })
      .then((image) => w.postMessage({ image }, [image]))
      // DOMException : sa propriété « code » est en lecture seule, on crée donc une nouvelle erreur.
      .catch((err) => { finir(); rejeter(Object.assign(new Error(err?.message || 'Image illisible'), { code: 'IMAGE_ILLISIBLE' })); });
  });
}

export function messageDetourage(err) {
  if (err?.name === 'AbortError') return 'Détourage annulé : la photo d’origine est gardée.';
  if (err?.code === 'NON_SUPPORTE') return 'Ce téléphone ne permet pas de retirer le fond. La photo d’origine est gardée.';
  if (err?.code === 'DETOURAGE_VIDE') return 'Le produit n’a pas été reconnu sur cette photo. Essayez une photo plus nette, sur un fond uni.';
  if (err?.code === 'MODELE_INDISPONIBLE') return 'L’outil de détourage ne se télécharge pas. Vérifiez la connexion puis réessayez.';
  if (err?.code === 'IMAGE_ILLISIBLE') return 'Cette photo ne peut pas être lue. Choisissez-en une autre.';
  if (/memory|allocation|out of bounds/i.test(err?.message || '')) return 'Ce téléphone manque de mémoire pour retirer le fond. La photo d’origine est gardée.';
  return 'Le fond n’a pas pu être retiré. La photo d’origine est gardée.';
}
