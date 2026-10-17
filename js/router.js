/**
 * router.js — Routeur par hash : « #/stock?q=ciment » → { nom: 'stock', params }.
 */

let resolveur = null;

/** Lit la route courante depuis l'URL. */
export function lireRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [chemin, requete] = hash.split('?');
  return { nom: chemin || '', params: new URLSearchParams(requete || '') };
}

/**
 * Change de page. `chemin` : 'stock', 'stock?q=x' ou '#/stock'.
 * remplacer : true pour ne pas ajouter d'entrée dans l'historique (redirections).
 */
export function naviguer(chemin, { remplacer = false } = {}) {
  const cible = chemin.startsWith('#') ? chemin : '#/' + chemin.replace(/^\//, '');
  if (location.hash === cible) {
    resolveur?.();
    return;
  }
  if (remplacer) location.replace(cible);
  else location.hash = cible;
}

/** Démarre l'écoute des changements de hash et affiche la page courante. */
export function demarrerRouteur(resoudre) {
  resolveur = resoudre;
  window.addEventListener('hashchange', resoudre);
  resoudre();
}
