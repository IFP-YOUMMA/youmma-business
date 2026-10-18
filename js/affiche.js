/**
 * affiche.js — Dessin de l'affiche du jour dans un <canvas> (maquette Affiches.dc.html).
 *
 * Formats : « statut » 1080 × 1920 (statut WhatsApp) et « carre » 1080 × 1080 (Facebook).
 * Modèles : promo (orange), jour (bleu YOUMMA), arrivage (blanc).
 * Tout est dessiné localement : photo de l'article (crossOrigin anonyme, icône si elle ne charge pas),
 * QR code du lien de la boutique (js/qr.js), police Manrope.
 */
import { ICONES, formatNombre, iconeUnite, FUSEAU } from './utils.js';
import { dessinerQr } from './qr.js';

export const FORMATS_AFFICHE = { statut: { largeur: 1080, hauteur: 1920 }, carre: { largeur: 1080, hauteur: 1080 } };

const THEMES = {
  promo: {
    etiquette: 'PROMO', fond: ['#EF6C00', '#C43E00'], texte: '#FFFFFF', logoFond: '#FFFFFF', logoTexte: '#C43E00',
    tagFond: '#FFFFFF', tagTexte: '#C43E00', visuelFond: 'rgba(255,255,255,0.16)', visuelEncre: '#FFFFFF', prix: '#FFFFFF', pied: 'rgba(0,0,0,0.18)'
  },
  jour: {
    etiquette: 'LE PRODUIT DU JOUR', fond: ['#0B1F3A', '#13305A', '#1565C0'], texte: '#FFFFFF', logoFond: '#FFFFFF', logoTexte: '#0B1F3A',
    tagFond: '#4FC3F7', tagTexte: '#0B1F3A', visuelFond: 'rgba(255,255,255,0.10)', visuelEncre: '#4FC3F7', prix: '#FFFFFF', pied: 'rgba(0,0,0,0.22)'
  },
  arrivage: {
    etiquette: 'NOUVEL ARRIVAGE', fond: ['#FFFFFF'], texte: '#0F1B2D', logoFond: '#0B1F3A', logoTexte: '#FFFFFF',
    tagFond: '#1565C0', tagTexte: '#FFFFFF', visuelFond: '#E3EEFB', visuelEncre: '#1565C0', prix: '#0D47A1', pied: '#F4F6FA'
  }
};
export const LIBELLES_MODELES_AFFICHE = { promo: 'Promotion', jour: 'Du jour', arrivage: 'Arrivage' };

const POLICE = 'Manrope, system-ui, sans-serif';
const police = (poids, taille) => `${poids} ${taille}px ${POLICE}`;

/** Attend Manrope (sinon le texte serait mesuré avec une police de secours). */
async function policesPretes() {
  try {
    await Promise.all([document.fonts.load(police(800, 80)), document.fonts.load(police(700, 40)), document.fonts.load(police(500, 30))]);
    await document.fonts.ready;
  } catch { /* police système */ }
}

/** Charge une image distante en mode CORS (sinon le canvas serait « sali » et non exportable). */
function chargerImageDistante(url) {
  return new Promise((resoudre) => {
    if (!url) { resoudre(null); return; }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    const minuteur = setTimeout(() => resoudre(null), 8000);
    image.onload = () => { clearTimeout(minuteur); resoudre(image); };
    image.onerror = () => { clearTimeout(minuteur); resoudre(null); };
    image.src = url;
  });
}

function rectArrondi(ctx, x, y, l, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + l, y, x + l, y + h, r);
  ctx.arcTo(x + l, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + l, y, r);
  ctx.closePath();
}

/** Découpe un texte en lignes de largeur max ; la dernière ligne finit par « … » si besoin. */
function couperLignes(ctx, texte, largeurMax, maxLignes) {
  const mots = String(texte || '').trim().split(/\s+/);
  const lignes = [];
  let courante = '';
  for (let i = 0; i < mots.length; i++) {
    const essai = courante ? `${courante} ${mots[i]}` : mots[i];
    if (ctx.measureText(essai).width <= largeurMax || !courante) {
      courante = essai;
    } else {
      lignes.push(courante);
      courante = mots[i];
      if (lignes.length === maxLignes) { courante = ''; lignes[maxLignes - 1] += ` ${mots.slice(i).join(' ')}`; break; }
    }
  }
  if (courante) lignes.push(courante);
  const resultat = lignes.slice(0, maxLignes);
  const derniere = resultat.length - 1;
  if (lignes.length > maxLignes || ctx.measureText(resultat[derniere]).width > largeurMax) {
    let l = resultat[derniere];
    while (l.length > 1 && ctx.measureText(`${l}…`).width > largeurMax) l = l.slice(0, -1);
    resultat[derniere] = `${l.trimEnd()}…`;
  }
  return resultat;
}

