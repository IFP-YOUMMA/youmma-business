/**
 * marche-client.js — Page publique a/ du marché (étape 21, maquettes MarcheClient et MarcheCommande), sans compte.
 *
 *  - a/?s=<slug> (ou a/<slug>) : le catalogue (marche_public), le bandeau « Vous ne payez rien à Dakar », les
 *    fournisseurs, les articles en GNF et en FCFA, le panier et sa barre basse ;
 *  - commande : le détail, le transport ESTIMÉ (simuler_prix, payé au retrait), « Ce qui va se passer », puis
 *    creer_commande_marche (la seule porte d'entrée d'une commande) et le code CM-xxxx à présenter au comptoir ;
 *  - a/?c=<jeton> : le suivi d'une commande (commande_marche), sans la commission ni ce qui est reversé au vendeur.
 * Les prix du panier ne sont qu'un brouillon : après création, la page affiche les montants renvoyés par la base.
 * Jamais de paiement en ligne, jamais de coordonnées du vendeur, jamais le téléphone d'un client.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

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
/** Téléphone lisible : « 224620888888 » → « +224 620 88 88 88 » (indicatif à 3 chiffres, puis par deux). */
const telephone = (t) => { const c = String(t || '').replace(/D/g, ''); return c.length > 9 ? `+${c.slice(0, 3)} ${c.slice(3, 6)} ${c.slice(6).replace(/(d{2})(?=d)/g, '$1 ')}` : String(t || ''); };
const ICONES = {
  panier: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
  recherche: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  retour: '<path d="M15 18l-6-6 6-6"/>'
};
const ico = (n) => `<svg class="mk-ico" viewBox="0 0 24 24" aria-hidden="true">${ICONES[n]}</svg>`;
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
  donnees: null, corridors: [], articles: new Map(), fournisseur: null, recherche: '',
  panier: new Map(), retrait: null, transport: null, jetonTransport: 0, vue: 'catalogue'
};
const clePanier = `yb_marche_panier_${slug}`;
function lirePanier() {
  try { Object.entries(JSON.parse(localStorage.getItem(clePanier) || '{}')).forEach(([id, q]) => { if (Number(q) > 0) s.panier.set(id, Number(q)); }); } catch { /* stockage refusé */ }
}
function ecrirePanier() {
  try { localStorage.setItem(clePanier, JSON.stringify(Object.fromEntries(s.panier))); } catch { /* stockage refusé */ }
}
const nbArticles = () => [...s.panier.values()].reduce((t, q) => t + q, 0);
const lignesPanier = () => [...s.panier.entries()].map(([id, q]) => ({ a: s.articles.get(id), q })).filter((x) => x.a);
/** Brouillon : la somme des prix client renvoyés par la base, seulement pour l'affichage avant confirmation. */
const totalBrouillon = () => lignesPanier().reduce((t, { a, q }) => t + (Number(a.prix_client) || 0) * q, 0);
const deviseClient = () => (s.donnees?.taux || []).find((t) => t.de === 'XOF')?.vers || 'GNF';

/** Bureaux de retrait : ceux de la réponse du marché s'il y en a, sinon les arrivées des corridors publics. */
function bureaux() {
  const e = s.donnees?.espace || {};
  const liste = e.agences || e.retraits || e.bureaux;
  if (Array.isArray(liste) && liste.length && liste[0].id) return liste.map((b) => ({ id: b.id, nom: b.nom || b.ville, ville: b.ville }));
  const vus = new Map();
  s.corridors.forEach((c) => { if (c.arrivee && !vus.has(c.arrivee)) vus.set(c.arrivee, { id: c.arrivee, nom: c.vers, ville: c.vers }); });
  return [...vus.values()];
}
const villeRetrait = () => bureaux().find((b) => b.id === s.retrait)?.ville || bureaux()[0]?.ville || 'Conakry';
const villeVendeurs = () => {
  const villes = (s.donnees?.fournisseurs || []).map((f) => f.ville).filter(Boolean);
  return villes.sort((a, b) => villes.filter((v) => v === b).length - villes.filter((v) => v === a).length)[0] || 'Dakar';
};

/* ------------------------------------------------------------ Transport estimé (simuler_prix, côté base) */

