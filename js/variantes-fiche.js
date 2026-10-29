/**
 * variantes-fiche.js — Tailles & couleurs côté gestion (maquettes FicheModele et StockTailles) :
 *  - éditeur de la fiche modèle : grille de tailles, couleurs (photo par couleur), stock par case,
 *    prix spécial et code-barres d'une case, case retirée ;
 *  - arrivage / inventaire sur la grille (mouvement_variantes) ;
 *  - étiquettes A4 (Code 128, JsBarcode) ;
 *  - liste à réassortir (variantes_a_reassortir) → commande fournisseur, copie ou WhatsApp.
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import {
  esc, icone, toast, confirmer, ouvrirModale, boutonOccupe, messageErreur, lireNombre, formatNombre, formatGNF,
  copierTexte, normaliserTelephone
} from './utils.js';
import { aModule } from './modules.js';
import { chargerJsBarcode } from './codes-barres.js';
import { ouvrirOutilImage } from './images/outil.js';
import { envoyerLogoAnnexe } from './images/envoi.js';
import {
  PALETTE_COULEURS, couleursDe, rondCouleur, libelleVariante, nomAvecVariante, chargerVariantes, memoriserVariantes, oublierVariantes
} from './variantes.js';

const SEP = '\u0001';
const cleCase = (t, c) => `${t}${SEP}${c}`;

/** Grilles de tailles (id, boutique_id, nom, tailles, ordre) : YOUMMA (boutique_id null, par ordre) puis celles de la boutique. */
async function chargerGrilles() {
  const { data, error } = await sb.from('grilles_tailles').select('id, boutique_id, nom, tailles, ordre')
    .or(`boutique_id.is.null,boutique_id.eq.${etat.boutique.id}`).order('ordre');
  if (error) { console.warn('[YOUMMA] Grilles de tailles indisponibles :', error); return []; }
  const rang = (g) => (g.boutique_id ? 1 : 0);
  return (data || []).sort((a, b) => rang(a) - rang(b) || (Number(a.ordre) || 0) - (Number(b.ordre) || 0));
}

/** Limites vérifiées dans l'appli avant tout envoi (la base a les mêmes). */
const MAX_TAILLES = 30;
const MAX_COULEURS = 20;
const MAX_CASES = 400;

const classeQuantite = (n) => (n <= 0 ? 'zero' : n === 1 ? 'un' : '');

/* =========================================================================
   Éditeur de la fiche modèle
   ========================================================================= */

/**
 * Monte l'éditeur dans zone. produit : l'article (null en création). parDefaut : interrupteur activé d'office.
 * Renvoie { actif(), stockSimple(), valider(), enregistrer(idProduit) }.
 */
