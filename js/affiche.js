/**
 * affiche.js — Les 9 affiches du jour dessinées dans un <canvas> (étape 15, maquette AfficheModeles.dc.html).
 *
 * Deux choix séparés : le THÈME (ce que l'affiche raconte : produit · promo · lundi · vendredi · fete · arrivage ·
 * horaires · merci · saison) et l'HABILLAGE (à quoi elle ressemble : catalogue · impact · selection · photo · message).
 * Le thème ajoute ses éléments (date, croissant, tampon, horaires, 🤝 et vrai chiffre, émoji météo) à l'habillage.
 * Toujours aux couleurs de la boutique (boutique.couleur, boutique.accent), logo en haut à gauche
 * (jamais déformé), pied « téléphone · commune, ville ». Jamais de texte blanc sur l'or : sur l'accent,
 * le texte est foncé.
 * Trois formats du même dessin (recomposé, jamais étiré) : 4:5 (1080 × 1350), 9:16 (1080 × 1920),
 * 1:1 (1080 × 1080). Mise en page par blocs : la taille des textes se réduit jusqu'à ce que tout tienne.
 * Export JPEG qualité 0,82 (≤ 200 Ko visé) ; vidéo MP4 de 5 s (zoom lent) si le navigateur sait l'enregistrer.
 * Rien n'est envoyé à un serveur pour fabriquer l'image.
 * Polices Manrope et Bebas Neue (fonts/, licence OFL) chargées par FontFace.
 */
import { formatNombre, formatTelephone, FUSEAU } from './utils.js';

export const FORMATS_AFFICHE = {
  '4:5': { largeur: 1080, hauteur: 1350, libelle: 'Facebook · Instagram 4:5', fichier: '4x5' },
  '9:16': { largeur: 1080, hauteur: 1920, libelle: 'Statut · Story · TikTok 9:16', fichier: '9x16' },
  '1:1': { largeur: 1080, hauteur: 1080, libelle: 'Carré 1:1', fichier: '1x1' }
};
export const THEMES_AFFICHE = ['produit', 'promo', 'lundi', 'vendredi', 'fete', 'arrivage', 'horaires', 'merci', 'saison'];
export const COULEUR_DEFAUT = '#0F7B5F';
export const ACCENT_DEFAUT = '#F2B33D';

/* ------------------------------------------------------------ Polices */

const MANROPE = 'YB Manrope';
const BEBAS = 'YB Bebas';
let policesPromesse = null;
function chargerPolices() {
  if (!policesPromesse) {
    const url = (f) => new URL(`../fonts/${f}`, import.meta.url).href;
    const faces = [
      new FontFace(MANROPE, `url(${url('manrope-500.woff2')}) format('woff2')`, { weight: '500' }),
      new FontFace(MANROPE, `url(${url('manrope-700.woff2')}) format('woff2')`, { weight: '700' }),
      new FontFace(MANROPE, `url(${url('manrope-800.woff2')}) format('woff2')`, { weight: '800' }),
      new FontFace(BEBAS, `url(${url('bebas-neue-400.woff2')}) format('woff2')`, { weight: '400' })
    ];
    policesPromesse = Promise.all(faces.map((f) => f.load().then((p) => document.fonts.add(p)).catch(() => null)))
      .then(() => document.fonts.ready).catch(() => null);
  }
  return policesPromesse;
}
const mf = (poids, taille) => `${poids} ${Math.round(taille)}px "${MANROPE}", Manrope, system-ui, sans-serif`;
const bf = (taille) => `400 ${Math.round(taille)}px "${BEBAS}", "Bebas Neue", Impact, "Arial Narrow", sans-serif`;

/* ------------------------------------------------------------ Outils de dessin */

function chargerImageDistante(url) {
  return new Promise((resoudre) => {
    if (!url) { resoudre(null); return; }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    const minuteur = setTimeout(() => resoudre(null), 10000);
    image.onload = () => { clearTimeout(minuteur); resoudre(image); };
    image.onerror = () => { clearTimeout(minuteur); resoudre(null); };
    image.src = url;
  });
}

/** Vrai si l'image a de la transparence sur ses bords (photo détourée). */
function estDetouree(image) {
  try {
    const c = document.createElement('canvas');
    c.width = 48; c.height = 48;
    const ctx = c.getContext('2d');
    ctx.drawImage(image, 0, 0, 48, 48);
    const d = ctx.getImageData(0, 0, 48, 48).data;
    let transparents = 0;
    let total = 0;
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        if (x > 2 && x < 45 && y > 2 && y < 45) continue; // seulement les bords
        total++;
        if (d[(y * 48 + x) * 4 + 3] < 200) transparents++;
      }
    }
    return transparents / total > 0.35;
  } catch { return false; }
}

function rectArrondi(ctx, x, y, l, h, r) {
  const rr = Math.min(r, l / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + l, y, x + l, y + h, rr);
  ctx.arcTo(x + l, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + l, y, rr);
  ctx.closePath();
}

