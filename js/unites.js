/**
 * unites.js — Unités multiples (module « unites », étape 13, maquette Unites).
 *
 * produits.unite reste l'unité de BASE : le stock y est compté. Chaque unité de vente (unites_vente) a un
 * facteur (1 tonne = 112 barres) et un prix (null = facteur × prix de détail). Les lignes de vente, d'enlèvement
 * et de devis portent unite_id (null = unité de base) ; la base calcule le prix, la quantité de base et la marge.
 * Une unité et une taille / couleur ne se combinent pas (UNITE_ET_VARIANTE).
 */
import { sb } from './supabase.js';
import { etat } from './state.js';
import {
  esc, icone, ouvrirModale, formatNombre, formatGNF, formatQuantite, lireNombre, toast, confirmer, boutonOccupe, messageErreur,
  prixApplique, promoActive
} from './utils.js';
import { aModule } from './modules.js';

/* ------------------------------------------------------------ Libellés et prix */

const MOTS_INVARIABLES = /[sxz]$/i;
/** « Botte de 10 » → « bottes de 10 » (pluriel du premier mot), « Tonne » → « tonnes ». */
export function pluriel(nom) {
  const [premier, ...reste] = String(nom || '').trim().split(' ');
  return [MOTS_INVARIABLES.test(premier) ? premier : `${premier}s`, ...reste].join(' ');
}
const minuscule = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
/** « 2 tonnes », « 1 botte de 10 », « 0,5 tonne ». */
export function quantiteEnUnite(quantite, nom) {
  const n = Number(quantite) || 0;
  return `${formatNombre(n, 3)} ${minuscule(Math.abs(n) >= 2 ? pluriel(nom) : String(nom || '').trim())}`;
}

/**
 * Prix (aperçu) d'une unité : prix fixe de l'unité, sinon facteur × prix de base (promo comprise) ;
 * au gros : prix de gros de l'unité, sinon facteur × prix de gros. La base recalcule tout (prix_unite).
 */
export function prixUnite(produit, unite, typePrix = 'detail') {
  if (!unite) return prixApplique(produit, typePrix);
  const facteur = Number(unite.facteur) || 1;
  if (typePrix === 'gros' && unite.prix_gros !== null && unite.prix_gros !== undefined) return Number(unite.prix_gros);
  if (unite.prix !== null && unite.prix !== undefined && !(promoActive(produit) && typePrix === 'detail' && Number(unite.prix) > facteur * Number(produit.prix_promo))) return Number(unite.prix);
  return Math.round(facteur * prixApplique(produit, typePrix));
}

/* ------------------------------------------------------------ Données */

function normaliserUnite(u) {
  return {
    id: u.id, nom: u.nom, facteur: Number(u.facteur) || 1,
    prix: u.prix === null || u.prix === undefined ? null : Number(u.prix),
    prix_gros: u.prix_gros === null || u.prix_gros === undefined ? null : Number(u.prix_gros),
    prix_fixe: u.prix_fixe ?? (u.prix !== null && u.prix !== undefined),
    equivalent_stock: u.equivalent_stock === null || u.equivalent_stock === undefined ? null : Number(u.equivalent_stock),
    ordre: Number(u.ordre) || 0
  };
}

/** Unités actives de plusieurs articles (caisse, enlèvement, devis) : Map produit_id → [unités], par lots de 100. */
export async function chargerUnitesArticles(ids) {
  const carte = new Map();
  if (!aModule('unites') || !ids.length) return carte;
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from('unites_vente').select('id, produit_id, nom, facteur, prix, prix_gros, ordre')
      .in('produit_id', ids.slice(i, i + 100)).eq('actif', true).order('ordre');
    if (error) { console.warn('[YOUMMA] Unités de vente indisponibles :', error); return carte; }
    (data || []).forEach((u) => { const l = carte.get(u.produit_id) || []; l.push(normaliserUnite(u)); carte.set(u.produit_id, l); });
  }
  carte.forEach((l) => l.sort((a, b) => a.ordre - b.ordre || a.facteur - b.facteur));
  return carte;
}

