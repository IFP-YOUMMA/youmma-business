/**
 * affiche-publier.js — Publier l'affiche du jour (étape 15).
 *
 * Deux chemins, un seul écran :
 *  A. tout de suite, pour tout le monde : texte copié, partage natif du fichier (navigator.share) qui ouvre
 *     Facebook, Instagram, WhatsApp ou TikTok avec l'image ; sinon image enregistrée (appui long sur iOS)
 *     et ouverture de l'application. publication_manuelle garde la trace.
 *  B. un seul clic, quand le réseau est connecté (mes_reseaux) : demander_publication met en file, la fonction
 *     Edge publier-reseaux publie ; l'écran relit affiche_du_jour toutes les 3 s pendant 30 s.
 * Les images (3 formats) et la vidéo sont déposées dans le bucket public « produits »
 * (<boutique>/affiches/<jour>-<format>.jpg) puis enregistrées par enregistrer_images_affiche.
 * Aucun jeton ni identifiant d'application ici : la connexion des comptes passe par la fonction Edge connecter-reseau.
 */
import { sb } from './supabase.js';
import { etat } from './state.js';
import { esc, icone, toast, ouvrirModale, copierTexte, messageErreur } from './utils.js';
import { FORMATS_AFFICHE, nomFichierAffiche } from './affiche.js';

export const RESEAUX = {
  facebook: { nom: 'Facebook', format: '4:5', auto: true },
  instagram: { nom: 'Instagram', format: '4:5', auto: true },
  whatsapp: { nom: 'WhatsApp', format: '9:16', auto: false },
  tiktok: { nom: 'TikTok', format: '9:16', auto: true }
};
const premiere = (d) => (Array.isArray(d) ? d[0] : d) || null;
export const estIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const estMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || estIos();

/* ------------------------------------------------------------ Images dans le stockage */

/**
 * Dépose les images (et la vidéo) puis les enregistre sur l'affiche.
 * fichiers : { '4:5': { blob }, '9:16': { blob }, '1:1': { blob } } ; video : Blob ou null. Renvoie la carte des URL.
 */
export async function enregistrerImages(affiche, fichiers, video = null) {
  const b = etat.boutique.id;
  const jour = String(affiche.jour).slice(0, 10);
  const version = Date.now();
  const images = {};
  const deposer = async (chemin, blob, type) => {
    const { error } = await sb.storage.from('produits').upload(chemin, blob, { contentType: type, upsert: true, cacheControl: '3600' });
    if (error) throw error;
    // ?v= : la même adresse est réutilisée chaque jour de l'année suivante ; on évite l'ancienne copie en cache.
    return `${sb.storage.from('produits').getPublicUrl(chemin).data.publicUrl}?v=${version}`;
  };
  for (const [format, f] of Object.entries(fichiers)) {
    if (!f?.blob) continue;
    images[format] = await deposer(`${b}/affiches/${jour}-${FORMATS_AFFICHE[format].fichier}.jpg`, f.blob, 'image/jpeg');
  }
  if (video) {
    try { images.video = await deposer(`${b}/affiches/${jour}-video.mp4`, video, 'video/mp4'); } catch (err) { console.warn('[YOUMMA] Vidéo non envoyée :', err?.message || err); }
  }
  const { error } = await sb.rpc('enregistrer_images_affiche', { p_affiche: affiche.id, p_images: images });
  if (error) throw error;
  return images;
}

/* ------------------------------------------------------------ Chemin A : partage, téléchargement, application */

function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

/** iOS : l'image en grand, « Appui long pour enregistrer » (le téléchargement direct n'y va pas dans Photos). */
function montrerPourEnregistrer(blob, { titre = 'Enregistrer l’image', apres = '' } = {}) {
  const url = URL.createObjectURL(blob);
  ouvrirModale({
    titre,
    contenu: `
      <div class="aff-enregistrer">
        <img src="${url}" alt="Affiche du jour">
        <p class="texte-modale"><strong>Appui long sur l’image</strong>, puis « Enregistrer dans Photos ».${apres ? ` ${apres}` : ''}</p>
      </div>
      <div class="modale-actions"><button type="button" class="btn btn-primaire" data-fermer>Compris</button></div>`,
    onFermer: () => setTimeout(() => URL.revokeObjectURL(url), 1000)
  });
}

