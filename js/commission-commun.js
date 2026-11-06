/**
 * commission-commun.js — Étape 24, abonnement ou commission : outils partagés par l'appli des boutiques (ce que je
 * dois, bandeau, vitrine coupée) et la console (choisir le mode, la liste à encaisser).
 *
 * Rien n'est recompté ici. Les réponses sont lues sous leur nom exact (étape 24c), et sous lui seul :
 *  - commission_du_mois / simuler_commission (commission) : mode, boutique, mois, taux_en_ligne, taux_comptoir, plafond,
 *    plafond_atteint, part_plafond (0–100 ou null), lignes[{ nom, taux, ventes, montant, commission }], ventes_total,
 *    brut, du, economise ; simulation : + aucune_vente, part_du_chiffre ;
 *  - commission_du_mois (abonnement) : mode, boutique, formule, licence_fin — rien d'autre ;
 *  - ma_commission : en_cours, impayes[{ mois, du, statut, envoye_le, jours }], etat ;
 *  - etat_commission : code, libelle, jours, mois, du, releve ;
 *  - boutiques_en_commission : mois, a_encaisser, boutiques[{ id, nom, ville, espace, taux_en_ligne, taux_comptoir,
 *    plafond_commission, du, plafond_atteint, etat }] ;
 *  - envoyer_releves : mois, sms_en_file, sans_telephone, releves[{ boutique, boutique_id, releve, du, tel, texte, sms }].
 * Un champ attendu qui manque s'affiche « — » et se signale dans la console (exiger) : il ne doit pas passer inaperçu.
 */
import { esc, formatNombre, formatGNF, FUSEAU } from './utils.js';

export const premiere = (d) => (Array.isArray(d) ? d[0] : d) ?? null;

/** Valeur du champ attendu ; absent → undefined et erreur dans la console (source : la fonction qui l'a renvoyé). */
export function exiger(o, nom, source) {
  if (o === null || o === undefined || !(nom in o)) {
    console.error(`[YOUMMA] ${source} : champ « ${nom} » absent de la réponse`);
    return undefined;
  }
  return o[nom];
}

/** Montant en GNF tel que le serveur l'a donné ; « — » s'il manque. */
export const montant = (n) => (n === undefined || n === null ? '—' : formatGNF(Number(n)));
export const taux = (t) => (t === null || t === undefined ? '—' : `${formatNombre(Number(t), 2)} %`);

/** « 2026-10-01 » → « octobre » (ou « octobre 2025 » hors de l'année en cours). */
export function nomMois(m) {
  const r = String(m || '').match(/^(\d{4})-(\d{2})/);
  if (!r) return String(m || '');
  const d = new Date(Date.UTC(Number(r[1]), Number(r[2]) - 1, 15));
  const annee = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, year: 'numeric' }).format(new Date());
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long', ...(r[1] === annee ? {} : { year: 'numeric' }) }).format(d);
}
/** « d’octobre », « de novembre ». */
export const deMois = (nom) => (/^[aeiouéèh]/i.test(nom) ? `d’${nom}` : `de ${nom}`);
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
 * Détail d'un décompte (lignes de commission_du_mois / simuler_commission) : nom, taux, nombre de ventes, montant des
 * ventes, commission. Les annulations (taux null) sont exclues du calcul : « non comptées », jamais soustraites.
 */
export function detailHTML(lignes, source) {
  if (!Array.isArray(lignes)) { console.error(`[YOUMMA] ${source} : champ « lignes » absent de la réponse`); return '<p class="bloc-erreur">Détail indisponible.</p>'; }
  return `<ul class="fy-detail">${lignes.map((l) => {
    const n = Number(exiger(l, 'ventes', source)) || 0;
    const exclue = exiger(l, 'taux', source) === null;
    return `<li><span class="fy-detail-nom">${esc(exiger(l, 'nom', source) ?? '—')}
        <small>${exclue ? '' : `${esc(taux(l.taux))} · `}${n} vente${n > 1 ? 's' : ''} · <span class="num">${esc(montant(exiger(l, 'montant', source)))}</span></small></span>
      ${exclue ? '<span class="fy-non-comptees">non comptées</span>' : `<strong class="num">${esc(montant(exiger(l, 'commission', source)))}</strong>`}</li>`;
  }).join('')}</ul>`;
}

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
  PLAFOND_INVALIDE: 'Plafond invalide : un montant positif, ou pas de plafond.',
  DEJA_PAYE: 'Ce relevé est déjà payé.',
  RELEVE_INTROUVABLE: 'Relevé introuvable : la liste a peut-être changé, rouvrez-la.',
  ACCES_REFUSE: 'Vous n’avez pas accès à la facturation de cette boutique.'
};
/** Message du serveur traduit ; « TAUX_INVALIDE: entre 0 et 50 » garde la précision donnée par le serveur. */
export function erreurFacturation(err) {
  const brut = String(err?.message || err || '');
  const t = brut.match(/TAUX_INVALIDE:?\s*(.*)$/);
  if (t) return t[1] ? `Taux invalide : ${t[1].trim()} %.` : 'Taux invalide.';
  const cle = Object.keys(ERREURS).find((c) => brut.includes(c));
  return cle ? ERREURS[cle] : brut || 'Une erreur est survenue.';
}
