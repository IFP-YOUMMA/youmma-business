/**
 * facturation.js — Étape 24, chez le boutiquier : ce qu'il doit à YOUMMA quand il paie à la commission.
 *  - Paramètres › « Ce que je dois à YOUMMA » : ma_commission(p_boutique) (décompte du mois, impayés, état). En
 *    abonnement, rien de plus que la carte « Licence » existante (formule et date de fin) : pas d'écran vide ;
 *  - un bandeau ambre, un seul, dans la coquille : etat_commission lu une fois par boutique ouverte ;
 *  - la vitrine coupée pour impayé (boutiques_en_ligne.coupee_impaye) : la vraie raison et le bouton « Régler ».
 * Rien ne bloque la caisse, le stock ni les rapports : ces lectures n'ouvrent ni ne ferment aucun écran.
 */
import { sb } from './supabase.js';
import { etat } from './state.js';
import { esc, icone } from './utils.js';
import { chargerModes } from './modes-paiement.js';
import { lienSupport } from './plateforme.js';
import { premiere, lire, lireDecompte, montant, taux, nomMois, bornesMois, dateCourte, sansVente } from './commission-commun.js';

const ALERTES = ['avertie', 'vitrine_coupee', 'blocage_possible'];
export const LIEN_ECRAN = '#/parametres?commission=1';

async function rpc(nom, params) {
  const { data, error } = await sb.rpc(nom, params);
  if (error) throw error;
  return data;
}

/** État de l'escalade, lu une fois par boutique (bandeau, vitrine coupée). */
const etats = new Map();
export function etatCommission(id = etat.boutique?.id) {
  if (!id) return Promise.resolve(null);
  if (!etats.has(id)) etats.set(id, rpc('etat_commission', { p_boutique: id }).then(premiere).catch(() => null));
  return etats.get(id);
}

/* ------------------------------------------------------------ Le bandeau (un seul, dans la coquille) */

export async function poserBandeauCommission(shell) {
  const zone = shell?.querySelector('[data-zone="bandeau-commission"]');
  if (!zone) return;
  const id = etat.boutique.id;
  const e = await etatCommission(id);
  if (!zone.isConnected || etat.boutique?.id !== id) return;
  if (!e || !ALERTES.includes(e.code)) { zone.innerHTML = ''; return; }
  const j = Number(e.jours) || 0;
  zone.innerHTML = `<div class="bandeau-commission" role="status">
    ${icone('alerte', 18, 2)}
    <span><strong>Vous devez ${esc(montant(e.du, e.devise))} à YOUMMA${e.mois ? ` pour ${esc(nomMois(e.mois))}` : ''}</strong>${j ? ` · depuis ${j} jour${j > 1 ? 's' : ''}` : ''}</span>
    <a class="btn-bandeau-commission" href="${LIEN_ECRAN}">Voir et régler</a>
  </div>`;
}

/* ------------------------------------------------------------ Vitrine coupée pour impayé */

/** « d’octobre », « de novembre ». */
const deMois = (nom) => (/^[aeiouéèh]/i.test(nom) ? `d’${nom}` : `de ${nom}`);

/** { mois } si la vitrine a été coupée pour impayé (le serveur l'a marquée), sinon null. */
export async function vitrineCoupee(id = etat.boutique?.id) {
  const { data, error } = await sb.from('boutiques_en_ligne').select('coupee_impaye').eq('boutique_id', id).maybeSingle();
  if (error || !data?.coupee_impaye) return null;
  const e = await etatCommission(id);
  return { mois: e?.mois || null };
}
export function raisonVitrineCoupeeHTML(c) {
  return `<div class="vitrine-coupee" role="status">
    <h2>Boutique en ligne hors ligne</h2>
    <p>Votre boutique en ligne est hors ligne parce que la commission${c.mois ? ` ${esc(deMois(nomMois(c.mois)))}` : ''} n’est pas réglée. Elle revient dès le règlement.</p>
    <a class="btn btn-primaire" href="${LIEN_ECRAN}">Régler</a>
  </div>`;
}

/* ------------------------------------------------------------ Paramètres › « Ce que je dois à YOUMMA » */

export const sectionFacturationHTML = () => `<section class="carte section-parametres facturation-youmma" id="ce-que-je-dois" data-zone="facturation" hidden></section>`;

/** Décompte embarqué par ma_commission (objet à part, ou à plat dans la réponse). */
function decompteDe(m) {
  return [m.decompte, m.mois_en_cours, m.courant, m.commission_du_mois, m.commission && typeof m.commission === 'object' ? m.commission : null]
    .find((x) => x && typeof x === 'object') || m;
}

