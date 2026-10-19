/**
 * lettres.js — Montant en toutes lettres, en français (orthographe traditionnelle, comme sur les factures) :
 * « vingt et un », « soixante et onze », « quatre-vingts » (pluriel seulement en fin de nombre),
 * « cent » au pluriel seulement quand il termine, « mille » invariable, « un million », « deux milliards ».
 * Aucune dépendance : utilisé par le moteur de documents et testé à part.
 */

const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

/** 0 à 99. `finale` : le nombre se termine ici (ou avant million/milliard) → « quatre-vingts ». */
function moinsDeCent(n, finale) {
  if (n < 17) return UNITES[n];
  if (n < 20) return `dix-${UNITES[n - 10]}`;
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d <= 6) {
    if (u === 0) return DIZAINES[d];
    return u === 1 ? `${DIZAINES[d]} et un` : `${DIZAINES[d]}-${UNITES[u]}`;
  }
  if (d === 7) return u === 1 ? 'soixante et onze' : `soixante-${moinsDeCent(10 + u, finale)}`;
  if (d === 8) return u === 0 ? (finale ? 'quatre-vingts' : 'quatre-vingt') : `quatre-vingt-${UNITES[u]}`;
  return `quatre-vingt-${moinsDeCent(10 + u, finale)}`;
}

/** 0 à 999 (0 → ''). */
function moinsDeMille(n, finale) {
  const c = Math.floor(n / 100);
  const r = n % 100;
  let texte = '';
  if (c === 1) texte = 'cent';
  else if (c > 1) texte = `${UNITES[c]} cent${r === 0 && finale ? 's' : ''}`;
  if (r) texte = texte ? `${texte} ${moinsDeCent(r, finale)}` : moinsDeCent(r, finale);
  return texte;
}

/** Nombre entier positif en lettres (jusqu'à 999 999 999 999). Au-delà : les chiffres. */
export function nombreEnLettres(valeur) {
  const n = Math.round(Math.abs(Number(valeur) || 0));
  if (n === 0) return 'zéro';
  if (n > 999999999999) return String(n);
  const milliards = Math.floor(n / 1e9);
  const millions = Math.floor((n % 1e9) / 1e6);
  const milliers = Math.floor((n % 1e6) / 1e3);
  const reste = n % 1e3;
  const parties = [];
  // Million et milliard sont des noms : « deux cents millions », « quatre-vingts milliards ».
  if (milliards) parties.push(`${moinsDeMille(milliards, true)} milliard${milliards > 1 ? 's' : ''}`);
  if (millions) parties.push(`${moinsDeMille(millions, true)} million${millions > 1 ? 's' : ''}`);
  // Mille est invariable et ne prend pas « un » ; devant lui, « cent » et « vingt » restent au singulier.
  if (milliers) parties.push(milliers === 1 ? 'mille' : `${moinsDeMille(milliers, false)} mille`);
  if (reste) parties.push(moinsDeMille(reste, true));
  return parties.join(' ');
}

/** « douze millions sept cent quarante-cinq mille francs guinéens ». */
export function montantEnLettres(valeur) {
  const n = Math.round(Math.abs(Number(valeur) || 0));
  const lettres = nombreEnLettres(n);
  // « un million de francs », « deux milliards de francs » (nombre rond en millions/milliards).
  const de = n >= 1e6 && n % 1e6 === 0 ? ' de' : '';
  return `${lettres}${de} ${n <= 1 ? 'franc guinéen' : 'francs guinéens'}`;
}
