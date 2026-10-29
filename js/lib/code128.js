/**
 * code128.js — Encodeur Code 128 B, rendu en SVG (étape 16). Aucune dépendance, aucun accès réseau : fonctions pures.
 *
 *  - jeu B : caractères ASCII 32 à 127 (le numéro de colis « DK260412 ») ;
 *  - chiffre de contrôle : (104 + Σ valeur × position) mod 103 ;
 *  - zone calme de 10 modules de chaque côté (exigée par les lecteurs).
 */

/** Largeurs des barres et espaces de chaque symbole (barre, espace, barre…), 0 à 105, puis l'arrêt (106). */
const MOTIFS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];
const DEBUT_B = 104;
const ARRET = 106;
const ZONE_CALME = 10;

/** Valeurs des symboles (début B, données, contrôle, arrêt). Lève une erreur sur un caractère hors du jeu B. */
export function symbolesCode128(texte) {
  const valeurs = [...String(texte)].map((c) => {
    const code = c.charCodeAt(0);
    if (code < 32 || code > 127) throw new Error(`Caractère impossible en Code 128 B : ${c}`);
    return code - 32;
  });
  const controle = valeurs.reduce((s, v, i) => s + v * (i + 1), DEBUT_B) % 103;
  return [DEBUT_B, ...valeurs, controle, ARRET];
}

/** Suite des largeurs (en modules) : barre, espace, barre… zone calme non comprise. */
export function largeursCode128(texte) {
  return symbolesCode128(texte).flatMap((v) => [...MOTIFS[v]].map(Number));
}

/**
 * SVG du code-barres. options : hauteur (en modules, défaut 50), couleur, texte (afficher le contenu dessous),
 * titre (accessibilité). Le SVG s'étire en largeur (viewBox) : mettez-le à la largeur voulue en CSS.
 */
export function svgCode128(texte, { hauteur = 50, couleur = '#000000', titre = null, texteDessous = false } = {}) {
  const largeurs = largeursCode128(texte);
  const total = largeurs.reduce((s, l) => s + l, 0) + ZONE_CALME * 2;
  const h = hauteur + (texteDessous ? 14 : 0);
  let x = ZONE_CALME;
  const barres = [];
  largeurs.forEach((l, i) => {
    if (i % 2 === 0) barres.push(`M${x} 0h${l}v${hauteur}h-${l}z`);
    x += l;
  });
  const etiquette = String(titre ?? `Code-barres ${texte}`).replace(/[<&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${h}" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="${etiquette}">`
    + `<rect width="${total}" height="${h}" fill="#FFFFFF"/><path fill="${couleur}" d="${barres.join('')}"/>`
    + (texteDessous ? `<text x="${total / 2}" y="${hauteur + 12}" font-family="monospace" font-size="11" text-anchor="middle" fill="${couleur}">${String(texte).replace(/[<&]/g, '')}</text>` : '')
    + '</svg>';
}
