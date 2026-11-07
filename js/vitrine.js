/**
 * vitrine.js — Boutique en ligne publique (b/?s=<adresse>). Étape 22 : la vitrine moderne (même forme que le catalogue
 * a/ de l'étape 21), le parcours de commande inchangé.
 *
 * Page indépendante de l'appli : aucun module de l'appli n'est chargé (seulement config.js pour l'URL et la clé
 * publishable). Le visiteur n'est jamais connecté : tout passe par les RPC publiques boutique_publique et
 * passer_commande_web (prix recalculés côté serveur).
 *
 * boutique_publique → { boutique, identite, zones, categories, produits, affiche } (ou { introuvable } / { ferme }).
 * Lu sous ces noms-là : boutique.ouvert vient du serveur (jamais recalculé) ; categories ne contient que celles qui
 * ont un produit en ligne (pas de filtre ici) ; produit.dispo = false → « Rupture » ; affiche absente ou dispo = false
 * → pas de bannière du tout.
 *
 * La couleur de la boutique habille (en-tête, pastilles actives, ronds des rayons, onglet actif) ; le vert YOUMMA agit
 * (ajouter, Commander, Envoyer la commande). Texte foncé sur une couleur claire.
 *
 * Vues (dans l'adresse, pour que le bouton « retour » du téléphone marche) : (aucune) l'accueil · #rayons · #r/<id>
 * un rayon (#r/tous : tout) · #boutique la boutique · #panier · #p/<id> fiche d'un modèle à tailles / couleurs ·
 * #commande la confirmation. Barre du bas fixe : Accueil · Rayons · Panier · La boutique.
 * Tailles & couleurs : produit.variantes = { tailles, couleurs, cases: [{ id, t, c, dispo, dernier, prix }] } ;
 * une ligne de panier par case (clé « produit|case ») ; passer_commande_web reçoit variante_id.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { normaliserTelephone } from './lib/telephone.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'yb-vitrine' }
});

const racine = document.getElementById('vitrine');
const ESPACE = ' ';
const VERT = '#0F7B5F';
const UNITES_DIVISIBLES = ['kg', 'tonne', 'm²', 'm2', 'm', 'litre', 'l'];
const JOURS_COURTS = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const JOURS_LONGS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
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
  partager: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13',
  maison: 'M3 10.5L12 3l9 7.5M5 9v11h14V9',
  rayons: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z',
  panier: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6M10 20.5h.01M17 20.5h.01',
  horloge: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  lieu: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'
};
const ICONES_UNITES = { sac: 'sac', barre: 'barre', feuille: 'tole', 'tôle': 'tole', seau: 'seau', 'm²': 'carreau', m2: 'carreau', voyage: 'camion', kg: 'clou' };

const ERREURS = {
  BOUTIQUE_INTROUVABLE: 'Cette boutique est introuvable.',
  BOUTIQUE_FERMEE: 'La boutique ne prend pas de commandes pour le moment.',
  NOM_REQUIS: 'Indiquez votre nom.',
  TELEPHONE_INVALIDE: 'Numéro de téléphone invalide. Exemple : 621 11 22 33 ou 77 123 45 67.',
  RECEPTION_INVALIDE: 'Choisissez le retrait en boutique ou la livraison.',
  ZONE_REQUISE: 'Choisissez une zone de livraison.',
  ADRESSE_REQUISE: 'Indiquez votre quartier et un repère.',
  PANIER_VIDE: 'Votre panier est vide.',
  PANIER_TROP_GRAND: 'Trop d’articles dans le panier (50 maximum).',
  TROP_DE_COMMANDES: 'Trop de commandes avec ce numéro, réessayez dans une heure.',
  PRODUIT_INTROUVABLE: 'Un article n’est plus disponible en ligne. Retirez-le du panier.',
  QUANTITE_INVALIDE: 'Une quantité n’est pas valide.',
  VARIANTE_INTROUVABLE: 'Une taille ou une couleur n’est plus disponible. Retirez-la du panier.'
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
const accord = (n, mot, pluriel = `${mot}s`) => `${qte(n)} ${Number(n) > 1 ? pluriel : mot}`;
/** « 08:00 » → « 8 h », « 18:30 » → « 18 h 30 ». */
const heure = (h) => { const [a, b] = String(h || '').split(':'); return a ? `${Number(a)} h${b && b !== '00' ? ` ${b}` : ''}` : ''; };
const initiales = (nom) => String(nom || '?').trim().split(/\s+/).slice(0, 2).map((m) => m[0]).join('').toUpperCase();

function messageErreur(err) {
  const brut = String(err?.message || err || '');
  const stock = brut.match(/STOCK_INSUFFISANT\s*:?\s*(.*?)\s*\(\s*reste\s*([-\d.,]+)\s*\)/i);
  if (stock) return `Stock insuffisant pour « ${stock[1]} » : il en reste ${formatNombre(Number(stock[2].replace(',', '.')) || 0, 3)}.`;
  const epuise = brut.match(/PRODUIT_EPUISE\s*:?\s*(.+)$/i);
  if (epuise) return `« ${epuise[1].trim()} » est épuisé : retirez-le du panier.`;
  const requise = brut.match(/VARIANTE_REQUISE\s*:?\s*(.*)$/);
  if (requise) return `Choisissez la taille et la couleur${requise[1].trim() ? ` de « ${requise[1].trim()} »` : ''}.`;
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

/* ------------------------------------------------------------ Couleur de la boutique (habille) */

const HEX = /^#[0-9a-f]{6}$/i;
/** Encre lisible sur une couleur : foncé si la couleur est claire (même méthode que les initiales de #/boutiques). */
function encre(hex) {
  const m = HEX.exec(hex || '') ? hex.slice(1) : null;
  if (!m) return '#FFFFFF';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#10231E' : '#FFFFFF';
}
/** Mélange de deux couleurs #rrggbb (part de la seconde : t). */
function melanger(a, b, t) {
  const v = (h, i) => parseInt(h.slice(1 + i, 3 + i), 16);
  return `#${[0, 2, 4].map((i) => Math.round(v(a, i) * (1 - t) + v(b, i) * t).toString(16).padStart(2, '0')).join('')}`;
}
function appliquerCouleur(id) {
  const c = HEX.test(id?.couleur || '') ? id.couleur : VERT;
  const claire = encre(c) !== '#FFFFFF';
  racine.style.setProperty('--c', c);
  racine.style.setProperty('--c-encre', encre(c));
  // La couleur écrite sur du blanc (onglet actif, pictos) : assombrie si elle est claire, pour rester lisible.
  racine.style.setProperty('--c-texte', claire ? melanger(c, '#10231E', 0.55) : c);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c);
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
  filtre: 'tous',
  commande: null,
  envoi: false
};

