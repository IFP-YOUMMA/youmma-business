/**
 * caisse.js — Caisse / nouvelle vente (maquettes Caisse.dc.html et CaisseMobile.dc.html).
 *
 * Le front n'envoie jamais de prix : valider_vente reçoit [{produit_id, quantite}] et
 * recalcule tout côté serveur. Les prix affichés ici servent seulement à l'aperçu.
 */
import { sb } from './supabase.js';
import { etat, licenceExpiree, peut } from './state.js';
import { chargerClient, ouvrirFormulaireClient } from './clients-commun.js';
import { imprimerRecuVente } from './recu.js';
import { naviguer } from './router.js';
import { chargerChantierOuvert } from './chantiers-commun.js';
import {
  esc, icone, toast, confirmer, ouvrirModale, boutonOccupe, messageErreur, differer, lireNombre,
  lireStockage, ecrireStockage, prenom, initiales, formatNombre, formatGNF, formatQuantite, formatDate,
  formatTelephone, formatNumeroVente, uniteDivisible, dateISO, texteSolde, classeSolde, MODES_PAIEMENT, MODES_CAISSE
} from './utils.js';

const ICONES_UNITES = {
  sac: 'sac', barre: 'barre', feuille: 'tole', 'tôle': 'tole', seau: 'seau',
  'm²': 'carreau', m2: 'carreau', voyage: 'camion', kg: 'clou'
};
const ECHEANCE_PAR_DEFAUT_JOURS = 7;
const MESSAGE_LICENCE = 'Votre licence a expiré. Vous pouvez consulter vos données mais plus enregistrer de ventes.';

