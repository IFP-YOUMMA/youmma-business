/**
 * colis/photos.js — Les deux photos obligatoires d'un colis (étape 16, maquettes ColisNouveau et ColisOrdinateur).
 *
 *  - « Sur la bascule » : le colis ET l'afficheur sur la même photo → bucket public « colis » (preuve du poids,
 *    visible sur le lien de suivi) ;
 *  - « Le contenu » : carton ouvert avant fermeture → bucket privé « bons » (visible par le bureau seulement).
 * Téléphone : <input capture="environment">, aperçu immédiat. Ordinateur : trois voies, dans cet ordre —
 *   1. scanner un QR avec le téléphone (ouvrir_session_photo ; le téléphone dépose dans colis/sessions/<jeton>/ ;
 *      l'ordinateur relit session_photo toutes les 2 s) ; le lien meurt au bout de 10 minutes ;
 *   2. la caméra de l'ordinateur (getUserMedia) ; 3. choisir un fichier.
 * Compression comme pour les produits : côté long 1280 px, JPEG qualité 0,7, cible < 200 Ko (3G).
 */
import { sb } from '../supabase.js';
import { etat } from '../state.js';
import { esc, icone, toast, ouvrirModale } from '../utils.js';
import { chargerCanvas, redimensionner, encoder } from '../images/traitement.js';
import { svgQr } from '../lib/qr.js';
import { api, champ, iconeColis } from './commun.js';

const QUOI = {
  bascule: { titre: 'Sur la bascule', aide: 'Le colis et l’afficheur sur la même photo.', reprendre: 'Reprendre la bascule' },
  contenu: { titre: 'Le contenu', aide: 'Carton ouvert, avant fermeture.', reprendre: 'Reprendre le contenu' }
};
const surTelephone = () => window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 899.98px)').matches;

/** Fichier (ou canvas) → JPEG compressé : { blob, url }. */
export async function compresserPhoto(source) {
  const c = source instanceof HTMLCanvasElement ? source : await chargerCanvas(source);
  const petit = redimensionner(c, { cote: Math.min(1280, Math.max(c.width, c.height)) });
  const { blob } = await encoder(petit, { qualite: 0.7, tailleMax: 200 * 1024, forcer: 'jpeg' });
  return { blob, url: URL.createObjectURL(blob) };
}

/**
 * Monte le bloc « Les deux photos » dans `zone`. surChangement(pret) est appelé à chaque photo.
 * Renvoie { pret(), envoyer() → { bascule, contenu, envoyes }, nettoyer(envoyes), arreter() }.
 */
