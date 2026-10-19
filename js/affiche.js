/**
 * affiche.js — Affiches « pro » dessinées dans un <canvas> (maquette AffichesPro.dc.html).
 *
 * Formats (chacun recomposé, jamais étiré) :
 *   facebook 1080 × 1350 (4:5, par défaut) · statut 1080 × 1920 (9:16) · carre 1080 × 1080.
 * Modèles :
 *   promo    → « Impact »    : fond nuit, bande diagonale orange, PROMO + nom court, prix géant sur la bande ;
 *   jour     → « Catalogue » : fond crème, disque bleu pâle, nom très grand, prix bleu nuit, badges ;
 *   arrivage → « Sélection » : dégradé de la couleur, NOUVEL ARRIVAGE, 1 ou 3 cartes articles.
 * Photo détourée (PNG transparent) posée sur le décor avec une ombre au sol ; photo avec fond posée
 * dans une carte blanche ; sans photo : illustration vectorielle selon la famille de l'article.
 * Polices Manrope et Bebas Neue (fonts/, licence OFL) chargées par FontFace.
 */
import { formatNombre, FUSEAU } from './utils.js';
import { dessinerQr } from './qr.js';

export const FORMATS_AFFICHE = {
  facebook: { largeur: 1080, hauteur: 1350, libelle: 'Facebook 4:5' },
  statut: { largeur: 1080, hauteur: 1920, libelle: 'Statut 9:16' },
  carre: { largeur: 1080, hauteur: 1080, libelle: 'Carré' }
};
export const LIBELLES_MODELES_AFFICHE = { promo: 'Impact', jour: 'Catalogue', arrivage: 'Sélection' };

/** Couleur principale de la boutique (fonds Impact et Sélection). Par défaut : vert YOUMMA Business.
 * Les anciens codes « bleu » (ancien défaut) et « vert » ne sont plus listés : ils retombent sur le vert YOUMMA. */
export const COULEUR_AFFICHE_DEFAUT = 'youmma';
export const COULEURS_AFFICHE = {
  youmma: { libelle: 'Vert YOUMMA', nuit: ['#0E5443', '#0A3D33', '#08332A'], vif: ['#0F7B5F', '#0A5E48', '#0A3D33'], pastel: '#F2B33D', texte: '#A9D4C6', clair: '#CFE6DD' },
  ocean: { libelle: 'Bleu', nuit: ['#1D4E7A', '#123556', '#0A1F36'], vif: ['#1F6FB2', '#155089', '#0D2F52'], pastel: '#9FD0F5', texte: '#A9C6E0', clair: '#D2E4F4' },
  rouge: { libelle: 'Rouge', nuit: ['#6E2020', '#3F0D0D', '#220505'], vif: ['#C62828', '#8E1B1B', '#3F0D0D'], pastel: '#FFB4A8', texte: '#E3AAAA', clair: '#F5D3D3' },
  violet: { libelle: 'Violet', nuit: ['#4B2D70', '#2A1745', '#160A27'], vif: ['#6A1B9A', '#4A148C', '#21093F'], pastel: '#D7B8F3', texte: '#C2ACDB', clair: '#E6D9F3' },
  marron: { libelle: 'Marron', nuit: ['#5E3B1F', '#3A2210', '#1E1108'], vif: ['#8D5524', '#6D3F18', '#3A2210'], pastel: '#F2C894', texte: '#D9BC9C', clair: '#F0E0CC' },
  noir: { libelle: 'Noir', nuit: ['#30353F', '#16181D', '#08090B'], vif: ['#37474F', '#1F2A30', '#0B0F12'], pastel: '#B0BEC5', texte: '#A7B0B8', clair: '#DDE3E7' }
};

const CLE_COULEUR = (idBoutique) => `yb_couleur_affiche_${idBoutique}`;
export function lireCouleurAffiche(idBoutique) {
  try { const c = localStorage.getItem(CLE_COULEUR(idBoutique)); return COULEURS_AFFICHE[c] ? c : COULEUR_AFFICHE_DEFAUT; } catch { return COULEUR_AFFICHE_DEFAUT; }
}
export function ecrireCouleurAffiche(idBoutique, couleur) {
  try { localStorage.setItem(CLE_COULEUR(idBoutique), couleur); } catch { /* préférence non mémorisée */ }
}

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
  const mots = String(texte || '').trim().split(/\s+/).filter(Boolean);
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
    const motsOk = String(texte).split(/\s+/).every((m) => ctx.measureText(m).width <= largeurMax);
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
const dateJour = (jour) => (jour ? new Date(`${jour}T12:00:00Z`) : new Date());
const fmt = (d, opts) => new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, ...opts }).format(d);

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

