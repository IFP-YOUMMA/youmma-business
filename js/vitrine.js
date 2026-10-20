/**
 * vitrine.js — Boutique en ligne publique (b/?s=<adresse>), maquettes Vitrine.dc.html et Panier.dc.html.
 *
 * Page indépendante de l'appli : aucun module de l'appli n'est chargé (seulement config.js pour
 * l'URL et la clé publishable). Le visiteur n'est jamais connecté : tout passe par les RPC
 * publiques boutique_publique et passer_commande_web (prix recalculés côté serveur).
 *
 * Vues (dans l'adresse, pour que le bouton « retour » du téléphone marche) :
 *   (aucune) → la boutique · #panier → panier + coordonnées · #commande → confirmation.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'yb-vitrine' }
});

const racine = document.getElementById('vitrine');
const ESPACE = ' ';
const UNITES_DIVISIBLES = ['kg', 'tonne', 'm²', 'm2', 'm', 'litre', 'l'];
const NOMS_JOURS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const TYPES = {
  materiaux: 'Matériaux de construction', alimentation: 'Alimentation', habillement: 'Habillement',
  cosmetique: 'Cosmétique', quincaillerie: 'Quincaillerie', electronique: 'Électronique',
  pharmacie: 'Pharmacie', restauration: 'Restauration', autre: 'Commerce'
};
const DISPO = {
  disponible: { texte: 'Disponible', classe: 'ok' },
  sur_commande: { texte: 'Sur commande', classe: 'commande' },
  epuise: { texte: 'Épuisé', classe: 'epuise' }
};
const ICONES = {
  stock: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  recherche: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  retour: 'M15 18l-6-6 6-6',
  suivant: 'M9 6l6 6-6 6',
  telephone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  whatsapp: 'M3 21l1.7-5A9 9 0 1 1 8 19.3z',
  sac: 'M6 3h12l2 18H4zM9 3v4a3 3 0 0 0 6 0V3',
  barre: 'M4 20L20 4M7 20L20 7M4 17L17 4',
  tole: 'M3 8l3-2 3 2 3-2 3 2 3-2 3 2v10l-3-2-3 2-3-2-3 2-3-2-3 2z',
  seau: 'M5 7h14l-1.5 13h-11zM5 7a7 3 0 0 1 14 0M9 4h6',
  clou: 'M8 3h8M12 3v15l-1 3M12 18l1 3',
  carreau: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z',
  camion: 'M1 6h13v10H1zM14 10h4l4 3v3h-8M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  magasin: 'M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6',
  valide: 'M20 6L9 17l-5-5',
  alerte: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  cadenas: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z',
  partager: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13'
};
const ICONES_UNITES = { sac: 'sac', barre: 'barre', feuille: 'tole', 'tôle': 'tole', seau: 'seau', 'm²': 'carreau', m2: 'carreau', voyage: 'camion', kg: 'clou' };

const ERREURS = {
  BOUTIQUE_INTROUVABLE: 'Cette boutique est introuvable.',
  BOUTIQUE_FERMEE: 'La boutique ne prend pas de commandes pour le moment.',
  NOM_REQUIS: 'Indiquez votre nom.',
  TELEPHONE_INVALIDE: 'Numéro de téléphone invalide. Exemple : 621 11 22 33.',
  RECEPTION_INVALIDE: 'Choisissez le retrait en boutique ou la livraison.',
  ZONE_REQUISE: 'Choisissez une zone de livraison.',
  ADRESSE_REQUISE: 'Indiquez votre quartier et un repère.',
  PANIER_VIDE: 'Votre panier est vide.',
  PANIER_TROP_GRAND: 'Trop d’articles dans le panier (50 maximum).',
  TROP_DE_COMMANDES: 'Trop de commandes avec ce numéro, réessayez dans une heure.',
  PRODUIT_INTROUVABLE: 'Un article n’est plus disponible en ligne. Retirez-le du panier.',
  QUANTITE_INVALIDE: 'Une quantité n’est pas valide.'
};

/* ------------------------------------------------------------ Outils */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icone = (nom, taille = 18, epaisseur = 2) => `<svg width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${epaisseur}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${ICONES[nom] || ''}"></path></svg>`;

function formatNombre(valeur, decimalesMax = 0) {
  const arrondi = Number((Number(valeur) || 0).toFixed(decimalesMax));
  const [entier, decimales] = Math.abs(arrondi).toString().split('.');
  return (arrondi < 0 ? '−' : '') + entier.replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE) + (decimales ? ',' + decimales : '');
}
const gnf = (n) => `${formatNombre(n)}${ESPACE}GNF`;
const divisible = (unite) => UNITES_DIVISIBLES.includes(String(unite || '').trim().toLowerCase());
const qte = (n) => formatNombre(n, 3);

