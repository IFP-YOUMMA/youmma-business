/**
 * onglets-vente.js — Onglets de « Caisse & ventes » (étape 14) : Caisse (#/caisse) · Ventes (#/ventes) ·
 * Livraisons (#/ventes?onglet=livraisons, seulement si le module « livraisons » est actif).
 */
import { aModule } from './modules.js';

/** Pastilles d'onglets ; `sombre` pour l'en-tête vert foncé de la caisse. */
export function ongletsVenteHTML(actif, { sombre = false } = {}) {
  const onglets = [
    ['caisse', 'Caisse', '#/caisse'],
    ['ventes', 'Ventes', '#/ventes'],
    ...(aModule('livraisons') ? [['livraisons', 'Livraisons', '#/ventes?onglet=livraisons']] : [])
  ];
  return `
    <nav class="onglets-pastilles onglets-vente ${sombre ? 'onglets-pastilles-sombre' : ''}" aria-label="Caisse & ventes">
      ${onglets.map(([code, libelle, href]) => `<a class="onglet-pastille ${code === actif ? 'actif' : ''}" href="${href}" ${code === actif ? 'aria-current="page"' : ''}>${libelle}</a>`).join('')}
    </nav>`;
}

/** Ajoute les onglets en tête de la page affichée dans `conteneur`. */
export function poserOngletsVente(conteneur, actif) {
  const page = conteneur.querySelector('.page');
  if (!page || page.querySelector(':scope > .onglets-vente')) return;
  page.classList.add('page-avec-onglets');
  page.insertAdjacentHTML('afterbegin', ongletsVenteHTML(actif));
}