function espacement(ctx, valeur) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${valeur}px`;
}

/** Plus grande taille (entre max et min) pour que le texte tienne sur une ligne. */
function ajusterTaille(ctx, texte, largeurMax, tailleMax, tailleMin, police) {
  for (let t = tailleMax; t > tailleMin; t -= 2) {
    ctx.font = police(t);
    if (ctx.measureText(texte).width <= largeurMax) return t;
  }
  ctx.font = police(tailleMin);
  return tailleMin;
}

/** Découpe en lignes (maxLignes) ; la dernière finit par « … » si besoin. */
function couperLignes(ctx, texte, largeurMax, maxLignes) {
  const mots = String(texte || '').trim().split(/[ \t\n\r]+/).filter(Boolean);
  const lignes = [];
  let courante = '';
  for (let i = 0; i < mots.length; i++) {
    const essai = courante ? `${courante} ${mots[i]}` : mots[i];
    if (ctx.measureText(essai).width <= largeurMax || !courante) courante = essai;
    else {
      lignes.push(courante);
      courante = mots[i];
      if (lignes.length === maxLignes) { lignes[maxLignes - 1] += ` ${mots.slice(i).join(' ')}`; courante = ''; break; }
    }
  }
  if (courante) lignes.push(courante);
  const res = lignes.slice(0, maxLignes);
  const n = res.length - 1;
  if (n >= 0 && (lignes.length > maxLignes || ctx.measureText(res[n]).width > largeurMax)) {
    let l = res[n];
    while (l.length > 1 && ctx.measureText(`${l}…`).width > largeurMax) l = l.slice(0, -1);
    res[n] = `${l.trimEnd()}…`;
  }
  return res;
}

/** Texte sur plusieurs lignes : taille réduite jusqu'à tenir en maxLignes sans « … » (si possible). */
function ajusterBloc(ctx, texte, largeurMax, maxLignes, tailleMax, tailleMin, police) {
  for (let t = tailleMax; t >= tailleMin; t -= 2) {
    ctx.font = police(t);
    const motsOk = String(texte).split(/[ \t\n\r]+/).every((m) => ctx.measureText(m).width <= largeurMax);
    const lignes = couperLignes(ctx, texte, largeurMax, maxLignes);
    if (motsOk && !lignes.at(-1)?.endsWith('…')) return { taille: t, lignes };
  }
  ctx.font = police(tailleMin);
  return { taille: tailleMin, lignes: couperLignes(ctx, texte, largeurMax, maxLignes) };
}

function initiales(nom) {
  const mots = String(nom || '').trim().split(/\s+/).filter(Boolean);
  return ((mots[0]?.[0] || '') + (mots[1]?.[0] || '')).toUpperCase() || 'Y';
}

const prixTexte = (n) => formatNombre(Math.round(Number(n) || 0)).replace(/ /g, ' ');

/** Ombre portée douce au sol (ellipse floutée). */
function ombreSol(ctx, cx, cy, rx, ry, opacite = 0.4) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(0,0,0,${opacite})`);
  g.addColorStop(0.6, `rgba(0,0,0,${opacite * 0.35})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------ Familles d'articles et illustrations */

const FAMILLES = [
  ['sac', /\b(ciment|cpj|cpa|chaux|pl[aâ]tre|mortier|colle|enduit|sac|riz|farine|sucre|engrais)\b/i],
  ['tuyau', /\b(tuyau|pvc|plomberie|robinet|coude|raccord|sanitaire|pompe)\b/i],
  ['cable', /(c[aâ]ble|fil [ée]lectrique|[ée]lectri|ampoule|disjoncteur|interrupteur|rallonge)/i],
  ['tole', /\b(t[oô]le|bac|ondul[ée]e?|toiture|couverture|faîti[eè]re)\b/i],
  ['carreau', /\b(carreaux?|carrelage|fa[iï]ence|gr[eè]s|dalle|pav[ée])\b/i],
  ['barre', /(\bfer\b|acier|\bbarres?\b|ø|torsad[ée]|treillis|cornière)/i],
  ['seau', /\b(peinture|vernis|seau|laque|glyc[ée]ro|pot|bidon)\b/i],
  ['bois', /\b(bois|planche|chevron|madrier|contreplaqu[ée]|latte|porte)\b/i],
  ['chaussure', /\b(chaussure|basket|sandale|botte|tong|escarpin|mocassin)\b/i],
  ['vetement', /\b(pagne|robe|chemise|t-?shirt|pantalon|boubou|bazin|tissu|wax|v[eê]tement|jupe|veste|tenue)\b/i],
  ['carton', /\b(carton|lait|conserve|boisson|eau|savon|huile|biscuit|alimentation|pack|paquet)\b/i]
];
export function familleArticle(produit = {}) {
  const texte = `${produit.nom || ''} ${produit.categorie || ''} ${produit.unite || ''}`;
  for (const [famille, re] of FAMILLES) if (re.test(texte)) return famille;
  if (/^(sac)$/i.test(produit.unite)) return 'sac';
  if (/^(barre)$/i.test(produit.unite)) return 'barre';
  if (/^(feuille|tôle)$/i.test(produit.unite)) return 'tole';
  if (/^(seau|litre)$/i.test(produit.unite)) return 'seau';
  if (/^(m²|m2)$/i.test(produit.unite)) return 'carreau';
  return 'generique';
}

function degrade(ctx, x0, y0, x1, y1, arrets) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  arrets.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

/** Chaque illustration est dessinée dans sa propre boîte de référence (vb), puis mise à l'échelle. */
const ILLUSTRATIONS = {
  sac: { vb: [230, 290], dessin(ctx, { etiquette, sousEtiquette }) {
    ctx.fillStyle = degrade(ctx, 26, 0, 206, 0, [[0, '#CFC8B8'], [0.5, '#ECE7DB'], [1, '#BDB5A3']]);
    ctx.beginPath(); ctx.moveTo(40, 30); ctx.quadraticCurveTo(115, 8, 192, 30); ctx.lineTo(206, 250); ctx.quadraticCurveTo(118, 274, 26, 250); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#B3AB98';
    ctx.beginPath(); ctx.moveTo(40, 30); ctx.quadraticCurveTo(115, 8, 192, 30); ctx.lineTo(190, 48); ctx.quadraticCurveTo(115, 30, 42, 48); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0A5E48'; rectArrondi(ctx, 44, 96, 146, 96, 6); ctx.fill();
    ctx.fillStyle = '#0F7B5F'; rectArrondi(ctx, 44, 96, 146, 22, 6); ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = '#FFFFFF';
    ctx.font = mf(800, 12); ctx.fillText(etiquette.slice(0, 16), 117, 112);
    if (sousEtiquette) { ajusterTaille(ctx, sousEtiquette, 130, 36, 16, bf); ctx.fillText(sousEtiquette, 117, 154); }
    ctx.strokeStyle = '#A39B87'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(60, 210); ctx.quadraticCurveTo(117, 220, 176, 210); ctx.stroke();
    ctx.textAlign = 'left';
  } },
  tole: { vb: [270, 230], dessin(ctx) {
    ctx.save();
    ctx.transform(1, Math.tan(-14 * Math.PI / 180), 0, 1, 0, 60);
    ctx.beginPath(); ctx.moveTo(20, 40);
    for (let i = 0; i < 9; i++) { ctx.quadraticCurveTo(20 + i * 24 + 12, 24, 20 + i * 24 + 24, 40); }
    ctx.lineTo(236, 150);
    for (let i = 8; i >= 0; i--) { ctx.quadraticCurveTo(20 + i * 24 + 12, 166, 20 + i * 24, 150); }
    ctx.closePath();
    ctx.fillStyle = degrade(ctx, 0, 0, 236, 190, [[0, '#DDE6F2'], [0.45, '#9AAFC8'], [0.6, '#F3F7FC'], [1, '#7D93B0']]);
    ctx.fill(); ctx.strokeStyle = '#6F86A6'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(20, 58);
    for (let i = 0; i < 9; i++) ctx.quadraticCurveTo(20 + i * 24 + 12, 42, 20 + i * 24 + 24, 58);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.stroke();
    for (let i = 1; i < 9; i++) { ctx.beginPath(); ctx.moveTo(20 + i * 24, 40); ctx.lineTo(20 + i * 24, 150); ctx.strokeStyle = 'rgba(80,100,130,0.18)'; ctx.stroke(); }
    ctx.restore();
  } },
  barre: { vb: [260, 230], dessin(ctx) {
    for (let i = 0; i < 7; i++) {
      const y = 70 + i * 13;
      ctx.save(); ctx.translate(130, y); ctx.rotate(-0.32);
      ctx.fillStyle = degrade(ctx, 0, -6, 0, 6, [[0, '#9AA5B1'], [0.45, '#E3E8EE'], [1, '#55606C']]);
      rectArrondi(ctx, -115, -6, 230, 12, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(40,48,58,0.35)'; ctx.lineWidth = 1.4;
      for (let k = -108; k < 112; k += 9) { ctx.beginPath(); ctx.moveTo(k, -6); ctx.lineTo(k + 5, 6); ctx.stroke(); }
      ctx.restore();
    }
    ctx.strokeStyle = '#2E3A46'; ctx.lineWidth = 4;
    [[70, 130], [190, 92]].forEach(([x, y]) => { ctx.beginPath(); ctx.ellipse(x, y + 22, 9, 52, -0.32, 0, Math.PI * 2); ctx.stroke(); });
  } },
  seau: { vb: [230, 290], dessin(ctx, { etiquette }) {
    ctx.strokeStyle = '#7D8794'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(115, 72, 78, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    ctx.fillStyle = degrade(ctx, 40, 0, 190, 0, [[0, '#D9DEE5'], [0.45, '#FFFFFF'], [1, '#C3CAD3']]);
    ctx.beginPath(); ctx.moveTo(42, 78); ctx.lineTo(188, 78); ctx.lineTo(172, 252); ctx.quadraticCurveTo(115, 266, 58, 252); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#C43E00'; ctx.beginPath(); ctx.moveTo(48, 130); ctx.lineTo(182, 130); ctx.lineTo(177, 200); ctx.lineTo(53, 200); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ajusterTaille(ctx, etiquette, 116, 30, 14, bf); ctx.fillText(etiquette, 115, 175);
    ctx.font = mf(800, 11); ctx.fillStyle = '#FFE0C2'; ctx.fillText('INTÉRIEUR · EXTÉRIEUR', 115, 192); ctx.textAlign = 'left';
    ctx.fillStyle = degrade(ctx, 40, 0, 190, 0, [[0, '#AEB7C2'], [0.5, '#EEF1F5'], [1, '#A2ACB8']]);
    ctx.beginPath(); ctx.ellipse(115, 78, 76, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8B95A2'; ctx.lineWidth = 2; ctx.stroke();
  } },
  carreau: { vb: [260, 230], dessin(ctx) {
    for (let i = 4; i >= 0; i--) {
      const y = 70 + i * 16;
      ctx.fillStyle = i === 0 ? degrade(ctx, 40, y, 220, y + 60, [[0, '#F7F2EA'], [0.5, '#E6DCCB'], [1, '#F4EEE4']]) : '#CFC3AE';
      ctx.beginPath(); ctx.moveTo(130, y); ctx.lineTo(230, y + 40); ctx.lineTo(130, y + 80); ctx.lineTo(30, y + 40); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120,100,70,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(160,140,110,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, 90); ctx.lineTo(180, 130); ctx.moveTo(180, 90); ctx.lineTo(80, 130); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.moveTo(120, 78); ctx.lineTo(160, 94); ctx.lineTo(130, 106); ctx.lineTo(92, 90); ctx.closePath(); ctx.fill();
  } },
  bois: { vb: [260, 230], dessin(ctx) {
    for (let i = 0; i < 4; i++) {
      const y = 60 + i * 30;
      ctx.save(); ctx.translate(130, y); ctx.rotate(-0.12);
      ctx.fillStyle = degrade(ctx, 0, -14, 0, 14, [[0, '#E3B477'], [0.5, '#C98C4B'], [1, '#9A6532']]);
      rectArrondi(ctx, -112, -14, 224, 26, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(110,60,20,0.35)'; ctx.lineWidth = 1.2;
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-110, -8 + k * 5); ctx.bezierCurveTo(-40, -14 + k * 6, 30, -2 + k * 4, 110, -9 + k * 5); ctx.stroke(); }
      ctx.fillStyle = '#B07A40'; rectArrondi(ctx, 104, -14, 8, 26, 2); ctx.fill();
      ctx.restore();
    }
  } },
  tuyau: { vb: [260, 230], dessin(ctx) {
    ctx.fillStyle = degrade(ctx, 0, 90, 0, 140, [[0, '#9AA4AE'], [0.35, '#EEF1F4'], [1, '#7E8892']]);
    rectArrondi(ctx, 20, 90, 170, 50, 8); ctx.fill();
    ctx.fillStyle = '#C9D0D7'; ctx.beginPath(); ctx.ellipse(20, 115, 10, 25, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = degrade(ctx, 180, 0, 240, 0, [[0, '#8A949E'], [0.5, '#EEF1F4'], [1, '#7E8892']]);
    ctx.lineWidth = 50; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(185, 115); ctx.arcTo(225, 115, 225, 60, 40); ctx.lineTo(225, 30); ctx.stroke();
    ctx.fillStyle = '#0F7B5F'; ctx.font = mf(800, 13); ctx.fillText('PVC Ø 100', 60, 120);
  } },
  cable: { vb: [240, 230], dessin(ctx) {
    for (let r = 86; r > 30; r -= 9) {
      ctx.strokeStyle = r % 2 ? '#E35D1B' : '#C44A10'; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.ellipse(120, 120, r, r * 0.78, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#F5F7F4'; ctx.beginPath(); ctx.ellipse(120, 120, 26, 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#E35D1B'; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(200, 140); ctx.bezierCurveTo(230, 170, 210, 205, 180, 210); ctx.stroke();
    ctx.fillStyle = '#B87333'; ctx.fillRect(170, 204, 14, 10);
  } },
  vetement: { vb: [240, 240], dessin(ctx, { couleur }) {
    ctx.fillStyle = degrade(ctx, 30, 30, 210, 220, [[0, couleur || '#0F7B5F'], [1, '#0A3D33']]);
    ctx.beginPath();
    ctx.moveTo(85, 30); ctx.quadraticCurveTo(120, 52, 155, 30); ctx.lineTo(215, 60); ctx.lineTo(195, 110); ctx.lineTo(170, 98);
    ctx.lineTo(172, 215); ctx.lineTo(68, 215); ctx.lineTo(70, 98); ctx.lineTo(45, 110); ctx.lineTo(25, 60); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(85, 30); ctx.quadraticCurveTo(120, 60, 155, 30); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(72, 200); ctx.lineTo(168, 200); ctx.stroke(); ctx.setLineDash([]);
  } },
  chaussure: { vb: [260, 200], dessin(ctx) {
    ctx.fillStyle = degrade(ctx, 20, 60, 240, 160, [[0, '#FFFFFF'], [1, '#D8E1DC']]);
    ctx.beginPath(); ctx.moveTo(30, 150); ctx.lineTo(34, 92); ctx.quadraticCurveTo(60, 70, 92, 84); ctx.lineTo(128, 110); ctx.quadraticCurveTo(200, 118, 232, 140); ctx.quadraticCurveTo(240, 160, 220, 162); ctx.lineTo(40, 162); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#9AA6B6'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#0F7B5F'; ctx.fillRect(30, 158, 200, 12);
    ctx.strokeStyle = '#0F7B5F'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(70, 120); ctx.quadraticCurveTo(130, 105, 190, 138); ctx.stroke();
    ctx.strokeStyle = '#55665F'; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(86 + i * 9, 92 + i * 6); ctx.lineTo(100 + i * 9, 86 + i * 6); ctx.stroke(); }
  } },
  carton: { vb: [240, 230], dessin(ctx) {
    ctx.fillStyle = '#C9965E'; ctx.beginPath(); ctx.moveTo(30, 80); ctx.lineTo(120, 110); ctx.lineTo(120, 210); ctx.lineTo(30, 180); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#B07D46'; ctx.beginPath(); ctx.moveTo(120, 110); ctx.lineTo(210, 80); ctx.lineTo(210, 180); ctx.lineTo(120, 210); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#DDAE76'; ctx.beginPath(); ctx.moveTo(30, 80); ctx.lineTo(120, 50); ctx.lineTo(210, 80); ctx.lineTo(120, 110); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.moveTo(62, 70); ctx.lineTo(152, 100); ctx.lineTo(166, 95); ctx.lineTo(76, 65); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#7A5530'; ctx.lineWidth = 2; ctx.strokeRect(48, 130, 46, 26);
  } },
  generique: { vb: [240, 230], dessin(ctx, { couleur }) {
    ctx.fillStyle = couleur || '#0F7B5F'; ctx.beginPath(); ctx.moveTo(30, 80); ctx.lineTo(120, 110); ctx.lineTo(120, 210); ctx.lineTo(30, 180); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.moveTo(120, 110); ctx.lineTo(210, 80); ctx.lineTo(210, 180); ctx.lineTo(120, 210); ctx.closePath(); ctx.fill();
    ctx.fillStyle = couleur || '#0F7B5F'; ctx.beginPath(); ctx.moveTo(120, 110); ctx.lineTo(210, 80); ctx.lineTo(210, 180); ctx.lineTo(120, 210); ctx.closePath(); ctx.globalAlpha = 0.75; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.moveTo(30, 80); ctx.lineTo(120, 50); ctx.lineTo(210, 80); ctx.lineTo(120, 110); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#FFC56B'; ctx.beginPath(); ctx.moveTo(66, 68); ctx.lineTo(156, 98); ctx.lineTo(156, 198); ctx.lineTo(140, 203); ctx.lineTo(140, 104); ctx.lineTo(50, 74); ctx.closePath(); ctx.fill();
  } }
};

/** Dessine l'illustration de la famille, contenue dans la boîte, posée au sol avec son ombre. */
function dessinerIllustration(ctx, produit, x, y, l, h, { couleur, ombre = 0.4 } = {}) {
  const famille = familleArticle(produit);
  const ill = ILLUSTRATIONS[famille] || ILLUSTRATIONS.generique;
  const [vl, vh] = ill.vb;
  const e = Math.min(l / vl, h / vh);
  const ox = x + (l - vl * e) / 2;
  const oy = y + (h - vh * e);
  ombreSol(ctx, x + l / 2, oy + vh * e * 0.94, vl * e * 0.45, vh * e * 0.05, ombre);
  const mots = String(produit.nom || '').toUpperCase().split(/\s+/);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(e, e);
  ill.dessin(ctx, { etiquette: mots[0] || 'ARTICLE', sousEtiquette: mots.slice(1, 3).join(' '), couleur });
  ctx.restore();
}

/** Visuel produit : photo détourée posée, photo avec fond dans une carte, ou illustration. */
function dessinerVisuel(ctx, produit, photo, x, y, l, h, options = {}) {
  if (!photo) { dessinerIllustration(ctx, produit, x, y, l, h, options); return; }
  if (estDetouree(photo)) {
    const e = Math.min(l / photo.width, h / photo.height);
    const pl = photo.width * e;
    const ph = photo.height * e;
    const px = x + (l - pl) / 2;
    const py = y + (h - ph);
    ombreSol(ctx, px + pl / 2, py + ph * 0.985, pl * 0.46, Math.max(10, ph * 0.05), options.ombre ?? 0.4);
    ctx.drawImage(photo, px, py, pl, ph);
    return;
  }
  // Photo avec fond : carte blanche arrondie, ombre douce, photo entière (contenue) avec marge.
  const ratio = photo.width / photo.height;
  let cl = l;
  let ch = l / ratio;
  if (ch > h) { ch = h; cl = h * ratio; }
  cl = Math.max(cl, Math.min(l, h) * 0.7);
  ch = Math.min(h, Math.max(ch, Math.min(l, h) * 0.7));
  const cx = x + (l - cl) / 2;
  const cy = y + (h - ch) / 2;
  const r = Math.min(cl, ch) * 0.07;
  ctx.save();
  ctx.shadowColor = 'rgba(6, 42, 35,0.30)';
  ctx.shadowBlur = Math.min(cl, ch) * 0.08;
  ctx.shadowOffsetY = Math.min(cl, ch) * 0.035;
  ctx.fillStyle = '#FFFFFF';
  rectArrondi(ctx, cx, cy, cl, ch, r);
  ctx.fill();
  ctx.restore();
  const marge = Math.min(cl, ch) * 0.05;
  const e = Math.min((cl - 2 * marge) / photo.width, (ch - 2 * marge) / photo.height);
  const pl = photo.width * e;
  const ph = photo.height * e;
  ctx.save();
  rectArrondi(ctx, cx + marge, cy + marge, cl - 2 * marge, ch - 2 * marge, r * 0.6);
  ctx.clip();
  ctx.drawImage(photo, cx + (cl - pl) / 2, cy + (ch - ph) / 2, pl, ph);
  ctx.restore();
}

/* ------------------------------------------------------------ Couleurs */

function rgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const versHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
/** Mélange deux couleurs (t = 0 → a, t = 1 → b). */
function melange(a, b, t) {
  const x = rgb(a) || [0, 0, 0];
  const y = rgb(b) || [0, 0, 0];
  return versHex(x.map((v, i) => v + (y[i] - v) * t));
}
const fonce = (c, t) => melange(c, '#000000', t);
const eclaire = (c, t) => melange(c, '#FFFFFF', t);
const alpha = (c, a) => { const x = rgb(c) || [0, 0, 0]; return `rgba(${x[0]},${x[1]},${x[2]},${a})`; };
/** Luminance relative (0 = noir, 1 = blanc). */
function luminance(c) {
  const x = (rgb(c) || [0, 0, 0]).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2];
}
/** Encre lisible sur un fond : blanc sur fond foncé, sinon une version très foncée du fond (jamais blanc sur l'or). */
const encreSur = (fond) => (luminance(fond) < 0.32 ? '#FFFFFF' : fonce(fond, 0.82));

/* ------------------------------------------------------------ Mise en page par blocs */

/**
 * Pose des blocs verticalement dans la zone. Chaque bloc : { h(k, l) → hauteur, dessiner(ctx, x, y, l, k, h), ecart, flex }.
 * k (échelle des textes) part de 1 et descend jusqu'à ce que tout tienne ; les blocs « flex » prennent la place qui reste.
 */
function poser(ctx, blocs, zone, { align = 'centre' } = {}) {
  const liste = blocs.filter(Boolean);
  let k = 1;
  let hauteurs = [];
  let total = 0;
  for (; k >= 0.5; k -= 0.04) {
    hauteurs = liste.map((b) => (b.flex ? (b.min || 0) * k : b.h(k, zone.l)));
    total = hauteurs.reduce((t, h) => t + h, 0) + liste.slice(1).reduce((t, b) => t + (b.ecart ?? 28) * k, 0);
    if (total <= zone.h) break;
  }
  const reste = Math.max(0, zone.h - total);
  const flex = liste.filter((b) => b.flex);
  if (flex.length) {
    const part = reste / flex.length;
    liste.forEach((b, i) => { if (b.flex) hauteurs[i] = Math.min(hauteurs[i] + part, b.max || Infinity); });
    total = hauteurs.reduce((t, h) => t + h, 0) + liste.slice(1).reduce((t, b) => t + (b.ecart ?? 28) * k, 0);
  }
  let y = zone.y + (align === 'haut' ? 0 : align === 'bas' ? zone.h - total : (zone.h - total) / 2);
  liste.forEach((b, i) => {
    if (i) y += (b.ecart ?? 28) * k;
    b.dessiner(ctx, zone.x, y, zone.l, k, hauteurs[i]);
    y += hauteurs[i];
  });
  return k;
}

/**
 * Bloc de texte : taille réduite (k, puis ajustement) jusqu'à tenir en maxLignes sur la largeur.
 * o : { taille, poids, couleur, maxLignes, police: 'm' | 'b', align: 'left' | 'center', interligne, espace, largeur (fraction) }
 */
function blocTexte(brut, o) {
  const texte = brut ? String(brut).replace(/ ([!?:;»])/g, '\u00A0$1').replace(/« /g, '«\u00A0') : brut;
  const police = o.police === 'b' ? (t) => bf(t) : (t) => mf(o.poids || 800, t);
  let mesure = null;
  const calculer = (ctx, k, l) => {
    const largeur = l * (o.largeur || 1);
    const max = (o.taille || 60) * k;
    const min = Math.max(18, max * (o.minRatio || 0.62));
    const r = ajusterBloc(ctx, texte, largeur, o.maxLignes || 3, max, min, police);
    mesure = { ...r, largeur };
    return mesure;
  };
  return {
    ecart: o.ecart,
    h(k, l) {
      if (!texte) return 0;
      const ctx = document.createElement('canvas').getContext('2d');
      if (o.espace) espacement(ctx, o.espace * k);
      const r = calculer(ctx, k, l);
      return r.lignes.length * r.taille * (o.interligne || 1.15);
    },
    dessiner(ctx, x, y, l, k) {
      if (!texte) return;
      ctx.save();
      if (o.espace) espacement(ctx, o.espace * k);
      const r = calculer(ctx, k, l);
      ctx.font = police(r.taille);
      ctx.fillStyle = o.couleur || '#FFFFFF';
      ctx.textAlign = o.align === 'center' ? 'center' : 'left';
      const ax = o.align === 'center' ? x + l / 2 : x;
      const pas = r.taille * (o.interligne || 1.15);
      r.lignes.forEach((ligne, i) => ctx.fillText(ligne, ax, y + pas * i + r.taille * 0.86));
      if (o.barre) {
        r.lignes.forEach((ligne, i) => {
          const lw = ctx.measureText(ligne).width;
          const x0 = o.align === 'center' ? ax - lw / 2 : ax;
          ctx.fillRect(x0, y + pas * i + r.taille * 0.55, lw, Math.max(3, r.taille * 0.07));
        });
      }
      ctx.restore();
    }
  };
}

/** Bloc libre de hauteur fixe (multipliée par k). */
const blocFixe = (hauteur, dessin, ecart) => ({ ecart, h: (k) => hauteur * k, dessiner: (ctx, x, y, l, k, h) => dessin(ctx, x, y, l, k, h) });
/** Bloc qui prend la place restante (visuel). */
const blocFlex = (min, dessin, { max, ecart } = {}) => ({ flex: true, min, max, ecart, h: () => min, dessiner: (ctx, x, y, l, k, h) => dessin(ctx, x, y, l, k, h) });

/* ------------------------------------------------------------ Éléments communs */

/** Émoji : encre blanche, pour rester visible si l'appareil n'a pas de police d'émojis en couleur. */
function dessinerEmoji(ctx, texte, x, y, taille, align = 'center', couleur = '#FFFFFF') {
  ctx.save();
  ctx.font = EMOJI(taille);
  ctx.textAlign = align;
  ctx.fillStyle = couleur;
  ctx.fillText(texte, x, y);
  ctx.restore();
}
const EMOJI = (taille) => `${Math.round(taille)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
const prixGnf = (n) => `${prixTexte(n)} GNF`;
const dateJour = (jour) => (jour ? new Date(`${String(jour).slice(0, 10)}T12:00:00Z`) : new Date());
const fmt = (d, opts) => new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, ...opts }).format(d);
const telLocal = (t) => (t ? formatTelephone(t).replace(/^\+224\s*/, '') : '');