function corridorPourEstimer() {
  const ville = villeVendeurs();
  const vers = s.corridors.filter((c) => c.arrivee === s.retrait && c.ville === ville);
  return vers.find((c) => c.mode === 'route') || vers[0] || null;
}
async function estimerTransport() {
  const lignes = lignesPanier();
  const jeton = ++s.jetonTransport;
  const poids = lignes.reduce((t, { a, q }) => t + (Number(a.poids_kg) || 0) * q, 0);
  const c = corridorPourEstimer();
  if (!lignes.length || !c || !(poids > 0)) { s.transport = null; majTransport(); return; }
  try {
    const r = premiere(await rpc('simuler_prix', { p_slug: slug, p_depart: c.depart, p_arrivee: c.arrivee, p_mode: c.mode, p_poids: Math.round(poids * 100) / 100, p_longueur: null, p_largeur: null, p_hauteur: null, p_nb: 1 }));
    if (jeton !== s.jetonTransport) return;
    s.transport = r && !r.introuvable ? {
      montant: r.total_arrivee ?? r.total, devise: r.total_arrivee !== undefined && r.total_arrivee !== null ? r.devise_arrivee : r.devise,
      poids, mode: c.mode, incomplet: lignes.some(({ a }) => !Number(a.poids_kg))
    } : null;
  } catch { if (jeton === s.jetonTransport) s.transport = null; }
  majTransport();
}
const texteTransport = () => (s.transport
  ? `+ transport estimé ${montant(s.transport.montant, s.transport.devise)}, payé au retrait`
  : '+ transport, payé au retrait (estimé à la commande)');
function majTransport() {
  document.querySelectorAll('[data-ref="transport"]').forEach((z) => { z.textContent = texteTransport(); });
  const bloc = document.querySelector('[data-ref="transport-bloc"]');
  if (bloc) bloc.innerHTML = blocTransport();
}
function blocTransport() {
  const t = s.transport;
  return `
    <div class="mk-total"><strong>Le transport</strong><strong class="num">${t ? esc(montant(t.montant, t.devise)) : '—'}</strong></div>
    <p>${t ? `Estimé : ${esc(nombre(t.poids, 2))} kg par ${t.mode === 'route' ? 'la route' : t.mode === 'avion' ? 'avion' : esc(t.mode)}${t.incomplet ? ' (certains articles n’ont pas de poids annoncé)' : ''}. ` : ''}<strong>Payé au retrait</strong>, à ${esc(villeRetrait())}. Le montant exact est calculé à la pesée : si le colis est plus léger, vous payez moins.</p>`;
}

/* ------------------------------------------------------------ Catalogue */

async function chargerCatalogue() {
  const d = premiere(await rpc('marche_public', { p_slug: slug, p_fournisseur: s.fournisseur, p_recherche: s.recherche || null }));
  if (!d || d.introuvable) return false;
  s.donnees = d;
  (d.articles || []).forEach((a) => s.articles.set(a.id, a));
  return true;
}

function entete({ titre, sous, retour = false }) {
  return `
    <header class="mk-entete">
      <div class="mk-entete-haut">
        ${retour ? `<button type="button" class="mk-retour" data-action="catalogue" aria-label="Retour au catalogue">${ico('retour')}</button>` : ''}
        <div class="mk-entete-titres"><h1>${esc(titre)}</h1><span>${esc(sous)}</span></div>
        ${!retour ? `<button type="button" class="mk-panier-btn" data-action="commande" aria-label="Voir le panier : ${nbArticles()} article(s)">${ico('panier')}${nbArticles() ? `<b data-ref="compte">${nbArticles()}</b>` : ''}</button>` : ''}
      </div>
      ${!retour ? `<label class="mk-recherche">${ico('recherche')}<span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Rechercher</span><input type="search" data-ref="recherche" placeholder="Tissu, téléphone, cosmétique…" value="${esc(s.recherche)}" autocomplete="off"></label>` : ''}
    </header>`;
}