/** Recherche insensible aux accents et à la casse. */
function normaliserTexte(texte) {
  return String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function afficherCaisse(conteneur, params) {
  const boutique = etat.boutique;
  const s = {
    produits: [],
    categories: [],
    charge: false,
    categorie: 'tous',
    recherche: '',
    typePrix: 'detail',
    /** Map produit_id → { produit, quantite } */
    panier: new Map(),
    client: null,
    /** Chantier ouvert du client choisi (rappel « Faire un enlèvement chantier »). */
    chantierClient: null,
    remise: 0,
    editionRemise: false,
    mode: 'especes',
    montantRecu: null,
    echeance: dateISO(ECHEANCE_PAR_DEFAUT_JOURS),
    recuSms: false,
    enCours: false,
    panierOuvert: false
  };
  const cleAttente = `yb_attente_${boutique.id}`;
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);
  const refs = (nom) => conteneur.querySelectorAll(`[data-ref="${nom}"]`);

  /* ======================================================= Calculs */

  /** Prix appliqué selon la bascule détail / gros (pas de prix gros → prix détail). */
  function prixArticle(p) {
    return s.typePrix === 'gros' && p.prix_gros !== null && p.prix_gros !== undefined
      ? Number(p.prix_gros) : Number(p.prix_detail) || 0;
  }

  function quantiteMax(p) {
    return p.sur_commande ? Infinity : Math.max(0, Number(p.stock) || 0);
  }

  function totaux() {
    let sousTotal = 0;
    s.panier.forEach(({ produit, quantite }) => { sousTotal += prixArticle(produit) * quantite; });
    sousTotal = Math.round(sousTotal);
    const remise = Math.min(Math.max(0, Math.round(s.remise || 0)), sousTotal);
    return { sousTotal, remise, total: sousTotal - remise };
  }

  function nombreArticles() {
    return s.panier.size;
  }

  /** Couleur du stock : rouge ≤ seuil, orange ≤ 2× seuil, vert sinon. */
  function etatStock(p) {
    if (p.sur_commande) return { classe: 'stock-ok', texte: 'Sur commande' };
    const stock = Number(p.stock) || 0;
    const seuil = Number(p.seuil_alerte) || 0;
    if (stock <= 0) return { classe: 'stock-bas', texte: 'Épuisé' };
    if (stock <= seuil) return { classe: 'stock-bas', texte: formatQuantite(stock, p.unite) };
    if (stock <= 2 * seuil) return { classe: 'stock-moyen', texte: formatQuantite(stock, p.unite) };
    return { classe: 'stock-ok', texte: formatQuantite(stock, p.unite) };
  }

  function iconeArticle(p) {
    const unite = String(p.unite || '').toLowerCase();
    if (unite === 'pièce' && boutique.type_activite === 'materiaux') return 'brique';
    return ICONES_UNITES[unite] || 'stock';
  }

  /* ======================================================= Gabarit principal */

  conteneur.innerHTML = `
    <div class="caisse">
      <header class="caisse-entete">
        <div class="caisse-entete-gauche">
          <a href="#/tableau-de-bord" class="btn-icone btn-icone-sombre" aria-label="Retour au tableau de bord">${icone('retour', 20, 2)}</a>
          <div class="caisse-titres">
            <span class="caisse-titre"><span class="seul-ordi">Caisse · </span>Nouvelle vente</span>
            <span class="caisse-sous">${esc(boutique.nom)} · Vendeur : ${esc(prenom(etat.membre?.nom) || '—')}</span>
          </div>
        </div>
        <div class="caisse-outils">
          <div class="segments segments-sombre" role="group" aria-label="Type de prix">
            <button type="button" class="segment actif" data-prix="detail" aria-pressed="true">Prix détail</button>
            <button type="button" class="segment" data-prix="gros" aria-pressed="false">Prix gros</button>
          </div>
          <button type="button" class="btn btn-sombre" data-action="liste-attente">
            ${icone('horloge', 18, 2)}<span>Ventes en attente (<span data-ref="nb-attente">0</span>)</span>
          </button>
        </div>
      </header>

      <div class="caisse-corps">
        <section class="catalogue" aria-label="Articles">
          <label class="recherche-caisse">
            ${icone('recherche', 20, 2)}
            <span class="sr-only">Rechercher un article ou scanner un code-barres</span>
            <input id="recherche-caisse" type="search" placeholder="Rechercher un article ou scanner un code-barres…" autocomplete="off" enterkeyhint="search">
            <kbd class="seul-ordi">F2</kbd>
          </label>
          <div class="puces" data-zone="categories" role="group" aria-label="Catégories"></div>
          <div class="grille-articles" data-zone="articles" aria-live="polite">
            ${'<div class="article article-squelette"><span class="squelette" style="height:64px"></span><span class="squelette" style="height:14px;width:80%"></span><span class="squelette" style="height:14px;width:50%"></span></div>'.repeat(8)}
          </div>
        </section>
        <aside class="panier" aria-label="Panier" data-zone="panier"></aside>
      </div>
    </div>`;

  /* ======================================================= Rendu : catégories et articles */

  function renderCategories() {
    const puces = [{ id: 'tous', nom: 'Tous' }, ...s.categories];
    zone('categories').innerHTML = puces.map((c) => `
      <button type="button" class="puce ${s.categorie === c.id ? 'active' : ''}" data-categorie="${esc(c.id)}" aria-pressed="${s.categorie === c.id}">${esc(c.nom)}</button>`).join('');
  }

  function produitsFiltres() {
    const q = normaliserTexte(s.recherche.trim());
    return s.produits.filter((p) => {
      if (s.categorie !== 'tous' && p.categorie_id !== s.categorie) return false;
      if (!q) return true;
      return normaliserTexte(p.nom).includes(q) || String(p.code_barre || '').toLowerCase().includes(q);
    });
  }

  function renderGrille() {
    if (!s.charge) return;
    const conteneurArticles = zone('articles');
    if (!s.produits.length) {
      conteneurArticles.innerHTML = `
        <div class="etat-vide etat-vide-large">
          <p>Aucun article dans votre boutique pour l’instant.</p>
          ${peut('gerer_stock')
            ? '<a class="btn btn-primaire" href="#/stock?ajouter=1">Ajouter mes premiers articles</a>'
            : '<p class="discret">Demandez au gérant d’ajouter les articles.</p>'}
        </div>`;
      return;
    }
    const liste = produitsFiltres();
    if (!liste.length) {
      conteneurArticles.innerHTML = `<div class="etat-vide etat-vide-large"><p>Aucun article ne correspond à « ${esc(s.recherche)} ».</p></div>`;
      return;
    }
    conteneurArticles.innerHTML = liste.map(articleHTML).join('');
  }

  function articleHTML(p) {
    const quantite = s.panier.get(p.id)?.quantite || 0;
    const epuise = !p.sur_commande && (Number(p.stock) || 0) <= 0;
    const stock = etatStock(p);
    const vignette = p.photo_url
      ? `<img src="${esc(p.photo_url)}" alt="" loading="lazy">`
      : icone(iconeArticle(p), 28, 1.7);
    let actionsMobile = '';
    if (quantite > 0) {
      actionsMobile = stepperHTML(p, quantite, 'article');
    } else if (!epuise) {
      actionsMobile = `<button type="button" class="btn-ajout" data-ajouter="${esc(p.id)}" aria-label="Ajouter ${esc(p.nom)} au panier">${icone('plus', 18, 2.4)}</button>`;
    }
    return `
      <div class="article ${quantite ? 'dans-panier' : ''} ${epuise ? 'epuise' : ''}">
        <button type="button" class="article-principal" data-ajouter="${esc(p.id)}" ${epuise ? 'disabled' : ''}
          aria-label="${esc(`${p.nom}, ${formatNombre(prixArticle(p))} GNF par ${p.unite || 'unité'}, ${stock.texte}${epuise ? '' : ' — ajouter au panier'}`)}">
          <span class="article-vignette">${vignette}</span>
          <span class="article-infos">
            <span class="article-nom">${esc(p.nom)}</span>
            <span class="article-prix"><strong>${formatNombre(prixArticle(p))}</strong> <span>GNF / ${esc(p.unite || 'unité')}</span></span>
            <span class="article-stock ${stock.classe}"><span class="seul-ordi">Stock : </span>${esc(stock.texte)}</span>
          </span>
          ${quantite ? `<span class="article-pastille" aria-hidden="true">${formatNombre(quantite, 3)}</span>` : ''}
        </button>
        <div class="article-actions-mobile">${actionsMobile}</div>
      </div>`;
  }

  /** Boutons −/+ avec champ quantité éditable au clavier. */
  function stepperHTML(p, quantite, contexte) {
    const id = `qte-${contexte}-${p.id}`;
    return `
      <div class="stepper ${contexte === 'article' ? 'stepper-actif' : ''}">
        <button type="button" data-action="moins" data-id="${esc(p.id)}" aria-label="Diminuer la quantité de ${esc(p.nom)}">−</button>
        <label class="sr-only" for="${id}">Quantité de ${esc(p.nom)}</label>
        <input id="${id}" class="stepper-qte" type="text" autocomplete="off" inputmode="${uniteDivisible(p.unite) ? 'decimal' : 'numeric'}"
          value="${String(quantite).replace('.', ',')}" data-qte="${esc(p.id)}">
        <button type="button" data-action="plus" data-id="${esc(p.id)}" aria-label="Augmenter la quantité de ${esc(p.nom)}">+</button>
      </div>`;
  }

  /* ======================================================= Rendu : panier */

  function renderPanier() {
    const lignes = [...s.panier.values()];
    const { sousTotal, remise, total } = totaux();
    const expiree = licenceExpiree();
    const nomClient = s.client ? s.client.nom : 'Client comptoir';

    zone('panier').classList.toggle('ouvert', s.panierOuvert);
    zone('panier').innerHTML = `
      <div class="panier-resume">
        <button type="button" class="panier-poignee" data-action="ouvrir-panier" aria-label="Afficher le détail du panier"></button>
        <div class="panier-resume-haut">
          <span class="gras">${nombreArticles()} article${nombreArticles() > 1 ? 's' : ''} · ${esc(nomClient)}</span>
          <button type="button" class="btn-lien" data-action="ouvrir-panier">Détails</button>
        </div>
        <div class="panier-resume-total">
          <span class="discret" data-ref="libelle-total">${remise ? `Total (remise − ${formatNombre(remise)})` : 'Total'}</span>
          <span class="total-grand"><span data-ref="total">${formatNombre(total)}</span> <span class="unite-gnf">GNF</span></span>
        </div>
        ${modesHTML(true)}
        <button type="button" class="btn btn-primaire btn-valider" data-action="valider" ${!lignes.length || expiree || s.enCours ? 'disabled' : ''}>
          ${s.enCours ? '<span class="spinner" aria-hidden="true"></span>Enregistrement…' : 'Valider la vente'}
        </button>
      </div>

      <div class="panier-complet">
        <div class="panier-entete">
          <button type="button" class="btn-icone btn-icone-clair seul-mobile" data-action="fermer-panier" aria-label="Fermer le détail du panier">${icone('retour', 20, 2)}</button>
          <h2 tabindex="-1">Panier</h2>
          <button type="button" class="btn-lien btn-lien-danger" data-action="vider" ${lignes.length ? '' : 'disabled'}>Vider</button>
        </div>

        ${clientHTML()}

        <div class="lignes-panier">
          ${lignes.length ? lignes.map(lignePanierHTML).join('') : '<p class="panier-vide">Touchez un article pour l’ajouter au panier.</p>'}
        </div>

        <div class="totaux">
          <div class="totaux-ligne"><span class="discret">Sous-total</span><span class="gras"><span data-ref="sous-total">${formatNombre(sousTotal)}</span> GNF</span></div>
          ${remiseHTML(remise)}
          <div class="totaux-ligne totaux-final">
            <span>Total à payer</span>
            <span class="total-grand"><span data-ref="total">${formatNombre(total)}</span> <span class="unite-gnf">GNF</span></span>
          </div>
        </div>

        <div class="bloc-modes">
          <span class="etiquette">Mode de paiement</span>
          ${modesHTML(false)}
        </div>

        ${detailModeHTML(total)}

        <label class="case-sms ${s.client?.telephone ? '' : 'inactive'}">
          <input type="checkbox" data-ref="sms" ${s.recuSms && s.client?.telephone ? 'checked' : ''} ${s.client?.telephone ? '' : 'disabled'}>
          <span>Envoyer le reçu par SMS au client${s.client?.telephone ? '' : ' <small>(client avec téléphone requis)</small>'}</span>
        </label>

        ${expiree ? `<p class="note-licence" role="alert">${icone('alerte', 18, 2)} ${MESSAGE_LICENCE}</p>` : ''}

        <div class="panier-actions">
          <button type="button" class="btn btn-secondaire btn-grand" data-action="mettre-en-attente" ${lignes.length ? '' : 'disabled'}>Mettre en attente</button>
          <button type="button" class="btn btn-primaire btn-grand btn-valider" data-action="valider" ${!lignes.length || expiree || s.enCours ? 'disabled' : ''}>
            ${s.enCours ? '<span class="spinner" aria-hidden="true"></span>Enregistrement…' : `Valider · <span data-ref="total">${formatNombre(total)}</span> GNF`}
          </button>
        </div>
      </div>`;
  }

  function clientHTML() {
    const c = s.client;
    let detail = 'Aucun client associé à la vente';
    if (c) {
      const tel = c.telephone ? formatTelephone(c.telephone) : 'Sans téléphone';
      const solde = Number(c.solde_credit) > 0 ? `crédit en cours : ${formatGNF(c.solde_credit)}` : 'aucun crédit en cours';
      detail = `${tel} · ${solde}`;
    }
    return `
      <button type="button" class="client-bouton" data-action="choisir-client">
        <span class="avatar">${c ? esc(initiales(c.nom)) : icone('client', 18, 2)}</span>
        <span class="client-textes">
          <span class="gras">${esc(c ? c.nom : 'Client comptoir')}</span>
          <span class="discret">${esc(detail)}</span>
        </span>
        <span class="lien-changer">${c ? 'Changer' : 'Choisir'}</span>
      </button>
      ${s.chantierClient ? `
        <div class="rappel-chantier">
          ${icone('casque', 18, 2)}
          <span>Ce client a un chantier ouvert (<strong class="${classeSolde(s.chantierClient.solde)}">${esc(texteSolde(s.chantierClient.solde))}</strong>).</span>
          <button type="button" class="btn-lien" data-action="enlevement-chantier">Faire un enlèvement chantier</button>
        </div>` : ''}`;
  }

  function lignePanierHTML({ produit, quantite }) {
    const prix = prixArticle(produit);
    return `
      <div class="ligne-panier">
        <div class="ligne-panier-infos">
          <span class="gras">${esc(produit.nom)}</span>
          <span class="discret">${formatNombre(prix)} GNF / ${esc(produit.unite || 'unité')}</span>
        </div>
        ${stepperHTML(produit, quantite, 'panier')}
        <span class="ligne-panier-total">${formatNombre(Math.round(prix * quantite))}</span>
      </div>`;
  }

  function remiseHTML(remise) {
    if (s.editionRemise) {
      return `
        <div class="totaux-ligne">
          <label for="remise" class="gras lien-remise">Remise (GNF)</label>
          <input id="remise" class="input input-petit" type="number" inputmode="numeric" min="0" step="1" value="${s.remise || ''}" data-ref="remise" placeholder="0">
        </div>`;
    }
    return `
      <div class="totaux-ligne">
        <button type="button" class="btn-lien lien-remise" data-action="remise">${remise ? 'Remise' : '+ Ajouter une remise'}</button>
        <span class="gras texte-succes">${remise ? `− ${formatNombre(remise)} GNF` : ''}</span>
      </div>`;
  }

  function modesHTML(compact) {
    return `
      <div class="modes ${compact ? 'modes-compacts' : ''}" role="group" aria-label="Mode de paiement">
        ${Object.entries(MODES_PAIEMENT).filter(([code]) => MODES_CAISSE.includes(code)).map(([code, m]) => `
          <button type="button" class="mode" data-mode="${code}" aria-pressed="${s.mode === code}">
            ${compact ? '' : `<span class="mode-pastille" style="background:${m.couleur}"></span>`}
            ${esc(compact ? m.court : m.libelle)}
          </button>`).join('')}
      </div>`;
  }

  function detailModeHTML(total) {
    if (s.mode === 'especes') {
      return `
        <div class="detail-mode">
          <div class="champ">
            <label for="montant-recu">Montant reçu (GNF)</label>
            <input id="montant-recu" class="input" type="number" inputmode="numeric" min="0" step="1" data-ref="montant-recu" value="${s.montantRecu ?? ''}" placeholder="${total || 0}">
          </div>
          <div class="totaux-ligne"><span class="discret">Monnaie à rendre</span><span class="gras" data-ref="monnaie">${texteMonnaie(total)}</span></div>
        </div>`;
    }
    if (s.mode === 'orange_money' || s.mode === 'mtn_momo') {
      return `
        <div class="detail-mode encadre-info">
          <span class="gras">Paiement ${esc(MODES_PAIEMENT[s.mode].libelle)}</span>
          <span>Vérifiez que le paiement est bien arrivé sur le téléphone de la boutique avant de valider.</span>
        </div>`;
    }
    return `
      <div class="detail-mode">
        ${s.client ? '' : `<p class="note-alerte">${icone('alerte', 16, 2)} Choisissez un client pour une vente à crédit.</p>`}
        <div class="champ">
          <label for="echeance">Date d’échéance</label>
          <input id="echeance" class="input" type="date" min="${dateISO()}" value="${esc(s.echeance)}" data-ref="echeance">
        </div>
      </div>`;
  }

  function texteMonnaie(total) {
    if (s.montantRecu === null) return '—';
    const monnaie = s.montantRecu - total;
    return monnaie >= 0 ? formatGNF(monnaie) : `Il manque ${formatGNF(-monnaie)}`;
  }

  /** Met à jour les montants sans reconstruire le panier (préserve la saisie en cours). */
  function majTotaux() {
    const { sousTotal, remise, total } = totaux();
    refs('total').forEach((el) => { el.textContent = formatNombre(total); });
    refs('sous-total').forEach((el) => { el.textContent = formatNombre(sousTotal); });
    refs('libelle-total').forEach((el) => { el.textContent = remise ? `Total (remise − ${formatNombre(remise)})` : 'Total'; });
    refs('monnaie').forEach((el) => { el.textContent = texteMonnaie(total); });
  }

  function renderAttente() {
    refs('nb-attente').forEach((el) => { el.textContent = String(lireAttente().length); });
  }

  function renderTout() {
    renderGrille();
    renderPanier();
  }

  /* ======================================================= Panier : actions */

  function definirQuantite(id, quantiteSaisie) {
    const produit = s.panier.get(id)?.produit || s.produits.find((p) => p.id === id);
    if (!produit) return;
    if (quantiteSaisie === null || quantiteSaisie <= 0) {
      s.panier.delete(id);
      renderTout();
      return;
    }
    let quantite = uniteDivisible(produit.unite)
      ? Math.round(quantiteSaisie * 1000) / 1000
      : Math.max(1, Math.round(quantiteSaisie));
    const max = quantiteMax(produit);
    if (quantite > max) {
      quantite = max;
      toast(`Stock insuffisant : il reste ${formatQuantite(max, produit.unite)} de « ${produit.nom} ».`, 'erreur');
    }
    if (quantite <= 0) s.panier.delete(id);
    else s.panier.set(id, { produit, quantite });
    renderTout();
  }

  function ajouter(id, delta) {
    definirQuantite(id, (s.panier.get(id)?.quantite || 0) + delta);
  }

  function viderPanier() {
    s.panier.clear();
    s.client = null;
    s.chantierClient = null;
    s.remise = 0;
    s.editionRemise = false;
    s.montantRecu = null;
    s.mode = 'especes';
    s.echeance = dateISO(ECHEANCE_PAR_DEFAUT_JOURS);
    s.recuSms = false;
  }

  function choisirClient(client) {
    s.client = client;
    s.recuSms = Boolean(client?.telephone);
    s.chantierClient = null;
    renderPanier();
    if (client) verifierChantierClient(client.id);
  }

  /** Rappel discret si le client choisi a un chantier ouvert. */
  async function verifierChantierClient(idClient) {
    try {
      const chantier = await chargerChantierOuvert(idClient);
      if (s.client?.id !== idClient || !chantier) return;
      s.chantierClient = chantier;
      renderPanier();
    } catch (err) {
      console.warn('[YOUMMA] Chantier du client non vérifié :', err);
    }
  }

  /** Ouvre l'écran d'enlèvement du chantier avec les articles du panier déjà saisis. */
  function versEnlevementChantier() {
    const lignes = [...s.panier.values()].map(({ produit, quantite }) => `${produit.id}:${quantite}`).join(',');
    const params = new URLSearchParams({ prix: s.typePrix });
    if (lignes) params.set('lignes', lignes);
    naviguer(`chantiers/${s.chantierClient.id}/enlevement?${params}`);
  }

  function basculerPanier(ouvert) {
    s.panierOuvert = ouvert;
    document.body.classList.toggle('panier-plein-ecran', ouvert);
    renderPanier();
    if (ouvert) zone('panier').querySelector('.panier-complet h2')?.focus?.();
  }

  /** Entrée dans la recherche : ajoute l'article si le code-barres correspond ou s'il n'y a qu'un résultat. */
  function ajoutRapide() {
    const q = s.recherche.trim();
    if (!q) return;
    const parCode = s.produits.find((p) => p.code_barre && String(p.code_barre) === q);
    const liste = parCode ? [parCode] : produitsFiltres();
    if (liste.length !== 1) return;
    const p = liste[0];
    if (!p.sur_commande && (Number(p.stock) || 0) <= 0) {
      toast(`« ${p.nom} » est épuisé.`, 'erreur');
      return;
    }
    ajouter(p.id, 1);
    const champ = conteneur.querySelector('#recherche-caisse');
    champ.value = '';
    s.recherche = '';
    renderGrille();
    champ.focus();
  }

  /* ======================================================= Ventes en attente (localStorage) */

  function lireAttente() {
    const liste = lireStockage(cleAttente, []);
    return Array.isArray(liste) ? liste : [];
  }

  function ecrireAttente(liste) {
    if (!ecrireStockage(cleAttente, liste)) {
      toast('Impossible d’enregistrer sur cet appareil (stockage indisponible).', 'erreur');
      return false;
    }
    return true;
  }

  function mettreEnAttente() {
    if (!s.panier.size) return;
    const liste = lireAttente();
    liste.push({
      id: Date.now(),
      cree_le: new Date().toISOString(),
      client: s.client,
      typePrix: s.typePrix,
      remise: s.remise,
      lignes: [...s.panier.values()].map(({ produit, quantite }) => ({ produit_id: produit.id, nom: produit.nom, quantite }))
    });
    if (!ecrireAttente(liste)) return;
    viderPanier();
    basculerPanier(false);
    renderTout();
    renderAttente();
    toast('Vente mise en attente.', 'succes');
  }

  function totalEstime(vente) {
    return vente.lignes.reduce((somme, l) => {
      const p = s.produits.find((x) => x.id === l.produit_id);
      if (!p) return somme;
      const prix = vente.typePrix === 'gros' && p.prix_gros !== null ? Number(p.prix_gros) : Number(p.prix_detail);
      return somme + prix * l.quantite;
    }, 0) - (Number(vente.remise) || 0);
  }

  function ouvrirListeAttente() {
    const liste = lireAttente();
    const { el, fermer } = ouvrirModale({
      titre: `Ventes en attente (${liste.length})`,
      contenu: liste.length ? `
        <ul class="liste-attente">
          ${liste.map((v) => `
            <li class="item-attente">
              <div class="item-attente-textes">
                <span class="gras">${esc(v.client?.nom || 'Client comptoir')} · ${formatGNF(Math.max(0, totalEstime(v)))}</span>
                <span class="discret">${v.lignes.length} article${v.lignes.length > 1 ? 's' : ''} · mise en attente à ${esc(formatDate(v.cree_le, 'heure'))}</span>
                <span class="discret">${esc(v.lignes.map((l) => l.nom).join(', '))}</span>
              </div>
              <div class="item-attente-actions">
                <button type="button" class="btn btn-primaire" data-reprendre="${v.id}">Reprendre</button>
                <button type="button" class="btn-icone btn-icone-clair btn-icone-danger" data-supprimer="${v.id}" aria-label="Supprimer cette vente en attente">${icone('corbeille', 18, 2)}</button>
              </div>
            </li>`).join('')}
        </ul>` : '<p class="texte-modale">Aucune vente en attente. Utilisez « Mettre en attente » pour garder un panier de côté.</p>'
    });

    el.addEventListener('click', async (e) => {
      const boutonReprendre = e.target.closest('[data-reprendre]');
      const boutonSupprimer = e.target.closest('[data-supprimer]');
      if (boutonSupprimer) {
        ecrireAttente(lireAttente().filter((v) => String(v.id) !== boutonSupprimer.dataset.supprimer));
        boutonSupprimer.closest('li').remove();
        renderAttente();
        if (!el.querySelector('li')) fermer();
      }
      if (boutonReprendre) {
        if (s.panier.size && !(await confirmer('Le panier en cours sera remplacé par la vente en attente.', { libelleOk: 'Remplacer' }))) return;
        fermer();
        reprendreVente(boutonReprendre.dataset.reprendre);
      }
    });
  }

  function reprendreVente(id) {
    const liste = lireAttente();
    const vente = liste.find((v) => String(v.id) === String(id));
    if (!vente) return;
    viderPanier();
    s.typePrix = vente.typePrix === 'gros' ? 'gros' : 'detail';
    s.client = vente.client || null;
    s.recuSms = Boolean(s.client?.telephone);
    s.remise = Number(vente.remise) || 0;
    let ignores = 0;
    vente.lignes.forEach((l) => {
      const produit = s.produits.find((p) => p.id === l.produit_id);
      if (!produit) { ignores++; return; }
      const quantite = Math.min(Number(l.quantite) || 0, quantiteMax(produit));
      if (quantite > 0) s.panier.set(produit.id, { produit, quantite });
      else ignores++;
    });
    ecrireAttente(liste.filter((v) => String(v.id) !== String(id)));
    majBasculePrix();
    renderTout();
    renderAttente();
    if (ignores) toast(`${ignores} article${ignores > 1 ? 's' : ''} retiré${ignores > 1 ? 's' : ''} (épuisé ou désactivé).`, 'info');
  }

  /* ======================================================= Choix / création du client */

  function ouvrirChoixClient() {
    const { el, fermer } = ouvrirModale({
      titre: 'Client de la vente',
      contenu: `
        <div class="champ">
          <label for="recherche-client">Rechercher un client</label>
          <input id="recherche-client" class="input" type="search" placeholder="Nom ou téléphone" autocomplete="off">
        </div>
        <div class="liste-clients" data-zone="resultats-clients" aria-live="polite"><p class="discret">Chargement…</p></div>
        <button type="button" class="btn btn-secondaire btn-bloc" data-action="nouveau-client">${icone('plus', 18, 2.2)} Nouveau client</button>`
    });
    const resultats = el.querySelector('[data-zone="resultats-clients"]');
    let clientsAffiches = [];

    async function rechercher(texte) {
      let requete = sb.from('clients').select('id, nom, telephone, solde_credit').eq('boutique_id', boutique.id).order('nom').limit(12);
      const q = texte.replace(/[,()*%\\]/g, ' ').trim();
      if (q) {
        const chiffres = q.replace(/\D/g, '');
        requete = requete.or(`nom.ilike.%${q}%${chiffres.length >= 3 ? `,telephone.ilike.%${chiffres}%` : ''}`);
      }
      const { data, error } = await requete;
      if (error) { resultats.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(error))}</p>`; return; }
      clientsAffiches = data;
      resultats.innerHTML = `
        <button type="button" class="item-client" data-client="">
          <span class="avatar">${icone('client', 18, 2)}</span>
          <span class="client-textes"><span class="gras">Client comptoir</span><span class="discret">Vente sans client (pas de crédit possible)</span></span>
        </button>
        ${data.map((c) => `
          <button type="button" class="item-client" data-client="${esc(c.id)}">
            <span class="avatar">${esc(initiales(c.nom))}</span>
            <span class="client-textes">
              <span class="gras">${esc(c.nom)}</span>
              <span class="discret">${esc(c.telephone ? formatTelephone(c.telephone) : 'Sans téléphone')}${Number(c.solde_credit) > 0 ? ` · crédit ${formatGNF(c.solde_credit)}` : ''}</span>
            </span>
          </button>`).join('')}
        ${!data.length && q ? `<p class="discret">Aucun client trouvé pour « ${esc(texte)} ».</p>` : ''}`;
    }

    el.querySelector('#recherche-client').addEventListener('input', differer((e) => rechercher(e.target.value), 250));
    el.addEventListener('click', (e) => {
      const item = e.target.closest('[data-client]');
      if (item) {
        choisirClient(item.dataset.client ? clientsAffiches.find((c) => c.id === item.dataset.client) : null);
        fermer();
      }
      if (e.target.closest('[data-action="nouveau-client"]')) {
        fermer();
        ouvrirFormulaireClient({ onEnregistre: choisirClient });
      }
    });
    rechercher('');
  }

  /** Client passé dans l'URL (#/caisse?client=<id>, depuis sa fiche) : présélectionné. */
  async function preselectionnerClient(idClient) {
    try {
      const client = await chargerClient(boutique.id, idClient);
      if (client && conteneur.isConnected) choisirClient(client);
      else if (!client) toast('Client introuvable dans cette boutique.', 'erreur');
    } catch (err) {
      toast(messageErreur(err), 'erreur');
    }
  }

  /* ======================================================= Validation de la vente */

  async function valider() {
    if (s.enCours || !s.panier.size) return;
    if (licenceExpiree()) { toast(MESSAGE_LICENCE, 'erreur'); return; }
    const { sousTotal, remise, total } = totaux();

    if (s.mode === 'credit') {
      if (!s.client) {
        toast('Une vente à crédit nécessite un client.', 'erreur');
        ouvrirChoixClient();
        return;
      }
      if (!s.echeance || s.echeance < dateISO()) {
        toast('Choisissez une date d’échéance à venir.', 'erreur');
        basculerPanier(true);
        return;
      }
    }
    if (s.mode === 'especes' && s.montantRecu !== null && s.montantRecu < total) {
      toast(`Le montant reçu est inférieur au total (il manque ${formatGNF(total - s.montantRecu)}).`, 'erreur');
      basculerPanier(true);
      return;
    }

    const instantane = {
      client: s.client,
      mode: s.mode,
      montantRecu: s.mode === 'especes' ? s.montantRecu : null,
      echeance: s.mode === 'credit' ? s.echeance : null,
      recuSms: Boolean(s.recuSms && s.client?.telephone),
      sousTotal,
      remise,
      lignes: [...s.panier.values()].map(({ produit, quantite }) => ({
        nom_produit: produit.nom, unite: produit.unite, quantite,
        prix_unitaire: prixArticle(produit), total: Math.round(prixArticle(produit) * quantite)
      }))
    };

    s.enCours = true;
    renderPanier();
    try {
      const { data, error } = await sb.rpc('valider_vente', {
        p_boutique: boutique.id,
        p_client: s.client?.id || null,
        p_lignes: [...s.panier.values()].map(({ produit, quantite }) => ({ produit_id: produit.id, quantite })),
        p_remise: remise,
        p_mode: s.mode,
        p_type_prix: s.typePrix,
        p_echeance: instantane.echeance,
        p_recu_sms: instantane.recuSms
      });
      if (error) throw error;
      const vente = (Array.isArray(data) ? data[0] : data) || {};
      s.enCours = false;
      viderPanier();
      s.panierOuvert = false;
      document.body.classList.remove('panier-plein-ecran');
      renderPanier();
      afficherConfirmation(vente, instantane);
      if (instantane.mode === 'credit') {
        toast(`Vente à crédit enregistrée pour ${instantane.client.nom}.`, 'succes', 8000,
          { libelle: 'Voir la fiche du client', href: `#/clients/${encodeURIComponent(instantane.client.id)}` });
      }
      chargerDonnees();
    } catch (err) {
      s.enCours = false;
      renderPanier();
      toast(messageErreur(err), 'erreur', 6000);
      const message = String(err?.message || '');
      if (message.includes('STOCK_INSUFFISANT') || message.includes('PRODUIT_INTROUVABLE')) chargerDonnees();
    }
  }

  function afficherConfirmation(vente, instantane) {
    const total = Number(vente.total ?? instantane.sousTotal - instantane.remise) || 0;
    const monnaie = instantane.montantRecu !== null ? instantane.montantRecu - total : null;
    const recu = {
      numero: vente.numero,
      date: new Date().toISOString(),
      client: instantane.client,
      mode: instantane.mode,
      echeance: instantane.echeance,
      lignes: instantane.lignes,
      sousTotal: instantane.sousTotal,
      remise: instantane.remise,
      total,
      montantRecu: instantane.montantRecu,
      monnaie
    };
    // Les montants exacts (recalculés par le serveur) remplacent l'aperçu dès qu'ils arrivent.
    const recuServeur = chargerRecuServeur(vente.id, recu);

    const { el, fermer } = ouvrirModale({
      titre: 'Vente enregistrée',
      contenu: `
        <div class="confirmation">
          <span class="confirmation-icone">${icone('valide', 32, 2.6)}</span>
          <p class="confirmation-numero">Vente ${esc(formatNumeroVente(vente.numero))}</p>
          <p class="confirmation-total">${formatGNF(total)}</p>
          <p class="discret">${esc(MODES_PAIEMENT[instantane.mode].libelle)}${instantane.client ? ' · ' + esc(instantane.client.nom) : ''}</p>
          ${monnaie !== null ? `<div class="confirmation-monnaie"><span>Monnaie à rendre</span><strong>${formatGNF(Math.max(0, monnaie))}</strong></div>` : ''}
          ${instantane.echeance ? `<p class="discret">Ajouté au crédit du client · échéance le ${esc(formatDate(instantane.echeance, 'court'))}</p>` : ''}
        </div>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire btn-grand" data-action="imprimer">${icone('imprimante', 18, 2)} Imprimer le reçu</button>
          <button type="button" class="btn btn-primaire btn-grand" data-action="nouvelle-vente">Nouvelle vente</button>
        </div>`,
      onFermer: () => conteneur.querySelector('#recherche-caisse')?.focus()
    });
    el.querySelector('[data-action="nouvelle-vente"]').focus();
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="nouvelle-vente"]')) fermer();
      const boutonImprimer = e.target.closest('[data-action="imprimer"]');
      if (boutonImprimer) {
        boutonOccupe(boutonImprimer, true, 'Préparation…');
        const recuFinal = await recuServeur;
        imprimerRecuVente({ ...recuFinal, client: recuFinal.client?.nom || null, vendeur: etat.membre?.nom });
        boutonOccupe(boutonImprimer, false);
      }
    });
  }

  /** Relit la vente et ses lignes enregistrées ; garde l'aperçu local en cas d'échec. */
  async function chargerRecuServeur(idVente, recuLocal) {
    if (!idVente) return recuLocal;
    try {
      const [venteRes, lignesRes] = await Promise.all([
        sb.from('ventes').select('numero, created_at, sous_total, remise, total, mode_paiement, echeance').eq('id', idVente).single(),
        sb.from('ventes_lignes').select('nom_produit, unite, quantite, prix_unitaire, total').eq('vente_id', idVente)
      ]);
      if (venteRes.error || lignesRes.error) return recuLocal;
      const v = venteRes.data;
      return {
        ...recuLocal,
        numero: v.numero,
        date: v.created_at,
        mode: v.mode_paiement,
        echeance: v.echeance,
        sousTotal: Number(v.sous_total),
        remise: Number(v.remise),
        total: Number(v.total),
        monnaie: recuLocal.montantRecu !== null ? recuLocal.montantRecu - Number(v.total) : null,
        lignes: lignesRes.data.length ? lignesRes.data : recuLocal.lignes
      };
    } catch {
      return recuLocal;
    }
  }

  /* ======================================================= Chargement des données */

  async function chargerDonnees() {
    const [produitsRes, categoriesRes] = await Promise.all([
      sb.from('produits')
        .select('id, categorie_id, nom, unite, prix_detail, prix_gros, stock, seuil_alerte, sur_commande, code_barre, photo_url')
        .eq('boutique_id', boutique.id)
        .eq('actif', true)
        .order('nom'),
      sb.from('categories').select('id, nom, ordre').eq('boutique_id', boutique.id).order('ordre').order('nom')
    ]);
    if (produitsRes.error || categoriesRes.error) {
      zone('articles').innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(produitsRes.error || categoriesRes.error))}</p>`;
      return;
    }
    s.produits = produitsRes.data;
    s.categories = categoriesRes.data;
    s.charge = true;
    if (s.categorie !== 'tous' && !s.categories.some((c) => c.id === s.categorie)) s.categorie = 'tous';

    // Le panier suit les stocks à jour ; un article désactivé entre-temps en est retiré.
    s.panier.forEach((ligne, id) => {
      const produit = s.produits.find((p) => p.id === id);
      if (produit) ligne.produit = produit;
      else s.panier.delete(id);
    });
    renderCategories();
    renderTout();
  }

  function majBasculePrix() {
    conteneur.querySelectorAll('[data-prix]').forEach((b) => {
      const actif = b.dataset.prix === s.typePrix;
      b.classList.toggle('actif', actif);
      b.setAttribute('aria-pressed', String(actif));
    });
  }

  /* ======================================================= Événements */

  conteneur.addEventListener('click', async (e) => {
    const cible = e.target.closest('[data-ajouter], [data-action], [data-mode], [data-prix], [data-categorie]');
    if (!cible || cible.disabled) return;

    if (cible.dataset.ajouter) return ajouter(cible.dataset.ajouter, 1);
    if (cible.dataset.mode) { s.mode = cible.dataset.mode; return renderPanier(); }
    if (cible.dataset.prix) { s.typePrix = cible.dataset.prix; majBasculePrix(); return renderTout(); }
    if (cible.dataset.categorie) { s.categorie = cible.dataset.categorie; renderCategories(); return renderGrille(); }

    switch (cible.dataset.action) {
      case 'plus': return ajouter(cible.dataset.id, 1);
      case 'moins': return ajouter(cible.dataset.id, -1);
      case 'vider':
        if (await confirmer('Retirer tous les articles du panier ?', { libelleOk: 'Vider le panier', danger: true })) {
          viderPanier();
          renderTout();
        }
        return undefined;
      case 'remise':
        s.editionRemise = true;
        renderPanier();
        return conteneur.querySelector('#remise')?.focus();
      case 'choisir-client': return ouvrirChoixClient();
      case 'enlevement-chantier': return versEnlevementChantier();
      case 'mettre-en-attente': return mettreEnAttente();
      case 'liste-attente': return ouvrirListeAttente();
      case 'valider': return valider();
      case 'ouvrir-panier': return basculerPanier(true);
      case 'fermer-panier': return basculerPanier(false);
      default: return undefined;
    }
  });

  conteneur.addEventListener('input', (e) => {
    const ref = e.target.dataset.ref;
    if (e.target.id === 'recherche-caisse') { s.recherche = e.target.value; renderGrille(); }
    if (ref === 'montant-recu') { s.montantRecu = lireNombre(e.target.value); majTotaux(); }
    if (ref === 'remise') { s.remise = Math.max(0, lireNombre(e.target.value) || 0); majTotaux(); }
    if (ref === 'echeance') s.echeance = e.target.value;
  });

  conteneur.addEventListener('change', (e) => {
    if (e.target.dataset.qte) {
      // Saisie illisible : on garde la quantité précédente (seul 0 retire l’article).
      const quantite = lireNombre(e.target.value);
      if (quantite === null) renderTout();
      else definirQuantite(e.target.dataset.qte, quantite);
    }
    if (e.target.dataset.ref === 'sms') s.recuSms = e.target.checked;
    if (e.target.dataset.ref === 'remise') {
      s.remise = totaux().remise;
      s.editionRemise = false;
      renderPanier();
    }
  });

  conteneur.addEventListener('keydown', (e) => {
    if (e.target.id === 'recherche-caisse' && e.key === 'Enter') { e.preventDefault(); ajoutRapide(); }
  });

  // Raccourci F2 : focus sur la recherche.
  function surToucheGlobale(e) {
    if (e.key === 'F2') {
      e.preventDefault();
      conteneur.querySelector('#recherche-caisse')?.focus();
    }
  }
  document.addEventListener('keydown', surToucheGlobale);

  /* ======================================================= Démarrage */

  renderPanier();
  renderAttente();
  chargerDonnees();
  if (params?.get('client')) preselectionnerClient(params.get('client'));
  if (params?.get('vendre') !== null || window.matchMedia('(min-width: 900px)').matches) {
    conteneur.querySelector('#recherche-caisse').focus({ preventScroll: true });
  }

  return function nettoyer() {
    document.removeEventListener('keydown', surToucheGlobale);
    document.body.classList.remove('panier-plein-ecran');
  };
}
