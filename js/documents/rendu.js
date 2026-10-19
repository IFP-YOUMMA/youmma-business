/**
 * rendu.js — Moteur des documents de vente A4 : facture, reçu, facture proforma, bon de livraison.
 * Trois modèles (maquettes RecuA4Classique, RecuA4Moderne ; « Sobre » noir et blanc, sans aplat de couleur).
 * Fonction pure : aucune requête. Utilisée par l'aperçu des réglages, la page d'impression (document.html)
 * et l'impression d'essai. Le CSS est intégré et préfixé « .ybd » (n'affecte pas le reste de la page).
 */
import {
  esc, formatNombre, formatQuantite, formatDate, formatTelephone, formatNumeroVente, initiales, urlLogo, MODES_PAIEMENT
} from '../utils.js';
import { svgQr } from '../qr.js';
import { montantEnLettres } from './lettres.js';

/** Adresse publique de vérification (QR code des documents). */
export const URL_VERIFICATION = 'https://ifp-youmma.github.io/youmma-business/v/';
export const lienVerification = (code) => `${URL_VERIFICATION}?c=${encodeURIComponent(code)}`;

export const TITRES_DOCUMENTS = {
  facture: 'FACTURE', recu: 'REÇU DE VENTE', proforma: 'FACTURE PROFORMA', bon_livraison: 'BON DE LIVRAISON'
};
export const LIBELLES_DOCUMENTS = { facture: 'Facture', recu: 'Reçu', proforma: 'Facture proforma', bon_livraison: 'Bon de livraison' };

/** Valeurs par défaut d'une ligne boutique_documents (complétées par la base). */
export const OPTIONS_DEFAUT = {
  lettres: true, prix_unitaire: true, client_detail: true, chantier: true, paiement: true,
  signatures: true, qr: true, statut: true, coupon: false, tva: false
};
export const REGLAGES_DEFAUT = {
  modele: 'classique', couleur: '#0F7B5F', accent: '#F2B33D', titre_vente: 'facture', format_defaut: 'a4',
  prefixes: { facture: 'FAC', recu: 'REC', proforma: 'PRO', bon_livraison: 'BL' },
  options: OPTIONS_DEFAUT, tva_taux: 18, validite_proforma: 15, cachet_vendeurs: false
};

/* ------------------------------------------------------------ Couleurs et contraste */