/** Logo (image) ou initiales dans un carré arrondi. */
function dessinerLogo(ctx, logo, nom, x, y, cote, fond, encre) {
  ctx.save();
  rectArrondi(ctx, x, y, cote, cote, cote * 0.26);
  ctx.fillStyle = fond;
  ctx.fill();
  if (logo) {
    ctx.clip();
    const e = Math.max(cote / logo.width, cote / logo.height);
    ctx.drawImage(logo, x + (cote - logo.width * e) / 2, y + (cote - logo.height * e) / 2, logo.width * e, logo.height * e);
  } else {
    ctx.fillStyle = encre;
    ctx.textAlign = 'center';
    ctx.font = mf(800, cote * 0.38);
    ctx.fillText(initiales(nom), x + cote / 2, y + cote * 0.63);
  }
  ctx.restore();
}

function pastilleWhatsApp(ctx, x, y, h, texte, { alignDroite = false } = {}) {
  ctx.font = mf(800, h * 0.46);
  const l = ctx.measureText(texte).width + h * 1.2;
  const x0 = alignDroite ? x - l : x;
  ctx.fillStyle = '#25D366';
  rectArrondi(ctx, x0, y, l, h, h / 2);
  ctx.fill();
  ctx.fillStyle = '#06371A';
  ctx.fillText(texte, x0 + h * 0.6, y + h * 0.66);
  return l;
}

function qr(ctx, lien, x, y, cote, fond = '#FFFFFF') {
  if (!lien) return;
  ctx.fillStyle = fond;
  rectArrondi(ctx, x, y, cote, cote, cote * 0.1);
  ctx.fill();
  dessinerQr(ctx, lien, x + cote * 0.04, y + cote * 0.04, cote * 0.92);
}

function texteLivraison(d) {
  const zones = (d.zones || []).filter(Boolean);
  if (zones.length) {
    const liste = zones.length > 2 ? `${zones.slice(0, 2).join(', ')}…` : zones.join(' & ');
    return `Livraison ${liste} · paiement à la livraison`;
  }
  return 'Retrait en boutique · paiement au retrait';
}

/* ------------------------------------------------------------ Modèle « Impact » (promo) */