function memoriser() {
  ecrire(cle, {
    panier: Object.fromEntries(s.panier), nom: s.client.nom, telephone: s.client.telephone,
    adresse: s.client.adresse, reception: s.reception, zone: s.zone
  });
}

/* ------------------------------------------------------------ Tailles & couleurs */

const idProduit = (cleLigne) => String(cleLigne).split('|')[0];
const aVariantes = (p) => Boolean(p?.variantes && Array.isArray(p.variantes.cases) && p.variantes.cases.length);
const caseDispo = (c) => Boolean(c) && !(c.dispo === false || c.dispo === 'epuise' || c.dispo === 0);
const libelleCase = (c) => [c.c, c.t].map((x) => String(x || '').trim()).filter(Boolean).join(' / ');
function couleursModele(p) {
  return (p.variantes?.couleurs || []).map((c) => (typeof c === 'string' ? { nom: c, hex: null, photo_url: null } : { nom: c?.nom || '', hex: c?.hex || null, photo_url: c?.photo_url || null })).filter((c) => c.nom);
}
/** Rupture : dispo = false (serveur), ou un modèle dont aucune taille / couleur n'est disponible. */
const enRupture = (p) => p.dispo === false || (aVariantes(p) && !p.variantes.cases.some(caseDispo));
const enPromo = (p) => Number(p.prix_barre) > Number(p.prix);

/* ------------------------------------------------------------ Autres unités (vente en boutique seulement) */