/** unites_produit : unité de base, stock, prix de base, unités (avec équivalent du stock) et suggestions. */
export async function chargerUnites(idProduit) {
  const { data, error } = await sb.rpc('unites_produit', { p_produit: idProduit });
  if (error) throw error;
  const d = (Array.isArray(data) ? data[0] : data) || {};
  return {
    produit_id: d.produit_id, nom: d.nom, unite_base: d.unite_base || '', stock: Number(d.stock) || 0,
    prix_base: Number(d.prix_base) || 0, prix_gros_base: d.prix_gros_base === null || d.prix_gros_base === undefined ? null : Number(d.prix_gros_base),
    unites: (d.unites || []).map(normaliserUnite),
    suggestions: (d.suggestions || []).map((x) => ({ nom: x.nom, facteur: Number(x.facteur) || 1 }))
  };
}

/**
 * Lignes de vente lues en base : « (224 barres) » sous une ligne vendue dans une autre unité
 * (facteur ≠ 1 : quantite_base dans l'unité de base de l'article). Ajoute l.base (texte) quand c'est le cas.
 */
export async function completerLignesBase(lignes) {
  const concernees = (lignes || []).filter((l) => l.produit_id && l.facteur !== null && l.facteur !== undefined && Number(l.facteur) !== 1 && l.quantite_base !== null && l.quantite_base !== undefined);
  if (!concernees.length) return lignes;
  const ids = [...new Set(concernees.map((l) => l.produit_id))];
  const { data } = await sb.from('produits').select('id, unite').in('id', ids);
  const unites = new Map((data || []).map((p) => [p.id, p.unite]));
  concernees.forEach((l) => { if (unites.get(l.produit_id)) l.base = formatQuantite(Number(l.quantite_base), unites.get(l.produit_id)); });
  return lignes;
}

/* ------------------------------------------------------------ Choix de l'unité (caisse, enlèvement, devis) */

/**
 * Feuille du bas / fenêtre : pastilles d'unité (prix sous chaque nom), quantité, rappel « 2 tonnes = 224 barres ·
 * il vous reste 268 barres ». onAjout(unite|null, quantite) — null = unité de base.
 */
export function ouvrirChoixUnite({
  produit, unites, typePrix = 'detail', stockLibre = Infinity, controleStock = true, libelleAction = 'Ajouter',
  quantiteInitiale = 1, uniteInitiale = null, onAjout, onFermer = null
}) {
  const choix = [{ id: null, nom: produit.unite || 'unité', facteur: 1, base: true }, ...unites];
  const s = { unite: choix.find((u) => u.id === (uniteInitiale ?? null)) || choix[0], quantite: Number(quantiteInitiale) || 1, ajoute: false };
  const { el, fermer } = ouvrirModale({
    titre: produit.nom, variante: 'feuille',
    contenu: '<div class="cu-choix" data-zone="choix-unite"></div>',
    onFermer: () => { if (!s.ajoute) onFermer?.(); }
  });
  const cadre = el.querySelector('[data-zone="choix-unite"]');
  const prixDe = (u) => (u.base ? prixApplique(produit, typePrix) : prixUnite(produit, u, typePrix));

  function rappel() {
    const base = s.quantite * s.unite.facteur;
    const parties = [];
    if (!s.unite.base) parties.push(`${quantiteEnUnite(s.quantite, s.unite.nom)} = ${formatQuantite(Math.round(base * 1000) / 1000, produit.unite)}`);
    if (controleStock && !produit.sur_commande) parties.push(`il vous reste ${formatQuantite(stockLibre, produit.unite)}`);
    return parties.join(' · ');
  }
  function depasse() {
    return controleStock && !produit.sur_commande && s.quantite * s.unite.facteur > stockLibre + 1e-9;
  }
  function render() {
    const prix = prixDe(s.unite);
    cadre.innerHTML = `
      <div class="cu-bloc"><span class="cu-etape">1. Unité</span>
        <div class="cu-unites" role="radiogroup" aria-label="Unité de vente">
          ${choix.map((u) => `<button type="button" class="cu-unite ${u === s.unite ? 'actif' : ''}" role="radio" aria-checked="${u === s.unite}" data-unite="${esc(u.id ?? '')}">
            <span class="cu-nom">${esc(u.nom)}${u.base ? ' <span class="cu-base">base</span>' : ''}</span><span class="cu-prix">${formatNombre(prixDe(u))} GNF</span></button>`).join('')}
        </div></div>
      <div class="cu-bloc"><label class="cu-etape" for="cu-quantite">2. Quantité (${esc(s.unite.base ? produit.unite || 'unité' : minuscule(pluriel(s.unite.nom)))})</label>
        <div class="cu-quantite">
          <button type="button" data-qte="-1" aria-label="Diminuer" ${s.quantite <= 1 ? 'disabled' : ''}>−</button>
          <input id="cu-quantite" class="input" type="text" inputmode="decimal" autocomplete="off" value="${String(s.quantite).replace('.', ',')}">
          <button type="button" data-qte="1" aria-label="Augmenter">+</button>
        </div>
        <p class="cu-rappel ${depasse() ? 'texte-danger' : ''}" data-ref="rappel">${esc(rappel())}</p></div>
      <button type="button" class="btn btn-primaire btn-grand btn-bloc" data-action="ajouter-unite" ${s.quantite > 0 && !depasse() ? '' : 'disabled'}>
        ${esc(`${libelleAction} · ${s.unite.base ? formatQuantite(s.quantite, produit.unite) : quantiteEnUnite(s.quantite, s.unite.nom)} · ${formatNombre(Math.round(prix * s.quantite))}`)}</button>`;
  }
  cadre.addEventListener('click', (e) => {
    const bu = e.target.closest('[data-unite]');
    if (bu) { s.unite = choix.find((u) => String(u.id ?? '') === bu.dataset.unite) || choix[0]; render(); return; }
    const bq = e.target.closest('[data-qte]');
    if (bq && !bq.disabled) { s.quantite = Math.max(1, Math.floor(s.quantite) + Number(bq.dataset.qte)); render(); return; }
    if (e.target.closest('[data-action="ajouter-unite"]')) {
      s.ajoute = true;
      fermer();
      onAjout(s.unite.base ? null : s.unite, s.quantite);
    }
  });
  cadre.addEventListener('change', (e) => {
    if (e.target.id !== 'cu-quantite') return;
    const n = lireNombre(e.target.value);
    s.quantite = n > 0 ? Math.round(n * 1000) / 1000 : s.quantite;
    render();
  });
  render();
}

