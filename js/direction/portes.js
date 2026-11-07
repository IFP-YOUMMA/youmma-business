/**
 * direction/portes.js — Les écrans derrière les portes (étape 20), en réutilisant ceux qui existent.
 * Étape 26 : les deux portes ne sont plus dans la navigation (#/boutiques est direction/boutiques.js) ; ce fichier
 * garde ce qui sert encore — entrer dans une boutique, la fiche, la création, les accès — et sera retiré plus tard.
 * Ce qui suit décrit l'étape 20 :
 *  - #/boutiques (porte des licences) : la liste de la console (console_boutiques), la fiche, la création. C'est ici,
 *    et nulle part ailleurs, qu'on entre dans une boutique pour y travailler (« Ouvrir la boutique ») ;
 *  - #/marche-monde (porte de la commission) : onglets Colis · Envois · Agences · Marché (sauf marché en veille) (pages de la boutique
 *    logistique, dont le bureau du marché, étape 21) et Vendeurs (console_boutiques de l'espace) ;
 *  - #/fiche/<id>, #/terrain, #/acces, #/chercher : écrans de la console, dans la coquille de direction.
 * Une porte absente des réponses du serveur n'a pas d'écran : on revient à #/.
 */
import { sb } from '../supabase.js';
import { etat, choisirBoutique, entrerDansBoutique, sortirDeBoutique } from '../state.js';
import { demanderEntree } from '../depannage.js';
import { naviguer } from '../router.js';
import { chargerEtatLicence } from '../plateforme.js';
import { chargerModules } from '../modules.js';
import { esc, icone, toast } from '../utils.js';
import { afficherEspace } from '../admin/console/espace.js';
import { afficherFiche } from '../admin/console/fiche.js';
import { afficherTerrain } from '../admin/console/terrain.js';
import { afficherAcces } from '../admin/console/acces.js';
import { afficherColisTableau } from '../colis/tableau.js';
import { afficherEnvois } from '../colis/envois.js';
import { afficherAgences } from '../colis/reglages.js';
import { afficherMarche } from '../marche/bureau.js';
import { assurerConsole, porte, porteDeRoute, routePorte, portes, moi, marcheEnVeille } from './commun.js';
import { majLiens } from './shell.js';

const attente = (conteneur) => { conteneur.innerHTML = '<div class="dir-page"><span class="squelette" style="height:320px"></span></div>'; };
const erreur = (conteneur, err) => { if (conteneur.isConnected) conteneur.innerHTML = `<div class="dir-page"><p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(err?.message || String(err))}</p></div>`; };

async function rpc(nom, params) {
  const { data, error } = await sb.rpc(nom, params);
  if (error) throw error;
  return data;
}

/** Écran de console après console_accueil (portes et droits connus), sinon message d'erreur. */
async function avecConsole(conteneur, route, rendre) {
  attente(conteneur);
  try { await assurerConsole(); } catch (err) { erreur(conteneur, err); return; }
  if (!conteneur.isConnected) return;
  majLiens(route);
  rendre();
}

/* ------------------------------------------------------------ Entrer dans une boutique */

/**
 * « Ouvrir la boutique » : bascule dans l'interface boutique actuelle, inchangée. Membre : on entre sans question.
 * Sinon : accès de dépannage (depannage.js), motif d'abord, avec les droits d'un vendeur et un bandeau ambre.
 */
/** route : l'écran d'arrivée dans la boutique (« colis » pour le bouton Colis d'une logistique, étape 26). */
export async function ouvrirBoutique(b, route = 'aujourdhui') {
  let ok = false;
  try { ok = await demanderEntree(b); } catch (err) { toast(String(err?.message || err), 'erreur', 7000); return; }
  if (!ok) return;
  entrerDansBoutique(b.id);
  await Promise.all([chargerEtatLicence(), chargerModules(b.id, { annoncer: false })]);
  document.querySelector('.dir-shell')?.remove();
  naviguer(route);
}

/* ------------------------------------------------------------ #/boutiques */

