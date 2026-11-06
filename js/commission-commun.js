/**
 * commission-commun.js — Étape 24, abonnement ou commission : lecture des réponses du serveur, partagée par l'appli
 * des boutiques (ce que je dois, bandeau, vitrine coupée) et la console (choisir le mode, la liste à encaisser).
 *
 * Rien n'est recompté ici : montants, nombres de ventes, plafond atteint viennent des fonctions telles quelles
 * (commission_du_mois, ma_commission, etat_commission, boutiques_en_commission). La forme exacte des réponses n'est
 * pas documentée : chaque valeur est cherchée sous ses noms probables (lire()).
 */
import { esc, formatNombre, formatGNF, formatDate, FUSEAU } from './utils.js';

export const premiere = (d) => (Array.isArray(d) ? d[0] : d) ?? null;
/** Premier champ présent parmi plusieurs noms possibles. */
export const lire = (o, ...noms) => noms.map((n) => o?.[n]).find((v) => v !== undefined && v !== null && v !== '');
const nombre = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/** Montant dans sa monnaie, tel que le serveur l'a donné (GNF par défaut). */
export function montant(n, devise = 'GNF') {
  const v = Number(n) || 0;
  if (!devise || devise === 'GNF') return formatGNF(v);
  return `${formatNombre(v)} ${devise === 'XOF' ? 'FCFA' : devise}`;
}
export const taux = (t) => (t === null || t === undefined || t === '' ? '—' : `${formatNombre(Number(t), 2)} %`);

/** « 2026-10 », « 2026-10-01 » ou un texte déjà rédigé → « octobre » (ou « octobre 2025 » hors de l'année en cours). */
export function nomMois(m) {
  const s = String(m || '');
  const r = s.match(/^(\d{4})-(\d{2})/);
  if (!r) return s;
  const d = new Date(Date.UTC(Number(r[1]), Number(r[2]) - 1, 15));
  const annee = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, year: 'numeric' }).format(new Date());
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long', ...(String(r[1]) === annee ? {} : { year: 'numeric' }) }).format(d);
}
/** Premier jour du mois (AAAA-MM-01), décalé de n mois depuis aujourd'hui (fuseau de Conakry). */
export function moisISO(decalage = 0) {
  const [a, m] = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit' }).format(new Date()).split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + decalage, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
/** Bornes du mois (du, au) pour la liste des ventes ; le mois en cours s'arrête aujourd'hui. */
export function bornesMois(m) {
  const r = String(m || moisISO()).match(/^(\d{4})-(\d{2})/);
  const debut = `${r[1]}-${r[2]}-01`;
  const fin = new Date(Date.UTC(Number(r[1]), Number(r[2]), 0)).toISOString().slice(0, 10);
  const aujourdhui = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU }).format(new Date());
  return { du: debut, au: fin < aujourdhui ? fin : aujourdhui };
}

/**
 * Le décompte d'un mois (commission_du_mois, ou celui que ma_commission embarque), sous une seule forme :
 * { mois, devise, du, ventes, nbVentes, plafond, plafondAtteint, partPlafond, partChiffre, dateLimite, lignes[] }.
 * partPlafond / partChiffre : la valeur du serveur si elle existe, sinon le rapport des deux montants qu'il a donnés.
 */