/** 6XX XX XX XX → 2246XXXXXXXX ; renvoie null si invalide. */
function normaliserTelephone(saisie) {
  let c = String(saisie || '').replace(/\D/g, '');
  if (c.startsWith('00224')) c = c.slice(2);
  if (c.length === 9) c = `224${c}`;
  return /^2246\d{8}$/.test(c) ? c : null;
}
function formatTelephone(t) {
  const c = String(t || '').replace(/\D/g, '');
  const local = c.startsWith('224') ? c.slice(3) : c;
  return local.length === 9 ? local.replace(/(\d{3})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4') : t || '';
}

function messageErreur(err) {
  const brut = String(err?.message || err || '');
  const stock = brut.match(/STOCK_INSUFFISANT\s*:?\s*(.*?)\s*\(\s*reste\s*([-\d.,]+)\s*\)/i);
  if (stock) return `Stock insuffisant pour « ${stock[1]} » : il en reste ${formatNombre(Number(stock[2].replace(',', '.')) || 0, 3)}.`;
  const epuise = brut.match(/PRODUIT_EPUISE\s*:?\s*(.+)$/i);
  if (epuise) return `« ${epuise[1].trim()} » est épuisé : retirez-le du panier.`;
  for (const [code, message] of Object.entries(ERREURS)) if (brut.includes(code)) return message;
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(brut)) return 'Pas de connexion internet. Vérifiez votre réseau puis réessayez.';
  console.error('[YOUMMA] Erreur :', err);
  return 'Une erreur est survenue. Réessayez dans un instant.';
}

/** localStorage dans try/catch : la page marche sans (navigation privée, stockage bloqué). */
function lire(cle) {
  try { const v = localStorage.getItem(cle); return v ? JSON.parse(v) : null; } catch { return null; }
}
function ecrire(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* sans mémoire */ }
}