export async function chargerFacturation(racine, { defiler = false } = {}) {
  const zone = racine.querySelector('[data-zone="facturation"]');
  if (!zone || !etat.boutique) return;
  const id = etat.boutique.id;
  let m;
  try { m = premiere(await rpc('ma_commission', { p_boutique: id })); } catch { return; } // pas d'accès : rien à montrer
  if (!zone.isConnected || etat.boutique?.id !== id) return;
  // Abonnement (ou pas de réponse) : la carte « Licence » dit déjà la formule et la date de fin.
  if (!m || lire(m, 'mode') !== 'commission') { zone.remove(); return; }
  const dc = lireDecompte(decompteDe(m));
  const e = m.etat && typeof m.etat === 'object' ? m.etat : null;
  const impayes = (Array.isArray(m.impayes) ? m.impayes : []).filter((x) => Number(lire(x, 'du', 'montant')) > 0);
  const modes = await chargerModes('licence', lire(m, 'pays') || null);
  if (!zone.isConnected) return;
  const d = dc.devise;
  const mois = nomMois(dc.mois);
  const bornes = bornesMois(dc.mois);
  const largeur = Math.max(0, Math.min(100, Number(dc.partPlafond) || 0));
  zone.innerHTML = `
    <div class="bloc-entete"><h2>Ce que je dois à YOUMMA</h2><span class="discret">Commission${mois ? ` de ${esc(mois)}` : ''}</span></div>
    <div class="fy-montant"><strong class="num" data-ref="du">${esc(montant(dc.du, d))}</strong>
      <span>${sansVente(dc) ? 'Aucune vente ce mois-ci pour l’instant.' : `sur <span class="num">${esc(montant(dc.ventes, d))}</span> de ventes`}</span></div>
    ${dc.plafond > 0 ? `
      <div class="fy-jauge ${dc.plafondAtteint ? 'pleine' : ''}">
        <div class="fy-jauge-tete"><span>Plafond <span class="num">${esc(montant(dc.plafond, d))}</span></span><strong class="num" data-ref="part-plafond">${Math.round(largeur)} %</strong></div>
        <span class="fy-barre" role="progressbar" aria-label="Part du plafond atteinte" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(largeur)}"><span style="width:${largeur}%"></span></span>
      </div>` : '<p class="discret">Sans plafond.</p>'}
    ${dc.plafondAtteint ? '<p class="fy-plafond-atteint">Vous avez atteint le plafond. Tout ce que vous vendez jusqu’à la fin du mois ne vous coûte plus rien.</p>' : ''}
    ${dc.lignes.length ? `<ul class="fy-detail">${dc.lignes.map((l) => `
      <li><span class="fy-detail-nom">${esc(l.libelle)}<small>${esc(taux(l.taux))}${l.nb !== null ? ` · ${l.nb} vente${l.nb > 1 ? 's' : ''}` : ''}</small></span>
        <strong class="num">${esc(montant(l.montant, d))}</strong></li>`).join('')}</ul>` : ''}
    ${dc.dateLimite ? `<p class="fy-limite">À régler avant le <strong>${esc(dateCourte(dc.dateLimite))}</strong>.</p>` : ''}
    ${impayes.length ? `<div class="fy-impayes"><span class="etiquette">Reste à régler</span><ul>${impayes.map((x) => `<li><span>${esc(nomMois(lire(x, 'mois')))}</span><strong class="num">${esc(montant(lire(x, 'du', 'montant'), lire(x, 'devise') || d))}</strong></li>`).join('')}</ul></div>` : ''}
    ${e && e.code && e.code !== 'a_jour' && e.code !== 'sans_objet' && e.libelle ? `<p class="fy-etat">${esc(e.libelle)}</p>` : ''}
    ${modes.length ? `<div class="fy-modes"><span class="etiquette">Moyens de paiement</span><div>${modes.map((x) => `<span class="fy-mode">${esc(x.nom)}</span>`).join('')}</div></div>` : ''}
    <div class="fy-actions">
      <a class="btn btn-whatsapp" href="${esc(lienSupport(`Bonjour YOUMMA, je souhaite régler la commission${mois ? ` de ${mois}` : ''} de la boutique « ${etat.boutique.nom} » : ${montant(impayes.length ? lire(impayes[0], 'du', 'montant') : dc.du, d)}.`))}" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} Régler avec YOUMMA</a>
      <a class="btn-lien" href="#/ventes?du=${bornes.du}&au=${bornes.au}&annulees=1">Voir le détail, vente par vente</a>
    </div>`;
  zone.hidden = false;
  if (defiler) zone.scrollIntoView({ block: 'start' });
}
