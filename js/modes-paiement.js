/**
 * modes-paiement.js — Modes de paiement proposés, lus dans la base (étape 18f) :
 * modes_de_paiement(p_usage, p_pays) → [{ code, nom }], usage vente · credit · licence · fournisseur · colis.
 *
 *  - gardés en mémoire et dans le navigateur (par usage) pour proposer les mêmes modes hors ligne ;
 *  - aucune liste de modes ici : la base décide lesquels existent et leur nom. Ce fichier ne garde que
 *    l'apparence (couleurs des graphiques et pastilles) et deux types de vente qui ne sont pas des modes :
 *    « À crédit » (le client paiera plus tard) et « Chantier » (enlèvement sur un compte chantier).
 */
import { sb } from './supabase.js';
import { lireStockage, ecrireStockage } from './utils.js';

const cle = (usage, pays) => `yb_modes_${usage}${pays ? `_${pays}` : ''}`;
const memoire = new Map();
const enCours = new Map();

/** Types de vente enregistrés dans mode_paiement sans être des modes de paiement. */
const TYPES_VENTE = {
  credit: { libelle: 'À crédit', court: 'Crédit' },
  chantier: { libelle: 'Chantier', court: 'Chantier' }
};

/** Couleurs par code (graphiques, pastilles) ; un mode que la base ajoute prend la teinte neutre. */
const APPARENCE = {
  especes: { couleur: '#0A3D33', fond: '#E6ECE9', encre: '#0A3D33' },
  orange_money: { couleur: '#EF6C00', fond: '#FFE8D6', encre: '#8A3B00' },
  mtn_momo: { couleur: '#FBC02D', fond: '#FFF4C2', encre: '#5C4600' },
  wave: { couleur: '#1DA1F2', fond: '#E1F3FD', encre: '#0B4F7A' },
  credit: { couleur: '#90A4AE', fond: '#FBE9E7', encre: '#9A2E0A' },
  chantier: { couleur: '#3BA58A', fond: '#E0F2EC', encre: '#0A5E48' }
};
const NEUTRE = { couleur: '#7A8A86', fond: '#EEF1F0', encre: '#33423E' };

function normaliser(data) {
  return (Array.isArray(data) ? data : []).filter((m) => m?.code).map((m) => ({ code: String(m.code), nom: m.nom || String(m.code) }));
}

/** Modes d'un usage (réseau, sinon copie locale). Deux appels simultanés partagent la même requête. */
export async function chargerModes(usage, pays = null) {
  const k = cle(usage, pays);
  if (enCours.has(k)) return enCours.get(k);
  const promesse = (async () => {
    try {
      const { data, error } = await sb.rpc('modes_de_paiement', pays ? { p_usage: usage, p_pays: pays } : { p_usage: usage });
      if (error) throw error;
      const modes = normaliser(data);
      memoire.set(k, modes);
      ecrireStockage(k, modes);
      return modes;
    } catch (err) {
      console.warn('[YOUMMA] Modes de paiement non rechargés :', err?.message || err);
      return modesConnus(usage, pays);
    } finally {
      enCours.delete(k);
    }
  })();
  enCours.set(k, promesse);
  return promesse;
}

/** Modes déjà connus d'un usage (sans attendre le réseau) ; [] si jamais chargés. */
export function modesConnus(usage, pays = null) {
  const k = cle(usage, pays);
  if (!memoire.has(k)) {
    const copie = normaliser(lireStockage(k));
    if (!copie.length) return [];
    memoire.set(k, copie);
  }
  return memoire.get(k);
}

/** Nom d'un mode pour l'affichage (historique, reçus) : nom donné par la base, sinon le code lisible. */
export function libelleMode(code) {
  if (!code) return '';
  if (TYPES_VENTE[code]) return TYPES_VENTE[code].libelle;
  for (const modes of memoire.values()) {
    const m = modes.find((x) => x.code === code);
    if (m) return m.nom;
  }
  for (const usage of ['vente', 'credit', 'colis', 'fournisseur', 'licence']) {
    const m = modesConnus(usage).find((x) => x.code === code);
    if (m) return m.nom;
  }
  const lisible = String(code).replace(/_/g, ' ');
  return lisible.charAt(0).toUpperCase() + lisible.slice(1);
}

/** Libellé court (légendes, filtres) : « Crédit » au lieu de « À crédit ». */
export const courtMode = (code) => TYPES_VENTE[code]?.court || libelleMode(code);

/** Couleurs d'un mode : { couleur, fond, encre }. */
export const apparenceMode = (code) => APPARENCE[code] || NEUTRE;
