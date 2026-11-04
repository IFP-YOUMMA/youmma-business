/**
 * marche-client.js — Page publique a/ du marché (étape 21, maquettes MARCHE_MODERNE et MarcheCommande), sans compte.
 * Pensée pour le téléphone : c'est là qu'arrivent les gens, depuis un lien WhatsApp.
 *
 *  - Accueil : en-tête (logo, nom, « Dakar → Conakry · vous payez ici », recherche), la bannière du corridor (un
 *    chiffre calculé par la base avec simuler_prix, le prochain départ, « Calculer mon prix » → simulateur s/), les
 *    rayons (catégories réelles des articles), nos vendeurs, les plus demandés (TOP, GNF et FCFA), puis le bandeau
 *    « Vous ne payez rien à Dakar » ;
 *  - Rayons, Panier (la commande : creer_commande_marche, seule porte d'entrée), Mon compte (sans mot de passe) ;
 *  - barre du bas fixe à quatre onglets ; a/?c=<jeton> : le suivi d'une commande, sans commission ni reversement.
 * Les prix du panier ne sont qu'un brouillon : après création, la page affiche les montants renvoyés par la base.
 * Jamais de paiement en ligne, jamais de coordonnées du vendeur, jamais le téléphone d'un client venu de la base.
 * Aucune invitation à installer à l'ouverture ; seulement après une commande confirmée (installation.js).
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { normaliserTelephone, formatTelephone } from './lib/telephone.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'yb-marche' }
});
const parametres = new URLSearchParams(location.search);
const slug = (parametres.get('s') || location.pathname.match(/\/a\/([A-Za-z0-9-]{3,60})\/?$/)?.[1] || '').trim().toLowerCase();
const jetonSuivi = (parametres.get('c') || '').trim();
const racine = document.getElementById('marche');

/* ------------------------------------------------------------ Outils */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nombre = (n, dec = 0) => (Number(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: dec }).replace(/[  ]/g, ' ');
const nomDevise = (d) => (d === 'XOF' ? 'FCFA' : d || '');
const montant = (n, d) => `${nombre(n)} ${nomDevise(d)}`.trim();
const premiere = (d) => (Array.isArray(d) ? d[0] : d) ?? null;
/** Téléphone lisible : Guinée « +224 620 88 88 88 », Sénégal « +221 77 123 45 67 » ; autre pays, groupé à partir de l’indicatif. */
const telephone = (t) => { if (normaliserTelephone(t)) return formatTelephone(t); const c = String(t || '').replace(/\D/g, ''); return c.length > 9 ? `+${c.slice(0, 3)} ${c.slice(3, 6)} ${c.slice(6).replace(/(\d{2})(?=\d)/g, '$1 ')}` : String(t || ''); };
/** Le téléphone de la personne, enregistré sur cet appareil : seuls les 4 derniers chiffres s'affichent. */
const masque = (t) => { const c = String(t || '').replace(/\D/g, ''); return c ? `•• •• ${c.slice(-4, -2)} ${c.slice(-2)}` : ''; };
const initiales = (n) => String(n || '').split(/\s+/).filter((m) => /\p{L}/u.test(m)).slice(0, 2).map((m) => m[0]).join('').toUpperCase();
const jourLong = (iso) => { try { return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${String(iso).slice(0, 10)}T12:00:00Z`)); } catch { return ''; } };
const ICONES = {
  panier: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
  recherche: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  retour: '<path d="M15 18l-6-6 6-6"/>',
  maison: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  rayons: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  compte: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  calcul: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M8 16h2M12 16h2"/>',
  liste: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  colis: '<path d="m12 3 9 5v8l-9 5-9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  lieu: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  aide: '<path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1 1 21 12z"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>'
};
const ico = (n, cls = 'mk-ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[n]}</svg>`;
function toast(texte) {
  const z = document.getElementById('mk-toasts');
  const t = document.createElement('div');
  t.className = 'mk-toast';
  t.textContent = texte;
  z.append(t);
  setTimeout(() => t.remove(), 3500);
}
async function rpc(nom, params) {
  const { data, error } = await sb.rpc(nom, params);
  if (error) throw error;
  return data;
}
const lireLocal = (cle, defaut) => { try { const v = localStorage.getItem(cle); return v ? JSON.parse(v) : defaut; } catch { return defaut; } };
const ecrireLocal = (cle, v) => { try { localStorage.setItem(cle, JSON.stringify(v)); } catch { /* stockage refusé */ } };

/** Erreurs de la base, en français clair pour le client. */
const ERREURS = {
  BOUTIQUE_INTROUVABLE: 'Ce marché n’existe pas ou n’est plus ouvert.',
  'MODULE_INACTIF: marche': 'Ce marché est fermé pour le moment.',
  NOM_REQUIS: 'Écrivez votre nom.',
  TELEPHONE_REQUIS: 'Écrivez votre numéro de téléphone : le bureau vous appelle quand la marchandise arrive.',
  PANIER_VIDE: 'Votre panier est vide.',
  PANIER_TROP_GRAND: 'Votre panier contient trop d’articles : faites deux commandes.',
  AGENCE_INTROUVABLE: 'Choisissez le bureau où vous retirerez votre colis.',
  ARTICLE_INDISPONIBLE: 'Un article de votre panier n’est plus disponible. Retirez-le et réessayez.',
  FOURNISSEUR_INACTIF: 'Un des vendeurs de votre panier ne vend plus pour le moment. Retirez ses articles et réessayez.',
  QUANTITE_INVALIDE: 'Une quantité n’est pas valable.'
};
function messageErreur(err) {
  const brut = String(err?.message || err || '');
  const cle = Object.keys(ERREURS).sort((a, b) => b.length - a.length).find((c) => brut.includes(c));
  if (cle) return ERREURS[cle];
  if (/Failed to fetch|NetworkError|network/i.test(brut)) return 'Pas de connexion. Vérifiez votre réseau et réessayez.';
  return 'Une erreur est survenue. Réessayez dans un instant.';
}

/* ------------------------------------------------------------ État */

const s = {
  donnees: null, tous: [], corridors: [], articles: new Map(), panier: new Map(), retrait: null,
  transport: null, jetonTransport: 0, banniere: null,
  onglet: 'accueil', rayon: null, filtre: null
};
const clePanier = `yb_marche_panier_${slug}`;
const cleCommandes = `yb_marche_commandes_${slug}`;
const cleInfos = 'yb_marche_infos';
function lirePanier() { Object.entries(lireLocal(clePanier, {})).forEach(([id, q]) => { if (Number(q) > 0) s.panier.set(id, Number(q)); }); }
const ecrirePanier = () => ecrireLocal(clePanier, Object.fromEntries(s.panier));
const nbArticles = () => [...s.panier.values()].reduce((t, q) => t + q, 0);
const lignesPanier = () => [...s.panier.entries()].map(([id, q]) => ({ a: s.articles.get(id), q })).filter((x) => x.a);
/** Brouillon : la somme des prix client renvoyés par la base, seulement pour l'affichage avant confirmation. */
const totalBrouillon = () => lignesPanier().reduce((t, { a, q }) => t + (Number(a.prix_client) || 0) * q, 0);
const deviseClient = () => (s.donnees?.taux || []).find((t) => t.de === 'XOF')?.vers || 'GNF';

/** Bureaux de retrait : ceux de la réponse du marché s'il y en a, sinon les arrivées des corridors publics. */
function bureaux() {
  const e = s.donnees?.espace || {};
  const liste = e.agences || e.retraits || e.bureaux;
  if (Array.isArray(liste) && liste.length && liste[0].id) return liste.map((b) => ({ id: b.id, nom: b.nom || b.ville, ville: b.ville, adresse: b.adresse, horaires: b.horaires }));
  const vus = new Map();
  s.corridors.forEach((c) => { if (c.arrivee && !vus.has(c.arrivee)) vus.set(c.arrivee, { id: c.arrivee, nom: c.vers, ville: c.vers }); });
  return [...vus.values()];
}
const villeRetrait = () => bureaux().find((b) => b.id === s.retrait)?.ville || bureaux()[0]?.ville || 'Conakry';
const villeVendeurs = () => {
  const villes = (s.donnees?.fournisseurs || []).map((f) => f.ville).filter(Boolean);
  return villes.sort((a, b) => villes.filter((v) => v === b).length - villes.filter((v) => v === a).length)[0] || 'Dakar';
};
/** Rayons : les catégories réelles des articles, dans l'ordre où elles apparaissent (jamais une liste écrite ici). */
function rayons() {
  const m = new Map();
  s.tous.forEach((a) => { const c = a.categorie || 'Autres'; m.set(c, (m.get(c) || 0) + 1); });
  return [...m.entries()].map(([nom, n]) => ({ nom, n }));
}
const TEINTES = ['#0F7B5F', '#C2410C', '#1F3A5F', '#5B2A8C', '#B45309', '#0E7490', '#9F1239', '#3F6212'];
const teinte = (texte) => TEINTES[[...String(texte)].reduce((t, c) => t + c.codePointAt(0), 0) % TEINTES.length];

/* ------------------------------------------------------------ Le corridor et le transport (calculés par la base) */

function corridorPrincipal() {
  const ville = villeVendeurs();
  const vers = s.corridors.filter((c) => c.ville === ville && (!s.retrait || c.arrivee === s.retrait));
  return vers.find((c) => c.mode === 'route') || vers[0] || s.corridors[0] || null;
}
async function simuler(c, poids) {
  const r = premiere(await rpc('simuler_prix', { p_slug: slug, p_depart: c.depart, p_arrivee: c.arrivee, p_mode: c.mode, p_poids: poids, p_longueur: null, p_largeur: null, p_hauteur: null, p_nb: 1 }));
  return r && !r.introuvable ? r : null;
}
/** Bannière : le prix d'un colis de 10 kg sur le corridor principal, en GNF et en FCFA, tel que la base le calcule. */
async function chargerBanniere() {
  const c = corridorPrincipal();
  if (!c) return;
  const poids = Math.max(10, Number(c.minimum_kg) || 0);
  try { const r = await simuler(c, poids); s.banniere = { c, poids, r }; } catch { s.banniere = { c, poids, r: null }; }
  const z = racine.querySelector('[data-ref="banniere"]');
  if (z) z.outerHTML = banniereHTML();
}
async function estimerTransport() {
  const lignes = lignesPanier();
  const jeton = ++s.jetonTransport;
  const poids = lignes.reduce((t, { a, q }) => t + (Number(a.poids_kg) || 0) * q, 0);
  const c = corridorPrincipal();
  if (!lignes.length || !c || !(poids > 0)) { s.transport = null; majTransport(); return; }
  try {
    const r = await simuler(c, Math.round(poids * 100) / 100);
    if (jeton !== s.jetonTransport) return;
    s.transport = r ? {
      montant: r.total_arrivee ?? r.total, devise: r.total_arrivee !== undefined && r.total_arrivee !== null ? r.devise_arrivee : r.devise,
      local: r.total, deviseLocale: r.devise, poids, mode: c.mode, incomplet: lignes.some(({ a }) => !Number(a.poids_kg))
    } : null;
  } catch { if (jeton === s.jetonTransport) s.transport = null; }
  majTransport();
}
const texteTransport = () => (s.transport
  ? `+ transport estimé ${montant(s.transport.montant, s.transport.devise)}, payé au retrait`
  : '+ transport, payé au retrait (estimé à la commande)');
function majTransport() {
  racine.querySelectorAll('[data-ref="transport"]').forEach((z) => { z.textContent = texteTransport(); });
  const bloc = racine.querySelector('[data-ref="transport-bloc"]');
  if (bloc) bloc.innerHTML = blocTransport();
}
function blocTransport() {
  const t = s.transport;
  return `
    <div class="mk-total"><strong>Le transport</strong><strong class="num">${t ? esc(montant(t.montant, t.devise)) : '—'}</strong></div>
    ${t && t.deviseLocale !== t.devise ? `<div class="mk-total mk-local"><span>soit</span><span class="num">${esc(montant(t.local, t.deviseLocale))}</span></div>` : ''}
    <p>${t ? `Estimé : ${esc(nombre(t.poids, 2))} kg par ${t.mode === 'route' ? 'la route' : t.mode === 'avion' ? 'avion' : esc(t.mode)}${t.incomplet ? ' (certains articles n’ont pas de poids annoncé)' : ''}. ` : ''}<strong>Payé au retrait</strong>, à ${esc(villeRetrait())}. Le montant exact est calculé à la pesée : si le colis est plus léger, vous payez moins.</p>`;
}

/* ------------------------------------------------------------ Chargement */

async function chargerCatalogue() {
  const d = premiere(await rpc('marche_public', { p_slug: slug, p_fournisseur: null, p_recherche: null }));
  if (!d || d.introuvable) return false;
  s.donnees = d;
  s.tous = d.articles || [];
  s.tous.forEach((a) => s.articles.set(a.id, a));
  return true;
}
/** Recherche : la base filtre (marche_public p_recherche). */
async function chercher(texte) {
  const d = premiere(await rpc('marche_public', { p_slug: slug, p_fournisseur: null, p_recherche: texte || null }));
  (d?.articles || []).forEach((a) => s.articles.set(a.id, a));
  return d?.articles || [];
}

/* ------------------------------------------------------------ Morceaux communs */

const lienSimulateur = () => `../s/?s=${encodeURIComponent(slug)}`;
function carteArticle(a) {
  const q = s.panier.get(a.id) || 0;
  const photo = a.photo_mini_url || a.photo_url;
  return `
    <article class="mk-article" data-article="${esc(a.id)}">
      <div class="mk-photo">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" decoding="async">` : `<span class="mk-photo-vide">${esc(a.categorie || '')}</span>`}${a.mis_en_avant ? '<span class="mk-top">TOP</span>' : ''}</div>
      <div class="mk-article-corps">
        <strong>${esc(a.nom)}</strong>
        <span class="mk-de">${esc(a.fournisseur || '')}</span>
        <span class="mk-prix num">${esc(montant(a.prix_client, deviseClient()))}</span>
        <span class="mk-prix-local num">${esc(montant(a.prix, a.devise))} à ${esc(a.ville || villeVendeurs())}</span>
        ${q ? `<div class="mk-quantite"><button type="button" data-moins="${esc(a.id)}" aria-label="Retirer un">−</button><strong class="num">${nombre(q)}</strong><button type="button" data-plus="${esc(a.id)}" aria-label="Ajouter un">+</button></div>`
          : `<button type="button" class="mk-ajouter" data-plus="${esc(a.id)}" aria-label="Ajouter ${esc(a.nom)} au panier">+ Ajouter</button>`}
      </div>
    </article>`;
}
function barrePanier() {
  if (!nbArticles()) return '';
  return `
    <div class="mk-flottant" data-ref="flottant"><div class="mk-flottant-int">
      <div class="mk-flottant-textes">
        <strong class="num">${nombre(nbArticles())} article${nbArticles() > 1 ? 's' : ''} · ${esc(montant(totalBrouillon(), deviseClient()))}</strong>
        <span data-ref="transport">${esc(texteTransport())}</span>
      </div>
      <button type="button" class="mk-bouton" data-onglet="panier">Commander</button>
    </div></div>`;
}
function onglets() {
  const n = nbArticles();
  const o = [['accueil', 'Accueil', 'maison'], ['rayons', 'Rayons', 'rayons'], ['panier', 'Panier', 'panier'], ['compte', 'Mon compte', 'compte']];
  return `<nav class="mk-onglets" aria-label="Marché">${o.map(([c, l, i]) => `
    <button type="button" class="mk-onglet ${s.onglet === c || (c === 'rayons' && s.onglet === 'rayon') ? 'actif' : ''}" data-onglet="${c}" ${s.onglet === c ? 'aria-current="page"' : ''}>
      <span class="mk-onglet-ico">${ico(i)}${c === 'panier' && n ? `<b class="num" data-ref="compte-panier">${nombre(n)}</b>` : ''}</span>${l}</button>`).join('')}</nav>`;
}
function banniereHTML() {
  const b = s.banniere;
  const c = b?.c || corridorPrincipal();
  if (!c) return '<section class="mk-banniere" data-ref="banniere"><p class="mk-banniere-sous">Le prix du transport est calculé à la pesée.</p></section>';
  const r = b?.r;
  return `
    <section class="mk-banniere" data-ref="banniere" aria-label="Tarif du transport">
      <span class="mk-banniere-etiq">${esc(c.drapeau || '')} ${esc(c.ville)} → ${esc(c.vers)} · ${c.mode === 'route' ? 'par la route' : c.mode === 'avion' ? 'par avion' : esc(c.mode)}</span>
      ${r ? `<strong class="mk-banniere-prix num">${esc(montant(r.total_arrivee ?? r.total, r.total_arrivee !== undefined && r.total_arrivee !== null ? r.devise_arrivee : r.devise))}</strong>
        <span class="mk-banniere-sous num">le colis de ${nombre(b.poids)} kg · ${esc(montant(r.total, r.devise))} · soit ${esc(montant(c.prix_kg, c.devise))} le kilo</span>`
        : `<strong class="mk-banniere-prix num">${esc(montant(c.prix_kg, c.devise))}</strong><span class="mk-banniere-sous">le kilo${c.minimum_kg ? ` · minimum ${nombre(c.minimum_kg)} kg` : ''}</span>`}
      ${c.prochain_depart ? `<span class="mk-banniere-depart">Prochain départ : <strong>${esc(jourLong(c.prochain_depart))}</strong>${c.delai_jours ? ` · arrivée en ${nombre(c.delai_jours)} jours environ` : ''}</span>` : ''}
      <a class="mk-bouton-or" href="${esc(lienSimulateur())}">${ico('calcul')} Calculer mon prix</a>
    </section>`;
}
function bandeau() {
  return `<div class="mk-bandeau" role="note"><strong>Vous ne payez rien à ${esc(villeVendeurs())}.</strong><span>Vous versez au bureau de ${esc(villeRetrait())}, nous payons le vendeur, et vous réglez le transport seulement au retrait, après la pesée.</span></div>`;
}

/* ------------------------------------------------------------ Écran 1 : l'accueil */

function rendreAccueil() {
  const d = s.donnees;
  const e = d.entreprise || {};
  const top = [...s.tous].sort((a, b) => Number(Boolean(b.mis_en_avant)) - Number(Boolean(a.mis_en_avant))).slice(0, 8);
  const taux = (d.taux || []).find((t) => t.de === 'XOF');
  racine.innerHTML = `
    <header class="mk-entete">
      <div class="mk-entete-haut">
        <span class="mk-logo">${e.logo_url ? `<img src="${esc(e.logo_url)}" alt="" width="40" height="40">` : esc(initiales(e.nom))}</span>
        <div class="mk-entete-titres"><h1>${esc(e.nom || 'Le marché')}</h1><span>${esc(villeVendeurs())} → ${esc(villeRetrait())} · vous payez ici</span></div>
      </div>
      <form class="mk-recherche" data-ref="form-recherche" role="search">${ico('recherche')}<label class="mk-sr" for="mk-q">Rechercher</label><input id="mk-q" name="q" type="search" placeholder="Tissu, téléphone, cosmétique…" autocomplete="off"></form>
    </header>
    ${banniereHTML()}
    <div class="mk-corps">
      ${rayons().length ? `<section><div class="mk-section-tete"><h2>Les rayons</h2><button type="button" class="mk-lien" data-onglet="rayons">Tout voir</button></div>
        <div class="mk-rayons">${rayons().map((r) => `<button type="button" class="mk-rayon" data-rayon="${esc(r.nom)}"><span class="mk-rond" style="--teinte:${teinte(r.nom)}">${esc(r.nom.charAt(0).toUpperCase())}</span><span>${esc(r.nom)}</span></button>`).join('')}</div></section>` : ''}
      ${(d.fournisseurs || []).length ? `<section><div class="mk-section-tete"><h2>Nos vendeurs à ${esc(villeVendeurs())}</h2><span>${nombre(d.fournisseurs.length)}</span></div>
        <div class="mk-vendeurs">${d.fournisseurs.map((f) => `
          <button type="button" class="mk-vendeur" data-vendeur="${esc(f.slug)}">
            <span class="mk-vendeur-logo" style="--teinte:${teinte(f.nom)}">${f.logo_url ? `<img src="${esc(f.logo_url)}" alt="" width="52" height="52">` : esc(initiales(f.nom))}</span>
            <strong>${esc(f.nom)}</strong><span>${esc(f.specialite || '')}</span>
            <span class="mk-vendeur-pied">${esc(f.drapeau || '')} ${esc(f.ville || '')} · ${nombre(f.articles)} article${Number(f.articles) > 1 ? 's' : ''}</span>
            ${f.delai_jours !== null && f.delai_jours !== undefined ? `<span class="mk-prepare">${Number(f.delai_jours) === 0 ? 'Prépare le jour même' : `Prépare en ${nombre(f.delai_jours)} j`}</span>` : ''}
          </button>`).join('')}</div></section>` : ''}
      <section><div class="mk-section-tete"><h2>Les plus demandés</h2>${taux ? `<span class="num">1 F = ${esc(nombre(taux.taux, 2))} ${esc(nomDevise(taux.vers))}</span>` : ''}</div>
        ${top.length ? `<div class="mk-grille">${top.map(carteArticle).join('')}</div>` : '<p class="mk-vide">Les articles arrivent bientôt.</p>'}</section>
      ${bandeau()}
      <p class="mk-pied">Marché propulsé par <strong>YOUMMA Business</strong></p>
    </div>
    ${barrePanier()}
    ${onglets()}`;
}

/* ------------------------------------------------------------ Écran 2 : un rayon (ou un vendeur, ou une recherche) */

async function rendreRayon() {
  const ctx = s.rayon || {};
  let liste = s.tous;
  if (ctx.recherche) { try { liste = await chercher(ctx.recherche); } catch (err) { toast(messageErreur(err)); liste = []; } }
  else if (ctx.categorie) liste = s.tous.filter((a) => (a.categorie || 'Autres') === ctx.categorie);
  else if (ctx.vendeur) liste = s.tous.filter((a) => a.fournisseur_slug === ctx.vendeur);
  const vendeurs = [...new Map(liste.map((a) => [a.fournisseur_slug, a.fournisseur])).entries()];
  const prix = liste.map((a) => Number(a.prix_client) || 0).sort((x, y) => x - y);
  // Tranches de prix tirées des articles affichés (tiers), jamais des seuils écrits à l'avance.
  const tranches = prix.length >= 3 ? [prix[Math.floor(prix.length / 3)], prix[Math.floor((2 * prix.length) / 3)]] : [];
  const f = s.filtre;
  const visibles = liste.filter((a) => {
    if (!f) return true;
    if (f.vendeur) return a.fournisseur_slug === f.vendeur;
    const p = Number(a.prix_client) || 0;
    if (f.tranche === 0) return p <= tranches[0];
    if (f.tranche === 1) return p > tranches[0] && p <= tranches[1];
    if (f.tranche === 2) return p > tranches[1];
    return true;
  });
  const titre = ctx.recherche ? `« ${ctx.recherche} »` : ctx.categorie || (ctx.vendeur ? (s.donnees.fournisseurs || []).find((x) => x.slug === ctx.vendeur)?.nom : 'Tous les articles') || 'Articles';
  racine.innerHTML = `
    <header class="mk-entete-blanc">
      <button type="button" class="mk-retour" data-onglet="${ctx.depuisRayons ? 'rayons' : 'accueil'}" aria-label="Retour">${ico('retour')}</button>
      <div class="mk-entete-titres"><h1>${esc(titre)}</h1><span class="num">${nombre(liste.length)} article${liste.length > 1 ? 's' : ''} · ${nombre(vendeurs.length)} vendeur${vendeurs.length > 1 ? 's' : ''}</span></div>
    </header>
    <div class="mk-corps">
      <div class="mk-pastilles" role="group" aria-label="Filtres">
        <button type="button" class="mk-pastille ${!f ? 'actif' : ''}" data-filtre="tous">Tous</button>
        ${!ctx.vendeur && vendeurs.length > 1 ? vendeurs.map(([sl, nom]) => `<button type="button" class="mk-pastille ${f?.vendeur === sl ? 'actif' : ''}" data-filtre-vendeur="${esc(sl)}">${esc(nom)}</button>`).join('') : ''}
        ${tranches.length ? [`Jusqu’à ${montant(tranches[0], deviseClient())}`, `${montant(tranches[0], deviseClient())} – ${montant(tranches[1], deviseClient())}`, `Plus de ${montant(tranches[1], deviseClient())}`]
          .map((l, i) => `<button type="button" class="mk-pastille ${f?.tranche === i ? 'actif' : ''}" data-filtre-tranche="${i}">${esc(l)}</button>`).join('') : ''}
      </div>
      ${visibles.length ? `<div class="mk-grille">${visibles.map(carteArticle).join('')}</div>` : '<p class="mk-vide">Aucun article ne correspond.</p>'}
    </div>
    ${barrePanier()}
    ${onglets()}`;
}

/* ------------------------------------------------------------ Onglet Rayons */

function rendreRayons() {
  racine.innerHTML = `
    <header class="mk-entete-blanc"><div class="mk-entete-titres"><h1>Les rayons</h1><span class="num">${nombre(s.tous.length)} articles · ${nombre((s.donnees.fournisseurs || []).length)} vendeurs</span></div></header>
    <div class="mk-corps">
      <button type="button" class="mk-ligne-rayon" data-rayon-tous><span class="mk-rond" style="--teinte:#0A3D33">★</span><span><strong>Tous les articles</strong><span class="num">${nombre(s.tous.length)}</span></span>${ico('chevron')}</button>
      ${rayons().map((r) => `<button type="button" class="mk-ligne-rayon" data-rayon="${esc(r.nom)}" data-depuis-rayons="1"><span class="mk-rond" style="--teinte:${teinte(r.nom)}">${esc(r.nom.charAt(0).toUpperCase())}</span><span><strong>${esc(r.nom)}</strong><span class="num">${nombre(r.n)} article${r.n > 1 ? 's' : ''}</span></span>${ico('chevron')}</button>`).join('')}
    </div>
    ${barrePanier()}
    ${onglets()}`;
}

/* ------------------------------------------------------------ Onglet Panier : la commande */

function rendrePanier(erreur = '') {
  const lignes = lignesPanier();
  const liste = bureaux();
  const infos = lireLocal(cleInfos, {});
  if (!s.retrait && liste.length) s.retrait = (liste.find((b) => b.id === infos.retrait) || liste[0]).id;
  racine.innerHTML = `
    <header class="mk-entete-blanc"><div class="mk-entete-titres"><h1>Votre panier</h1><span>Retrait et paiement à ${esc(villeRetrait())}</span></div></header>
    <div class="mk-corps">
      ${!lignes.length ? '<div class="mk-vide-bloc"><p class="mk-vide">Votre panier est vide.</p><button type="button" class="mk-bouton" data-onglet="accueil">Voir les articles</button></div>' : `
      <section class="mk-carte">
        ${lignes.map(({ a, q }) => `
          <div class="mk-ligne">
            <strong>${esc(a.nom)}</strong><span class="num fort">${esc(montant((Number(a.prix_client) || 0) * q, deviseClient()))}</span>
            <span>${esc(a.fournisseur || '')} · ${esc(montant(a.prix, a.devise))} l’unité à ${esc(a.ville || villeVendeurs())}</span><span></span>
            <div class="mk-quantite"><button type="button" data-moins="${esc(a.id)}" aria-label="Retirer un">−</button><strong class="num">${nombre(q)}</strong><button type="button" data-plus="${esc(a.id)}" aria-label="Ajouter un">+</button></div>
          </div>`).join('')}
        <div class="mk-total fort"><span>À verser au bureau</span><span class="num">${esc(montant(totalBrouillon(), deviseClient()))}</span></div>
        <p class="mk-note">Le transport n’est pas compris : il est estimé ci-dessous et payé au retrait, après la pesée.</p>
      </section>
      <section class="mk-carte mk-transport" data-ref="transport-bloc">${blocTransport()}</section>
      <section class="mk-carte">
        <h2>Ce qui va se passer</h2>
        <ol class="mk-etapes">
          <li><div><strong>Vous versez au bureau de ${esc(villeRetrait())}</strong><span>Le prix de la marchandise, rien de plus. Vous repartez avec un reçu.</span></div></li>
          <li><div><strong>Nous payons le vendeur à ${esc(villeVendeurs())}</strong><span>Notre bureau le règle et récupère la marchandise. Vous ne payez rien à ${esc(villeVendeurs())}.</span></div></li>
          <li><div><strong>La marchandise part</strong><span>Pesée, photographiée, mise dans le prochain départ.</span></div></li>
          <li><div><strong>Vous retirez à ${esc(villeRetrait())}</strong><span>Vous payez le transport, calculé à la pesée, et vous repartez avec votre colis.</span></div></li>
        </ol>
      </section>
      <form class="mk-carte mk-form" novalidate>
        <h2>Vos coordonnées</h2>
        ${erreur ? `<div class="mk-erreur" role="alert">${esc(erreur)}</div>` : ''}
        <label for="mk-nom">Votre nom<input id="mk-nom" name="nom" autocomplete="name" maxlength="80" required value="${esc(infos.nom || '')}"></label>
        <label for="mk-tel">Votre téléphone<input id="mk-tel" name="tel" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="620 00 00 00" required value="${esc(infos.tel || '')}"></label>
        <label for="mk-retrait">Bureau de retrait<select id="mk-retrait" name="retrait">${liste.map((b) => `<option value="${esc(b.id)}" ${b.id === s.retrait ? 'selected' : ''}>${esc(b.nom)}</option>`).join('')}</select></label>
        <label for="mk-note">Une précision pour le bureau (facultatif)<textarea id="mk-note" name="note" maxlength="300" placeholder="Taille, couleur…"></textarea></label>
        <button type="submit" class="mk-bouton bloc">Confirmer la commande</button>
        <p class="mk-note">Aucun paiement en ligne : vous payez au bureau, sur présentation de votre code.</p>
      </form>`}
    </div>
    ${onglets()}`;
  if (lignes.length) estimerTransport();
}

async function confirmer(form) {
  const bouton = form.querySelector('[type=submit]');
  const brouillon = totalBrouillon();
  bouton.disabled = true;
  bouton.textContent = 'Enregistrement…';
  try {
    const cree = premiere(await rpc('creer_commande_marche', {
      p_slug: slug, p_client_nom: form.nom.value.trim(), p_client_tel: form.tel.value.trim(), p_agence_retrait: form.retrait.value || null,
      p_lignes: lignesPanier().map(({ a, q }) => ({ article_id: a.id, quantite: q })), p_note: form.note.value.trim() || null
    }));
    // La commande telle que la base l'a enregistrée (prix relus en base) : par son jeton si la réponse en donne un.
    const jeton = cree?.jeton || cree?.jeton_suivi || null;
    const c = jeton ? (premiere(await rpc('commande_marche', { p_jeton: jeton }).catch(() => null)) || cree) : cree;
    // Sur cet appareil seulement : de quoi préremplir la prochaine commande et retrouver ses commandes.
    ecrireLocal(cleInfos, { ...lireLocal(cleInfos, {}), nom: form.nom.value.trim(), tel: form.tel.value.trim(), retrait: form.retrait.value });
    if (jeton) ecrireLocal(cleCommandes, [{ code: cree.code || c?.code, jeton, le: new Date().toISOString() }, ...lireLocal(cleCommandes, []).filter((x) => x.jeton !== jeton)].slice(0, 20));
    s.panier.clear();
    ecrirePanier();
    rendreConfirmation(c && !c.introuvable ? { ...cree, ...c } : cree, jeton, brouillon);
  } catch (err) {
    rendrePanier(messageErreur(err));
    racine.querySelector('.mk-erreur')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function lienDeSuivi(c, jeton) {
  if (c?.lien_suivi) return c.lien_suivi;
  if (!jeton) return null;
  return `${location.origin}${location.pathname.replace(/a\/[^/]*$/, 'a/').replace(/[^/]*$/, '')}?c=${encodeURIComponent(jeton)}`;
}

function rendreConfirmation(c, jeton, brouillon) {
  const lien = lienDeSuivi(c, jeton);
  const r = c.retrait || {};
  const change = Number(c.montant_client) && Number(c.montant_client) !== Number(brouillon);
  s.onglet = 'confirmation';
  racine.innerHTML = `
    <header class="mk-entete-blanc"><div class="mk-entete-titres"><h1>Commande enregistrée</h1><span>${esc(c.entreprise?.nom || s.donnees?.entreprise?.nom || '')}</span></div></header>
    <div class="mk-corps">
      <section class="mk-code">
        <span class="etiq">À présenter au comptoir</span>
        <strong data-ref="code">${esc(c.code || '')}</strong>
        ${r.nom ? `<p><b>${esc(r.nom)}</b>${r.adresse ? `, ${esc(r.adresse)}` : ''}</p>` : ''}
        ${r.horaires ? `<p>${esc(r.horaires)}</p>` : ''}
        ${r.telephone ? `<p>Téléphone du bureau : ${esc(telephone(r.telephone))}</p>` : ''}
      </section>
      ${change ? '<div class="mk-info" role="status">Un prix a changé depuis l’affichage : voici les montants enregistrés par le bureau.</div>' : ''}
      <section class="mk-carte">
        ${(c.lignes || []).map((l) => `<div class="mk-ligne"><strong>${esc(l.nom)}</strong><span class="num">${esc(montant(l.montant, c.devise_achat))}</span><span>${esc(l.fournisseur || '')} · ${nombre(l.quantite, 2)}</span><span></span></div>`).join('')}
        <div class="mk-total fort"><span>À verser au bureau</span><span class="num" data-ref="a-verser">${esc(montant(c.montant_client, c.devise_client))}</span></div>
        <div class="mk-total"><span>Transport, payé au retrait</span><strong class="num">${c.transport_estime !== undefined && c.transport_estime !== null ? `${esc(montant(c.transport_estime, c.devise_transport || c.devise_achat))} (estimé)` : 'calculé à la pesée'}</strong></div>
        <p class="mk-note">Le transport n’est pas compris dans le versement. Le montant exact sort de la pesée.</p>
      </section>
      ${lien ? `
      <section class="mk-carte mk-lien-suivi">
        <h2>Gardez le lien de suivi</h2>
        <p class="mk-note">Il vous montre où en est votre commande, jusqu’au retrait.</p>
        <code data-ref="lien">${esc(lien)}</code>
        <div class="mk-boutons">
          <button type="button" class="mk-bouton" data-copier="${esc(lien)}">Copier le lien</button>
          <a class="mk-bouton second" href="https://wa.me/?text=${encodeURIComponent(`Ma commande ${c.code || ''} : ${lien}`)}" target="_blank" rel="noopener">M’envoyer sur WhatsApp</a>
        </div>
      </section>` : ''}
      <div data-ref="installation"></div>
      <button type="button" class="mk-bouton second bloc" data-onglet="accueil">Continuer mes achats</button>
    </div>
    ${onglets()}`;
  // Chargé seulement ici : aucune invitation à installer ne pèse sur le premier chargement de la page.
  import('./installation.js').then((m) => m.bandeSuivi(racine.querySelector('[data-ref="installation"]'))).catch(() => {});
}

/* ------------------------------------------------------------ Écran 3 : mon compte (sans mot de passe) */

function rendreCompte(message = '') {
  const infos = lireLocal(cleInfos, {});
  const commandes = lireLocal(cleCommandes, []);
  const e = s.donnees?.entreprise || {};
  const wa = String(e.telephone || '').replace(/\D/g, '');
  racine.innerHTML = `
    <header class="mk-entete mk-entete-compte">
      <div class="mk-entete-haut">
        <span class="mk-avatar">${esc(initiales(infos.nom) || '?')}</span>
        <div class="mk-entete-titres"><h1>${esc(infos.nom || 'Mon compte')}</h1><span class="num">${infos.tel ? `Téléphone ${esc(masque(infos.tel))}` : 'Pas encore de commande sur ce téléphone'}</span></div>
      </div>
    </header>
    <div class="mk-corps">
      <p class="mk-note mk-sans-mdp">Pas de mot de passe : votre téléphone et votre code suffisent, comme au bureau.</p>
      <div class="mk-deux-boutons">
        <button type="button" class="mk-gros-bouton" data-action="mes-commandes">${ico('liste')}<strong>Mes commandes</strong><span class="num">${nombre(commandes.length)}</span></button>
        <a class="mk-gros-bouton" href="${esc(lienSimulateur())}">${ico('calcul')}<strong>Calculer un prix</strong><span>transport</span></a>
      </div>
      <section class="mk-carte mk-liste-compte" data-ref="liste-commandes" hidden></section>
      <section class="mk-carte-or" data-ref="compte-client">
        <span class="etiq">Mon compte client</span>
        <form class="mk-form-compte" novalidate data-ref="form-compte">
          ${message ? `<div class="mk-erreur" role="alert">${esc(message)}</div>` : ''}
          <div class="mk-form-compte-champs">
            <label for="mk-code-client">Votre numéro<input id="mk-code-client" name="code" autocomplete="off" autocapitalize="characters" placeholder="GN-1042"></label>
            <label for="mk-tel4">4 derniers chiffres<input id="mk-tel4" name="tel4" inputmode="numeric" maxlength="4" placeholder="0004" value="${esc(String(infos.tel || '').replace(/\D/g, '').slice(-4))}"></label>
          </div>
          <button type="submit" class="mk-bouton-sombre">Voir mon solde</button>
        </form>
      </section>
      <nav class="mk-carte mk-liste-compte" aria-label="Mon compte">
        <a href="../c/">${ico('colis')}<span><strong>Suivre un colis</strong><span>Avec son numéro</span></span>${ico('chevron')}</a>
        <button type="button" data-action="bureaux">${ico('lieu')}<span><strong>Nos bureaux de retrait</strong><span>${esc(bureaux().map((b) => b.nom).join(' · '))}</span></span>${ico('chevron')}</button>
        <div data-ref="bureaux" hidden class="mk-sous-liste">${bureaux().map((b) => `<p><strong>${esc(b.nom)}</strong>${b.adresse ? `<br>${esc(b.adresse)}` : ''}${b.horaires ? `<br>${esc(b.horaires)}` : ''}</p>`).join('')}</div>
        <button type="button" data-action="adresses">${ico('lieu')}<span><strong>Mes adresses</strong><span>${esc(bureaux().find((b) => b.id === infos.retrait)?.nom || 'Bureau de retrait préféré')}</span></span>${ico('chevron')}</button>
        <form data-ref="adresses" hidden class="mk-sous-liste mk-form"><label for="mk-pref">Bureau de retrait préféré<select id="mk-pref" name="retrait">${bureaux().map((b) => `<option value="${esc(b.id)}" ${b.id === infos.retrait ? 'selected' : ''}>${esc(b.nom)}</option>`).join('')}</select></label><button type="submit" class="mk-bouton">Enregistrer</button></form>
        <button type="button" data-action="infos">${ico('info')}<span><strong>Mes informations</strong><span>Nom et téléphone de vos commandes</span></span>${ico('chevron')}</button>
        <form data-ref="infos" hidden class="mk-sous-liste mk-form"><label for="mk-info-nom">Nom<input id="mk-info-nom" name="nom" value="${esc(infos.nom || '')}"></label><label for="mk-info-tel">Téléphone<input id="mk-info-tel" name="tel" type="tel" value="${esc(infos.tel || '')}"></label><p class="mk-note">Gardé sur ce téléphone seulement, pour remplir votre prochaine commande. Rien n’est envoyé.</p><button type="submit" class="mk-bouton">Enregistrer</button></form>
        ${wa ? `<a href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">${ico('aide')}<span><strong>Aide et WhatsApp</strong><span class="num">${esc(telephone(e.telephone))}</span></span>${ico('chevron')}</a>` : ''}
      </nav>
    </div>
    ${onglets()}`;
}

async function voirSolde(form) {
  const code = form.code.value.trim().toUpperCase();
  const tel4 = form.tel4.value.replace(/\D/g, '').slice(-4);
  if (!code || tel4.length !== 4) { rendreCompte('Saisissez votre numéro et les 4 derniers chiffres de votre téléphone.'); return; }
  const bouton = form.querySelector('[type=submit]');
  bouton.disabled = true;
  try {
    const k = premiere(await rpc('compte_par_code', { p_code: code, p_tel4: tel4 }));
    if (!k || k.introuvable) { rendreCompte('Ce numéro ne correspond à aucun compte. Vérifiez avec le bureau.'); return; }
    const z = racine.querySelector('[data-ref="compte-client"]');
    const r = k.resume || {};
    z.innerHTML = `<span class="etiq">Mon compte client</span>
      <strong class="mk-code-client num">${esc(k.code || code)}</strong>
      <div class="mk-solde"><span>Reste à payer</span><strong class="num">${esc(montant(r.du_gnf, 'GNF'))}</strong></div>
      <span class="mk-note-or num">${nombre(r.entrepot)} à l’entrepôt · ${nombre(r.en_route)} en route · ${nombre(r.a_retirer)} à retirer</span>`;
  } catch (err) { rendreCompte(messageErreur(err)); }
}

function afficherMesCommandes() {
  const z = racine.querySelector('[data-ref="liste-commandes"]');
  const commandes = lireLocal(cleCommandes, []);
  z.hidden = !z.hidden;
  z.innerHTML = commandes.length ? commandes.map((c) => `<a href="?c=${encodeURIComponent(c.jeton)}">${ico('liste')}<span><strong class="num">${esc(c.code || 'Commande')}</strong><span>${esc(new Date(c.le).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }))}</span></span>${ico('chevron')}</a>`).join('')
    : '<p class="mk-vide">Aucune commande passée depuis ce téléphone.</p>';
}

/* ------------------------------------------------------------ Suivi d'une commande (a/?c=<jeton>) */

async function afficherSuivi() {
  let c = null;
  try { c = premiere(await rpc('commande_marche', { p_jeton: jetonSuivi })); } catch { c = null; }
  if (!c || c.introuvable) {
    racine.innerHTML = '<header class="mk-entete-blanc"><div class="mk-entete-titres"><h1>Suivi de commande</h1></div></header><div class="mk-corps"><p class="mk-vide">Ce lien de suivi n’est pas valable. Vérifiez-le auprès du bureau.</p></div>';
    return;
  }
  const lignes = c.lignes || [];
  const etapes = [
    ['Commande enregistrée', c.created_at, true],
    ['Versée au bureau', c.verse_le, Boolean(c.verse_le)],
    ['Vendeur payé', null, lignes.length > 0 && lignes.every((l) => l.paye_le)],
    ['Marchandise expédiée', null, Boolean(c.colis)],
    ['Arrivée au bureau de retrait', null, ['arrive', 'a_retirer', 'retire'].includes(c.colis?.statut)],
    ['Retirée', null, c.colis?.statut === 'retire' || c.statut === 'retiree']
  ];
  const r = c.retrait || {};
  // Volontairement aucune commission ni montant reversé au vendeur sur cette page publique.
  racine.innerHTML = `
    <header class="mk-entete"><div class="mk-entete-haut"><div class="mk-entete-titres"><h1>Commande ${esc(c.code || '')}</h1><span>${esc(c.entreprise?.nom || '')}${r.nom ? ` · retrait à ${esc(r.nom)}` : ''}</span></div></div></header>
    <div class="mk-corps">
      ${c.statut === 'litige' ? `<div class="mk-erreur" role="status">Un problème est signalé sur cette commande${c.motif ? ` : ${esc(c.motif)}` : ''}. Le bureau vous contacte.</div>` : ''}
      <section class="mk-carte"><h2>Où en est votre commande</h2>
        <ol class="mk-suivi-etapes">${etapes.map(([t, d, fait]) => `<li class="${fait ? 'fait' : ''}"><div><strong>${esc(t)}</strong>${d && fait ? `<span>${esc(new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }))}</span>` : ''}</div></li>`).join('')}</ol>
      </section>
      <section class="mk-carte">
        ${lignes.map((l) => `<div class="mk-ligne"><strong>${esc(l.nom)}</strong><span class="num">${esc(nombre(l.quantite, 2))}</span><span>${esc(l.fournisseur || '')}</span><span></span></div>`).join('')}
        <div class="mk-total fort"><span>${c.verse_le ? 'Versé au bureau' : 'À verser au bureau'}</span><span class="num">${esc(montant(c.montant_client, c.devise_client))}</span></div>
        <div class="mk-total"><span>Transport, payé au retrait</span><strong class="num">${c.colis?.du_montant !== undefined && c.colis?.du_montant !== null ? `${esc(montant(c.colis.du_montant, c.colis.du_devise))} (après pesée)` : c.transport_estime !== undefined && c.transport_estime !== null ? `${esc(montant(c.transport_estime, c.devise_transport || c.devise_achat))} (estimé)` : 'calculé à la pesée'}</strong></div>
      </section>
      ${c.colis?.numero ? `<section class="mk-carte"><h2>Votre colis ${esc(c.colis.numero)}</h2>${c.colis.lien ? `<a class="mk-bouton bloc" href="${esc(c.colis.lien)}">Suivre le colis</a>` : ''}</section>` : ''}
      ${r.nom ? `<section class="mk-carte"><h2>Bureau de retrait</h2><p class="mk-p"><strong>${esc(r.nom)}</strong>${r.adresse ? `<br>${esc(r.adresse)}` : ''}${r.horaires ? `<br>${esc(r.horaires)}` : ''}</p><p class="mk-note">Présentez votre reçu et une pièce d’identité.</p></section>` : ''}
      <p class="mk-pied">Suivi propulsé par <strong>YOUMMA Business</strong></p>
    </div>`;
}

/* ------------------------------------------------------------ Navigation et écouteurs */

function afficher() {
  if (s.onglet === 'accueil') rendreAccueil();
  else if (s.onglet === 'rayons') rendreRayons();
  else if (s.onglet === 'rayon') rendreRayon();
  else if (s.onglet === 'panier') rendrePanier();
  else if (s.onglet === 'compte') rendreCompte();
  if (s.onglet !== 'panier' && nbArticles()) estimerTransport();
}
function aller(onglet) {
  s.onglet = onglet;
  if (onglet !== 'rayon') { s.rayon = null; s.filtre = null; }
  afficher();
  window.scrollTo(0, 0);
}
function ouvrirRayon(ctx) { s.rayon = ctx; s.filtre = null; s.onglet = 'rayon'; afficher(); window.scrollTo(0, 0); }

racine.addEventListener('click', async (e) => {
  const plus = e.target.closest('[data-plus]');
  const moins = e.target.closest('[data-moins]');
  if (plus || moins) {
    const id = (plus || moins).dataset[plus ? 'plus' : 'moins'];
    const q = (s.panier.get(id) || 0) + (plus ? 1 : -1);
    if (q > 0) s.panier.set(id, q); else s.panier.delete(id);
    ecrirePanier();
    const y = window.scrollY;
    afficher();
    window.scrollTo(0, y);
    return;
  }
  const onglet = e.target.closest('[data-onglet]')?.dataset.onglet;
  if (onglet) { aller(onglet); return; }
  const rayon = e.target.closest('[data-rayon]');
  if (rayon) { ouvrirRayon({ categorie: rayon.dataset.rayon, depuisRayons: Boolean(rayon.dataset.depuisRayons) }); return; }
  if (e.target.closest('[data-rayon-tous]')) { ouvrirRayon({ depuisRayons: true }); return; }
  const vendeur = e.target.closest('[data-vendeur]');
  if (vendeur) { ouvrirRayon({ vendeur: vendeur.dataset.vendeur }); return; }
  if (e.target.closest('[data-filtre="tous"]')) { s.filtre = null; rendreRayon(); return; }
  const fv = e.target.closest('[data-filtre-vendeur]');
  if (fv) { s.filtre = { vendeur: fv.dataset.filtreVendeur }; rendreRayon(); return; }
  const ft = e.target.closest('[data-filtre-tranche]');
  if (ft) { s.filtre = { tranche: Number(ft.dataset.filtreTranche) }; rendreRayon(); return; }
  const copier = e.target.closest('[data-copier]');
  if (copier) { try { await navigator.clipboard.writeText(copier.dataset.copier); toast('Lien copié.'); } catch { toast('Copiez le lien affiché au-dessus.'); } return; }
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'recharger') { location.reload(); return; }
  if (action === 'mes-commandes') { afficherMesCommandes(); return; }
  if (action === 'bureaux' || action === 'adresses' || action === 'infos') { const z = racine.querySelector(`[data-ref="${action}"]`); if (z) z.hidden = !z.hidden; }
});
racine.addEventListener('change', (e) => { if (e.target.id === 'mk-retrait') { s.retrait = e.target.value; estimerTransport(); } });
racine.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target.closest('form');
  if (!form) return;
  if (form.dataset.ref === 'form-recherche') { const q = form.q.value.trim(); if (q) ouvrirRayon({ recherche: q }); return; }
  if (form.dataset.ref === 'form-compte') { voirSolde(form); return; }
  if (form.dataset.ref === 'adresses') { ecrireLocal(cleInfos, { ...lireLocal(cleInfos, {}), retrait: form.retrait.value }); s.retrait = form.retrait.value; toast('Bureau préféré enregistré sur ce téléphone.'); rendreCompte(); return; }
  if (form.dataset.ref === 'infos') { ecrireLocal(cleInfos, { ...lireLocal(cleInfos, {}), nom: form.nom.value.trim(), tel: form.tel.value.trim() }); toast('Enregistré sur ce téléphone.'); rendreCompte(); return; }
  if (!form.nom.value.trim()) { rendrePanier(ERREURS.NOM_REQUIS); return; }
  if (!form.tel.value.trim()) { rendrePanier(ERREURS.TELEPHONE_REQUIS); return; }
  confirmer(form);
});

(async function demarrer() {
  if (jetonSuivi) { await afficherSuivi(); return; }
  if (!slug) { racine.innerHTML = '<div class="mk-corps"><p class="mk-vide">Adresse incomplète : demandez le lien du marché au bureau.</p></div>'; return; }
  lirePanier();
  try {
    const [ok, corridors] = await Promise.all([chargerCatalogue(), rpc('corridors_publics', { p_slug: slug }).then(premiere).catch(() => null)]);
    if (!ok) { racine.innerHTML = '<div class="mk-corps"><p class="mk-vide">Ce marché n’existe pas ou n’est plus ouvert.</p></div>'; return; }
    s.corridors = corridors?.corridors || [];
    const infos = lireLocal(cleInfos, {});
    s.retrait = (bureaux().find((b) => b.id === infos.retrait) || bureaux()[0])?.id || null;
    document.title = `${s.donnees.entreprise?.nom || 'Le marché'} · acheter à ${villeVendeurs()}`;
    rendreAccueil();
    chargerBanniere();
    if (nbArticles()) estimerTransport();
  } catch (err) {
    racine.innerHTML = `<div class="mk-corps"><div class="mk-erreur" role="alert">${esc(messageErreur(err))}</div><button type="button" class="mk-bouton bloc" data-action="recharger">Réessayer</button></div>`;
  }
})();