export function monterEditeurVariantes(zone, { produit = null, parDefaut = false, onChange = () => {} } = {}) {
  const dejaModele = Boolean(produit && ((produit.tailles || []).length || (produit.couleurs || []).length));
  const s = {
    actif: dejaModele || (!produit && parDefaut),
    charge: !dejaModele,
    grilles: [],
    grille: null,
    tailles: [],
    couleurs: [],
    /** cle → { id, stockAvant, stock, prix, code_barre, retiree } */
    cases: new Map(),
    paletteOuverte: false,
    saisieTaille: ''
  };

  function assurerCases() {
    const tailles = s.tailles.length ? s.tailles : [''];
    const couleurs = s.couleurs.length ? s.couleurs.map((c) => c.nom) : [''];
    for (const c of couleurs) for (const t of tailles) {
      const k = cleCase(t, c);
      if (!s.cases.has(k)) s.cases.set(k, { id: null, stockAvant: 0, stock: 0, prix: null, code_barre: null, retiree: false });
    }
  }
  const casesVisibles = () => {
    const tailles = s.tailles.length ? s.tailles : [''];
    const couleurs = s.couleurs.length ? s.couleurs.map((c) => c.nom) : [''];
    return couleurs.flatMap((c) => tailles.map((t) => ({ t, c, k: cleCase(t, c), v: s.cases.get(cleCase(t, c)) })));
  };

  function render() {
    if (!s.charge) { zone.innerHTML = '<div class="squelette" style="height:120px"></div>'; return; }
    assurerCases();
    const visibles = casesVisibles().filter((x) => x.v && !x.v.retiree);
    const total = visibles.reduce((t, x) => t + (Number(x.v.stock) || 0), 0);
    const epuisees = visibles.filter((x) => (Number(x.v.stock) || 0) <= 0).length;
    const tailles = s.tailles.length ? s.tailles : [''];
    const couleurs = s.couleurs.length ? s.couleurs : [{ nom: '', hex: null }];
    zone.innerHTML = `
      <label class="case-option interrupteur-variantes">
        <input type="checkbox" class="bascule-doc" role="switch" data-var="actif" ${s.actif ? 'checked' : ''} ${dejaModele ? 'disabled' : ''}>
        <span><strong>Ce modèle a des tailles / couleurs</strong> <span class="discret">${dejaModele ? '(stock compté par taille et couleur)' : 'Une seule fiche, le stock est compté par taille et par couleur.'}</span></span>
      </label>
      ${s.actif ? `
      <div class="var-editeur">
        <section class="var-bloc">
          <div class="var-bloc-titre"><strong>Grille de tailles</strong><span class="discret">choisissez un modèle prêt ou créez la vôtre</span></div>
          <div class="var-pastilles">
            ${s.grilles.map((g) => (g.boutique_id
              ? `<span class="pastille-grille-perso ${s.grille === g.id ? 'actif' : ''}"><button type="button" class="pastille-grille ${s.grille === g.id ? 'actif' : ''}" data-grille="${esc(g.id)}">${esc(g.nom)} <span class="discret">· ma grille</span></button>${peut('gerer_stock') ? `<button type="button" class="grille-supprimer" data-supprimer-grille="${esc(g.id)}" aria-label="Supprimer la grille ${esc(g.nom)}">×</button>` : ''}</span>`
              : `<button type="button" class="pastille-grille ${s.grille === g.id ? 'actif' : ''}" data-grille="${esc(g.id)}">${esc(g.nom)}</button>`)).join('')}
            <button type="button" class="pastille-grille pastille-ajout" data-var="ma-grille" ${s.tailles.length ? '' : 'disabled'}>+ Ma grille</button>
          </div>
          <div class="var-pastilles var-choisies" aria-label="Tailles du modèle">
            ${s.tailles.map((t) => `<span class="pastille-valeur">${esc(t)}<button type="button" data-retirer-taille="${esc(t)}" aria-label="Retirer la taille ${esc(t)}">×</button></span>`).join('') || '<span class="discret">Aucune taille : taille unique.</span>'}
            <span class="var-ajout-taille"><label class="sr-only" for="var-taille">Ajouter une taille</label>
              <input id="var-taille" class="input" type="text" maxlength="12" placeholder="Autre taille" value="${esc(s.saisieTaille)}" data-var="saisie-taille" enterkeyhint="done">
              <button type="button" class="btn btn-secondaire btn-petit" data-var="ajouter-taille">Ajouter</button></span>
          </div>
        </section>
        <section class="var-bloc">
          <div class="var-pastilles">
            <strong class="var-titre-ligne">Couleurs</strong>
            ${s.couleurs.map((c) => `<span class="pastille-valeur var-chip-couleur">${rondCouleur(c.hex, 14)}${esc(c.nom)}
              <button type="button" class="var-photo-couleur ${c.photo_url ? 'avec-photo' : ''}" data-photo-couleur="${esc(c.nom)}" aria-label="${c.photo_url ? 'Changer' : 'Ajouter'} la photo ${esc(c.nom)}">${icone('photo', 14, 2)}</button>
              <button type="button" data-retirer-couleur="${esc(c.nom)}" aria-label="Retirer la couleur ${esc(c.nom)}">×</button></span>`).join('')}
            <button type="button" class="pastille-grille pastille-ajout" data-var="palette" aria-expanded="${s.paletteOuverte}">+ Couleur</button>
          </div>
          ${s.paletteOuverte ? `
            <div class="var-palette">
              <div class="var-palette-grille">${PALETTE_COULEURS.filter(([n]) => !s.couleurs.some((c) => c.nom === n)).map(([n, hex]) => `
                <button type="button" class="var-teinte" data-teinte="${esc(n)}" data-hex="${hex}">${rondCouleur(hex, 22)}<span>${esc(n)}</span></button>`).join('')}</div>
              <div class="var-couleur-libre"><label class="sr-only" for="var-couleur-libre">Nom de la couleur</label>
                <input id="var-couleur-libre" class="input" type="text" maxlength="30" placeholder="Autre couleur (ex. Wax jaune)" data-var="couleur-libre">
                <button type="button" class="btn btn-secondaire btn-petit" data-var="ajouter-couleur">Ajouter</button></div>
            </div>` : ''}
          <small class="aide">Photo par couleur facultative (${icone('photo', 12, 2)}) : elle s’affiche à la caisse et sur la boutique en ligne.</small>
        </section>
        <section class="var-bloc">
          <div class="var-bloc-titre"><strong>Stock par taille et couleur</strong><span class="discret">${dejaModele ? 'corrigez une case : inventaire' : 'stock de départ'} · ⋯ prix spécial, code-barres</span>
            <span class="var-badges">${epuisees ? `<span class="badge-var rouge">${epuisees} case${epuisees > 1 ? 's' : ''} épuisée${epuisees > 1 ? 's' : ''}</span>` : ''}<span class="badge-var vert">Total ${formatNombre(total)} pièce${total > 1 ? 's' : ''}</span></span></div>
          <div class="var-grille-cadre">
            <table class="var-grille">
              <thead><tr><th scope="col"><span class="sr-only">Couleur</span></th>${tailles.map((t) => `<th scope="col">${esc(t || 'Unique')}</th>`).join('')}<th scope="col" class="var-total">Total</th></tr></thead>
              <tbody>
                ${couleurs.map((c) => {
                  const ligne = tailles.map((t) => s.cases.get(cleCase(t, c.nom)));
                  const totalLigne = ligne.reduce((x, v) => x + (v && !v.retiree ? Number(v.stock) || 0 : 0), 0);
                  return `<tr><th scope="row"><span class="var-nom-couleur">${c.nom ? rondCouleur(c.hex, 18) : ''}${esc(c.nom || 'Stock')}</span></th>
                    ${tailles.map((t) => caseHTML(t, c.nom)).join('')}
                    <td class="var-total">${formatNombre(totalLigne)}</td></tr>`;
                }).join('')}
                ${couleurs.length > 1 || tailles.length > 1 ? `<tr class="var-ligne-total"><th scope="row">Total</th>${tailles.map((t) => `<td>${formatNombre(couleurs.reduce((x, c) => { const v = s.cases.get(cleCase(t, c.nom)); return x + (v && !v.retiree ? Number(v.stock) || 0 : 0); }, 0))}</td>`).join('')}<td class="var-total">${formatNombre(total)}</td></tr>` : ''}
              </tbody>
            </table>
          </div>
          <div class="var-legende"><span><i class="zero"></i> épuisé</span><span><i class="un"></i> dernière pièce</span><span>Un seul prix pour toutes les tailles ; prix différent pour une taille : ⋯ puis « Prix spécial ».</span></div>
        </section>
      </div>` : ''}`;
  }

  function caseHTML(t, c) {
    const v = s.cases.get(cleCase(t, c));
    const libelle = libelleVariante(t, c) || 'Stock';
    if (!v || v.retiree) {
      return `<td><button type="button" class="var-case var-case-retiree" data-menu-case="${esc(cleCase(t, c))}" aria-label="${esc(libelle)} : case retirée (rétablir)">—</button></td>`;
    }
    const n = Number(v.stock) || 0;
    return `<td><div class="var-case ${classeQuantite(n)}">
      <label class="sr-only" for="vc-${esc(cleCase(t, c))}">${esc(libelle)}</label>
      <input id="vc-${esc(cleCase(t, c))}" type="text" inputmode="numeric" autocomplete="off" value="${n}" data-case="${esc(cleCase(t, c))}">
      <button type="button" class="var-case-menu" data-menu-case="${esc(cleCase(t, c))}" aria-label="Options de ${esc(libelle)}">⋯</button>
      ${v.prix !== null ? `<span class="var-case-prix">${formatNombre(v.prix)}</span>` : ''}
    </div></td>`;
  }

  function ajouterTaille(texte) {
    const t = String(texte || '').trim().slice(0, 12);
    if (!t || s.tailles.includes(t)) return;
    s.tailles.push(t);
    s.grille = null;
    s.saisieTaille = '';
    render(); onChange();
  }
  function ajouterCouleur(nom, hex = null) {
    const n = String(nom || '').trim().slice(0, 30);
    if (!n || s.couleurs.some((c) => c.nom.toLowerCase() === n.toLowerCase())) return;
    s.couleurs.push(couleursDe([{ nom: n, hex }])[0]);
    s.paletteOuverte = false;
    render(); onChange();
  }

  /** Prix spécial, code-barres, retirer / rétablir une case. */
  function ouvrirMenuCase(k) {
    const [t, c] = k.split(SEP);
    const v = s.cases.get(k);
    const libelle = libelleVariante(t, c) || 'Case';
    const { el, fermer } = ouvrirModale({
      titre: libelle,
      contenu: `
        <form class="form-modale" novalidate>
          ${v && !v.retiree ? `
            <div class="champ"><label for="mc-prix">Prix spécial (GNF)</label>
              <input id="mc-prix" class="input" type="text" inputmode="numeric" value="${v.prix !== null ? esc(formatNombre(v.prix)) : ''}" placeholder="Vide : prix du modèle">
              <small class="aide">Ex. XXL plus cher. Vide : le prix du modèle s’applique.</small></div>
            <div class="champ"><label for="mc-code">Code-barres (facultatif)</label>
              <input id="mc-code" class="input" type="text" inputmode="numeric" maxlength="64" value="${esc(v.code_barre || '')}" placeholder="Généré à l’impression des étiquettes"></div>
            <button type="button" class="btn-lien btn-lien-danger btn-lien-gauche" data-mc="retirer">Retirer cette case (cette combinaison n’existe pas)</button>`
          : '<p class="texte-modale">Cette combinaison est retirée du modèle.</p>'}
          <div class="modale-actions">
            <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
            ${v && !v.retiree ? '<button type="submit" class="btn btn-primaire">Valider</button>' : '<button type="button" class="btn btn-primaire" data-mc="retablir">Rétablir la case</button>'}
          </div>
        </form>`
    });
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-mc]')?.dataset.mc;
      if (a === 'retirer') {
        if (v.id && Number(v.stockAvant) > 0) { toast(messageErreur(`VARIANTE_AVEC_STOCK: ${libelle} (${v.stockAvant} en stock)`), 'erreur', 7000); return; }
        v.retiree = true; fermer(); render(); onChange();
      }
      if (a === 'retablir') {
        if (v) v.retiree = false; else s.cases.set(k, { id: null, stockAvant: 0, stock: 0, prix: null, code_barre: null, retiree: false });
        fermer(); render(); onChange();
      }
    });
    el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const prix = lireNombre(el.querySelector('#mc-prix').value);
      if (prix !== null && prix <= 0) { toast('Le prix spécial doit être supérieur à 0 (ou vide).', 'erreur'); return; }
      v.prix = prix === null ? null : Math.round(prix);
      v.code_barre = el.querySelector('#mc-code').value.trim() || null;
      fermer(); render(); onChange();
    });
  }

  /** « + Ma grille » : enregistre les tailles choisies sous un nom (grilles de la boutique). */
  function ouvrirMaGrille() {
    const { el, fermer } = ouvrirModale({
      titre: 'Enregistrer ma grille',
      contenu: `<form class="form-modale" novalidate>
        <p class="texte-modale">Tailles : <strong>${esc(s.tailles.join(' · '))}</strong></p>
        <div class="champ"><label for="mg-nom">Nom de la grille</label><input id="mg-nom" class="input" type="text" maxlength="40" placeholder="Ex. Robes femme" required></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`
    });
    const form = el.querySelector('form');
    form.querySelector('#mg-nom').focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nom = form.querySelector('#mg-nom').value.trim();
      const zoneErreur = form.querySelector('.erreur-form');
      if (!nom) { zoneErreur.textContent = 'Donnez un nom à la grille.'; zoneErreur.hidden = false; return; }
      const bouton = form.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      const { error } = await sb.rpc('enregistrer_grille', { p_boutique: etat.boutique.id, p_nom: nom, p_tailles: s.tailles });
      if (error) { boutonOccupe(bouton, false); zoneErreur.textContent = messageErreur(error); zoneErreur.hidden = false; return; }
      fermer();
      toast(`Grille « ${nom} » enregistrée.`, 'succes');
      s.grilles = await chargerGrilles();
      s.grille = s.grilles.find((g) => g.boutique_id && g.nom === nom)?.id || null;
      render();
    });
  }

  function photoCouleur(nom) {
    const couleur = s.couleurs.find((c) => c.nom === nom);
    if (!couleur) return;
    ouvrirOutilImage({
      usage: 'article',
      source: couleur.photo_url || null,
      titre: `Photo ${nom}`,
      contexte: { nom: `${produit?.nom || 'Modèle'} — ${nom}` },
      enregistrer: async (sorties) => {
        const prefixe = `couleur-${String(nom).normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase()}`;
        couleur.photo_url = await envoyerLogoAnnexe(prefixe, { grande: sorties.grande });
        toast(`Photo ${nom} prête : enregistrez le modèle.`, 'succes');
        render(); onChange();
      }
    });
  }

  zone.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-var]')?.dataset.var;
    if (v === 'ajouter-taille') ajouterTaille(zone.querySelector('#var-taille').value);
    if (v === 'palette') { s.paletteOuverte = !s.paletteOuverte; render(); }
    if (v === 'ajouter-couleur') ajouterCouleur(zone.querySelector('#var-couleur-libre').value);
    if (v === 'ma-grille') ouvrirMaGrille();
    const supprimer = e.target.closest('[data-supprimer-grille]');
    if (supprimer) {
      const g = s.grilles.find((x) => x.id === supprimer.dataset.supprimerGrille);
      if (!g?.boutique_id) return;
      if (!(await confirmer(`La grille « ${g.nom} » sera supprimée. Les modèles qui l’utilisent gardent leurs tailles.`, { titre: 'Supprimer la grille', libelleOk: 'Supprimer', danger: true }))) return;
      const { error } = await sb.rpc('supprimer_grille', { p_grille: g.id });
      if (error) { toast(messageErreur(error), 'erreur'); return; }
      toast(`Grille « ${g.nom} » supprimée.`, 'succes');
      if (s.grille === g.id) s.grille = null;
      s.grilles = await chargerGrilles();
      render();
      return;
    }
    const grille = e.target.closest('[data-grille]');
    if (grille) {
      const g = s.grilles.find((x) => x.id === grille.dataset.grille);
      if (!g) return;
      const tailles = (g.tailles || []).filter((t) => t !== null && t !== undefined).map(String);
      s.tailles = tailles.length === 1 && /unique/i.test(tailles[0]) ? [] : tailles;
      s.grille = g.id;
      render(); onChange();
    }
    const rt = e.target.closest('[data-retirer-taille]');
    if (rt) {
      const t = rt.dataset.retirerTaille;
      const avecStock = s.couleurs.length ? s.couleurs.some((c) => Number(s.cases.get(cleCase(t, c.nom))?.stockAvant) > 0) : Number(s.cases.get(cleCase(t, ''))?.stockAvant) > 0;
      if (avecStock) { toast(`Impossible de retirer la taille ${t} : il reste du stock. Videz d’abord ses cases.`, 'erreur', 7000); return; }
      s.tailles = s.tailles.filter((x) => x !== t); s.grille = null; render(); onChange();
    }
    const rc = e.target.closest('[data-retirer-couleur]');
    if (rc) {
      const c = rc.dataset.retirerCouleur;
      const tailles = s.tailles.length ? s.tailles : [''];
      if (tailles.some((t) => Number(s.cases.get(cleCase(t, c))?.stockAvant) > 0)) { toast(`Impossible de retirer la couleur ${c} : il reste du stock. Videz d’abord ses cases.`, 'erreur', 7000); return; }
      s.couleurs = s.couleurs.filter((x) => x.nom !== c); render(); onChange();
    }
    const teinte = e.target.closest('[data-teinte]');
    if (teinte) ajouterCouleur(teinte.dataset.teinte, teinte.dataset.hex);
    const pc = e.target.closest('[data-photo-couleur]');
    if (pc) photoCouleur(pc.dataset.photoCouleur);
    const mc = e.target.closest('[data-menu-case]');
    if (mc) ouvrirMenuCase(mc.dataset.menuCase);
  });
  zone.addEventListener('change', async (e) => {
    if (e.target.dataset.var === 'actif') {
      if (e.target.checked && produit && Number(produit.stock) > 0
        && !(await confirmer(`L’ancien stock (${formatNombre(produit.stock, 3)}) va être remplacé par les quantités de la grille.`, { titre: 'Passer en tailles / couleurs', libelleOk: 'Continuer' }))) {
        e.target.checked = false;
        return;
      }
      s.actif = e.target.checked;
      if (s.actif && !s.grilles.length) s.grilles = await chargerGrilles();
      render(); onChange();
    }
    if (e.target.dataset.case) {
      const v = s.cases.get(e.target.dataset.case);
      const n = lireNombre(e.target.value);
      v.stock = n === null || n < 0 ? 0 : Math.round(n);
      render(); onChange();
      zone.querySelector(`[data-case="${CSS.escape(e.target.dataset.case)}"]`)?.closest('td')?.nextElementSibling?.querySelector('input')?.focus();
    }
  });
  zone.addEventListener('keydown', (e) => {
    if (e.target.id === 'var-taille' && e.key === 'Enter') { e.preventDefault(); ajouterTaille(e.target.value); zone.querySelector('#var-taille')?.focus(); }
    if (e.target.id === 'var-couleur-libre' && e.key === 'Enter') { e.preventDefault(); ajouterCouleur(e.target.value); }
  });
  zone.addEventListener('input', (e) => { if (e.target.id === 'var-taille') s.saisieTaille = e.target.value; });
  // Appui long sur une case : même menu que « ⋯ ».
  zone.addEventListener('contextmenu', (e) => {
    const input = e.target.closest('[data-case]');
    if (!input) return;
    e.preventDefault();
    ouvrirMenuCase(input.dataset.case);
  });

  (async () => {
    if (s.actif) s.grilles = await chargerGrilles();
    if (dejaModele) {
      try {
        const d = await chargerVariantes(produit.id, { recharger: true });
        s.tailles = d.tailles.filter((t) => t !== '');
        s.couleurs = d.couleurs;
        d.cases.forEach((c) => s.cases.set(cleCase(c.taille, c.couleur), { id: c.id, stockAvant: c.stock, stock: c.stock, prix: c.prix, code_barre: c.code_barre, retiree: false }));
        // Combinaisons absentes du modèle : affichées comme retirées.
        assurerCases();
        casesVisibles().forEach((x) => { if (!x.v.id) x.v.retiree = true; });
      } catch (err) {
        zone.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`;
        return;
      }
    } else if (!produit && parDefaut) {
      // Nouvelle fiche d'habillement : grille Vêtements proposée d'office.
      const g = s.grilles.find((x) => !x.boutique_id && /v[êe]tements/i.test(x.nom)) || s.grilles[0];
      if (g) { s.tailles = (g.tailles || []).map(String); s.grille = g.id; }
    }
    s.charge = true;
    render(); onChange();
  })();
  render();

  return {
    actif: () => s.actif,
    /** Somme des cases (pour l'affichage du champ stock en lecture seule). */
    total: () => casesVisibles().filter((x) => x.v && !x.v.retiree).reduce((t, x) => t + (Number(x.v.stock) || 0), 0),
    /** Vérification complète avant de créer ou modifier l'article : rien n'est envoyé si la grille est invalide. */
    valider() {
      if (!s.actif) return null;
      if (!s.charge) return 'La grille est encore en chargement.';
      if (!s.tailles.length && !s.couleurs.length) return 'Ajoutez au moins une taille ou une couleur (ou désactivez « tailles / couleurs »).';
      const doublon = (liste) => liste.find((x, i) => liste.findIndex((y) => y.toLowerCase() === x.toLowerCase()) !== i);
      if (s.tailles.some((t) => !String(t).trim())) return 'Une taille est vide.';
      if (s.couleurs.some((c) => !String(c.nom).trim())) return 'Une couleur n’a pas de nom.';
      const tailleEnDouble = doublon(s.tailles.map(String));
      if (tailleEnDouble) return `La taille « ${tailleEnDouble} » est en double.`;
      const couleurEnDouble = doublon(s.couleurs.map((c) => c.nom));
      if (couleurEnDouble) return `La couleur « ${couleurEnDouble} » est en double.`;
      if (s.tailles.length > MAX_TAILLES) return `${MAX_TAILLES} tailles au maximum.`;
      if (s.couleurs.length > MAX_COULEURS) return `${MAX_COULEURS} couleurs au maximum.`;
      const actives = casesVisibles().filter((x) => x.v && !x.v.retiree);
      if (!actives.length) return 'Gardez au moins une case dans la grille.';
      if (actives.length > MAX_CASES) return `${MAX_CASES} cases au maximum : réduisez le nombre de tailles ou de couleurs.`;
      const negative = actives.find((x) => !(Number.isInteger(Number(x.v.stock)) && Number(x.v.stock) >= 0));
      if (negative) return `Quantité invalide pour ${libelleVariante(negative.t, negative.c) || 'une case'} (nombre entier, 0 ou plus).`;
      return null;
    },
    /** enregistrer_variantes puis, pour les cases existantes modifiées, mouvement_variantes(ajustement). */
    async enregistrer(idProduit) {
      if (!s.actif) return null;
      const actives = casesVisibles().filter((x) => x.v && !x.v.retiree);
      const p_cases = actives.map((x) => ({ taille: x.t, couleur: x.c, prix: x.v.prix, code_barre: x.v.code_barre, stock_initial: x.v.id ? 0 : Number(x.v.stock) || 0 }));
      const { data, error } = await sb.rpc('enregistrer_variantes', {
        p_boutique: etat.boutique.id, p_produit: idProduit, p_tailles: s.tailles,
        p_couleurs: s.couleurs.map((c) => ({ nom: c.nom, hex: c.hex, photo_url: c.photo_url || null })), p_cases
      });
      if (error) throw error;
      let d = memoriserVariantes(data);
      // Les cases sont maintenant enregistrées : si la suite échoue, un nouvel essai corrige au lieu de recréer.
      d.cases.forEach((c) => {
        const v = s.cases.get(cleCase(c.taille, c.couleur));
        if (v && !v.id) Object.assign(v, { id: c.id, stockAvant: c.stock });
      });
      const corrections = actives.filter((x) => x.v.id && Number(x.v.stock) !== Number(x.v.stockAvant))
        .map((x) => ({ variante_id: x.v.id, quantite: Number(x.v.stock) || 0 }));
      if (corrections.length) {
        const r = await sb.rpc('mouvement_variantes', { p_boutique: etat.boutique.id, p_produit: idProduit, p_type: 'ajustement', p_lignes: corrections, p_note: 'Correction depuis la fiche' });
        if (r.error) throw r.error;
        d = await chargerVariantes(idProduit, { recharger: true });
      }
      return d;
    }
  };
}

/* =========================================================================
   Fiche (lecture) : grille de stock et boutons Arrivage / Inventaire / Étiquettes
   ========================================================================= */

/** Tableau de stock en lecture (fiche du modèle). */
export function grilleLectureHTML(d) {
  const tailles = d.tailles.length ? d.tailles : [''];
  const couleurs = d.couleurs.length ? d.couleurs : [{ nom: '', hex: null }];
  const caseDe = (t, c) => d.cases.find((x) => x.taille === t && x.couleur === c);
  const epuisees = d.cases.filter((c) => c.stock <= 0).length;
  const total = d.cases.reduce((t, c) => t + c.stock, 0);
  return `
    <div class="var-bloc-titre"><strong>Stock par taille et couleur</strong>
      <span class="var-badges">${epuisees ? `<span class="badge-var rouge">${epuisees} case${epuisees > 1 ? 's' : ''} épuisée${epuisees > 1 ? 's' : ''}</span>` : ''}<span class="badge-var vert">Total ${formatNombre(total)} pièce${total > 1 ? 's' : ''}</span></span></div>
    <div class="var-grille-cadre">
      <table class="var-grille var-grille-lecture">
        <thead><tr><th scope="col"><span class="sr-only">Couleur</span></th>${tailles.map((t) => `<th scope="col">${esc(t || 'Unique')}</th>`).join('')}<th scope="col" class="var-total">Total</th></tr></thead>
        <tbody>${couleurs.map((c) => `<tr><th scope="row"><span class="var-nom-couleur">${c.nom ? rondCouleur(c.hex, 18) : ''}${esc(c.nom || 'Stock')}</span></th>
          ${tailles.map((t) => { const x = caseDe(t, c.nom); return x ? `<td><span class="var-case ${classeQuantite(x.stock)}" title="${esc(x.libelle)}${x.prix !== null ? ` · ${formatNombre(x.prix)} GNF` : ''}">${formatNombre(x.stock)}${x.prix !== null ? '<small>★</small>' : ''}</span></td>` : '<td><span class="var-case var-case-retiree">—</span></td>'; }).join('')}
          <td class="var-total">${formatNombre(tailles.reduce((s, t) => s + (caseDe(t, c.nom)?.stock || 0), 0))}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
}

/** Arrivage (entrée : quantités reçues) ou inventaire (ajustement : quantités comptées) sur toute la grille. */
export async function ouvrirGrilleMouvement(produit, type, apres = () => {}) {
  let d;
  try { d = await chargerVariantes(produit.id, { recharger: true }); } catch (err) { toast(messageErreur(err), 'erreur'); return; }
  const entree = type === 'entree';
  const tailles = d.tailles.length ? d.tailles : [''];
  const couleurs = d.couleurs.length ? d.couleurs : [{ nom: '', hex: null }];
  const caseDe = (t, c) => d.cases.find((x) => x.taille === t && x.couleur === c);
  const { el, fermer } = ouvrirModale({
    titre: entree ? `Arrivage · ${produit.nom}` : `Inventaire · ${produit.nom}`,
    variante: 'large',
    contenu: `
      <form class="form-modale" novalidate>
        <p class="texte-modale">${entree ? 'Saisissez les quantités <strong>reçues</strong> par case : elles s’ajoutent au stock.' : 'Saisissez les quantités <strong>comptées</strong> : chaque case est corrigée à cette valeur.'}</p>
        <div class="var-grille-cadre">
          <table class="var-grille">
            <thead><tr><th scope="col"><span class="sr-only">Couleur</span></th>${tailles.map((t) => `<th scope="col">${esc(t || 'Unique')}</th>`).join('')}</tr></thead>
            <tbody>${couleurs.map((c) => `<tr><th scope="row"><span class="var-nom-couleur">${c.nom ? rondCouleur(c.hex, 18) : ''}${esc(c.nom || 'Stock')}</span></th>
              ${tailles.map((t) => { const x = caseDe(t, c.nom); return x ? `<td><div class="var-case ${entree ? '' : classeQuantite(x.stock)}">
                <label class="sr-only" for="mv-${esc(x.id)}">${esc(x.libelle)}${entree ? '' : ` (stock ${x.stock})`}</label>
                <input id="mv-${esc(x.id)}" type="text" inputmode="numeric" autocomplete="off" data-mv="${esc(x.id)}" value="${entree ? '' : x.stock}" placeholder="${entree ? '0' : ''}">
                ${entree ? `<span class="var-case-prix">en stock ${x.stock}</span>` : ''}</div></td>` : '<td><span class="var-case var-case-retiree">—</span></td>'; }).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="champ"><label for="mv-note">${entree ? 'Fournisseur / note' : 'Note'} (facultatif)</label>
          <input id="mv-note" class="input" type="text" maxlength="200" placeholder="${entree ? 'Ex. Arrivage Dubaï, colis n° 12' : 'Ex. Inventaire de fin de mois'}"></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
          <button type="submit" class="btn btn-primaire">${entree ? 'Ajouter au stock' : 'Corriger le stock'}</button>
        </div>
      </form>`
  });
  const form = el.querySelector('form');
  const zoneErreur = form.querySelector('.erreur-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const lignes = [];
    for (const input of form.querySelectorAll('[data-mv]')) {
      const n = lireNombre(input.value);
      const x = d.cases.find((c) => c.id === input.dataset.mv);
      if (n === null) continue;
      if (n < 0 || !Number.isInteger(n)) { zoneErreur.textContent = `Quantité entière attendue (${x.libelle || 'case'}).`; zoneErreur.hidden = false; return; }
      if (entree ? n > 0 : n !== x.stock) lignes.push({ variante_id: x.id, quantite: n });
    }
    if (!lignes.length) { zoneErreur.textContent = entree ? 'Indiquez au moins une quantité reçue.' : 'Aucune case modifiée.'; zoneErreur.hidden = false; return; }
    zoneErreur.hidden = true;
    const bouton = form.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Enregistrement…');
    const { error } = await sb.rpc('mouvement_variantes', { p_boutique: etat.boutique.id, p_produit: produit.id, p_type: type, p_lignes: lignes, p_note: form.querySelector('#mv-note').value.trim() || null });
    if (error) { boutonOccupe(bouton, false); zoneErreur.textContent = messageErreur(error); zoneErreur.hidden = false; return; }
    oublierVariantes(produit.id);
    const recu = lignes.reduce((t, l) => t + l.quantite, 0);
    fermer();
    toast(entree ? `Arrivage enregistré : ${formatNombre(recu)} pièce${recu > 1 ? 's' : ''} ajoutée${recu > 1 ? 's' : ''}.` : `Inventaire enregistré : ${lignes.length} case${lignes.length > 1 ? 's' : ''} corrigée${lignes.length > 1 ? 's' : ''}.`, 'succes');
    apres();
  });
}

/* =========================================================================
   Étiquettes A4 (Code 128)
   ========================================================================= */

// Chargement de JsBarcode : js/codes-barres.js (partagé avec les étiquettes des colis).

/** Préchargement (fiche d'un modèle ouverte) : les étiquettes restent imprimables si la connexion tombe ensuite. */
export function prechargerEtiquettes() {
  chargerJsBarcode().catch(() => { /* chargé à l'impression */ });
}

/** Génère les codes manquants, choisit le nombre d'étiquettes par case (= stock), puis imprime une planche A4. */
export async function imprimerEtiquettes(produit) {
  let d;
  let horsLigne = false;
  try {
    const r = await sb.rpc('generer_codes_variantes', { p_boutique: etat.boutique.id, p_produit: produit.id });
    if (r.error) throw r.error;
    oublierVariantes(produit.id);
    d = await chargerVariantes(produit.id, { recharger: true });
  } catch (err) {
    // Hors connexion : grille déjà lue (fiche ouverte) → étiquettes avec les codes déjà attribués.
    try { d = await chargerVariantes(produit.id); horsLigne = true; } catch { toast(messageErreur(err), 'erreur'); return; }
  }
  const { el, fermer } = ouvrirModale({
    titre: `Étiquettes · ${produit.nom}`,
    contenu: `
      <form class="form-modale" novalidate>
        <p class="texte-modale">Nombre d’étiquettes par case (par défaut : le stock). Planche A4 de 24 étiquettes (3 × 8).</p>
        ${horsLigne ? `<p class="note-alerte">${icone('alerte', 16, 2)} Hors connexion : seuls les codes déjà attribués sont imprimés${d.cases.some((c) => !c.code_barre) ? ' (les cases sans code n’auront pas de code-barres)' : ''}.</p>` : ''}
        <ul class="liste-etiquettes">${d.cases.map((c) => `
          <li><span class="ae-textes"><span class="gras">${esc(c.libelle || produit.nom)}</span><span class="discret">${esc(c.code_barre || '—')} · ${formatNombre(c.prix ?? d.prix ?? produit.prix_detail)} GNF</span></span>
            <label class="sr-only" for="et-${esc(c.id)}">Nombre d’étiquettes ${esc(c.libelle)}</label>
            <input id="et-${esc(c.id)}" class="input input-quantite" type="text" inputmode="numeric" data-etiq="${esc(c.id)}" value="${Math.max(0, c.stock)}"></li>`).join('')}</ul>
        <p class="aide" data-ref="nb-etiquettes"></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">${icone('imprimante', 18, 2)} Imprimer</button></div>
      </form>`
  });
  const form = el.querySelector('form');
  const compter = () => [...form.querySelectorAll('[data-etiq]')].reduce((t, i) => t + Math.max(0, Math.round(lireNombre(i.value) || 0)), 0);
  const majNb = () => { const n = compter(); form.querySelector('[data-ref="nb-etiquettes"]').textContent = `${n} étiquette${n > 1 ? 's' : ''} · ${Math.max(1, Math.ceil(n / 24))} page${n > 24 ? 's' : ''}`; };
  form.addEventListener('input', majNb);
  majNb();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const bouton = form.querySelector('[type=submit]');
    const liste = [];
    form.querySelectorAll('[data-etiq]').forEach((i) => {
      const c = d.cases.find((x) => x.id === i.dataset.etiq);
      const n = Math.min(500, Math.max(0, Math.round(lireNombre(i.value) || 0)));
      for (let k = 0; k < n; k++) liste.push(c);
    });
    if (!liste.length) { toast('Indiquez au moins une étiquette.', 'erreur'); return; }
    boutonOccupe(bouton, true, 'Préparation…');
    try {
      const JsBarcode = await chargerJsBarcode();
      const nomCourt = produit.nom.length > 26 ? `${produit.nom.slice(0, 25)}…` : produit.nom;
      const zone = document.createElement('div');
      zone.id = 'zone-etiquettes';
      zone.innerHTML = `<div class="planche-etiquettes">${liste.map((c, i) => `
        <div class="etiquette-variante"><span class="etq-nom">${esc(nomCourt)}</span><span class="etq-libelle">${esc(c.libelle)}</span>
          <span class="etq-prix">${formatGNF(c.prix ?? d.prix ?? produit.prix_detail)}</span><svg class="etq-code" data-i="${i}"></svg></div>`).join('')}</div>`;
      document.body.appendChild(zone);
      zone.querySelectorAll('svg.etq-code').forEach((svg) => {
        const c = liste[Number(svg.dataset.i)];
        if (c.code_barre) JsBarcode(svg, c.code_barre, { format: 'CODE128', height: 34, width: 1.4, fontSize: 11, margin: 0, textMargin: 1 });
      });
      document.body.classList.add('impression-etiquettes');
      const nettoyer = () => { document.body.classList.remove('impression-etiquettes'); zone.remove(); window.removeEventListener('afterprint', nettoyer); };
      window.addEventListener('afterprint', nettoyer);
      fermer();
      window.print();
      setTimeout(() => { if (zone.isConnected && !matchMedia('print').matches) nettoyer(); }, 60000);
    } catch (err) {
      boutonOccupe(bouton, false);
      toast(String(err?.message || '').includes('codes-barres') ? err.message : messageErreur(err), 'erreur');
    }
  });
}

/* =========================================================================
   Liste à réassortir (#/stock/reassort)
   ========================================================================= */

export function afficherReassort(conteneur) {
  const boutique = etat.boutique;
  const s = { liste: [], choix: new Map(), charge: false };
  conteneur.innerHTML = `
    <div class="page page-reassort">
      <header class="page-entete"><div class="page-titres">
        <a class="lien-retour" href="#/stock">← Stock</a>
        <h1>Tailles à réassortir</h1><span data-zone="resume">Chargement…</span></div></header>
      <section class="carte"><ul class="liste-reassort" data-zone="liste">${'<li class="squelette-ligne"><span class="squelette" style="height:14px;width:50%"></span></li>'.repeat(5)}</ul></section>
      <div class="actions-reassort" data-zone="actions"></div>
    </div>`;
  const zone = (n) => conteneur.querySelector(`[data-zone="${n}"]`);
  const nomLigne = (l) => nomAvecVariante(l.nom, l.libelle);
  const choisies = () => s.liste.filter((l) => s.choix.get(l.variante_id)?.coche);
  const texteListe = () => `Réassort ${boutique.nom} :\n${choisies().map((l) => `- ${nomLigne(l)} × ${s.choix.get(l.variante_id).quantite}`).join('\n')}`;

  function render() {
    if (!s.liste.length) {
      zone('liste').innerHTML = '<li class="etat-vide"><p>Aucune taille épuisée ni dernière pièce. Bravo !</p></li>';
      zone('actions').innerHTML = '';
      return;
    }
    zone('liste').innerHTML = s.liste.map((l) => {
      const c = s.choix.get(l.variante_id);
      return `<li class="ligne-reassort ${c.coche ? 'choisi' : ''}">
        <label class="ligne-bon-choix"><input type="checkbox" data-cocher="${esc(l.variante_id)}" ${c.coche ? 'checked' : ''}>
          <span class="ae-textes"><span class="gras">${esc(nomLigne(l))}</span>
            <span class="discret"><span class="${l.stock <= 0 ? 'texte-danger' : 'texte-alerte'}">${l.stock <= 0 ? 'épuisé' : `reste ${formatNombre(l.stock)}`}</span> · ${formatNombre(l.vendus_60j || 0)} vendu${(l.vendus_60j || 0) > 1 ? 's' : ''} en 60 jours</span></span></label>
        <label class="sr-only" for="ra-${esc(l.variante_id)}">Quantité à commander</label>
        <input id="ra-${esc(l.variante_id)}" class="input input-quantite" type="text" inputmode="numeric" data-quantite="${esc(l.variante_id)}" value="${c.quantite}">
      </li>`;
    }).join('');
    const n = choisies().length;
    zone('actions').innerHTML = `
      ${aModule('fournisseurs') ? `<button type="button" class="btn btn-primaire" data-action="commande" ${n ? '' : 'disabled'}>${icone('camion', 18, 2)} Préparer la commande fournisseur (${n})</button>` : ''}
      <button type="button" class="btn btn-secondaire" data-action="copier" ${n ? '' : 'disabled'}>${icone('copier', 18, 2)} Copier la liste</button>
      <a class="btn btn-whatsapp ${n ? '' : 'desactive'}" href="https://wa.me/?text=${encodeURIComponent(texteListe())}" target="_blank" rel="noopener" ${n ? '' : 'aria-disabled="true" tabindex="-1"'}>${icone('whatsapp', 18, 2)} Envoyer sur WhatsApp</a>`;
  }

  async function commandeFournisseur() {
    const { data: fournisseurs } = await sb.from('fournisseurs').select('id, nom, telephone, actif').eq('boutique_id', boutique.id).eq('actif', true).order('nom');
    if (!fournisseurs?.length) { toast('Ajoutez d’abord un fournisseur (Messages › Fournisseurs).', 'info'); return; }
    const { el } = ouvrirModale({
      titre: 'Commande fournisseur',
      contenu: `<p class="texte-modale">${choisies().length} ligne(s) à commander. Choisissez le fournisseur :</p>
        <div class="liste-clients">${fournisseurs.map((f) => `<button type="button" class="item-client" data-f="${esc(f.id)}"><span class="avatar">${icone('camion', 18, 2)}</span><span class="client-textes"><span class="gras">${esc(f.nom)}</span></span></button>`).join('')}</div>`
    });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      const f = fournisseurs.find((x) => x.id === b.dataset.f);
      boutonOccupe(b, true, 'Création…');
      const { data, error } = await sb.rpc('creer_commande_fournisseur', {
        p_boutique: boutique.id, p_fournisseur: f.id,
        p_lignes: choisies().map((l) => ({ produit_id: l.produit_id, nom: nomLigne(l), quantite: s.choix.get(l.variante_id).quantite, unite: l.unite || 'pièce' })),
        p_note: 'Réassort tailles & couleurs', p_envoyer_sms: false
      });
      if (error) { boutonOccupe(b, false); toast(messageErreur(error), 'erreur'); return; }
      const r = (Array.isArray(data) ? data[0] : data) || {};
      const tel = normaliserTelephone(r.telephone || f.telephone || '');
      el.querySelector('.modale-corps').innerHTML = `
        <div class="confirmation"><span class="confirmation-icone">${icone('valide', 32, 2.6)}</span><p class="confirmation-numero">Bon ${esc(r.numero || '')} · ${esc(f.nom)}</p></div>
        <pre class="texte-bon">${esc(r.texte || '')}</pre>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire" data-copier>${icone('copier', 18, 2)} Copier</button>
          <a class="btn btn-whatsapp" href="https://wa.me/${esc(tel || '')}?text=${encodeURIComponent(r.texte || '')}" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} Envoyer par WhatsApp</a>
          <button type="button" class="btn btn-primaire" data-fermer>Terminé</button></div>`;
      el.querySelector('[data-copier]').addEventListener('click', async () => toast(await copierTexte(r.texte || '') ? 'Texte copié.' : 'Copie impossible.', 'info'));
      toast(`Bon ${r.numero || ''} créé.`, 'succes');
    });
  }

  conteneur.addEventListener('change', (e) => {
    const id = e.target.dataset.cocher || e.target.dataset.quantite;
    if (!id) return;
    const c = s.choix.get(id);
    if (e.target.dataset.cocher) c.coche = e.target.checked;
    if (e.target.dataset.quantite) { const q = lireNombre(e.target.value); c.quantite = q > 0 ? Math.round(q) : c.quantite; c.coche = true; }
    render();
  });
  conteneur.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-action]')?.dataset.action;
    if (a === 'copier') toast(await copierTexte(texteListe()) ? 'Liste copiée.' : 'Copie impossible.', 'info');
    if (a === 'commande') commandeFournisseur();
  });

  (async () => {
    const { data, error } = await sb.rpc('variantes_a_reassortir', { p_boutique: boutique.id });
    if (!conteneur.isConnected) return;
    if (error) { zone('liste').innerHTML = `<li class="bloc-erreur">${esc(messageErreur(error))}</li>`; zone('resume').textContent = ''; return; }
    const r = (Array.isArray(data) ? data[0] : data) || {};
    // Déjà triée par la base (stock, puis ventes des 60 jours) ; nombres possibles en « 1.00 ».
    s.liste = (r.liste || []).map((l) => ({ ...l, stock: Number(l.stock) || 0, vendus_60j: Number(l.vendus_60j) || 0 }));
    s.liste.forEach((l) => s.choix.set(l.variante_id, { coche: true, quantite: Math.max(1, l.vendus_60j) }));
    zone('resume').textContent = `${formatNombre(Number(r.epuisees) || 0)} épuisée(s) · ${formatNombre(Number(r.dernieres) || 0)} dernière(s) pièce(s)`;
    render();
  })();
}