/** Logo (contenu, jamais étiré ni rogné) dans un carré blanc arrondi, ou initiales. */
function dessinerLogo(ctx, logo, nom, x, y, cote, encre) {
  ctx.save();
  rectArrondi(ctx, x, y, cote, cote, cote * 0.24);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  if (logo) {
    ctx.clip();
    const marge = cote * 0.1;
    const e = Math.min((cote - 2 * marge) / logo.width, (cote - 2 * marge) / logo.height);
    ctx.drawImage(logo, x + (cote - logo.width * e) / 2, y + (cote - logo.height * e) / 2, logo.width * e, logo.height * e);
  } else {
    ctx.fillStyle = encre;
    ctx.textAlign = 'center';
    ctx.font = mf(800, cote * 0.4);
    ctx.fillText(initiales(nom), x + cote / 2, y + cote * 0.64);
  }
  ctx.restore();
}

/** En-tête (logo + nom) et pied (téléphone · commune, ville) ; renvoie la zone de contenu. */
function cadre(ctx, W, H, d, img, { encre = '#FFFFFF', pied = 'rgba(0,0,0,0.24)', piedEncre = '#FFFFFF' } = {}) {
  const M = 64;
  const logo = 92;
  dessinerLogo(ctx, img.logo, d.boutique.nom, M, M, logo, d.couleur);
  ctx.save();
  ctx.fillStyle = encre;
  ctx.textAlign = 'left';
  const t = ajusterTaille(ctx, d.boutique.nom, W - M * 2 - logo - 28, 38, 24, (x) => mf(800, x));
  ctx.font = mf(800, t);
  ctx.fillText(d.boutique.nom, M + logo + 26, M + logo / 2 + t * 0.35);
  ctx.restore();
  const hp = 104;
  ctx.fillStyle = pied;
  ctx.fillRect(0, H - hp, W, hp);
  const lieu = [d.boutique.commune, d.boutique.ville].filter(Boolean).join(', ');
  const piedTexte = [telLocal(d.boutique.telephone), lieu].filter(Boolean).join('  ·  ');
  if (piedTexte) {
    ctx.save();
    ctx.fillStyle = piedEncre;
    ctx.textAlign = 'center';
    const tp = ajusterTaille(ctx, piedTexte, W - M * 2, 34, 22, (x) => mf(700, x));
    ctx.font = mf(700, tp);
    ctx.fillText(piedTexte, W / 2, H - hp / 2 + tp * 0.36);
    ctx.restore();
  }
  const haut = M + logo + 48;
  return { x: M, y: haut, l: W - M * 2, h: H - hp - 44 - haut };
}

