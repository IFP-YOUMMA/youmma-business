/**
 * stock.js — Liste des articles, fiche article (historique des mouvements),
 * ajout / modification / désactivation, entrée de stock et inventaire.
 *
 * Le stock n'est écrit directement qu'à la création de l'article ; ensuite il ne
 * change que par la fonction serveur mouvement_stock (ou par les ventes).
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import {
  esc, icone, toast, confirmer, ouvrirModale, boutonOccupe, messageErreur, lireNombre, capitaliser,
  formatNombre, formatGNF, formatQuantite, formatDate, uniteDivisible, UNITES, promoActive, dateISO
} from './utils.js';
import { modifierPhotoArticle } from './images/actions.js';
import { aModule, vocab, unArticle, unites } from './modules.js';
import { retirerPhotoArticle } from './images/envoi.js';
import { vignetteProduit } from './images/affichage.js';
import { aVariantes, chargerVariantes, oublierVariantes } from './variantes.js';
import { monterFaconsDeVendre, ouvrirChangerUniteBase } from './unites.js';
import { monterEditeurVariantes, grilleLectureHTML, ouvrirGrilleMouvement, imprimerEtiquettes, afficherReassort, prechargerEtiquettes } from './variantes-fiche.js';

/**
 * Colonnes lisibles de produits. Le prix d'achat n'est plus lisible par l'API (droit retiré en base) :
 * le gérant le reçoit par la fonction serveur produits_couts, fusionnée côté appli.
 */
const COLONNES_PRODUIT = 'id, boutique_id, categorie_id, nom, unite, prix_detail, prix_gros, stock, seuil_alerte, sur_commande, code_barre, photo_url, photo_mini_url, actif, fournisseur_id, en_ligne, prix_promo, promo_fin, created_at, tailles, couleurs';
const TAILLE_LOT = 100;

const LIBELLES_MOUVEMENTS = {
  entree: 'Entrée de stock',
  ajustement: 'Inventaire',
  vente: 'Vente',
  sortie: 'Sortie',
  annulation: 'Annulation de vente',
  retour: 'Retour client'
};