function modeleImpact(ctx, W, H, f, d, img) {
  const c = COULEURS_AFFICHE[d.couleur] || COULEURS_AFFICHE[COULEUR_AFFICHE_DEFAUT];
  const p = d.produit;
  // Mises en page propres à chaque format (px réels).
  const L = {
    facebook: { tete: 52, logo: 88, titreY: 182, titre: 236, titreL: 600, visuel: [500, 236, 560, 740], bandeY: 890, bandeH: 236, prix: 150, pastille: 184, pied: 222 },
    statut: { tete: 70, logo: 100, titreY: 250, titre: 260, titreL: 640, visuel: [170, 720, 740, 540], bandeY: 1400, bandeH: 250, prix: 158, pastille: 196, pied: 250 },
    carre: { tete: 46, logo: 80, titreY: 158, titre: 196, titreL: 560, visuel: [560, 150, 480, 560], bandeY: 742, bandeH: 196, prix: 128, pastille: 156, pied: 186 }
  }[f];
  const M = 56;
  // Fond : dégradé radial nuit.
  const g = ctx.createRadialGradient(W * 0.7, H * 0.35, 0, W * 0.7, H * 0.35, Math.max(W, H) * 1.05);
  g.addColorStop(0, c.nuit[0]); g.addColorStop(0.55, c.nuit[1]); g.addColorStop(1, c.nuit[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // Bande diagonale or (-12°), sous l'article : texte foncé dessus.
  const angle = -12 * Math.PI / 180;
  ctx.save();
  ctx.translate(W * 0.47, L.bandeY);
  ctx.rotate(angle);
  ctx.globalAlpha = 0.96;
  ctx.fillStyle = degrade(ctx, -W * 0.8, 0, W * 0.8, 0, [[0, '#E9A52B'], [1, '#F6C35A']]);
  ctx.fillRect(-W * 0.85, -L.bandeH / 2, W * 1.7, L.bandeH);
  ctx.restore();

  // En-tête : logo, nom, type · ville, dates de la promo.
  dessinerLogo(ctx, img.logo, d.boutique.nom, M, L.tete, L.logo, '#FFFFFF', c.nuit[1]);
  const xt = M + L.logo + 26;
  const dates = datesPromo(d);
  ctx.font = mf(700, L.logo * 0.3);
  const lDates = ctx.measureText(dates).width;
  ctx.fillStyle = c.texte; ctx.textAlign = 'right'; ctx.fillText(dates, W - M, L.tete + L.logo * 0.58); ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF'; espacement(ctx, 1);
  ajusterTaille(ctx, d.boutique.nom.toUpperCase(), W - xt - M - lDates - 30, L.logo * 0.38, 22, (t) => mf(800, t));
  ctx.fillText(couperLignes(ctx, d.boutique.nom.toUpperCase(), W - xt - M - lDates - 30, 1)[0], xt, L.tete + L.logo * 0.46);
  espacement(ctx, 0);
  ctx.font = mf(500, L.logo * 0.29); ctx.fillStyle = c.texte;
  ctx.fillText(couperLignes(ctx, d.sousTitreBoutique, W - xt - M - lDates - 30, 1)[0], xt, L.tete + L.logo * 0.86);

  // Titre : PROMO + nom court (or).
  const [court, reste] = nomCourt(p.nom);
  ctx.fillStyle = '#FFFFFF';
  const tTitre = Math.min(L.titre, ajusterTaille(ctx, court, L.titreL, L.titre, 110, bf));
  ctx.font = bf(tTitre);
  ctx.fillText('PROMO', M - 4, L.titreY + tTitre * 0.78);
  ctx.fillStyle = '#F2B33D';
  ctx.fillText(couperLignes(ctx, court, L.titreL, 1)[0], M - 4, L.titreY + tTitre * 0.78 + tTitre * 0.86);
  const ySous = L.titreY + tTitre * 0.78 + tTitre * 0.86 + 64;
  ctx.font = mf(700, Math.round(tTitre * 0.15)); ctx.fillStyle = c.clair;
  const sous = [reste, p.unite ? `prix au ${p.unite}` : ''].filter(Boolean).join(' · ');
  couperLignes(ctx, sous, L.titreL - 20, 2).forEach((l, i) => ctx.fillText(l, M, ySous + i * tTitre * 0.2));

  // Visuel (posé par-dessus le titre comme sur la maquette).
  const [vx, vy, vl, vh] = L.visuel;
  dessinerVisuel(ctx, p, img.photo, vx, vy, vl, vh, { couleur: c.vif[0] });

  // Ancien et nouveau prix sur la bande.
  ctx.save();
  ctx.translate(W * 0.47, L.bandeY);
  ctx.rotate(angle);
  const xPrix = -W * 0.47 + M + 6;
  const lPrixMax = W - L.pastille - M * 2 - 60;
  if (p.prix_barre) {
    ctx.font = mf(800, L.prix * 0.25); ctx.fillStyle = 'rgba(59,23,0,0.78)';
    const ancien = `${prixTexte(p.prix_barre)} GNF`;
    const yA = -L.bandeH / 2 + L.prix * 0.36;
    ctx.fillText(ancien, xPrix, yA);
    ctx.fillRect(xPrix, yA - L.prix * 0.09, ctx.measureText(ancien).width, Math.max(3, L.prix * 0.03));
  }
  const texteP = prixTexte(p.prix);
  let tP = L.prix;
  for (; tP > 70; tP -= 4) {
    ctx.font = bf(tP); const a = ctx.measureText(`${texteP} `).width;
    ctx.font = bf(tP * 0.42); if (a + ctx.measureText('GNF').width <= lPrixMax) break;
  }
  ctx.fillStyle = '#3A2600'; ctx.font = bf(tP);
  const yP =L.bandeH / 2 - (L.bandeH - tP * 0.72) / 2 + (p.prix_barre ? tP * 0.06 : -tP * 0.02);
  ctx.fillText(texteP, xPrix, yP);
  const lp = ctx.measureText(`${texteP} `).width;
  ctx.font = bf(tP * 0.42); ctx.fillText('GNF', xPrix + lp, yP);
  ctx.restore();

  // Pastille ronde « −X » (remise) ou « le sac ».
  const rP = L.pastille / 2;
  const pcx = W - M - rP;
  const pcy = L.bandeY - Math.tan(-angle) * (pcx - W * 0.47) - L.bandeH * 0.05;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(pcx, pcy, rP, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.textAlign = 'center'; ctx.fillStyle = c.vif[1];
  const remise = p.prix_barre ? `−${prixTexte(p.prix_barre - p.prix)}` : 'PROMO';
  ctx.font = mf(800, rP * 0.3); ctx.fillText(p.unite ? `le ${p.unite}`.slice(0, 12) : 'remise', pcx, pcy - rP * 0.16);
  ajusterTaille(ctx, remise, rP * 1.62, rP * 0.56, 20, (t) => mf(800, t));
  ctx.fillText(remise, pcx, pcy + rP * 0.36);
  ctx.textAlign = 'left';

  // Pied blanc.
  piedBlanc(ctx, W, H, L.pied, d, c, 'Commandez maintenant');
  marqueYoumma(ctx, W - 46, H - 14, img.symbole, '#67766F');
}

/** Petite mention « YOUMMA Business » (symbole + texte) alignée à droite sur xDroite, ligne de base y. */
function marqueYoumma(ctx, xDroite, y, symbole, couleur) {
  const t = 24;
  ctx.save();
  ctx.font = mf(700, 17); ctx.fillStyle = couleur; ctx.textAlign = 'right';
  ctx.fillText('YOUMMA Business', xDroite, y);
  const l = ctx.measureText('YOUMMA Business').width;
  if (symbole) ctx.drawImage(symbole, xDroite - l - t - 6, y - t + 5, t, t);
  ctx.restore();
}

function piedBlanc(ctx, W, H, h, d, c, titre) {
  const y = H - h;
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, y, W, h);
  const M = 46;
  const cq = h * 0.66;
  qr(ctx, d.lien, M, y + (h - cq) / 2, cq);
  const x = M + (d.lien ? cq + 30 : 0);
  // Bloc WhatsApp à droite.
  const hW = h * 0.25;
  let lW = 0;
  if (d.whatsapp) {
    lW = pastilleWhatsApp(ctx, W - M, y + h * 0.2, hW, 'WhatsApp', { alignDroite: true });
    ctx.font = mf(800, h * 0.16); ctx.fillStyle = c.nuit[1]; ctx.textAlign = 'right';
    ctx.fillText(d.whatsapp, W - M, y + h * 0.75);
    lW = Math.max(lW, ctx.measureText(d.whatsapp).width);
    ctx.textAlign = 'left';
  }
  const lTexte = W - x - M - lW - 30;
  ctx.fillStyle = '#0A3D33';
  ajusterTaille(ctx, titre, lTexte, h * 0.18, 22, (t) => mf(800, t));
  ctx.fillText(titre, x, y + h * 0.45);
  ctx.font = mf(600, h * 0.12); ctx.fillStyle = '#55665F';
  couperLignes(ctx, texteLivraison(d), lTexte, 2).forEach((l, i) => ctx.fillText(l, x, y + h * 0.66 + i * h * 0.15));
}

function nomCourt(nom) {
  const mots = String(nom || 'Article').trim().split(/\s+/);
  const court = mots[0].toUpperCase().replace(/[,;:]$/, '');
  return [court, mots.slice(1).join(' ')];
}

function datesPromo(d) {
  const debut = dateJour(d.jour);
  if (d.produit.promo_fin) {
    const fin = new Date(`${String(d.produit.promo_fin).slice(0, 10)}T12:00:00Z`);
    if (fin >= debut) {
      const memeMois = fmt(debut, { month: 'short' }) === fmt(fin, { month: 'short' });
      return memeMois ? `du ${fmt(debut, { day: 'numeric' })} au ${fmt(fin, { day: 'numeric', month: 'short' })}`
        : `du ${fmt(debut, { day: 'numeric', month: 'short' })} au ${fmt(fin, { day: 'numeric', month: 'short' })}`;
    }
  }
  return `offre du ${fmt(debut, { day: 'numeric', month: 'short' })}`;
}

/* ------------------------------------------------------------ Modèle « Catalogue » (produit du jour) */

function modeleCatalogue(ctx, W, H, f, d, img) {
  const p = d.produit;
  const L = {
    facebook: { haut: 56, disque: [862, 578, 424], visuel: [500, 250, 540, 600], col: [62, 180, 520], nom: 98, prixY: 870, prix: 118, badgesY: 1010, pied: 200 },
    statut: { haut: 70, disque: [860, 640, 470], visuel: [250, 200, 790, 880], col: [62, 1140, 960], nom: 108, prixY: 1510, prix: 140, badgesY: 1568, pied: 220 },
    carre: { haut: 50, disque: [840, 470, 360], visuel: [560, 150, 470, 520], col: [56, 150, 480], nom: 86, prixY: 700, prix: 104, badgesY: 830, pied: 180 }
  }[f];
  const M = L.col[0];
  ctx.fillStyle = '#F6F3EE'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#E3F2EC'; ctx.beginPath(); ctx.arc(L.disque[0], L.disque[1], L.disque[2], 0, Math.PI * 2); ctx.fill();

  // Petites capitales + filet fin.
  const jj = fmt(dateJour(d.jour), { day: '2-digit', month: '2-digit' }).replace('/', '.');
  ctx.font = mf(800, 26); espacement(ctx, 3.6); ctx.fillStyle = '#55665F';
  let xNom = M;
  if (img.logo) { dessinerLogo(ctx, img.logo, d.boutique.nom, M, L.haut - 8, 48, '#FFFFFF', '#0A3D33'); xNom = M + 64; }
  const droite = `LE CHOIX DU JOUR · ${jj}`;
  const lDroite = ctx.measureText(droite).width;
  ctx.textAlign = 'right'; ctx.fillText(droite, W - M, L.haut + 26); ctx.textAlign = 'left';
  ctx.fillText(couperLignes(ctx, d.boutique.nom.toUpperCase(), W - M - lDroite - xNom - 30, 1)[0], xNom, L.haut + 26);
  espacement(ctx, 0);
  ctx.fillStyle = 'rgba(16, 35, 29,0.15)'; ctx.fillRect(M, L.haut + 58, W - 2 * M, 2);

  // Visuel à droite.
  const [vx, vy, vl, vh] = L.visuel;
  dessinerVisuel(ctx, p, img.photo, vx, vy, vl, vh, { ombre: 0.16 });

  // Colonne texte : catégorie, nom (2 lignes max), description.
  const [cx, cy, cl] = L.col;
  let y = cy;
  if (p.categorie) {
    ctx.font = mf(800, 31); espacement(ctx, 2.4); ctx.fillStyle = '#0F7B5F';
    ctx.fillText(couperLignes(ctx, p.categorie.toUpperCase(), cl, 1)[0], cx, y + 30); espacement(ctx, 0);
    y += 56;
  }
  espacement(ctx, -1.5);
  const nom = ajusterBloc(ctx, p.nom, cl, 2, L.nom, 54, (t) => mf(800, t));
  ctx.fillStyle = '#10231D'; ctx.font = mf(800, nom.taille);
  nom.lignes.forEach((l, i) => ctx.fillText(l, cx, y + nom.taille * 0.9 + i * nom.taille * 1.04));
  espacement(ctx, 0);
  y += nom.taille * 1.04 * nom.lignes.length + 26;
  if (d.phrase) {
    ctx.font = mf(500, 33); ctx.fillStyle = '#3F5249';
    couperLignes(ctx, d.phrase, cl, 3).forEach((l, i) => ctx.fillText(l, cx, y + 30 + i * 48));
  }

  // Prix bleu nuit très grand + unité.
  const texteP = prixTexte(p.prix);
  const unite = `GNF / ${p.unite || 'unité'}`;
  let tP = L.prix;
  for (; tP > 60; tP -= 4) {
    ctx.font = mf(800, tP); const a = ctx.measureText(texteP).width;
    ctx.font = mf(800, tP * 0.3); if (a + 24 + ctx.measureText(unite).width <= W - 2 * M) break;
  }
  espacement(ctx, -tP * 0.03);
  ctx.font = mf(800, tP); ctx.fillStyle = '#0A3D33'; ctx.fillText(texteP, M, L.prixY);
  const lp = ctx.measureText(texteP).width;
  espacement(ctx, 0);
  ctx.font = mf(800, tP * 0.3); ctx.fillStyle = '#55665F'; ctx.fillText(unite, M + lp + 24, L.prixY);
  if (p.prix_barre) {
    ctx.font = mf(700, 34); ctx.fillStyle = '#67766F';
    const ancien = `au lieu de ${prixTexte(p.prix_barre)} GNF`;
    ctx.fillText(ancien, M, L.prixY - tP * 0.86);
  }

  // Badges.
  const badges = [];
  badges.push(p.dispo === 'sur_commande' ? ['Sur commande', '#FDF3E1', '#7A4A00', null] : ['En stock', '#E8F5EA', '#1B6E2A', null]);
  if (p.prix_gros && Number(p.prix_gros) < Number(p.prix)) badges.push([`Prix de gros : ${prixTexte(p.prix_gros)} GNF`, '#FFFFFF', '#10231D', '#D8E1DC']);
  if (p.prix_barre) badges.push(['Promo', '#FFF4EA', '#C43E00', null]);
  let bx = M;
  ctx.font = mf(800, 28);
  for (const [t, fond, encre, bord] of badges) {
    const l = ctx.measureText(t).width + 52;
    if (bx + l > W - M) break;
    ctx.fillStyle = fond; rectArrondi(ctx, bx, L.badgesY, l, 58, 29); ctx.fill();
    if (bord) { ctx.strokeStyle = bord; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.fillStyle = encre; ctx.fillText(t, bx + 26, L.badgesY + 39);
    bx += l + 16;
  }

  // Pied : filet, QR, texte de commande, numéro.
  const yP = H - L.pied;
  ctx.fillStyle = 'rgba(16, 35, 29,0.15)'; ctx.fillRect(M, yP, W - 2 * M, 2);
  const cq = L.pied * 0.62;
  qr(ctx, d.lien, M, yP + (L.pied - cq) / 2, cq);
  const x = M + (d.lien ? cq + 30 : 0);
  ctx.font = mf(800, 36); ctx.fillStyle = '#10231D';
  const lNum = d.whatsapp ? ctx.measureText(d.whatsapp).width : 0;
  if (d.whatsapp) { ctx.textAlign = 'right'; ctx.fillText(d.whatsapp, W - M, yP + L.pied * 0.56); ctx.textAlign = 'left'; }
  const lt = W - x - M - lNum - 30;
  ajusterTaille(ctx, 'Commandez en ligne ou sur WhatsApp', lt, 34, 22, (t) => mf(800, t));
  ctx.fillText('Commandez en ligne ou sur WhatsApp', x, yP + L.pied * 0.47);
  ctx.font = mf(600, 28); ctx.fillStyle = '#3F5249';
  ctx.fillText(couperLignes(ctx, [d.boutique.ville, texteLivraison(d).split(' · ')[0]].filter(Boolean).join(' · '), lt, 1)[0], x, yP + L.pied * 0.68);
  marqueYoumma(ctx, W - M, H - 16, img.symbole, '#67766F');
}

/* ------------------------------------------------------------ Modèle « Sélection » (arrivage) */

async function modeleSelection(ctx, W, H, f, d, img) {
  const c = COULEURS_AFFICHE[d.couleur] || COULEURS_AFFICHE[COULEUR_AFFICHE_DEFAUT];
  const articles = [d.produit, ...(d.autres || [])].slice(0, 3);
  const L = {
    facebook: { tete: 52, logo: 82, titreY: 170, titre: 166, cartesY: 504, cartesH: 470, phraseY: 1028, pied: 190 },
    statut: { tete: 70, logo: 96, titreY: 250, titre: 210, cartesY: 720, cartesH: 760, phraseY: 1560, pied: 230 },
    carre: { tete: 46, logo: 76, titreY: 150, titre: 128, cartesY: 410, cartesH: 400, phraseY: 860, pied: 170 }
  }[f];
  const M = 56;
  const angle = 165 * Math.PI / 180;
  const gx = Math.sin(angle) * W;
  const g = ctx.createLinearGradient(W / 2 - gx / 2, H / 2 + Math.cos(angle) * H / 2, W / 2 + gx / 2, H / 2 - Math.cos(angle) * H / 2);
  g.addColorStop(0, c.vif[0]); g.addColorStop(0.6, c.vif[1]); g.addColorStop(1, c.vif[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // En-tête : logo + nom + pastille.
  dessinerLogo(ctx, img.logo, d.boutique.nom, M, L.tete, L.logo, '#FFFFFF', c.vif[1]);
  const pastilleTexte = /semaine/i.test(`${d.phrase || ''} ${d.raison || ''}`) ? 'CETTE SEMAINE' : 'ARRIVÉ CE MATIN';
  ctx.font = mf(800, L.logo * 0.3);
  const lPast = ctx.measureText(pastilleTexte).width + 44;
  ctx.fillStyle = c.pastel; rectArrondi(ctx, W - M - lPast, L.tete + L.logo * 0.22, lPast, L.logo * 0.56, L.logo * 0.28); ctx.fill();
  ctx.fillStyle = '#0A3D33'; ctx.fillText(pastilleTexte, W - M - lPast + 22, L.tete + L.logo * 0.61);
  ctx.fillStyle = '#FFFFFF';
  ajusterTaille(ctx, d.boutique.nom, W - M * 2 - L.logo - lPast - 50, L.logo * 0.4, 22, (t) => mf(800, t));
  ctx.fillText(couperLignes(ctx, d.boutique.nom, W - M * 2 - L.logo - lPast - 50, 1)[0], M + L.logo + 24, L.tete + L.logo * 0.62);

  // Titre condensé sur 2 lignes.
  ctx.font = bf(L.titre); ctx.fillStyle = '#FFFFFF';
  ctx.fillText('NOUVEL', M - 3, L.titreY + L.titre * 0.8);
  ctx.fillText('ARRIVAGE', M - 3, L.titreY + L.titre * 0.8 + L.titre * 0.9);

  // Cartes.
  const n = articles.length;
  const gap = 26;
  const lc = n === 1 ? W - 2 * M : (W - 2 * M - gap * (n - 1)) / n;
  const hc = L.cartesH;
  const teintes = ['#EDF5F1', '#FFF4EA', '#EFF3F0'];
  for (let i = 0; i < n; i++) {
    const a = articles[i];
    const x = M + i * (lc + gap);
    const y = L.cartesY;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
    ctx.fillStyle = '#FFFFFF'; rectArrondi(ctx, x, y, lc, hc, 30); ctx.fill();
    ctx.restore();
    const photo = img.photos[i];
    if (n === 1) {
      // Grande carte : visuel à gauche, textes à droite.
      const lv = lc * 0.52;
      ctx.save(); rectArrondi(ctx, x, y, lc, hc, 30); ctx.clip();
      ctx.fillStyle = teintes[0]; ctx.fillRect(x, y, lv, hc); ctx.restore();
      dessinerVisuel(ctx, a, photo, x + 30, y + 30, lv - 60, hc - 60, { couleur: c.vif[0], ombre: 0.25 });
      const tx = x + lv + 36;
      const tl = lc - lv - 66;
      const nom = ajusterBloc(ctx, a.nom, tl, 3, 52, 30, (t) => mf(800, t));
      ctx.fillStyle = '#10231D'; ctx.font = mf(800, nom.taille);
      nom.lignes.forEach((l, k) => ctx.fillText(l, tx, y + 70 + nom.taille + k * nom.taille * 1.15));
      const yPrix = y + hc - 110;
      if (a.prix_barre) { ctx.font = mf(700, 30); ctx.fillStyle = '#67766F'; ctx.fillText(`${prixTexte(a.prix_barre)} GNF`, tx, yPrix - 90); }
      ajusterTaille(ctx, prixTexte(a.prix), tl, 92, 40, (t) => mf(800, t));
      ctx.fillStyle = c.vif[1]; ctx.fillText(prixTexte(a.prix), tx, yPrix);
      ctx.font = mf(700, 30); ctx.fillStyle = '#55665F'; ctx.fillText(`GNF / ${a.unite || 'unité'}`, tx, yPrix + 48);
    } else {
      const hv = hc * 0.56;
      ctx.save(); rectArrondi(ctx, x, y, lc, hc, 30); ctx.clip();
      ctx.fillStyle = teintes[i % 3]; ctx.fillRect(x, y, lc, hv); ctx.restore();
      dessinerVisuel(ctx, a, photo, x + 20, y + 18, lc - 40, hv - 30, { couleur: c.vif[0], ombre: 0.25 });
      const tx = x + 22;
      const tl = lc - 44;
      const tNom = Math.round(hc * 0.062);
      ctx.font = mf(800, tNom); ctx.fillStyle = '#10231D';
      couperLignes(ctx, a.nom, tl, 2).forEach((l, k) => ctx.fillText(l, tx, y + hv + tNom * 1.3 + k * tNom * 1.22));
      const tUnite = Math.round(hc * 0.048);
      const yUnite = y + hc - Math.max(22, hc * 0.06);
      ctx.font = mf(700, tUnite); ctx.fillStyle = '#55665F';
      ctx.fillText(couperLignes(ctx, `GNF / ${a.unite || 'unité'}`, tl, 1)[0], tx, yUnite);
      ajusterTaille(ctx, prixTexte(a.prix), tl, Math.round(hc * 0.1), 26, (t) => mf(800, t));
      ctx.fillStyle = c.vif[1]; ctx.fillText(prixTexte(a.prix), tx, yUnite - tUnite * 1.45);
    }
  }

  // Phrase.
  if (d.phrase) {
    ctx.font = mf(600, f === 'carre' ? 30 : 34); ctx.fillStyle = c.clair;
    couperLignes(ctx, d.phrase, W - 2 * M, 2).forEach((l, i) => ctx.fillText(l, M, L.phraseY + i * 48));
  }

  // Pied sombre translucide.
  const yP = H - L.pied;
  ctx.fillStyle = 'rgba(6, 42, 35,0.55)'; ctx.fillRect(0, yP, W, L.pied);
  const cq = L.pied * 0.66;
  qr(ctx, d.lien, M, yP + (L.pied - cq) / 2, cq);
  const x = M + (d.lien ? cq + 28 : 0);
  let lW = 0;
  if (d.whatsapp) {
    const h = L.pied * 0.38;
    ctx.font = mf(800, h * 0.48);
    lW = ctx.measureText(d.whatsapp).width + h * 0.9;
    ctx.fillStyle = '#25D366'; rectArrondi(ctx, W - M - lW, yP + (L.pied - h) / 2, lW, h, h * 0.28); ctx.fill();
    ctx.fillStyle = '#06371A'; ctx.fillText(d.whatsapp, W - M - lW + h * 0.45, yP + L.pied / 2 + h * 0.17);
  }
  const lt = W - x - M - lW - 26;
  ctx.fillStyle = '#FFFFFF';
  ajusterTaille(ctx, 'Commandez sur WhatsApp', lt, 38, 22, (t) => mf(800, t));
  ctx.fillText('Commandez sur WhatsApp', x, yP + L.pied * 0.47);
  ctx.font = mf(600, 27); ctx.fillStyle = c.texte;
  ctx.fillText(couperLignes(ctx, d.lienCourt || texteLivraison(d), lt, 1)[0], x, yP + L.pied * 0.7);
  marqueYoumma(ctx, W - M, H - 14, img.symbole, c.texte);
}

/* ------------------------------------------------------------ Point d'entrée */

/**
 * Génère l'affiche et renvoie le canvas (taille réelle, aucun agrandissement).
 * donnees : {
 *   boutique: { nom, ville, commune, type_activite, logo_url },
 *   produit: { nom, unite, photo_url, prix, prix_barre, prix_gros, categorie, dispo, promo_fin },
 *   autres: [{ nom, unite, photo_url, prix, prix_barre }] (Sélection), modele, phrase, raison, jour,
 *   couleur, zones: [noms], lien (QR), lienCourt, whatsapp (texte)
 * }
 * format : 'facebook' (défaut) | 'statut' | 'carre'.
 */
export async function genererAffiche(donnees, format = 'facebook') {
  const f = FORMATS_AFFICHE[format] ? format : 'facebook';
  const { largeur: W, hauteur: H } = FORMATS_AFFICHE[f];
  const d = {
    ...donnees,
    boutique: { nom: 'Ma boutique', ...(donnees.boutique || {}) },
    produit: { nom: 'Article', prix: 0, ...(donnees.produit || {}) },
    autres: (donnees.autres || []).filter((a) => a && a.nom).slice(0, 2)
  };
  d.sousTitreBoutique = [d.boutique.type, [d.boutique.commune, d.boutique.ville].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const modele = ['promo', 'jour', 'arrivage'].includes(d.modele) ? d.modele : 'jour';
  const [, symbole, logo, ...photos] = await Promise.all([
    chargerPolices(),
    chargerImageDistante(new URL('../img/logo/youmma-business-symbole.png', import.meta.url).href),
    chargerImageDistante(d.boutique.logo_url),
    chargerImageDistante(d.produit.photo_url),
    ...(modele === 'arrivage' ? d.autres.map((a) => chargerImageDistante(a.photo_url)) : [])
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.textBaseline = 'alphabetic';
  const img = { logo, symbole, photo: photos[0] || null, photos };
  if (modele === 'promo') modeleImpact(ctx, W, H, f, d, img);
  else if (modele === 'arrivage') await modeleSelection(ctx, W, H, f, d, img);
  else modeleCatalogue(ctx, W, H, f, d, img);
  return canvas;
}

/** Export : JPEG qualité 0,92 (Facebook, carré) ; PNG pour le statut (aplats plus nets). */
export function versImage(canvas, format = 'facebook') {
  const png = format === 'statut';
  return new Promise((resoudre, rejeter) => canvas.toBlob((b) => (b ? resoudre(b) : rejeter(new Error('Image impossible'))),
    png ? 'image/png' : 'image/jpeg', png ? undefined : 0.92));
}
export const extensionAffiche = (format) => (format === 'statut' ? 'png' : 'jpg');

/** Compatibilité : PNG. */
export function versPng(canvas) {
  return new Promise((resoudre, rejeter) => canvas.toBlob((b) => (b ? resoudre(b) : rejeter(new Error('Image impossible'))), 'image/png'));
}

/** Nom de fichier lisible : affiche-<boutique>-<jour>-<format>.<ext> */
export function nomFichierAffiche(nomBoutique, jour, format, extension = extensionAffiche(format)) {
  const base = String(nomBoutique || 'boutique').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `affiche-${base || 'boutique'}-${jour || 'jour'}-${format}.${extension}`;
}
