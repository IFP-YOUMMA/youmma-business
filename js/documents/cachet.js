/**
 * cachet.js — Cachet (photo du tampon) et signature (tracé au doigt / à la souris, ou photo) des documents.
 * Tout se fait dans le navigateur : retrait du fond clair (seuil de luminosité réglable), recadrage
 * automatique sur le dessin, PNG transparent de moins de 300 Ko, envoi dans le bucket privé « documents »
 * (<boutique_id>/cachet.png ou signature.png).
 */
import { sb } from '../supabase.js';
import { etat } from '../state.js';
import { icone, ouvrirModale, boutonOccupe, messageErreur, toast } from '../utils.js';
import { chargerImage, choisirImage } from '../images.js';

const TAILLE_MAX = 300 * 1024;
const COTE_TRAVAIL = 900;

/**
 * Rend transparent tout ce qui est plus clair que le seuil (0-255), avec un fondu de 24 niveaux pour garder
 * des bords propres, puis recadre sur le dessin (marge 6 px). Renvoie un canvas (ou null si tout est blanc).
 */
export function retirerFond(source, seuil = 200) {
  const echelle = Math.min(1, COTE_TRAVAIL / Math.max(source.width, source.height));
  const l = Math.max(1, Math.round(source.width * echelle));
  const h = Math.max(1, Math.round(source.height * echelle));
  const c = document.createElement('canvas');
  c.width = l; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, l, h);
  const img = ctx.getImageData(0, 0, l, h);
  const d = img.data;
  const fondu = 24;
  let x0 = l, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const i = (y * l + x) * 4;
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let alpha = lum >= seuil ? 0 : lum <= seuil - fondu ? 255 : Math.round(((seuil - lum) / fondu) * 255);
      alpha = Math.min(alpha, d[i + 3]);
      d[i + 3] = alpha;
      if (alpha > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return null;
  ctx.putImageData(img, 0, 0);
  const m = 6;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(l - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
  const sortie = document.createElement('canvas');
  sortie.width = x1 - x0 + 1; sortie.height = y1 - y0 + 1;
  sortie.getContext('2d').drawImage(c, x0, y0, sortie.width, sortie.height, 0, 0, sortie.width, sortie.height);
  return sortie;
}

/** PNG transparent de moins de 300 Ko (réduit par paliers si besoin). */
export async function versPngLeger(canvas, tailleMax = TAILLE_MAX) {
  let c = canvas;
  for (let essai = 0; essai < 8; essai++) {
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    if (blob && blob.size <= tailleMax) return blob;
    const r = document.createElement('canvas');
    r.width = Math.max(40, Math.round(c.width * 0.8)); r.height = Math.max(20, Math.round(c.height * 0.8));
    r.getContext('2d').drawImage(c, 0, 0, r.width, r.height);
    c = r;
  }
  throw new Error('Image trop lourde, même réduite.');
}

/** Envoie l'image dans documents/<boutique>/<nom>.png et renvoie le chemin. */
export async function envoyerImageDocument(nom, blob) {
  const chemin = `${etat.boutique.id}/${nom}.png`;
  const { error } = await sb.storage.from('documents').upload(chemin, blob, { contentType: 'image/png', upsert: true, cacheControl: '60' });
  if (error) throw error;
  return chemin;
}

export async function supprimerImageDocument(chemin) {
  if (!chemin) return;
  const { error } = await sb.storage.from('documents').remove([chemin]);
  if (error) console.warn('[YOUMMA] Image du document non supprimée :', error);
}

/**
 * Fenêtre de préparation du cachet ou de la signature. type : 'cachet' | 'signature'.
 * apres(blob) est appelé avec le PNG prêt (l'appelant l'envoie et enregistre le chemin).
 */
export function ouvrirEditeurImage(type, apres) {
  const signature = type === 'signature';
  const s = { mode: signature ? 'dessin' : 'photo', image: null, seuil: 200, resultat: null, traits: false };
  const { el, fermer } = ouvrirModale({
    titre: signature ? 'Ma signature' : 'Cachet de la boutique',
    variante: 'large',
    contenu: `
      <div class="editeur-cachet">
        ${signature ? `<div class="segments" role="group" aria-label="Méthode">
          <button type="button" class="segment actif" data-mode="dessin">Dessiner</button>
          <button type="button" class="segment" data-mode="photo">Importer une photo</button></div>` : ''}
        <div data-zone="dessin" ${signature ? '' : 'hidden'}>
          <p class="discret">Signez dans le cadre avec le doigt ou la souris.</p>
          <canvas class="cadre-signature" width="900" height="360" aria-label="Zone de signature"></canvas>
          <div class="editeur-boutons"><button type="button" class="btn btn-secondaire" data-action="effacer">${icone('corbeille', 18, 2)} Effacer</button></div>
        </div>
        <div data-zone="photo" ${signature ? 'hidden' : ''}>
          <p class="discret">${signature ? 'Photo de votre signature sur une feuille blanche.' : 'Tamponnez une feuille blanche, puis prenez-la en photo bien à plat, à la lumière du jour.'}</p>
          <button type="button" class="btn btn-secondaire" data-action="choisir">${icone('photo', 18, 2)} Choisir une photo</button>
          <div class="reglage-seuil" hidden>
            <label for="seuil-fond">Retrait du fond : <strong data-zone="valeur-seuil">200</strong></label>
            <input id="seuil-fond" type="range" min="110" max="250" step="5" value="200">
            <span class="discret">Plus haut : retire plus de fond clair. Plus bas : garde les traits pâles.</span>
          </div>
        </div>
        <div class="damier" data-zone="apercu"><span class="discret">L’aperçu sans fond s’affichera ici.</span></div>
        <p class="discret" data-zone="taille"></p>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
          <button type="button" class="btn btn-primaire" data-action="valider" disabled>Valider</button>
        </div>
      </div>`
  });
  const q = (sel) => el.querySelector(sel);
  const toile = q('.cadre-signature');
  const ctx = toile.getContext('2d');

  async function majApercu() {
    let source = null;
    if (s.mode === 'dessin') source = s.traits ? toile : null;
    else source = s.image;
    s.resultat = source ? retirerFond(source, s.mode === 'dessin' ? 250 : s.seuil) : null;
    const apercu = q('[data-zone="apercu"]');
    if (!s.resultat) {
      apercu.innerHTML = `<span class="discret">${source ? 'Rien de visible : baissez le réglage.' : 'L’aperçu sans fond s’affichera ici.'}</span>`;
      q('[data-action="valider"]').disabled = true;
      q('[data-zone="taille"]').textContent = '';
      return;
    }
    apercu.innerHTML = '';
    s.resultat.classList.add('apercu-sans-fond');
    apercu.append(s.resultat);
    q('[data-action="valider"]').disabled = false;
    q('[data-zone="taille"]').textContent = `${s.resultat.width} × ${s.resultat.height} px · PNG transparent`;
  }

  // Tracé au doigt / à la souris (coordonnées ramenées à la taille réelle du canevas).
  let trace = false;
  const point = (e) => { const r = toile.getBoundingClientRect(); return [(e.clientX - r.left) * (toile.width / r.width), (e.clientY - r.top) * (toile.height / r.height)]; };
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, toile.width, toile.height);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = '#10231D';
  toile.addEventListener('pointerdown', (e) => { trace = true; toile.setPointerCapture(e.pointerId); const [x, y] = point(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke(); s.traits = true; e.preventDefault(); });
  toile.addEventListener('pointermove', (e) => { if (!trace) return; const [x, y] = point(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); });
  const finTrace = () => { if (!trace) return; trace = false; majApercu(); };
  toile.addEventListener('pointerup', finTrace);
  toile.addEventListener('pointercancel', finTrace);

  el.addEventListener('click', async (e) => {
    const mode = e.target.closest('[data-mode]');
    if (mode) {
      s.mode = mode.dataset.mode;
      el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('actif', b === mode));
      q('[data-zone="dessin"]').hidden = s.mode !== 'dessin';
      q('[data-zone="photo"]').hidden = s.mode !== 'photo';
      majApercu();
      return;
    }
    if (e.target.closest('[data-action="effacer"]')) {
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, toile.width, toile.height); s.traits = false; majApercu(); return;
    }
    if (e.target.closest('[data-action="choisir"]')) {
      const fichier = await choisirImage();
      if (!fichier) return;
      try { s.image = await chargerImage(fichier); } catch { toast('Image illisible : choisissez une photo JPEG ou PNG.', 'erreur'); return; }
      q('.reglage-seuil').hidden = false;
      majApercu();
      return;
    }
    const valider = e.target.closest('[data-action="valider"]');
    if (valider && s.resultat) {
      boutonOccupe(valider, true, 'Enregistrement…');
      try {
        const blob = await versPngLeger(s.resultat);
        await apres(blob);
        fermer();
      } catch (err) {
        boutonOccupe(valider, false);
        toast(messageErreur(err), 'erreur', 6000);
      }
    }
  });
  q('#seuil-fond').addEventListener('input', (e) => {
    s.seuil = Number(e.target.value);
    q('[data-zone="valeur-seuil"]').textContent = String(s.seuil);
    majApercu();
  });
  return { el, fermer };
}
