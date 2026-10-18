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
  formatNombre, formatGNF, formatQuantite, formatDate, uniteDivisible, UNITES
} from './utils.js';

const COLONNES_PRODUIT = 'id, categorie_id, nom, unite, prix_detail, prix_gros, prix_achat, stock, seuil_alerte, sur_commande, code_barre, photo_url, actif';
/** Un vendeur ne reçoit pas le prix d’achat (masquage côté interface, voir le rapport de l’étape 4). */
const colonnesProduit = () => (peut('voir_prix_achat') ? COLONNES_PRODUIT : COLONNES_PRODUIT.replace(' prix_achat,', ''));

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

export function afficherStock(conteneur, params) {
  const boutique = etat.boutique;
  const gerer = peut('gerer_stock');
  const s = {
    produits: [],
    categories: [],
    charge: false,
    recherche: params.get('q') || '',
    categorie: '',
    filtre: params.get('filtre') === 'bas' ? 'bas' : 'tous'
  };
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);
  const nomCategorie = (id) => s.categories.find((c) => c.id === id)?.nom || 'Sans catégorie';

  /* ======================================================= Gabarit */

  conteneur.innerHTML = `
    <div class="page">
      <header class="page-entete">
        <div class="page-titres">
          <h1>Stock</h1>
          <span data-zone="resume">Chargement des articles…</span>
        </div>
        ${gerer ? `<button type="button" class="btn btn-primaire" data-action="ajouter">${icone('plus', 18, 2.4)} Ajouter un article</button>` : ''}
      </header>

      <section class="carte outils-stock" aria-label="Filtres">
        <label class="recherche-entete recherche-large">
          ${icone('recherche', 18, 2)}
          <span class="sr-only">Rechercher un article</span>
          <input type="search" id="recherche-stock" placeholder="Nom ou code-barres…" value="${esc(s.recherche)}" autocomplete="off">
        </label>
        <div class="champ champ-en-ligne">
          <label for="filtre-categorie" class="sr-only">Catégorie</label>
          <select id="filtre-categorie" class="input" data-zone="filtre-categorie"><option value="">Toutes les catégories</option></select>
        </div>
        <div class="segments" role="group" aria-label="Filtre">
          <button type="button" class="segment" data-filtre="tous">Tous</button>
          <button type="button" class="segment" data-filtre="bas">Stock bas</button>
          ${gerer ? '<button type="button" class="segment" data-filtre="inactifs">Désactivés</button>' : ''}
        </div>
      </section>

      <section class="carte carte-liste-stock" aria-label="Articles">
        <div class="entete-liste-stock seul-ordi" aria-hidden="true">
          <span>Article</span><span>Catégorie</span><span>Prix détail</span><span>Prix gros</span><span>Stock</span><span></span>
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
    zone('resume').textContent = `${actifs.length} article${actifs.length > 1 ? 's' : ''} actif${actifs.length > 1 ? 's' : ''}`
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
        inactifs: 'Aucun article désactivé.',
        tous: 'Aucun article ne correspond à votre recherche.'
      };
      zone('liste').innerHTML = `<li class="etat-vide etat-vide-large"><p>${esc(messages[s.filtre])}</p></li>`;
      return;
    }
    zone('liste').innerHTML = liste.map(ligneHTML).join('');
  }

  function ligneHTML(p) {
    const pastille = pastilleStock(p);
    const unite = esc(p.unite || 'unité');
    const gros = p.prix_gros !== null && p.prix_gros !== undefined;
    return `
      <li>
        <button type="button" class="ligne-stock ${p.actif ? '' : 'inactif'}" data-fiche="${esc(p.id)}">
          <span class="ls-article">
            <span class="ls-textes">
              <span class="gras">${esc(p.nom)}</span>
              <span class="discret">
                <span class="seul-mobile">${esc(nomCategorie(p.categorie_id))}${p.code_barre ? ' · ' : ''}</span>${p.code_barre ? esc(p.code_barre) : ''}${p.actif ? '' : ' · Désactivé'}
              </span>
            </span>
          </span>
          <span class="ls-categorie seul-ordi">${esc(nomCategorie(p.categorie_id))}</span>
          <span class="ls-prix seul-ordi"><span class="gras">${formatNombre(p.prix_detail)}</span> <span class="discret">/ ${unite}</span></span>
          <span class="ls-prix seul-ordi">${gros ? `<span class="gras">${formatNombre(p.prix_gros)}</span> <span class="discret">/ ${unite}</span>` : '<span class="discret">—</span>'}</span>
          <span class="ls-prix-mobile seul-mobile">
            Détail <strong>${formatNombre(p.prix_detail)}</strong>${gros ? ` · Gros <strong>${formatNombre(p.prix_gros)}</strong>` : ''} <span class="discret">GNF / ${unite}</span>
          </span>
          <span class="ls-stock"><span class="pastille-stock ${pastille.classe}">${esc(pastille.texte)}</span></span>
          <span class="ls-chevron seul-ordi">${icone('chevronDroite', 18, 2)}</span>
        </button>
      </li>`;
  }

  /* ======================================================= Données */

  async function chargerDonnees() {
    const [produitsRes, categoriesRes] = await Promise.all([
      sb.from('produits').select(colonnesProduit()).eq('boutique_id', boutique.id).order('nom'),
      sb.from('categories').select('id, nom, ordre').eq('boutique_id', boutique.id).order('ordre').order('nom')
    ]);
    if (produitsRes.error || categoriesRes.error) {
      zone('liste').innerHTML = `<li class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(produitsRes.error || categoriesRes.error))}</li>`;
      zone('resume').textContent = '';
      return false;
    }
    s.produits = produitsRes.data;
    s.categories = categoriesRes.data;
    s.charge = true;
    renderFiltres();
    renderListe();
    return true;
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
    }

    el.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-action-fiche]')?.dataset.actionFiche;
      if (!action) return;
      if (action === 'entree' || action === 'ajustement') ouvrirMouvement(produit, action, rafraichir);
      if (action === 'modifier') ouvrirFormulaire(produit, rafraichir);
      if (action === 'activer') {
        const desactiver = produit.actif;
        if (desactiver && !(await confirmer(`« ${produit.nom} » n’apparaîtra plus dans la caisse. Son historique est conservé et vous pourrez le réactiver.`, { titre: 'Désactiver l’article', libelleOk: 'Désactiver', danger: true }))) return;
        const { data, error } = await sb.from('produits').update({ actif: !desactiver }).eq('id', produit.id).select(COLONNES_PRODUIT).single();
        if (error) { toast(messageErreur(error), 'erreur'); return; }
        remplacerProduit(data);
        toast(desactiver ? 'Article désactivé.' : 'Article réactivé.', 'succes');
        fermer();
      }
    });
    rafraichir();
  }

  function ficheHTML(p) {
    const pastille = pastilleStock(p);
    const info = (libelle, valeur) => `<div class="fiche-info"><dt>${esc(libelle)}</dt><dd>${valeur}</dd></div>`;
    return `
      <div class="fiche-stock">
        <div class="fiche-stock-actuel">
          <span class="discret">Stock actuel</span>
          <span class="pastille-stock pastille-grande ${pastille.classe}">${esc(pastille.texte)}</span>
          ${p.actif ? '' : '<span class="statut-inactif">Article désactivé</span>'}
        </div>
        <dl class="fiche-infos">
          ${info('Catégorie', esc(nomCategorie(p.categorie_id)))}
          ${info('Unité', esc(p.unite || '—'))}
          ${info('Prix détail', formatGNF(p.prix_detail))}
          ${info('Prix gros', p.prix_gros !== null && p.prix_gros !== undefined ? formatGNF(p.prix_gros) : '—')}
          ${peut('voir_prix_achat') ? info('Prix d’achat', p.prix_achat !== null && p.prix_achat !== undefined ? formatGNF(p.prix_achat) : '—') : ''}
          ${info('Seuil d’alerte', p.sur_commande ? '—' : esc(formatQuantite(p.seuil_alerte, p.unite)))}
          ${info('Code-barres', esc(p.code_barre || '—'))}
        </dl>
        ${gerer ? `
          <div class="fiche-actions">
            ${p.sur_commande || !p.actif ? '' : `
              <button type="button" class="btn btn-primaire" data-action-fiche="entree">${icone('entree', 18, 2)} Entrée de stock</button>
              <button type="button" class="btn btn-secondaire" data-action-fiche="ajustement">${icone('inventaire', 18, 2)} Inventaire</button>`}
            <button type="button" class="btn btn-secondaire" data-action-fiche="modifier">${icone('crayon', 18, 2)} Modifier</button>
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
                <span class="gras">${esc(LIBELLES_MOUVEMENTS[m.type] || capitaliser(m.type || 'Mouvement'))}</span>
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
    const p = produit || { nom: '', categorie_id: s.categorie || null, unite: '', prix_detail: '', prix_gros: null, prix_achat: null, stock: '', seuil_alerte: '', sur_commande: false, code_barre: '' };
    const valeur = (v) => (v === null || v === undefined ? '' : esc(v));
    const { el, fermer } = ouvrirModale({
      titre: creation ? 'Ajouter un article' : 'Modifier l’article',
      variante: 'large',
      contenu: `
        <form class="form-modale" novalidate>
          <div class="champ">
            <label for="art-nom">Nom de l’article</label>
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
              <datalist id="liste-unites">${UNITES.map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
            </div>
          </div>

          <div class="rangee-champs">
            <div class="champ">
              <label for="art-prix-detail">Prix détail (GNF)</label>
              <input id="art-prix-detail" name="prix_detail" class="input" type="number" inputmode="numeric" min="0" step="1" required value="${valeur(p.prix_detail)}">
            </div>
            <div class="champ">
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

          <label class="case-option">
            <input type="checkbox" name="sur_commande" ${p.sur_commande ? 'checked' : ''}>
            <span><strong>Article sur commande</strong> (pas de stock : sable, gravier, prestation…)</span>
          </label>

          <div class="rangee-champs" data-zone="champs-stock">
            ${creation ? `
              <div class="champ">
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
            <button type="submit" class="btn btn-primaire">${creation ? 'Ajouter l’article' : 'Enregistrer'}</button>
          </div>
        </form>`
    });

    const formulaire = el.querySelector('form');
    const zoneErreur = formulaire.querySelector('.erreur-form');
    const erreur = (message) => { zoneErreur.textContent = message; zoneErreur.hidden = !message; };

    function majChampsStock() {
      const surCommande = formulaire.sur_commande.checked;
      el.querySelector('[data-zone="champs-stock"]').hidden = surCommande;
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
      const stockInitial = creation && !surCommande ? lireNombre(formulaire.stock.value) ?? 0 : 0;

      if (nom.length < 2) return erreur('Indiquez le nom de l’article.');
      if (!unite) return erreur('Indiquez l’unité de vente (sac, kg, pièce…).');
      if (prixDetail === null || prixDetail <= 0) return erreur('Indiquez un prix détail supérieur à 0.');
      if ([prixGros, prixAchat].some((v) => v !== null && v < 0) || seuil < 0 || stockInitial < 0) return erreur('Les montants et quantités ne peuvent pas être négatifs.');
      if (!uniteDivisible(unite) && !Number.isInteger(stockInitial)) return erreur(`Stock entier attendu pour l’unité « ${unite} ».`);
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
        code_barre: formulaire.code_barre.value.trim() || null
      };

      const bouton = formulaire.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      const requete = creation
        ? sb.from('produits').insert({ ...donnees, boutique_id: boutique.id, stock: stockInitial, actif: true })
        : sb.from('produits').update(donnees).eq('id', produit.id);
      const { data, error } = await requete.select(COLONNES_PRODUIT).single();
      if (error) { erreur(messageErreur(error)); boutonOccupe(bouton, false); return; }

      remplacerProduit(data);
      fermer();
      toast(creation ? `« ${data.nom} » ajouté au stock.` : 'Article mis à jour.', 'succes');
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