function rendreCatalogue() {
  const d = s.donnees;
  const e = d.entreprise || {};
  const taux = (d.taux || []).find((t) => t.de === 'XOF');
  const articles = (d.articles || []);
  racine.innerHTML = `
    ${entete({ titre: `Acheter à ${villeVendeurs()}`, sous: `${e.nom || ''} · vous payez ici, à ${villeRetrait()}` })}
    <div class="mk-bandeau" role="note"><strong>Vous ne payez rien à ${esc(villeVendeurs())}.</strong><span>Vous versez au bureau de ${esc(villeRetrait())}, nous payons le fournisseur, et vous réglez le transport seulement au retrait.</span></div>
    <div class="mk-corps">
      ${(d.fournisseurs || []).length ? `
      <div class="mk-section-tete"><h2>Nos fournisseurs à ${esc(villeVendeurs())}</h2>${s.fournisseur ? '<button type="button" class="mk-lien" data-fournisseur="">Voir tous</button>' : `<span>${nombre(d.fournisseurs.length)}</span>`}</div>
      <div class="mk-fournisseurs">${d.fournisseurs.map((f) => `
        <button type="button" class="mk-fournisseur ${s.fournisseur === f.slug ? 'actif' : ''}" data-fournisseur="${esc(f.slug)}" aria-pressed="${s.fournisseur === f.slug}">
          <strong>${esc(f.nom)}</strong><span>${esc(f.specialite || '')}</span>
          <span>${esc(f.drapeau || '')} ${esc(f.ville || '')} · ${nombre(f.articles)} article${Number(f.articles) > 1 ? 's' : ''}</span>
          ${f.delai_jours !== null && f.delai_jours !== undefined ? `<span class="mk-prepare">${Number(f.delai_jours) === 0 ? 'Prépare le jour même' : `Prépare en ${nombre(f.delai_jours)} j`}</span>` : ''}
        </button>`).join('')}</div>` : ''}
      <div class="mk-section-tete"><h2>${s.recherche ? `Résultats pour « ${esc(s.recherche)} »` : s.fournisseur ? 'Ses articles' : 'Les plus demandés'}</h2>${taux ? `<span class="mk-taux num">Taux 1 F = ${esc(nombre(taux.taux, 2))} ${esc(nomDevise(taux.vers))}</span>` : ''}</div>
      ${articles.length ? `<div class="mk-articles">${articles.map(carteArticle).join('')}</div>` : '<p class="mk-vide">Aucun article ne correspond.</p>'}
    </div>
    ${barre()}
    <p class="mk-pied">Marché propulsé par <strong>YOUMMA Business</strong></p>`;
}