/** Lien de l'application (et page web de secours). compte : ligne de mes_reseaux (compte_id, nom…) ou null. */
function liensApplication(reseau, texte, compte) {
  const id = compte?.compte_id || compte?.page_id || null;
  if (reseau === 'facebook') return { app: id ? `fb://page/${id}` : 'fb://feed', web: id ? `https://www.facebook.com/${id}` : 'https://www.facebook.com/' };
  if (reseau === 'instagram') return { app: 'instagram://camera', web: 'https://www.instagram.com/' };
  if (reseau === 'tiktok') return { app: 'tiktok://', web: 'https://www.tiktok.com/upload' };
  return { app: null, web: `https://wa.me/?text=${encodeURIComponent(texte)}` };
}

/** Ouvre l'application ; si elle n'est pas installée (la page reste visible), ouvre la page web. */
function ouvrirApplication({ app, web }) {
  if (!app || !estMobile()) { window.open(web, '_blank', 'noopener'); return; }
  let quitte = false;
  const surVisibilite = () => { if (document.hidden) quitte = true; };
  document.addEventListener('visibilitychange', surVisibilite);
  window.location.href = app;
  setTimeout(() => {
    document.removeEventListener('visibilitychange', surVisibilite);
    if (!quitte) window.open(web, '_blank', 'noopener');
  }, 1600);
}

/**
 * Publication « en trois secondes ». fichier : { blob, nom } du bon format (ou la vidéo pour TikTok).
 * Renvoie 'partage' | 'annule' | 'manuel'. publication_manuelle est appelée sauf si l'utilisateur annule.
 */
export async function publierManuellement({ affiche, reseau, format, fichier, texte, compte }) {
  const copie = await copierTexte(texte);
  const nomReseau = RESEAUX[reseau]?.nom || reseau;
  const file = typeof File === 'function' ? new File([fichier.blob], fichier.nom, { type: fichier.blob.type }) : null;
  let resultat = 'manuel';
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: texte });
      resultat = 'partage';
    } catch (err) {
      if (err?.name === 'AbortError') return 'annule';
      console.warn('[YOUMMA] Partage impossible :', err?.message || err);
    }
  }
  if (resultat !== 'partage') {
    const message = 'Collez-le et touchez Publier.';
    if (estIos() && fichier.blob.type.startsWith('image/')) {
      montrerPourEnregistrer(fichier.blob, { titre: `Publier sur ${nomReseau}`, apres: `Ensuite ouvrez ${nomReseau}${copie ? ' : le texte est copié,' : ','} ${message.charAt(0).toLowerCase()}${message.slice(1)}` });
    } else {
      telecharger(fichier.blob, fichier.nom);
      const liens = liensApplication(reseau, texte, compte);
      const { el, fermer } = ouvrirModale({
        titre: `Publier sur ${nomReseau}`,
        contenu: `
          <p class="texte-modale"><strong>L’image est dans vos ${estMobile() ? 'photos' : 'téléchargements'} et ${copie ? 'le texte est copié' : 'le texte est prêt'}.</strong> ${esc(message)}</p>
          ${copie ? '' : `<textarea class="input aff-texte-secours" rows="6" readonly>${esc(texte)}</textarea>`}
          <div class="modale-actions">
            <button type="button" class="btn btn-secondaire" data-fermer>Fermer</button>
            <button type="button" class="btn btn-primaire" data-action="ouvrir-app">Ouvrir ${esc(nomReseau)}</button>
          </div>`
      });
      el.querySelector('[data-action="ouvrir-app"]').addEventListener('click', () => { fermer(); ouvrirApplication(liens); });
    }
  }
  const { error } = await sb.rpc('publication_manuelle', { p_affiche: affiche.id, p_reseau: reseau, p_format: format });
  if (error) console.warn('[YOUMMA] publication_manuelle :', error.message);
  return resultat;
}

/** Télécharge simplement l'image (« Pour publier ailleurs »). */
export function telechargerImage(fichier) {
  if (estIos() && fichier.blob.type.startsWith('image/')) montrerPourEnregistrer(fichier.blob);
  else telecharger(fichier.blob, fichier.nom);
}

export const nomFichier = (affiche, format, extension = 'jpg') => nomFichierAffiche(affiche?.boutique?.nom || etat.boutique.nom, String(affiche?.jour || '').slice(0, 10), format, extension);