export function afficherBoutiquesDirection(conteneur, params) {
  // #/boutiques/<id> : lien « Fiche complète dans les outils » de la fiche → l'ancienne administration.
  if (params.get('id')) { location.assign(`admin/#/boutiques/${encodeURIComponent(params.get('id'))}`); return; }
  sortirDeBoutique();
  avecConsole(conteneur, 'boutiques', () => {
    const p = porteDeRoute('boutiques');
    if (!p) { naviguer('', { remplacer: true }); return; }
    afficherEspace(conteneur, { id: p.code, ouvrirBoutique });
  });
}

/* ------------------------------------------------------------ #/marche-monde */

const ONGLETS = [['colis', 'Colis'], ['envois', 'Envois'], ['agences', 'Agences'], ['marche', 'Marché'], ['vendeurs', 'Vendeurs']];
let logistique = null; // { id } | { erreur, detail } — résolu une fois par session

/**
 * La boutique logistique : celle de l'espace qui possède des agences. Lue parmi les boutiques de l'espace
 * (console_boutiques) dont la personne est membre ; plusieurs ou aucune → on s'arrête et on le dit.
 */
async function boutiqueLogistique(code) {
  if (logistique) return logistique;
  const lignes = (await rpc('console_boutiques', { p_espace: code, p_filtre: null, p_recherche: null, p_limite: 500 })) || [];
  const ids = new Set(lignes.map((b) => b.id));
  const membre = etat.boutiques.filter((x) => ids.has(x.boutique.id)).map((x) => x.boutique.id);
  let avec = [];
  if (membre.length) {
    const { data, error } = await sb.from('agences').select('boutique_id').in('boutique_id', membre);
    if (error) throw error;
    avec = [...new Set((data || []).map((a) => a.boutique_id))];
  }
  logistique = avec.length === 1 ? { id: avec[0] }
    : { erreur: avec.length ? 'plusieurs' : 'aucune', detail: avec.length ? `${avec.length} boutiques de cet espace ont des agences.` : 'Aucune boutique de cet espace dont vous êtes membre n’a d’agence.' };
  return logistique;
}

export function afficherMarcheMonde(conteneur, params) {
  avecConsole(conteneur, 'marche-monde', async () => {
    const p = porteDeRoute('marche-monde');
    if (!p) { naviguer('', { remplacer: true }); return; }
    // Marché en veille (direction_accueil) : pas d'onglet Marché ; il revient quand le serveur le rallume.
    const veille = await marcheEnVeille();
    if (!conteneur.isConnected) return;
    const onglets = ONGLETS.filter(([c]) => c !== 'marche' || !veille);
    const onglet = onglets.some(([c]) => c === params.get('onglet')) ? params.get('onglet') : 'colis';
    conteneur.innerHTML = `
      <div class="dir-page dir-page-porte">
        <header class="dir-porte-entete" style="--dir-couleur:${esc(p.couleur || '#0F7B5F')}">
          <div><h1>${esc(p.nom)}</h1>${p.description ? `<span>${esc(p.description)}</span>` : ''}</div>
        </header>
        <nav class="onglets-pastilles dir-onglets" aria-label="${esc(p.nom)}">
          ${onglets.map(([c, l]) => `<a class="onglet-pastille ${c === onglet ? 'actif' : ''}" href="#/marche-monde?onglet=${c}" ${c === onglet ? 'aria-current="page"' : ''}>${l}</a>`).join('')}
        </nav>
        <div class="dir-onglet" data-zone="onglet"><span class="squelette" style="height:280px"></span></div>
      </div>`;
    const zone = conteneur.querySelector('[data-zone="onglet"]');

    if (onglet === 'vendeurs') {
      sortirDeBoutique();
      // Décision « Payer » : la fiche du vendeur dont le fournisseur est la cible, règlement ouvert.
      const payer = params.get('payer');
      if (payer) {
        try {
          const lignes = (await rpc('console_boutiques', { p_espace: p.code, p_filtre: null, p_recherche: null, p_limite: 500 })) || [];
          const v = lignes.find((b) => b.fournisseur_id === payer);
          if (v) { location.replace(`#/fiche/${encodeURIComponent(v.id)}?payer=1`); return; }
          toast('Ce vendeur n’est pas dans la liste.', 'erreur');
        } catch (err) { toast(err?.message || String(err), 'erreur'); }
      }
      afficherEspace(zone, { id: p.code });
      return;
    }
    // Colis, Envois, Agences, Marché : les pages de la boutique logistique, dans laquelle on entre (ses liens y mènent).
    let log;
    try { log = await boutiqueLogistique(p.code); } catch (err) { erreur(zone, err); return; }
    if (!zone.isConnected) return;
    if (log.erreur) {
      zone.innerHTML = `<div class="carte dir-arret"><strong>${log.erreur === 'plusieurs' ? 'Plusieurs boutiques logistiques' : 'Aucune boutique logistique'}</strong><p>${esc(log.detail)} L’écran ne choisit pas à votre place.</p></div>`;
      return;
    }
    choisirBoutique(log.id);
    entrerDansBoutique(log.id);
    await chargerModules(log.id, { annoncer: false });
    if (!zone.isConnected) return;
    if (onglet === 'marche') afficherMarche(zone, params, { adresse: (q) => `#/marche-monde?onglet=marche${q ? `&${q}` : ''}` });
    else if (onglet === 'colis') afficherColisTableau(zone, params);
    else if (onglet === 'envois') afficherEnvois(zone, params);
    else afficherAgences(zone);
  });
}

