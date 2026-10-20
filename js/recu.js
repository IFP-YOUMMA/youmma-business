/**
 * recu.js — Gabarits des reçus 80 mm (vente, remboursement, bon d'enlèvement et versement chantier),
 * imprimés via window.print() et la feuille @media print de css/app.css.
 * Utilisé par la caisse, l'historique des ventes, la fiche client et les comptes chantier.
 * L'en-tête et le pied suivent les réglages des documents (nom affiché, slogan, téléphones, RCCM/NIF,
 * conditions) ; le QR de vérification n'apparaît que si un document A4 a déjà été émis pour la vente.
 */
import { sb } from './supabase.js';
import { etat } from './state.js';
import {
  esc, formatNombre, formatGNF, formatQuantite, formatDate, formatTelephone, formatNumeroVente, texteSolde, MODES_PAIEMENT, logoSymbole, imagesPretes
} from './utils.js';
import { svgQr } from './qr.js';
import { chargerReglages } from './documents/donnees.js';
import { lienVerification } from './documents/rendu.js';

/** Réglages des documents (en cache) ; en cas d'échec, le ticket garde sa présentation simple. */
async function reglagesTicket() {
  try { return await chargerReglages(etat.boutique.id); } catch { return {}; }
}

/** En-tête commun : nom affiché, slogan, adresse, téléphones, RCCM/NIF de la boutique active. */
function enteteBoutique(r = {}) {
  const b = etat.boutique;
  const lieu = [r.adresse, [b.commune, b.ville].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const tels = r.telephones || (b.telephone ? formatTelephone(b.telephone) : '');
  const legal = [r.rccm ? `RCCM ${r.rccm}` : '', r.nif ? `NIF ${r.nif}` : ''].filter(Boolean).join(' · ');
  const logo = b.logo_url && r.logo_usages?.ticket !== false
    ? `<img class="recu-logo" src="${esc(b.logo_url)}" alt="" width="64" height="64" decoding="async">` : '';
  return `
    <div class="recu-logiciel">${logoSymbole(18)}<span>Logiciel YOUMMA Business</span></div>
    <div class="recu-entete">
      ${logo}
      <strong class="recu-boutique">${esc(r.nom_affiche || b.nom)}</strong>
      ${r.slogan ? `<span class="recu-slogan">${esc(r.slogan)}</span>` : ''}
      ${lieu ? `<span>${esc(lieu)}</span>` : ''}
      ${tels ? `<span>Tél : ${esc(tels)}</span>` : ''}
      ${legal ? `<span>${esc(legal)}</span>` : ''}
    </div>
    <div class="recu-sep"></div>`;
}

const ligne = (libelle, valeur, classe = '') =>
  `<div class="recu-ligne ${classe}"><span>${esc(libelle)}</span><span>${esc(valeur)}</span></div>`;

/** Pied du reçu : conditions des documents, sinon message de la boutique, sinon le remerciement par défaut. */
function pied(r = {}, code = null) {
  const message = String(r.conditions || etat.boutique.message_recu || '').trim() || 'Merci de votre confiance !';
  return `
    <div class="recu-sep"></div>
    <p class="recu-merci">${esc(message)}</p>
    ${code ? `<div class="recu-qr">${svgQr(lienVerification(code), { couleur: '#000000', titre: 'QR code de vérification' })}<span>Vérifiez ce document : ${esc(code)}</span></div>` : ''}`;
}

/** Code de vérification d'un document A4 déjà émis pour la vente (sinon null : pas de QR sur le ticket). */
async function codeVerification(r, idVente) {
  if (!idVente || r.options?.qr === false) return null;
  try {
    const { data } = await sb.from('documents_emis').select('code, type').eq('vente_id', idVente).in('type', ['facture', 'recu', 'bon_livraison']).limit(1);
    return data?.[0]?.code || null;
  } catch { return null; }
}

async function imprimer(html) {
  const zone = document.getElementById('recu');
  zone.innerHTML = html;
  await imagesPretes(zone);
  window.print();
}

/**
 * Reçu de vente.
 * recu : { numero, date, vendeur, client (nom ou null), lignes [{nom_produit, unite, quantite, prix_unitaire, total}],
 *          sousTotal, remise, total, mode, montantRecu (ou null), monnaie, echeance,
 *          fraisLivraison (facultatif), commande (n° de commande en ligne, facultatif) }
 * mentions : textes affichés en haut, ex. ['DUPLICATA', 'ANNULÉE'].
 */
export async function imprimerRecuVente(recu, { mentions = [], idVente = null } = {}) {
  const r = await reglagesTicket();
  imprimer(htmlRecuVente(recu, { mentions, reglages: r, code: await codeVerification(r, idVente) }));
}

/** HTML du ticket de vente 80 mm (aussi utilisé par l'aperçu des réglages des documents). */
export function htmlRecuVente(recu, { mentions = [], reglages = {}, code = null } = {}) {
  return (`
    ${enteteBoutique(reglages)}
    ${mentions.map((m) => `<p class="recu-titre">${esc(m)}</p>`).join('')}
    ${ligne('Vente', formatNumeroVente(recu.numero))}
    ${ligne('Date', formatDate(recu.date, 'complet'))}
    ${ligne('Vendeur', recu.vendeur || '—')}
    ${ligne('Client', recu.client || 'Client comptoir')}
    ${recu.commande ? ligne('Commande en ligne', recu.commande) : ''}
    <div class="recu-sep"></div>
    ${recu.lignes.map((l) => `
      <div class="recu-article">
        <span class="recu-article-nom">${esc(l.nom_produit)}</span>
        <div class="recu-ligne"><span>${esc(formatQuantite(l.quantite, l.unite))} × ${formatNombre(l.prix_unitaire)}</span><span>${formatNombre(l.total)}</span></div>
        ${l.base ? `<span class="recu-base">(${esc(l.base)})</span>` : ''}
      </div>`).join('')}
    <div class="recu-sep"></div>
    ${ligne('Sous-total', formatGNF(recu.sousTotal))}
    ${recu.remise ? ligne('Remise', `− ${formatGNF(recu.remise)}`) : ''}
    ${Number(recu.fraisLivraison) ? ligne('Livraison', formatGNF(recu.fraisLivraison)) : ''}
    ${ligne('TOTAL', formatGNF(recu.total), 'recu-total')}
    ${ligne('Paiement', MODES_PAIEMENT[recu.mode]?.libelle || recu.mode)}
    ${recu.montantRecu !== null && recu.montantRecu !== undefined
      ? ligne('Reçu', formatGNF(recu.montantRecu)) + ligne('Monnaie rendue', formatGNF(Math.max(0, recu.monnaie || 0)))
      : ''}
    ${recu.echeance ? ligne('Échéance', formatDate(recu.echeance, 'court')) : ''}
    ${pied(reglages, code)}`);
}

/**
 * Bon d'enlèvement d'un chantier (80 mm), à faire signer.
 * bon : { numero, date, chantier {numero, nom}, client, recuperePar, servi, lignes, total, soldeApres, note }
 */
export async function imprimerBonEnlevement(bon) {
  const r = await reglagesTicket();
  imprimer(`
    ${enteteBoutique(r)}
    <p class="recu-titre">BON D’ENLÈVEMENT</p>
    ${ligne('Chantier', `${bon.chantier.numero || ''} · ${bon.chantier.nom}`)}
    ${ligne('Client', bon.client || '—')}
    ${ligne('Vente', formatNumeroVente(bon.numero))}
    ${ligne('Date', formatDate(bon.date, 'complet'))}
    ${ligne('Récupéré par', bon.recuperePar || '—')}
    ${ligne('Servi par', bon.servi || '—')}
    <div class="recu-sep"></div>
    ${bon.lignes.map((l) => `
      <div class="recu-article">
        <span class="recu-article-nom">${esc(l.nom_produit)}</span>
        <div class="recu-ligne"><span>${esc(formatQuantite(l.quantite, l.unite))} × ${formatNombre(l.prix_unitaire)}</span><span>${formatNombre(l.total)}</span></div>
        ${l.base ? `<span class="recu-base">(${esc(l.base)})</span>` : ''}
      </div>`).join('')}
    <div class="recu-sep"></div>
    ${ligne('TOTAL', formatGNF(bon.total), 'recu-total')}
    ${ligne('Solde après', texteSolde(bon.soldeApres), 'recu-total')}
    ${bon.note ? `<p class="recu-note">${esc(bon.note)}</p>` : ''}
    <div class="recu-signature">Signature de la personne qui récupère :</div>
    ${pied(r)}`);
}

/**
 * Reçu de versement sur un chantier (80 mm).
 * recu : { date, chantier {numero, nom}, client, montant, mode, versePar, ancienSolde, nouveauSolde, encaissePar }
 */
export async function imprimerRecuVersement(recu) {
  const r = await reglagesTicket();
  imprimer(`
    ${enteteBoutique(r)}
    <p class="recu-titre">REÇU DE VERSEMENT</p>
    ${ligne('Chantier', `${recu.chantier.numero || ''} · ${recu.chantier.nom}`)}
    ${ligne('Client', recu.client || '—')}
    ${ligne('Date', formatDate(recu.date, 'complet'))}
    <div class="recu-sep"></div>
    ${ligne('Montant reçu', formatGNF(recu.montant), 'recu-total')}
    ${ligne('Mode', MODES_PAIEMENT[recu.mode].libelle)}
    ${recu.versePar ? ligne('Versé par', recu.versePar) : ''}
    ${ligne('Ancien solde', texteSolde(recu.ancienSolde))}
    ${ligne('Nouveau solde', texteSolde(recu.nouveauSolde))}
    ${ligne('Encaissé par', recu.encaissePar)}
    ${pied(r)}`);
}

/**
 * Reçu de remboursement d'un crédit.
 * recu : { date, client, montant, mode, ancienSolde, nouveauSolde, encaissePar }
 */
export async function imprimerRecuRemboursement(recu) {
  const r = await reglagesTicket();
  imprimer(`
    ${enteteBoutique(r)}
    <p class="recu-titre">REÇU DE REMBOURSEMENT</p>
    ${ligne('Date', formatDate(recu.date, 'complet'))}
    ${ligne('Client', recu.client)}
    <div class="recu-sep"></div>
    ${ligne('Montant reçu', formatGNF(recu.montant), 'recu-total')}
    ${ligne('Mode', MODES_PAIEMENT[recu.mode].libelle)}
    ${ligne('Ancien solde', formatGNF(recu.ancienSolde))}
    ${ligne('Nouveau solde', formatGNF(recu.nouveauSolde))}
    ${ligne('Encaissé par', recu.encaissePar)}
    ${pied(r)}`);
}
