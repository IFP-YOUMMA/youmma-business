/**
 * marche/recu.js — Le reçu du versement d'une commande du marché (étape 21, maquette MarcheRecu), format A5.
 *
 * Imprimé comme les autres reçus (zone #recu, window.print), sur sa propre page nommée A5 (css/marche.css).
 * En-tête de l'entreprise, les lignes, le montant versé en toutes lettres, le taux appliqué, le transport estimé,
 * le cadre « Reste à payer au retrait », la signature du bureau et le QR du lien de suivi.
 * La commission n'y figure jamais : ce reçu est remis au client.
 */
import { esc, formatNombre, formatDate, formatTelephone, imagesPretes } from '../utils.js';
import { libelleMode } from '../modes-paiement.js';
import { montantEnLettres } from '../documents/lettres.js';
import { svgQr } from '../qr.js';
import { montant, nomDevise, lienSuivi } from './commun.js';

export function htmlRecuMarche(c, { jeton = null, recuPar = '' } = {}) {
  const e = c.entreprise || {};
  const lien = c.lien_suivi || c.lien || lienSuivi(jeton);
  const fournisseurs = [...new Set((c.lignes || []).map((l) => l.fournisseur).filter(Boolean))];
  const transport = c.colis?.du_montant !== undefined && c.colis?.du_montant !== null
    ? { texte: montant(c.colis.du_montant, c.colis.du_devise), exact: true }
    : { texte: montant(c.transport_estime, c.devise_transport || c.devise_achat), exact: false };
  return `
    <div class="rm-page">
      <header class="rm-tete">
        <div><strong class="rm-entreprise">${esc(e.nom || '')}</strong>
          <span>${esc([c.retrait?.nom, c.retrait?.adresse].filter(Boolean).join(' · '))}</span>
          ${e.telephone ? `<span>Tél : ${esc(formatTelephone(e.telephone))}</span>` : ''}</div>
        <div class="rm-titre"><span>Reçu de versement</span><strong>${esc(c.code)}</strong><span>${esc(formatDate(c.verse_le || new Date().toISOString(), 'long'))} · ${esc(formatDate(c.verse_le || new Date().toISOString(), 'heure'))}</span></div>
      </header>
      <div class="rm-parties">
        <div><span class="rm-etiq">Reçu de</span><strong>${esc(c.client?.nom || '')}</strong>${c.client?.tel ? `<span>${esc(formatTelephone(c.client.tel))}</span>` : ''}<span>Retrait : ${esc(c.retrait?.nom || '')}</span></div>
        <div><span class="rm-etiq">Achat auprès de</span><strong>${esc(fournisseurs.join(' · '))}</strong><span>Commande du ${esc(formatDate(c.created_at, 'court'))}</span></div>
      </div>
      <table class="rm-lignes">
        <thead><tr><th>Article</th><th>Qté</th><th>Prix</th></tr></thead>
        <tbody>${(c.lignes || []).map((l) => `<tr><td><strong>${esc(l.nom)}</strong><span>${esc(l.fournisseur || '')}</span></td><td>${esc(formatNombre(l.quantite, 2))}</td><td>${esc(montant(l.montant, c.devise_achat))}</td></tr>`).join('')}</tbody>
      </table>
      <div class="rm-verse">
        <span class="rm-etiq">Versé ce jour${c.verse_mode ? ` — ${esc(libelleMode(c.verse_mode))}` : ''}</span>
        <strong>${esc(montant(c.montant_client, c.devise_client))}</strong>
        ${c.devise_client === 'GNF' ? `<span class="rm-lettres">${esc(montantEnLettres(c.montant_client))}</span>` : ''}
      </div>
      <div class="rm-reste">
        <strong>Reste à payer au retrait : le transport seul</strong>
        <span>${transport.exact ? `Transport après pesée : ${esc(transport.texte)}.` : `Estimé à ${esc(transport.texte)}${c.poids_estime ? ` pour ${esc(formatNombre(c.poids_estime, 2))} kg` : ''}. Le montant exact est calculé après la pesée.`}</span>
      </div>
      <div class="rm-totaux">
        <div><span>Marchandise</span><span>${esc(montant(c.montant_client, c.devise_client))}</span></div>
        ${c.taux ? `<div><span>Taux appliqué</span><span>1 ${esc(nomDevise(c.devise_achat))} = ${esc(formatNombre(c.taux, 2))} ${esc(nomDevise(c.devise_client))}</span></div>` : ''}
        <div><span>Transport ${transport.exact ? '' : '(estimé)'}</span><span>${esc(transport.texte)}</span></div>
      </div>
      <div class="rm-bas">
        <div class="rm-signature"><span class="rm-etiq">Signature du bureau</span>${recuPar ? `<span>Reçu par : ${esc(recuPar)}</span>` : ''}</div>
        ${lien ? `<div class="rm-qr">${svgQr(lien, { couleur: '#000000', titre: 'Suivi de la commande' })}<span>Suivi : ${esc(lien.replace(/^https?:\/\//, ''))}</span></div>` : ''}
      </div>
      <p class="rm-mention">Gardez ce reçu. Il est exigé au retrait, avec une pièce d’identité.</p>
    </div>`;
}

/** Imprime le reçu A5 dans la zone #recu de l'appli, puis rend la page à son état normal. */
export async function imprimerRecuMarche(c, options = {}) {
  const zone = document.getElementById('recu');
  if (!zone) return;
  zone.innerHTML = htmlRecuMarche(c, options);
  zone.classList.add('recu-marche');
  document.body.classList.add('impression-recu-marche');
  const retirer = () => { document.body.classList.remove('impression-recu-marche'); zone.classList.remove('recu-marche'); window.removeEventListener('afterprint', retirer); };
  window.addEventListener('afterprint', retirer);
  await imagesPretes(zone);
  window.print();
}
