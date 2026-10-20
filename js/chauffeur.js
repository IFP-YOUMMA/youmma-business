/**
 * chauffeur.js — Page du chauffeur (d/<jeton>, sans compte), maquette Livraisons « À l'arrivée ».
 *
 * Page indépendante de l'appli : seulement config.js (URL et clé publique anon) et les fonctions d'image
 * sans dépendance (images/traitement.js). Tout passe par les RPC publiques livraison_par_jeton et
 * signer_livraison ; la photo du bon va dans le bucket privé « bons » (dossier de la boutique).
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { chargerCanvas, redimensionner, encoder } from './images/traitement.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'yb-chauffeur' }
});
const racine = document.getElementById('chauffeur');
const jeton = (new URLSearchParams(location.search).get('j') || location.pathname.match(/\/d\/([A-Za-z0-9_-]{8,120})\/?$/)?.[1] || '').trim();
const LARGEUR_SIGNATURE = 600;
const MAX_SIGNATURE = 200000; // caractères (data URL PNG)

const ICONES = {
  telephone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  carte: 'M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  photo: 'M4 7h3l2-3h6l2 3h3v13H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  valide: 'M20 6L9 17l-5-5',
  alerte: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  camion: 'M1 6h13v10H1zM14 10h4l4 3v3h-8M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'
};
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icone = (nom, taille = 20, epaisseur = 2) => `<svg width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${epaisseur}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${ICONES[nom] || ''}"></path></svg>`;
const nombre = (n) => (Number(n) || 0).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const telLocal = (t) => { const c = String(t || '').replace(/\D/g, ''); const l = c.startsWith('224') ? c.slice(3) : c; return l.length === 9 ? l.replace(/(\d{3})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4') : t || ''; };
const telInternational = (t) => { let c = String(t || '').replace(/\D/g, ''); if (c.length === 9) c = `224${c}`; return c; };
const dateHeure = (iso) => {
  try { return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Conakry', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(':', ' h '); } catch { return ''; }
};

function messageErreur(err) {
  const brut = String(err?.message || err || '');
  if (/JETON|INTROUVABLE|EXPIRE/i.test(brut)) return 'Lien introuvable ou expiré.';
  if (/DEJA_SIGNEE|LIVRAISON_TERMINEE/i.test(brut)) return 'Cette livraison est déjà confirmée.';
  if (/ANNULEE/i.test(brut)) return 'Cette livraison a été annulée par la boutique.';
  if (/RECU_PAR|NOM_REQUIS/i.test(brut)) return 'Indiquez le nom de la personne qui reçoit.';
  if (/SIGNATURE/i.test(brut)) return 'La signature est trop lourde ou vide : effacez puis signez à nouveau.';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(brut)) return 'Pas de connexion internet. Réessayez dans un instant.';
  console.error('[YOUMMA] Erreur :', err);
  return 'Une erreur est survenue. Réessayez dans un instant.';
}

/* ------------------------------------------------------------ Lecture */

/** Lecture souple de livraison_par_jeton (champs de la livraison et de la boutique). */
function normaliser(r) {
  const b = r.boutique || {};
  return {
    numero: r.numero, statut: r.statut,
    boutique_id: r.boutique_id || b.id || null,
    boutique_nom: r.boutique_nom || b.nom || 'Boutique',
    logo: r.boutique_logo || r.logo_url || b.logo_url || null,
    boutique_tel: r.boutique_telephone || b.telephone || null,
    client: r.client_nom || r.client || '',
    telephone: r.telephone || r.client_telephone || '',
    adresse: r.adresse || '', repere: r.repere || '',
    contenu: r.contenu || '', frais: Number(r.frais) || 0,
    vehicule: r.vehicule_nom || r.vehicule?.nom || r.vehicule || '',
    chauffeur: r.chauffeur || '',
    recu_par: r.recu_par || '', livree_le: r.livree_le || null, note: r.note || ''
  };
}

