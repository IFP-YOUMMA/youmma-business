/**
 * recu.js — Gabarits des reçus 80 mm (vente et remboursement), imprimés via window.print()
 * et la feuille @media print de css/app.css. Utilisé par la caisse, l'historique des ventes
 * et la fiche client.
 */
import { etat } from './state.js';
import {
  esc, formatNombre, formatGNF, formatQuantite, formatDate, formatTelephone, formatNumeroVente, MODES_PAIEMENT
} from './utils.js';

/** En-tête commun : nom, adresse et téléphone de la boutique active. */
function enteteBoutique() {
  const b = etat.boutique;
  return `
    <div class="recu-entete">
      <strong class="recu-boutique">${esc(b.nom)}</strong>
      ${b.ville ? `<span>${esc([b.commune, b.ville].filter(Boolean).join(', '))}</span>` : ''}
      ${b.telephone ? `<span>Tél : ${esc(formatTelephone(b.telephone))}</span>` : ''}
    </div>
    <div class="recu-sep"></div>`;
}

const ligne = (libelle, valeur, classe = '') =>
  `<div class="recu-ligne ${classe}"><span>${esc(libelle)}</span><span>${esc(valeur)}</span></div>`;

/** Pied du reçu : message personnalisé de la boutique (Paramètres), sinon le remerciement par défaut. */
function pied() {
  const message = String(etat.boutique.message_recu || '').trim() || 'Merci de votre confiance !';
  return `
    <div class="recu-sep"></div>
    <p class="recu-merci">${esc(message)}</p>
    <p class="recu-pied">Propulsé par YOUMMA Business</p>`;
}

function imprimer(html) {
  document.getElementById('recu').innerHTML = html;
  window.print();
}

/**
 * Reçu de vente.
 * recu : { numero, date, vendeur, client (nom ou null), lignes [{nom_produit, unite, quantite, prix_unitaire, total}],
 *          sousTotal, remise, total, mode, montantRecu (ou null), monnaie, echeance }
 * mentions : textes affichés en haut, ex. ['DUPLICATA', 'ANNULÉE'].
 */
export function imprimerRecuVente(recu, { mentions = [] } = {}) {
  imprimer(`
    ${enteteBoutique()}
    ${mentions.map((m) => `<p class="recu-titre">${esc(m)}</p>`).join('')}
    ${ligne('Vente', formatNumeroVente(recu.numero))}
    ${ligne('Date', formatDate(recu.date, 'complet'))}
    ${ligne('Vendeur', recu.vendeur || '—')}
    ${ligne('Client', recu.client || 'Client comptoir')}
    <div class="recu-sep"></div>
    ${recu.lignes.map((l) => `
      <div class="recu-article">
        <span class="recu-article-nom">${esc(l.nom_produit)}</span>
        <div class="recu-ligne"><span>${esc(formatQuantite(l.quantite, l.unite))} × ${formatNombre(l.prix_unitaire)}</span><span>${formatNombre(l.total)}</span></div>
      </div>`).join('')}
    <div class="recu-sep"></div>
    ${ligne('Sous-total', formatGNF(recu.sousTotal))}
    ${recu.remise ? ligne('Remise', `− ${formatGNF(recu.remise)}`) : ''}
    ${ligne('TOTAL', formatGNF(recu.total), 'recu-total')}
    ${ligne('Paiement', MODES_PAIEMENT[recu.mode]?.libelle || recu.mode)}
    ${recu.montantRecu !== null && recu.montantRecu !== undefined
      ? ligne('Reçu', formatGNF(recu.montantRecu)) + ligne('Monnaie rendue', formatGNF(Math.max(0, recu.monnaie || 0)))
      : ''}
    ${recu.echeance ? ligne('Échéance', formatDate(recu.echeance, 'court')) : ''}
    ${pied()}`);
}

/**
 * Reçu de remboursement d'un crédit.
 * recu : { date, client, montant, mode, ancienSolde, nouveauSolde, encaissePar }
 */
export function imprimerRecuRemboursement(recu) {
  imprimer(`
    ${enteteBoutique()}
    <p class="recu-titre">REÇU DE REMBOURSEMENT</p>
    ${ligne('Date', formatDate(recu.date, 'complet'))}
    ${ligne('Client', recu.client)}
    <div class="recu-sep"></div>
    ${ligne('Montant reçu', formatGNF(recu.montant), 'recu-total')}
    ${ligne('Mode', MODES_PAIEMENT[recu.mode].libelle)}
    ${ligne('Ancien solde', formatGNF(recu.ancienSolde))}
    ${ligne('Nouveau solde', formatGNF(recu.nouveauSolde))}
    ${ligne('Encaissé par', recu.encaissePar)}
    ${pied()}`);
}
