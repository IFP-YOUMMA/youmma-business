/**
 * lib/telephone.js — Numéros guinéens et sénégalais, même règle que tel_sms côté serveur.
 * Module sans dépendance : l'appli le reçoit par utils.js, les pages publiques (d/, v/, b/) l'importent directement.
 */

/**
 * Normalise un numéro guinéen (224XXXXXXXXX) ou sénégalais (221XXXXXXXXX).
 * Sans indicatif : 9 chiffres en 6 ou 3 → Guinée ; en 70, 75, 76, 77 ou 78 → Sénégal.
 * Accepte « 6XX XX XX XX », « 77 123 45 67 », « +224 6XX… », « 00221 77… ». Renvoie null si invalide.
 */
export function normaliserTelephone(saisie) {
  let chiffres = String(saisie || '').trim().replace(/[\s.\-()]/g, '');
  if (chiffres.startsWith('+')) chiffres = chiffres.slice(1);
  else if (chiffres.startsWith('00')) chiffres = chiffres.slice(2);
  if (!/^\d+$/.test(chiffres)) return null;
  if (/^[36]\d{8}$/.test(chiffres)) chiffres = '224' + chiffres;
  else if (/^7[05678]\d{7}$/.test(chiffres)) chiffres = '221' + chiffres;
  return /^224[36]\d{8}$/.test(chiffres) || /^2217\d{8}$/.test(chiffres) ? chiffres : null;
}

/** « 224621234567 » → « +224 621 23 45 67 » ; « 221771234567 » → « +221 77 123 45 67 » (affichage). */
export function formatTelephone(numero) {
  const n = normaliserTelephone(numero);
  if (!n) return String(numero || '');
  const l = n.slice(3);
  return n.startsWith('221')
    ? `+221 ${l.slice(0, 2)} ${l.slice(2, 5)} ${l.slice(5, 7)} ${l.slice(7)}`
    : `+224 ${l.slice(0, 3)} ${l.slice(3, 5)} ${l.slice(5, 7)} ${l.slice(7)}`;
}

/** Affichage court : guinéen sans indicatif (« 621 23 45 67 »), sénégalais avec (« +221 77 123 45 67 »). */
export function formatTelephoneLocal(numero) {
  return formatTelephone(numero).replace(/^\+224\s*/, '');
}
