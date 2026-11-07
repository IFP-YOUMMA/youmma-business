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
const VERSION_CACHE = 'yb-statique-v54';
const CACHE_IMAGES = 'yb-images';
const MAX_IMAGES = 400;

/**
 * Étape 28 — seul le noyau est pré-téléchargé à chaque mise à jour : la coquille, les feuilles de style du démarrage,
 * les icônes, et les modules que js/app.js importe statiquement (directement ou par ceux qu'il importe).
 * Étape 29 : la police Manrope (fonts/, déclarée dans app.css) en fait partie, pour que l'appli s'affiche correctement
 * sans réseau ; colis.css et les feuilles de la direction n'en font plus partie (chargées par leurs écrans).
 * Les écrans (chargés à leur première ouverture), les pages publiques (b/, a/, c/…), la police Bebas des affiches et le
 * détourage ne sont pas dans cette liste : le gestionnaire fetch les met en cache quand ils sont ouverts une première fois.
 * Conséquence acceptée : un écran jamais ouvert depuis la dernière mise à jour ne s'ouvre pas sans réseau.
 */
const FICHIERS_STATIQUES = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './css/marche.css',
  './fonts/manrope-500.woff2',
  './fonts/manrope-700.woff2',
  './fonts/manrope-800.woff2',
  // Noyau : modules importés au démarrage (graphe statique de js/app.js).
  './js/admin/commun.js',
  './js/admin/console/commun.js',
  './js/aide.js',
  './js/alertes-commandes.js',
  './js/app.js',
  './js/auth.js',
  './js/commission-commun.js',
  './js/config.js',
  './js/depannage.js',
  './js/direction/administration.js',
  './js/direction/commun.js',
  './js/direction/shell.js',
  './js/facturation.js',
  './js/installation.js',
  './js/layout.js',
  './js/lib/telephone.js',
  './js/mes-modules.js',
  './js/modes-paiement.js',
  './js/modules.js',
  './js/onboarding.js',
  './js/plateforme.js',
  './js/router.js',
  './js/sms.js',
  './js/state.js',
  './js/supabase.js',
  './js/utils.js',
  './img/logo/youmma-business-symbole.webp',
  './img/logo/youmma-business-logo.webp',
  './img/logo/youmma-business-logo-fond-fonce.webp',
  './img/logo/icon-192.png',
  './img/logo/icon-512.png',
  './img/logo/icon-maskable-192.png',
  './img/logo/icon-maskable-512.png',
  './img/logo/apple-touch-icon.png',
  './img/logo/favicon.ico',
  './img/logo/favicon-32.png',
  './img/logo/favicon-64.png'
];

/**
 * Les images du logo, les icônes et la police ne changent pas d'une version à l'autre : reprises de la version
 * précédente si elles y sont, téléchargées sinon. Tout le reste du noyau est retéléchargé (cache: 'reload').
 */
const reutilisable = (f) => f.startsWith('./img/') || f.startsWith('./fonts/');
self.addEventListener('install', (evenement) => {
  evenement.waitUntil((async () => {
    const cache = await caches.open(VERSION_CACHE);
    const aTelecharger = [];
    for (const f of FICHIERS_STATIQUES) {
      const ancien = reutilisable(f) ? await caches.match(f) : null;
      if (ancien) await cache.put(f, ancien); else aTelecharger.push(new Request(f, { cache: 'reload' }));
    }
    await cache.addAll(aTelecharger);
    await self.skipWaiting();
  })());
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
 *  - suivi d'un colis (c/…), photos au téléphone (p/…), relevé d'un compte (m/…), simulateur (s/…), marché (a/…),
 *    relevé d'un vendeur (f/…) → leur propre page ;
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
  // Suivi public d'un colis et photos prises au téléphone : leurs propres pages.
  for (const dossier of ['c', 'p', 'm', 's', 'a', 'f']) {
    if (chemin === dossier || chemin.startsWith(`${dossier}/`)) {
      return requete.mode === 'navigate' ? caches.match(`./${dossier}/index.html`).then((r) => r || Response.error()) : Response.error();
    }
  }
  if (chemin === 'document.html') {
    return requete.mode === 'navigate' ? caches.match('./document.html').then((r) => r || Response.error()) : Response.error();
  }
  if (requete.mode !== 'navigate' || chemin === '404.html') return Response.error();
  return caches.match('./index.html').then((r) => r || Response.error());
}

