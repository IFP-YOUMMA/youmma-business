/**
 * verification.js — Page publique de vérification d'un document (v/?c=<code>), ouverte par le QR code
 * imprimé sur les factures, reçus, devis et bons de livraison.
 *
 * Page indépendante de l'appli : aucun module de l'appli n'est chargé (seulement config.js). Le visiteur
 * n'est jamais connecté : tout passe par la RPC publique verifier_document (client masqué côté serveur).
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'yb-verification' }
});

const racine = document.getElementById('verification');
const FUSEAU = 'Africa/Conakry';
const TYPES = { facture: 'Facture', recu: 'Reçu de vente', proforma: 'Facture proforma (devis)', bon_livraison: 'Bon de livraison' };
const ICONES = {
  ok: 'M20 6L9 17l-5-5',
  non: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  telephone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  whatsapp: 'M3 21l1.7-5A9 9 0 1 1 8 19.3z',
  recherche: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3'
};
const icone = (nom, t = 20) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONES[nom]}"/></svg>`;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gnf = (n) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0)).replace(/ /g, ' ')} GNF`;
const date = (d, heure = false) => {
  if (!d) return '';
  const x = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00Z` : d);
  if (Number.isNaN(x.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, day: '2-digit', month: '2-digit', year: 'numeric', ...(heure ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(x);
};
const numeroVente = (n) => (n === null || n === undefined || n === '' ? '' : /^\d+$/.test(String(n)) ? `V-${String(n).padStart(4, '0')}` : String(n));
const telephone = (n) => { const c = String(n || '').replace(/\D/g, ''); const l = c.startsWith('224') ? c.slice(3) : c; return l.length === 9 ? { local: `${l.slice(0, 3)} ${l.slice(3, 5)} ${l.slice(5, 7)} ${l.slice(7)}`, intl: `224${l}` } : null; };
const initiales = (nom) => String(nom || '?').trim().split(/\s+/).slice(0, 2).map((m) => m[0]).join('').toUpperCase();

function etatTexte(r) {
  switch (r.etat) {
    case 'paye': return { texte: 'Payée', classe: 'ok' };
    case 'credit': return { texte: 'À crédit', classe: 'attention' };
    case 'chantier': return { texte: 'Compte chantier', classe: 'neutre' };
    case 'annule': return { texte: 'ANNULÉE', classe: 'danger' };
    case 'valide': return { texte: `Devis valable${r.validite_fin ? ` jusqu’au ${date(r.validite_fin)}` : ''}`, classe: 'ok' };
    case 'expire': return { texte: 'Devis expiré', classe: 'attention' };
    case 'converti': return { texte: 'Devis transformé en vente', classe: 'neutre' };
    default: return r.etat ? { texte: String(r.etat), classe: 'neutre' } : null;
  }
}

function formulaire(code = '') {
  return `
    <form class="vf-form" novalidate>
      <label for="vf-code">${code ? 'Vérifier un autre document' : 'Code du document'}</label>
      <div class="vf-form-ligne">
        <input id="vf-code" name="code" type="text" inputmode="text" autocomplete="off" spellcheck="false"
          maxlength="20" placeholder="Code à 10 caractères" value="">
        <button type="submit">${icone('recherche', 18)} Vérifier</button>
      </div>
      <p class="vf-aide">Le code est imprimé sous le QR code du document.</p>
    </form>`;
}

function afficherAuthentique(r) {
  const b = r.boutique || {};
  const tel = telephone(b.telephone);
  const e = etatTexte(r);
  const lignes = [
    ['Document', `${esc(TYPES[r.type] || r.type)} <strong>${esc(r.numero)}</strong>`],
    ['Date', esc(date(r.date, true))],
    r.vente ? ['Réf. vente', `${esc(numeroVente(r.vente))}${r.date_vente && date(r.date_vente) !== date(r.date) ? ` · du ${esc(date(r.date_vente))}` : ''}`] : null,
    r.total !== null && r.total !== undefined && r.type !== 'bon_livraison' ? ['Montant total', `<strong>${esc(gnf(r.total))}</strong>`] : null,
    r.client ? ['Client', esc(r.client)] : null,
    r.nb_articles ? ['Articles', esc(`${r.nb_articles} article${r.nb_articles > 1 ? 's' : ''}`)] : null,
    e ? ['État', `<span class="vf-etat vf-etat-${e.classe}">${esc(e.texte)}</span>`] : null
  ].filter(Boolean);
  racine.innerHTML = `
    <section class="vf-carte vf-authentique ${r.etat === 'annule' ? 'vf-annule' : ''}">
      <div class="vf-verdict vf-verdict-ok">${icone('ok', 26)}<span><strong>Document authentique</strong>Émis avec YOUMMA Business par la boutique ci-dessous.</span></div>
      <div class="vf-boutique">
        ${b.logo_url ? `<img class="vf-logo" src="${esc(b.logo_url)}" alt="">` : `<span class="vf-logo vf-initiales">${esc(initiales(b.nom))}</span>`}
        <span class="vf-boutique-textes"><strong>${esc(b.nom || 'Boutique')}</strong><span>${esc([b.commune, b.ville].filter(Boolean).join(', '))}</span>${tel ? `<span>${esc(tel.local)}</span>` : ''}</span>
      </div>
      ${tel ? `<div class="vf-contact"><a class="vf-btn" href="tel:+${tel.intl}">${icone('telephone', 18)} Appeler</a>
        <a class="vf-btn vf-btn-wa" href="https://wa.me/${tel.intl}" target="_blank" rel="noopener">${icone('whatsapp', 18)} WhatsApp</a></div>` : ''}
      <dl class="vf-details">${lignes.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      ${r.etat === 'annule' ? '<p class="vf-note vf-note-danger">Cette vente a été annulée par la boutique : ce document n’a plus de valeur.</p>' : ''}
      <p class="vf-note">Comparez ces informations avec le document papier. En cas de doute, contactez la boutique.</p>
    </section>
    <section class="vf-carte">${formulaire(r.code)}</section>`;
}

function afficherInconnu(code) {
  racine.innerHTML = `
    <section class="vf-carte vf-inconnu">
      <div class="vf-verdict vf-verdict-non">${icone('non', 26)}<span><strong>Document introuvable</strong>Ce document n’est pas reconnu par YOUMMA Business. Il peut être faux : contactez la boutique.</span></div>
      ${code ? `<p class="vf-code-lu">Code vérifié : <strong>${esc(code)}</strong></p>` : ''}
      ${formulaire(code)}
    </section>`;
}

function afficherAccueil() {
  racine.innerHTML = `
    <section class="vf-carte">
      <h1>Vérifier un document</h1>
      <p class="vf-intro">Scannez le QR code d’une facture, d’un reçu, d’un devis ou d’un bon de livraison, ou saisissez son code.</p>
      ${formulaire()}
    </section>`;
}

function afficherErreur(code) {
  racine.innerHTML = `
    <section class="vf-carte">
      <div class="vf-verdict vf-verdict-attente">${icone('non', 26)}<span><strong>Vérification impossible</strong>Pas de connexion internet ou service indisponible. Réessayez dans un instant.</span></div>
      <button type="button" class="vf-btn vf-btn-plein" data-action="reessayer">Réessayer</button>
      ${formulaire(code)}
    </section>`;
  racine.querySelector('[data-action="reessayer"]').addEventListener('click', () => verifier(code));
}

async function appeler(code) {
  const { data, error } = await sb.rpc('verifier_document', { p_code: code });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) || {};
}

async function verifier(code) {
  const propre = String(code || '').trim().replace(/[^A-Za-z0-9]/g, '');
  if (!propre) { afficherAccueil(); return; }
  racine.innerHTML = '<div class="vf-carte vf-chargement" role="status"><span class="vf-rond"></span>Vérification en cours…</div>';
  try {
    let r = await appeler(propre);
    // Code saisi à la main en minuscules : nouvel essai en majuscules.
    if (!r.authentique && propre !== propre.toUpperCase()) r = await appeler(propre.toUpperCase());
    if (r.authentique) afficherAuthentique({ ...r, code: propre });
    else afficherInconnu(propre);
  } catch (err) {
    console.error('[YOUMMA] Vérification :', err);
    afficherErreur(propre);
  }
}

racine.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = e.target.code.value.trim().replace(/[^A-Za-z0-9]/g, '');
  if (!code) { e.target.code.focus(); return; }
  history.pushState(null, '', `?c=${encodeURIComponent(code)}`);
  verifier(code);
});
window.addEventListener('popstate', () => verifier(new URLSearchParams(location.search).get('c')));

verifier(new URLSearchParams(location.search).get('c'));