function introuvable() {
  document.title = 'Lien introuvable · YOUMMA Business';
  racine.innerHTML = `<div class="ch-carte ch-message"><span class="ch-icone alerte">${icone('alerte', 36, 2)}</span><h1>Lien introuvable ou expiré</h1>
    <p>Ce lien de livraison n’existe pas ou date de plus de 30 jours. Demandez un nouveau lien à la boutique.</p></div>`;
}

function enteteHTML(l) {
  return `<header class="ch-entete">
    ${l.logo ? `<img class="ch-logo" src="${esc(l.logo)}" alt="" width="52" height="52" decoding="async">` : `<span class="ch-logo ch-logo-vide">${icone('camion', 26, 2)}</span>`}
    <div><span class="ch-boutique">${esc(l.boutique_nom)}</span><h1>Livraison ${esc(l.numero || '')}</h1></div></header>`;
}

function resumeHTML(l) {
  const adresse = [l.adresse, l.repere].filter(Boolean).join(' · ');
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.adresse || l.repere || '')}`;
  return `
    <section class="ch-carte">
      <span class="ch-etiquette">Client</span>
      <strong class="ch-gros">${esc(l.client || '—')}</strong>
      ${l.telephone ? `<a class="ch-bouton ch-appel" href="tel:+${esc(telInternational(l.telephone))}">${icone('telephone', 22)} Appeler ${esc(telLocal(l.telephone))}</a>` : ''}
    </section>
    <section class="ch-carte">
      <span class="ch-etiquette">Adresse</span>
      <strong class="ch-gros">${esc(adresse || '—')}</strong>
      ${l.adresse || l.repere ? `<a class="ch-bouton ch-secondaire" href="${esc(maps)}" target="_blank" rel="noopener">${icone('carte', 22)} Ouvrir dans Maps</a>` : ''}
    </section>
    <section class="ch-carte">
      <span class="ch-etiquette">À livrer</span>
      <p class="ch-contenu">${esc(l.contenu || '—')}</p>
      ${l.frais ? `<p class="ch-frais">Frais de livraison : <strong>${nombre(l.frais)} GNF</strong></p>` : ''}
      ${l.note ? `<p class="ch-note">${esc(l.note)}</p>` : ''}
    </section>`;
}

/* ------------------------------------------------------------ Signature au doigt */

function brancherSignature(cv) {
  const ctx = cv.getContext('2d');
  const s = { trace: false, vide: true, dernier: null };
  const preparer = () => {
    const ratio = LARGEUR_SIGNATURE / cv.getBoundingClientRect().width;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#000000'; ctx.lineWidth = 3.2 * Math.max(1, ratio * 0.8); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  };
  preparer();
  const point = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) }; };
  cv.addEventListener('pointerdown', (e) => { e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch { /* capture facultative */ } s.trace = true; s.dernier = point(e); ctx.beginPath(); ctx.arc(s.dernier.x, s.dernier.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fillStyle = '#000000'; ctx.fill(); s.vide = false; });
  cv.addEventListener('pointermove', (e) => {
    if (!s.trace) return;
    const p = point(e);
    ctx.beginPath(); ctx.moveTo(s.dernier.x, s.dernier.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    s.dernier = p;
  });
  const fin = () => { s.trace = false; };
  cv.addEventListener('pointerup', fin);
  cv.addEventListener('pointercancel', fin);
  return {
    effacer: () => { s.vide = true; preparer(); },
    vide: () => s.vide,
    /** PNG réduit sous 200 000 caractères (600 px, puis 450, puis 300 de large si besoin). */
    dataUrl: () => {
      for (const largeur of [600, 450, 300]) {
        const c = document.createElement('canvas');
        c.width = largeur; c.height = Math.round(cv.height * largeur / cv.width);
        const x = c.getContext('2d');
        x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, c.width, c.height);
        x.drawImage(cv, 0, 0, c.width, c.height);
        const url = c.toDataURL('image/png');
        if (url.length <= MAX_SIGNATURE) return url;
      }
      return null;
    }
  };
}

/* ------------------------------------------------------------ Écrans */

function afficherSignee(l) {
  document.title = `Livraison ${l.numero} confirmée · ${l.boutique_nom}`;
  racine.innerHTML = `${enteteHTML(l)}
    <div class="ch-carte ch-message"><span class="ch-icone ok">${icone('valide', 36, 2.6)}</span><h2>Livraison confirmée</h2>
      <p>Reçue par <strong>${esc(l.recu_par || '—')}</strong>${l.livree_le ? ` le ${esc(dateHeure(l.livree_le))}` : ''}.</p>
      <p class="ch-discret">Ce bon est enregistré chez ${esc(l.boutique_nom)}. Vous pouvez fermer cette page.</p></div>
    ${resumeHTML(l)}`;
}

function afficherAnnulee(l) {
  racine.innerHTML = `${enteteHTML(l)}<div class="ch-carte ch-message"><span class="ch-icone alerte">${icone('alerte', 36, 2)}</span><h2>Livraison annulée</h2><p>La boutique a annulé cette livraison. Appelez-la en cas de doute.</p></div>`;
}

function afficherFormulaire(l) {
  document.title = `Livraison ${l.numero} · ${l.boutique_nom}`;
  const s = { photo: null, envoi: false };
  racine.innerHTML = `${enteteHTML(l)}
    ${resumeHTML(l)}
    <form class="ch-carte ch-form" novalidate>
      <span class="ch-etiquette">Signature du client</span>
      <div class="ch-signature-cadre"><canvas class="ch-signature" width="${LARGEUR_SIGNATURE}" height="260" aria-label="Zone de signature : signez avec le doigt"></canvas>
        <span class="ch-signature-aide" aria-hidden="true">Signez ici avec le doigt</span></div>
      <button type="button" class="ch-bouton ch-secondaire ch-petit" data-action="effacer">Effacer</button>
      <label class="ch-champ"><span>Reçu par</span><input name="recu" type="text" maxlength="80" autocomplete="name" placeholder="Nom de la personne qui reçoit" required></label>
      <div class="ch-photo" data-zone="photo"></div>
      <p class="ch-erreur" role="alert" hidden></p>
      <button type="submit" class="ch-bouton ch-principal">${icone('valide', 24, 2.6)} Confirmer la livraison</button>
    </form>`;
  const form = racine.querySelector('form');
  const signature = brancherSignature(form.querySelector('canvas'));
  const erreur = (m) => { const z = form.querySelector('.ch-erreur'); z.textContent = m; z.hidden = !m; if (m) z.scrollIntoView({ block: 'center' }); };
  form.querySelector('canvas').addEventListener('pointerdown', () => form.querySelector('.ch-signature-aide')?.remove(), { once: true });
  form.querySelector('[data-action="effacer"]').addEventListener('click', () => signature.effacer());

  const zone = form.querySelector('[data-zone="photo"]');
  /** Bouton « Photo du bon » (ou aperçu de la photo choisie) : la signature et le nom restent saisis. */
  function renderPhoto() {
    if (!s.photo) {
      zone.innerHTML = `<label class="ch-bouton ch-secondaire">${icone('photo', 22)} Photo du bon (facultatif)<input type="file" accept="image/*" capture="environment" hidden data-ref="photo"></label>`;
      return;
    }
    zone.innerHTML = `<div class="ch-apercu"><img src="${URL.createObjectURL(s.photo.blob)}" alt="Photo du bon"><span>${Math.round(s.photo.blob.size / 1024)} Ko</span>
      <button type="button" class="ch-bouton ch-secondaire ch-petit" data-action="retirer-photo">Retirer</button></div>`;
  }
  renderPhoto();
  zone.addEventListener('click', (e) => { if (e.target.closest('[data-action="retirer-photo"]')) { s.photo = null; renderPhoto(); } });
  zone.addEventListener('change', async (e) => {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    try {
      // Même compression que le bon d'enlèvement (étape 10) : 1600 px, JPEG, 400 Ko au plus.
      const c = await chargerCanvas(fichier);
      const sortie = await encoder(redimensionner(c, { cote: 1600 }), { qualite: 0.7, tailleMax: 400 * 1024, forcer: 'jpeg' });
      s.photo = sortie;
      renderPhoto();
    } catch {
      erreur('Photo illisible : réessayez, ou confirmez sans photo.');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (s.envoi) return;
    const recu = form.recu.value.trim();
    if (signature.vide()) return erreur('Faites signer le client dans le cadre.');
    if (!recu) { form.recu.focus(); return erreur('Indiquez le nom de la personne qui reçoit.'); }
    const image = signature.dataUrl();
    if (!image) return erreur('La signature est trop lourde : effacez puis signez plus simplement.');
    erreur('');
    s.envoi = true;
    const bouton = form.querySelector('[type=submit]');
    bouton.disabled = true;
    bouton.textContent = 'Envoi…';
    let chemin = null;
    if (s.photo && l.boutique_id) {
      // La photo est facultative : si l'envoi échoue, on confirme quand même sans photo.
      try {
        const nom = `${l.boutique_id}/livraison-${String(l.numero || 'L').replace(/[^\w-]/g, '')}-${Date.now()}.jpg`;
        const { error } = await sb.storage.from('bons').upload(nom, s.photo.blob, { contentType: 'image/jpeg', upsert: false });
        if (!error) chemin = nom;
      } catch { /* sans photo */ }
    }
    const { data, error } = await sb.rpc('signer_livraison', { p_jeton: jeton, p_recu_par: recu, p_signature: image, p_photo_path: chemin });
    s.envoi = false;
    if (error) { bouton.disabled = false; bouton.innerHTML = `${icone('valide', 24, 2.6)} Confirmer la livraison`; erreur(messageErreur(error)); return; }
    const r = (Array.isArray(data) ? data[0] : data) || {};
    window.scrollTo(0, 0);
    racine.innerHTML = `${enteteHTML(l)}<div class="ch-carte ch-message"><span class="ch-icone ok">${icone('valide', 40, 2.6)}</span>
      <h2>Merci, livraison confirmée</h2><p>Reçue par <strong>${esc(recu)}</strong>${r.livree_le ? ` le ${esc(dateHeure(r.livree_le))}` : ''}.</p>
      <p class="ch-discret">${esc(l.boutique_nom)} est prévenu${chemin ? ' et la photo du bon est enregistrée' : ''}. Vous pouvez fermer cette page.</p></div>`;
  });
}

async function demarrer() {
  if (!jeton) { introuvable(); return; }
  const { data, error } = await sb.rpc('livraison_par_jeton', { p_jeton: jeton });
  if (error) {
    if (/JETON|INTROUVABLE|EXPIRE/i.test(error.message || '')) { introuvable(); return; }
    racine.innerHTML = `<div class="ch-carte ch-message"><span class="ch-icone alerte">${icone('alerte', 36, 2)}</span><h1>Page indisponible</h1><p>${esc(messageErreur(error))}</p>
      <button type="button" class="ch-bouton ch-principal" onclick="location.reload()">Réessayer</button></div>`;
    return;
  }
  const r = Array.isArray(data) ? data[0] : data;
  if (!r || r.introuvable || r.expire || !r.numero) { introuvable(); return; }
  const l = normaliser(r);
  if (l.statut === 'livree') afficherSignee(l);
  else if (l.statut === 'annulee') afficherAnnulee(l);
  else afficherFormulaire(l);
}

demarrer().catch((err) => {
  console.error(err);
  racine.innerHTML = `<div class="ch-carte ch-message"><h1>Page indisponible</h1><p>${esc(messageErreur(err))}</p></div>`;
});
