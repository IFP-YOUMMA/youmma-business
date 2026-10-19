/**
 * couverture.js — Couverture par défaut de la boutique en ligne (aucune photo) : dégradé aux couleurs
 * des documents, grand pictogramme discret de l'activité, liseré de la couleur d'accent. Généré en
 * HTML/SVG (aucun fichier). La vitrine publique (js/vitrine.js) en garde sa propre copie, car elle ne
 * charge aucun module de l'appli.
 */
const HEX = /^#[0-9a-f]{6}$/i;

export const PICTOS_ACTIVITE = {
  materiaux: 'M8 30 V16 L24 8 L40 16 V30 M18 30 v-8 h12 v8',
  habillement: 'M14 10 l6 -4 h8 l6 4 l6 8 -6 4 v14 h-20 v-14 l-6 -4z',
  alimentation: 'M10 18 h28 l-3 14 h-22z M16 18 l4 -8 M32 18 l-4 -8',
  services: 'M24 10 a12 12 0 1 0 0.1 0 M24 15 v9 l6 4',
  general: 'M8 18 h32 l-3 -8 h-26z M10 18 v18 h28 v-18 M20 36 v-10 h8 v10'
};
export const LIBELLES_ACTIVITE = { materiaux: 'Matériaux', habillement: 'Habillement', alimentation: 'Alimentation', services: 'Services', general: 'Général' };

export function couvertureDefaut(type, couleur, accent, { etiquette = '' } = {}) {
  const c = HEX.test(couleur || '') ? couleur : '#0F7B5F';
  const a = HEX.test(accent || '') ? accent : '#F2B33D';
  const picto = PICTOS_ACTIVITE[type] || PICTOS_ACTIVITE.general;
  return `<div class="couverture-defaut" style="background:linear-gradient(135deg,${c} 0%,${c}cc 100%)">
    <svg class="couverture-picto" viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${picto}"/></svg>
    <span class="couverture-liseret" style="background:${a}"></span>
    ${etiquette ? `<span class="couverture-etiquette">${etiquette}</span>` : ''}</div>`;
}