function carteArticle(a) {
  const q = s.panier.get(a.id) || 0;
  const photo = a.photo_mini_url || a.photo_url;
  return `
    <article class="mk-article" data-article="${esc(a.id)}">
      <div class="mk-photo">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" decoding="async">` : esc(a.categorie || '')}${a.mis_en_avant ? '<span class="mk-populaire">Populaire</span>' : ''}</div>
      <div class="mk-article-corps">
        <strong>${esc(a.nom)}</strong>
        <span class="mk-de">${esc(a.fournisseur || '')}${a.unite ? ` · ${esc(a.unite)}` : ''}</span>
        <span class="mk-prix num">${esc(montant(a.prix_client, deviseClient()))}</span>
        <span class="mk-prix-local num">${esc(montant(a.prix, a.devise))} à ${esc(a.ville || villeVendeurs())}</span>
        ${q ? `<div class="mk-quantite"><button type="button" data-moins="${esc(a.id)}" aria-label="Retirer un">−</button><strong class="num">${nombre(q)}</strong><button type="button" data-plus="${esc(a.id)}" aria-label="Ajouter un">+</button></div>`
          : `<button type="button" class="mk-ajouter" data-plus="${esc(a.id)}">Ajouter</button>`}
      </div>
    </article>`;
}

function barre() {
  if (!nbArticles()) return '';
  return `
    <div class="mk-barre" data-ref="barre"><div class="mk-barre-int">
      <div class="mk-barre-textes">
        <strong class="num">${nombre(nbArticles())} article${nbArticles() > 1 ? 's' : ''} · marchandise ${esc(montant(totalBrouillon(), deviseClient()))}</strong>
        <span data-ref="transport">${esc(texteTransport())}</span>
      </div>
      <button type="button" class="mk-bouton" data-action="commande">Commander</button>
    </div></div>`;
}

/* ------------------------------------------------------------ Commande */

function rendreCommande(erreur = '') {
  const lignes = lignesPanier();
  const liste = bureaux();
  if (!s.retrait && liste.length) s.retrait = liste[0].id;
  racine.innerHTML = `
    ${entete({ titre: 'Votre commande', sous: `${s.donnees?.entreprise?.nom || ''} · retrait à ${villeRetrait()}`, retour: true })}
    <div class="mk-corps">
      ${!lignes.length ? '<p class="mk-vide">Votre panier est vide.</p><button type="button" class="mk-bouton bloc" data-action="catalogue">Voir les articles</button>' : `
      <section class="mk-carte">
        ${lignes.map(({ a, q }) => `
          <div class="mk-ligne">
            <strong>${esc(a.nom)}</strong><span class="num">${esc(montant((Number(a.prix_client) || 0) * q, deviseClient()))}</span>
            <span>${esc(a.fournisseur || '')} · ${nombre(q)} × ${esc(a.unite || 'pièce')}</span><span></span>
            <div class="mk-quantite"><button type="button" data-moins="${esc(a.id)}" aria-label="Retirer un">−</button><strong class="num">${nombre(q)}</strong><button type="button" data-plus="${esc(a.id)}" aria-label="Ajouter un">+</button></div>
          </div>`).join('')}
        <div class="mk-total"><span>Marchandise</span><strong class="num">${esc(montant(totalBrouillon(), deviseClient()))}</strong></div>
        <div class="mk-total fort"><span>À verser au bureau</span><span class="num">${esc(montant(totalBrouillon(), deviseClient()))}</span></div>
        <p class="mk-note-transport">Le transport n’est pas compris : il est estimé ci-dessous et payé au retrait.</p>
      </section>
      <section class="mk-carte mk-transport" data-ref="transport-bloc">${blocTransport()}</section>
      <section class="mk-carte">
        <h2>Ce qui va se passer</h2>
        <ol class="mk-etapes">
          <li><div><strong>Vous versez au bureau de ${esc(villeRetrait())}</strong><span>Le prix de la marchandise, rien de plus. Vous repartez avec un reçu.</span></div></li>
          <li><div><strong>Nous payons le fournisseur à ${esc(villeVendeurs())}</strong><span>Notre bureau règle le vendeur et récupère la marchandise. Vous ne payez rien à ${esc(villeVendeurs())}.</span></div></li>
          <li><div><strong>La marchandise part</strong><span>Pesée, photographiée, mise dans le prochain départ.</span></div></li>
          <li><div><strong>Vous retirez à ${esc(villeRetrait())}</strong><span>Vous payez le transport, calculé à la pesée, et vous repartez avec votre colis.</span></div></li>
        </ol>
      </section>
      <form class="mk-carte mk-form" novalidate>
        <h2>Vos coordonnées</h2>
        ${erreur ? `<div class="mk-erreur" role="alert">${esc(erreur)}</div>` : ''}
        <label for="mk-nom">Votre nom<input id="mk-nom" name="nom" autocomplete="name" maxlength="80" required></label>
        <label for="mk-tel">Votre téléphone<input id="mk-tel" name="tel" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="620 00 00 00" required></label>
        <label for="mk-retrait">Bureau de retrait<select id="mk-retrait" name="retrait">${liste.map((b) => `<option value="${esc(b.id)}" ${b.id === s.retrait ? 'selected' : ''}>${esc(b.nom)}</option>`).join('')}</select></label>
        <label for="mk-note">Une précision pour le bureau (facultatif)<textarea id="mk-note" name="note" maxlength="300" placeholder="Taille, couleur…"></textarea></label>
        <button type="submit" class="mk-bouton bloc">Confirmer la commande</button>
        <p class="mk-note-transport">Aucun paiement en ligne : vous payez au bureau, sur présentation de votre code.</p>
      </form>`}
    </div>`;
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
    s.panier.clear();
    ecrirePanier();
    rendreConfirmation(c && !c.introuvable ? { ...cree, ...c } : cree, jeton, brouillon);
  } catch (err) {
    rendreCommande(messageErreur(err));
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
  racine.innerHTML = `
    ${entete({ titre: 'Commande enregistrée', sous: c.entreprise?.nom || s.donnees?.entreprise?.nom || '', retour: true })}
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
        <p class="mk-note-transport">Le transport n’est pas compris dans le versement. Le montant exact sort de la pesée.</p>
      </section>
      ${lien ? `
      <section class="mk-carte mk-lien-suivi">
        <h2>Gardez le lien de suivi</h2>
        <p class="mk-note-transport">Il vous montre où en est votre commande, jusqu’au retrait.</p>
        <code data-ref="lien">${esc(lien)}</code>
        <div class="mk-boutons">
          <button type="button" class="mk-bouton" data-copier="${esc(lien)}">Copier le lien</button>
          <a class="mk-bouton second" style="display:grid;place-items:center;text-decoration:none" href="https://wa.me/?text=${encodeURIComponent(`Ma commande ${c.code || ''} : ${lien}`)}" target="_blank" rel="noopener">M’envoyer sur WhatsApp</a>
        </div>
      </section>` : ''}
      <button type="button" class="mk-bouton second bloc" data-action="catalogue">Continuer mes achats</button>
    </div>`;
}

/* ------------------------------------------------------------ Suivi d'une commande (a/?c=<jeton>) */

async function afficherSuivi() {
  let c = null;
  try { c = premiere(await rpc('commande_marche', { p_jeton: jetonSuivi })); } catch { c = null; }
  if (!c || c.introuvable) {
    racine.innerHTML = `${entete({ titre: 'Suivi de commande', sous: 'Marché', retour: false })}<div class="mk-corps"><p class="mk-vide">Ce lien de suivi n’est pas valable. Vérifiez-le auprès du bureau.</p></div>`;
    racine.querySelector('.mk-panier-btn')?.remove();
    racine.querySelector('.mk-recherche')?.remove();
    return;
  }
  const lignes = c.lignes || [];
  const etapes = [
    ['Commande enregistrée', c.created_at, true],
    ['Versée au bureau', c.verse_le, Boolean(c.verse_le)],
    ['Fournisseur payé', null, lignes.length > 0 && lignes.every((l) => l.paye_le)],
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
      ${c.colis?.numero ? `<section class="mk-carte"><h2>Votre colis ${esc(c.colis.numero)}</h2>${c.colis.lien ? `<a class="mk-bouton bloc" style="display:grid;place-items:center;text-decoration:none" href="${esc(c.colis.lien)}">Suivre le colis</a>` : ''}</section>` : ''}
      ${r.nom ? `<section class="mk-carte"><h2>Bureau de retrait</h2><p style="margin:0"><strong>${esc(r.nom)}</strong>${r.adresse ? `<br>${esc(r.adresse)}` : ''}${r.horaires ? `<br>${esc(r.horaires)}` : ''}</p><p class="mk-note-transport">Présentez votre reçu et une pièce d’identité.</p></section>` : ''}
    </div>
    <p class="mk-pied">Suivi propulsé par <strong>YOUMMA Business</strong></p>`;
}