function toast(message, type = 'info') {
  const zone = document.getElementById('v-toasts');
  const el = document.createElement('div');
  el.className = `v-toast ${type}`;
  el.textContent = message;
  zone.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/* ------------------------------------------------------------ Heures (Conakry = UTC toute l'année) */

const minutesDe = (h) => { const [a, b] = String(h || '').split(':').map(Number); return (a || 0) * 60 + (b || 0); };
const heureCourte = (m) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;

/** { ouvert, texte } : « Ouvert · ferme à 18h30 » / « Fermé · ouvre demain à 7h30 ». null sans horaires. */
export function statutOuverture(b, maintenant = new Date()) {
  if (!b?.ouverture || !b?.fermeture) return null;
  const jours = (Array.isArray(b.jours) && b.jours.length ? b.jours : [1, 2, 3, 4, 5, 6, 7]).map(Number);
  const jour = ((maintenant.getUTCDay() + 6) % 7) + 1;
  const minutes = maintenant.getUTCHours() * 60 + maintenant.getUTCMinutes();
  const o = minutesDe(b.ouverture);
  const f = minutesDe(b.fermeture);
  if (jours.includes(jour) && minutes >= o && minutes < f) return { ouvert: true, texte: `Ouvert · ferme à ${heureCourte(f)}` };
  for (let d = 0; d <= 7; d++) {
    const j = ((jour - 1 + d) % 7) + 1;
    if (!jours.includes(j) || (d === 0 && minutes >= o)) continue;
    const quand = d === 0 ? '' : d === 1 ? 'demain ' : `${NOMS_JOURS[j]} `;
    return { ouvert: false, texte: `Fermé · ouvre ${quand}à ${heureCourte(o)}` };
  }
  return { ouvert: false, texte: 'Fermé' };
}

/* ------------------------------------------------------------ État */

const slug = (new URLSearchParams(location.search).get('s') || location.pathname.match(/\/b\/([a-z0-9-]{3,40})\/?$/)?.[1] || '').toLowerCase();
const cle = `yb_vitrine_${slug}`;
const memoire = lire(cle) || {};
const s = {
  donnees: null,
  produits: new Map(),
  panier: new Map(Object.entries(memoire.panier || {}).map(([id, q]) => [id, Number(q)]).filter(([, q]) => q > 0)),
  client: { nom: memoire.nom || '', telephone: memoire.telephone || '', adresse: memoire.adresse || '', note: '' },
  reception: memoire.reception || null,
  zone: memoire.zone || null,
  recherche: '',
  categorie: '',
  commande: null,
  envoi: false
};

function memoriser() {
  ecrire(cle, {
    panier: Object.fromEntries(s.panier), nom: s.client.nom, telephone: s.client.telephone,
    adresse: s.client.adresse, reception: s.reception, zone: s.zone
  });
}

function lignesPanier() {
  return [...s.panier].map(([id, quantite]) => ({ produit: s.produits.get(id), quantite })).filter((l) => l.produit);
}
function totalArticles() {
  return lignesPanier().reduce((t, l) => t + Math.round(Number(l.produit.prix) * l.quantite), 0);
}
function zoneChoisie() {
  return (s.donnees?.zones || []).find((z) => z.id === s.zone) || null;
}

/** Quantité saisie → nombre valide (décimal pour kg, m², m, litre ; entier sinon) ou null. */
function lireQuantite(texte, unite) {
  const n = Number(String(texte).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  if (divisible(unite)) return Math.round(n * 1000) / 1000;
  return Number.isInteger(n) ? n : null;
}

function changerQuantite(id, quantite) {
  if (!(quantite > 0)) s.panier.delete(id); else s.panier.set(id, quantite);
  memoriser();
}

/* ------------------------------------------------------------ Chargement */

async function demarrer() {
  if (!slug) { afficherIntrouvable(); return; }
  const { data, error } = await sb.rpc('boutique_publique', { p_slug: slug });
  // Module « Boutique en ligne » masqué ou bloqué : la vitrine est simplement fermée.
  if (error && /MODULE_(INACTIF|BLOQUE|FORMULE)/.test(error.message || '')) { afficherFerme({}); return; }
  if (error) {
    racine.innerHTML = `
      <main class="v-page-simple">
        <span class="v-simple-icone">${icone('alerte', 40, 1.8)}</span>
        <h1>Boutique indisponible</h1>
        <p>${esc(messageErreur(error))}</p>
        <button type="button" class="v-btn v-btn-primaire" onclick="location.reload()">Réessayer</button>
      </main>`;
    return;
  }
  const r = (Array.isArray(data) ? data[0] : data) || {};
  if (r.introuvable || (!r.boutique && !r.ferme)) { afficherIntrouvable(); return; }
  if (r.ferme) { afficherFerme(r); return; }
  s.donnees = r;
  (r.produits || []).forEach((p) => s.produits.set(p.id, p));
  // Articles retirés de la boutique depuis la dernière visite : on les enlève du panier.
  [...s.panier.keys()].forEach((id) => { if (!s.produits.has(id)) s.panier.delete(id); });
  if (!r.boutique.retrait && s.reception === 'retrait') s.reception = null;
  if (s.zone && !zoneChoisie()) s.zone = null;
  if (!s.reception) s.reception = r.boutique.retrait ? 'retrait' : 'livraison';
  memoriser();
  document.title = `${r.boutique.nom} · Commandez en ligne`;
  window.addEventListener('hashchange', router);
  router();
}

function afficherIntrouvable() {
  document.title = 'Boutique introuvable · YOUMMA Business';
  racine.innerHTML = `
    <main class="v-page-simple">
      <span class="v-simple-icone">${icone('magasin', 40, 1.8)}</span>
      <h1>Boutique introuvable</h1>
      <p>Vérifiez l’adresse reçue : elle ne correspond à aucune boutique en ligne.</p>
    </main>
    ${pied()}`;
}

function afficherFerme(r) {
  document.title = `${r.nom || 'Boutique'} · Fermée temporairement`;
  racine.innerHTML = `
    <main class="v-page-simple">
      <span class="v-simple-icone">${icone('cadenas', 40, 1.8)}</span>
      <h1>${esc(r.nom || 'Boutique')}</h1>
      <p class="v-ferme-titre">Boutique fermée temporairement</p>
      <p>La boutique ne prend pas de commandes en ligne pour le moment${r.ville ? ` (${esc(r.ville)})` : ''}. Vous pouvez lui écrire sur WhatsApp.</p>
      ${r.whatsapp ? `<a class="v-btn v-btn-whatsapp" href="https://wa.me/${esc(r.whatsapp)}" target="_blank" rel="noopener">${icone('whatsapp')} WhatsApp</a>` : ''}
    </main>
    ${pied()}`;
}

const SYMBOLE = new URL('../img/logo/youmma-business-symbole.png', import.meta.url).href;
const pied = () => `<footer class="v-pied"><img src="${SYMBOLE}" width="20" height="20" alt="" decoding="async"><span>Boutique propulsée par <strong>YOUMMA Business</strong></span></footer>`;

function router() {
  const vue = location.hash.replace('#', '');
  if (vue === 'commande' && s.commande) renderConfirmation();
  else if (vue === 'panier' && s.panier.size) renderPanier();
  else { if (vue) history.replaceState(null, '', location.pathname + location.search); renderBoutique(); }
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------ Vue boutique */

/** Miniature de l'article (≈ 25 Ko) ; repli sur la grande photo, puis sur l'icône. */
function vignette(p, taille = 44) {
  const mini = p.photo_mini_url || null;
  const grande = p.photo_url || null;
  if (!mini && !grande) return icone(ICONES_UNITES[String(p.unite || '').toLowerCase()] || 'stock', taille, 1.5);
  return `<img class="v-img" src="${esc(mini || grande)}" ${mini && grande ? `data-repli="${esc(grande)}"` : ''} alt="" width="300" height="300" loading="lazy" decoding="async"
    onerror="if(this.dataset.repli){var r=this.dataset.repli;this.removeAttribute('data-repli');this.src=r;}else{this.remove();}">`;
}

/* ------------------------------------------------------------ Couverture et identité */

const HEX = /^#[0-9a-f]{6}$/i;
const PICTOS_ACTIVITE = {
  materiaux: 'M8 30 V16 L24 8 L40 16 V30 M18 30 v-8 h12 v8',
  habillement: 'M14 10 l6 -4 h8 l6 4 l6 8 -6 4 v14 h-20 v-14 l-6 -4z',
  alimentation: 'M10 18 h28 l-3 14 h-22z M16 18 l4 -8 M32 18 l-4 -8',
  services: 'M24 10 a12 12 0 1 0 0.1 0 M24 15 v9 l6 4',
  general: 'M8 18 h32 l-3 -8 h-26z M10 18 v18 h28 v-18 M20 36 v-10 h8 v10'
};
/** Couverture par défaut (aucune photo) : dégradé aux couleurs des documents, pictogramme de l'activité, liseré d'accent. */
function couvertureDefaut(type, couleur, accent) {
  const c = HEX.test(couleur || '') ? couleur : '#0F7B5F';
  const a = HEX.test(accent || '') ? accent : '#F2B33D';
  const picto = PICTOS_ACTIVITE[type] || PICTOS_ACTIVITE.general;
  return `<div class="v-couverture-defaut" style="background:linear-gradient(135deg,${c} 0%,${c}cc 100%)">
    <svg class="v-couverture-picto" viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${picto}"/></svg>
    <span class="v-couverture-liseret" style="background:${a}"></span></div>`;
}

/** Logos de paiement importés par la boutique (sinon badge texte sobre, jamais une imitation de logo). */
function logosPaiement(id) {
  const p = id?.paiements || {};
  const elements = [];
  if (p.om?.actif) elements.push(p.om.logo_url ? `<img src="${esc(p.om.logo_url)}" alt="Orange Money" height="24" loading="lazy" decoding="async">` : '<span class="v-badge-paiement">Orange Money</span>');
  if (p.momo?.actif) elements.push(p.momo.logo_url ? `<img src="${esc(p.momo.logo_url)}" alt="MTN MoMo" height="24" loading="lazy" decoding="async">` : '<span class="v-badge-paiement">MTN MoMo</span>');
  if (p.especes?.actif !== false) elements.push('<span class="v-badge-paiement v-badge-especes">Espèces</span>');
  return elements;
}

async function partager() {
  const url = location.href.split('#')[0];
  const titre = s.donnees?.boutique?.nom || 'Boutique';
  try {
    if (navigator.share) { await navigator.share({ title: titre, text: `${titre} · commandez en ligne`, url }); return; }
    await navigator.clipboard.writeText(url);
    toast('Lien de la boutique copié.', 'succes');
  } catch (err) {
    if (err?.name !== 'AbortError') toast('Copiez l’adresse de la page pour la partager.', 'info');
  }
}

function badgePromo(p) {
  if (!(Number(p.prix_barre) > Number(p.prix))) return '';
  return `<span class="v-badge-promo">−${formatNombre(Number(p.prix_barre) - Number(p.prix))}</span>`;
}

function stepper(p, quantite, variante = '') {
  return `
    <div class="v-stepper ${variante}">
      <button type="button" data-moins="${esc(p.id)}" aria-label="Diminuer ${esc(p.nom)}">−</button>
      <label class="v-sr" for="q-${variante}-${esc(p.id)}">Quantité de ${esc(p.nom)}</label>
      <input id="q-${variante}-${esc(p.id)}" type="text" inputmode="${divisible(p.unite) ? 'decimal' : 'numeric'}" data-quantite="${esc(p.id)}" value="${esc(qte(quantite))}" autocomplete="off">
      <button type="button" data-plus="${esc(p.id)}" aria-label="Augmenter ${esc(p.nom)}">+</button>
    </div>`;
}

function carteProduit(p) {
  const quantite = s.panier.get(p.id) || 0;
  const dispo = DISPO[p.dispo] || DISPO.disponible;
  const epuise = p.dispo === 'epuise';
  let action = `<button type="button" class="v-btn-ajouter" data-ajouter="${esc(p.id)}">Ajouter</button>`;
  if (epuise) action = '<button type="button" class="v-btn-epuise" disabled>Épuisé</button>';
  else if (quantite) action = stepper(p, quantite, 'grille');
  return `
    <article class="v-produit ${quantite ? 'dans-panier' : ''} ${epuise ? 'epuise' : ''}">
      <div class="v-produit-visuel">${vignette(p)}${badgePromo(p)}</div>
      <div class="v-produit-corps">
        <h3 class="v-produit-nom">${esc(p.nom)}</h3>
        <span class="v-produit-prix">
          ${Number(p.prix_barre) > Number(p.prix) ? `<s>${formatNombre(p.prix_barre)}</s> ` : ''}<strong>${formatNombre(p.prix)}</strong> GNF / ${esc(p.unite || 'unité')}
        </span>
        <span class="v-dispo ${dispo.classe}">${esc(dispo.texte)}</span>
        ${action}
      </div>
    </article>`;
}

function produitsFiltres() {
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(s.recherche.trim());
  return (s.donnees.produits || []).filter((p) => (!s.categorie || p.categorie_id === s.categorie) && (!q || norm(p.nom).includes(q)));
}

function carteAffiche(a) {
  const p = a.produit || s.produits.get(a.produit_id);
  if (!p || !s.produits.has(p.id)) return '';
  const produit = { ...s.produits.get(p.id), ...p };
  const modele = ['promo', 'jour', 'arrivage'].includes(a.modele) ? a.modele : 'jour';
  const etiquette = { promo: 'PROMO DU JOUR', jour: 'LE CHOIX DU JOUR', arrivage: 'NOUVEL ARRIVAGE' }[modele];
  const epuise = produit.dispo === 'epuise';
  return `
    <button type="button" class="v-affiche v-affiche-${modele}" data-ajouter="${esc(produit.id)}" ${epuise ? 'disabled' : ''}
      aria-label="${esc(`${etiquette} : ${produit.nom}, ${formatNombre(produit.prix)} GNF. ${epuise ? 'Épuisé' : 'Ajouter au panier'}`)}">
      <span class="v-affiche-textes">
        <span class="v-affiche-tag">${etiquette}</span>
        <span class="v-affiche-nom">${esc(produit.nom)}</span>
        ${Number(produit.prix_barre) > Number(produit.prix) ? `<s class="v-affiche-barre">${gnf(produit.prix_barre)}</s>` : ''}
        <span class="v-affiche-prix">${formatNombre(produit.prix)} <small>GNF / ${esc(produit.unite || 'unité')}</small></span>
        <span class="v-affiche-phrase">${a.phrase ? `${esc(a.phrase)} · ` : ''}${epuise ? 'Épuisé' : 'Ajouter au panier ›'}</span>
      </span>
      <span class="v-affiche-visuel">${vignette(produit, 62)}</span>
    </button>`;
}

function renderBoutique() {
  const { boutique: b, zones = [], categories = [], affiche } = s.donnees;
  const statut = statutOuverture(b) || (b.ouvert === undefined ? null : { ouvert: Boolean(b.ouvert), texte: b.ouvert ? 'Ouvert' : 'Fermé' });
  const nomsZones = zones.map((z) => z.nom);
  const texteZones = nomsZones.length
    ? `Livraison ${nomsZones.length > 3 ? `${nomsZones.slice(0, 3).join(', ')}…` : nomsZones.join(' & ').replace(/ & (?=.* & )/g, ', ')}`
    : (b.retrait ? 'Retrait en boutique' : '');
  const categoriesAvecArticles = categories.filter((c) => (s.donnees.produits || []).some((p) => p.categorie_id === c.id));
  const id = s.donnees.identite || {};
  const sousTitre = [TYPES[b.type] || '', [b.commune, b.ville].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const photo = id.couverture_url || id.couverture_mini;
  const couverture = photo
    ? `<img class="v-couverture-photo" src="${esc(id.couverture_mini || id.couverture_url)}" ${id.couverture_mini && id.couverture_url ? `srcset="${esc(id.couverture_mini)} 800w, ${esc(id.couverture_url)} 1600w" sizes="(min-width: 560px) 560px, 100vw"` : ''}
        alt="" width="1600" height="900" decoding="async" fetchpriority="high">`
    : couvertureDefaut(b.type, id.couleur, id.accent);
  const logoVisible = b.logo_url && id.logo_vitrine !== false;
  const paiements = logosPaiement(id);
  const partenaires = (id.partenaires || []).filter((x) => x?.logo_url).slice(0, 6);
  racine.innerHTML = `
    <header class="v-couverture ${photo ? 'avec-photo' : 'sans-photo'}">
      <div class="v-couverture-fond">${couverture}</div>
      <span class="v-couverture-degrade"></span>
      <div class="v-couverture-haut">
        ${statut ? `<span class="v-pastille-ouverture ${statut.ouvert ? 'ouvert' : 'ferme'}"><span class="v-point"></span>${esc(statut.texte)}</span>` : '<span></span>'}
        <button type="button" class="v-partager" data-action="partager" aria-label="Partager la boutique">${icone('partager', 18)}</button>
      </div>
      <div class="v-couverture-textes">
        <h1>${esc(b.nom)}</h1>
        ${sousTitre ? `<span>${esc(sousTitre)}</span>` : ''}
      </div>
    </header>
    <section class="v-carte-infos">
      ${logoVisible ? `<span class="v-logo"><img src="${esc(b.logo_url)}" alt="" width="58" height="58" decoding="async"></span>` : ''}
      <div class="v-infos-textes">
        ${texteZones ? `<span class="v-infos-zones">${esc(texteZones)}</span>` : ''}
        ${b.message ? `<p class="v-message">${esc(b.message)}</p>` : ''}
      </div>
    </section>
    <main class="v-contenu">
      <div class="v-entete-actions">
        ${b.whatsapp ? `<a class="v-btn v-btn-whatsapp" href="https://wa.me/${esc(b.whatsapp)}" target="_blank" rel="noopener">${icone('whatsapp', 16)} WhatsApp</a>` : ''}
        ${b.telephone ? `<a class="v-btn v-btn-contour" href="tel:+${esc(String(b.telephone).replace(/\D/g, ''))}">${icone('telephone', 16)} Appeler</a>` : ''}
      </div>
      ${paiements.length ? `<div class="v-paiements"><span>Paiement à la livraison :</span>${paiements.join('')}</div>` : ''}
      ${b.bandeau ? `<p class="v-bandeau" role="note">${esc(b.bandeau)}</p>` : ''}
      ${affiche ? carteAffiche(affiche) : ''}
      <label class="v-recherche">
        ${icone('recherche', 18)}
        <span class="v-sr">Rechercher un produit</span>
        <input type="search" id="v-recherche" placeholder="Rechercher un produit…" value="${esc(s.recherche)}" autocomplete="off">
      </label>
      ${categoriesAvecArticles.length ? `
        <div class="v-categories" role="group" aria-label="Catégories">
          ${[{ id: '', nom: 'Tout' }, ...categoriesAvecArticles].map((c) => `
            <button type="button" class="v-categorie" data-categorie="${esc(c.id)}" aria-pressed="${c.id === s.categorie}">${esc(c.nom)}</button>`).join('')}
        </div>` : ''}
      <div class="v-grille" data-zone="grille"></div>
      ${partenaires.length ? `<div class="v-partenaires" aria-label="Partenaires">${partenaires.map((x) => `<img src="${esc(x.logo_url)}" alt="${esc(x.nom || '')}" title="${esc(x.nom || '')}" height="28" loading="lazy" decoding="async">`).join('')}</div>` : ''}
      ${pied()}
    </main>
    <div class="v-barre-panier" data-zone="barre"></div>`;
  renderGrille();
  renderBarre();
}

function renderGrille() {
  const zone = racine.querySelector('[data-zone="grille"]');
  if (!zone) return;
  const liste = produitsFiltres();
  zone.innerHTML = liste.length ? liste.map(carteProduit).join('')
    : `<p class="v-vide">${s.recherche ? 'Aucun produit ne correspond à votre recherche.' : 'Aucun produit dans cette catégorie.'}</p>`;
}

function renderBarre() {
  const zone = racine.querySelector('[data-zone="barre"]');
  if (!zone) return;
  const lignes = lignesPanier();
  zone.hidden = !lignes.length;
  if (!lignes.length) { zone.innerHTML = ''; return; }
  const nbArticles = lignes.reduce((t, l) => t + l.quantite, 0);
  zone.innerHTML = `
    <div class="v-barre-textes">
      <span>${lignes.length} produit${lignes.length > 1 ? 's' : ''} · ${qte(nbArticles)} article${nbArticles > 1 ? 's' : ''}</span>
      <strong>${formatNombre(totalArticles())} <small>GNF</small></strong>
    </div>
    <a class="v-btn-panier" href="#panier">Voir le panier ${icone('suivant', 16, 2.4)}</a>`;
}

/** Après un changement de quantité : met à jour la carte concernée sans tout redessiner (garde le focus). */
function rafraichirProduit(id) {
  const p = s.produits.get(id);
  if (location.hash === '#panier') { renderLignesPanier(); renderTotaux(); return; }
  racine.querySelectorAll(`[data-ajouter="${CSS.escape(id)}"], [data-quantite="${CSS.escape(id)}"]`).forEach((el) => {
    const carte = el.closest('.v-produit');
    if (carte && p) carte.outerHTML = carteProduit(p);
  });
  renderBarre();
}

/* ------------------------------------------------------------ Vue panier */

function renderPanier() {
  const { boutique: b, zones = [] } = s.donnees;
  racine.innerHTML = `
    <header class="v-entete-panier">
      <a href="#" class="v-btn-retour" aria-label="Retour à la boutique">${icone('retour', 20)}</a>
      <div class="v-entete-panier-textes">
        <h1>Votre commande</h1>
        <span>${esc(b.nom)}${b.ville ? ` · ${esc(b.ville)}` : ''}</span>
      </div>
    </header>
    <main class="v-contenu v-contenu-panier">
      <section class="v-carte v-lignes" aria-label="Articles" data-zone="lignes"></section>
      <section class="v-carte">
        <h2>Comment recevoir ?</h2>
        <div class="v-receptions" role="radiogroup" aria-label="Mode de réception">
          ${b.retrait ? `
            <button type="button" role="radio" class="v-reception" data-reception="retrait" aria-checked="${s.reception === 'retrait'}">
              <strong>Retrait</strong><span>Gratuit · en boutique</span>
            </button>` : ''}
          ${zones.length ? `
            <button type="button" role="radio" class="v-reception" data-reception="livraison" aria-checked="${s.reception === 'livraison'}">
              <strong>Livraison</strong><span>${zoneChoisie() ? esc(zoneChoisie().nom) : 'Choisir la zone'}</span>
            </button>` : ''}
        </div>
        <div class="v-zones" data-zone="zones" ${s.reception === 'livraison' ? '' : 'hidden'}>
          ${zones.map((z) => `
            <label class="v-zone">
              <input type="radio" name="zone" value="${esc(z.id)}" ${z.id === s.zone ? 'checked' : ''}>
              <span class="v-zone-nom">${esc(z.nom)}</span>
              <span class="v-zone-frais">${Number(z.frais) ? gnf(z.frais) : 'Gratuit'}</span>
            </label>`).join('')}
        </div>
        ${!b.retrait && !zones.length ? '<p class="v-aide">La boutique vous appellera pour convenir de la remise.</p>' : ''}
      </section>
      <section class="v-carte">
        <h2>Vos coordonnées</h2>
        <form class="v-form" id="v-form" novalidate>
          <label class="v-champ"><span>Votre nom</span>
            <input name="nom" type="text" autocomplete="name" maxlength="80" required value="${esc(s.client.nom)}"></label>
          <label class="v-champ"><span>Téléphone (WhatsApp)</span>
            <input name="telephone" type="tel" inputmode="tel" autocomplete="tel" placeholder="621 11 22 33" required value="${esc(s.client.telephone)}"></label>
          <label class="v-champ" data-zone="champ-adresse" ${s.reception === 'livraison' ? '' : 'hidden'}><span>Quartier et repère</span>
            <input name="adresse" type="text" autocomplete="street-address" maxlength="200" placeholder="Ex. Kagbélen, après la station, portail bleu" value="${esc(s.client.adresse)}"></label>
          <label class="v-champ"><span>Note (facultatif)</span>
            <input name="note" type="text" maxlength="300" placeholder="Ex. livrer avant 10 h" value="${esc(s.client.note)}"></label>
        </form>
      </section>
      <section class="v-carte">
        <h2>Paiement</h2>
        <p class="v-aide">Vous payez <strong>à la livraison ou au retrait</strong> : espèces, Orange Money ou MTN MoMo. La boutique vous appelle d’abord pour confirmer.</p>
      </section>
      <section class="v-totaux" data-zone="totaux"></section>
      ${pied()}
    </main>
    <div class="v-bas-fixe">
      <div class="v-total"><span>Total à payer</span><strong data-ref="total"></strong></div>
      <p class="v-erreur" role="alert" hidden></p>
      <button type="button" class="v-btn v-btn-whatsapp v-btn-grand" data-action="commander">${icone('whatsapp', 20)} Commander par WhatsApp</button>
      <span class="v-bas-note">Votre commande est enregistrée chez la boutique, puis WhatsApp s’ouvre avec le détail.</span>
    </div>`;
  renderLignesPanier();
  renderTotaux();
}

function renderLignesPanier() {
  const zone = racine.querySelector('[data-zone="lignes"]');
  if (!zone) return;
  const lignes = lignesPanier();
  if (!lignes.length) { location.hash = ''; return; }
  zone.innerHTML = lignes.map(({ produit: p, quantite }) => `
    <div class="v-ligne ${p.dispo === 'epuise' ? 'epuise' : ''}">
      <div class="v-ligne-textes">
        <span class="v-ligne-nom">${esc(p.nom)}</span>
        <span class="v-ligne-prix">${formatNombre(p.prix)} GNF / ${esc(p.unite || 'unité')}${p.dispo === 'epuise' ? ' · <strong>Épuisé</strong>' : p.dispo === 'sur_commande' ? ' · sur commande' : ''}</span>
      </div>
      ${stepper(p, quantite, 'ligne')}
      <span class="v-ligne-total">${formatNombre(Math.round(Number(p.prix) * quantite))}</span>
    </div>`).join('');
}

function renderTotaux() {
  const zone = racine.querySelector('[data-zone="totaux"]');
  if (!zone) return;
  const articles = totalArticles();
  const z = s.reception === 'livraison' ? zoneChoisie() : null;
  const frais = z ? Number(z.frais) || 0 : 0;
  zone.innerHTML = `
    <div><span>Articles</span><strong>${gnf(articles)}</strong></div>
    ${s.reception === 'livraison' ? `<div><span>Livraison${z ? ` ${esc(z.nom)}` : ''}</span><strong>${z ? (frais ? gnf(frais) : 'Gratuit') : 'Choisissez la zone'}</strong></div>` : ''}`;
  racine.querySelector('[data-ref="total"]').innerHTML = `${formatNombre(articles + frais)} <small>GNF</small>`;
}

function erreurPanier(message, champ) {
  const el = racine.querySelector('.v-erreur');
  el.textContent = message || '';
  el.hidden = !message;
  if (champ) racine.querySelector(`[name="${champ}"]`)?.focus();
}

async function commander(bouton) {
  if (s.envoi) return;
  const form = racine.querySelector('#v-form');
  const nom = form.nom.value.trim();
  const telephone = normaliserTelephone(form.telephone.value);
  const adresse = form.adresse.value.trim();
  if (!nom) return erreurPanier('Indiquez votre nom.', 'nom');
  if (!telephone) return erreurPanier(ERREURS.TELEPHONE_INVALIDE, 'telephone');
  if (!s.reception) return erreurPanier(ERREURS.RECEPTION_INVALIDE);
  if (s.reception === 'livraison' && !zoneChoisie()) return erreurPanier(ERREURS.ZONE_REQUISE);
  if (s.reception === 'livraison' && !adresse) return erreurPanier(ERREURS.ADRESSE_REQUISE, 'adresse');
  const epuise = lignesPanier().find((l) => l.produit.dispo === 'epuise');
  if (epuise) return erreurPanier(`« ${epuise.produit.nom} » est épuisé : retirez-le du panier.`);
  erreurPanier('');
  s.envoi = true;
  const libelle = bouton.innerHTML;
  bouton.disabled = true;
  bouton.textContent = 'Envoi de la commande…';
  try {
    const { data, error } = await sb.rpc('passer_commande_web', {
      p_slug: slug,
      p_nom: nom,
      p_telephone: telephone,
      p_reception: s.reception,
      p_zone: s.reception === 'livraison' ? s.zone : null,
      p_adresse: s.reception === 'livraison' ? adresse : null,
      p_note: form.note.value.trim() || null,
      p_lignes: lignesPanier().map((l) => ({ produit_id: l.produit.id, quantite: l.quantite }))
    });
    if (error) throw error;
    const r = (Array.isArray(data) ? data[0] : data) || {};
    s.commande = { ...r, whatsapp: r.whatsapp || s.donnees.boutique.whatsapp };
    s.panier.clear();
    s.client.note = '';
    memoriser();
    location.hash = 'commande';
    // Ouverture automatique de WhatsApp (souvent bloquée hors clic : le grand bouton reste affiché).
    try { window.open(lienCommande(), '_blank', 'noopener'); } catch { /* bouton */ }
  } catch (err) {
    erreurPanier(messageErreur(err));
  } finally {
    s.envoi = false;
    if (bouton.isConnected) { bouton.disabled = false; bouton.innerHTML = libelle; }
  }
}

/* ------------------------------------------------------------ Confirmation */

function lienCommande() {
  const c = s.commande;
  const numero = String(c.whatsapp || '').replace(/\D/g, '');
  return `https://wa.me/${numero}?text=${encodeURIComponent(c.texte || `Bonjour, je viens de passer la commande ${c.numero}.`)}`;
}

function renderConfirmation() {
  const c = s.commande;
  racine.innerHTML = `
    <main class="v-page-simple v-confirmation">
      <span class="v-simple-icone ok">${icone('valide', 40, 2.4)}</span>
      <h1>Commande ${esc(c.numero)} enregistrée</h1>
      <p>Total : <strong>${gnf(c.total)}</strong>. Envoyez-la maintenant sur WhatsApp : la boutique vous répond pour confirmer.</p>
      <a class="v-btn v-btn-whatsapp v-btn-grand" href="${esc(lienCommande())}" target="_blank" rel="noopener">${icone('whatsapp', 20)} Envoyer sur WhatsApp</a>
      <a class="v-btn v-btn-secondaire" href="#">Retour à la boutique</a>
    </main>
    ${pied()}`;
}

/* ------------------------------------------------------------ Évènements */

racine.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="partager"]')) { partager(); return; }
  const ajouter = e.target.closest('[data-ajouter]');
  if (ajouter) {
    const id = ajouter.dataset.ajouter;
    const p = s.produits.get(id);
    if (!p || p.dispo === 'epuise') return;
    changerQuantite(id, (s.panier.get(id) || 0) + 1);
    if (ajouter.classList.contains('v-affiche')) toast(`${p.nom} ajouté au panier.`, 'succes');
    rafraichirProduit(id);
    return;
  }
  const plus = e.target.closest('[data-plus]');
  const moins = e.target.closest('[data-moins]');
  if (plus || moins) {
    const id = (plus || moins).dataset.plus || (moins || plus).dataset.moins;
    const actuelle = s.panier.get(id) || 0;
    const p = s.produits.get(id);
    let n = plus ? Math.floor(actuelle + 1) : Math.ceil(actuelle - 1);
    if (moins && divisible(p?.unite) && actuelle % 1) n = Math.floor(actuelle);
    changerQuantite(id, Math.max(0, n));
    rafraichirProduit(id);
    return;
  }
  const categorie = e.target.closest('[data-categorie]');
  if (categorie) {
    s.categorie = categorie.dataset.categorie;
    racine.querySelectorAll('[data-categorie]').forEach((b) => b.setAttribute('aria-pressed', String(b === categorie)));
    renderGrille();
    return;
  }
  const reception = e.target.closest('[data-reception]');
  if (reception) {
    s.reception = reception.dataset.reception;
    racine.querySelectorAll('[data-reception]').forEach((b) => b.setAttribute('aria-checked', String(b === reception)));
    racine.querySelector('[data-zone="zones"]').hidden = s.reception !== 'livraison';
    racine.querySelector('[data-zone="champ-adresse"]').hidden = s.reception !== 'livraison';
    memoriser();
    renderTotaux();
    erreurPanier('');
    return;
  }
  if (e.target.closest('[data-action="commander"]')) commander(e.target.closest('button'));
});

racine.addEventListener('input', (e) => {
  if (e.target.id === 'v-recherche') { s.recherche = e.target.value; renderGrille(); return; }
  const form = e.target.closest('#v-form');
  if (form && e.target.name in s.client) { s.client[e.target.name] = e.target.value; memoriser(); }
});

racine.addEventListener('change', (e) => {
  if (e.target.name === 'zone') {
    s.zone = e.target.value;
    const b = racine.querySelector('[data-reception="livraison"] span');
    if (b) b.textContent = zoneChoisie()?.nom || 'Choisir la zone';
    memoriser();
    renderTotaux();
    erreurPanier('');
    return;
  }
  const champ = e.target.closest('[data-quantite]');
  if (champ) {
    const id = champ.dataset.quantite;
    const p = s.produits.get(id);
    const n = lireQuantite(champ.value, p?.unite);
    if (n === null) { champ.value = qte(s.panier.get(id) || 0); toast(divisible(p?.unite) ? 'Quantité invalide (ex. 2,5).' : 'Quantité invalide : nombre entier.', 'erreur'); return; }
    changerQuantite(id, n);
    rafraichirProduit(id);
  }
});

racine.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-quantite]')) e.target.blur();
});

demarrer().catch((err) => {
  console.error(err);
  racine.innerHTML = `<main class="v-page-simple"><h1>Boutique indisponible</h1><p>${esc(messageErreur(err))}</p></main>`;
});
