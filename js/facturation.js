/**
 * facturation.js — Étape 24, chez le boutiquier : ce qu'il doit à YOUMMA quand il paie à la commission.
 *  - Paramètres › « Ce que je dois à YOUMMA » : ma_commission(p_boutique) → en_cours (le décompte du mois, forme de
 *    commission_du_mois), impayes, etat. En abonnement (en_cours.mode = 'abonnement'), rien de plus que la carte
 *    « Licence » existante (formule et date de fin) : pas d'écran vide ;
 *  - un bandeau ambre, un seul, dans la coquille : etat_commission lu une fois par boutique ouverte ;
 *  - la vitrine coupée pour impayé (boutiques_en_ligne.coupee_impaye) : la vraie raison et le bouton « Régler ».
 * Pas de date limite (il n'y en a pas) : ce qui va réellement arriver, d'après impayes[0].envoye_le (coupure à 15 jours).
 * Rien ne bloque la caisse, le stock ni les rapports : ces lectures n'ouvrent ni ne ferment aucun écran.
 */
import { sb } from './supabase.js';
import { etat } from './state.js';
import { esc, icone, formatDate } from './utils.js';
import { lienSupport } from './plateforme.js';
import { premiere, exiger, montant, nomMois, deMois, bornesMois, detailHTML } from './commission-commun.js';

const ALERTES = ['avertie', 'vitrine_coupee', 'blocage_possible'];
const COUPEE = ['vitrine_coupee', 'blocage_possible'];
const JOURS_AVANT_COUPURE = 15;
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
  const source = 'etat_commission';
  const j = Number(exiger(e, 'jours', source)) || 0;
  zone.innerHTML = `<div class="bandeau-commission" role="status">
    ${icone('alerte', 18, 2)}
    <span><strong>Vous devez ${esc(montant(exiger(e, 'du', source)))} à YOUMMA pour ${esc(nomMois(exiger(e, 'mois', source)))}</strong>${j ? ` · depuis ${j} jour${j > 1 ? 's' : ''}` : ''}</span>
    <a class="btn-bandeau-commission" href="${LIEN_ECRAN}">Voir et régler</a>
  </div>`;
}

/* ------------------------------------------------------------ Vitrine coupée pour impayé */

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

/** Ce qui va réellement arriver à la vitrine : coupure à 15 jours après l'envoi du relevé, ou retour au règlement. */
function suiteHTML(impaye, e) {
  if (COUPEE.includes(e?.code)) return '<p class="fy-suite">Votre boutique en ligne revient dès le règlement.</p>';
  if (!impaye) return '';
  const envoye = exiger(impaye, 'envoye_le', 'ma_commission.impayes');
  if (!envoye) return '';
  const coupure = new Date(new Date(envoye).getTime() + JOURS_AVANT_COUPURE * 864e5);
  return `<p class="fy-suite">Votre boutique en ligne passera hors ligne le <strong>${esc(formatDate(coupure, 'long'))}</strong>.</p>`;
}

export async function chargerFacturation(racine, { defiler = false } = {}) {
  const zone = racine.querySelector('[data-zone="facturation"]');
  if (!zone || !etat.boutique) return;
  const id = etat.boutique.id;
  let m;
  try { m = premiere(await rpc('ma_commission', { p_boutique: id })); } catch { return; } // pas d'accès : rien à montrer
  if (!zone.isConnected || etat.boutique?.id !== id) return;
  const src = 'ma_commission.en_cours';
  const d = exiger(m, 'en_cours', 'ma_commission');
  // Abonnement (réponse courte : mode, boutique, formule, licence_fin) : la carte « Licence » dit déjà tout.
  if (!d || d.mode !== 'commission') { zone.remove(); return; }
  const impayes = exiger(m, 'impayes', 'ma_commission') || [];
  const e = exiger(m, 'etat', 'ma_commission');
  // Moyens de paiement du pays de la boutique, filtrés par le serveur.
  const modes = exiger(m, 'moyens', 'ma_commission') || [];
  const mois = nomMois(exiger(d, 'mois', src));
  const bornes = bornesMois(d.mois);
  const part = exiger(d, 'part_plafond', src);
  const atteint = exiger(d, 'plafond_atteint', src) === true;
  const du = exiger(d, 'du', src);
  const aRegler = impayes.length ? impayes[0] : null;
  zone.innerHTML = `
    <div class="bloc-entete"><h2>Ce que je dois à YOUMMA</h2><span class="discret">Commission ${esc(deMois(mois))}</span></div>
    <div class="fy-montant"><strong class="num" data-ref="du">${esc(montant(du))}</strong>
      <span>sur <span class="num" data-ref="ventes-total">${esc(montant(exiger(d, 'ventes_total', src)))}</span> de ventes</span></div>
    ${part === null || part === undefined ? '' : `
      <div class="fy-jauge ${atteint ? 'pleine' : ''}">
        <div class="fy-jauge-tete"><span>Plafond <span class="num">${esc(montant(exiger(d, 'plafond', src)))}</span></span><strong class="num" data-ref="part-plafond">${Number(part)} %</strong></div>
        <span class="fy-barre" role="progressbar" aria-label="Part du plafond atteinte" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Number(part)}"><span style="width:${Math.min(100, Math.max(0, Number(part)))}%"></span></span>
      </div>`}
    ${atteint ? `<p class="fy-plafond-atteint">Vous avez atteint le plafond. Tout ce que vous vendez jusqu’à la fin du mois ne vous coûte plus rien.</p>
      <p class="fy-economise">Sans plafond : <span class="num">${esc(montant(exiger(d, 'brut', src)))}</span> · économisé : <strong class="num">${esc(montant(exiger(d, 'economise', src)))}</strong></p>` : ''}
    ${detailHTML(d.lignes, src)}
    ${aRegler ? `<div class="fy-impayes"><span class="etiquette">Reste à régler</span><ul>${impayes.map((x) => `<li><span>${esc(nomMois(exiger(x, 'mois', 'ma_commission.impayes')))}</span><strong class="num">${esc(montant(exiger(x, 'du', 'ma_commission.impayes')))}</strong></li>`).join('')}</ul></div>` : ''}
    ${suiteHTML(aRegler, e)}
    ${modes.length ? `<div class="fy-modes"><span class="etiquette">Moyens de paiement</span><div>${modes.map((x) => `<span class="fy-mode">${esc(x.nom)}</span>`).join('')}</div></div>` : ''}
    <div class="fy-actions">
      <a class="btn btn-whatsapp" href="${esc(lienSupport(`Bonjour YOUMMA, je souhaite régler la commission ${aRegler ? deMois(nomMois(aRegler.mois)) : deMois(mois)} de la boutique « ${etat.boutique.nom} » : ${montant(aRegler ? aRegler.du : du)}.`))}" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} Régler avec YOUMMA</a>
      <a class="btn-lien" href="#/ventes?du=${bornes.du}&au=${bornes.au}&annulees=1">Voir le détail, vente par vente</a>
    </div>`;
  zone.hidden = false;
  if (defiler) zone.scrollIntoView({ block: 'start' });
}