/* ------------------------------------------------------------ Démarrage et écouteurs */

let minuteurRecherche = null;
racine.addEventListener('input', (e) => {
  if (e.target.dataset.ref !== 'recherche') return;
  clearTimeout(minuteurRecherche);
  minuteurRecherche = setTimeout(async () => {
    s.recherche = e.target.value.trim();
    try { await chargerCatalogue(); rendreCatalogue(); const champ = racine.querySelector('[data-ref="recherche"]'); champ?.focus(); champ?.setSelectionRange(champ.value.length, champ.value.length); } catch (err) { toast(messageErreur(err)); }
  }, 350);
});
racine.addEventListener('change', (e) => { if (e.target.id === 'mk-retrait') { s.retrait = e.target.value; estimerTransport(); } });
racine.addEventListener('click', async (e) => {
  const plus = e.target.closest('[data-plus]');
  const moins = e.target.closest('[data-moins]');
  if (plus || moins) {
    const id = (plus || moins).dataset[plus ? 'plus' : 'moins'];
    const q = (s.panier.get(id) || 0) + (plus ? 1 : -1);
    if (q > 0) s.panier.set(id, q); else s.panier.delete(id);
    ecrirePanier();
    if (s.vue === 'commande') rendreCommande(); else { rendreCatalogue(); estimerTransport(); }
    return;
  }
  const f = e.target.closest('[data-fournisseur]');
  if (f) {
    s.fournisseur = f.dataset.fournisseur || null;
    try { await chargerCatalogue(); rendreCatalogue(); estimerTransport(); } catch (err) { toast(messageErreur(err)); }
    return;
  }
  const copier = e.target.closest('[data-copier]');
  if (copier) {
    try { await navigator.clipboard.writeText(copier.dataset.copier); toast('Lien copié.'); } catch { toast('Copiez le lien affiché au-dessus.'); }
    return;
  }
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'recharger') { location.reload(); return; }
  if (action === 'commande') { s.vue = 'commande'; rendreCommande(); window.scrollTo(0, 0); }
  if (action === 'catalogue') { s.vue = 'catalogue'; try { if (!s.donnees) await chargerCatalogue(); rendreCatalogue(); estimerTransport(); } catch (err) { toast(messageErreur(err)); } window.scrollTo(0, 0); }
});
racine.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target.closest('form');
  if (!form) return;
  if (!form.nom.value.trim()) { rendreCommande(ERREURS.NOM_REQUIS); return; }
  if (!form.tel.value.trim()) { rendreCommande(ERREURS.TELEPHONE_REQUIS); return; }
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
    s.retrait = bureaux()[0]?.id || null;
    document.title = `Acheter à ${villeVendeurs()} · ${s.donnees.entreprise?.nom || 'YOUMMA Business'}`;
    rendreCatalogue();
    estimerTransport();
  } catch (err) {
    racine.innerHTML = `<div class="mk-corps"><div class="mk-erreur" role="alert">${esc(messageErreur(err))}</div><button type="button" class="mk-bouton bloc" data-action="recharger">Réessayer</button></div>`;
  }
})();
