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
import { chargerSoldeSms } from './sms.js';
import { chargerReglages, typeVente, ouvrirDocument } from './documents/donnees.js';
import { vignetteProduit } from './images/affichage.js';
import { aModule, vocab, unArticle } from './modules.js';
import { chargerUnitesArticles, ouvrirChoixUnite, prixUnite, quantiteEnUnite, completerLignesBase } from './unites.js';
import { aVariantes, ouvrirChoixVariante, chercherVarianteParCode, chargerVariantes, oublierVariantes, nomAvecVariante, libelleVariante } from './variantes.js';
import {
  esc, icone, toast, confirmer, ouvrirModale, boutonOccupe, messageErreur, differer, lireNombre,
  lireStockage, ecrireStockage, prenom, initiales, formatNombre, formatGNF, formatQuantite, formatDate,
  formatTelephone, formatNumeroVente, uniteDivisible, dateISO, texteSolde, classeSolde, MODES_PAIEMENT, MODES_CAISSE, prixApplique, promoActive
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
    /**
     * Map clé → { produit, quantite, variante? } ; clé = produit_id, ou « produit_id|variante_id » pour une case
     * taille × couleur (deux tailles du même modèle = deux lignes).
     */
    panier: new Map(),
    client: null,
    /** Case « reçu par SMS » cochée par défaut : crédit SMS disponible et modèle « recu_vente » actif. */
    recuSmsParDefaut: true,
    /** Chantier ouvert du client choisi (rappel « Faire un enlèvement chantier »). */
    chantierClient: null,
    remise: 0,
    editionRemise: false,
    mode: 'especes',
    montantRecu: null,
    echeance: dateISO(ECHEANCE_PAR_DEFAUT_JOURS),
    recuSms: false,
    enCours: false,
    panierOuvert: false,
    /** Devis en cours de transformation en vente (relu en base) : { id, numero, total, lignes, libres, client_nom }. */
    devis: null,
    /** Unités de vente actives (module « unites ») : produit_id → [{ id, nom, facteur, prix, prix_gros }]. */
    unites: new Map(),
    /** Codes-barres des cases des modèles chargés (code → case) : scan possible sans réseau. */
    codesCases: new Map(),
    /** Réglages des documents (facture A4 / reçu A4, format par défaut). */
    reglagesDocs: null
  };
  const cleAttente = `yb_attente_${boutique.id}`;
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);
  const refs = (nom) => conteneur.querySelectorAll(`[data-ref="${nom}"]`);

  /* ======================================================= Calculs */

  /**
   * Prix appliqué selon la bascule détail / gros (pas de prix gros → prix détail).
   * Promo active : prix promo au détail ; au gros, le plus bas des deux (même règle que valider_vente).
   */
  function prixArticle(p) {
    return prixApplique(p, s.typePrix);
  }

  function quantiteMax(p) {
    return p.sur_commande ? Infinity : Math.max(0, Number(p.stock) || 0);
  }

  const cleLigne = (idProduit, idVariante) => (idVariante ? `${idProduit}|${idVariante}` : idProduit);
  const cleUnite = (idProduit, idUnite) => (idUnite ? `${idProduit}#${idUnite}` : idProduit);
  /** Article vendu dans plusieurs unités (tonne, botte…) : choix de l'unité avant la quantité. */
  const avecUnites = (p) => Boolean(s.unites.get(p.id)?.length) && !aVariantes(p);
  /** Prix d'une ligne : prix de l'unité, prix spécial de la case, sinon celui de l'article (détail / gros, promo). */
  function prixLigne(l) {
    if (l.unite) return prixUnite(l.produit, l.unite, s.typePrix);
    return l.variante?.prix ?? prixArticle(l.produit);
  }
  /** Quantité de l'article déjà dans le panier, en unité de base (sauf la ligne « sauf »). */
  function baseUtilisee(idProduit, sauf = null) {
    let n = 0;
    s.panier.forEach((l, cle) => { if (l.produit.id === idProduit && cle !== sauf) n += l.quantite * (l.unite?.facteur || 1); });
    return n;
  }
  function maxLigne(l, cle = null) {
    if (l.unite && !l.produit.sur_commande) return Math.max(0, (Number(l.produit.stock) - baseUtilisee(l.produit.id, cle)) / l.unite.facteur);
    return l.variante && !l.produit.sur_commande ? Math.max(0, Number(l.variante.stock) || 0) : quantiteMax(l.produit);
  }
  /** Quantité d'un article dans le panier, toutes tailles et unités confondues (unité de base). */
  function quantiteProduit(id) {
    return baseUtilisee(id);
  }

  function totaux() {
    let sousTotal = 0;
    s.panier.forEach((l) => { sousTotal += prixLigne(l) * l.quantite; });
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
          ${aModule('prix_gros') ? `<div class="segments segments-sombre" role="group" aria-label="Type de prix">
            <button type="button" class="segment actif" data-prix="detail" aria-pressed="true">Prix détail</button>
            <button type="button" class="segment" data-prix="gros" aria-pressed="false">Prix gros</button>
          </div>` : ''}
          <button type="button" class="btn btn-sombre" data-action="liste-attente">
            ${icone('horloge', 18, 2)}<span>Ventes en attente (<span data-ref="nb-attente">0</span>)</span>
          </button>
        </div>
      </header>

      <div class="caisse-corps">
        <section class="catalogue" aria-label="Articles">
          <div class="bandeau-devis" data-zone="devis" hidden></div>
          <label class="recherche-caisse">
            ${icone('recherche', 20, 2)}
            <span class="sr-only">Rechercher ${esc(unArticle())} ou scanner un code-barres</span>
            <input id="recherche-caisse" type="search" placeholder="Rechercher ${esc(unArticle())} ou scanner un code-barres…" autocomplete="off" enterkeyhint="search">
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
          <p>Aucun${unArticle().startsWith('une') ? 'e' : ''} ${esc(vocab('article').toLowerCase())} dans votre boutique pour l’instant.</p>
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
    const quantite = quantiteProduit(p.id);
    const epuise = !p.sur_commande && (Number(p.stock) || 0) <= 0;
    const stock = etatStock(p);
    const vignette = vignetteProduit(p, 120, icone(iconeArticle(p), 28, 1.7));
    let actionsMobile = '';
    if (quantite > 0 && !aVariantes(p) && !avecUnites(p)) {
      actionsMobile = stepperHTML(p, quantite, 'article');
    } else if (!epuise) {
      actionsMobile = `<button type="button" class="btn-ajout" data-ajouter="${esc(p.id)}" aria-label="Ajouter ${esc(p.nom)} au panier">${icone('plus', 18, 2.4)}</button>`;
    }
    return `
      <div class="article ${quantite ? 'dans-panier' : ''} ${epuise ? 'epuise' : ''}">
        <button type="button" class="article-principal" data-ajouter="${esc(p.id)}" ${epuise ? 'disabled' : ''}
          aria-label="${esc(`${p.nom}, ${formatNombre(prixArticle(p))} GNF par ${p.unite || 'unité'}, ${stock.texte}${epuise ? '' : ' — ajouter au panier'}`)}">
          <span class="article-vignette">${vignette}${promoActive(p) ? '<span class="badge-promo badge-promo-vignette">Promo</span>' : ''}</span>
          <span class="article-infos">
            <span class="article-nom">${esc(p.nom)}</span>
            <span class="article-prix">${promoActive(p) && prixArticle(p) < Number(p.prix_detail) ? `<s class="prix-barre">${formatNombre(p.prix_detail)}</s> ` : ''}<strong>${formatNombre(prixArticle(p))}</strong> <span>GNF / ${esc(p.unite || 'unité')}</span></span>
            <span class="article-stock ${stock.classe}"><span class="seul-ordi">Stock : </span>${esc(stock.texte)}</span>
          </span>
          ${quantite ? `<span class="article-pastille" aria-hidden="true">${formatNombre(quantite, 3)}</span>` : ''}
        </button>
        <div class="article-actions-mobile">${actionsMobile}</div>
      </div>`;
  }

  /** Boutons −/+ avec champ quantité éditable au clavier. */
  function stepperHTML(p, quantite, contexte, cle = p.id, nom = p.nom) {
    const id = `qte-${contexte}-${cle}`;
    return `
      <div class="stepper ${contexte === 'article' ? 'stepper-actif' : ''}">
        <button type="button" data-action="moins" data-id="${esc(cle)}" aria-label="Diminuer la quantité de ${esc(nom)}">−</button>
        <label class="sr-only" for="${esc(id)}">Quantité de ${esc(nom)}</label>
        <input id="${esc(id)}" class="stepper-qte" type="text" autocomplete="off" inputmode="${uniteDivisible(p.unite) ? 'decimal' : 'numeric'}"
          value="${String(quantite).replace('.', ',')}" data-qte="${esc(cle)}">
        <button type="button" data-action="plus" data-id="${esc(cle)}" aria-label="Augmenter la quantité de ${esc(nom)}">+</button>
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
          ${lignes.length ? [...s.panier.entries()].map(([cle, l]) => lignePanierHTML(l, cle)).join('') : '<p class="panier-vide">Touchez un article pour l’ajouter au panier.</p>'}
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

        ${aModule('messages') ? `<label class="case-sms ${s.client?.telephone ? '' : 'inactive'}">
          <input type="checkbox" data-ref="sms" ${s.recuSms && s.client?.telephone ? 'checked' : ''} ${s.client?.telephone ? '' : 'disabled'}>
          <span>Envoyer le reçu par SMS au client${s.client?.telephone ? '' : ' <small>(client avec téléphone requis)</small>'}</span>
        </label>` : ''}

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

  function lignePanierHTML(ligne, cle) {
    const { produit, quantite, variante, unite } = ligne;
    const prix = prixLigne(ligne);
    const nom = unite ? `${produit.nom} — ${quantiteEnUnite(quantite, unite.nom)}` : nomAvecVariante(produit.nom, variante?.libelle);
    return `
      <div class="ligne-panier">
        <div class="ligne-panier-infos">
          <span class="gras">${esc(nom)}</span>
          <span class="discret">${formatNombre(prix)} GNF / ${esc(unite ? unite.nom.toLowerCase() : produit.unite || 'unité')}${unite ? ` · ${esc(formatQuantite(Math.round(quantite * unite.facteur * 1000) / 1000, produit.unite))}` : ''}</span>
        </div>
        ${stepperHTML(produit, quantite, 'panier', cle, nom)}
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
        ${Object.entries(MODES_PAIEMENT).filter(([code]) => MODES_CAISSE.includes(code) && (code !== 'credit' || aModule('credits'))).map(([code, m]) => `
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
    if (s.devis) renderBandeauDevis();
  }

  function renderAttente() {
    refs('nb-attente').forEach((el) => { el.textContent = String(lireAttente().length); });
  }

  function renderTout() {
    renderGrille();
    renderPanier();
    if (s.devis) renderBandeauDevis();
  }

  /* ======================================================= Panier : actions */

  function definirQuantite(id, quantiteSaisie) {
    const ligne = s.panier.get(id);
    const produit = ligne?.produit || s.produits.find((p) => p.id === id);
    if (!produit) return;
    // Modèle à tailles / couleurs : une ligne par case, choisie dans le panneau.
    if (!ligne && aVariantes(produit)) { choisirVariante(produit); return; }
    if (quantiteSaisie === null || quantiteSaisie <= 0) {
      s.panier.delete(id);
      renderTout();
      return;
    }
    let quantite = uniteDivisible(produit.unite)
      ? Math.round(quantiteSaisie * 1000) / 1000
      : Math.max(1, Math.round(quantiteSaisie));
    if (ligne?.unite) quantite = Math.round(quantiteSaisie * 1000) / 1000;
    const max = ligne ? maxLigne(ligne, id) : quantiteMax(produit) - baseUtilisee(produit.id, id);
    if (quantite > max) {
      quantite = ligne?.unite ? Math.floor(max * 1000) / 1000 : max;
      // Stock et messages en unité de base.
      toast(`Stock insuffisant : il reste ${formatQuantite(Number(produit.stock) - baseUtilisee(produit.id, id), produit.unite)} de « ${nomAvecVariante(produit.nom, ligne?.variante?.libelle)} ».`, 'erreur');
    }
    if (quantite <= 0) s.panier.delete(id);
    else s.panier.set(id, { ...ligne, produit, quantite });
    renderTout();
  }

  /** Ajoute une case taille × couleur au panier (plafonnée à son stock). */
  function ajouterVariante(produit, cas, quantite) {
    const cle = cleLigne(produit.id, cas.id);
    const actuelle = s.panier.get(cle)?.quantite || 0;
    const variante = { id: cas.id, libelle: cas.libelle, taille: cas.taille, couleur: cas.couleur, stock: Number(cas.stock) || 0, prix: cas.prix ?? null };
    let total = actuelle + quantite;
    if (!produit.sur_commande && total > variante.stock) {
      total = variante.stock;
      toast(variante.stock > 0 ? `Stock insuffisant : il reste ${formatQuantite(variante.stock, produit.unite)} de « ${nomAvecVariante(produit.nom, variante.libelle)} ».` : `« ${nomAvecVariante(produit.nom, variante.libelle)} » est épuisé.`, 'erreur');
    }
    if (total <= 0) return;
    s.panier.set(cle, { produit, quantite: total, variante });
    renderTout();
  }

  /** Panneau taille × couleur (feuille du bas sur téléphone). */
  function choisirVariante(produit, { quantite = 1, apres = null } = {}) {
    ouvrirChoixVariante({
      produit,
      prixModele: prixArticle(produit),
      quantiteInitiale: quantite,
      dejaPris: (idCase) => s.panier.get(cleLigne(produit.id, idCase))?.quantite || 0,
      onAjout: (cas, q) => { ajouterVariante(produit, cas, q); apres?.(); },
      onFermer: apres
    });
  }

  /** Choix de l'unité (Barre · Tonne · Botte de 10…), puis quantité ; une ligne par unité. */
  function choisirUnite(produit, { quantite = 1, unite = null, apres = null } = {}) {
    ouvrirChoixUnite({
      produit,
      unites: s.unites.get(produit.id) || [],
      typePrix: s.typePrix,
      stockLibre: Math.max(0, Number(produit.stock) - baseUtilisee(produit.id)),
      quantiteInitiale: quantite,
      uniteInitiale: unite,
      onAjout: (u, q) => { if (u) ajouterUnite(produit, u, q); else ajouter(produit.id, q); apres?.(); },
      onFermer: apres
    });
  }
  function ajouterUnite(produit, unite, quantite) {
    const cle = cleUnite(produit.id, unite.id);
    const ligne = s.panier.get(cle) || { produit, quantite: 0, unite };
    s.panier.set(cle, { ...ligne, produit, unite });
    definirQuantite(cle, ligne.quantite + quantite);
  }

  function clicArticle(id) {
    const produit = s.produits.find((p) => p.id === id);
    if (produit && aVariantes(produit)) return choisirVariante(produit);
    if (produit && avecUnites(produit)) return choisirUnite(produit);
    return ajouter(id, 1);
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
    s.recuSms = Boolean(client?.telephone) && s.recuSmsParDefaut;
    s.chantierClient = null;
    renderPanier();
    if (client) verifierChantierClient(client.id);
  }

  /**
   * Reçu SMS coché par défaut seulement s'il reste du crédit et si le modèle « Reçu de vente » est actif
   * (le modèle n'est lisible que par le gérant ; pour un vendeur, seul le crédit compte).
   */
  async function chargerReglageRecuSms() {
    try {
      const [solde, modele] = await Promise.all([
        chargerSoldeSms(),
        peut('messages.voir')
          ? sb.from('message_modeles').select('actif').eq('boutique_id', boutique.id).eq('cle', 'recu_vente').maybeSingle()
          : Promise.resolve({ data: null })
      ]);
      s.recuSmsParDefaut = aModule('messages') && solde > 0 && modele.data?.actif !== false;
    } catch (err) {
      console.warn('[YOUMMA] Réglage du reçu SMS indisponible :', err);
    }
  }

  /** Rappel discret si le client choisi a un chantier ouvert. */
  async function verifierChantierClient(idClient) {
    try {
      const chantier = await chargerChantierOuvert(idClient);
      if (s.client?.id !== idClient || !chantier || !aModule('chantiers')) return;
      s.chantierClient = chantier;
      renderPanier();
    } catch (err) {
      console.warn('[YOUMMA] Chantier du client non vérifié :', err);
    }
  }

  /** Ouvre l'écran d'enlèvement du chantier avec les articles du panier déjà saisis. */
  function versEnlevementChantier() {
    const lignes = [...s.panier.values()].map(({ produit, quantite, variante, unite }) => `${produit.id}${variante ? `~${variante.id}` : ''}${unite ? `@${unite.id}` : ''}:${quantite}`).join(',');
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

  /**
   * Entrée dans la recherche : ajoute l'article si le code-barres correspond ou s'il n'y a qu'un résultat.
   * Étiquette taille × couleur (code de case) : la bonne case est ajoutée directement.
   */
  async function ajoutRapide() {
    const q = s.recherche.trim();
    if (!q) return;
    const champ = conteneur.querySelector('#recherche-caisse');
    const effacer = () => { champ.value = ''; s.recherche = ''; renderGrille(); champ.focus(); };
    const parCode = s.produits.find((p) => p.code_barre && String(p.code_barre) === q);
    if (!parCode && /^\d{6,}$/.test(q)) {
      // Case connue de la caisse d'abord (hors connexion), sinon recherche en ligne.
      const cas = s.codesCases.get(q) || await chercherVarianteParCode(q, new Set(s.produits.map((p) => p.id))).catch(() => null);
      const produit = cas && s.produits.find((p) => p.id === cas.produit_id);
      if (produit) {
        if (!produit.sur_commande && cas.stock - (s.panier.get(cleLigne(produit.id, cas.id))?.quantite || 0) <= 0) {
          toast(`« ${nomAvecVariante(produit.nom, cas.libelle)} » est épuisé.`, 'erreur');
          return;
        }
        ajouterVariante(produit, cas, 1);
        effacer();
        return;
      }
    }
    const liste = parCode ? [parCode] : produitsFiltres();
    if (liste.length !== 1) return;
    const p = liste[0];
    if (!p.sur_commande && (Number(p.stock) || 0) <= 0) {
      toast(`« ${p.nom} » est épuisé.`, 'erreur');
      return;
    }
    if (aVariantes(p)) { effacer(); choisirVariante(p); return; }
    if (avecUnites(p)) { effacer(); choisirUnite(p); return; }
    ajouter(p.id, 1);
    effacer();
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
      lignes: [...s.panier.values()].map(({ produit, quantite, variante, unite }) => ({ produit_id: produit.id, nom: unite ? `${produit.nom} — ${quantiteEnUnite(quantite, unite.nom)}` : nomAvecVariante(produit.nom, variante?.libelle), quantite, variante: variante || null, unite: unite || null }))
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
      const prix = l.unite ? prixUnite(p, l.unite, vente.typePrix) : l.variante?.prix ?? prixApplique(p, vente.typePrix);
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
    s.typePrix = vente.typePrix === 'gros' && aModule('prix_gros') ? 'gros' : 'detail';
    s.client = vente.client || null;
    s.recuSms = Boolean(s.client?.telephone) && s.recuSmsParDefaut;
    s.remise = Number(vente.remise) || 0;
    let ignores = 0;
    vente.lignes.forEach((l) => {
      const produit = s.produits.find((p) => p.id === l.produit_id);
      if (!produit) { ignores++; return; }
      const unite = l.unite ? (s.unites.get(produit.id) || []).find((u) => u.id === l.unite.id) : null;
      if (l.unite && !unite) { ignores++; return; }
      const ligne = { produit, quantite: 0, variante: l.variante || undefined, unite: unite || undefined };
      if (aVariantes(produit) && !l.variante) { ignores++; return; }
      const cle = unite ? cleUnite(produit.id, unite.id) : cleLigne(produit.id, ligne.variante?.id);
      const quantite = Math.min(Number(l.quantite) || 0, ligne.variante || unite ? maxLigne(ligne, cle) : quantiteMax(produit));
      if (quantite > 0) s.panier.set(cle, { ...ligne, quantite });
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
      lignes: [...s.panier.values()].map((l) => ({
        nom_produit: nomAvecVariante(l.produit.nom, l.variante?.libelle), unite: l.unite ? l.unite.nom : l.produit.unite, quantite: l.quantite,
        prix_unitaire: prixLigne(l), total: Math.round(prixLigne(l) * l.quantite),
        base: l.unite ? formatQuantite(Math.round(l.quantite * l.unite.facteur * 1000) / 1000, l.produit.unite) : null
      }))
    };

    s.enCours = true;
    renderPanier();
    try {
      const { data, error } = await sb.rpc('valider_vente', {
        p_boutique: boutique.id,
        p_client: s.client?.id || null,
        p_lignes: [...s.panier.values()].map(({ produit, quantite, variante, unite }) => {
          if (variante) return { produit_id: produit.id, variante_id: variante.id, quantite };
          return unite ? { produit_id: produit.id, unite_id: unite.id, quantite } : { produit_id: produit.id, quantite };
        }),
        p_remise: remise,
        p_mode: s.mode,
        p_type_prix: s.typePrix,
        p_echeance: instantane.echeance,
        p_recu_sms: instantane.recuSms
      });
      if (error) throw error;
      const vente = (Array.isArray(data) ? data[0] : data) || {};
      const devis = s.devis;
      s.enCours = false;
      oublierVariantes();
      if (devis && vente.id) lierDevis(devis, vente);
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
      if (/STOCK_INSUFFISANT|PRODUIT_INTROUVABLE|PRODUIT_EPUISE|VARIANTE_/.test(message)) { oublierVariantes(); chargerDonnees(); }
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
        ${boutonsDocuments()}
        <div class="modale-actions">
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
        imprimerRecuVente({ ...recuFinal, client: recuFinal.client?.nom || null, vendeur: etat.membre?.nom }, { idVente: vente.id });
        boutonOccupe(boutonImprimer, false);
      }
      const boutonDoc = e.target.closest('[data-document]');
      if (boutonDoc && vente.id) ouvrirDocument({ type: boutonDoc.dataset.document, vente: vente.id, retour: '#/caisse' });
    });
  }

  /** Boutons d'impression : facture (ou reçu) A4, bon de livraison, ticket 80 mm ; le format par défaut en premier. */
  function boutonsDocuments() {
    const reglages = s.reglagesDocs || {};
    const type = typeVente(reglages);
    const ticket80 = reglages.format_defaut === '80mm';
    const a4 = `<button type="button" class="btn ${ticket80 ? 'btn-secondaire' : 'btn-primaire'}" data-document="${type}">${icone('document', 18, 2)} ${type === 'recu' ? 'Reçu A4' : 'Facture A4'}</button>`;
    const ticket = `<button type="button" class="btn ${ticket80 ? 'btn-primaire' : 'btn-secondaire'}" data-action="imprimer">${icone('imprimante', 18, 2)} Ticket 80 mm</button>`;
    const bl = `<button type="button" class="btn btn-secondaire" data-document="bon_livraison">${icone('livraison', 18, 2)} Bon de livraison</button>`;
    return `<div class="boutons-documents">${ticket80 ? ticket + a4 : a4 + ticket}${aModule('bons_livraison') ? bl : ''}</div>`;
  }

  /* ======================================================= Devis → vente */

  /** Remplit le panier avec le devis (articles du stock), la remise et le client du devis. */
  async function appliquerDevis(idDevis) {
    const devis = await lireDevis(idDevis);
    if (!devis || !conteneur.isConnected) return;
    if (s.panier.size && !(await confirmer('Le panier en cours sera remplacé par le devis.', { libelleOk: 'Remplacer' }))) return;
    viderPanier();
    s.typePrix = 'detail';
    const manquants = [];
    const aChoisir = [];
    for (const l of devis.lignes) {
      const produit = s.produits.find((p) => p.id === l.produit_id);
      if (!produit) { manquants.push(l.nom); continue; }
      let variante;
      if (l.unite_id) {
        const unite = (s.unites.get(produit.id) || []).find((u) => u.id === l.unite_id);
        if (!unite) { manquants.push(`${l.nom} (unité retirée)`); continue; }
        const cle = cleUnite(produit.id, unite.id);
        const ligne = { produit, quantite: 0, unite };
        const quantite = Math.min(Number(l.quantite) || 0, maxLigne(ligne, cle));
        if (quantite < Number(l.quantite)) manquants.push(`${l.nom} (stock insuffisant)`);
        if (quantite > 0) s.panier.set(cle, { ...ligne, quantite });
        continue;
      }
      if (aVariantes(produit)) {
        if (!l.variante_id) { aChoisir.push({ produit, quantite: Number(l.quantite) || 1 }); continue; }
        try {
          const cas = (await chargerVariantes(produit.id)).cases.find((c) => c.id === l.variante_id);
          if (!cas) { manquants.push(`${l.nom} (taille ou couleur retirée)`); continue; }
          variante = { id: cas.id, libelle: cas.libelle, taille: cas.taille, couleur: cas.couleur, stock: cas.stock, prix: cas.prix };
        } catch { manquants.push(l.nom); continue; }
      }
      const ligne = { produit, quantite: 0, variante };
      const quantite = Math.min(Number(l.quantite) || 0, variante ? maxLigne(ligne) : quantiteMax(produit));
      if (quantite < Number(l.quantite)) manquants.push(`${l.nom} (stock insuffisant)`);
      if (quantite > 0) s.panier.set(cleLigne(produit.id, variante?.id), { ...ligne, quantite });
    }
    if (devis.client?.id) {
      try { const c = await chargerClient(boutique.id, devis.client.id); if (c) s.client = c; } catch { /* client comptoir */ }
    }
    // Total visé : le devis, moins les lignes libres (hors stock), qui ne peuvent pas entrer dans la vente.
    const totalLibres = devis.libres.reduce((t, l) => t + (Number(l.total) || 0), 0);
    const cible = Math.max(0, devis.total - totalLibres);
    const { sousTotal } = totaux();
    s.remise = sousTotal > cible ? sousTotal - cible : 0;
    s.devis = { ...devis, cible, totalLibres, manquants };
    majBasculePrix();
    renderTout();
    renderBandeauDevis();
    // Ancien devis sans taille ni couleur : le panneau s'ouvre pour chaque ligne concernée, l'une après l'autre.
    const suivante = () => {
      const l = aChoisir.shift();
      if (!l || !conteneur.isConnected) { if (s.devis) { s.remise = Math.max(0, totaux().sousTotal - s.devis.cible); majTotaux(); renderPanier(); } return; }
      toast(`Devis : choisissez la taille et la couleur de « ${l.produit.nom} ».`, 'info');
      choisirVariante(l.produit, { quantite: l.quantite, apres: suivante });
    };
    suivante();
  }

  /** Relit le devis en base (lignes, remise, client) ; refuse un devis déjà transformé ou refusé. */
  async function lireDevis(idDevis) {
    const [res, docRes] = await Promise.all([
      sb.from('proformas').select('id, statut, vente_id, client_id, client_nom, lignes, total')
        .eq('boutique_id', boutique.id).eq('id', idDevis).maybeSingle(),
      sb.from('documents_emis').select('numero').eq('type', 'proforma').eq('proforma_id', idDevis).limit(1)
    ]);
    if (res.error) { toast(messageErreur(res.error), 'erreur', 6000); return null; }
    const pf = res.data;
    if (!pf) { toast(messageErreur('PROFORMA_INTROUVABLE'), 'erreur', 6000); return null; }
    const numero = docRes.data?.[0]?.numero || 'Devis';
    const lienDevis = { libelle: 'Voir le devis', href: `#/proformas/${encodeURIComponent(pf.id)}` };
    if (pf.statut === 'converti') {
      let vente = null;
      if (pf.vente_id) vente = (await sb.from('ventes').select('id, numero').eq('id', pf.vente_id).maybeSingle()).data;
      toast(`Le devis ${numero} a déjà été transformé en vente${vente ? ` (${formatNumeroVente(vente.numero)})` : ''}.`, 'erreur', 9000,
        vente ? { libelle: 'Voir la vente', href: `#/ventes/${encodeURIComponent(vente.id)}` } : lienDevis);
      return null;
    }
    if (pf.statut === 'refuse') {
      toast(`Le devis ${numero} a été refusé : il ne peut pas être transformé en vente.`, 'erreur', 9000, lienDevis);
      return null;
    }
    let clientNom = pf.client_nom;
    if (pf.client_id && !clientNom) clientNom = (await sb.from('clients').select('nom').eq('id', pf.client_id).maybeSingle()).data?.nom || null;
    const lignes = pf.lignes || [];
    return {
      id: pf.id, numero, total: Number(pf.total) || 0, client: pf.client_id ? { id: pf.client_id } : null, client_nom: clientNom,
      lignes: lignes.filter((l) => l.produit_id).map((l) => ({ produit_id: l.produit_id, variante_id: l.variante_id || null, unite_id: l.unite_id || null, nom: l.nom, quantite: Number(l.quantite), prix: Number(l.prix) })),
      libres: lignes.filter((l) => !l.produit_id).map((l) => ({ nom: l.nom, total: Number(l.total) || 0 }))
    };
  }

  function renderBandeauDevis() {
    const zoneDevis = zone('devis');
    if (!zoneDevis) return;
    if (!s.devis) { zoneDevis.hidden = true; zoneDevis.innerHTML = ''; return; }
    const { cible, totalLibres, manquants } = s.devis;
    const { total } = totaux();
    const alertes = [];
    if (s.devis.libres.length) alertes.push(`Lignes libres du devis à ajouter manuellement ou en remise : ${s.devis.libres.map((l) => `${l.nom} (${formatGNF(l.total)})`).join(', ')}.`);
    if (manquants.length) alertes.push(`Non repris : ${manquants.join(', ')}.`);
    if (total !== cible) alertes.push(`Attention : le total de la vente (${formatGNF(total)}) diffère du devis (${formatGNF(cible)}${totalLibres ? ' hors lignes libres' : ''}).`);
    zoneDevis.hidden = false;
    zoneDevis.innerHTML = `
      <span>${icone('document', 18, 2)} Vente issue du devis <strong>${esc(s.devis.numero)}</strong> · total du devis ${formatGNF(s.devis.total)}${s.devis.client_nom ? ` · ${esc(s.devis.client_nom)}` : ''}</span>
      ${alertes.map((a) => `<span class="bandeau-devis-alerte">${esc(a)}</span>`).join('')}
      <button type="button" class="btn-lien" data-action="abandonner-devis">Ne plus lier au devis</button>`;
  }

  /** Après la vente : devis « converti » avec le lien vers la vente. */
  async function lierDevis(devis, vente) {
    s.devis = null;
    renderBandeauDevis();
    const { error } = await sb.rpc('statut_proforma', { p_proforma: devis.id, p_statut: 'converti', p_vente: vente.id });
    if (error) toast(`Vente enregistrée, mais le devis n’a pas pu être marqué : ${messageErreur(error)}`, 'erreur', 8000);
    else toast(`Devis ${devis.numero} transformé en vente.`, 'succes', 6000, { libelle: 'Voir le devis', href: `#/proformas/${encodeURIComponent(devis.id)}` });
  }

  /** Relit la vente et ses lignes enregistrées ; garde l'aperçu local en cas d'échec. */
  async function chargerRecuServeur(idVente, recuLocal) {
    if (!idVente) return recuLocal;
    try {
      const [venteRes, lignesRes] = await Promise.all([
        sb.from('ventes').select('numero, created_at, sous_total, remise, total, mode_paiement, echeance').eq('id', idVente).single(),
        sb.from('ventes_lignes').select('produit_id, nom_produit, unite, quantite, prix_unitaire, total, facteur, quantite_base').eq('vente_id', idVente)
      ]);
      if (venteRes.error || lignesRes.error) return recuLocal;
      const v = venteRes.data;
      await completerLignesBase(lignesRes.data);
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
        .select('id, categorie_id, nom, unite, prix_detail, prix_gros, prix_promo, promo_fin, stock, seuil_alerte, sur_commande, code_barre, photo_url, photo_mini_url, tailles, couleurs')
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
    s.unites = await chargerUnitesArticles(s.produits.filter((p) => !aVariantes(p)).map((p) => p.id));
    s.charge = true;
    chargerCodesCases();
    if (s.categorie !== 'tous' && !s.categories.some((c) => c.id === s.categorie)) s.categorie = 'tous';

    // Le panier suit les stocks à jour ; un article désactivé entre-temps en est retiré.
    s.panier.forEach((ligne, cle) => {
      const produit = s.produits.find((p) => p.id === ligne.produit.id);
      if (produit) ligne.produit = produit;
      else s.panier.delete(cle);
    });
    renderCategories();
    renderTout();
  }

  /** Cases (code-barres) des modèles à tailles / couleurs de la caisse, gardées en mémoire pour le scan hors connexion. */
  async function chargerCodesCases() {
    const ids = s.produits.filter(aVariantes).map((p) => p.id);
    const codes = new Map();
    try {
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await sb.from('produit_variantes').select('id, produit_id, taille, couleur, stock, prix, code_barre')
          .in('produit_id', ids.slice(i, i + 100)).eq('actif', true).not('code_barre', 'is', null);
        if (error) throw error;
        (data || []).forEach((c) => codes.set(String(c.code_barre), {
          ...c, stock: Number(c.stock) || 0, prix: c.prix === null || c.prix === undefined ? null : Number(c.prix), libelle: libelleVariante(c.taille, c.couleur)
        }));
      }
      s.codesCases = codes;
    } catch (err) {
      console.warn('[YOUMMA] Codes des tailles non chargés :', err?.message || err);
    }
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

    if (cible.dataset.ajouter) return clicArticle(cible.dataset.ajouter);
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
      case 'abandonner-devis':
        s.devis = null;
        return renderBandeauDevis();
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
  chargerDonnees().then(() => { if (params?.get('devis') && conteneur.isConnected) appliquerDevis(params.get('devis')); });
  chargerReglageRecuSms();
  chargerReglages(boutique.id).then((r) => { s.reglagesDocs = r; }).catch(() => { /* boutons par défaut */ });
  if (params?.get('client')) preselectionnerClient(params.get('client'));
  if (params?.get('vendre') !== null || window.matchMedia('(min-width: 900px)').matches) {
    conteneur.querySelector('#recherche-caisse').focus({ preventScroll: true });
  }

  return function nettoyer() {
    document.removeEventListener('keydown', surToucheGlobale);
    document.body.classList.remove('panier-plein-ecran');
  };
}