/** Nom de l'article : 2 lignes max, taille réduite tant que ça ne tient pas sans couper. */
function ajusterNom(ctx, nom, largeurMax, tailleMax, tailleMin) {
  for (let taille = tailleMax; taille >= tailleMin; taille -= 4) {
    ctx.font = police(800, taille);
    const mots = String(nom).split(/\s+/);
    const tientMot = mots.every((m) => ctx.measureText(m).width <= largeurMax);
    const lignes = couperLignes(ctx, nom, largeurMax, 2);
    if (tientMot && !lignes.at(-1).endsWith('…')) return { taille, lignes };
  }
  ctx.font = police(800, tailleMin);
  return { taille: tailleMin, lignes: couperLignes(ctx, nom, largeurMax, 2) };
}

function initiales(nom) {
  const mots = String(nom || '').trim().split(/\s+/).filter(Boolean);
  return ((mots[0]?.[0] || '') + (mots[1]?.[0] || '')).toUpperCase() || 'Y';
}

function dateAffiche(jour) {
  const d = jour ? new Date(`${jour}T12:00:00Z`) : new Date();
  return new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

/** Image « cover » dans un rectangle arrondi. */
function dessinerCouverture(ctx, image, x, y, l, h, r) {
  ctx.save();
  rectArrondi(ctx, x, y, l, h, r);
  ctx.clip();
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x, y, l, h);
  const echelle = Math.max(l / image.width, h / image.height);
  const lw = image.width * echelle;
  const lh = image.height * echelle;
  ctx.drawImage(image, x + (l - lw) / 2, y + (h - lh) / 2, lw, lh);
  ctx.restore();
}

/** Icône (tracé 24 × 24 de ICONES) centrée dans un carré de `cote` px. */
function dessinerIcone(ctx, nom, cx, cy, cote, couleur) {
  ctx.save();
  ctx.translate(cx - cote / 2, cy - cote / 2);
  ctx.scale(cote / 24, cote / 24);
  ctx.strokeStyle = couleur;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(ICONES[nom] || ICONES.stock));
  ctx.restore();
}

function remplirFond(ctx, theme, largeur, hauteur) {
  if (theme.fond.length === 1) {
    ctx.fillStyle = theme.fond[0];
  } else {
    // Dégradé à 160° comme la maquette.
    const g = ctx.createLinearGradient(largeur * 0.33, 0, largeur * 0.67, hauteur);
    theme.fond.forEach((c, i) => g.addColorStop(i / (theme.fond.length - 1), c));
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, largeur, hauteur);
}

/**
 * Génère l'affiche et renvoie le canvas.
 * donnees : { boutique: { nom, ville, logo_url }, produit: { nom, unite, photo_url, prix, prix_barre },
 *             modele, phrase, jour (AAAA-MM-JJ), lien (encodé dans le QR), lienCourt, whatsapp (texte affiché) }
 */
