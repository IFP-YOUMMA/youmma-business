/**
 * qr.js — QR codes générés dans le navigateur (bibliothèque libre js/vendor/qrcode.js, licence MIT).
 * Aucun service externe : le lien de la boutique est encodé localement.
 */
import qrcode from './vendor/qrcode.js';

qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

/** Matrice du QR code : { taille, noir(l, c) }. Niveau de correction M (lisible même imprimé petit). */
export function matriceQr(texte, niveau = 'M') {
  const qr = qrcode(0, niveau);
  qr.addData(texte);
  qr.make();
  const taille = qr.getModuleCount();
  return { taille, noir: (l, c) => qr.isDark(l, c) };
}

/**
 * Dessine le QR code dans un contexte canvas, carré de `cote` px en (x, y), avec une marge
 * blanche de 2 modules (zone de silence) comprise dans le carré.
 */
export function dessinerQr(ctx, texte, x, y, cote, { couleur = '#0A3D33', fond = '#FFFFFF' } = {}) {
  const { taille, noir } = matriceQr(texte);
  const marge = 2;
  const module = cote / (taille + marge * 2);
  ctx.fillStyle = fond;
  ctx.fillRect(x, y, cote, cote);
  ctx.fillStyle = couleur;
  for (let l = 0; l < taille; l++) {
    for (let c = 0; c < taille; c++) {
      if (noir(l, c)) {
        // Arrondis au pixel près (évite les fines lignes blanches entre modules).
        const x0 = Math.floor(x + (c + marge) * module);
        const y0 = Math.floor(y + (l + marge) * module);
        ctx.fillRect(x0, y0, Math.ceil(x + (c + marge + 1) * module) - x0, Math.ceil(y + (l + marge + 1) * module) - y0);
      }
    }
  }
}

/** QR code en SVG (impression nette à toute taille). */
export function svgQr(texte, { couleur = '#0A3D33', titre = 'QR code' } = {}) {
  const { taille, noir } = matriceQr(texte);
  const marge = 2;
  const total = taille + marge * 2;
  let chemin = '';
  for (let l = 0; l < taille; l++) {
    for (let c = 0; c < taille; c++) if (noir(l, c)) chemin += `M${c + marge} ${l + marge}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="${titre.replace(/"/g, '&quot;')}"><rect width="${total}" height="${total}" fill="#FFFFFF"/><path d="${chemin}" fill="${couleur}"/></svg>`;
}
