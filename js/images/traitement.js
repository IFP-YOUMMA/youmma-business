/**
 * traitement.js — Traitement des images dans le navigateur (aucun envoi) : lecture avec l'orientation
 * de l'appareil photo (EXIF), rotation, recadrage, retrait du fond blanc, masque rond, réduction,
 * encodage WebP (repli JPEG/PNG si le navigateur ne sait pas produire de WebP) et couleurs dominantes.
 */

/** Charge un fichier/Blob en image redressée selon l'EXIF ; renvoie un canvas (plus simple à manipuler). */
export async function chargerCanvas(source) {
  let image = null;
  if ('createImageBitmap' in window) {
    try { image = await createImageBitmap(source, { imageOrientation: 'from-image' }); } catch { image = null; }
  }
  if (!image) {
    // Repli : <img> (les navigateurs récents appliquent aussi l'orientation EXIF par défaut).
    const url = URL.createObjectURL(source);
    try {
      image = new Image();
      image.src = url;
      await image.decode();
    } catch {
      throw Object.assign(new Error('Image illisible'), { code: 'IMAGE_ILLISIBLE' });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const l = image.width || image.naturalWidth;
  const h = image.height || image.naturalHeight;
  if (!l || !h) throw Object.assign(new Error('Image illisible'), { code: 'IMAGE_ILLISIBLE' });
  // Les photos de téléphone (12 Mo, 4000 px) sont ramenées à 2400 px pour travailler vite.
  const echelle = Math.min(1, 2400 / Math.max(l, h));
  const c = canvas(Math.round(l * echelle), Math.round(h * echelle));
  c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
  image.close?.();
  return c;
}

export function canvas(l, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(l));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Rotation d'un quart de tour (sens horaire). */
export function pivoter(source) {
  const c = canvas(source.height, source.width);
  const ctx = c.getContext('2d');
  ctx.translate(c.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(source, 0, 0);
  return c;
}

/** Découpe { x, y, l, h } (en pixels de la source) ; rond : masque circulaire transparent. */
export function recadrer(source, zone, { rond = false } = {}) {
  const x = Math.max(0, Math.round(zone.x));
  const y = Math.max(0, Math.round(zone.y));
  const l = Math.max(1, Math.min(source.width - x, Math.round(zone.l)));
  const h = Math.max(1, Math.min(source.height - y, Math.round(zone.h)));
  const c = canvas(l, h);
  const ctx = c.getContext('2d');
  if (rond) {
    ctx.beginPath();
    ctx.ellipse(l / 2, h / 2, l / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.drawImage(source, x, y, l, h, 0, 0, l, h);
  return c;
}

/**
 * Rend transparent tout ce qui est plus clair que le seuil (0-255), avec un fondu de 24 niveaux pour garder
 * des bords propres ; rogner : recadre sur le dessin (marge 6 px). Renvoie un canvas (null si tout est blanc).
 */
export function retirerFond(source, seuil = 200, { rogner = true, coteMax = 1200 } = {}) {
  const echelle = Math.min(1, coteMax / Math.max(source.width, source.height));
  const l = Math.max(1, Math.round(source.width * echelle));
  const h = Math.max(1, Math.round(source.height * echelle));
  const c = canvas(l, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, l, h);
  const img = ctx.getImageData(0, 0, l, h);
  const d = img.data;
  const fondu = 24;
  let x0 = l, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const i = (y * l + x) * 4;
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let alpha = lum >= seuil ? 0 : lum <= seuil - fondu ? 255 : Math.round(((seuil - lum) / fondu) * 255);
      alpha = Math.min(alpha, d[i + 3]);
      d[i + 3] = alpha;
      if (alpha > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return null;
  ctx.putImageData(img, 0, 0);
  if (!rogner) return c;
  const m = 6;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(l - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
  const sortie = canvas(x1 - x0 + 1, y1 - y0 + 1);
  sortie.getContext('2d').drawImage(c, x0, y0, sortie.width, sortie.height, 0, 0, sortie.width, sortie.height);
  return sortie;
}

/** Vrai si l'image a des pixels transparents (bords testés + échantillon). */
export function aDeLaTransparence(source) {
  try {
    const c = canvas(Math.min(64, source.width), Math.min(64, source.height));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  } catch { /* image d'une autre origine */ }
  return false;
}

/**
 * Redimensionne : { cote } = côté le plus long maximum ; { largeur, hauteur } = taille exacte
 * (la source doit déjà avoir le bon rapport) ; carre : place l'image au centre d'un carré transparent.
 */
export function redimensionner(source, { cote = null, largeur = null, hauteur = null, carre = false, fondBlanc = false } = {}) {
  let l;
  let h;
  if (largeur && hauteur) { l = largeur; h = hauteur; }
  else {
    const e = Math.min(1, (cote || Math.max(source.width, source.height)) / Math.max(source.width, source.height));
    l = source.width * e; h = source.height * e;
  }
  const c = carre ? canvas(Math.max(l, h), Math.max(l, h)) : canvas(l, h);
  const ctx = c.getContext('2d');
  if (fondBlanc) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.imageSmoothingQuality = 'high';
  // Réduction en plusieurs passes (moins de crénelage qu'un seul drawImage sur une grande photo).
  let src = source;
  while (src.width > c.width * 2 && src.height > c.height * 2) {
    const tmp = canvas(src.width / 2, src.height / 2);
    const t = tmp.getContext('2d');
    t.imageSmoothingQuality = 'high';
    t.drawImage(src, 0, 0, tmp.width, tmp.height);
    src = tmp;
  }
  ctx.drawImage(src, (c.width - l) / 2, (c.height - h) / 2, l, h);
  return c;
}

let webpTeste = null;
/** Vrai si le navigateur sait produire du WebP (Chrome, Edge, Firefox, Android). */
export async function webpDisponible() {
  if (webpTeste !== null) return webpTeste;
  if (window.__ybSansWebp) { webpTeste = false; return false; }
  const b = await new Promise((ok) => canvas(2, 2).toBlob(ok, 'image/webp', 0.8));
  webpTeste = Boolean(b && b.type === 'image/webp');
  return webpTeste;
}

const versBlob = (c, type, qualite) => new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error('Encodage impossible'))), type, qualite));

/**
 * Encode en WebP (repli : PNG si transparent, JPEG sinon), en baissant la qualité puis la taille
 * jusqu'à passer sous tailleMax. Renvoie { blob, type, extension, largeur, hauteur }.
 */
export async function encoder(source, { qualite = 0.8, tailleMax = Infinity, transparent = false, forcer = null, tailleFixe = false } = {}) {
  const webp = forcer ? false : await webpDisponible();
  const type = forcer === 'png' ? 'image/png' : forcer === 'jpeg' ? 'image/jpeg' : webp ? 'image/webp' : transparent ? 'image/png' : 'image/jpeg';
  let c = source;
  if (type === 'image/jpeg') c = redimensionner(source, { largeur: source.width, hauteur: source.height, fondBlanc: true });
  let q = qualite;
  let blob = await versBlob(c, type, q);
  for (let essai = 0; essai < 8 && blob.size > tailleMax; essai++) {
    // Taille fixe (couverture 1600×900) : on baisse seulement la qualité ; sinon qualité puis dimensions.
    const plancher = tailleFixe ? 0.3 : 0.5;
    if (type !== 'image/png' && q > plancher) q = Math.max(plancher, q - 0.1);
    else if (tailleFixe) break;
    else c = redimensionner(c, { cote: Math.max(c.width, c.height) * 0.85, fondBlanc: !transparent });
    blob = await versBlob(c, type, q);
  }
  return { blob, type, extension: { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[type], largeur: c.width, hauteur: c.height };
}

/** Deux couleurs dominantes (hors blanc, noir et transparent), en #RRGGBB, pour les documents. */
export function couleursDominantes(source) {
  const c = canvas(Math.min(96, source.width), Math.min(96, source.height));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, c.width, c.height);
  let d;
  try { d = ctx.getImageData(0, 0, c.width, c.height).data; } catch { return []; }
  const comptes = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 235 && min > 225) continue; // blanc
    if (max < 28) continue; // noir
    const cle = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = comptes.get(cle) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    comptes.set(cle, e);
  }
  const classees = [...comptes.values()].sort((a, b) => b.n - a.n).map((e) => [e.r / e.n, e.g / e.n, e.b / e.n]);
  const choisies = [];
  for (const coul of classees) {
    if (choisies.every((x) => Math.hypot(x[0] - coul[0], x[1] - coul[1], x[2] - coul[2]) > 80)) choisies.push(coul);
    if (choisies.length === 2) break;
  }
  return choisies.map((t) => '#' + t.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase());
}
