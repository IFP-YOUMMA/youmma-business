/**
 * qr.js — Encodeur QR code modèle 2, rendu en SVG (étape 16). Aucune dépendance, aucun accès réseau : fonctions pures.
 *
 *  - mode octet (texte UTF-8), niveau de correction M (≈ 15 % de la surface peut être abîmée) ;
 *  - versions 1 à 10, la plus petite qui suffit est choisie toute seule ;
 *  - Reed-Solomon sur GF(256) (polynôme 0x11D), blocs entrelacés ;
 *  - les 8 masques sont essayés et notés selon les quatre pénalités de la norme ; le moins pénalisé est gardé ;
 *  - zone calme de 4 modules autour du dessin.
 */

/* ------------------------------------------------------------ Tables (niveau M) */

/** Pour chaque version (1 à 10) : codes de correction par bloc, puis les groupes [nombre de blocs, codes de données]. */
const BLOCS_M = [
  null,
  [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
  [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]]
];
/** Centres des motifs d'alignement. */
const ALIGNEMENTS = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const BITS_NIVEAU_M = 0; // L = 1, M = 0, Q = 3, H = 2 (champ de format)

const capaciteDonnees = (v) => BLOCS_M[v][1].reduce((s, [n, d]) => s + n * d, 0);

/* ------------------------------------------------------------ Reed-Solomon */

function multiplier(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function diviseur(degre) {
  const r = new Array(degre).fill(0);
  r[degre - 1] = 1;
  let racine = 1;
  for (let i = 0; i < degre; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = multiplier(r[j], racine);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    racine = multiplier(racine, 0x02);
  }
  return r;
}
function reste(donnees, div) {
  const r = div.map(() => 0);
  for (const b of donnees) {
    const facteur = b ^ r.shift();
    r.push(0);
    div.forEach((coef, i) => { r[i] ^= multiplier(coef, facteur); });
  }
  return r;
}

/* ------------------------------------------------------------ Données */

function octetsUtf8(texte) {
  return [...new TextEncoder().encode(String(texte))];
}

/** Codes de données (mode octet) complétés jusqu'à la capacité de la version. */
function codesDonnees(octets, version) {
  const bits = [];
  const ajouter = (valeur, n) => { for (let i = n - 1; i >= 0; i--) bits.push((valeur >>> i) & 1); };
  ajouter(0b0100, 4);
  ajouter(octets.length, version < 10 ? 8 : 16);
  octets.forEach((o) => ajouter(o, 8));
  const capacite = capaciteDonnees(version) * 8;
  ajouter(0, Math.min(4, capacite - bits.length));
  while (bits.length % 8) bits.push(0);
  const codes = [];
  for (let i = 0; i < bits.length; i += 8) codes.push(bits.slice(i, i + 8).reduce((s, b) => (s << 1) | b, 0));
  for (let pad = 0xec; codes.length < capacite / 8; pad ^= 0xec ^ 0x11) codes.push(pad);
  return codes;
}

/** Ajoute la correction de chaque bloc puis entrelace (données bloc par bloc, puis corrections). */
function codesFinaux(donnees, version) {
  const [nCorr, groupes] = BLOCS_M[version];
  const div = diviseur(nCorr);
  const blocs = [];
  let k = 0;
  for (const [n, d] of groupes) {
    for (let i = 0; i < n; i++) {
      const bloc = donnees.slice(k, k + d);
      k += d;
      blocs.push({ donnees: bloc, correction: reste(bloc, div) });
    }
  }
  const resultat = [];
  const maxD = Math.max(...blocs.map((b) => b.donnees.length));
  for (let i = 0; i < maxD; i++) blocs.forEach((b) => { if (i < b.donnees.length) resultat.push(b.donnees[i]); });
  for (let i = 0; i < nCorr; i++) blocs.forEach((b) => resultat.push(b.correction[i]));
  return resultat;
}

/* ------------------------------------------------------------ Dessin de la matrice */

function nouvelleMatrice(version) {
  const taille = version * 4 + 17;
  const modules = Array.from({ length: taille }, () => new Array(taille).fill(false));
  const fonction = Array.from({ length: taille }, () => new Array(taille).fill(false));
  const fixer = (x, y, noir) => { modules[y][x] = noir; fonction[y][x] = true; };
  return { version, taille, modules, fonction, fixer };
}

function dessinerFormat(m, masque) {
  const donnees = (BITS_NIVEAU_M << 3) | masque;
  let r = donnees;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  const bits = ((donnees << 10) | r) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) !== 0;
  const t = m.taille;
  for (let i = 0; i <= 5; i++) m.fixer(8, i, bit(i));
  m.fixer(8, 7, bit(6));
  m.fixer(8, 8, bit(7));
  m.fixer(7, 8, bit(8));
  for (let i = 9; i < 15; i++) m.fixer(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) m.fixer(t - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) m.fixer(8, t - 15 + i, bit(i));
  m.fixer(8, t - 8, true); // module noir obligatoire
}

function dessinerVersion(m) {
  if (m.version < 7) return;
  let r = m.version;
  for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
  const bits = (m.version << 12) | r;
  for (let i = 0; i < 18; i++) {
    const noir = ((bits >>> i) & 1) !== 0;
    const a = m.taille - 11 + (i % 3);
    const b = Math.floor(i / 3);
    m.fixer(a, b, noir);
    m.fixer(b, a, noir);
  }
}

