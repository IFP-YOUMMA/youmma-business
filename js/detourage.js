/**
 * detourage.js — « Retirer le fond » d'une photo d'article, dans le navigateur.
 *
 * Le travail est fait par js/detourage-worker.js (onnxruntime-web + U²-Netp), chargé seulement
 * à la demande. L'écran reste utilisable ; « Annuler » arrête le worker immédiatement.
 * Résultat : PNG transparent recadré, 1080 px max, moins de 600 Ko, envoyé dans le bucket
 * « produits » si le boutiquier choisit « Garder sans fond ».
 */
import { ouvrirModale, toast, boutonOccupe, messageErreur, esc } from './utils.js';
import { remplacerPhotoArticle, compresserPhotoArticle } from './images.js';

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

/** Récupère la photo actuelle d'un article (URL publique du bucket). */
async function telechargerPhoto(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw Object.assign(new Error('Photo introuvable'), { code: 'IMAGE_ILLISIBLE' });
  return r.blob();
}

/**
 * Fenêtre « Retirer le fond » d'un article.
 *  - produit : { id, nom, photo_url } ; fichier : nouvelle photo (sinon la photo actuelle) ;
 *  - apres({ url }) : appelé quand une photo a été enregistrée.
 */
export function ouvrirDetourage(produit, { fichier = null, apres = () => {} } = {}) {
  const controle = new AbortController();
  let urlAvant = null;
  let urlApres = null;
  let resultat = null;
  let source = null;
  const { el, fermer } = ouvrirModale({
    titre: 'Retirer le fond',
    variante: 'large',
    onFermer: () => { controle.abort(); if (urlAvant) URL.revokeObjectURL(urlAvant); if (urlApres) URL.revokeObjectURL(urlApres); },
    contenu: `
      <div class="detourage" data-zone="detourage">
        <p class="texte-modale">${esc(produit.nom)} — la photo est traitée sur ce téléphone, rien n’est envoyé avant votre choix.</p>
        <div class="detourage-progres" data-zone="progres">
          <span class="detourage-etape" data-ref="etape">Préparation…</span>
          <div class="barre-progres" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span data-ref="barre"></span></div>
          <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-action="annuler">Annuler</button></div>
        </div>
        <div class="detourage-resultat" data-zone="resultat" hidden>
          <div class="avant-apres">
            <figure><span class="aa-image"><img data-ref="avant" alt="Photo d’origine"></span><figcaption>Avant</figcaption></figure>
            <figure><span class="aa-image damier"><img data-ref="apres" alt="Photo sans fond"></span><figcaption data-ref="legende">Sans fond</figcaption></figure>
          </div>
          <p class="erreur-form" role="alert" hidden></p>
          <div class="modale-actions">
            <button type="button" class="btn btn-secondaire" data-action="originale">Garder l’originale</button>
            <button type="button" class="btn btn-primaire" data-action="sans-fond">Garder sans fond</button>
          </div>
        </div>
      </div>`
  });
  const ref = (n) => el.querySelector(`[data-ref="${n}"]`);

  const echec = (err) => {
    if (!el.isConnected) return;
    toast(messageDetourage(err), err?.name === 'AbortError' ? 'info' : 'erreur', 6000);
    fermer();
  };

  (async () => {
    try {
      source = fichier || (produit.photo_url ? await telechargerPhoto(produit.photo_url) : null);
      if (!source) throw Object.assign(new Error('Aucune photo'), { code: 'IMAGE_ILLISIBLE' });
      urlAvant = URL.createObjectURL(source);
      ref('avant').src = urlAvant;
      resultat = await detourer(source, {
        signal: controle.signal,
        onProgres: ({ etape, valeur, texte }) => {
          const poids = { modele: [0, 0.6], preparation: [0.6, 0.7], analyse: [0.7, 0.9], finition: [0.9, 1] }[etape] || [0, 1];
          const pct = Math.round((poids[0] + (poids[1] - poids[0]) * (valeur || 0)) * 100);
          ref('etape').textContent = texte;
          ref('barre').style.width = `${pct}%`;
          el.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(pct));
        }
      });
      urlApres = URL.createObjectURL(resultat.blob);
      ref('apres').src = urlApres;
      ref('legende').textContent = `Sans fond · ${resultat.largeur}×${resultat.hauteur} · ${Math.round(resultat.blob.size / 1024)} Ko · ${(resultat.ms / 1000).toFixed(1)} s`;
      el.querySelector('[data-zone="progres"]').hidden = true;
      el.querySelector('[data-zone="resultat"]').hidden = false;
    } catch (err) {
      echec(err);
    }
  })();

  el.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'annuler') { controle.abort(); return; }
    const bouton = e.target.closest('button');
    if (action === 'originale') {
      if (!fichier) { fermer(); toast('Photo d’origine gardée.', 'info'); return; }
      boutonOccupe(bouton, true, 'Envoi…');
      try {
        const r = await remplacerPhotoArticle(produit, await compresserPhotoArticle(fichier), 'jpg');
        fermer(); toast('Photo enregistrée.', 'succes'); apres(r);
      } catch (err) { boutonOccupe(bouton, false); toast(messageErreur(err), 'erreur'); }
      return;
    }
    if (action === 'sans-fond') {
      boutonOccupe(bouton, true, 'Envoi…');
      try {
        const r = await remplacerPhotoArticle(produit, resultat.blob, 'png');
        fermer(); toast(`Photo sans fond enregistrée (${Math.round(resultat.blob.size / 1024)} Ko).`, 'succes'); apres(r);
      } catch (err) {
        boutonOccupe(bouton, false);
        const z = el.querySelector('.erreur-form'); z.textContent = messageErreur(err); z.hidden = false;
      }
    }
  });
  return { fermer };
}