/* ------------------------------------------------------------ Écrans de la console */

export function afficherFicheDirection(conteneur, params) {
  sortirDeBoutique();
  avecConsole(conteneur, 'fiche', () => afficherFiche(conteneur, { id: params.get('id'), payer: params.get('payer') === '1' }));
}

export function afficherTerrainDirection(conteneur, params) {
  sortirDeBoutique();
  avecConsole(conteneur, 'terrain', () => afficherTerrain(conteneur, { params }));
}

export function afficherAccesDirection(conteneur) {
  sortirDeBoutique();
  avecConsole(conteneur, 'acces', () => {
    if (!moi().peut_gerer_acces) { naviguer('', { remplacer: true }); return; }
    afficherAcces(conteneur);
  });
}

/** #/espace/<code> (liens de la console) : l'écran de sa porte, ou la liste générique d'un autre espace. */
export function afficherEspaceDirection(conteneur, params) {
  const code = params.get('id');
  avecConsole(conteneur, `espace/${code}`, () => {
    const p = porte(code);
    if (!p) { naviguer('', { remplacer: true }); return; }
    const route = routePorte(p);
    if (!route.startsWith('espace/')) { naviguer(route, { remplacer: true }); return; }
    afficherEspace(conteneur, { id: code });
  });
}

/** #/chercher?q= : recherche dans les portes reçues du serveur seulement (console_boutiques, espace par espace). */
export function afficherRechercheDirection(conteneur, params) {
  const q = (params.get('q') || '').trim();
  avecConsole(conteneur, 'chercher', async () => {
    conteneur.innerHTML = `<div class="dir-page"><header class="dir-page-tete"><h1>Recherche</h1><span class="discret">« ${esc(q)} »</span></header><div data-zone="resultats"><span class="squelette" style="height:200px"></span></div></div>`;
    const zone = conteneur.querySelector('[data-zone="resultats"]');
    try {
      const listes = await Promise.all(portes().map(async (p) => ({ p, lignes: q ? ((await rpc('console_boutiques', { p_espace: p.code, p_filtre: null, p_recherche: q, p_limite: 20 })) || []) : [] })));
      if (!zone.isConnected) return;
      const trouves = listes.filter((x) => x.lignes.length);
      zone.innerHTML = trouves.length ? trouves.map(({ p, lignes }) => `
        <section class="carte dir-bloc">
          <div class="dir-bloc-tete"><h2><span class="dir-etiquette-espace" style="--dir-couleur:${esc(p.couleur)}">${esc(p.nom)}</span></h2></div>
          <ul class="dir-resultats">${lignes.map((b) => `<li><a href="#/fiche/${encodeURIComponent(b.id)}"><strong>${esc(b.nom)}</strong><span>${esc([b.ville, b.proprietaire].filter(Boolean).join(' · '))}</span></a></li>`).join('')}</ul>
        </section>`).join('') : '<p class="col-vide">Aucun résultat.</p>';
    } catch (err) { erreur(zone, err); }
  });
}