function dessinerMotifs(m) {
  const t = m.taille;
  for (let i = 0; i < t; i++) { m.fixer(6, i, i % 2 === 0); m.fixer(i, 6, i % 2 === 0); }
  const reperage = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < t && y >= 0 && y < t) m.fixer(x, y, d !== 2 && d !== 4);
      }
    }
  };
  reperage(3, 3); reperage(t - 4, 3); reperage(3, t - 4);
  const pos = ALIGNEMENTS[m.version];
  const n = pos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) m.fixer(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  dessinerFormat(m, 0); // réservé ; réécrit avec le bon masque
  dessinerVersion(m);
}

function placerCodes(m, codes) {
  const t = m.taille;
  let i = 0;
  for (let droite = t - 1; droite >= 1; droite -= 2) {
    if (droite === 6) droite = 5;
    for (let v = 0; v < t; v++) {
      for (let j = 0; j < 2; j++) {
        const x = droite - j;
        const montant = ((droite + 1) & 2) === 0;
        const y = montant ? t - 1 - v : v;
        if (!m.fonction[y][x] && i < codes.length * 8) {
          m.modules[y][x] = ((codes[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}

function appliquerMasque(m, masque) {
  const regle = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  ][masque];
  for (let y = 0; y < m.taille; y++) {
    for (let x = 0; x < m.taille; x++) if (!m.fonction[y][x] && regle(x, y)) m.modules[y][x] = !m.modules[y][x];
  }
}

/**
 * Les quatre pénalités : suites de 5+ modules (N1), carrés 2×2 (N2), motifs 1:1:3:1:1 qui imitent un repère (N3),
 * déséquilibre noir/blanc (N4). N3 suit la norme : historique des suites, bords comptés comme clairs.
 */
function penalite(m) {
  const t = m.taille;
  const g = m.modules;
  let p = 0;
  const ajouterHistorique = (longueur, h) => {
    if (h[0] === 0) longueur += t; // le bord du symbole compte comme une suite claire
    h.pop();
    h.unshift(longueur);
  };
  const motifs = (h) => {
    const n = h[1];
    const coeur = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (coeur && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (coeur && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
  };
  const lignes = (lire) => {
    for (let a = 0; a < t; a++) {
      let couleur = false;
      let suite = 0;
      const h = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < t; b++) {
        if (lire(a, b) === couleur) {
          suite++;
          if (suite === 5) p += 3;
          else if (suite > 5) p++;
        } else {
          ajouterHistorique(suite, h);
          if (!couleur) p += motifs(h) * 40;
          couleur = lire(a, b);
          suite = 1;
        }
      }
      if (couleur) { ajouterHistorique(suite, h); suite = 0; }
      suite += t;
      ajouterHistorique(suite, h);
      p += motifs(h) * 40;
    }
  };
  lignes((y, x) => g[y][x]);
  lignes((x, y) => g[y][x]);
  for (let y = 0; y < t - 1; y++) {
    for (let x = 0; x < t - 1; x++) {
      const c = g[y][x];
      if (c === g[y][x + 1] && c === g[y + 1][x] && c === g[y + 1][x + 1]) p += 3;
    }
  }
  let noirs = 0;
  g.forEach((ligne) => ligne.forEach((c) => { if (c) noirs++; }));
  const total = t * t;
  p += (Math.ceil(Math.abs(noirs * 20 - total * 10) / total) - 1) * 10;
  return p;
}

/* ------------------------------------------------------------ API */

/** Matrice du QR : { version, taille, masque, noir(x, y) }. Lève une erreur si le texte dépasse la version 10.
 * options.masque : impose un masque (essais seulement ; sinon le moins pénalisé des 8). */
export function matriceQr(texte, { masque: masqueImpose = null } = {}) {
  const octets = octetsUtf8(texte);
  let version = 1;
  while (version <= 10 && 4 + (version < 10 ? 8 : 16) + octets.length * 8 > capaciteDonnees(version) * 8) version++;
  if (version > 10) throw new Error('Texte trop long pour un QR code de version 10.');
  const codes = codesFinaux(codesDonnees(octets, version), version);
  let meilleur = null;
  for (let masque = 0; masque < 8; masque++) {
    if (masqueImpose !== null && masque !== masqueImpose) continue;
    const m = nouvelleMatrice(version);
    dessinerMotifs(m);
    placerCodes(m, codes);
    appliquerMasque(m, masque);
    dessinerFormat(m, masque);
    const note = penalite(m);
    if (!meilleur || note < meilleur.note) meilleur = { m, note, masque };
  }
  const { m } = meilleur;
  return { version, taille: m.taille, masque: meilleur.masque, noir: (x, y) => m.modules[y][x] };
}

/** SVG du QR code, zone calme de 4 modules comprise. Le SVG s'adapte à la taille donnée en CSS. */
export function svgQr(texte, { couleur = '#000000', titre = 'QR code' } = {}) {
  const { taille, noir } = matriceQr(texte);
  const marge = 4;
  const cote = taille + marge * 2;
  const traits = [];
  for (let y = 0; y < taille; y++) {
    let x = 0;
    while (x < taille) {
      if (!noir(x, y)) { x++; continue; }
      let fin = x;
      while (fin < taille && noir(fin, y)) fin++;
      traits.push(`M${x + marge} ${y + marge}h${fin - x}v1h-${fin - x}z`);
      x = fin;
    }
  }
  const etiquette = String(titre).replace(/[<&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cote} ${cote}" shape-rendering="crispEdges" role="img" aria-label="${etiquette}">`
    + `<rect width="${cote}" height="${cote}" fill="#FFFFFF"/><path fill="${couleur}" d="${traits.join('')}"/></svg>`;
}