/* ------------------------------------------------------------ Chemin B : publication automatique */

/**
 * Met en file une publication (réseau connecté) puis relit affiche_du_jour toutes les 3 s pendant 30 s.
 * suivi(etat) : 'en_cours' ; renvoie { statut: 'publiee' | 'erreur' | 'en_cours', url?, erreur? }.
 */
export async function publierAutomatiquement({ affiche, reseau, imageUrl, texte, suivi = () => {} }) {
  const debut = Date.now();
  const { error } = await sb.rpc('demander_publication', { p_affiche: affiche.id, p_reseaux: [reseau], p_image_url: imageUrl, p_texte: texte });
  if (error) return { statut: 'erreur', erreur: messageErreur(error) };
  suivi('en_cours');
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const { data } = await sb.rpc('affiche_du_jour', { p_boutique: etat.boutique.id, p_jour: String(affiche.jour).slice(0, 10) });
    const pubs = (premiere(data)?.publications || []).filter((p) => p.reseau === reseau);
    const recente = pubs.find((p) => !p.publie_le || new Date(p.publie_le).getTime() >= debut - 60000) || pubs.at(-1);
    if (recente?.statut === 'publiee') return { statut: 'publiee', url: recente.url || null };
    if (recente?.statut === 'erreur') return { statut: 'erreur', erreur: recente.erreur || 'Publication refusée par le réseau.' };
  }
  return { statut: 'en_cours' };
}

/* ------------------------------------------------------------ Connexion des comptes (fonction Edge connecter-reseau) */

let configPromesse = null;
/** Réseaux que la plateforme sait connecter (variables d'environnement renseignées côté serveur). */
export function reseauxConnectables() {
  if (!configPromesse) {
    configPromesse = sb.functions.invoke('connecter-reseau', { body: { action: 'config' } })
      .then(({ data, error }) => (error || !data ? {} : data))
      .catch(() => ({}));
  }
  return configPromesse;
}

/** Démarre la connexion OAuth (Meta ou TikTok) ; sinon « Bientôt disponible ». */
export async function connecterReseau(reseau) {
  const config = await reseauxConnectables();
  if (!config[reseau]) {
    ouvrirModale({
      titre: `Connecter ${RESEAUX[reseau]?.nom || reseau}`,
      contenu: `<p class="texte-modale"><strong>Bientôt disponible</strong> — en attendant, la publication en trois secondes fonctionne : l’image est enregistrée, le texte copié, et ${esc(RESEAUX[reseau]?.nom || reseau)} s’ouvre.</p>
        <div class="modale-actions"><button type="button" class="btn btn-primaire" data-fermer>Compris</button></div>`
    });
    return;
  }
  const retour = `${location.href.split('#')[0]}#/boutique-en-ligne?onglet=affiche&vue=mois`;
  const { data, error } = await sb.functions.invoke('connecter-reseau', { body: { action: 'debut', reseau, boutique: etat.boutique.id, retour } });
  if (error || !data?.url) { toast('Connexion impossible pour le moment. Réessayez plus tard.', 'erreur'); return; }
  window.location.href = data.url;
}

/** Déconnecte un réseau (deconnecter_reseau). */
export async function deconnecterReseau(reseau) {
  const { error } = await sb.rpc('deconnecter_reseau', { p_boutique: etat.boutique.id, p_reseau: reseau });
  if (error) { toast(messageErreur(error), 'erreur'); return false; }
  toast(`${RESEAUX[reseau]?.nom || reseau} déconnecté.`, 'succes');
  return true;
}

/** « 08:00 » → « 8 h », « 18:30 » → « 18 h 30 ». */
export function heureLisible(h) {
  const [hh, mm] = String(h || '08:00').slice(0, 5).split(':');
  return `${Number(hh)} h${mm && mm !== '00' ? ` ${mm}` : ''}`;
}

/** Icône des réseaux (SVG simples, pas de logo officiel copié). */
export function iconeReseau(reseau, taille = 20) {
  if (reseau === 'whatsapp') return icone('whatsapp', taille, 2);
  const chemins = {
    facebook: 'M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v7h4v-7h3l1-4h-4V8z',
    instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zm5 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm5.5-1.5h.01',
    tiktok: 'M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 2.6 2.4 4.4 5 4.6'
  };
  return `<svg width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${chemins[reseau] || ''}"/></svg>`;
}