const CONTENANTS = ['botte', 'palette', 'carton', 'sac', 'paquet', 'rouleau', 'boîte', 'boite', 'lot', 'caisse', 'bidon', 'fût', 'balle', 'pack'];
const FEMININS = ['tonne', 'barre', 'feuille', 'pièce', 'piece', 'douzaine', 'boîte', 'boite', 'palette', 'botte', 'caisse'];
/** « Tonne » → « à la tonne », « Botte de 10 » → « en botte de 10 », « Mètre » → « au mètre », « Unité » → « à l’unité ». */
function avecPreposition(nom) {
  const texte = String(nom || '').trim();
  const bas = texte.charAt(0).toLowerCase() + texte.slice(1);
  const premier = bas.split(/\s+/)[0].toLowerCase();
  if (CONTENANTS.includes(premier)) return `en ${bas}`;
  if (/^[aeiouyéèêh]/i.test(premier)) return `à l’${bas}`;
  return FEMININS.includes(premier) ? `à la ${bas}` : `au ${bas}`;
}
/** produit.unites = [{ nom, facteur }] ou null → « Aussi vendu à la tonne, en botte de 10 — demandez en boutique ». */
function mentionUnites(p) {
  const unites = Array.isArray(p.unites) ? p.unites.filter((u) => u?.nom) : [];
  if (!unites.length) return '';
  const noms = unites.slice(0, 3).map((u) => avecPreposition(u.nom));
  const liste = unites.length > 3 ? `${noms.join(', ')}…` : noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}` : noms[0];
  return `<span class="v-unites">Aussi vendu ${esc(liste)} — demandez en boutique</span>`;
}

const rond = (hex, taille = 14) => `<span class="v-rond-couleur" style="--rond:${esc(hex || '#C9D3CF')};width:${taille}px;height:${taille}px" aria-hidden="true"></span>`;

function lignesPanier() {
  return [...s.panier].map(([cleLigne, quantite]) => {
    const produit = s.produits.get(idProduit(cleLigne));
    if (!produit) return null;
    const idCase = String(cleLigne).split('|')[1];
    if (!idCase) return aVariantes(produit) ? null : { cle: cleLigne, produit, quantite, prix: Number(produit.prix), nom: produit.nom };
    const cas = produit.variantes?.cases?.find((c) => c.id === idCase);
    if (!cas) return null;
    const libelle = libelleCase(cas);
    return { cle: cleLigne, produit, quantite, cas, prix: Number(cas.prix ?? produit.prix), nom: libelle ? `${produit.nom} — ${libelle}` : produit.nom };
  }).filter(Boolean);
}
function totalArticles() {
  return lignesPanier().reduce((t, l) => t + Math.round(l.prix * l.quantite), 0);
}
const nbArticles = () => lignesPanier().reduce((t, l) => t + l.quantite, 0);
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
  appliquerCouleur(r.identite);
  (r.produits || []).forEach((p) => s.produits.set(p.id, p));
  // Articles (ou tailles) retirés de la boutique depuis la dernière visite : on les enlève du panier.
  const valides = new Set(lignesPanier().map((l) => l.cle));
  [...s.panier.keys()].forEach((cleLigne) => { if (!valides.has(cleLigne)) s.panier.delete(cleLigne); });
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
  else if (vue.startsWith('p/') && aVariantes(s.produits.get(decodeURIComponent(vue.slice(2))))) renderFicheModele(decodeURIComponent(vue.slice(2)));
  else if (vue === 'panier') renderPanier();
  else if (vue === 'rayons') renderRayons();
  else if (vue.startsWith('r/')) renderRayon(decodeURIComponent(vue.slice(2)));
  else if (vue === 'boutique') renderLaBoutique();
  else { if (vue) history.replaceState(null, '', location.pathname + location.search); renderAccueil(); }
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------ Morceaux communs */

/** Miniature de l'article (≈ 25 Ko) ; repli sur la grande photo, puis sur l'icône. */
function vignette(p, taille = 44) {
  const mini = p.photo_mini_url || null;
  const grande = p.photo_url || null;
  if (!mini && !grande) return `<span class="vm-sans-photo">${icone(ICONES_UNITES[String(p.unite || '').toLowerCase()] || 'stock', taille, 1.5)}</span>`;
  return `<img class="v-img" src="${esc(mini || grande)}" ${mini && grande ? `data-repli="${esc(grande)}"` : ''} alt="" width="300" height="300" loading="lazy" decoding="async"
    onerror="if(this.dataset.repli){var r=this.dataset.repli;this.removeAttribute('data-repli');this.src=r;}else{this.remove();}">`;
}

/** Badge de promotion (rouge) : la remise en %, à partir des deux prix renvoyés. */
function badgePromo(p, classe = 'vm-badge') {
  if (!enPromo(p)) return '';
  return `<span class="${classe}">−${Math.round((1 - Number(p.prix) / Number(p.prix_barre)) * 100)} %</span>`;
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

function stepper(p, quantite, variante = '') {
  return `
    <div class="v-stepper ${variante}">
      <button type="button" data-moins="${esc(p.id)}" aria-label="Diminuer ${esc(p.nom)}">−</button>
      <label class="v-sr" for="q-${variante}-${esc(p.id)}">Quantité de ${esc(p.nom)}</label>
      <input id="q-${variante}-${esc(p.id)}" type="text" inputmode="${divisible(p.unite) ? 'decimal' : 'numeric'}" data-quantite="${esc(p.id)}" value="${esc(qte(quantite))}" autocomplete="off">
      <button type="button" data-plus="${esc(p.id)}" aria-label="Augmenter ${esc(p.nom)}">+</button>
    </div>`;
}

/** Carte d'un article : photo, badge promo, nom, prix barré, bouton + (vert) qui devient − n + ; rupture voilée. */
function carteProduit(p) {
  const modele = aVariantes(p);
  const quantite = modele ? [...s.panier].filter(([k]) => idProduit(k) === p.id).reduce((t, [, q]) => t + q, 0) : s.panier.get(p.id) || 0;
  const rupture = enRupture(p);
  let action = `<button type="button" class="vm-plus" data-ajouter="${esc(p.id)}" aria-label="Ajouter ${esc(p.nom)} au panier">+</button>`;
  if (rupture) action = '';
  else if (modele) action = `<a class="vm-choisir" href="#p/${encodeURIComponent(p.id)}">${quantite ? `${qte(quantite)} · Choisir` : 'Choisir'}</a>`;
  else if (quantite) action = stepper(p, quantite, 'vm-pas');
  const couleurs = modele ? couleursModele(p).filter((c) => p.variantes.cases.some((x) => x.c === c.nom && caseDispo(x))) : [];
  const visuel = `${vignette(p, 40)}${badgePromo(p)}${rupture ? '<span class="vm-rupture">Rupture</span>' : ''}`;
  return `
    <article class="vm-carte ${quantite ? 'dans-panier' : ''} ${rupture ? 'rupture' : ''}" data-carte="${esc(p.id)}" ${rupture ? 'aria-disabled="true"' : ''}>
      <div class="vm-photo">${modele && !rupture ? `<a href="#p/${encodeURIComponent(p.id)}" class="vm-lien-fiche" aria-label="Voir ${esc(p.nom)}">${visuel}</a>` : visuel}</div>
      <div class="vm-corps">
        <h3 class="vm-nom">${esc(p.nom)}</h3>
        ${couleurs.length ? `<div class="v-pastilles-couleurs" aria-label="${couleurs.length} couleur${couleurs.length > 1 ? 's' : ''}">${couleurs.slice(0, 5).map((c) => rond(c.hex, 12)).join('')}${couleurs.length > 5 ? `<span>+${couleurs.length - 5}</span>` : ''}</div>` : ''}
        <div class="vm-bas">
          <span class="vm-prix">${enPromo(p) ? `<s>${formatNombre(p.prix_barre)}</s>` : ''}<strong>${gnf(p.prix)}</strong><small>/ ${esc(p.unite || 'unité')}</small></span>
          ${action}
        </div>
        ${mentionUnites(p)}
      </div>
    </article>`;
}

/** Barre du bas, quatre onglets fixes : l'onglet actif prend la couleur de la boutique. */
function onglets(actif) {
  const n = lignesPanier().length;
  const o = (cle, href, ic, libelle, extra = '') => `<a class="vm-onglet ${cle === actif ? 'actif' : ''}" href="${href}" ${cle === actif ? 'aria-current="page"' : ''}>${icone(ic, 22, 1.9)}<span>${libelle}</span>${extra}</a>`;
  return `<nav class="vm-onglets" aria-label="Navigation de la boutique">
    ${o('accueil', '#', 'maison', 'Accueil')}
    ${o('rayons', '#rayons', 'rayons', 'Rayons')}
    ${o('panier', '#panier', 'panier', 'Panier', n ? `<span class="vm-compteur" data-ref="compteur">${n}</span>` : '<span class="vm-compteur" data-ref="compteur" hidden></span>')}
    ${o('boutique', '#boutique', 'magasin', 'La boutique')}
  </nav>`;
}

/** Barre de panier flottante : total, nombre d'articles, frais de la zone choisie, Commander (vert). */
function flottant() {
  const lignes = lignesPanier();
  if (!lignes.length) return '';
  const z = s.reception === 'livraison' ? zoneChoisie() : null;
  const frais = s.reception === 'retrait' ? 'Retrait gratuit en boutique'
    : z ? (Number(z.frais) ? `+ ${gnf(z.frais)} de livraison · ${z.nom}` : `Livraison gratuite · ${z.nom}`) : 'Livraison : zone à choisir';
  return `<div class="vm-flottant" data-zone="flottant">
    <div class="vm-flottant-textes">
      <strong class="num">${gnf(totalArticles())}</strong>
      <span>${accord(nbArticles(), 'article')} · <span data-ref="frais">${esc(frais)}</span></span>
    </div>
    <a class="vm-btn-commander" href="#panier">Commander</a>
  </div>`;
}
function majFlottant() {
  const zone = racine.querySelector('[data-zone="flottant"]');
  const html = flottant();
  if (zone) { if (html) zone.outerHTML = html; else zone.remove(); } else if (html) racine.querySelector('.vm-onglets')?.insertAdjacentHTML('beforebegin', html);
  const c = racine.querySelector('[data-ref="compteur"]');
  if (c) { const n = lignesPanier().length; c.textContent = n || ''; c.hidden = !n; }
}

/* ------------------------------------------------------------ 1 — L'accueil */

/** « Ouvert · ferme à 18 h 30 · Dubréka » ou « Fermé · Dubréka » : boutique.ouvert vient du serveur. */
function etatOuverture(b) {
  const lieu = b.ville || b.commune || '';
  if (b.ouvert === undefined || b.ouvert === null) return lieu ? `<span class="vm-etat">${esc(lieu)}</span>` : '';
  return `<span class="vm-etat ${b.ouvert ? 'ouvert' : 'ferme'}"><span class="vm-point" aria-hidden="true"></span>${b.ouvert ? `Ouvert${b.fermeture ? ` · ferme à ${esc(heure(b.fermeture))}` : ''}` : 'Fermé'}${lieu ? ` · ${esc(lieu)}` : ''}</span>`;
}

function enteteBoutique(b, id, { recherche = true } = {}) {
  const logo = b.logo_url && id.logo_vitrine !== false;
  return `<header class="vm-entete">
    <div class="vm-entete-haut">
      <span class="vm-logo">${logo ? `<img src="${esc(b.logo_url)}" alt="" width="48" height="48" decoding="async">` : esc(initiales(b.nom))}</span>
      <div class="vm-entete-textes"><h1>${esc(b.nom)}</h1>${etatOuverture(b)}</div>
      <button type="button" class="vm-partager" data-action="partager" aria-label="Partager la boutique">${icone('partager', 19)}</button>
    </div>
    ${recherche ? `<label class="vm-recherche">${icone('recherche', 18)}<span class="v-sr">Rechercher un article</span>
      <input type="search" id="v-recherche" placeholder="Rechercher un article…" value="${esc(s.recherche)}" autocomplete="off"></label>` : ''}
  </header>`;
}

/** La bannière, c'est l'affiche du jour. Absente, en rupture, ou article hors ligne → rien du tout. */
function banniere(a) {
  if (!a || a.dispo === false || !s.produits.has(a.produit)) return '';
  const p = s.produits.get(a.produit);
  if (enRupture(p)) return '';
  const promo = Number(a.prix_barre) > Number(a.prix);
  const action = aVariantes(p) ? `<a class="vm-btn-action" href="#p/${encodeURIComponent(p.id)}">Choisir</a>`
    : `<button type="button" class="vm-btn-action" data-ajouter="${esc(p.id)}" data-banniere>Ajouter au panier</button>`;
  return `<section class="vm-banniere" aria-label="L’affiche du jour">
    <div class="vm-banniere-photo">${a.photo_url ? `<img src="${esc(a.photo_url)}" alt="" width="400" height="400" decoding="async" fetchpriority="high">` : vignette(p, 48)}
      ${promo ? `<span class="vm-badge">−${Math.round((1 - Number(a.prix) / Number(a.prix_barre)) * 100)} %</span>` : ''}</div>
    <div class="vm-banniere-textes">
      <span class="vm-banniere-tag">${promo ? 'Promotion du jour' : 'L’article du jour'}</span>
      <strong class="vm-banniere-nom">${esc(a.nom || p.nom)}</strong>
      ${a.phrase ? `<span class="vm-banniere-phrase">${esc(a.phrase)}</span>` : ''}
      <span class="vm-banniere-prix">${promo ? `<s>${gnf(a.prix_barre)}</s>` : ''}<strong>${gnf(a.prix)}</strong><small>/ ${esc(a.unite || p.unite || 'unité')}</small></span>
      ${action}
    </div>
  </section>`;
}

/** Un rond de rayon : la photo du premier article du rayon, sinon l'initiale sur la couleur de la boutique. */
function rondImage(c) {
  const p = (s.donnees.produits || []).find((x) => x.categorie_id === c.id && (x.photo_mini_url || x.photo_url));
  return `<span class="vm-rond">${p ? `<img src="${esc(p.photo_mini_url || p.photo_url)}" alt="" width="64" height="64" loading="lazy" decoding="async">` : esc(initiales(c.nom))}</span>`;
}
const rondRayon = (c) => `<a class="vm-rayon" href="#r/${encodeURIComponent(c.id)}">${rondImage(c)}<span>${esc(c.nom)}</span></a>`;

/** « Lun – Sam », ou « Lun, Mer, Ven » si les jours ne se suivent pas. */
function plageJours(jours) {
  const j = [...new Set((Array.isArray(jours) ? jours : []).map(Number).filter((x) => x >= 1 && x <= 7))].sort((a, b) => a - b);
  if (!j.length) return '';
  if (j.length === 7) return 'Tous les jours';
  const suivis = j.every((x, i) => i === 0 || x === j[i - 1] + 1);
  return suivis && j.length > 2 ? `${JOURS_COURTS[j[0]]} – ${JOURS_COURTS[j.at(-1)]}` : j.map((x) => JOURS_COURTS[x]).join(', ');
}

/** Livraison, retrait, horaires : trois lignes, pas plus. */
function blocLivraison(b, zones) {
  const lignes = [];
  if (zones.length) {
    const tries = [...zones].sort((a, z) => (Number(a.frais) || 0) - (Number(z.frais) || 0));
    const min = Number(tries[0].frais) || 0;
    lignes.push([icone('camion', 18), `${min ? `Livraison dès ${gnf(min)}` : 'Livraison gratuite'} · ${tries.slice(0, 2).map((z) => z.nom).join(', ')}${tries.length > 2 ? '…' : ''}`]);
  }
  if (b.retrait) lignes.push([icone('magasin', 18), 'Retrait gratuit en boutique']);
  if (b.ouverture && b.fermeture) lignes.push([icone('horloge', 18), `${plageJours(b.jours) || 'Ouvert'} · ${heure(b.ouverture)} – ${heure(b.fermeture)}`]);
  if (!lignes.length) return '';
  return `<section class="vm-livraison">${lignes.slice(0, 3).map(([ic, t]) => `<div>${ic}<span>${esc(t)}</span></div>`).join('')}</section>`;
}

const PLUS_DEMANDES = 8;
const normaliser = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function renderAccueil() {
  const { boutique: b, identite: id = {}, zones = [], categories = [], affiche } = s.donnees;
  racine.innerHTML = `
    ${enteteBoutique(b, id)}
    <main class="vm-contenu">
      ${b.bandeau ? `<p class="vm-bandeau" role="note">${esc(b.bandeau)}</p>` : ''}
      ${banniere(affiche)}
      ${categories.length ? `<section class="vm-section"><div class="vm-section-tete"><h2>Les rayons</h2><a href="#rayons">Tout voir</a></div>
        <div class="vm-rayons">${categories.map(rondRayon).join('')}</div></section>` : ''}
      <section class="vm-section" data-zone="liste"></section>
      ${blocLivraison(b, zones)}
      ${pied()}
    </main>
    ${flottant()}
    ${onglets('accueil')}`;
  renderListeAccueil();
}

/** Les plus demandés (ordre du serveur), ou les résultats de la recherche. */
function renderListeAccueil() {
  const zone = racine.querySelector('[data-zone="liste"]');
  if (!zone) return;
  const tous = s.donnees.produits || [];
  const q = normaliser(s.recherche.trim());
  if (q) {
    const res = tous.filter((p) => normaliser(p.nom).includes(q));
    zone.innerHTML = `<div class="vm-section-tete"><h2>Résultats</h2><span>${accord(res.length, 'article')}</span></div>
      ${res.length ? `<div class="vm-grille">${res.map(carteProduit).join('')}</div>` : '<p class="v-vide">Aucun article ne correspond à votre recherche.</p>'}`;
    return;
  }
  zone.innerHTML = tous.length ? `<div class="vm-section-tete"><h2>Les plus demandés</h2>${tous.length > PLUS_DEMANDES ? `<a href="#r/tous">Tout voir (${tous.length})</a>` : ''}</div>
    <div class="vm-grille">${tous.slice(0, PLUS_DEMANDES).map(carteProduit).join('')}</div>` : '<p class="v-vide">La boutique n’a pas encore d’article en ligne.</p>';
}

/* ------------------------------------------------------------ Rayons et un rayon */

function renderRayons() {
  const { categories = [], produits = [] } = s.donnees;
  racine.innerHTML = `
    <header class="vm-entete-blanc"><a href="#" class="vm-retour" aria-label="Retour à l’accueil">${icone('retour', 22)}</a>
      <div class="vm-entete-blanc-textes"><h1>Les rayons</h1><span>${accord(produits.length, 'article')}</span></div></header>
    <main class="vm-contenu">
      <div class="vm-liste-rayons">
        <a class="vm-ligne-rayon" href="#r/tous"><span class="vm-rond">${icone('rayons', 22)}</span><span><strong>Tous les articles</strong><small>${accord(produits.length, 'article')}</small></span>${icone('suivant', 18)}</a>
        ${categories.map((c) => {
          const n = produits.filter((p) => p.categorie_id === c.id).length;
          return `<a class="vm-ligne-rayon" href="#r/${encodeURIComponent(c.id)}">${rondImage(c)}<span><strong>${esc(c.nom)}</strong><small>${accord(n, 'article')}</small></span>${icone('suivant', 18)}</a>`;
        }).join('')}
      </div>
      ${pied()}
    </main>
    ${flottant()}
    ${onglets('rayons')}`;
}

/** Une tranche de prix lisible : la médiane du rayon, arrondie vers le haut à 1, 2 ou 5 × 10^n. */
function seuilPrix(liste) {
  const prix = liste.map((p) => Number(p.prix) || 0).filter((x) => x > 0).sort((a, b) => a - b);
  if (prix.length < 4 || prix[0] === prix.at(-1)) return null;
  const m = prix[Math.floor(prix.length / 2)];
  const p10 = 10 ** Math.floor(Math.log10(m));
  const pas = [1, 2, 5, 10].map((k) => k * p10).find((x) => x >= m);
  return pas;
}

function renderRayon(id) {
  const { categories = [], produits = [] } = s.donnees;
  const c = id === 'tous' ? { id: 'tous', nom: 'Tous les articles' } : categories.find((x) => x.id === id);
  if (!c) { location.hash = 'rayons'; return; }
  const base = id === 'tous' ? produits : produits.filter((p) => p.categorie_id === id);
  const seuil = seuilPrix(base);
  if (s.filtre === 'prix' && !seuil) s.filtre = 'tous';
  const filtres = [['tous', 'Tous'], ['promo', 'En promotion'], ...(seuil ? [['prix', `Moins de ${gnf(seuil)}`]] : []), ['dispo', 'Disponible']];
  const liste = base.filter((p) => (s.filtre === 'promo' ? enPromo(p) : s.filtre === 'prix' ? Number(p.prix) < seuil : s.filtre === 'dispo' ? !enRupture(p) : true));
  const promos = base.filter(enPromo).length;
  racine.innerHTML = `
    <header class="vm-entete-blanc"><a href="#rayons" class="vm-retour" aria-label="Retour aux rayons">${icone('retour', 22)}</a>
      <div class="vm-entete-blanc-textes"><h1>${esc(c.nom)}</h1><span>${accord(base.length, 'article')}${promos ? ` · ${promos} en promotion` : ''}</span></div></header>
    <main class="vm-contenu">
      <div class="vm-filtres" role="group" aria-label="Filtres">${filtres.map(([cle, l]) => `<button type="button" class="vm-filtre ${s.filtre === cle ? 'actif' : ''}" data-filtre="${cle}" aria-pressed="${s.filtre === cle}">${esc(l)}</button>`).join('')}</div>
      ${liste.length ? `<div class="vm-grille">${liste.map(carteProduit).join('')}</div>` : '<p class="v-vide">Aucun article pour ce filtre.</p>'}
      ${pied()}
    </main>
    ${flottant()}
    ${onglets('rayons')}`;
}

/* ------------------------------------------------------------ La boutique */

function renderLaBoutique() {
  const { boutique: b, identite: id = {} } = s.donnees;
  const jours = (Array.isArray(b.jours) ? b.jours : []).map(Number);
  const paiements = logosPaiement(id);
  const partenaires = (id.partenaires || []).filter((x) => x?.logo_url).slice(0, 6);
  const photo = id.couverture_mini || id.couverture_url;
  racine.innerHTML = `
    ${enteteBoutique(b, id, { recherche: false })}
    <main class="vm-contenu">
      ${photo ? `<img class="vm-couverture" src="${esc(photo)}" alt="" width="1600" height="900" loading="lazy" decoding="async">` : ''}
      ${b.message ? `<p class="vm-message">${esc(b.message)}</p>` : ''}
      <section class="vm-carte-infos">
        ${[b.commune, b.ville].filter(Boolean).length ? `<div class="vm-info">${icone('lieu', 18)}<span>${esc([b.commune, b.ville].filter(Boolean).join(', '))}</span></div>` : ''}
        ${b.ouverture && b.fermeture ? `<div class="vm-horaires"><div class="vm-info">${icone('horloge', 18)}<strong>Horaires</strong></div>
          <ul>${[1, 2, 3, 4, 5, 6, 7].map((j) => `<li><span>${JOURS_LONGS[j]}</span><span>${jours.includes(j) || (j === 7 && jours.includes(0)) ? `${esc(heure(b.ouverture))} – ${esc(heure(b.fermeture))}` : 'Fermé'}</span></li>`).join('')}</ul></div>` : ''}
      </section>
      <div class="vm-actions-boutique">
        ${b.telephone ? `<a class="v-btn vm-btn-contour" href="tel:+${esc(String(b.telephone).replace(/\D/g, ''))}">${icone('telephone', 18)} Appeler</a>` : ''}
        ${b.whatsapp ? `<a class="v-btn v-btn-whatsapp" href="https://wa.me/${esc(String(b.whatsapp).replace(/\D/g, ''))}" target="_blank" rel="noopener">${icone('whatsapp', 18)} WhatsApp</a>` : ''}
        <button type="button" class="v-btn vm-btn-contour" data-action="partager">${icone('partager', 18)} Partager</button>
      </div>
      ${paiements.length ? `<div class="v-paiements"><span>Paiement à la réception :</span>${paiements.join('')}</div>` : ''}
      ${partenaires.length ? `<div class="v-partenaires" aria-label="Partenaires">${partenaires.map((x) => `<img src="${esc(x.logo_url)}" alt="${esc(x.nom || '')}" title="${esc(x.nom || '')}" height="28" loading="lazy" decoding="async">`).join('')}</div>` : ''}
      ${pied()}
    </main>
    ${flottant()}
    ${onglets('boutique')}`;
}

/** Après un changement de quantité : met à jour la carte concernée sans tout redessiner (garde le focus). */
function rafraichirProduit(cleLigne) {
  const id = idProduit(cleLigne);
  const p = s.produits.get(id);
  if (location.hash === '#panier') { renderLignesPanier(); renderTotaux(); majFlottant(); return; }
  racine.querySelectorAll(`[data-carte="${CSS.escape(id)}"]`).forEach((carte) => { if (p) carte.outerHTML = carteProduit(p); });
  majFlottant();
}

/* ------------------------------------------------------------ 3 — Le panier et la commande */

function renderPanier() {
  const { boutique: b, zones = [] } = s.donnees;
  if (!lignesPanier().length) {
    racine.innerHTML = `
      <header class="vm-entete-blanc"><a href="#" class="vm-retour" aria-label="Retour à l’accueil">${icone('retour', 22)}</a>
        <div class="vm-entete-blanc-textes"><h1>Votre panier</h1><span>${esc(b.nom)}</span></div></header>
      <main class="vm-contenu"><div class="vm-panier-vide">${icone('panier', 40, 1.6)}<p>Votre panier est vide.</p><a class="vm-btn-action" href="#">Voir les articles</a></div>${pied()}</main>
      ${onglets('panier')}`;
    return;
  }
  racine.innerHTML = `
    <header class="vm-entete-blanc"><a href="#" class="vm-retour" aria-label="Retour à la boutique">${icone('retour', 22)}</a>
      <div class="vm-entete-blanc-textes"><h1>Votre panier</h1><span>${esc(b.nom)}</span></div></header>
    <main class="vm-contenu vm-contenu-panier">
      <section class="v-carte v-lignes" aria-label="Articles" data-zone="lignes"></section>
      <section class="v-carte">
        <h2>Comment recevoir ?</h2>
        <div class="vm-receptions" role="radiogroup" aria-label="Mode de réception">
          ${zones.length ? `<button type="button" role="radio" class="vm-reception" data-reception="livraison" aria-checked="${s.reception === 'livraison'}">
            ${icone('camion', 22)}<strong>Livraison</strong><span data-ref="zone-choisie">${zoneChoisie() ? esc(zoneChoisie().nom) : 'Choisir la zone'}</span></button>` : ''}
          ${b.retrait ? `<button type="button" role="radio" class="vm-reception" data-reception="retrait" aria-checked="${s.reception === 'retrait'}">
            ${icone('magasin', 22)}<strong>Retrait</strong><span>Gratuit · en boutique</span></button>` : ''}
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
        <p class="v-aide">Vous payez <strong>à la livraison ou au retrait</strong>. La boutique vous appelle d’abord pour confirmer.</p>
      </section>
      <section class="vm-totaux" data-zone="totaux"></section>
      <p class="v-erreur" role="alert" hidden></p>
      <div class="vm-envoyer">
        <button type="button" class="vm-btn-envoyer" data-action="commander">Envoyer la commande</button>
        ${b.whatsapp ? `<button type="button" class="v-btn vm-btn-whatsapp-contour" data-action="commander-wa">${icone('whatsapp', 18)} Envoyer par WhatsApp</button>` : ''}
      </div>
      ${pied()}
    </main>
    ${onglets('panier')}`;
  renderLignesPanier();
  renderTotaux();
}

function renderLignesPanier() {
  const zone = racine.querySelector('[data-zone="lignes"]');
  if (!zone) return;
  const lignes = lignesPanier();
  if (!lignes.length) { renderPanier(); return; }
  zone.innerHTML = lignes.map(({ cle: cleLigne, produit: p, quantite, cas, prix, nom }) => {
    const rupture = cas ? !caseDispo(cas) : p.dispo === false;
    return `
    <div class="v-ligne ${rupture ? 'epuise' : ''}">
      <span class="vm-ligne-photo">${vignette(p, 22)}</span>
      <div class="v-ligne-textes">
        <span class="v-ligne-nom">${esc(nom)}</span>
        <span class="v-ligne-prix">${gnf(prix)} / ${esc(p.unite || 'unité')}${rupture ? ' · <strong>Rupture</strong>' : ''}</span>
      </div>
      ${stepper({ ...p, id: cleLigne, nom }, quantite, 'ligne')}
      <span class="v-ligne-total">${formatNombre(Math.round(prix * quantite))}</span>
    </div>`;
  }).join('');
}

function renderTotaux() {
  const zone = racine.querySelector('[data-zone="totaux"]');
  if (!zone) return;
  const articles = totalArticles();
  const z = s.reception === 'livraison' ? zoneChoisie() : null;
  const frais = z ? Number(z.frais) || 0 : 0;
  zone.innerHTML = `
    <div><span>Articles (${accord(nbArticles(), 'article')})</span><strong>${gnf(articles)}</strong></div>
    ${s.reception === 'livraison' ? `<div><span>Livraison${z ? ` · ${esc(z.nom)}` : ''}</span><strong>${z ? (frais ? gnf(frais) : 'Gratuit') : 'Zone à choisir'}</strong></div>` : '<div><span>Retrait en boutique</span><strong>Gratuit</strong></div>'}
    <div class="vm-total"><span>Total à payer</span><strong data-ref="total">${gnf(articles + frais)}</strong></div>`;
}

function erreurPanier(message, champ) {
  const el = racine.querySelector('.v-erreur');
  el.textContent = message || '';
  el.hidden = !message;
  if (champ) racine.querySelector(`[name="${champ}"]`)?.focus();
}

/** passer_commande_web (inchangé). viaWhatsApp : la commande est enregistrée puis WhatsApp s'ouvre avec le détail. */
async function commander(bouton, { viaWhatsApp = false } = {}) {
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
  const rupture = lignesPanier().find((l) => (l.cas ? !caseDispo(l.cas) : l.produit.dispo === false));
  if (rupture) return erreurPanier(`« ${rupture.nom} » est en rupture : retirez-le du panier.`);
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
      p_lignes: lignesPanier().map((l) => (l.cas ? { produit_id: l.produit.id, variante_id: l.cas.id, quantite: l.quantite } : { produit_id: l.produit.id, quantite: l.quantite }))
    });
    if (error) throw error;
    const r = (Array.isArray(data) ? data[0] : data) || {};
    s.commande = { ...r, whatsapp: r.whatsapp || s.donnees.boutique.whatsapp };
    s.panier.clear();
    s.client.note = '';
    memoriser();
    location.hash = 'commande';
    // WhatsApp ouvert tout de suite (souvent bloqué hors clic : le grand bouton de la confirmation reste affiché).
    if (viaWhatsApp) { try { window.open(lienCommande(), '_blank', 'noopener'); } catch { /* bouton */ } }
  } catch (err) {
    erreurPanier(messageErreur(err));
  } finally {
    s.envoi = false;
    if (bouton.isConnected) { bouton.disabled = false; bouton.innerHTML = libelle; }
  }
}

/* ------------------------------------------------------------ Fiche d'un modèle (tailles & couleurs) */

const choixFiche = { produit: null, couleur: null, taille: null };

function renderFicheModele(id) {
  const p = s.produits.get(id);
  const v = p.variantes;
  if (choixFiche.produit !== id) {
    const couleursDispo = couleursModele(p).filter((c) => v.cases.some((x) => x.c === c.nom && caseDispo(x)));
    Object.assign(choixFiche, { produit: id, couleur: (couleursDispo[0] || couleursModele(p)[0])?.nom ?? '', taille: null });
  }
  const couleurs = couleursModele(p);
  const tailles = (v.tailles || []).length ? v.tailles : [''];
  const avecTailles = tailles.length > 1 || Boolean(tailles[0]);
  if (!avecTailles) choixFiche.taille = tailles[0];
  const caseDe = (t, c) => v.cases.find((x) => (x.t || '') === t && (x.c || '') === (c || ''));
  const cas = choixFiche.taille === null ? null : caseDe(choixFiche.taille, choixFiche.couleur);
  const couleur = couleurs.find((c) => c.nom === choixFiche.couleur);
  const photo = couleur?.photo_url || p.photo_url || p.photo_mini_url;
  const prix = Number(cas?.prix ?? p.prix);
  const dernier = tailles.map((t) => caseDe(t, choixFiche.couleur)).find((c) => c && caseDispo(c) && c.dernier);
  const epuiseChoisi = cas && !caseDispo(cas);
  const libelleTaille = (t) => t || 'Unique';
  const whatsapp = s.donnees.boutique.whatsapp;
  const demande = epuiseChoisi && whatsapp
    ? `https://wa.me/${esc(String(whatsapp).replace(/\D/g, ''))}?text=${encodeURIComponent(`Bonjour, avez-vous ${p.nom} en ${libelleCase(cas)} ?`)}` : null;
  racine.innerHTML = `
    <header class="v-fiche-visuel">
      ${photo ? `<img src="${esc(photo)}" alt="${esc(p.nom)}${couleur ? ` ${esc(couleur.nom)}` : ''}" width="1080" height="1080" decoding="async">` : `<span class="v-fiche-sans-photo">${icone('stock', 64, 1.2)}</span>`}
      <a href="#" class="v-btn-retour v-fiche-retour" aria-label="Retour à la boutique">${icone('retour', 20)}</a>
    </header>
    <main class="vm-contenu v-fiche">
      <div class="v-fiche-titres"><h1>${esc(p.nom)}</h1>
        <span class="v-fiche-prix">${Number(p.prix_barre) > prix ? `<s>${formatNombre(p.prix_barre)}</s> ` : ''}${gnf(prix)}</span></div>
      ${couleurs.length ? `
        <div class="v-fiche-bloc"><span class="v-fiche-etiquette">Couleur : ${esc(choixFiche.couleur || '')}</span>
          <div class="v-fiche-couleurs" role="radiogroup" aria-label="Couleur">${couleurs.map((c) => {
            const aucune = !tailles.some((t) => caseDispo(caseDe(t, c.nom)));
            return `<button type="button" class="v-couleur ${c.nom === choixFiche.couleur ? 'actif' : ''} ${aucune ? 'vide' : ''}" role="radio" aria-checked="${c.nom === choixFiche.couleur}" aria-label="${esc(c.nom)}${aucune ? ' (épuisée)' : ''}" data-v-couleur="${esc(c.nom)}">${rond(c.hex, 40)}</button>`;
          }).join('')}</div></div>` : ''}
      ${avecTailles ? `
        <div class="v-fiche-bloc"><span class="v-fiche-etiquette">Taille</span>
          <div class="v-fiche-tailles" role="radiogroup" aria-label="Taille">${tailles.map((t) => {
            const c = caseDe(t, choixFiche.couleur);
            if (!c) return `<span class="v-taille absente" aria-hidden="true">${esc(libelleTaille(t))}</span>`;
            const epuisee = !caseDispo(c);
            return `<button type="button" class="v-taille ${t === choixFiche.taille ? 'actif' : ''} ${epuisee ? 'epuisee' : ''}" role="radio" aria-checked="${t === choixFiche.taille}" aria-label="${esc(libelleTaille(t))}${epuisee ? ' : épuisé' : ''}" data-v-taille="${esc(t)}">${esc(libelleTaille(t))}</button>`;
          }).join('')}</div>
          ${dernier ? `<span class="v-fiche-dernier">Plus qu’une pièce en ${esc(dernier.t || libelleCase(dernier))}.</span>` : ''}</div>` : ''}
      ${epuiseChoisi
        ? (demande ? `<a class="v-btn v-btn-contour-whatsapp v-btn-grand" href="${demande}" target="_blank" rel="noopener">${icone('whatsapp', 18)} ${esc(libelleTaille(cas.t))} épuisé ? Demander sur WhatsApp</a>` : `<p class="v-aide">${esc(libelleCase(cas))} est épuisé.</p>`)
        : `<button type="button" class="vm-btn-envoyer" data-action="ajouter-variante" ${cas ? '' : 'disabled'}>${cas ? `Ajouter au panier${cas.t ? ` · ${esc(cas.t)}` : ''}` : 'Choisissez la taille'}</button>`}
    </main>
    ${flottant()}
    ${onglets('rayons')}`;
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
      <p>Total : <strong>${gnf(c.total)}</strong>. La boutique vous appelle pour confirmer. Vous pouvez aussi lui envoyer le détail sur WhatsApp.</p>
      <a class="v-btn v-btn-whatsapp v-btn-grand" href="${esc(lienCommande())}" target="_blank" rel="noopener">${icone('whatsapp', 20)} Envoyer sur WhatsApp</a>
      <a class="v-btn v-btn-secondaire" href="#">Retour à la boutique</a>
    </main>
    ${pied()}
    ${onglets('panier')}`;
}

/* ------------------------------------------------------------ Évènements */

racine.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="partager"]')) { partager(); return; }
  const vc = e.target.closest('[data-v-couleur]');
  if (vc) { choixFiche.couleur = vc.dataset.vCouleur; const p = s.produits.get(choixFiche.produit); if (choixFiche.taille !== null && !(p.variantes.tailles || []).length) choixFiche.taille = ''; renderFicheModele(choixFiche.produit); return; }
  const vt = e.target.closest('[data-v-taille]');
  if (vt) { choixFiche.taille = vt.dataset.vTaille; renderFicheModele(choixFiche.produit); return; }
  if (e.target.closest('[data-action="ajouter-variante"]')) {
    const p = s.produits.get(choixFiche.produit);
    const cas = p?.variantes.cases.find((x) => (x.t || '') === (choixFiche.taille ?? '') && (x.c || '') === (choixFiche.couleur || ''));
    if (!cas || !caseDispo(cas)) return;
    const cleLigne = `${p.id}|${cas.id}`;
    changerQuantite(cleLigne, (s.panier.get(cleLigne) || 0) + 1);
    toast(`${p.nom} — ${libelleCase(cas)} ajouté au panier.`, 'succes');
    majFlottant();
    return;
  }
  const ajouter = e.target.closest('[data-ajouter]');
  if (ajouter) {
    const id = ajouter.dataset.ajouter;
    const p = s.produits.get(id);
    if (!p || enRupture(p)) return;
    if (aVariantes(p)) { location.hash = `p/${encodeURIComponent(id)}`; return; }
    changerQuantite(id, (s.panier.get(id) || 0) + 1);
    if (ajouter.hasAttribute('data-banniere')) toast(`${p.nom} ajouté au panier.`, 'succes');
    rafraichirProduit(id);
    return;
  }
  const plus = e.target.closest('[data-plus]');
  const moins = e.target.closest('[data-moins]');
  if (plus || moins) {
    const id = (plus || moins).dataset.plus || (moins || plus).dataset.moins;
    const actuelle = s.panier.get(id) || 0;
    const p = s.produits.get(idProduit(id));
    let n = plus ? Math.floor(actuelle + 1) : Math.ceil(actuelle - 1);
    if (moins && divisible(p?.unite) && actuelle % 1) n = Math.floor(actuelle);
    changerQuantite(id, Math.max(0, n));
    rafraichirProduit(id);
    return;
  }
  const filtre = e.target.closest('[data-filtre]');
  if (filtre) { s.filtre = filtre.dataset.filtre; renderRayon(decodeURIComponent(location.hash.replace('#r/', ''))); return; }
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
  if (e.target.closest('[data-action="commander"]')) { commander(e.target.closest('button')); return; }
  if (e.target.closest('[data-action="commander-wa"]')) commander(e.target.closest('button'), { viaWhatsApp: true });
});

racine.addEventListener('input', (e) => {
  if (e.target.id === 'v-recherche') { s.recherche = e.target.value; renderListeAccueil(); return; }
  const form = e.target.closest('#v-form');
  if (form && e.target.name in s.client) { s.client[e.target.name] = e.target.value; memoriser(); }
});

racine.addEventListener('change', (e) => {
  if (e.target.name === 'zone') {
    s.zone = e.target.value;
    const b = racine.querySelector('[data-ref="zone-choisie"]');
    if (b) b.textContent = zoneChoisie()?.nom || 'Choisir la zone';
    memoriser();
    renderTotaux();
    erreurPanier('');
    return;
  }
  const champ = e.target.closest('[data-quantite]');
  if (champ) {
    const id = champ.dataset.quantite;
    const p = s.produits.get(idProduit(id));
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
