/**
 * sw.js — Service worker : met en cache les fichiers statiques de l'application.
 *
 * Règle absolue : AUCUNE requête vers Supabase (*.supabase.co) n'est interceptée ni
 * mise en cache. Seuls les fichiers de ce site (même origine, GET) sont gérés,
 * en « réseau d'abord » : la version en ligne est toujours prioritaire, le cache
 * ne sert qu'en cas de coupure.
 */
const VERSION_CACHE = 'yb-statique-v5';

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
  './js/dashboard.js',
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
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches.open(VERSION_CACHE).then((cache) => cache.addAll(FICHIERS_STATIQUES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((cle) => cle !== VERSION_CACHE).map((cle) => caches.delete(cle))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  const url = new URL(requete.url);

  // Jamais Supabase, jamais d'autre origine, jamais autre chose que GET : le navigateur gère seul.
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;
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
      .catch(() => caches.match(requete).then((enCache) => enCache || caches.match('./index.html')))
  );
});