/* ------------------------------------------------------------ Fiche article : « Façons de vendre » */

/**
 * Section de la fiche (lecture) : unités de vente, équivalences du stock, seuil en unité de base.
 * gerer : modification possible (gérant). apres(d) après un enregistrement.
 */
export function monterFaconsDeVendre(zone, { produit, gerer = false, apres = () => {} }) {
  const s = { d: null, edition: false, lignes: [], ajout: false, enCours: false };

  const prixCalcule = (l) => Math.round((Number(l.facteur) || 0) * (s.d?.prix_base || produit.prix_detail || 0));

  function equivalences() {
    const d = s.d;
    if (!d.unites.length || produit.sur_commande) return '';
    const eq = d.unites.map((u) => `<span class="cu-equivalence">≈ ${esc(quantiteEnUnite(Math.round((u.equivalent_stock ?? d.stock / u.facteur) * 10) / 10, u.nom))}</span>`).join('');
    const seuil = Number(produit.seuil_alerte) || 0;
    const grande = [...d.unites].sort((a, b) => b.facteur - a.facteur)[0];
    return `
      <div class="cu-stock"><span class="cu-stock-valeur"><strong>${formatNombre(d.stock, 3)}</strong> ${esc(Math.abs(d.stock) >= 2 ? pluriel(d.unite_base) : d.unite_base)}</span>${eq}</div>
      ${seuil ? `<p class="cu-seuil">Seuil d’alerte : ${esc(formatQuantite(seuil, d.unite_base))}${grande ? ` <span class="discret">(≈ ${esc(quantiteEnUnite(Math.round((seuil / grande.facteur) * 100) / 100, grande.nom))})</span>` : ''}</p>` : ''}`;
  }

  function lectureHTML() {
    const d = s.d;
    return `
      <div class="cu-entete"><h3 class="fiche-sous-titre">Façons de vendre</h3>
        ${gerer ? `<button type="button" class="btn btn-secondaire btn-petit" data-cu="modifier">${icone('crayon', 16, 2)} ${d.unites.length ? 'Modifier' : 'Ajouter une unité'}</button>` : ''}</div>
      <div class="tableau-cadre"><table class="cu-table">
        <thead><tr><th>Unité</th><th>Correspond à</th><th class="droite">Prix de vente</th></tr></thead>
        <tbody>
          <tr><td class="gras">${esc(d.unite_base)} <span class="cu-base">base</span></td><td class="discret">—</td><td class="droite gras">${formatGNF(d.prix_base)}</td></tr>
          ${d.unites.map((u) => `<tr><td class="gras">${esc(u.nom)}</td><td class="discret">${esc(formatQuantite(u.facteur, d.unite_base))}</td>
            <td class="droite gras">${formatGNF(u.prix ?? Math.round(u.facteur * d.prix_base))}${u.prix === null ? ' <span class="discret">calculé</span>' : ''}</td></tr>`).join('')}
        </tbody></table></div>
      ${equivalences()}`;
  }

  function editionHTML() {
    const d = s.d;
    const gros = aModule('prix_gros');
    return `
      <div class="cu-entete"><h3 class="fiche-sous-titre">Façons de vendre</h3></div>
      <div class="tableau-cadre"><table class="cu-table cu-edition">
        <thead><tr><th>Unité</th><th>Correspond à</th><th>Prix de vente</th>${gros ? '<th>Prix de gros</th>' : ''}<th><span class="sr-only">Retirer</span></th></tr></thead>
        <tbody>
          <tr><td class="gras">${esc(d.unite_base)} <span class="cu-base">base</span></td><td class="discret">—</td><td class="gras">${formatGNF(d.prix_base)}</td>${gros ? '<td></td>' : ''}<td></td></tr>
          ${s.lignes.map((l, i) => `<tr data-ligne="${i}">
            <td><label class="sr-only" for="cu-nom-${i}">Nom de l’unité</label><input id="cu-nom-${i}" class="input" type="text" maxlength="40" data-champ="nom" value="${esc(l.nom)}" placeholder="Ex. Tonne"></td>
            <td><span class="cu-facteur"><label class="sr-only" for="cu-fac-${i}">Nombre de ${esc(d.unite_base)}</label><input id="cu-fac-${i}" class="input" type="text" inputmode="decimal" data-champ="facteur" value="${l.facteur === '' ? '' : esc(String(l.facteur).replace('.', ','))}" placeholder="112"><span class="discret">${esc(pluriel(d.unite_base))}</span></span></td>
            <td><label class="sr-only" for="cu-prix-${i}">Prix de vente</label><input id="cu-prix-${i}" class="input" type="text" inputmode="numeric" data-champ="prix" value="${l.prix === null ? '' : esc(formatNombre(l.prix))}" placeholder="${esc(formatNombre(prixCalcule(l)))} calculé"></td>
            ${gros ? `<td><label class="sr-only" for="cu-gros-${i}">Prix de gros</label><input id="cu-gros-${i}" class="input" type="text" inputmode="numeric" data-champ="prix_gros" value="${l.prix_gros === null ? '' : esc(formatNombre(l.prix_gros))}" placeholder="facultatif"></td>` : ''}
            <td><button type="button" class="btn-icone btn-icone-clair btn-icone-danger" data-retirer-unite="${i}" aria-label="Retirer l’unité ${esc(l.nom)}">×</button></td>
          </tr>`).join('')}
        </tbody></table></div>
      ${s.ajout ? `
        <div class="cu-suggestions">
          <span class="discret">Suggestions pour « ${esc(d.unite_base)} » :</span>
          ${d.suggestions.filter((x) => !s.lignes.some((l) => l.nom.toLowerCase() === x.nom.toLowerCase())).map((x) => `<button type="button" class="pastille-grille" data-suggestion="${esc(x.nom)}" data-facteur="${x.facteur}">${esc(x.nom)} · ${esc(formatQuantite(x.facteur, d.unite_base))}</button>`).join('') || '<span class="discret">aucune</span>'}
          <button type="button" class="pastille-grille pastille-ajout" data-cu="autre">Autre unité</button>
        </div>` : `<button type="button" class="btn btn-pointille" data-cu="ajout" ${s.lignes.length >= 10 ? 'disabled' : ''}>+ Ajouter une unité</button>`}
      <p class="erreur-form" data-ref="erreur-unites" hidden></p>
      <div class="cu-actions"><button type="button" class="btn btn-secondaire" data-cu="annuler">Annuler</button>
        <button type="button" class="btn btn-primaire" data-cu="enregistrer">Enregistrer les unités</button></div>`;
  }

  function render() {
    if (!s.d) { zone.innerHTML = '<div class="squelette" style="height:90px"></div>'; return; }
    zone.innerHTML = s.edition ? editionHTML() : lectureHTML();
  }

  function erreur(message) {
    const z = zone.querySelector('[data-ref="erreur-unites"]');
    if (z) { z.textContent = message; z.hidden = !message; }
  }

  async function enregistrer(bouton) {
    const p_unites = [];
    const noms = new Set([String(s.d.unite_base).toLowerCase()]);
    for (const l of s.lignes) {
      const nom = String(l.nom || '').trim();
      const facteur = Number(l.facteur);
      if (!nom) return erreur('Donnez un nom à chaque unité.');
      if (noms.has(nom.toLowerCase())) return erreur(nom.toLowerCase() === String(s.d.unite_base).toLowerCase() ? messageErreur(`UNITE_DE_BASE: ${nom}`) : `L’unité « ${nom} » est en double.`);
      noms.add(nom.toLowerCase());
      if (!(facteur > 0) || facteur === 1) return erreur(`Indiquez combien de ${pluriel(s.d.unite_base)} font une ${nom.toLowerCase()} (nombre différent de 1).`);
      if ((l.prix !== null && l.prix < 0) || (l.prix_gros !== null && l.prix_gros < 0)) return erreur('Un prix n’est pas valide.');
      p_unites.push({ nom, facteur, prix: l.prix, prix_gros: l.prix_gros });
    }
    if (p_unites.length > 10) return erreur(messageErreur('TROP_D_UNITES'));
    erreur('');
    boutonOccupe(bouton, true, 'Enregistrement…');
    const { data, error } = await sb.rpc('enregistrer_unites', { p_boutique: etat.boutique.id, p_produit: produit.id, p_unites });
    if (error) { boutonOccupe(bouton, false); erreur(messageErreur(error)); return; }
    s.d = data ? await chargerUnites(produit.id).catch(() => s.d) : s.d;
    s.edition = false;
    s.ajout = false;
    render();
    toast('Unités de vente enregistrées.', 'succes');
    apres(s.d);
  }

  zone.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-cu]')?.dataset.cu;
    if (a === 'modifier') {
      s.lignes = s.d.unites.map((u) => ({ id: u.id, nom: u.nom, facteur: u.facteur, prix: u.prix, prix_gros: u.prix_gros }));
      s.edition = true; s.ajout = !s.lignes.length; render(); return;
    }
    if (a === 'annuler') { s.edition = false; s.ajout = false; render(); return; }
    if (a === 'ajout') { s.ajout = true; render(); return; }
    if (a === 'autre') { s.lignes.push({ nom: '', facteur: '', prix: null, prix_gros: null }); s.ajout = false; render(); zone.querySelector(`#cu-nom-${s.lignes.length - 1}`)?.focus(); return; }
    if (a === 'enregistrer') { enregistrer(e.target.closest('button')); return; }
    const sug = e.target.closest('[data-suggestion]');
    if (sug) { s.lignes.push({ nom: sug.dataset.suggestion, facteur: Number(sug.dataset.facteur), prix: null, prix_gros: null }); s.ajout = false; render(); return; }
    const ret = e.target.closest('[data-retirer-unite]');
    if (ret) {
      const l = s.lignes[Number(ret.dataset.retirerUnite)];
      if (l.id && !(await confirmer(`L’unité « ${l.nom} » ne sera plus proposée à la caisse. Les ventes déjà faites ne changent pas.`, { titre: 'Retirer l’unité', libelleOk: 'Retirer', danger: true }))) return;
      s.lignes.splice(Number(ret.dataset.retirerUnite), 1);
      render();
    }
  });
  zone.addEventListener('input', (e) => {
    const champ = e.target.dataset.champ;
    if (!champ) return;
    const l = s.lignes[Number(e.target.closest('[data-ligne]').dataset.ligne)];
    if (champ === 'nom') l.nom = e.target.value;
    else if (champ === 'facteur') {
      l.facteur = lireNombre(e.target.value) ?? '';
      // Le prix calculé suit le facteur en direct.
      const prix = e.target.closest('tr').querySelector('[data-champ="prix"]');
      if (prix) prix.placeholder = `${formatNombre(prixCalcule(l))} calculé`;
    } else {
      const n = lireNombre(e.target.value);
      l[champ] = n === null ? null : Math.round(n);
    }
  });

  render();
  chargerUnites(produit.id).then((d) => { s.d = d; if (zone.isConnected) render(); })
    .catch((err) => { if (zone.isConnected) zone.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`; });
  return { recharger: () => chargerUnites(produit.id).then((d) => { s.d = d; render(); }) };
}

/* ------------------------------------------------------------ Changer l'unité de base */

/** « 1 barre = combien de mètres ? » : stock, prix, seuil et facteurs convertis par changer_unite_base. */
export async function ouvrirChangerUniteBase(produit, apres = () => {}) {
  // Devis en cours qui contiennent l'article : leurs quantités ne sont pas converties.
  let devisEnCours = 0;
  try {
    const { data } = await sb.from('proformas').select('id, lignes').eq('boutique_id', etat.boutique.id).in('statut', ['brouillon', 'envoye']);
    devisEnCours = (data || []).filter((pf) => (pf.lignes || []).some((l) => l.produit_id === produit.id)).length;
  } catch { /* information facultative */ }
  const ancienne = produit.unite || 'unité';
  const { el, fermer } = ouvrirModale({
    titre: 'Changer l’unité de base',
    contenu: `
      <form class="form-modale" novalidate>
        <p class="texte-modale">Le stock de <strong>${esc(produit.nom)}</strong> est compté en <strong>${esc(pluriel(ancienne))}</strong>. Choisissez la nouvelle unité de base : le stock, les prix, le seuil d’alerte et les autres unités seront <strong>convertis</strong>.</p>
        <div class="champ"><label for="cub-unite">Nouvelle unité de base</label><input id="cub-unite" class="input" type="text" maxlength="30" placeholder="Ex. mètre" required></div>
        <div class="champ"><label for="cub-facteur" data-ref="question">1 ${esc(ancienne)} = combien de … ?</label><input id="cub-facteur" class="input" type="text" inputmode="decimal" placeholder="Ex. 12" required>
          <small class="aide" data-ref="apercu">Stock actuel : ${esc(formatQuantite(produit.stock, ancienne))}.</small></div>
        ${devisEnCours ? `<p class="note-alerte">${icone('alerte', 16, 2)} ${devisEnCours} devis en cours contien${devisEnCours > 1 ? 'nent' : 't'} cet article : leurs quantités ne seront pas converties. Mieux vaut changer l’unité quand ils sont terminés.</p>` : ''}
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Convertir</button></div>
      </form>`
  });
  const form = el.querySelector('form');
  const zoneErreur = form.querySelector('.erreur-form');
  const maj = () => {
    const unite = form.querySelector('#cub-unite').value.trim() || '…';
    const f = lireNombre(form.querySelector('#cub-facteur').value);
    form.querySelector('[data-ref="question"]').textContent = `1 ${ancienne} = combien de ${pluriel(unite)} ?`;
    form.querySelector('[data-ref="apercu"]').textContent = f > 0
      ? `Stock : ${formatQuantite(produit.stock, ancienne)} → ${formatQuantite(Math.round(Number(produit.stock) * f * 1000) / 1000, unite)} · prix : ${formatGNF(produit.prix_detail)} → ${formatGNF(Math.round(Number(produit.prix_detail) / f))} le ${unite}`
      : `Stock actuel : ${formatQuantite(produit.stock, ancienne)}.`;
  };
  form.addEventListener('input', maj);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const unite = form.querySelector('#cub-unite').value.trim();
    const facteur = lireNombre(form.querySelector('#cub-facteur').value);
    const montrer = (m) => { zoneErreur.textContent = m; zoneErreur.hidden = !m; };
    if (!unite) return montrer('Indiquez la nouvelle unité.');
    if (unite.toLowerCase() === ancienne.toLowerCase()) return montrer(messageErreur(`UNITE_DE_BASE: ${unite}`));
    if (!(facteur > 0) || facteur === 1) return montrer(`Indiquez combien de ${pluriel(unite)} font une ${ancienne} (nombre différent de 1).`);
    if (!(await confirmer(`1 ${ancienne} = ${formatNombre(facteur, 3)} ${pluriel(unite)}. Le stock, les prix et les unités seront convertis. Continuer ?`, { titre: 'Confirmer la conversion', libelleOk: 'Convertir' }))) return;
    const bouton = form.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Conversion…');
    const { error } = await sb.rpc('changer_unite_base', { p_boutique: etat.boutique.id, p_produit: produit.id, p_unite: unite, p_facteur: facteur });
    if (error) { boutonOccupe(bouton, false); montrer(messageErreur(error)); return; }
    fermer();
    toast(`Unité de base : ${unite}. Stock et prix convertis.`, 'succes');
    apres();
  });
}