const HEX = /^#[0-9a-f]{6}$/i;
const couleurValide = (c, defaut) => (HEX.test(String(c || '')) ? String(c).toUpperCase() : defaut);
function rvb(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); }
function versHex(t) { return '#' + t.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase(); }
function luminance(hex) {
  const [r, g, b] = rvb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Rapport de contraste WCAG entre deux couleurs. */
export function contraste(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Mélange avec du noir (t > 0) ou du blanc (t < 0). */
function nuancer(hex, t) {
  const cible = t > 0 ? 0 : 255;
  const k = Math.abs(t);
  return versHex(rvb(hex).map((v) => v + (cible - v) * k));
}
/** Texte posé sur la couleur : blanc seulement si le contraste atteint 4,5:1, sinon foncé. */
export function texteSur(fond) { return contraste('#FFFFFF', fond) >= 4.5 ? '#FFFFFF' : '#111111'; }
/** La couleur, assombrie si besoin pour être lisible en texte sur `fond` (4,5:1). */
function encreLisible(hex, fond = '#FFFFFF') {
  let c = hex;
  for (let i = 0; i < 20 && contraste(c, fond) < 4.5; i++) c = nuancer(c, 0.08);
  return c;
}

/* ------------------------------------------------------------ Aides de mise en page */

const nb = (v) => formatNombre(Math.round(Number(v) || 0));
const ligneSi = (texte) => (texte ? `<span>${texte}</span>` : '');
const datePlus = (iso, jours) => new Date(new Date(iso).getTime() + Number(jours || 0) * 86400000);

function etatVente(vente) {
  if (!vente) return null;
  if (vente.statut === 'annulee') return { code: 'annulee', texte: 'ANNULÉE' };
  if (vente.mode_paiement === 'credit') return { code: 'credit', texte: 'À CRÉDIT' };
  if (vente.mode_paiement === 'chantier') return { code: 'chantier', texte: 'COMPTE CHANTIER' };
  return { code: 'paye', texte: 'PAYÉE' };
}
function etatProforma(p) {
  if (!p) return null;
  if (p.statut === 'converti') return { code: 'paye', texte: 'TRANSFORMÉ EN VENTE' };
  if (p.statut === 'accepte') return { code: 'paye', texte: 'ACCEPTÉ' };
  if (p.statut === 'refuse') return { code: 'annulee', texte: 'REFUSÉ' };
  if (datePlus(p.created_at, p.validite_jours) < new Date()) return { code: 'credit', texte: 'EXPIRÉ' };
  return { code: 'chantier', texte: 'DEVIS' };
}

/** Texte du bloc paiement (une vente = un seul mode de paiement). */
function textePaiement(vente, chantier) {
  if (!vente) return null;
  const mode = MODES_PAIEMENT[vente.mode_paiement]?.libelle || vente.mode_paiement;
  if (vente.statut === 'annulee') return { titre: `${mode} — vente annulée`, detail: '' };
  if (vente.mode_paiement === 'credit') {
    return { titre: `À crédit${vente.echeance ? ` — échéance ${formatDate(`${String(vente.echeance).slice(0, 10)}T12:00:00Z`, 'jourMois')}` : ''}`, detail: '' };
  }
  if (vente.mode_paiement === 'chantier') return { titre: `Compte chantier${chantier?.numero ? ` ${chantier.numero}` : ''}`, detail: '' };
  return { titre: `${mode} — Payée`, detail: '' };
}

/** Données d'exemple (aperçu sans vente réelle, impression d'essai). */
export function donneesExemple(boutique) {
  const lignes = [
    { nom: 'Ciment CPJ 42,5 (sac 50 kg)', unite: 'sac', quantite: 40, prix: 82000 },
    { nom: 'Fer à béton Ø10 (barre 12 m)', unite: 'barre', quantite: 60, prix: 72000 },
    { nom: 'Tôle bac 0,35 mm (3 m)', unite: 'feuille', quantite: 45, prix: 70000 },
    { nom: 'Clous de 8', unite: 'kg', quantite: 15, prix: 25000 }
  ].map((l) => ({ ...l, total: l.quantite * l.prix }));
  const sousTotal = lignes.reduce((s, l) => s + l.total, 0);
  return {
    vente: { numero: 312, created_at: new Date().toISOString(), sous_total: sousTotal, remise: 0, frais_livraison: 0, total: sousTotal, mode_paiement: 'orange_money', statut: 'validee' },
    lignes,
    client: { nom: 'Entreprise BTP Kaba SARL', telephone: '224621112233', info: 'Kagbélen, Dubréka · NIF 987654321' },
    vendeur: 'Aïssatou',
    boutique
  };
}

/* ------------------------------------------------------------ Rendu */

/**
 * HTML A4 autonome d'un document.
 * p = { type, modele, reglages, boutique, document, vente, proforma, lignes, client, chantier, recuperePar,
 *       livraison: { zone, adresse, commande }, vendeur, cachetUrl, signatureUrl, essai, avecPrix (bon de livraison) }
 * lignes : [{ nom, unite, quantite, prix, total }].
 */
export function rendreDocument(p) {
  const r = { ...REGLAGES_DEFAUT, ...(p.reglages || {}) };
  const o = { ...OPTIONS_DEFAUT, ...(r.options || {}) };
  const type = TITRES_DOCUMENTS[p.type] ? p.type : 'facture';
  const modele = ['classique', 'moderne', 'sobre'].includes(p.modele || r.modele) ? (p.modele || r.modele) : 'classique';
  const b = p.boutique || {};
  const vente = type === 'proforma' ? null : p.vente || null;
  const pf = type === 'proforma' ? p.proforma || {} : null;
  const bl = type === 'bon_livraison';
  const avecPrix = bl ? Boolean(p.avecPrix) : true;
  const pu = o.prix_unitaire && avecPrix;
  const lignes = (p.lignes || []).map((l) => ({
    nom: l.nom ?? l.nom_produit ?? '', unite: l.unite || '', quantite: Number(l.quantite) || 0,
    prix: Number(l.prix ?? l.prix_unitaire) || 0, total: Number(l.total) || Math.round((Number(l.prix ?? l.prix_unitaire) || 0) * (Number(l.quantite) || 0))
  }));

  // Couleurs : principale, accent ; le modèle Sobre est entièrement noir et blanc.
  const sobre = modele === 'sobre';
  const c = sobre ? '#111111' : couleurValide(r.couleur, REGLAGES_DEFAUT.couleur);
  const a = sobre ? '#444444' : couleurValide(r.accent, REGLAGES_DEFAUT.accent);
  const fonce = nuancer(c, 0.35);
  const vars = {
    '--c': c, '--c-texte': texteSur(c), '--c-encre': encreLisible(c), '--a': a, '--a-texte': texteSur(a), '--a-encre': encreLisible(a),
    '--c-fonce': fonce, '--fonce-texte': texteSur(fonce),
    '--total-montant': contraste(a, fonce) >= 3 ? a : texteSur(fonce),
    '--a-doux': nuancer(a, -0.9), '--entete-texte': texteSur(c)
  };
  const style = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');

  // Montants.
  const sousTotal = Number(vente?.sous_total ?? pf?.sous_total ?? lignes.reduce((s, l) => s + l.total, 0)) || 0;
  const remise = Number(vente?.remise ?? pf?.remise) || 0;
  const livraison = Number(vente?.frais_livraison) || 0;
  const total = Number(vente?.total ?? pf?.total ?? sousTotal - remise + livraison) || 0;
  const taux = Number(r.tva_taux) || 0;
  const ht = Math.round(total / (1 + taux / 100));

  // Identité de la boutique.
  const nom = r.nom_affiche || b.nom || 'Ma boutique';
  const lieu = [r.adresse, [b.commune, b.ville].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const tels = r.telephones || (b.telephone ? formatTelephone(b.telephone) : '');
  const legal = [r.rccm ? `RCCM ${r.rccm}` : '', r.nif ? `NIF ${r.nif}` : ''].filter(Boolean).join(' · ');
  const logo = b.logo_url
    ? `<img class="ybd-logo" src="${esc(b.logo_url)}" alt="" crossorigin="anonymous">`
    : `<span class="ybd-logo ybd-initiales">${esc(initiales(nom))}</span>`;

  // En-tête droite : numéro, référence, date, vendeur, statut.
  const numero = p.document?.numero || (p.essai || p.apercu ? `${(r.prefixes || {})[type] || 'DOC'}-${new Date().getFullYear()}-0000` : '');
  const dateDoc = vente?.created_at || pf?.created_at || p.document?.created_at || new Date().toISOString();
  const etat = o.statut ? (type === 'proforma' ? etatProforma(pf) : bl ? null : etatVente(vente)) : null;
  const annulee = vente?.statut === 'annulee';
  const validite = type === 'proforma' ? datePlus(pf.created_at || dateDoc, pf.validite_jours ?? r.validite_proforma) : null;
  const meta = [
    vente?.numero ? `Réf. vente ${esc(formatNumeroVente(vente.numero))}` : '',
    `Date : ${esc(formatDate(dateDoc, 'court'))} · ${esc(formatDate(dateDoc, 'heure'))}`,
    validite ? `<strong>Valable jusqu’au ${esc(formatDate(validite, 'court'))}</strong>` : '',
    p.vendeur ? `Vendeur : ${esc(p.vendeur)}` : ''
  ].filter(Boolean).join('<br>');

  // Blocs client et chantier / livraison.
  const cl = p.client || null;
  const detailClient = o.client_detail && cl ? [cl.telephone ? esc(formatTelephone(cl.telephone)) : '', cl.info ? esc(cl.info) : ''].filter(Boolean).join('<br>') : '';
  const blocClient = `
    <div class="ybd-bloc"><span class="ybd-etiquette">${type === 'proforma' ? 'CLIENT' : 'CLIENT'}</span>
      <span class="ybd-bloc-titre">${esc(cl?.nom || 'Client comptoir')}</span>${detailClient ? `<span class="ybd-bloc-texte">${detailClient}</span>` : ''}</div>`;
  let blocDroite = '';
  let paiementEnBloc = false;
  if (type === 'proforma' && pf.objet) {
    blocDroite = `<div class="ybd-bloc"><span class="ybd-etiquette">OBJET</span><span class="ybd-bloc-titre">${esc(pf.objet)}</span>${pf.note ? `<span class="ybd-bloc-texte">${esc(pf.note)}</span>` : ''}</div>`;
  } else if ((o.chantier || bl) && p.chantier) {
    blocDroite = `<div class="ybd-bloc"><span class="ybd-etiquette">${bl ? 'LIVRAISON / CHANTIER' : 'CHANTIER'}</span>
      <span class="ybd-bloc-titre">${esc(p.chantier.nom || '')}${p.chantier.numero ? ` — ${esc(p.chantier.numero)}` : ''}</span>
      <span class="ybd-bloc-texte">${[p.chantier.adresse ? esc(p.chantier.adresse) : '', p.recuperePar ? `Récupéré par : ${esc(p.recuperePar)}` : ''].filter(Boolean).join('<br>')}</span></div>`;
  } else if ((o.chantier || bl) && p.livraison) {
    const lv = p.livraison;
    blocDroite = `<div class="ybd-bloc"><span class="ybd-etiquette">${lv.zone || lv.adresse ? 'LIVRAISON' : 'RETRAIT EN BOUTIQUE'}</span>
      <span class="ybd-bloc-titre">${esc(lv.zone || (lv.adresse ? 'Livraison' : 'Retrait'))}${lv.commande ? ` · Commande ${esc(lv.commande)}` : ''}</span>
      ${lv.adresse ? `<span class="ybd-bloc-texte">${esc(lv.adresse)}</span>` : ''}</div>`;
  } else if (!bl && o.paiement && vente && modele === 'moderne') {
    const pa = textePaiement(vente, p.chantier);
    paiementEnBloc = true;
    blocDroite = `<div class="ybd-bloc"><span class="ybd-etiquette">PAIEMENT</span><span class="ybd-bloc-titre">${esc(pa.titre)}</span>${p.vendeur ? `<span class="ybd-bloc-texte">Vendeur : ${esc(p.vendeur)}</span>` : ''}</div>`;
  }

  // Tableau des articles.
  const qte = (l) => esc(formatNombre(l.quantite, 3));
  let tete;
  let corps;
  if (bl) {
    tete = `<th class="ybd-n">N°</th><th>Désignation</th><th>Unité</th><th class="ybd-d">Qté commandée</th><th class="ybd-d">Qté livrée</th>${avecPrix ? '<th class="ybd-d">Montant (GNF)</th>' : ''}`;
    corps = lignes.map((l, i) => `<tr><td class="ybd-n">${i + 1}</td><td class="ybd-des">${esc(l.nom)}</td><td>${esc(l.unite)}</td><td class="ybd-d">${qte(l)}</td><td class="ybd-d ybd-a-remplir"></td>${avecPrix ? `<td class="ybd-d ybd-g">${nb(l.total)}</td>` : ''}</tr>`).join('');
  } else if (modele === 'moderne') {
    tete = `<th>Article</th><th class="ybd-d">Qté</th>${pu ? '<th class="ybd-d">Prix</th>' : ''}<th class="ybd-d">Montant</th>`;
    corps = lignes.map((l) => `<tr><td class="ybd-des">${esc(l.nom)}</td><td class="ybd-d">${pu ? qte(l) : esc(formatQuantite(l.quantite, l.unite))}</td>${pu ? `<td class="ybd-d">${nb(l.prix)}</td>` : ''}<td class="ybd-d ybd-g">${nb(l.total)}</td></tr>`).join('');
  } else {
    tete = `<th class="ybd-n">N°</th><th>Désignation</th><th class="ybd-d">Qté</th>${pu ? '<th>Unité</th><th class="ybd-d">P.U. (GNF)</th>' : ''}<th class="ybd-d">Montant (GNF)</th>`;
    corps = lignes.map((l, i) => `<tr><td class="ybd-n">${i + 1}</td><td class="ybd-des">${esc(l.nom)}</td><td class="ybd-d">${pu ? qte(l) : esc(formatQuantite(l.quantite, l.unite))}</td>${pu ? `<td>${esc(l.unite)}</td><td class="ybd-d">${nb(l.prix)}</td>` : ''}<td class="ybd-d ybd-g">${nb(l.total)}</td></tr>`).join('');
  }
  const tableau = `<table class="ybd-table"><thead><tr>${tete}</tr></thead><tbody>${corps || `<tr><td colspan="6" class="ybd-vide">Aucun article</td></tr>`}</tbody></table>`;

  // Totaux.
  const lignesTotaux = [];
  if (!bl || avecPrix) {
    if (remise || livraison || o.tva) lignesTotaux.push(['Sous-total', nb(sousTotal)]);
    if (remise) lignesTotaux.push(['Remise', `− ${nb(remise)}`]);
    if (livraison) lignesTotaux.push(['Frais de livraison', nb(livraison)]);
    if (o.tva && taux > 0) { lignesTotaux.push(['Total HT', nb(ht)]); lignesTotaux.push([`TVA ${formatNombre(taux, 2)} %`, nb(total - ht)]); }
  }
  const libelleTotal = o.tva && taux > 0 ? 'TOTAL TTC (GNF)' : 'TOTAL (GNF)';
  const phraseLettres = { facture: 'Arrêtée la présente facture à la somme de', recu: 'Arrêté le présent reçu à la somme de', proforma: 'Arrêtée la présente facture proforma à la somme de' }[type];
  const lettres = o.lettres && !bl && phraseLettres ? `<div class="ybd-lettres"><strong>${phraseLettres} :</strong><br><em>${esc(montantEnLettres(total))}</em></div>` : '';
  const pa = o.paiement && !bl && type !== 'proforma' ? textePaiement(vente, p.chantier) : null;
  const solde = pa && cl && Number(cl.solde_credit) > 0 ? `<br><strong>Solde du client à ce jour :</strong> ${nb(cl.solde_credit)} GNF` : '';
  const paiement = pa && !paiementEnBloc ? `<div class="ybd-paiement"><strong>Paiement :</strong> ${esc(pa.titre)}${solde}</div>`
    : pa && solde ? `<div class="ybd-paiement">${solde.slice(4)}</div>` : '';

  let blocTotaux = '';
  if (!bl || avecPrix) {
    if (modele === 'moderne') {
      const libelle = type === 'proforma' ? 'MONTANT DU DEVIS' : annulee ? 'TOTAL (ANNULÉ)' : vente?.mode_paiement === 'credit' ? 'TOTAL À PAYER' : vente?.mode_paiement === 'chantier' ? 'TOTAL' : 'TOTAL PAYÉ';
      blocTotaux = `<div class="ybd-boite-total">${lignesTotaux.length ? `<span class="ybd-total-detail">${lignesTotaux.map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</span>` : ''}
        <span class="ybd-total-libelle">${libelle}${o.tva && taux > 0 ? ' TTC' : ''}</span><span class="ybd-total-montant">${nb(total)} <small>GNF</small></span></div>`;
    } else {
      blocTotaux = `<table class="ybd-totaux">${lignesTotaux.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}
        <tr class="ybd-total"><td>${libelleTotal}</td><td>${nb(total)}</td></tr></table>`;
    }
  }

  // Cachet, signatures, QR, coupon.
  const images = `${p.signatureUrl ? `<img class="ybd-signature" src="${esc(p.signatureUrl)}" alt="">` : ''}${p.cachetUrl ? `<img class="ybd-cachet" src="${esc(p.cachetUrl)}" alt="">` : ''}`;
  let signatures = '';
  if (bl) {
    signatures = `<div class="ybd-signatures"><div class="ybd-sig">Cachet &amp; signature de la boutique${images}</div>
      <div class="ybd-sig ybd-recu-par">Reçu par : <span class="ybd-pointilles"></span><br>Date : <span class="ybd-pointilles"></span><br>Signature :</div></div>`;
  } else if (o.signatures) {
    signatures = `<div class="ybd-signatures"><div class="ybd-sig">Cachet &amp; signature de la boutique${images}</div>
      <div class="ybd-sig">${type === 'proforma' ? 'Bon pour accord — signature du client' : 'Signature du client'}<br><small>(précédée de « Lu et approuvé »)</small></div></div>`;
  }
  const code = p.document?.code;
  const qr = o.qr && code ? `<div class="ybd-qr">${svgQr(lienVerification(code), { couleur: sobre ? '#111111' : modele === 'moderne' ? fonce : '#1A1D21', titre: 'QR code de vérification' })}<span>Scannez pour vérifier<br>ce document<br><strong class="ybd-code">${esc(code)}</strong></span></div>`
    : o.qr && (p.essai || p.apercu) ? '<div class="ybd-qr ybd-qr-essai"><span class="ybd-qr-vide">QR</span><span>Scannez pour vérifier<br>ce document</span></div>' : '';
  const coupon = o.coupon && r.coupon_texte && !bl ? `<div class="ybd-coupon">${esc(r.coupon_texte).replace(/\n/g, '<br>')}</div>` : '';

  const pied = `<footer class="ybd-pied">
      ${r.conditions ? `<span><strong>Conditions :</strong> ${esc(r.conditions).replace(/\n/g, ' ')}</span>` : ''}
      <span class="ybd-pied-bas"><span>${r.paiement_mobile ? esc(r.paiement_mobile) : ''}</span><span class="ybd-logiciel"><img src="${esc(urlLogo('youmma-business-symbole.png'))}" alt="">Logiciel YOUMMA Business</span></span>
    </footer>`;

  const titre = TITRES_DOCUMENTS[type];
  const badge = etat ? `<span class="ybd-badge ybd-badge-${etat.code}">${etat.texte}</span>` : '';
  const filigrane = annulee ? '<div class="ybd-filigrane ybd-filigrane-rouge">ANNULÉE</div>' : p.essai ? '<div class="ybd-filigrane">EXEMPLE</div>' : '';
  const coordonnees = [lieu ? esc(lieu) : '', tels ? `Tél. ${esc(tels)}` : '', legal ? esc(legal) : '', r.email ? esc(r.email) : ''].filter(Boolean).join('<br>');

  const entete = modele === 'moderne' ? `
    <header class="ybd-entete">
      <div class="ybd-cercle"></div>
      <div class="ybd-identite">${logo}<div class="ybd-id-textes"><span class="ybd-nom">${esc(nom)}</span>${ligneSi(r.slogan ? esc(r.slogan) : '')}<span class="ybd-coord">${coordonnees}</span></div></div>
      <div class="ybd-entete-droite"><span class="ybd-pastille-titre">${titre}</span><span class="ybd-numero">${numero ? esc(numero) : ''}</span>${badge}<span class="ybd-meta">${meta}</span></div>
    </header>` : `
    <header class="ybd-entete">
      <div class="ybd-identite">${logo}<div class="ybd-id-textes"><span class="ybd-nom">${esc(nom)}</span>${r.slogan ? `<span class="ybd-slogan">${esc(r.slogan)}</span>` : ''}<span class="ybd-coord">${coordonnees}</span></div></div>
      <div class="ybd-entete-droite"><span class="ybd-titre">${titre}</span>${numero ? `<span class="ybd-numero">N° ${esc(numero)}</span>` : ''}${badge}<span class="ybd-meta">${meta}</span></div>
    </header>`;

  const blocs = blocDroite || (!bl && cl) || modele !== 'moderne' ? `<div class="ybd-blocs">${blocClient}${blocDroite}</div>` : '';
  const sousTableau = modele === 'moderne'
    ? `<div class="ybd-sous"><div class="ybd-sous-gauche">${lettres}${paiement}</div>${blocTotaux}</div>
       ${coupon || qr ? `<div class="ybd-coupon-qr">${coupon || '<span></span>'}${qr}</div>` : ''}`
    : `<div class="ybd-sous"><div class="ybd-sous-gauche">${lettres}${paiement}${coupon}</div>${blocTotaux}</div>`;
  const fin = modele === 'moderne'
    ? `<div class="ybd-fin">${signatures}</div>`
    : `<div class="ybd-fin"><div class="ybd-fin-gauche">${signatures}</div>${qr}</div>`;

  return `<style>${CSS_DOCUMENT}</style>
  <article class="ybd ybd-${modele} ybd-type-${type}" style="${style}" lang="fr">
    ${filigrane}
    ${entete}
    <div class="ybd-contenu">
      ${blocs}
      ${tableau}
      <div class="ybd-garder">${sousTableau}</div>
    </div>
    ${fin}
    ${pied}
  </article>`;
}

/* ------------------------------------------------------------ Feuille de style (préfixe .ybd) */

export const CSS_DOCUMENT = `
.ybd{--gris:#4B5563;--gris-clair:#6B7280;--filet:#E5E7EB;--fond-doux:#F5F7F4;position:relative;box-sizing:border-box;width:794px;min-height:1123px;background:#FFFFFF;color:#1A1D21;
  font-family:'Manrope',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:12px;line-height:1.45;display:flex;flex-direction:column;overflow:hidden;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;text-align:left}
.ybd *,.ybd *::before,.ybd *::after{box-sizing:border-box}
.ybd p{margin:0}
.ybd-filigrane{position:absolute;left:0;right:0;top:38%;text-align:center;font-size:120px;font-weight:800;letter-spacing:.08em;color:rgba(85,102,95,.13);transform:rotate(-24deg);pointer-events:none;z-index:2}
.ybd-filigrane-rouge{color:rgba(165,28,28,.16)}
.ybd-entete{display:flex;justify-content:space-between;gap:20px}
.ybd-identite{display:flex;gap:14px;align-items:flex-start;min-width:0}
.ybd-id-textes{display:flex;flex-direction:column;gap:2px;min-width:0}
.ybd-logo{width:64px;height:64px;flex:none;border-radius:14px;object-fit:contain;background:#FFFFFF}
.ybd-initiales{display:flex;align-items:center;justify-content:center;background:var(--c);color:var(--c-texte);font-weight:800;font-size:22px}
.ybd-nom{font-size:22px;font-weight:800;letter-spacing:-.01em;overflow-wrap:anywhere}
.ybd-slogan{font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.ybd-coord{font-size:11px;color:var(--gris);line-height:1.55;margin-top:4px}
.ybd-entete-droite{display:flex;flex-direction:column;align-items:flex-end;gap:6px;text-align:right;flex:none;max-width:46%}
.ybd-titre{font-size:24px;font-weight:800;letter-spacing:.08em}
.ybd-type-proforma .ybd-titre,.ybd-type-bon_livraison .ybd-titre{font-size:21px}
.ybd-numero{font-size:12px;font-weight:700}
.ybd-meta{font-size:11px;color:var(--gris)}
.ybd-badge{font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:999px;letter-spacing:.03em}
.ybd-badge-paye{background:#E3F4E6;color:#1B6E2A}
.ybd-badge-credit{background:#FEF3C7;color:#7A4A00}
.ybd-badge-chantier{background:#E8EDEA;color:#2F453D}
.ybd-badge-annulee{background:#FDE4E4;color:#A51C1C}
.ybd-contenu{display:flex;flex-direction:column;gap:18px}
.ybd-blocs{display:flex;gap:16px}
.ybd-bloc{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;border-radius:10px;padding:12px 14px}
.ybd-etiquette{font-size:10px;font-weight:800;letter-spacing:.1em}
.ybd-bloc-titre{font-size:14px;font-weight:800;overflow-wrap:anywhere}
.ybd-bloc-texte{font-size:11px;color:var(--gris);line-height:1.5}
.ybd-table{width:100%;border-collapse:collapse;font-size:12px}
.ybd-table thead{display:table-header-group}
.ybd-table tr{break-inside:avoid;page-break-inside:avoid}
.ybd-table th{text-align:left;font-weight:800;padding:9px 10px}
.ybd-table td{padding:8px 10px;vertical-align:top}
.ybd-table .ybd-d{text-align:right;white-space:nowrap}
.ybd-table .ybd-n{width:28px;color:var(--gris-clair)}
.ybd-table th.ybd-n{color:inherit}
.ybd-des{font-weight:600;overflow-wrap:anywhere}
.ybd-g{font-weight:700}
.ybd-vide{text-align:center;color:var(--gris-clair)}
.ybd-a-remplir{min-width:90px;border-bottom:1px dotted #9CA3AF}
.ybd-garder{break-inside:avoid;page-break-inside:avoid}
.ybd-sous{display:flex;gap:18px;align-items:flex-start}
.ybd-sous-gauche{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}
.ybd-lettres{padding:10px 12px;font-size:11.5px;line-height:1.5}
.ybd-paiement{font-size:11px;color:var(--gris);line-height:1.55}
.ybd-paiement strong{color:#1A1D21}
.ybd-totaux{width:270px;border-collapse:collapse;font-size:12px;flex:none}
.ybd-totaux td{padding:6px 10px}
.ybd-totaux td:first-child{color:var(--gris)}
.ybd-totaux td:last-child{text-align:right;font-weight:700;white-space:nowrap}
.ybd-totaux .ybd-total td{padding:10px;font-weight:800;color:inherit}
.ybd-totaux .ybd-total td:last-child{font-size:16px}
.ybd-coupon{border:1.5px dashed var(--a);border-radius:12px;padding:12px 14px;font-size:12px;line-height:1.5;background:var(--a-doux)}
.ybd-fin{display:flex;gap:18px;align-items:flex-end;margin-top:auto;padding-top:18px;break-inside:avoid;page-break-inside:avoid}
.ybd-fin-gauche{flex:1}
.ybd-signatures{display:flex;gap:30px;flex:1}
.ybd-sig{flex:1;height:96px;border:1px dashed #9CA3AF;border-radius:8px;padding:8px 10px;font-size:10.5px;color:var(--gris);position:relative;overflow:hidden}
.ybd-sig small{font-size:9.5px}
.ybd-recu-par{line-height:2}
.ybd-pointilles{display:inline-block;width:150px;border-bottom:1px dotted #9CA3AF}
.ybd-cachet{position:absolute;right:10px;bottom:4px;max-width:120px;max-height:78px;object-fit:contain}
.ybd-signature{position:absolute;left:14px;bottom:8px;max-width:130px;max-height:52px;object-fit:contain}
.ybd-qr{display:flex;flex-direction:column;align-items:center;gap:4px;flex:none}
.ybd-qr svg{width:84px;height:84px;display:block}
.ybd-qr span{font-size:8.5px;color:var(--gris-clair);text-align:center}
.ybd-qr .ybd-code{font-size:9.5px;color:#1A1D21;letter-spacing:.08em}
.ybd-qr .ybd-qr-vide{width:84px;height:84px;display:flex;align-items:center;justify-content:center;border:1px dashed #9CA3AF;font-size:14px;font-weight:800;color:#9CA3AF}
.ybd-pied{border-top:1px solid var(--filet);margin-top:16px;padding-top:10px;display:flex;flex-direction:column;gap:4px;font-size:10px;color:var(--gris-clair);line-height:1.5}
.ybd-pied strong{color:#1A1D21}
.ybd-pied-bas{display:flex;justify-content:space-between;gap:12px}
.ybd-logiciel{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.ybd-logiciel img{width:14px;height:14px;object-fit:contain}

/* Classique */
.ybd-classique{padding:46px 52px 34px;gap:18px}
.ybd-classique .ybd-entete{padding-bottom:16px;border-bottom:3px solid var(--c)}
.ybd-classique .ybd-nom{color:var(--c-encre)}
.ybd-classique .ybd-slogan{color:var(--a-encre)}
.ybd-classique .ybd-bloc{border:1px solid var(--filet)}
.ybd-classique .ybd-etiquette{color:var(--c-encre)}
.ybd-classique .ybd-table thead tr{background:var(--c);color:var(--c-texte)}
.ybd-classique .ybd-table tbody tr:nth-child(even){background:#F5F7FA}
.ybd-classique .ybd-lettres{background:#F8FAFC;border-left:4px solid var(--c)}
.ybd-classique .ybd-total{background:var(--c);color:var(--c-texte)}

/* Moderne */
.ybd-moderne{color:#10231D}
.ybd-moderne .ybd-entete{background:linear-gradient(120deg,var(--c-fonce) 0%,var(--c) 100%);color:var(--entete-texte);padding:34px 48px 28px;align-items:center;position:relative;overflow:hidden}
.ybd-moderne .ybd-cercle{position:absolute;right:-60px;top:-80px;width:260px;height:260px;border-radius:50%;border:28px solid var(--a);opacity:.25}
.ybd-moderne .ybd-identite{align-items:center;position:relative}
.ybd-moderne .ybd-logo{width:58px;height:58px;border-radius:50%}
.ybd-moderne .ybd-initiales{background:#FFFFFF;color:var(--c-fonce);font-size:20px}
.ybd-moderne .ybd-nom{font-size:24px}
.ybd-moderne .ybd-id-textes>span:not(.ybd-nom),.ybd-moderne .ybd-coord,.ybd-moderne .ybd-meta{color:inherit;opacity:.85;font-size:11.5px;margin-top:0}
.ybd-moderne .ybd-entete-droite{position:relative;gap:4px}
.ybd-moderne .ybd-pastille-titre{padding:5px 12px;border-radius:999px;background:var(--a);color:var(--a-texte);font-size:12px;font-weight:800;letter-spacing:.08em}
.ybd-moderne .ybd-numero{font-size:20px;font-weight:800}
.ybd-moderne .ybd-contenu{padding:26px 48px 0}
.ybd-moderne .ybd-blocs{gap:14px}
.ybd-moderne .ybd-bloc{background:var(--fond-doux);border-radius:12px;gap:2px}
.ybd-moderne .ybd-etiquette{color:var(--c-encre)}
.ybd-moderne .ybd-bloc-texte{color:#55665F}
.ybd-moderne .ybd-table{border-collapse:separate;border-spacing:0 6px;font-size:12.5px}
.ybd-moderne .ybd-table th{color:#55665F;font-size:11px;padding:0 12px}
.ybd-moderne .ybd-table td{background:var(--fond-doux);padding:10px 12px}
.ybd-moderne .ybd-table td:first-child{border-radius:10px 0 0 10px;font-weight:700}
.ybd-moderne .ybd-table td:last-child{border-radius:0 10px 10px 0;font-weight:800}
.ybd-moderne .ybd-sous{align-items:center}
.ybd-moderne .ybd-lettres{padding:0;font-size:11.5px;color:#55665F}
.ybd-moderne .ybd-lettres em{font-style:normal;font-weight:700;color:#10231D}
.ybd-boite-total{background:var(--c-fonce);color:var(--fonce-texte);border-radius:14px;padding:14px 20px;display:flex;flex-direction:column;align-items:flex-end;min-width:240px;flex:none}
.ybd-total-detail{font-size:11px;opacity:.8}
.ybd-total-libelle{font-size:12px;font-weight:700;margin-top:4px}
.ybd-total-montant{font-size:28px;font-weight:800;color:var(--total-montant);line-height:1.1;white-space:nowrap}
.ybd-total-montant small{font-size:13px;color:var(--fonce-texte)}
.ybd-coupon-qr{display:flex;gap:14px;align-items:stretch}
.ybd-coupon-qr>.ybd-coupon,.ybd-coupon-qr>span{flex:1}
.ybd-moderne .ybd-qr{border-radius:12px;background:var(--fond-doux);padding:10px 12px;justify-content:center}
.ybd-moderne .ybd-qr svg{width:76px;height:76px}
.ybd-moderne .ybd-fin{padding:18px 48px 0}
.ybd-moderne .ybd-sig{border:none;border-top:2px solid #10231D;border-radius:0;height:80px;padding:6px 0 0;color:#55665F}
.ybd-moderne .ybd-pied{margin-top:20px;background:var(--fond-doux);border-top:none;padding:14px 48px 22px;color:#55665F}

/* Sobre : noir et blanc, filets fins, aucun aplat (économie d'encre) */
.ybd-sobre{padding:46px 52px 34px;gap:18px;color:#111111}
.ybd-sobre .ybd-entete{padding-bottom:14px;border-bottom:2px solid #111111}
.ybd-sobre .ybd-logo{filter:grayscale(1)}
.ybd-sobre .ybd-initiales{background:#FFFFFF;color:#111111;border:1.5px solid #111111}
.ybd-sobre .ybd-slogan{color:#444444}
.ybd-sobre .ybd-coord,.ybd-sobre .ybd-meta,.ybd-sobre .ybd-bloc-texte{color:#444444}
.ybd-sobre .ybd-badge{background:#FFFFFF;color:#111111;border:1px solid #111111}
.ybd-sobre .ybd-bloc{border:1px solid #BBBBBB;border-radius:6px}
.ybd-sobre .ybd-etiquette{color:#111111}
.ybd-sobre .ybd-table th{border-top:1.5px solid #111111;border-bottom:1.5px solid #111111}
.ybd-sobre .ybd-table td{border-bottom:.5px solid #CCCCCC}
.ybd-sobre .ybd-lettres{border-left:2px solid #111111}
.ybd-sobre .ybd-total td{border-top:2px solid #111111;border-bottom:2px solid #111111}
.ybd-sobre .ybd-coupon{border-color:#111111;background:#FFFFFF}
.ybd-sobre .ybd-cachet,.ybd-sobre .ybd-signature{filter:grayscale(1)}
.ybd-sobre .ybd-logiciel img{filter:grayscale(1)}

@media print{
  /* À l'impression : mise en page en blocs (Chrome découpe mal les conteneurs flex sur plusieurs pages). */
  .ybd{display:block;width:auto;min-height:0;box-shadow:none!important;overflow:visible}
  .ybd>*+*{margin-top:16px}
  .ybd-contenu{display:block}
  .ybd-contenu>*+*{margin-top:16px}
  .ybd-fin{margin-top:22px}
  .ybd-pied{break-before:avoid;page-break-before:avoid;break-inside:avoid}
  .ybd-moderne>*+*{margin-top:0}
  .ybd-classique,.ybd-sobre{padding:0}
  .ybd-moderne .ybd-entete{padding:24px 28px 20px}
  .ybd-moderne .ybd-contenu{padding:20px 0 0}
  .ybd-moderne .ybd-fin{padding:18px 0 0}
  .ybd-moderne .ybd-pied{padding:12px 16px 14px}
  .ybd-filigrane{position:fixed;top:40%}
}
`;
