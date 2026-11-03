/**
 * lib/drapeaux.js — Drapeaux nationaux dessinés en SVG (étape 15b), pour les ÉTIQUETTES DE COLIS SEULEMENT :
 * elles s'impriment depuis l'ordinateur du bureau, souvent sous Windows, qui écrit « SN » au lieu du drapeau emoji.
 * Partout ailleurs, l'application affiche l'emoji que renvoie la base.
 * Six pays du projet : Sénégal, Guinée, Côte d'Ivoire, Mali, Émirats arabes unis, Chine. Proportions 3:2.
 */

/** Étoile à cinq branches centrée en (cx, cy), rayon r, première pointe dirigée selon angle (degrés, 0 = vers le haut). */
function etoile(cx, cy, r, couleur, angle = 0) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const rayon = i % 2 ? r * 0.382 : r;
    const a = ((angle + i * 36) * Math.PI) / 180;
    points.push(`${(cx + rayon * Math.sin(a)).toFixed(2)},${(cy - rayon * Math.cos(a)).toFixed(2)}`);
  }
  return `<polygon points="${points.join(' ')}" fill="${couleur}"/>`;
}

const bandesVerticales = (a, b, c) => `<rect width="10" height="20" fill="${a}"/><rect x="10" width="10" height="20" fill="${b}"/><rect x="20" width="10" height="20" fill="${c}"/>`;

/** Petites étoiles de la Chine, chacune tournée vers la grande. */
const etoileVers = (x, y) => etoile(x, y, 1, '#FFDE00', (Math.atan2(5 - x, y - 5) * 180) / Math.PI);

const DESSINS = {
  SN: () => bandesVerticales('#00853F', '#FDEF42', '#E31B23') + etoile(15, 10.4, 3.3, '#00853F'),
  GN: () => bandesVerticales('#CE1126', '#FCD116', '#009460'),
  CI: () => bandesVerticales('#F77F00', '#FFFFFF', '#009E60'),
  ML: () => bandesVerticales('#14B53A', '#FCD116', '#CE1126'),
  AE: () => '<rect width="30" height="20" fill="#FFFFFF"/><rect width="30" height="6.67" fill="#00732F"/><rect y="13.33" width="30" height="6.67" fill="#000000"/><rect width="7.5" height="20" fill="#FF0000"/>',
  CN: () => `<rect width="30" height="20" fill="#EE1C25"/>${etoile(5, 5, 3, '#FFDE00')}${etoileVers(10, 2)}${etoileVers(12, 4)}${etoileVers(12, 7)}${etoileVers(10, 9)}`
};

/** Code pays (SN) à partir de l'emoji drapeau (🇸🇳) renvoyé par la base ; '' si ce n'est pas un drapeau. */
export function codeDuDrapeau(emoji) {
  const lettres = [...String(emoji || '')].map((c) => c.codePointAt(0) - 0x1F1E6);
  return lettres.length === 2 && lettres.every((n) => n >= 0 && n < 26) ? String.fromCharCode(65 + lettres[0], 65 + lettres[1]) : '';
}

/** SVG du drapeau d'un pays du projet (hauteur en unités CSS), ou '' si le pays n'est pas dessiné. */
export function drapeauSvg(code, hauteur = '1em') {
  const dessin = DESSINS[String(code || '').toUpperCase()];
  if (!dessin) return '';
  return `<svg class="drapeau-svg" viewBox="0 0 30 20" style="height:${hauteur};width:auto" role="img" aria-label="${code}">${dessin()}<rect width="30" height="20" fill="none" stroke="rgba(0,0,0,.25)" stroke-width=".6"/></svg>`;
}
