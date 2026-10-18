/**
 * sms.js — Éléments partagés des SMS : packs de recharge, compteur de caractères,
 * crédit SMS (badge du menu, bandeau « crédit bas »), modale « Recharger », relance d'un client.
 *
 * L'appli n'envoie jamais de SMS elle-même : tout passe par la file d'attente en base
 * (messages_envoyes), vidée chaque minute par la fonction Edge envoyer-messages.
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import {
  esc, icone, toast, confirmer, ouvrirModale, messageErreur, prenom, formatGNF, formatNombre,
  formatDate, formatTelephone, dateISO, lireStockage, ecrireStockage
} from './utils.js';

/* ------------------------------------------------------------ Tarifs (à modifier ici uniquement) */

export const PACKS_SMS = [
  { nb: 100, prix: 15000 },
  { nb: 500, prix: 60000 },
  { nb: 1000, prix: 100000 }
];
const WHATSAPP_RECHARGE = '224620538290';
export const SEUIL_CREDIT_BAS = 20;

/* ------------------------------------------------------------ Compteur (même calcul que le serveur) */

const SMS_SIMPLE = 160;
const SMS_PARTIE = 153;
export const SMS_MAX_CARACTERES = 459;

/** Texte tel qu'il partira : accents et caractères typographiques remplacés (comme sms_texte en base). */
export function texteSms(texte) {
  return String(texte || '')
    .replace(/[’‘]/g, "'").replace(/[«»“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
    .replace(/[  ]/g, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** { caracteres, nb } : 1 SMS jusqu'à 160 caractères, puis 153 par SMS. */
export function compterSms(texte) {
  const caracteres = texteSms(texte).length;
  const nb = caracteres === 0 ? 0 : caracteres <= SMS_SIMPLE ? 1 : Math.ceil(caracteres / SMS_PARTIE);
  return { caracteres, nb, limite: nb <= 1 ? SMS_SIMPLE : SMS_PARTIE * nb };
}

/** « 124 / 160 caractères · 1 SMS » */
export function texteCompteur(texte) {
  const { caracteres, nb, limite } = compterSms(texte);
  return `${caracteres} / ${limite} caractères · ${nb} SMS`;
}

/* ------------------------------------------------------------ Crédit SMS */

/** Solde SMS de la boutique active (lisible par tous les membres). */
export async function chargerSoldeSms() {
  const { data, error } = await sb.from('sms_credits').select('solde').eq('boutique_id', etat.boutique.id).maybeSingle();
  if (error) throw error;
  return Number(data?.solde) || 0;
}

const cleBandeau = () => `yb_bandeau_sms_${etat.boutique.id}`;

/**
 * Met à jour le badge du menu « Messages » et le bandeau « crédit bas » (gérant / propriétaire).
 * Le bandeau se ferme pour la journée.
 */
export async function majCreditSmsAffiche() {
  if (!peut('messages.voir')) return;
  let solde;
  try {
    solde = await chargerSoldeSms();
  } catch (err) {
    console.warn('[YOUMMA] Solde SMS indisponible :', err);
    return;
  }
  document.querySelectorAll('[data-ref="badge-sms"]').forEach((el) => {
    el.textContent = formatNombre(solde);
    el.classList.toggle('vide', solde < SEUIL_CREDIT_BAS);
    el.title = `${formatNombre(solde)} SMS restants`;
  });
  const zone = document.querySelector('[data-zone="bandeau-sms"]');
  if (!zone) return;
  if (solde >= SEUIL_CREDIT_BAS || lireStockage(cleBandeau()) === dateISO()) { zone.innerHTML = ''; return; }
  zone.innerHTML = `
    <div class="bandeau-sms ${solde <= 0 ? 'epuise' : ''}" role="status">
      ${icone('sms', 18, 2)}
      <span>${solde <= 0 ? 'Crédit SMS épuisé : vos alertes et reçus ne partent plus.' : `Plus que ${formatNombre(solde)} SMS : vos alertes et reçus vont s’arrêter.`}</span>
      <button type="button" class="btn btn-bandeau" data-action="recharger-sms">Recharger</button>
      <button type="button" class="btn-icone btn-fermer-bandeau" data-action="fermer-bandeau-sms" aria-label="Masquer jusqu’à demain">${icone('fermer', 18, 2)}</button>
    </div>`;
  zone.onclick = (e) => {
    if (e.target.closest('[data-action="recharger-sms"]')) ouvrirRecharge();
    if (e.target.closest('[data-action="fermer-bandeau-sms"]')) { ecrireStockage(cleBandeau(), dateISO()); zone.innerHTML = ''; }
  };
}

/* ------------------------------------------------------------ Recharger */

/** Modale « Recharger » : packs, commande par WhatsApp (paiement manuel), historique des recharges. */
export function ouvrirRecharge() {
  const boutique = etat.boutique;
  let choix = PACKS_SMS[0];
  const { el } = ouvrirModale({
    titre: 'Recharger le crédit SMS',
    variante: 'large',
    contenu: `
      <div class="packs-sms" role="group" aria-label="Pack de SMS">
        ${PACKS_SMS.map((p, i) => `
          <button type="button" class="pack-sms" data-pack="${i}" aria-pressed="${i === 0}">
            <span class="pack-nb">${formatNombre(p.nb)} SMS</span>
            <span class="pack-prix">${formatGNF(p.prix)}</span>
            <span class="discret">${formatNombre(Math.round(p.prix / p.nb))} GNF / SMS</span>
          </button>`).join('')}
      </div>
      <a class="btn btn-whatsapp btn-grand btn-bloc" data-ref="commande" target="_blank" rel="noopener">${icone('whatsapp', 20, 2)} Commander par WhatsApp</a>
      <p class="aide">Votre crédit est ajouté dès réception du paiement (Orange Money / MTN MoMo). Le paiement en ligne arrive bientôt.</p>
      <h3 class="fiche-sous-titre">Historique des recharges</h3>
      <div data-zone="recharges"><p class="discret">Chargement…</p></div>`
  });
  const lien = el.querySelector('[data-ref="commande"]');
  const majLien = () => {
    const message = `Bonjour YOUMMA, je veux recharger ${formatNombre(choix.nb)} SMS (${formatGNF(choix.prix)}) pour la boutique ${boutique.nom}${boutique.telephone ? ` (${formatTelephone(boutique.telephone)})` : ''}.`;
    lien.href = `https://wa.me/${WHATSAPP_RECHARGE}?text=${encodeURIComponent(message)}`;
  };
  el.addEventListener('click', (e) => {
    const pack = e.target.closest('[data-pack]');
    if (!pack) return;
    choix = PACKS_SMS[Number(pack.dataset.pack)];
    el.querySelectorAll('[data-pack]').forEach((b) => b.setAttribute('aria-pressed', String(b === pack)));
    majLien();
  });
  majLien();
  chargerRecharges(el.querySelector('[data-zone="recharges"]'));
}

async function chargerRecharges(zone) {
  const { data, error } = await sb.from('sms_recharges').select('nb_sms, montant, reference, created_at')
    .eq('boutique_id', etat.boutique.id).order('created_at', { ascending: false }).limit(20);
  if (!zone.isConnected) return;
  if (error) { zone.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(error))}</p>`; return; }
  zone.innerHTML = data.length ? `
    <ul class="historique">
      ${data.map((r) => `
        <li class="historique-ligne">
          <span class="historique-textes"><span class="gras">${Number(r.nb_sms) > 0 ? '+' : ''}${formatNombre(r.nb_sms)} SMS</span>
            <span class="discret">${esc(formatDate(r.created_at, 'complet'))}${r.reference ? ' · ' + esc(r.reference) : ''}</span></span>
          <span class="gras">${r.montant ? formatGNF(r.montant) : 'Offert'}</span>
        </li>`).join('')}
    </ul>` : '<p class="discret">Aucune recharge pour l’instant (20 SMS offerts à la création de la boutique).</p>';
}

/* ------------------------------------------------------------ Relance d'un client */

/** Texte de relance pour WhatsApp (gratuit, envoyé depuis le téléphone de l'utilisateur). */
export function texteRelanceWhatsApp(client, montant) {
  return `Bonjour ${prenom(client.nom)}, c’est la boutique ${etat.boutique.nom}. Petit rappel : il reste ${formatGNF(montant)} à régler. Merci !`;
}

export function lienRelanceWhatsApp(client, montant) {
  return `https://wa.me/${client.telephone || ''}?text=${encodeURIComponent(texteRelanceWhatsApp(client, montant))}`;
}

/** Relance par SMS (1 par jour et par client, limitée par le serveur), avec confirmation. */
export async function relancerParSms(client, montant) {
  if (!client.telephone) { toast('Ce client n’a pas de numéro de téléphone.', 'erreur'); return false; }
  const ok = await confirmer(`Envoyer un SMS de relance à ${client.nom} (doit ${formatGNF(montant)}) ? 1 SMS sera utilisé.`, {
    titre: 'Relancer par SMS', libelleOk: 'Envoyer le SMS'
  });
  if (!ok) return false;
  const { data, error } = await sb.rpc('relancer_client', { p_client: client.id });
  if (error) { toast(messageErreur(error), 'erreur', 6000); return false; }
  const r = (Array.isArray(data) ? data[0] : data) || {};
  toast(`Relance envoyée à ${client.nom}${r.telephone ? ` (${formatTelephone(r.telephone)})` : ''} : arrive dans la minute.`, 'succes');
  majCreditSmsAffiche();
  return true;
}

/** Boutons « Relancer par SMS » + « WhatsApp » à placer à côté d'un client qui doit de l'argent. */
export function boutonsRelanceHTML(client, montant, compact = false) {
  if (!peut('clients.relancer') || !(montant > 0)) return '';
  return `
    <span class="boutons-relance">
      <button type="button" class="btn btn-relance" data-relancer-sms="${esc(client.id)}" aria-label="Relancer ${esc(client.nom)} par SMS" ${client.telephone ? '' : 'disabled title="Aucun numéro enregistré"'}>
        ${icone('sms', 16, 2)}${compact ? '' : '<span class="seul-ordi">Relancer par SMS</span>'}
      </button>
      ${client.telephone ? `<a class="btn btn-relance btn-relance-wa" href="${esc(lienRelanceWhatsApp(client, montant))}" target="_blank" rel="noopener" aria-label="Relancer ${esc(client.nom)} par WhatsApp">${icone('whatsapp', 16, 2)}${compact ? '' : '<span class="seul-ordi">WhatsApp</span>'}</a>` : ''}
    </span>`;
}