export async function genererAffiche(donnees, format = 'statut') {
  const { largeur, hauteur } = FORMATS_AFFICHE[format] || FORMATS_AFFICHE.statut;
  const theme = THEMES[donnees.modele] || THEMES.jour;
  const [photo, logo] = await Promise.all([
    chargerImageDistante(donnees.produit?.photo_url),
    chargerImageDistante(donnees.boutique?.logo_url),
    policesPretes()
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = largeur;
  canvas.height = hauteur;
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  remplirFond(ctx, theme, largeur, hauteur);

  const carre = format === 'carre';
  const marge = carre ? 60 : 66;
  const produit = donnees.produit || {};

  /* --- En-tête : logo + nom + ville · date --- */
  const tailleLogo = carre ? 104 : 120;
  if (logo) {
    dessinerCouverture(ctx, logo, marge, marge, tailleLogo, tailleLogo, 30);
  } else {
    ctx.fillStyle = theme.logoFond;
    rectArrondi(ctx, marge, marge, tailleLogo, tailleLogo, 34);
    ctx.fill();
    ctx.fillStyle = theme.logoTexte;
    ctx.font = police(800, tailleLogo * 0.38);
    ctx.textAlign = 'center';
    ctx.fillText(initiales(donnees.boutique?.nom), marge + tailleLogo / 2, marge + tailleLogo / 2 + tailleLogo * 0.13);
    ctx.textAlign = 'left';
  }
  const xTexteEntete = marge + tailleLogo + 30;
  const largeurEntete = largeur - xTexteEntete - marge;
  ctx.fillStyle = theme.texte;
  ctx.font = police(800, carre ? 42 : 45);
  ctx.fillText(couperLignes(ctx, donnees.boutique?.nom || '', largeurEntete, 1)[0], xTexteEntete, marge + tailleLogo * 0.45);
  ctx.globalAlpha = 0.8;
  ctx.font = police(500, carre ? 30 : 33);
  const sous = [donnees.boutique?.ville, dateAffiche(donnees.jour)].filter(Boolean).join(' · ');
  ctx.fillText(couperLignes(ctx, sous, largeurEntete, 1)[0], xTexteEntete, marge + tailleLogo * 0.82);
  ctx.globalAlpha = 1;

  /* --- Étiquette (PROMO, LE PRODUIT DU JOUR, NOUVEL ARRIVAGE) --- */
  const yTag = marge + tailleLogo + (carre ? 48 : 78);
  ctx.font = police(800, carre ? 38 : 42);
  const espacement = 0.06 * (carre ? 38 : 42);
  const largeurTag = [...theme.etiquette].reduce((t, c) => t + ctx.measureText(c).width + espacement, 0) - espacement + 72;
  const hauteurTag = carre ? 70 : 78;
  ctx.fillStyle = theme.tagFond;
  rectArrondi(ctx, marge, yTag, largeurTag, hauteurTag, 30);
  ctx.fill();
  ctx.fillStyle = theme.tagTexte;
  let xLettre = marge + 36;
  for (const c of theme.etiquette) { ctx.fillText(c, xLettre, yTag + hauteurTag * 0.7); xLettre += ctx.measureText(c).width + espacement; }

  /* --- Pied : QR + « Commandez en ligne » + lien court + WhatsApp --- */
  const hauteurPied = carre ? 220 : 282;
  const yPied = hauteur - hauteurPied;
  ctx.fillStyle = theme.pied;
  ctx.fillRect(0, yPied, largeur, hauteurPied);
  const coteQr = carre ? 156 : 174;
  const yQr = yPied + (hauteurPied - coteQr) / 2;
  if (donnees.lien) {
    ctx.fillStyle = '#FFFFFF';
    rectArrondi(ctx, marge, yQr, coteQr, coteQr, 24);
    ctx.fill();
    dessinerQr(ctx, donnees.lien, marge + 8, yQr + 8, coteQr - 16);
  }
  const xPied = marge + (donnees.lien ? coteQr + 36 : 0);
  const largeurPied = largeur - xPied - marge;
  ctx.fillStyle = theme.texte;
  ctx.font = police(800, carre ? 40 : 42);
  ctx.fillText('Commandez en ligne', xPied, yQr + (carre ? 46 : 52));
  ctx.globalAlpha = 0.85;
  ctx.font = police(600, carre ? 30 : 34);
  if (donnees.lienCourt) ctx.fillText(couperLignes(ctx, donnees.lienCourt, largeurPied, 1)[0], xPied, yQr + (carre ? 98 : 110));
  if (donnees.whatsapp) ctx.fillText(`WhatsApp ${donnees.whatsapp}`, xPied, yQr + (carre ? 146 : 164));
  ctx.globalAlpha = 1;

  /* --- Visuel produit + nom + prix --- */
  const blocPrix = (x, y, largeurBloc, tailles) => {
    const nom = ajusterNom(ctx, produit.nom || '', largeurBloc, tailles.nom, tailles.nomMin);
    ctx.fillStyle = theme.texte;
    ctx.font = police(800, nom.taille);
    let yc = y + nom.taille;
    nom.lignes.forEach((ligne, i) => { ctx.fillText(ligne, x, yc); if (i < nom.lignes.length - 1) yc += nom.taille * 1.1; });
    yc += tailles.ecart;
    if (produit.prix_barre && Number(produit.prix_barre) > Number(produit.prix)) {
      ctx.globalAlpha = 0.7;
      ctx.font = police(700, tailles.barre);
      const texteBarre = `${formatNombre(produit.prix_barre)} GNF`;
      ctx.fillText(texteBarre, x, yc + tailles.barre);
      const lb = ctx.measureText(texteBarre).width;
      ctx.fillRect(x, yc + tailles.barre * 0.62, lb, Math.max(3, tailles.barre * 0.08));
      ctx.globalAlpha = 1;
      yc += tailles.barre * 1.35;
    }
    ctx.fillStyle = theme.prix;
    ctx.font = police(800, tailles.prix);
    const textePrix = formatNombre(produit.prix);
    ctx.fillText(textePrix, x, yc + tailles.prix);
    const lp = ctx.measureText(`${textePrix} `).width;
    ctx.font = police(800, tailles.unite);
    const texteUnite = `GNF / ${produit.unite || 'unité'}`;
    if (lp + ctx.measureText(texteUnite).width <= largeurBloc) {
      ctx.fillText(texteUnite, x + lp, yc + tailles.prix);
      yc += tailles.prix * 1.25;
    } else {
      // Prix très long (format carré) : l'unité passe sous le prix au lieu d'être coupée.
      ctx.fillText(couperLignes(ctx, texteUnite, largeurBloc, 1)[0], x, yc + tailles.prix + tailles.unite * 1.2);
      yc += tailles.prix * 1.25 + tailles.unite * 1.2;
    }
    if (donnees.phrase) {
      ctx.fillStyle = theme.texte;
      ctx.globalAlpha = 0.9;
      ctx.font = police(700, tailles.phrase);
      couperLignes(ctx, donnees.phrase, largeurBloc, 2).forEach((ligne, i) => ctx.fillText(ligne, x, yc + tailles.phrase * (1 + i * 1.3)));
      ctx.globalAlpha = 1;
    }
  };
  const visuel = (x, y, l, h) => {
    if (photo) {
      dessinerCouverture(ctx, photo, x, y, l, h, 60);
    } else {
      ctx.fillStyle = theme.visuelFond;
      rectArrondi(ctx, x, y, l, h, 60);
      ctx.fill();
      dessinerIcone(ctx, iconeUnite(produit.unite), x + l / 2, y + h / 2, Math.min(l, h) * 0.5, theme.visuelEncre);
    }
  };

  if (carre) {
    const yContenu = yTag + hauteurTag + 40;
    const hContenu = yPied - 40 - yContenu;
    const coteVisuel = Math.min(440, hContenu);
    visuel(marge, yContenu, coteVisuel, coteVisuel);
    const xBloc = marge + coteVisuel + 44;
    blocPrix(xBloc, yContenu, largeur - xBloc - marge, { nom: 64, nomMin: 40, ecart: 22, barre: 38, prix: 92, unite: 34, phrase: 32 });
  } else {
    const yVisuel = yTag + hauteurTag + 66;
    const hVisuel = 660;
    visuel(marge, yVisuel, largeur - marge * 2, hVisuel);
    blocPrix(marge, yVisuel + hVisuel + 50, largeur - marge * 2, { nom: 84, nomMin: 56, ecart: 24, barre: 48, prix: 120, unite: 48, phrase: 42 });
  }
  return canvas;
}

/** Canvas → Blob PNG. */
export function versPng(canvas) {
  return new Promise((resoudre, rejeter) => canvas.toBlob((b) => (b ? resoudre(b) : rejeter(new Error('Image impossible'))), 'image/png'));
}

/** Nom de fichier lisible : affiche-<boutique>-<jour>-<format>.png */
export function nomFichierAffiche(nomBoutique, jour, format) {
  const base = String(nomBoutique || 'boutique').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `affiche-${base || 'boutique'}-${jour || 'jour'}-${format}.png`;
}