export function monterPhotos(zone, { surChangement = () => {} } = {}) {
  const s = { bascule: null, contenu: null, session: null, minuteur: null, compteur: null, flux: null };
  const telephone = surTelephone();

  zone.innerHTML = `
    <div class="col-photos-entete"><h3>Les deux photos</h3><span class="col-obligatoire">OBLIGATOIRES</span></div>
    <div class="col-photos-grille">
      ${Object.entries(QUOI).map(([q, d]) => `
        <div class="col-photo" data-photo="${q}">
          <div class="col-photo-apercu" data-ref="apercu-${q}">${iconeColis(q === 'bascule' ? 'balance' : 'colis', 34)}</div>
          <div class="col-photo-textes"><strong data-ref="titre-${q}">${esc(d.titre)}</strong><span>${esc(d.aide)}</span></div>
          <label class="btn btn-secondaire col-photo-bouton">${icone('photo', 17, 2)} <span data-ref="libelle-${q}">${telephone ? 'Prendre la photo' : 'Choisir un fichier'}</span>
            <input type="file" accept="image/*" ${telephone ? 'capture="environment"' : ''} data-fichier="${q}" class="sr-only"></label>
        </div>`).join('')}
    </div>
    ${telephone ? '' : `
    <div class="col-photos-ordi">
      <div class="col-session" data-zone="session">
        <div class="col-session-qr" data-ref="qr"><span class="squelette"></span></div>
        <div class="col-session-textes">
          <span class="col-conseil">MÉTHODE CONSEILLÉE</span>
          <strong>Scannez avec votre téléphone</strong>
          <span class="discret">Le téléphone ouvre l’appareil photo, vous prenez les deux photos, elles apparaissent ici tout de suite.</span>
          <span class="col-session-lien" data-ref="lien"></span>
          <span class="col-expire" data-ref="expire">Préparation du lien…</span>
        </div>
      </div>
      <div class="col-autres-voies">
        <button type="button" class="col-voie" data-action="camera">${icone('photo', 20, 1.8)}<span><strong>Caméra de l’ordinateur</strong><span class="discret">Si une webcam est placée au-dessus de la bascule.</span></span></button>
        <label class="col-voie">${icone('telecharger', 20, 1.8)}<span><strong>Choisir un fichier</strong><span class="discret">Photos prises avec un autre appareil.</span></span>
          <input type="file" accept="image/*" data-fichier="auto" class="sr-only"></label>
      </div>
    </div>`}
    <p class="col-rappel-photos">Les deux photos sont obligatoires : le colis ne peut pas être enregistré sans elles.</p>`;
  const ref = (n) => zone.querySelector(`[data-ref="${n}"]`);

  function afficher(quoi) {
    const p = s[quoi];
    const tuile = zone.querySelector(`[data-photo="${quoi}"]`);
    tuile.classList.toggle('faite', Boolean(p));
    ref(`apercu-${quoi}`).innerHTML = p ? `<img src="${esc(p.url)}" alt="${esc(QUOI[quoi].titre)}">` : iconeColis(quoi === 'bascule' ? 'balance' : 'colis', 34);
    ref(`titre-${quoi}`).innerHTML = p ? `${icone('valide', 15, 2.6)} ${esc(QUOI[quoi].titre)}` : esc(QUOI[quoi].titre);
    ref(`libelle-${quoi}`).textContent = p ? QUOI[quoi].reprendre : (telephone ? 'Prendre la photo' : 'Choisir un fichier');
    surChangement(Boolean(s.bascule && s.contenu));
  }

  async function prendre(quoi, source) {
    try {
      const { blob, url } = await compresserPhoto(source);
      if (s[quoi]?.url?.startsWith('blob:')) URL.revokeObjectURL(s[quoi].url);
      s[quoi] = { blob, url, source: 'local' };
      afficher(quoi);
    } catch {
      toast('Photo illisible. Reprenez-la.', 'erreur');
    }
  }

  /* ---------------- Session téléphone (ordinateur) */

  async function ouvrirSession() {
    clearInterval(s.minuteur); clearInterval(s.compteur);
    try {
      const r = await api.sessionPhoto();
      if (!zone.isConnected) return;
      s.session = { jeton: r.jeton, lien: lienSession(r), fin: new Date(r.expire_le || Date.now() + 10 * 60000).getTime() };
    } catch {
      ref('expire').textContent = 'Lien indisponible. Utilisez la caméra ou un fichier.';
      return;
    }
    ref('qr').innerHTML = svgQr(s.session.lien, { titre: 'QR code à scanner avec le téléphone' });
    ref('lien').textContent = s.session.lien.replace(/^https?:\/\//, '');
    const compte = () => {
      const reste = Math.max(0, s.session.fin - Date.now());
      const z = ref('expire');
      if (!z) return;
      if (!reste) {
        clearInterval(s.minuteur); clearInterval(s.compteur);
        z.innerHTML = 'Le lien a expiré. <button type="button" class="btn-lien" data-action="nouveau-lien">Nouveau lien</button>';
        z.classList.add('expire');
        ref('qr').classList.add('expire');
        return;
      }
      const mn = Math.ceil(reste / 60000);
      z.textContent = `Le lien expire dans ${mn} minute${mn > 1 ? 's' : ''}`;
      z.classList.remove('expire');
      ref('qr').classList.remove('expire');
    };
    compte();
    s.compteur = setInterval(compte, 5000);
    s.minuteur = setInterval(lireSession, 2000);
  }

  async function lireSession() {
    if (!s.session || !zone.isConnected) { clearInterval(s.minuteur); return; }
    let r;
    try { r = await api.lireSessionPhoto(s.session.jeton); } catch { return; }
    if (!r || r.expiree) return;
    for (const quoi of ['bascule', 'contenu']) {
      const chemin = champ(r, quoi, `photo_${quoi}`, `chemin_${quoi}`);
      if (chemin && s[quoi]?.chemin !== chemin) {
        const url = sb.storage.from('colis').getPublicUrl(chemin).data.publicUrl;
        s[quoi] = { chemin, url, source: 'session' };
        afficher(quoi);
      }
    }
    if (s.bascule?.source === 'session' && s.contenu?.source === 'session') clearInterval(s.minuteur);
  }

  /* ---------------- Caméra de l'ordinateur */

  async function camera() {
    if (!navigator.mediaDevices?.getUserMedia) { toast('Pas de caméra sur cet ordinateur.', 'erreur'); return; }
    try { s.flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } }); } catch { toast('Caméra inaccessible ou refusée.', 'erreur'); return; }
    const { el, fermer } = ouvrirModale({
      titre: 'Caméra de l’ordinateur',
      variante: 'large',
      contenu: `<video class="col-video" autoplay playsinline muted></video>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire" data-prendre="bascule">${icone('photo', 17, 2)} Photo de la bascule</button>
          <button type="button" class="btn btn-secondaire" data-prendre="contenu">${icone('photo', 17, 2)} Photo du contenu</button>
          <button type="button" class="btn btn-primaire" data-fermer>Terminé</button>
        </div>`,
      onFermer: () => { s.flux?.getTracks().forEach((p) => p.stop()); s.flux = null; }
    });
    const video = el.querySelector('video');
    video.srcObject = s.flux;
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-prendre]');
      if (!b) return;
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      await prendre(b.dataset.prendre, c);
      toast(`${QUOI[b.dataset.prendre].titre} : photo prise.`, 'succes');
      if (s.bascule && s.contenu) fermer();
    });
  }

  zone.addEventListener('change', (e) => {
    const f = e.target.closest('[data-fichier]');
    if (!f || !f.files?.[0]) return;
    // « Choisir un fichier » (ordinateur) : remplit la bascule d'abord, puis le contenu.
    const quoi = f.dataset.fichier === 'auto' ? (s.bascule ? 'contenu' : 'bascule') : f.dataset.fichier;
    prendre(quoi, f.files[0]);
    f.value = '';
  });
  zone.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="camera"]')) camera();
    if (e.target.closest('[data-action="nouveau-lien"]')) ouvrirSession();
  });
  if (!telephone) ouvrirSession();

  return {
    pret: () => Boolean(s.bascule && s.contenu),
    /** Monte les photos locales (bascule → colis, contenu → bons) ; celles du téléphone sont déjà en place. */
    async envoyer() {
      const b = etat.boutique.id;
      const horo = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      const envoyes = [];
      const deposer = async (quoi, bucket) => {
        const p = s[quoi];
        if (p.source === 'session') return p.chemin;
        const chemin = `${b}/${horo}-${quoi}.jpg`;
        const { error } = await sb.storage.from(bucket).upload(chemin, p.blob, { contentType: 'image/jpeg', upsert: false });
        if (error) throw error;
        envoyes.push({ bucket, chemin });
        return chemin;
      };
      try {
        const bascule = await deposer('bascule', 'colis');
        const contenu = await deposer('contenu', 'bons');
        return { bascule, contenu, envoyes };
      } catch (err) {
        await this.nettoyer(envoyes);
        throw err;
      }
    },
    /** Efface les fichiers déjà montés (enregistrement refusé) : pas de déchets dans le stockage. */
    async nettoyer(envoyes = []) {
      for (const { bucket, chemin } of envoyes) await sb.storage.from(bucket).remove([chemin]).catch(() => {});
    },
    arreter() {
      clearInterval(s.minuteur); clearInterval(s.compteur);
      s.flux?.getTracks().forEach((p) => p.stop());
      ['bascule', 'contenu'].forEach((q) => { if (s[q]?.url?.startsWith('blob:')) URL.revokeObjectURL(s[q].url); });
    }
  };
}

/** Adresse que le téléphone ouvre : le lien de la base, sinon …/p/<jeton>. */
function lienSession(r) {
  if (r.lien && /^https?:/.test(r.lien)) return r.lien;
  const racine = new URL('./', location.href.split('#')[0]).href;
  return `${racine}p/${encodeURIComponent(r.jeton)}`;
}
