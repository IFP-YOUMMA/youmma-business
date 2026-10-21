/**
 * sw.js — Service worker : met en cache les fichiers statiques de l'application.
 *
 * Règle : AUCUNE requête vers Supabase (*.supabase.co) n'est interceptée ni mise en cache,
 * SAUF les images publiques (…/storage/v1/object/public/…) : cache « d'abord le cache »
 * dédié (yb-images, 400 entrées maximum, les plus anciennes supprimées). Leurs noms de
 * fichiers sont uniques (horodatage) : une image ne change jamais à la même adresse.
 * Jamais de cache pour l'API, l'authentification ni les buckets privés (adresses signées).
 * Les fichiers de ce site (même origine, GET) sont servis en « réseau d'abord ».
 */
const VERSION_CACHE = 'yb-statique-v21';
const CACHE_IMAGES = 'yb-images';
const MAX_IMAGES = 400;

const FICHIERS_STATIQUES = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/config.js',
  './js/supabase.js',
  './js/utils.js',
  './js/state.js',
  './js/router.js',
  './js/auth.js',
  './js/onboarding.js',
  './js/layout.js',
  './js/modules.js',
  './js/mes-modules.js',
  './js/variantes.js',
  './js/variantes-fiche.js',
  './js/unites.js',
  './js/livraisons.js',
  './js/vendor/JsBarcode.all.min.js',
  './js/aujourdhui.js',
  './js/onglets-vente.js',
  './js/boutique-onglets.js',
  './js/option-boutique.js',
  './js/caisse.js',
  './js/stock.js',
  './js/clients-commun.js',
  './js/clients.js',
  './js/recu.js',
  './js/ventes.js',
  './js/depenses.js',
  './js/vendeurs.js',
  './js/rapports.js',
  './js/parametres.js',
  './js/chantiers-commun.js',
  './js/chantiers.js',
  './js/sms.js',
  './js/fournisseurs.js',
  './js/messages.js',
  './js/campagne.js',
  './js/plateforme.js',
  './js/aide.js',
  './js/licence.js',
  // Panneau d'administration YOUMMA (page séparée admin/)
  './admin/index.html',
  './css/admin.css',
  './js/admin/app.js',
  './js/admin/commun.js',
  './js/admin/accueil.js',
  './js/admin/boutiques.js',
  './js/admin/licences.js',
  './js/admin/utilisateurs.js',
  './js/admin/sms.js',
  './js/admin/vitrines.js',
  './js/admin/annonces.js',
  './js/admin/support.js',
  './js/admin/equipe.js',
  './js/admin/parametres.js',
  // Étape 10 : outil d'image unique, identité de la boutique, stockage (admin).
  './js/images/traitement.js',
  './js/images/prereglages.js',
  './js/images/envoi.js',
  './js/images/outil.js',
  './js/images/actions.js',
  './js/images/affichage.js',
  './js/images/couverture.js',
  './js/identite.js',
  './js/admin/stockage.js',
  './js/qr.js',
  './js/vendor/qrcode.js',
  './js/affiche.js',
  './js/affiche-jour.js',
  './js/alertes-commandes.js',
  './js/commandes.js',
  './js/boutique-en-ligne.js',
  // Boutique en ligne publique (page indépendante de l'appli)
  './b/index.html',
  './css/vitrine.css',
  './js/vitrine.js',
  // Étape 9 : documents A4 (page d'impression), devis, réglages, page publique de vérification v/.
  './document.html',
  './css/document.css',
  './js/documents/rendu.js',
  './js/documents/lettres.js',
  './js/documents/donnees.js',
  './js/documents/page.js',
  './js/documents/reglages.js',
  './js/proformas.js',
  './v/index.html',
  './css/verification.css',
  './js/verification.js',
  // Étape 13 : page du chauffeur (d/<jeton>), sans compte
  './d/index.html',
  './css/chauffeur.css',
  './js/chauffeur.js',
  // Étape 7b : affiches pro (polices copiées dans fonts/, licence OFL) et détourage (module seul ;
  // le moteur onnxruntime et le modèle U²-Netp ne sont jamais pré-cachés, voir plus bas).
  './js/detourage.js',
  './fonts/manrope-500.woff2',
  './fonts/manrope-700.woff2',
  './fonts/manrope-800.woff2',
  './fonts/bebas-neue-400.woff2',
  // Identité YOUMMA Business (logo or & vert) : img/logo/ (l'original et l'aperçu og-image ne sont pas pré-cachés).
  './img/logo/youmma-business-symbole.png',
  './img/logo/youmma-business-logo.png',
  './img/logo/youmma-business-logo-fond-fonce.png',
  './img/logo/icon-192.png',
  './img/logo/icon-512.png',
  './img/logo/icon-maskable-192.png',
  './img/logo/icon-maskable-512.png',
  './img/logo/apple-touch-icon.png',
  './img/logo/favicon.ico',
  './img/logo/favicon-32.png',
  './img/logo/favicon-64.png'
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches.open(VERSION_CACHE).then((cache) => cache.addAll(FICHIERS_STATIQUES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches.keys()
      // Seules les anciennes versions statiques sont supprimées (le cache du détourage est gardé).
      .then((cles) => Promise.all(cles.filter((cle) => cle.startsWith('yb-statique-') && cle !== VERSION_CACHE).map((cle) => caches.delete(cle))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  const url = new URL(requete.url);

  // Images publiques du Storage : cache dédié, « d'abord le cache ».
  if (requete.method === 'GET' && url.pathname.includes('/storage/v1/object/public/')) {
    evenement.respondWith(imagePublique(requete));
    return;
  }
  // Jamais le reste de Supabase (API, authentification, fichiers privés), jamais d'autre origine,
  // jamais autre chose que GET : le navigateur gère seul.
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;
  // Détourage (11 Mo de moteur + 4,4 Mo de modèle) : jamais dans le cache statique. Le worker garde
  // le modèle dans son propre cache après le premier téléchargement ; le reste passe par le cache HTTP.
  if (/\/(models\/|js\/vendor\/onnxruntime\/|js\/detourage-worker\.js)/.test(url.pathname)) return;
  if (url.origin !== self.location.origin || requete.method !== 'GET') return;

  evenement.respondWith(
    // no-cache : revalide auprès du serveur (sinon le cache HTTP de 10 min de GitHub Pages peut servir
    // une ancienne version de la CSS ou des modules malgré la stratégie « réseau d'abord »).
    fetch(requete, { cache: 'no-cache' })
      .then((reponse) => {
        if (reponse.ok) {
          const copie = reponse.clone();
          caches.open(VERSION_CACHE).then((cache) => cache.put(requete, copie));
        }
        return reponse;
      })
      .catch(() => caches.match(requete).then((enCache) => enCache || repli(requete, url)))
  );
});

/** Image publique : servie depuis le cache si possible ; sinon téléchargée (CORS) puis gardée. */
async function imagePublique(requete) {
  const cache = await caches.open(CACHE_IMAGES);
  const enCache = await cache.match(requete.url);
  if (enCache) return enCache;
  try {
    const reponse = await fetch(new Request(requete.url, { mode: 'cors', credentials: 'omit' }));
    if (reponse.ok) {
      await cache.put(requete.url, reponse.clone());
      limiterImages(cache);
    }
    return reponse;
  } catch {
    return fetch(requete);
  }
}

/** Garde au plus MAX_IMAGES images (les plus anciennes, en tête de liste, sont supprimées). */
async function limiterImages(cache) {
  const cles = await cache.keys();
  for (let i = 0; i < cles.length - MAX_IMAGES; i++) await cache.delete(cles[i]);
}

/**
 * Hors ligne, rien en cache pour cette adresse :
 *  - page de la boutique en ligne (b/…) → b/index.html (jamais l'appli) ;
 *  - panneau d'administration (admin/…) → admin/index.html (jamais l'appli) ;
 *  - vérification d'un document (v/…) → v/index.html (jamais l'appli) ;
 *  - page du chauffeur (d/…) → d/index.html (jamais l'appli) ;
 *  - page d'impression (document.html) → elle-même si elle est en cache ;
 *  - 404.html et fichiers (JS, CSS, images…) → erreur réseau normale ;
 *  - autre navigation dans l'appli → index.html.
 */
function repli(requete, url) {
  const chemin = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (chemin === 'b' || chemin.startsWith('b/')) {
    return requete.mode === 'navigate' ? caches.match('./b/index.html').then((r) => r || Response.error()) : Response.error();
  }
  // Panneau d'administration : sa propre page, jamais l'index.html de l'appli.
  if (chemin === 'admin' || chemin.startsWith('admin/')) {
    return requete.mode === 'navigate' ? caches.match('./admin/index.html').then((r) => r || Response.error()) : Response.error();
  }
  // Vérification publique des documents : sa propre page, jamais l'index.html de l'appli.
  if (chemin === 'v' || chemin.startsWith('v/')) {
    return requete.mode === 'navigate' ? caches.match('./v/index.html').then((r) => r || Response.error()) : Response.error();
  }
  // Page du chauffeur (livraison à signer) : sa propre page, jamais l'index.html de l'appli.
  if (chemin === 'd' || chemin.startsWith('d/')) {
    return requete.mode === 'navigate' ? caches.match('./d/index.html').then((r) => r || Response.error()) : Response.error();
  }
  if (chemin === 'document.html') {
    return requete.mode === 'navigate' ? caches.match('./document.html').then((r) => r || Response.error()) : Response.error();
  }
  if (requete.mode !== 'navigate' || chemin === '404.html') return Response.error();
  return caches.match('./index.html').then((r) => r || Response.error());
}