function normaliserTexte(texte) {
  return String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Classe et libellé de la pastille de stock (rouge ≤ seuil, orange ≤ 2× seuil, vert sinon). */
/** « l’article », « le modèle », « la prestation » ; « de l’article », « du modèle », « de la prestation ». */
function leArticle() {
  const mot = vocab('article').toLowerCase();
  if (/^[aeiouyéèêh]/.test(mot)) return `l’${mot}`;
  return `${unArticle().startsWith('une') ? 'la' : 'le'} ${mot}`;
}
const deArticle = () => { const l = leArticle(); return l.startsWith('le ') ? `du ${l.slice(3)}` : `de ${l}`; };

function pastilleStock(p) {
  if (p.sur_commande) return { classe: 'commande', texte: 'Sur commande' };
  const stock = Number(p.stock) || 0;
  const seuil = Number(p.seuil_alerte) || 0;
  if (stock <= seuil) return { classe: 'bas', texte: formatQuantite(stock, p.unite) };
  if (stock <= 2 * seuil) return { classe: 'moyen', texte: formatQuantite(stock, p.unite) };
  return { classe: 'ok', texte: formatQuantite(stock, p.unite) };
}

function estStockBas(p) {
  return p.actif && !p.sur_commande && Number(p.stock) <= Number(p.seuil_alerte);
}

/**
 * État d'un modèle à tailles / couleurs (3ᵉ ligne de la liste) : « 5 cases épuisées · XXL bleu… » (rouge),
 * « Dernière pièce : 42, 43 » (jaune) ou « Complet » (vert).
 */
function etatModele(cases) {
  const court = (c) => [c.taille, String(c.couleur || '').split(' ')[0].toLowerCase()].filter(Boolean).join(' ');
  const epuisees = cases.filter((c) => (Number(c.stock) || 0) <= 0);
  if (epuisees.length) {
    const noms = epuisees.slice(0, 4).map(court).join(', ') + (epuisees.length > 4 ? '…' : '');
    return { classe: 'rouge', texte: `${epuisees.length} case${epuisees.length > 1 ? 's' : ''} épuisée${epuisees.length > 1 ? 's' : ''}`, detail: noms };
  }
  const dernieres = cases.filter((c) => Number(c.stock) === 1);
  if (dernieres.length) return { classe: 'jaune', texte: 'Dernière pièce', detail: dernieres.slice(0, 5).map(court).join(', ') };
  return { classe: 'vert', texte: 'Complet', detail: '' };
}

export function afficherStock(conteneur, params) {
  if (params.get('id') === 'reassort') { afficherReassort(conteneur); return; }
  const boutique = etat.boutique;
  const gerer = peut('gerer_stock');
  const s = {
    produits: [],
    categories: [],
    /** Fournisseurs actifs (gérant), pour le champ « Fournisseur » de l'article. */
    fournisseurs: [],
    charge: false,
    recherche: params.get('q') || '',
    categorie: '',
    filtre: ['bas', 'epuises'].includes(params.get('filtre')) ? params.get('filtre') : 'tous',
    /** Cases taille × couleur des modèles (produit_id → cases actives), pour l'état de la liste. */
    cases: new Map()
  };
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);
  const nomCategorie = (id) => s.categories.find((c) => c.id === id)?.nom || 'Sans catégorie';

  /* ======================================================= Gabarit */

  conteneur.innerHTML = `
    <div class="page ${aModule('prix_gros') ? '' : 'sans-gros'}">
      <header class="page-entete">
        <div class="page-titres">
          <h1>${esc(vocab('menu'))}</h1>
          <span data-zone="resume">Chargement…</span>
        </div>
        ${gerer ? `<button type="button" class="btn btn-primaire" data-action="ajouter">${icone('plus', 18, 2.4)} Ajouter ${esc(unArticle())}</button>` : ''}
      </header>

      <section class="carte outils-stock" aria-label="Filtres">
        <label class="recherche-entete recherche-large">
          ${icone('recherche', 18, 2)}
          <span class="sr-only">Rechercher ${esc(unArticle())}</span>
          <input type="search" id="recherche-stock" placeholder="Nom ou code-barres…" value="${esc(s.recherche)}" autocomplete="off">
        </label>
        <div class="champ champ-en-ligne">
          <label for="filtre-categorie" class="sr-only">Catégorie</label>
          <select id="filtre-categorie" class="input" data-zone="filtre-categorie"><option value="">Toutes les catégories</option></select>
        </div>
        <div class="segments" role="group" aria-label="Filtre">
          <button type="button" class="segment" data-filtre="tous">Tous</button>
          <button type="button" class="segment" data-filtre="bas">Stock bas</button>
          ${aModule('variantes') ? '<button type="button" class="segment" data-filtre="epuises">Épuisés</button>' : ''}
          ${gerer ? '<button type="button" class="segment" data-filtre="inactifs">Désactivés</button>' : ''}
        </div>
      </section>
      <div data-zone="bandeau-reassort" hidden></div>

      <section class="carte carte-liste-stock" aria-label="Articles">
        <div class="entete-liste-stock seul-ordi" aria-hidden="true">
          <span>${esc(vocab('article'))}</span><span>Catégorie</span><span>Prix détail</span><span>Prix gros</span><span>Stock</span><span></span>
        </div>
        <ul class="liste-stock" data-zone="liste">
          ${'<li class="squelette-ligne"><span class="squelette" style="height:14px;width:40%"></span><span class="squelette" style="height:10px;width:70%"></span></li>'.repeat(6)}
        </ul>
      </section>
    </div>`;

  /* ======================================================= Rendu de la liste */

  function produitsFiltres() {
    const q = normaliserTexte(s.recherche.trim());
    return s.produits.filter((p) => {
      if (s.filtre === 'inactifs' ? p.actif : !p.actif) return false;
      if (s.filtre === 'bas' && !estStockBas(p)) return false;
      if (s.filtre === 'epuises' && !(aVariantes(p) ? (s.cases.get(p.id) || []).some((c) => c.stock <= 0) : !p.sur_commande && Number(p.stock) <= 0)) return false;
      if (s.categorie && p.categorie_id !== s.categorie) return false;
      if (!q) return true;
      return normaliserTexte(p.nom).includes(q) || String(p.code_barre || '').toLowerCase().includes(q);
    });
  }

  function renderFiltres() {
    conteneur.querySelectorAll('[data-filtre]').forEach((b) => {
      const actif = b.dataset.filtre === s.filtre;
      b.classList.toggle('actif', actif);
      b.setAttribute('aria-pressed', String(actif));
    });
    const select = zone('filtre-categorie');
    select.innerHTML = '<option value="">Toutes les catégories</option>'
      + s.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === s.categorie ? 'selected' : ''}>${esc(c.nom)}</option>`).join('');
  }

  function renderListe() {
    if (!s.charge) return;
    const actifs = s.produits.filter((p) => p.actif);
    const nbBas = actifs.filter(estStockBas).length;
    zone('resume').textContent = `${actifs.length} ${(actifs.length > 1 ? vocab('articles') : vocab('article')).toLowerCase()} actif${actifs.length > 1 ? 's' : ''}`
      + (nbBas ? ` · ${nbBas} sous le seuil d’alerte` : '');

    const liste = produitsFiltres();
    if (!s.produits.length) {
      zone('liste').innerHTML = `
        <li class="etat-vide etat-vide-large">
          <p>Votre stock est vide. Ajoutez vos articles avec leurs prix pour commencer à vendre.</p>
          ${gerer ? '<button type="button" class="btn btn-primaire" data-action="ajouter">Ajouter mes premiers articles</button>' : '<p class="discret">Demandez au gérant d’ajouter les articles.</p>'}
        </li>`;
      return;
    }
    if (!liste.length) {
      const messages = {
        bas: 'Aucun article sous le seuil d’alerte. Votre stock est en bonne santé !',
        epuises: 'Aucune taille ni aucun article épuisé.',
        inactifs: 'Aucun article désactivé.',
        tous: 'Aucun article ne correspond à votre recherche.'
      };
      zone('liste').innerHTML = `<li class="etat-vide etat-vide-large"><p>${esc(messages[s.filtre])}</p></li>`;
      return;
    }
    zone('liste').innerHTML = liste.map(ligneHTML).join('');
  }

  function ligneHTML(p) {
    const modele = aVariantes(p) ? etatModele(s.cases.get(p.id) || []) : null;
    const pastille = modele && !p.sur_commande ? { classe: modele.classe === 'rouge' ? 'bas' : modele.classe === 'jaune' ? 'moyen' : 'ok', texte: `${formatNombre(p.stock)} pcs` } : pastilleStock(p);
    const unite = esc(p.unite || 'unité');
    const gros = p.prix_gros !== null && p.prix_gros !== undefined && aModule('prix_gros');
    const promo = promoActive(p);
    const prixDetailHTML = promo
      ? `<s class="discret">${formatNombre(p.prix_detail)}</s> <span class="gras texte-promo">${formatNombre(p.prix_promo)}</span>`
      : `<span class="gras">${formatNombre(p.prix_detail)}</span>`;
    return `
      <li>
        <button type="button" class="ligne-stock ${p.actif ? '' : 'inactif'}" data-fiche="${esc(p.id)}">
          <span class="ls-article">
            <span class="vignette-mini">${vignetteProduit(p, 44, icone('stock', 18, 1.8))}</span>
            <span class="ls-textes">
              <span class="gras">${esc(p.nom)}${promo ? ' <span class="badge-promo">Promo</span>' : ''}${p.en_ligne === false && aModule('boutique_en_ligne') ? ' <span class="tag-masque">Masqué en ligne</span>' : ''}</span>
              <span class="discret">
                <span class="seul-mobile">${esc(nomCategorie(p.categorie_id))}${p.code_barre ? ' · ' : ''}</span>${p.code_barre ? esc(p.code_barre) : ''}${p.actif ? '' : ' · Désactivé'}
              </span>
              ${modele ? `<span class="etat-modele ${modele.classe}">${esc(modele.texte)}${modele.detail ? ` · <span>${esc(modele.detail)}</span>` : ''}</span>` : ''}
            </span>
          </span>
          <span class="ls-categorie seul-ordi">${esc(nomCategorie(p.categorie_id))}</span>
          <span class="ls-prix seul-ordi">${prixDetailHTML} <span class="discret">/ ${unite}</span></span>
          <span class="ls-prix seul-ordi">${gros ? `<span class="gras">${formatNombre(p.prix_gros)}</span> <span class="discret">/ ${unite}</span>` : '<span class="discret">—</span>'}</span>
          <span class="ls-prix-mobile seul-mobile">
            Détail ${promo ? `<s>${formatNombre(p.prix_detail)}</s> <strong class="texte-promo">${formatNombre(p.prix_promo)}</strong>` : `<strong>${formatNombre(p.prix_detail)}</strong>`}${gros ? ` · Gros <strong>${formatNombre(p.prix_gros)}</strong>` : ''} <span class="discret">GNF / ${unite}</span>
          </span>
          <span class="ls-stock"><span class="pastille-stock ${pastille.classe}">${esc(pastille.texte)}</span></span>
          <span class="ls-chevron seul-ordi">${icone('chevronDroite', 18, 2)}</span>
        </button>
      </li>`;
  }

  /* ======================================================= Données */

  async function chargerDonnees() {
    const [produitsRes, categoriesRes, coutsRes, fournisseursRes] = await Promise.all([
      sb.from('produits').select(COLONNES_PRODUIT).eq('boutique_id', boutique.id).order('nom'),
      sb.from('categories').select('id, nom, ordre').eq('boutique_id', boutique.id).order('ordre').order('nom'),
      // Prix d'achat : gérant / propriétaire uniquement, jamais demandé pour un vendeur.
      peut('voir_prix_achat') ? sb.rpc('produits_couts', { p_boutique: boutique.id }) : Promise.resolve({ data: [] }),
      sb.from('fournisseurs').select('id, nom, actif').eq('boutique_id', boutique.id).order('nom')
    ]);
    const erreur = produitsRes.error || categoriesRes.error || coutsRes.error;
    if (erreur) {
      zone('liste').innerHTML = `<li class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(erreur))}</li>`;
      zone('resume').textContent = '';
      return false;
    }
    const couts = new Map((coutsRes.data || []).map((c) => [c.produit_id, c.prix_achat]));
    s.produits = produitsRes.data.map((p) => ({ ...p, prix_achat: couts.get(p.id) ?? null }));
    s.categories = categoriesRes.data;
    s.fournisseurs = fournisseursRes.data || [];
    await chargerCasesModeles();
    s.charge = true;
    renderFiltres();
    renderListe();
    chargerBandeauReassort();
    return true;
  }

  /** Cases actives de tous les modèles à tailles / couleurs (par lots de 100 articles). */
  async function chargerCasesModeles() {
    const ids = s.produits.filter(aVariantes).map((p) => p.id);
    s.cases = new Map();
    for (let i = 0; i < ids.length; i += TAILLE_LOT) {
      const { data, error } = await sb.from('produit_variantes').select('id, produit_id, taille, couleur, stock')
        .in('produit_id', ids.slice(i, i + TAILLE_LOT)).eq('actif', true);
      if (error) { console.warn('[YOUMMA] Cases des modèles indisponibles :', error); return; }
      (data || []).forEach((c) => { const l = s.cases.get(c.produit_id) || []; l.push({ ...c, stock: Number(c.stock) || 0 }); s.cases.set(c.produit_id, l); });
    }
  }

  /** « n tailles épuisées sur vos modèles » + lien vers la liste à réassortir. */
  async function chargerBandeauReassort() {
    const zoneBandeau = zone('bandeau-reassort');
    if (!aModule('variantes') || !zoneBandeau) return;
    const { data, error } = await sb.rpc('variantes_a_reassortir', { p_boutique: boutique.id });
    if (error || !zoneBandeau.isConnected) return;
    const r = (Array.isArray(data) ? data[0] : data) || {};
    const n = Number(r.epuisees) || 0;
    zoneBandeau.hidden = !n;
    zoneBandeau.innerHTML = n ? `
      <div class="bandeau-reassort"><strong>${formatNombre(n)} taille${n > 1 ? 's' : ''} épuisée${n > 1 ? 's' : ''} sur vos modèles</strong>
        <span>Préparez le réassort à partir de vos ventes des 60 derniers jours.</span>
        <a href="#/stock/reassort" class="gras">Voir la liste à réassortir →</a></div>` : '';
  }

  /** Remplace un article modifié dans la liste locale et rafraîchit l'affichage. */
  function remplacerProduit(produit) {
    const index = s.produits.findIndex((p) => p.id === produit.id);
    if (index >= 0) s.produits[index] = produit;
    else s.produits.push(produit);
    s.produits.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    renderListe();
  }

  /* ======================================================= Fiche article */

  function ouvrirFiche(id) {
    let produit = s.produits.find((p) => p.id === id);
    if (!produit) return;
    const { el, fermer } = ouvrirModale({ titre: produit.nom, variante: 'large', contenu: '<div data-zone="fiche"></div>' });

    function rafraichir() {
      produit = s.produits.find((p) => p.id === id) || produit;
      el.querySelector('h2').textContent = produit.nom;
      el.querySelector('[data-zone="fiche"]').innerHTML = ficheHTML(produit);
      chargerHistorique(produit, el.querySelector('[data-zone="historique"]'));
      if (aVariantes(produit)) chargerGrilleFiche(produit, el.querySelector('[data-zone="grille-modele"]'));
      const zoneUnites = el.querySelector('[data-zone="unites"]');
      if (zoneUnites) monterFaconsDeVendre(zoneUnites, { produit, gerer });
    }

    /** Après une conversion d'unité de base : article relu (unité, stock, prix, seuil). */
    async function apresConversion() {
      const { data } = await sb.from('produits').select(COLONNES_PRODUIT).eq('id', produit.id).single();
      if (data) remplacerProduit({ ...data, prix_achat: produit.prix_achat });
      rafraichir();
    }

    /** Après un mouvement sur la grille : article et cases relus. */
    async function apresGrille() {
      const { data } = await sb.from('produits').select(COLONNES_PRODUIT).eq('id', produit.id).single();
      if (data) remplacerProduit({ ...data, prix_achat: produit.prix_achat });
      await chargerCasesModeles();
      renderListe();
      chargerBandeauReassort();
      rafraichir();
    }

    el.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-action-fiche]')?.dataset.actionFiche;
      if (!action) return;
      if (action === 'entree' || action === 'ajustement') {
        if (aVariantes(produit)) ouvrirGrilleMouvement(produit, action, apresGrille);
        else ouvrirMouvement(produit, action, rafraichir);
      }
      if (action === 'etiquettes') imprimerEtiquettes(produit);
      if (action === 'unite-base') ouvrirChangerUniteBase(produit, apresConversion);
      if (action === 'modifier') ouvrirFormulaire(produit, rafraichir);
      if (action === 'photo' || action === 'retoucher') {
        // Outil d'image : recadrer, nettoyer le fond (blanc ou détourage automatique), grande photo + miniature.
        modifierPhotoArticle(produit, {
          source: action === 'retoucher' ? produit.photo_url : null,
          apres: ({ url, mini }) => { remplacerProduit({ ...produit, photo_url: url, photo_mini_url: mini }); rafraichir(); }
        });
        return;
      }
      if (action === 'retirer-photo') {
        const bouton = e.target.closest('button');
        if (!(await confirmer('La photo sera retirée de la caisse et de la boutique en ligne.', { titre: 'Retirer la photo', libelleOk: 'Retirer', danger: true }))) return;
        boutonOccupe(bouton, true, 'Suppression…');
        try {
          await retirerPhotoArticle(produit);
          remplacerProduit({ ...produit, photo_url: null, photo_mini_url: null });
          toast('Photo retirée.', 'succes');
          rafraichir();
        } catch (err) {
          toast(messageErreur(err), 'erreur');
          if (bouton.isConnected) boutonOccupe(bouton, false);
        }
      }
      if (action === 'activer') {
        const desactiver = produit.actif;
        if (desactiver && !(await confirmer(`« ${produit.nom} » n’apparaîtra plus dans la caisse. Son historique est conservé et vous pourrez le réactiver.`, { titre: 'Désactiver l’article', libelleOk: 'Désactiver', danger: true }))) return;
        const { data, error } = await sb.from('produits').update({ actif: !desactiver }).eq('id', produit.id).select(COLONNES_PRODUIT).single();
        if (error) { toast(messageErreur(error), 'erreur'); return; }
        remplacerProduit({ ...data, prix_achat: produit.prix_achat });
        toast(desactiver ? 'Article désactivé.' : 'Article réactivé.', 'succes');
        fermer();
      }
    });
    rafraichir();
  }

  async function chargerGrilleFiche(p, zoneGrille) {
    if (gerer) prechargerEtiquettes();
    try {
      const d = await chargerVariantes(p.id, { recharger: true });
      if (!zoneGrille?.isConnected) return;
      const couleursDispo = d.couleurs.filter((c) => d.cases.some((x) => x.couleur === c.nom && x.stock > 0)).length;
      const taillesDispo = d.tailles.filter((t) => d.cases.some((x) => x.taille === t && x.stock > 0)).length;
      zoneGrille.innerHTML = grilleLectureHTML(d) + (aModule('boutique_en_ligne') && p.en_ligne !== false
        ? `<p class="var-en-ligne">${icone('enLigne', 16, 2)} En ligne : ${couleursDispo} couleur${couleursDispo > 1 ? 's' : ''}, ${taillesDispo} taille${taillesDispo > 1 ? 's' : ''} dispo</p>` : '');
    } catch (err) {
      if (zoneGrille?.isConnected) zoneGrille.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`;
    }
  }

  function ficheHTML(p) {
    const modele = aVariantes(p);
    const pastille = modele && !p.sur_commande ? { classe: 'ok', texte: `${formatNombre(p.stock)} pièce${Number(p.stock) > 1 ? 's' : ''}` } : pastilleStock(p);
    const info = (libelle, valeur) => `<div class="fiche-info"><dt>${esc(libelle)}</dt><dd>${valeur}</dd></div>`;
    const promo = promoActive(p);
    const photo = peut('articles.photo');
    return `
      <div class="fiche-stock">
        <div class="fiche-photo">
          <span class="fiche-photo-image">${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="Photo de ${esc(p.nom)}" width="1080" height="1080" decoding="async">` : icone('image', 32, 1.6)}</span>
          ${photo ? `
            <span class="fiche-photo-actions">
              <button type="button" class="btn btn-secondaire btn-petit" data-action-fiche="photo">${icone('photo', 16, 2)} ${p.photo_url ? 'Changer la photo' : 'Ajouter une photo'}</button>
              ${p.photo_url ? `<button type="button" class="btn btn-secondaire btn-petit" data-action-fiche="retoucher">${icone('image', 16, 2)} Recadrer / retirer le fond</button>` : ''}
              ${p.photo_url ? '<button type="button" class="btn-lien btn-lien-danger" data-action-fiche="retirer-photo">Retirer la photo</button>' : ''}
              <small class="aide">Recadrée et allégée automatiquement : grande photo ≤ 150 Ko et miniature ≈ 25 Ko pour les listes.</small>
            </span>` : ''}
        </div>
        <div class="fiche-stock-actuel">
          <span class="discret">Stock actuel</span>
          <span class="pastille-stock pastille-grande ${pastille.classe}">${esc(pastille.texte)}</span>
          ${p.actif ? '' : '<span class="statut-inactif">Article désactivé</span>'}
        </div>
        ${modele ? '<section class="fiche-grille-modele" data-zone="grille-modele"><div class="squelette" style="height:120px"></div></section>' : ''}
        ${aModule('unites') && !modele ? '<section class="fiche-unites" data-zone="unites"></section>' : ''}
        <dl class="fiche-infos">
          ${info('Catégorie', esc(nomCategorie(p.categorie_id)))}
          ${info('Unité', esc(p.unite || '—'))}
          ${info('Prix détail', formatGNF(p.prix_detail))}
          ${promo ? info('Prix promo', `<span class="texte-promo gras">${formatGNF(p.prix_promo)}</span>${p.promo_fin ? ` jusqu’au ${esc(formatDate(p.promo_fin, 'court'))}` : ' (sans fin)'}`) : ''}
          ${aModule('boutique_en_ligne') ? info('En ligne', p.en_ligne === false ? 'Masqué sur la boutique en ligne' : 'Visible sur la boutique en ligne') : ''}
          ${aModule('prix_gros') ? info('Prix gros', p.prix_gros !== null && p.prix_gros !== undefined ? formatGNF(p.prix_gros) : '—') : ''}
          ${peut('voir_prix_achat') ? info('Prix d’achat', p.prix_achat !== null && p.prix_achat !== undefined ? formatGNF(p.prix_achat) : '—') : ''}
          ${info('Seuil d’alerte', p.sur_commande ? '—' : esc(formatQuantite(p.seuil_alerte, p.unite)))}
          ${info('Code-barres', esc(p.code_barre || '—'))}
          ${gerer && aModule('fournisseurs') ? info('Fournisseur', esc(s.fournisseurs.find((f) => f.id === p.fournisseur_id)?.nom || '—')) : ''}
        </dl>
        ${gerer ? `
          <div class="fiche-actions">
            ${p.sur_commande || !p.actif ? '' : modele ? `
              <button type="button" class="btn btn-primaire" data-action-fiche="entree">${icone('entree', 18, 2)} Arrivage</button>
              <button type="button" class="btn btn-secondaire" data-action-fiche="ajustement">${icone('inventaire', 18, 2)} Inventaire</button>
              <button type="button" class="btn btn-secondaire" data-action-fiche="etiquettes">${icone('imprimante', 18, 2)} Imprimer les étiquettes</button>` : `
              <button type="button" class="btn btn-primaire" data-action-fiche="entree">${icone('entree', 18, 2)} Entrée de stock</button>
              <button type="button" class="btn btn-secondaire" data-action-fiche="ajustement">${icone('inventaire', 18, 2)} Inventaire</button>`}
            <button type="button" class="btn btn-secondaire" data-action-fiche="modifier">${icone('crayon', 18, 2)} Modifier</button>
            ${aModule('unites') && !modele ? '<button type="button" class="btn-lien" data-action-fiche="unite-base">Changer l’unité de base</button>' : ''}
            <button type="button" class="btn ${p.actif ? 'btn-lien btn-lien-danger' : 'btn-secondaire'}" data-action-fiche="activer">${p.actif ? 'Désactiver l’article' : 'Réactiver l’article'}</button>
          </div>` : ''}
        <h3 class="fiche-sous-titre">Derniers mouvements</h3>
        <div data-zone="historique">${'<div class="squelette-ligne"><span class="squelette" style="height:14px;width:60%"></span></div>'.repeat(3)}</div>
      </div>`;
  }

  async function chargerHistorique(p, zoneHistorique) {
    const { data, error } = await sb
      .from('mouvements_stock')
      .select('*')
      .eq('produit_id', p.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!zoneHistorique.isConnected) return;
    if (error) {
      console.error(error);
      zoneHistorique.innerHTML = '<p class="bloc-erreur">Historique indisponible pour le moment.</p>';
      return;
    }
    if (!data.length) {
      zoneHistorique.innerHTML = '<p class="discret">Aucun mouvement enregistré pour cet article.</p>';
      return;
    }
    const libelles = new Map();
    if (aVariantes(p) && data.some((m) => m.variante_id)) {
      try { (await chargerVariantes(p.id)).cases.forEach((c) => libelles.set(c.id, c.libelle)); } catch { /* sans libellé */ }
      if (!zoneHistorique.isConnected) return;
    }
    zoneHistorique.innerHTML = `
      <ul class="historique">
        ${data.map((m) => {
          const quantite = Number(m.quantite) || 0;
          let signe = '';
          if (m.type === 'entree' || m.type === 'retour' || m.type === 'annulation') signe = '+';
          if ((m.type === 'vente' || m.type === 'sortie') && quantite > 0) signe = '−';
          return `
            <li class="historique-ligne">
              <div class="historique-textes">
                <span class="gras">${esc(LIBELLES_MOUVEMENTS[m.type] || capitaliser(m.type || 'Mouvement'))}${m.variante_id && libelles.get(m.variante_id) ? ` · ${esc(libelles.get(m.variante_id))}` : ''}</span>
                <span class="discret">${esc(formatDate(m.created_at, 'complet'))}${m.note ? ' · ' + esc(m.note) : ''}</span>
              </div>
              <span class="historique-qte ${signe === '+' ? 'texte-succes' : ''} ${signe === '−' ? 'texte-danger' : ''}">${signe}${esc(formatQuantite(Math.abs(quantite), p.unite))}</span>
            </li>`;
        }).join('')}
      </ul>`;
  }

  /* ======================================================= Entrée de stock / inventaire */

  function ouvrirMouvement(produit, type, apres) {
    const entree = type === 'entree';
    const divisible = uniteDivisible(produit.unite);
    const { el, fermer } = ouvrirModale({
      titre: entree ? 'Entrée de stock' : 'Inventaire',
      contenu: `
        <form class="form-modale" novalidate>
          <p class="texte-modale"><strong>${esc(produit.nom)}</strong> · stock enregistré : ${esc(formatQuantite(produit.stock, produit.unite))}</p>
          <div class="champ">
            <label for="mvt-quantite">${entree ? 'Quantité reçue' : 'Stock compté'} (${esc(produit.unite || 'unité')})</label>
            <input id="mvt-quantite" name="quantite" class="input" type="text" autocomplete="off" inputmode="${divisible ? 'decimal' : 'numeric'}" required>
            ${entree ? '' : '<small class="aide">Saisissez la quantité réellement présente : le stock sera corrigé à cette valeur.</small>'}
          </div>
          <div class="champ">
            <label for="mvt-note">${entree ? 'Fournisseur / note' : 'Note'} (facultatif)</label>
            <input id="mvt-note" name="note" class="input" type="text" maxlength="200" placeholder="${entree ? 'Ex. Livraison CIMAF, bon n° 245' : 'Ex. Inventaire de fin de mois'}">
          </div>
          <p class="erreur-form" role="alert" hidden></p>
          <div class="modale-actions">
            <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
            <button type="submit" class="btn btn-primaire">${entree ? 'Ajouter au stock' : 'Corriger le stock'}</button>
          </div>
        </form>`
    });
    const formulaire = el.querySelector('form');
    const zoneErreur = formulaire.querySelector('.erreur-form');
    formulaire.addEventListener('submit', async (e) => {
      e.preventDefault();
      const quantite = lireNombre(formulaire.quantite.value);
      const erreur = (message) => { zoneErreur.textContent = message; zoneErreur.hidden = false; };
      if (quantite === null || quantite < 0 || (entree && quantite === 0)) return erreur(entree ? 'Indiquez la quantité reçue.' : 'Indiquez le stock compté.');
      if (!divisible && !Number.isInteger(quantite)) return erreur(`Quantité entière attendue pour l’unité « ${produit.unite} ».`);
      zoneErreur.hidden = true;

      const bouton = formulaire.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      const { data, error } = await sb.rpc('mouvement_stock', {
        p_boutique: boutique.id,
        p_produit: produit.id,
        p_type: type,
        p_quantite: quantite,
        p_note: formulaire.note.value.trim() || null
      });
      if (error) { erreur(messageErreur(error)); boutonOccupe(bouton, false); return; }

      const nouveauStock = Number(Array.isArray(data) ? data[0] : data);
      if (Number.isFinite(nouveauStock)) remplacerProduit({ ...produit, stock: nouveauStock });
      else await chargerDonnees();
      fermer();
      toast(`Stock mis à jour : ${formatQuantite(s.produits.find((p) => p.id === produit.id)?.stock, produit.unite)}.`, 'succes');
      apres?.();
    });
  }

  /* ======================================================= Formulaire article (ajout / modification) */

  function ouvrirFormulaire(produit = null, apres = null) {
    const creation = !produit;
    /** Article créé mais grille refusée : la fenêtre reste ouverte et « Enregistrer » ne renvoie que la grille. */
    let creeSansGrille = null;
    const p = produit || { nom: '', categorie_id: s.categorie || null, unite: '', prix_detail: '', prix_gros: null, prix_achat: null, stock: '', seuil_alerte: '', sur_commande: Boolean(vocab('sans_stock')), code_barre: '' };
    const valeur = (v) => (v === null || v === undefined ? '' : esc(v));
    const { el, fermer } = ouvrirModale({
      titre: creation ? `Ajouter ${unArticle()}` : `Modifier ${leArticle()}`,
      variante: 'large',
      contenu: `
        <form class="form-modale" novalidate>
          <div class="champ">
            <label for="art-nom">Nom ${esc(deArticle())}</label>
            <input id="art-nom" name="nom" class="input" type="text" required maxlength="120" value="${valeur(p.nom)}" placeholder="Ex. Ciment CPJ 42,5">
          </div>

          <div class="rangee-champs">
            <div class="champ">
              <label for="art-categorie">Catégorie</label>
              <select id="art-categorie" name="categorie" class="input">
                <option value="">Sans catégorie</option>
                ${s.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === p.categorie_id ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}
              </select>
              <button type="button" class="btn-lien btn-lien-gauche" data-action-form="nouvelle-categorie">+ Créer une catégorie</button>
              <div class="nouvelle-categorie" hidden>
                <label for="art-nouvelle-categorie" class="sr-only">Nom de la nouvelle catégorie</label>
                <input id="art-nouvelle-categorie" class="input" type="text" maxlength="60" placeholder="Ex. Ciment & liants">
                <button type="button" class="btn btn-secondaire" data-action-form="creer-categorie">Créer</button>
              </div>
            </div>
            <div class="champ">
              <label for="art-unite">Unité de vente</label>
              <input id="art-unite" name="unite" class="input" type="text" list="liste-unites" required maxlength="30" value="${valeur(p.unite)}" placeholder="Choisir ou saisir (sac, kg, pièce…)">
              <datalist id="liste-unites">${(unites() || UNITES).map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
            </div>
          </div>

          <div class="rangee-champs">
            <div class="champ">
              <label for="art-prix-detail">Prix détail (GNF)</label>
              <input id="art-prix-detail" name="prix_detail" class="input" type="number" inputmode="numeric" min="0" step="1" required value="${valeur(p.prix_detail)}">
            </div>
            <div class="champ" ${aModule('prix_gros') ? '' : 'hidden'}>
              <label for="art-prix-gros">Prix gros (GNF, facultatif)</label>
              <input id="art-prix-gros" name="prix_gros" class="input" type="number" inputmode="numeric" min="0" step="1" value="${valeur(p.prix_gros)}">
            </div>
          </div>

          <div class="rangee-champs">
            <div class="champ">
              <label for="art-prix-achat">Prix d’achat (GNF, facultatif)</label>
              <input id="art-prix-achat" name="prix_achat" class="input" type="number" inputmode="numeric" min="0" step="1" value="${valeur(p.prix_achat)}">
            </div>
            <div class="champ">
              <label for="art-code">Code-barres (facultatif)</label>
              <input id="art-code" name="code_barre" class="input" type="text" inputmode="numeric" maxlength="64" value="${valeur(p.code_barre)}">
            </div>
          </div>

          <div class="champ" ${aModule('fournisseurs') ? '' : 'hidden'}>
            <label for="art-fournisseur">Fournisseur (facultatif)</label>
            <select id="art-fournisseur" name="fournisseur" class="input">
              <option value="">Aucun fournisseur</option>
              ${s.fournisseurs.filter((f) => f.actif || f.id === p.fournisseur_id).map((f) => `<option value="${esc(f.id)}" ${f.id === p.fournisseur_id ? 'selected' : ''}>${esc(f.nom)}</option>`).join('')}
            </select>
            <small class="aide">Sert aux bons de commande (Messages › Fournisseurs).</small>
          </div>

          ${peut('articles.promo') ? `
            <fieldset class="bloc-promo">
              <legend class="etiquette">Promotion (facultatif)</legend>
              <div class="rangee-champs">
                <div class="champ">
                  <label for="art-prix-promo">Prix promo (GNF)</label>
                  <input id="art-prix-promo" name="prix_promo" class="input" type="number" inputmode="numeric" min="0" step="1" value="${valeur(p.prix_promo)}" placeholder="Inférieur au prix détail">
                </div>
                <div class="champ">
                  <label for="art-promo-fin">Fin de la promo (incluse)</label>
                  <input id="art-promo-fin" name="promo_fin" class="input" type="date" min="${dateISO()}" value="${valeur(p.promo_fin ? String(p.promo_fin).slice(0, 10) : '')}">
                  <small class="aide">Vide : sans fin. Appliquée aussi à la caisse.</small>
                </div>
              </div>
              <button type="button" class="btn-lien btn-lien-gauche btn-lien-danger" data-action-form="retirer-promo" ${p.prix_promo ? '' : 'hidden'}>Retirer la promo</button>
            </fieldset>` : ''}

          <label class="case-option" ${aModule('boutique_en_ligne') ? '' : 'hidden'}>
            <input type="checkbox" name="en_ligne" ${p.en_ligne === false ? '' : 'checked'}>
            <span><strong>Visible en ligne</strong> (sur votre boutique en ligne)</span>
          </label>

          <label class="case-option">
            <input type="checkbox" name="sur_commande" ${p.sur_commande ? 'checked' : ''}>
            <span><strong>${esc(vocab('article'))} sur commande</strong> (pas de stock : sable, gravier, prestation…)</span>
          </label>

          ${aModule('variantes') || aVariantes(p) ? '<section class="bloc-variantes" data-zone="variantes"></section>' : ''}

          <div class="rangee-champs" data-zone="champs-stock">
            ${creation ? `
              <div class="champ" data-zone="stock-initial">
                <label for="art-stock">Stock initial</label>
                <input id="art-stock" name="stock" class="input" type="text" autocomplete="off" inputmode="decimal" value="">
              </div>` : ''}
            <div class="champ">
              <label for="art-seuil">Seuil d’alerte</label>
              <input id="art-seuil" name="seuil_alerte" class="input" type="text" autocomplete="off" inputmode="decimal" value="${valeur(p.seuil_alerte)}">
              <small class="aide">Vous serez alerté quand le stock descend à ce niveau.</small>
            </div>
          </div>

          <p class="erreur-form" role="alert" hidden></p>
          <div class="modale-actions">
            <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
            <button type="submit" class="btn btn-primaire">${creation ? esc(`Ajouter ${leArticle()}`) : 'Enregistrer'}</button>
          </div>
        </form>`
    });

    const formulaire = el.querySelector('form');
    const zoneErreur = formulaire.querySelector('.erreur-form');
    const erreur = (message) => { zoneErreur.textContent = message; zoneErreur.hidden = !message; };

    /** enregistrer_variantes (+ corrections) puis relecture de l'article et des cases de la liste. */
    async function envoyerGrille(article, prixAchat) {
      await editeur.enregistrer(article.id);
      const relu = await sb.from('produits').select(COLONNES_PRODUIT).eq('id', article.id).single();
      const final = relu.error ? article : relu.data;
      oublierVariantes(final.id);
      remplacerProduit({ ...final, prix_achat: prixAchat });
      await chargerCasesModeles();
      chargerBandeauReassort();
      return final;
    }

    function passerEnModification(article, prixAchat) {
      creeSansGrille = { article, prixAchat };
      el.querySelector('.modale-entete h2').textContent = `Modifier ${leArticle()}`;
      formulaire.querySelector('[type=submit]').textContent = 'Enregistrer la grille';
      formulaire.querySelectorAll('input:not([data-case]):not(#var-taille):not(#var-couleur-libre), select').forEach((champ) => {
        if (!champ.closest('[data-zone="variantes"]')) champ.disabled = true;
      });
    }

    /** Nouvel essai après un refus : seulement la grille, l'article existe déjà. */
    async function renvoyerGrille() {
      const bouton = formulaire.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      try {
        const data = await envoyerGrille(creeSansGrille.article, creeSansGrille.prixAchat);
        fermer();
        toast(`Modèle « ${data.nom} » enregistré · ${formatNombre(data.stock)} pièce${Number(data.stock) > 1 ? 's' : ''}.`, 'succes');
        apres?.();
      } catch (errGrille) {
        erreur(`${messageErreur(errGrille)} Corrigez puis touchez « Enregistrer la grille ».`);
        boutonOccupe(bouton, false);
      }
    }

    // Tailles & couleurs : le stock simple devient la somme de la grille (champ masqué).
    const zoneVariantes = el.querySelector('[data-zone="variantes"]');
    const editeur = zoneVariantes ? monterEditeurVariantes(zoneVariantes, {
      produit,
      parDefaut: creation && boutique.type_activite === 'habillement',
      onChange: () => majChampsStock()
    }) : null;

    function majChampsStock() {
      const surCommande = formulaire.sur_commande.checked;
      el.querySelector('[data-zone="champs-stock"]').hidden = surCommande;
      const stockInitial = el.querySelector('[data-zone="stock-initial"]');
      if (stockInitial) stockInitial.hidden = Boolean(editeur?.actif());
    }
    formulaire.sur_commande.addEventListener('change', majChampsStock);
    majChampsStock();

    el.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-action-form]')?.dataset.actionForm;
      if (action === 'nouvelle-categorie') {
        el.querySelector('.nouvelle-categorie').hidden = false;
        el.querySelector('#art-nouvelle-categorie').focus();
      }
      if (action === 'creer-categorie') creerCategorie(e.target.closest('button'));
      if (action === 'retirer-promo') {
        formulaire.prix_promo.value = '';
        formulaire.promo_fin.value = '';
        e.target.closest('button').hidden = true;
      }
    });
    el.querySelector('#art-nouvelle-categorie').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); creerCategorie(el.querySelector('[data-action-form="creer-categorie"]')); }
    });

    async function creerCategorie(bouton) {
      const champ = el.querySelector('#art-nouvelle-categorie');
      const nom = champ.value.trim();
      if (!nom) { champ.focus(); return; }
      const existante = s.categories.find((c) => normaliserTexte(c.nom) === normaliserTexte(nom));
      if (existante) {
        formulaire.categorie.value = existante.id;
      } else {
        boutonOccupe(bouton, true, '…');
        const ordre = s.categories.reduce((max, c) => Math.max(max, Number(c.ordre) || 0), 0) + 1;
        const { data, error } = await sb.from('categories').insert({ boutique_id: boutique.id, nom, ordre }).select('id, nom, ordre').single();
        boutonOccupe(bouton, false);
        if (error) { erreur(messageErreur(error)); return; }
        s.categories.push(data);
        formulaire.categorie.insertAdjacentHTML('beforeend', `<option value="${esc(data.id)}">${esc(data.nom)}</option>`);
        formulaire.categorie.value = data.id;
        renderFiltres();
      }
      champ.value = '';
      el.querySelector('.nouvelle-categorie').hidden = true;
      toast(`Catégorie « ${nom} » sélectionnée.`, 'succes');
    }

    formulaire.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nom = formulaire.nom.value.trim();
      const unite = formulaire.unite.value.trim();
      const prixDetail = lireNombre(formulaire.prix_detail.value);
      const prixGros = lireNombre(formulaire.prix_gros.value);
      const prixAchat = lireNombre(formulaire.prix_achat.value);
      const surCommande = formulaire.sur_commande.checked;
      const seuil = surCommande ? 0 : lireNombre(formulaire.seuil_alerte.value) ?? 0;
      const avecGrille = Boolean(editeur?.actif());
      const stockInitial = creation && !surCommande && !avecGrille ? lireNombre(formulaire.stock.value) ?? 0 : 0;
      const erreurGrille = editeur?.valider();
      if (erreurGrille) return erreur(erreurGrille);
      if (creeSansGrille) { await renvoyerGrille(); return; }

      if (nom.length < 2) return erreur('Indiquez le nom de l’article.');
      if (!unite) return erreur('Indiquez l’unité de vente (sac, kg, pièce…).');
      if (prixDetail === null || prixDetail <= 0) return erreur('Indiquez un prix détail supérieur à 0.');
      if ([prixGros, prixAchat].some((v) => v !== null && v < 0) || seuil < 0 || stockInitial < 0) return erreur('Les montants et quantités ne peuvent pas être négatifs.');
      if (!uniteDivisible(unite) && !Number.isInteger(stockInitial)) return erreur(`Stock entier attendu pour l’unité « ${unite} ».`);
      const avecPromo = Boolean(formulaire.prix_promo);
      const prixPromo = avecPromo ? lireNombre(formulaire.prix_promo.value) : null;
      if (prixPromo !== null && (prixPromo <= 0 || prixPromo >= prixDetail)) return erreur('Le prix promo doit être inférieur au prix de détail.');
      if (avecPromo && prixPromo === null && formulaire.promo_fin.value) return erreur('Indiquez le prix promo, ou videz la date de fin.');
      erreur('');

      const donnees = {
        nom,
        categorie_id: formulaire.categorie.value || null,
        unite,
        prix_detail: Math.round(prixDetail),
        prix_gros: prixGros === null ? null : Math.round(prixGros),
        prix_achat: prixAchat === null ? null : Math.round(prixAchat),
        seuil_alerte: seuil,
        sur_commande: surCommande,
        code_barre: formulaire.code_barre.value.trim() || null,
        fournisseur_id: formulaire.fournisseur.value || null,
        en_ligne: formulaire.en_ligne.checked
      };
      if (avecPromo) {
        donnees.prix_promo = prixPromo === null ? null : Math.round(prixPromo);
        donnees.promo_fin = prixPromo === null ? null : formulaire.promo_fin.value || null;
      }

      const bouton = formulaire.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      const requete = creation
        ? sb.from('produits').insert({ ...donnees, boutique_id: boutique.id, stock: stockInitial, actif: true })
        : sb.from('produits').update(donnees).eq('id', produit.id);
      let { data, error } = await requete.select(COLONNES_PRODUIT).single();
      if (error) { erreur(messageErreur(error)); boutonOccupe(bouton, false); return; }

      if (avecGrille) {
        try {
          data = await envoyerGrille(data, donnees.prix_achat);
        } catch (errGrille) {
          // L'article est enregistré : la fenêtre reste ouverte avec toutes les saisies (tailles, couleurs, quantités, prix spéciaux).
          remplacerProduit({ ...data, prix_achat: donnees.prix_achat });
          boutonOccupe(bouton, false);
          if (creation) passerEnModification(data, donnees.prix_achat);
          erreur(`${creation ? `« ${data.nom} » est créé, mais la grille n’est pas enregistrée : ` : ''}${messageErreur(errGrille)} Corrigez puis touchez « ${creation ? 'Enregistrer la grille' : 'Enregistrer'} ».`);
          return;
        }
      }

      // Le prix d'achat n'est pas relu par l'API : on garde la valeur enregistrée.
      remplacerProduit({ ...data, prix_achat: donnees.prix_achat });
      fermer();
      toast(avecGrille ? `Modèle « ${data.nom} » enregistré · ${formatNombre(data.stock)} pièce${Number(data.stock) > 1 ? 's' : ''}.` : creation ? `« ${data.nom} » ajouté au stock.` : 'Article mis à jour.', 'succes');
      apres?.();
    });
  }

  /* ======================================================= Événements */

  conteneur.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="ajouter"]')) return ouvrirFormulaire();
    const fiche = e.target.closest('[data-fiche]');
    if (fiche) return ouvrirFiche(fiche.dataset.fiche);
    const filtre = e.target.closest('[data-filtre]');
    if (filtre) { s.filtre = filtre.dataset.filtre; renderFiltres(); renderListe(); }
    return undefined;
  });
  conteneur.querySelector('#recherche-stock').addEventListener('input', (e) => { s.recherche = e.target.value; renderListe(); });
  zone('filtre-categorie').addEventListener('change', (e) => { s.categorie = e.target.value; renderListe(); });

  renderFiltres();
  chargerDonnees().then((ok) => {
    if (ok && gerer && params.get('ajouter')) ouvrirFormulaire();
  });
}
