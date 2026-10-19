/**
 * affichage.js — Affichage léger des images : les listes utilisent la miniature (photo_mini_url, ≈ 25 Ko),
 * avec repli sur la grande photo puis sur l'icône par défaut ; chargement différé, taille fixée
 * (pas de saut de mise en page), fond neutre pendant le chargement (classe CSS .img-chargement).
 */
import { esc } from '../utils.js';

const REPLI = "if(this.dataset.repli){var r=this.dataset.repli;this.removeAttribute('data-repli');this.src=r;}else{this.parentNode&&this.parentNode.classList.add('img-absente');this.remove();}";

/** Miniature d'un article ({ photo_mini_url, photo_url }) ; repli : HTML affiché s'il n'y a aucune photo. */
export function vignetteProduit(p, taille = 44, repli = '') {
  const mini = p?.photo_mini_url || null;
  const grande = p?.photo_url || null;
  if (!mini && !grande) return repli;
  return `<img class="img-chargement" src="${esc(mini || grande)}" ${mini && grande ? `data-repli="${esc(grande)}"` : ''} alt="" width="${taille}" height="${taille}" loading="lazy" decoding="async" onerror="${REPLI}">`;
}

/** Grande photo d'un article (fiche) ; repli sur la miniature. */
export function photoProduit(p, taille = 1080, alt = '') {
  const grande = p?.photo_url || p?.photo_mini_url;
  if (!grande) return '';
  return `<img class="img-chargement" src="${esc(grande)}" alt="${esc(alt)}" width="${taille}" height="${taille}" decoding="async" onerror="${REPLI}">`;
}