function fondDegrade(ctx, W, H, haut, bas) {
  ctx.fillStyle = degrade(ctx, 0, 0, W * 0.35, H, [[0, haut], [1, bas]]);
  ctx.fillRect(0, 0, W, H);
}
function cercleDoux(ctx, cx, cy, r, couleur) {
  ctx.fillStyle = couleur;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Phrase secondaire tirée du texte de publication (sans le titre, les liens, téléphones ni hashtags). */
function phraseSecondaire(d, max = 2) {
  const nettoyer = (s) => s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').trim();
  // La première ligne du texte est l'accroche (déjà en titre sur l'affiche) : on prend la suite.
  const lignes = String(d.texte || '').split(/\n+/).map(nettoyer).filter(Boolean).slice(1)
    .filter((l) => !/https?:|www\.|#\w|\/b\/|\d{3}\s?\d{2}\s?\d{2}\s?\d{2}/i.test(l))
    .filter((l) => nettoyer(l).toLowerCase() !== nettoyer(d.titre || '').toLowerCase());
  return lignes.slice(0, max).join(' ');
}

/** Pastille ronde d'accent : prix + unité (texte foncé). */
function pastillePrix(ctx, cx, cy, r, d) {
  const p = d.produit || {};
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = r * 0.18;
  ctx.shadowOffsetY = r * 0.06;
  cercleDoux(ctx, cx, cy, r, d.accent);
  ctx.restore();
  const encre = encreSur(d.accent);
  ctx.fillStyle = encre;
  ctx.textAlign = 'center';
  const prix = prixTexte(p.prix);
  const t = ajusterTaille(ctx, prix, r * 1.6, r * 0.62, r * 0.3, (x) => mf(800, x));
  ctx.font = mf(800, t);
  ctx.fillText(prix, cx, cy + t * 0.22);
  ctx.font = mf(700, r * 0.18);
  ctx.fillText(`GNF${p.unite ? ` / ${p.unite}` : ''}`, cx, cy + t * 0.22 + r * 0.3);
}

/** Visuel de l'article (photo détourée, photo en carte, ou illustration) dans une boîte. */
function visuel(ctx, d, img, x, y, l, h, ombre = 0.4) {
  // Trop petit pour être lisible (format carré chargé) : pas de visuel plutôt qu'une vignette illisible.
  if (h < 150 || l < 150) return;
  dessinerVisuel(ctx, d.produit || {}, img.photo, x, y, l, h, { couleur: d.accent, ombre });
}

/* ------------------------------------------------------------ Thème (ce que l'affiche raconte) */

/** Habillage par défaut de chaque thème (la base le donne aussi : affiche_themes.style_defaut). */
export const STYLE_DEFAUT_THEME = { produit: 'catalogue', promo: 'impact', lundi: 'message', vendredi: 'message', fete: 'message', arrivage: 'photo', horaires: 'message', merci: 'message', saison: 'catalogue' };
const STYLES_AVEC_ARTICLE = ['catalogue', 'impact', 'selection', 'photo'];

const pourcentPromo = (p) => (p && Number(p.prix_barre) > Number(p.prix) ? Math.round(((p.prix_barre - p.prix) / p.prix_barre) * 100) : null);
const finPromo = (p) => (p?.promo_fin ? `Jusqu’au ${fmt(dateJour(p.promo_fin), { weekday: 'long', day: 'numeric', month: 'long' })} · dans la limite du stock` : 'Dans la limite du stock');
function meteo(jour) {
  const m = dateJour(jour).getUTCMonth() + 1;
  return m >= 6 && m <= 9 ? '🌧️' : m === 12 || m <= 2 ? '🌬️' : m <= 5 ? '☀️' : '⛅';
}

/**
 * Ce que le thème ajoute à l'habillage : surtitre, titre, phrase, symbole (croissant ou émoji), tampon,
 * liste d'horaires, fond particulier (or pour vendredi, nuit pour une fête, bleu pour horaires et saison).
 */
function contenuTheme(d) {
  const p = d.produit;
  const fete = d.fete || {};
  const sous = phraseSecondaire(d);
  switch (d.theme) {
    case 'promo': { const pct = pourcentPromo(p); return { surtitre: `PROMO${pct ? ` −${pct} %` : ''}`, titre: d.titre || 'Promotion', sous: finPromo(p), sousProduit: finPromo(p), promo: true }; }
    case 'lundi': return { surtitre: fmt(dateJour(d.jour), { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase(), titre: d.titre || 'Bonne semaine à tous !', sous: d.sousTexte || sous };
    case 'vendredi': return { surtitre: 'VENDREDI', titre: d.titre || 'Bon vendredi et bonne prière', sous: d.sousTexte || sous, fond: 'or' };
    case 'fete': return { symbole: fete.emoji || '🌙', titre: d.titre || (fete.nom ? `Bonne fête de ${fete.nom}` : 'Bonne fête'), sous: fete.message || `${d.boutique.nom} vous souhaite paix et prospérité`, fond: 'nuit', centre: true, titreAccent: true };
    case 'arrivage': return { tampon: 'NOUVEL ARRIVAGE', titre: d.titre || 'Nouvel arrivage', sous, sousProduit: sous || 'Arrivé cette semaine' };
    case 'horaires': return { titre: 'Nos horaires', horaires: d.horaires || [['Lundi – vendredi', '8 h – 18 h'], ['Samedi', '8 h – 17 h'], ['Dimanche', 'Fermé']], sous: d.sousTexte || sous || 'Commandez aussi en ligne, nous vous répondons sur WhatsApp.', fond: 'bleu', titreAccent: true };
    case 'merci': return { emoji: '🤝', titre: d.titre || 'Merci pour votre confiance', sous: d.phraseMerci || sous, centre: true };
    case 'saison': return { emoji: meteo(d.jour), titre: d.titre || 'La saison change', surtitre: d.titre || null, sous, sousProduit: sous || 'Disponible en boutique', fond: 'pluie' };
    default: return { titre: p?.nom || d.titre || 'Article du jour', sous, sousProduit: sous || 'Disponible tout de suite en boutique' };
  }
}

/** Tampon incliné (« NOUVEL ARRIVAGE ») à la couleur d'accent. */
function tampon(ctx, texte, x, y, k, accent, fond = null) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.09);
  const t = 50 * k;
  ctx.font = mf(800, t);
  espacement(ctx, 4 * k);
  const lt = ctx.measureText(texte).width + 56 * k;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6 * k;
  rectArrondi(ctx, 0, 0, lt, t + 40 * k, 14 * k);
  if (fond) { ctx.fillStyle = fond; ctx.fill(); }
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.fillText(texte, 28 * k, t + 9 * k);
  ctx.restore();
}

/** Pastille arrondie (surtitre, badge). Renvoie sa largeur. */
function pastille(ctx, texte, x, y, h, fond, encre, poids = 800) {
  ctx.save();
  ctx.font = mf(poids, h * 0.46);
  const l = ctx.measureText(texte).width + h * 0.9;
  ctx.fillStyle = fond;
  rectArrondi(ctx, x, y, l, h, h / 2);
  ctx.fill();
  ctx.fillStyle = encre;
  ctx.textAlign = 'left';
  ctx.fillText(texte, x + h * 0.45, y + h * 0.65);
  ctx.restore();
  return l;
}

/** Ligne de prix : grand prix condensé + « GNF / unité ». */
function blocPrix(p, couleur, { taille = 170, unite = true, ecart } = {}) {
  const prix = prixTexte(p?.prix);
  return blocTexte(`${prix}${unite ? ` GNF${p?.unite ? ` / ${p.unite}` : ''}` : ''}`, { police: 'b', taille, maxLignes: 1, minRatio: 0.38, couleur, interligne: 1, ecart });
}
/** Symbole d'une fête (croissant dessiné, ou émoji) dans un cercle accent. */
function blocSymbole(c, d, fondNuit) {
  return blocFixe(250, (ctx, x, y, l, k) => {
    const r = 112 * k;
    const cx = c.centre ? x + l / 2 : x + r;
    const cy = y + 125 * k;
    cercleDoux(ctx, cx, cy, r, alpha(d.accent, 0.14));
    ctx.strokeStyle = d.accent;
    ctx.lineWidth = 6 * k;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (c.symbole === '🌙') {
      ctx.fillStyle = d.accent;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.56, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = fondNuit;
      ctx.beginPath(); ctx.arc(cx + r * 0.26, cy - r * 0.16, r * 0.5, 0, Math.PI * 2); ctx.fill();
    } else dessinerEmoji(ctx, c.symbole, cx, cy + 44 * k, 120 * k);
  });
}

/* ------------------------------------------------------------ Les 5 habillages (à quoi l'affiche ressemble) */

const HABILLAGES = {
  /** Grand texte centré, sans article : titre énorme, deux lignes, cercles doux. Vendredi : fond or, texte foncé. */
  message(ctx, W, H, d, img, c) {
    let encre = '#FFFFFF';
    let nuit = fonce(d.couleur, 0.62);
    if (c.fond === 'or') { encre = encreSur(d.accent); fondDegrade(ctx, W, H, eclaire(d.accent, 0.08), fonce(d.accent, 0.12)); }
    else if (c.fond === 'nuit') {
      fondDegrade(ctx, W, H, fonce(d.couleur, 0.55), fonce(d.couleur, 0.82));
      for (let i = 0; i < 26; i++) cercleDoux(ctx, (i * 397) % W, (i * 613) % (H * 0.7), 2 + (i % 3), 'rgba(255,255,255,0.35)');
    } else if (c.fond === 'bleu') { nuit = '#0B1A30'; fondDegrade(ctx, W, H, '#1C3A5E', '#0B1A30'); }
    else if (c.fond === 'pluie') { nuit = '#132E4C'; fondDegrade(ctx, W, H, '#2F6496', '#132E4C'); }
    else fondDegrade(ctx, W, H, eclaire(d.couleur, 0.06), fonce(d.couleur, 0.45));
    const doux = c.fond === 'or' ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
    cercleDoux(ctx, W * 0.95, H * 0.12, W * 0.42, doux);
    cercleDoux(ctx, W * 0.04, H * 0.8, W * 0.3, doux);
    const z = cadre(ctx, W, H, d, img, c.fond === 'or' ? { encre, pied: 'rgba(0,0,0,0.08)', piedEncre: encre } : {});
    const align = c.centre ? 'center' : 'left';
    const p = d.produit;
    poser(ctx, [
      c.symbole ? blocSymbole(c, d, nuit) : null,
      c.emoji ? blocFixe(160, (cx, x, y, l, k) => dessinerEmoji(cx, c.emoji, c.centre ? x + l / 2 : x, y + 130 * k, 130 * k, c.centre ? 'center' : 'left')) : null,
      c.surtitre && d.theme !== 'saison' ? blocTexte(c.surtitre, { taille: 38, maxLignes: 1, couleur: c.fond === 'or' ? alpha(encre, 0.8) : d.accent, espace: 4, align }) : null,
      blocTexte(c.titre, { taille: c.horaires ? 88 : 128, maxLignes: 4, couleur: c.titreAccent ? d.accent : encre, interligne: 1.06, align, ecart: 24 }),
      ...(c.horaires || []).map(([jour, h], i) => blocFixe(92, (cx, x, y, l, k) => {
        cx.fillStyle = 'rgba(255,255,255,0.14)';
        if (i) cx.fillRect(x, y, l, 2);
        cx.font = mf(600, 42 * k); cx.fillStyle = encre; cx.textAlign = 'left';
        cx.fillText(jour, x, y + 60 * k);
        cx.font = mf(800, 42 * k); cx.textAlign = 'right';
        cx.fillText(h, x + l, y + 60 * k);
      }, i ? 0 : 36)),
      c.horaires ? blocFixe(6, (cx, x, y, l) => { cx.fillStyle = d.accent; cx.fillRect(x, y, l * 0.18, 6); }, 30) : null,
      blocTexte(c.sous, { taille: 42, poids: 600, maxLignes: 4, couleur: alpha(encre, 0.88), align, ecart: 36, interligne: 1.3 }),
      p && d.theme === 'saison' ? blocTexte(`${p.nom}${p.prix ? ` · ${prixGnf(p.prix)}${p.unite ? ` le ${p.unite}` : ''}` : ''}`, { taille: 42, poids: 800, maxLignes: 2, couleur: d.accent, align, ecart: 22 }) : null
    ], z, { align: 'centre' });
  },

  /** Fond clair, grand disque pâle derrière la photo, nom très grand, prix très lisible, badges. */
  catalogue(ctx, W, H, d, img, c) {
    const encre = fonce(d.couleur, 0.72);
    fondDegrade(ctx, W, H, eclaire(d.couleur, 0.94), eclaire(d.couleur, 0.86));
    const z = cadre(ctx, W, H, d, img, { encre, pied: fonce(d.couleur, 0.55), piedEncre: '#FFFFFF' });
    const p = d.produit;
    const badges = [
      c.promo && p.promo_fin ? `Promo jusqu’au ${fmt(dateJour(p.promo_fin), { day: 'numeric', month: 'long' })}` : 'Disponible en boutique',
      p.prix_gros ? `Prix de gros dès ${prixTexte(p.prix_gros)}` : null,
      d.lien ? 'Commandez en ligne' : null
    ].filter(Boolean);
    poser(ctx, [
      c.tampon ? blocFixe(110, (cx, x, y, l, k) => tampon(cx, c.tampon, x + 10, y + 16 * k, k, fonce(d.accent, 0.35))) : null,
      c.emoji ? blocFixe(100, (cx, x, y, l, k) => dessinerEmoji(cx, c.emoji, x, y + 84 * k, 84 * k, 'left', encre)) : null,
      c.surtitre && !c.tampon && c.surtitre.length <= 22 ? blocFixe(64, (cx, x, y, l, k) => pastille(cx, c.surtitre, x, y, 62 * k, d.accent, encreSur(d.accent))) : null,
      c.surtitre && !c.tampon && c.surtitre.length > 22 ? blocTexte(c.surtitre, { taille: 46, maxLignes: 2, couleur: fonce(d.accent, 0.45), ecart: 16 }) : null,
      blocTexte(p.nom, { taille: 96, maxLignes: 3, minRatio: 0.45, couleur: encre, interligne: 1.05 }),
      blocFlex(220, (cx, x, y, l, k, h) => {
        const r = Math.min(l * 0.42, h * 0.55);
        cercleDoux(cx, x + l * 0.5, y + h * 0.52, r, alpha(eclaire(d.couleur, 0.55), 0.55));
        visuel(cx, d, img, x + l * 0.12, y, l * 0.76, h, 0.3);
      }, { ecart: 20 }),
      blocPrix(p, fonce(d.couleur, 0.5), { taille: 168, ecart: 18 }),
      p.prix_barre ? blocTexte(prixGnf(p.prix_barre), { taille: 44, poids: 700, maxLignes: 1, couleur: alpha(encre, 0.55), barre: true, ecart: 4 }) : null,
      c.sousProduit && !c.promo ? blocTexte(c.sousProduit, { taille: 36, poids: 600, maxLignes: 2, couleur: alpha(encre, 0.8), ecart: 14 }) : null,
      blocFixe(60, (cx, x, y, l, k) => {
        let bx = x;
        badges.forEach((b) => { if (bx < x + l - 160) bx += pastille(cx, b, bx, y, 56 * k, '#FFFFFF', encre, 700) + 12; });
      }, 22)
    ], z, { align: 'haut' });
  },

  /** Fond foncé, bande diagonale accent avec le prix géant, titre condensé, prix barré et fin de promo. */
  impact(ctx, W, H, d, img, c) {
    fondDegrade(ctx, W, H, fonce(d.couleur, 0.5), fonce(d.couleur, 0.8));
    const z = cadre(ctx, W, H, d, img);
    const p = d.produit;
    const encreBande = encreSur(d.accent);
    poser(ctx, [
      c.tampon ? blocFixe(110, (cx, x, y, l, k) => tampon(cx, c.tampon, x + 10, y + 16 * k, k, d.accent, 'rgba(0,0,0,0.3)')) : null,
      c.surtitre ? blocTexte(c.surtitre, { taille: 44, maxLignes: 2, couleur: d.accent, espace: 3 }) : null,
      blocTexte(String(p.nom || '').toUpperCase(), { police: 'b', taille: 150, maxLignes: 3, minRatio: 0.42, couleur: '#FFFFFF', interligne: 0.98, ecart: 14 }),
      blocFlex(img.photo ? 160 : 0, (cx, x, y, l, k, h) => visuel(cx, d, img, x + l * 0.15, y, l * 0.7, h, 0.5)),
      blocFixe(230, (cx, x, y, l, k) => {
        cx.save();
        cx.translate(W / 2, y + 115 * k);
        cx.rotate(-0.07);
        cx.fillStyle = d.accent;
        cx.fillRect(-W * 0.75, -95 * k, W * 1.5, 190 * k);
        cx.fillStyle = encreBande;
        cx.textAlign = 'center';
        const texte = `${prixTexte(p.prix)} GNF${p.unite ? ` / ${String(p.unite).toUpperCase()}` : ''}`;
        const t = ajusterTaille(cx, texte, W * 0.86, 170 * k, 50, (s) => bf(s));
        cx.font = bf(t);
        cx.fillText(texte, 0, t * 0.36);
        cx.restore();
      }, 26),
      p.prix_barre ? blocTexte(`Au lieu de ${prixGnf(p.prix_barre)}`, { taille: 42, poids: 700, maxLignes: 1, couleur: alpha('#FFFFFF', 0.62), ecart: 26 }) : null,
      blocTexte(c.promo ? finPromo(p) : c.sousProduit, { taille: 34, poids: 600, maxLignes: 2, couleur: alpha('#FFFFFF', 0.85), ecart: 12 })
    ], z, { align: 'haut' });
  },

  /** Dégradé couleur, titre sur 2 lignes, 3 cartes blanches (l'article + les 2 autres). */
  selection(ctx, W, H, d, img, c) {
    fondDegrade(ctx, W, H, eclaire(d.couleur, 0.04), fonce(d.couleur, 0.5));
    cercleDoux(ctx, W * 0.92, H * 0.1, W * 0.34, 'rgba(255,255,255,0.06)');
    const z = cadre(ctx, W, H, d, img);
    const articles = [d.produit, ...(d.autres || [])].filter(Boolean).slice(0, 3);
    const photos = [img.photo, ...(img.autres || [])];
    const titre = d.theme === 'produit' ? 'Notre sélection du jour' : d.theme === 'promo' ? 'Les promos du moment' : c.titre;
    poser(ctx, [
      c.tampon ? blocFixe(110, (cx, x, y, l, k) => tampon(cx, c.tampon, x + 10, y + 16 * k, k, d.accent)) : null,
      c.surtitre && !c.tampon ? blocTexte(c.surtitre, { taille: 40, maxLignes: 1, couleur: d.accent, espace: 3 }) : null,
      blocTexte(titre, { taille: 96, maxLignes: 2, couleur: '#FFFFFF', interligne: 1.05 }),
      blocFlex(330, (cx, x, y, l, k, h) => {
        const n = articles.length;
        const gap = 22;
        const lc = (l - gap * (n - 1)) / n;
        const hc = Math.min(h, lc * 1.9);
        const y0 = y + (h - hc) / 2;
        articles.forEach((a, i) => {
          const xc = x + i * (lc + gap);
          cx.save();
          cx.shadowColor = 'rgba(0,0,0,0.25)'; cx.shadowBlur = 24; cx.shadowOffsetY = 8;
          cx.fillStyle = '#FFFFFF';
          rectArrondi(cx, xc, y0, lc, hc, 26);
          cx.fill();
          cx.restore();
          const m = 18;
          const hv = hc - 150;
          if (hv > 60) dessinerVisuel(cx, a, photos[i] || null, xc + m, y0 + m, lc - 2 * m, hv - m, { couleur: d.accent, ombre: 0.25 });
          cx.fillStyle = fonce(d.couleur, 0.72);
          cx.textAlign = 'left';
          const tn = ajusterBloc(cx, a.nom, lc - 2 * m, 2, 34, 22, (s) => mf(800, s));
          cx.font = mf(800, tn.taille);
          tn.lignes.forEach((lg, j) => cx.fillText(lg, xc + m, y0 + hc - 108 + j * tn.taille * 1.1));
          cx.fillStyle = fonce(d.couleur, 0.5);
          const tp = ajusterTaille(cx, `${prixTexte(a.prix)} GNF`, lc - 2 * m, 52, 26, (s) => bf(s));
          cx.font = bf(tp);
          cx.fillText(`${prixTexte(a.prix)} GNF`, xc + m, y0 + hc - 24);
        });
      }, { ecart: 34 }),
      blocTexte(c.promo ? finPromo(d.produit) : (d.theme === 'produit' ? 'Disponible en boutique · commandez sur WhatsApp' : c.sousProduit), { taille: 34, poids: 600, maxLignes: 2, couleur: alpha('#FFFFFF', 0.86), ecart: 26 })
    ], z, { align: 'haut' });
  },

  /** La photo occupe toute l'affiche, voile sombre en bas, nom et prix posés dessus. */
  photo(ctx, W, H, d, img, c) {
    fondDegrade(ctx, W, H, fonce(d.couleur, 0.2), fonce(d.couleur, 0.7));
    if (img.photo) {
      const e = Math.max(W / img.photo.width, H / img.photo.height);
      ctx.drawImage(img.photo, (W - img.photo.width * e) / 2, (H - img.photo.height * e) / 2, img.photo.width * e, img.photo.height * e);
    } else {
      ctx.save(); ctx.globalAlpha = 0.5;
      dessinerIllustration(ctx, d.produit || {}, W * 0.12, H * 0.16, W * 0.76, H * 0.46, { couleur: d.accent, ombre: 0 });
      ctx.restore();
    }
    ctx.fillStyle = degrade(ctx, 0, 0, 0, H, [[0, 'rgba(0,0,0,0.5)'], [0.22, 'rgba(0,0,0,0)'], [0.5, 'rgba(0,0,0,0.08)'], [1, 'rgba(0,0,0,0.86)']]);
    ctx.fillRect(0, 0, W, H);
    const z = cadre(ctx, W, H, d, img);
    const p = d.produit;
    if (c.tampon) tampon(ctx, c.tampon, z.x + 10, z.y + 20, 1, d.accent, 'rgba(0,0,0,0.5)');
    poser(ctx, [
      c.surtitre && !c.tampon && c.surtitre.length <= 22 ? blocFixe(64, (cx, x, y, l, k) => pastille(cx, c.surtitre, x, y, 62 * k, d.accent, encreSur(d.accent))) : null,
      c.surtitre && !c.tampon && c.surtitre.length > 22 ? blocTexte(c.surtitre, { taille: 44, maxLignes: 2, couleur: d.accent }) : null,
      blocTexte(p.nom, { taille: 96, maxLignes: 3, minRatio: 0.45, couleur: '#FFFFFF', interligne: 1.05, ecart: 18 }),
      blocFixe(130, (cx, x, y, l, k) => {
        const texte = `${prixTexte(p.prix)} GNF`;
        const t = ajusterTaille(cx, texte, l * 0.8, 110 * k, 50, (s) => bf(s));
        cx.font = bf(t);
        const lt = cx.measureText(texte).width + 56 * k;
        cx.fillStyle = d.accent;
        rectArrondi(cx, x, y, lt, 126 * k, 22 * k);
        cx.fill();
        cx.fillStyle = encreSur(d.accent);
        cx.textAlign = 'left';
        cx.fillText(texte, x + 28 * k, y + 63 * k + t * 0.36);
        if (p.prix_barre) {
          cx.font = mf(700, 40 * k);
          cx.fillStyle = alpha('#FFFFFF', 0.7);
          const barre = prixGnf(p.prix_barre);
          cx.fillText(barre, x + lt + 24 * k, y + 78 * k);
          cx.fillRect(x + lt + 24 * k, y + 64 * k, cx.measureText(barre).width, 3);
        }
      }, 22),
      blocTexte(c.promo ? finPromo(p) : c.sousProduit, { taille: 36, poids: 600, maxLignes: 2, couleur: alpha('#FFFFFF', 0.9), ecart: 18 })
    ], { ...z, y: z.y + (c.tampon ? 150 : 0), h: z.h - (c.tampon ? 150 : 0) }, { align: 'bas' });
  }
};
export const HABILLAGES_AFFICHE = Object.keys(HABILLAGES);

/* ------------------------------------------------------------ Génération */

const imagesEnCache = new Map();
function image(url) {
  if (!url) return Promise.resolve(null);
  if (!imagesEnCache.has(url)) imagesEnCache.set(url, chargerImageDistante(url));
  return imagesEnCache.get(url);
}

/**
 * Dessine l'affiche du jour et renvoie le canvas (taille réelle).
 * a : réponse de affiche_du_jour ({ theme, style, titre, texte, jour, fete, boutique, produit, autres… }) complétée par l'écran :
 *   horaires ([[jour, heures]…]), sousTexte, phraseMerci.
 * format : '4:5' (défaut) | '9:16' | '1:1'.
 */
export async function genererAffiche(a, format = '4:5') {
  const f = FORMATS_AFFICHE[format] ? format : '4:5';
  const { largeur: W, hauteur: H } = FORMATS_AFFICHE[f];
  const b = a?.boutique || {};
  const d = {
    ...a,
    boutique: { nom: 'Ma boutique', ...b },
    couleur: rgb(b.couleur) ? b.couleur : COULEUR_DEFAUT,
    accent: rgb(b.accent) ? b.accent : ACCENT_DEFAUT,
    produit: a?.produit ? { nom: 'Article', prix: 0, ...a.produit } : null,
    autres: (a?.autres || []).filter((x) => x && x.nom).slice(0, 2)
  };
  if (!THEMES_AFFICHE.includes(d.theme)) d.theme = d.produit ? 'produit' : 'merci';
  // Habillage : celui demandé s'il existe, sinon celui du thème ; sans article → « message ».
  let style = HABILLAGES[d.style] ? d.style : STYLE_DEFAUT_THEME[d.theme];
  if (STYLES_AVEC_ARTICLE.includes(style) && !d.produit) style = 'message';
  // « Sélection » sans assez d'articles (la base passe déjà en « catalogue ») : on suit.
  if (style === 'selection' && !(d.autres || []).length) style = 'catalogue';
  const [, logo, photo] = await Promise.all([
    chargerPolices(),
    image(b.logo_url),
    image(d.produit?.photo_url)
  ]);
  const autres = style === 'selection' ? await Promise.all((d.autres || []).slice(0, 2).map((x) => image(x?.photo_url))) : [];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.textBaseline = 'alphabetic';
  HABILLAGES[style](ctx, W, H, d, { logo, photo, autres }, contenuTheme(d));
  return canvas;
}

const versBlob = (canvas, type, qualite) => new Promise((resoudre, rejeter) => canvas.toBlob((b) => (b ? resoudre(b) : rejeter(new Error('Image impossible'))), type, qualite));

/** JPEG qualité 0,82 ; si l'image dépasse 200 Ko, la qualité descend par paliers (jusqu'à 0,6). */
export async function versJpeg(canvas, { maxOctets = 200 * 1024 } = {}) {
  let qualite = 0.82;
  let blob = await versBlob(canvas, 'image/jpeg', qualite);
  while (blob.size > maxOctets && qualite > 0.6) {
    qualite = Math.round((qualite - 0.06) * 100) / 100;
    blob = await versBlob(canvas, 'image/jpeg', qualite);
  }
  return { blob, qualite };
}

/** Vrai si le navigateur sait enregistrer une vidéo MP4 depuis un canvas. */
export function videoPossible() {
  try { return typeof MediaRecorder === 'function' && MediaRecorder.isTypeSupported('video/mp4') && typeof HTMLCanvasElement.prototype.captureStream === 'function'; } catch { return false; }
}

/**
 * Vidéo TikTok : 5 s, lent zoom avant (Ken Burns) à partir de l'affiche 9:16. Renvoie un Blob MP4, ou null
 * si le navigateur ne sait pas faire (jamais d'exception : la vidéo ne doit rien bloquer).
 */
export async function genererVideo(source, { duree = 5000, ips = 30 } = {}) {
  if (!videoPossible() || !source) return null;
  try {
    const W = 720;
    const H = Math.round((W * source.height) / source.width);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const flux = canvas.captureStream(ips);
    const type = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') ? 'video/mp4;codecs=avc1' : 'video/mp4';
    const enregistreur = new MediaRecorder(flux, { mimeType: type, videoBitsPerSecond: 1_800_000 });
    const morceaux = [];
    enregistreur.ondataavailable = (e) => { if (e.data?.size) morceaux.push(e.data); };
    const fin = new Promise((resoudre) => { enregistreur.onstop = resoudre; });
    const debut = performance.now();
    const image = (t) => {
      const z = 1 + 0.08 * Math.min(1, t / duree);
      const l = W * z;
      const h = H * z;
      ctx.drawImage(source, (W - l) / 2, (H - h) * 0.42, l, h);
    };
    image(0);
    enregistreur.start(250);
    await new Promise((resoudre) => {
      const minuteur = setInterval(() => {
        const t = performance.now() - debut;
        image(t);
        if (t >= duree) { clearInterval(minuteur); resoudre(); }
      }, 1000 / ips);
    });
    enregistreur.stop();
    flux.getTracks().forEach((p) => p.stop());
    await fin;
    const blob = new Blob(morceaux, { type: 'video/mp4' });
    return blob.size ? blob : null;
  } catch (err) {
    console.warn('[YOUMMA] Vidéo impossible :', err?.message || err);
    return null;
  }
}

/** Nom de fichier lisible : affiche-<boutique>-<jour>-<format>.<ext> */
export function nomFichierAffiche(nomBoutique, jour, format, extension = 'jpg') {
  const base = String(nomBoutique || 'boutique').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `affiche-${base || 'boutique'}-${jour || 'jour'}-${FORMATS_AFFICHE[format]?.fichier || format}.${extension}`;
}