export function lireDecompte(d) {
  if (!d) return null;
  const devise = lire(d, 'devise') || 'GNF';
  const du = nombre(lire(d, 'commission', 'montant', 'du', 'total_commission', 'a_payer'));
  const ventes = nombre(lire(d, 'total_ventes', 'chiffre', 'ventes', 'chiffre_affaires', 'total'));
  const plafond = nombre(lire(d, 'plafond'));
  const plafondAtteint = Boolean(lire(d, 'plafond_atteint'));
  const brutes = Array.isArray(d.lignes) ? d.lignes : Array.isArray(d.detail) ? d.detail : null;
  const LIBELLES = { en_ligne: 'Boutique en ligne', web: 'Boutique en ligne', boutique_en_ligne: 'Boutique en ligne', comptoir: 'Comptoir', annulations: 'Annulations', annulees: 'Annulations' };
  const lignes = (brutes || ['en_ligne', 'boutique_en_ligne', 'web', 'comptoir', 'annulations', 'annulees'].filter((k) => d[k] && typeof d[k] === 'object').map((k) => ({ code: k, ...d[k] })))
    .map((l) => ({
      code: l.code || l.type || '',
      libelle: lire(l, 'libelle', 'nom') || LIBELLES[l.code || l.type] || l.code || '',
      taux: nombre(lire(l, 'taux')),
      nb: nombre(lire(l, 'nombre', 'nb', 'nb_ventes', 'ventes_nb', 'count')),
      ventes: nombre(lire(l, 'chiffre', 'total_ventes', 'montant_ventes', 'ventes')),
      montant: nombre(lire(l, 'montant', 'commission'))
    }));
  const nbVentes = nombre(lire(d, 'nb_ventes', 'nombre_ventes', 'nombre'));
  const partPlafond = nombre(lire(d, 'part_plafond', 'pourcentage_plafond', 'pct_plafond'))
    ?? (plafondAtteint ? 100 : plafond > 0 && du !== null ? Math.min(100, (du / plafond) * 100) : null);
  const partChiffre = nombre(lire(d, 'taux_effectif', 'pourcentage_chiffre', 'part_chiffre'))
    ?? (ventes > 0 && du !== null ? (du / ventes) * 100 : null);
  return {
    mois: lire(d, 'mois', 'periode'), devise, du, ventes, nbVentes, plafond, plafondAtteint,
    partPlafond: plafondAtteint ? 100 : partPlafond, partChiffre, dateLimite: lire(d, 'date_limite', 'echeance', 'a_regler_avant'),
    tauxEnLigne: nombre(lire(d, 'taux_en_ligne')), tauxComptoir: nombre(lire(d, 'taux_comptoir')), lignes
  };
}
/** Aucune vente sur le mois : on le dit plutôt que d'afficher un zéro trompeur. */
export const sansVente = (dc) => !dc || ((dc.ventes === null || dc.ventes === 0) && (dc.nbVentes === null || dc.nbVentes === 0)
  && !dc.lignes.some((l) => Number(l.nb) > 0 || Number(l.ventes) > 0));

/** État de l'escalade (etat_commission) → étiquette et couleur ; le plafond atteint passe après un retard. */
export function etiquetteEtat(etat, plafondAtteint = false) {
  const code = etat?.code || '';
  const j = Number(etat?.jours) || 0;
  const avecJours = (t) => (j ? `${t} · ${formatNombre(j)} j` : t);
  if (code === 'relancee') return { texte: avecJours('Relancée'), ton: 'orange' };
  if (code === 'avertie') return { texte: avecJours('Avertie'), ton: 'orange' };
  if (code === 'vitrine_coupee') return { texte: 'Vitrine coupée', ton: 'rouge' };
  if (code === 'blocage_possible') return { texte: 'Blocage possible', ton: 'rouge' };
  if (plafondAtteint) return { texte: 'Plafond atteint', ton: 'violet' };
  if (code === 'a_jour') return { texte: 'À jour', ton: 'vert' };
  return { texte: etat?.libelle || '—', ton: 'gris' };
}
export const pastilleEtat = (etat, plafondAtteint) => { const e = etiquetteEtat(etat, plafondAtteint); return `<span class="pastille-admin ${e.ton}">${esc(e.texte)}</span>`; };

/** Codes d'erreur des fonctions de facturation, en français. */
const ERREURS = {
  MODE_INVALIDE: 'Choisissez « Abonnement » ou « Commission ».',
  'TAUX_INVALIDE': 'Taux invalide : entre 0 et 50 %.',
  PLAFOND_INVALIDE: 'Plafond invalide : un montant positif, ou pas de plafond.',
  DEJA_PAYE: 'Ce relevé est déjà payé.',
  RELEVE_INTROUVABLE: 'Relevé introuvable : la liste a peut-être changé, rouvrez-la.',
  ACCES_REFUSE: 'Vous n’avez pas accès à la facturation de cette boutique.'
};
/** Message du serveur traduit ; « TAUX_INVALIDE: entre 0 et 50 » garde la précision donnée par le serveur. */
export function erreurFacturation(err) {
  const brut = String(err?.message || err || '');
  const taux = brut.match(/TAUX_INVALIDE:?\s*(.*)$/);
  if (taux) return taux[1] ? `Taux invalide : ${taux[1].trim()} %.` : ERREURS.TAUX_INVALIDE;
  const cle = Object.keys(ERREURS).find((c) => brut.includes(c));
  return cle ? ERREURS[cle] : brut || 'Une erreur est survenue.';
}

export const dateCourte = (d) => (d ? formatDate(d, 'court') : '');
