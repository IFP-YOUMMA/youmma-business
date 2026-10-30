/**
 * layout.js — Coquille de l'application connectée : menu latéral (ordinateur),
 * en-tête et barre du bas (téléphone), panneau « Plus », carte licence,
 * bandeau de licence expirée et écran « Bientôt disponible ».
 */
import { etat, infosLicence, choisirBoutique, peut } from './state.js';
import { naviguer } from './router.js';
import { deconnecter } from './auth.js';
import { majCreditSmsAffiche } from './sms.js';
import { demarrerSurveillanceCommandes, verifierCommandes } from './alertes-commandes.js';
import { bandeauLicenceHTML, bandeauMaintenanceHTML, appliquerLectureSeule, afficherAnnonces, chargerEtatLicence } from './plateforme.js';
import { majBadgeAide } from './aide.js';
import { moduleVisible, aModule, enOption, vocab, activite, chargerModules, estLogistique } from './modules.js';
import {
  esc, icone, logoMarque, logoSymbole, ouvrirModale, formatDate, jours, initiales, TYPES_ACTIVITE
} from './utils.js';

/**
 * Sections du menu (étape 14 : dix entrées rangées par groupe). `groupe` : titre gris au-dessus (« bas » : séparées
 * par un trait en bas du menu) ; `routes` : écrans qui allument l'entrée ; `droit` : rôle (peut() dans state.js) ;
 * `module` : module de la boutique (étape 11).
 */
export const SECTIONS = [
  // Un seul « Aujourd'hui » : celui du commerce, ou celui du transit pour une boutique de logistique.
  { route: 'aujourdhui', libelle: 'Aujourd’hui', icone: 'maison', active: true, module: 'tableau_de_bord', accueil: 'commerce' },
  // Étapes 16 et 18 — logistique et transit (activité « logistique » seulement).
  { route: 'transit', libelle: 'Aujourd’hui', icone: 'maison', active: true, module: 'colis', accueil: 'logistique' },
  { groupe: 'Expéditions', route: 'colis', libelle: 'Colis', icone: 'colis', active: true, module: 'colis' },
  { groupe: 'Expéditions', route: 'recevoir', libelle: 'Recevoir', icone: 'entree', active: true, module: 'colis', routes: ['recevoir', 'peser'] },
  { groupe: 'Expéditions', route: 'nouveau-colis', libelle: 'Nouveau colis', icone: 'plus', active: true, module: 'colis' },
  { groupe: 'Expéditions', route: 'envois', libelle: 'Envois', icone: 'camion', active: true, module: 'envois' },
  { groupe: 'Expéditions', route: 'comptes', libelle: 'Comptes clients', icone: 'client', active: true, module: 'colis' },
  { groupe: 'Vente', route: 'caisse', libelle: 'Caisse & ventes', icone: 'caisse', active: true, routes: ['caisse', 'ventes'], module: 'ventes' },
  { groupe: 'Vente', route: 'proformas', libelle: 'Devis', icone: 'document', active: true, droit: 'devis.creer', module: 'devis', badgeDevis: true },
  { groupe: 'Vente', route: 'boutique-en-ligne', libelle: 'Boutique en ligne', icone: 'enLigne', active: true, droit: 'commandes.voir', badgeCommandes: true, module: 'boutique_en_ligne' },
  { groupe: 'Stock & clients', route: 'stock', libelle: 'Articles & stock', icone: 'stock', active: true, module: 'stock' },
  { groupe: 'Stock & clients', route: 'clients', libelle: 'Clients & crédits', icone: 'clients', active: true, module: 'clients' },
  { groupe: 'Stock & clients', route: 'chantiers', libelle: 'Chantiers', icone: 'casque', active: true, module: 'chantiers' },
  { groupe: 'Gestion', route: 'messages', libelle: 'Messages', icone: 'sms', active: true, droit: 'messages.voir', soldeSms: true, module: 'messages' },
  { groupe: 'Gestion', route: 'depenses', libelle: 'Dépenses', icone: 'depenses', active: true },
  { groupe: 'Gestion', route: 'rapports', libelle: 'Rapports', icone: 'rapports', active: true, droit: 'rapports', module: 'rapports' },
  { groupe: 'Gestion', route: 'vendeurs', libelle: 'Vendeurs', icone: 'vendeurs', active: true, droit: 'equipe' },
  { groupe: 'bas', route: 'parametres', libelle: 'Paramètres', icone: 'parametres', active: true },
  { groupe: 'bas', route: 'aide', libelle: 'Aide', icone: 'aide', active: true, badgeAide: true }
];

/** Sections visibles : droits du rôle ET modules de la boutique (un module en lecture seule reste visible). */
function sectionsVisibles() {
  // Option payante non payée (boutique en ligne) : l'entrée reste, grisée avec un cadenas, et mène à la page d'activation.
  const accueil = estLogistique() ? 'logistique' : 'commerce';
  return SECTIONS.filter((section) => (!section.accueil || section.accueil === accueil)
    && (!section.droit || peut(section.droit)) && (!section.module || moduleVisible(section.module) || enOption(section.module)));
}

/** Entrée d'une option à activer (grisée, cadenas à la place des pastilles). */
function verrouillee(section) {
  return Boolean(section.module && enOption(section.module));
}

/** Onglet « Stock » de la barre du bas : libellé du menu de l'activité (« Stock », « Menu », « Prestations »…). */
function libelleOnglet(o) {
  return o.vocab ? vocab('menu') : o.libelle;
}

/** Onglets de la barre du bas (téléphone) ; « Vendre » est un bouton rond flottant à part. */
const ONGLETS = [
  { route: 'aujourdhui', libelle: 'Accueil', icone: 'maison' },
  { route: 'caisse', libelle: 'Caisse', icone: 'caisse', routes: ['caisse', 'ventes'] },
  { route: 'stock', libelle: 'Stock', icone: 'stock', vocab: true },
  { route: 'clients', libelle: 'Clients', icone: 'clients' }
];
/** Barre du bas d'une boutique de logistique : Aujourd'hui, Colis, Envois, Comptes ; bouton rond « Recevoir » (étape 18). */
const ONGLETS_LOGISTIQUE = [
  { route: 'transit', libelle: 'Aujourd’hui', icone: 'maison' },
  { route: 'colis', libelle: 'Colis', icone: 'colis' },
  { route: 'envois', libelle: 'Envois', icone: 'camion' },
  { route: 'comptes', libelle: 'Comptes', icone: 'client' }
];
const onglets = () => (estLogistique() ? ONGLETS_LOGISTIQUE : ONGLETS);
/** Sections accessibles depuis « Plus » (celles absentes de la barre du bas). */
const routesBarreBas = () => onglets().map((o) => o.route);
function barreBasHTML() {
  return `${onglets().map((o) => `
          <a href="#/${o.route}" class="onglet" data-route="${o.route}" ${o.routes ? `data-routes="${o.routes.join(' ')}"` : ''}>
            <span class="onglet-icone">${icone(o.icone, 21, 1.7)}</span><span data-ref="onglet-${esc(o.route)}">${esc(libelleOnglet(o))}</span>
          </a>`).join('')}
        <button type="button" class="onglet" data-action="plus" aria-haspopup="dialog">
          <span class="onglet-icone">${icone('menu', 21, 1.7)}</span>Plus
        </button>`;
}
const boutonRondHTML = () => (estLogistique()
  ? `${icone('plus', 18, 2.8)}<span>Recevoir</span>`
  : `${icone('plus', 18, 2.8)}<span>Vendre</span>`);
const lienBoutonRond = () => (estLogistique() ? '#/recevoir' : '#/caisse?vendre=1');

/* ------------------------------------------------------------ Coquille */

/**
 * Construit (si besoin) la coquille, marque la page active et renvoie le conteneur de la vue.
 * pleinEcran : masque menus (caisse).
 */
export function preparerShell({ route, pleinEcran = false }) {
  let shell = document.querySelector('.shell');
  if (!shell || shell.dataset.boutique !== etat.boutique.id) {
    shell = construireShell();
  }
  shell.classList.toggle('plein', pleinEcran);
  shell.querySelectorAll('[data-route]').forEach((lien) => {
    const actif = (lien.dataset.routes || lien.dataset.route).split(' ').includes(route);
    lien.classList.toggle('actif', actif);
    if (actif) lien.setAttribute('aria-current', 'page');
    else lien.removeAttribute('aria-current');
  });
  // Conteneur neuf à chaque page : les écouteurs posés par l'écran précédent ne s'accumulent pas
  // (sinon, après plusieurs allers-retours, un clic déclenchait plusieurs fois la même action).
  const ancienne = shell.querySelector('#vue');
  const vue = ancienne.cloneNode(false);
  ancienne.replaceWith(vue);
  window.scrollTo(0, 0);
  return vue;
}

/** Met à jour le nom de la boutique affiché dans le menu et l'en-tête (après Paramètres). */
export function majNomBoutiqueAffiche() {
  document.querySelectorAll('.selecteur-bouton .selecteur-nom, .entete-mobile-nom').forEach((el) => { el.textContent = etat.boutique.nom; });
  document.querySelectorAll('.selecteur-bouton .selecteur-sous').forEach((el) => { el.textContent = descriptionBoutique(etat.boutique); });
}

/** Supprime la coquille (écrans publics, onboarding, changement de boutique). */
export function retirerShell() {
  document.querySelector('.shell')?.remove();
}

function construireShell() {
  const app = document.getElementById('app');
  const b = etat.boutique;
  const licence = infosLicence();
  app.innerHTML = `
    <div class="shell" data-boutique="${esc(b.id)}">
      <nav class="sidebar" aria-label="Menu principal">
        <a class="sidebar-logo" href="#/aujourdhui" aria-label="YOUMMA Business — Aujourd’hui">${logoMarque('sombre', 30)}</a>
        ${selecteurBoutique()}
        <div class="menu-liens">${menuHTML()}</div>
        ${ligneLicence()}
        <button type="button" class="lien-deconnexion" data-action="deconnexion">${icone('deconnexion', 15, 1.7)}<span>Se déconnecter</span></button>
      </nav>

      <div class="colonne">
        <header class="entete-mobile" style="--couleur-activite:${esc(couleurActivite())}">
          ${logoSymbole(34, 'YOUMMA Business')}
          <div class="entete-mobile-textes">
            <span class="entete-mobile-nom">${esc(b.nom)}</span>
            <span class="entete-mobile-sous">${esc(descriptionBoutique(b))}${licence.joursRestants !== null && licence.joursRestants <= 15 ? ` · ${esc(licence.formule)} ${licence.joursRestants} j` : ''}</span>
          </div>
        </header>
        <div data-zone="bandeau-plateforme">${bandeauMaintenanceHTML()}</div>
        <div data-zone="bandeau-licence">${bandeauLicenceHTML()}</div>
        <div data-zone="bandeau-annonce"></div>
        <div data-zone="bandeau-sms"></div>
        <main id="vue" tabindex="-1"></main>
      </div>

      <nav class="barre-bas" aria-label="Navigation" data-logistique="${estLogistique()}">${barreBasHTML()}
      </nav>
      <a class="bouton-vendre" href="${lienBoutonRond()}">${boutonRondHTML()}</a>
    </div>`;

  const shell = app.querySelector('.shell');
  brancherShell(shell);
  if (aModule('messages')) majCreditSmsAffiche(); // badge du menu et bandeau « crédit bas » (gérant / propriétaire)
  if (aModule('boutique_en_ligne')) demarrerSurveillanceCommandes(); // badge « Boutique en ligne » + toast et son à chaque nouvelle commande
  majBadgeDevis();                // pastille « Devis » (devis en attente)
  appliquerLectureSeule();        // licence en lecture seule ou suspendue : boutons d'écriture désactivés
  afficherAnnonces();             // annonce de l'équipe YOUMMA (la plus récente, fermable)
  majBadgeAide();                 // badge « Aide » si YOUMMA a répondu
  return shell;
}

function brancherShell(shell) {
  shell.addEventListener('click', (e) => {
    const cible = e.target.closest('[data-action]');
    if (!cible) return;
    const action = cible.dataset.action;
    if (action === 'deconnexion') deconnecter();
    if (action === 'plus') ouvrirPanneauPlus();
    if (action === 'ouvrir-boutiques') basculerListeBoutiques(cible);
    if (action === 'changer-boutique') changerBoutique(cible.dataset.id);
  });
}

/* ------------------------------------------------------------ Modules : menu redessiné */

/** Entrées du menu (pour l'aperçu « Votre menu » de Paramètres › Mes modules). */
export function entreesMenu() {
  return sectionsVisibles().map((s) => ({ route: s.route, libelle: libelleSection(s, false), icone: s.icone }));
}

/** Menu groupé : « Aujourd'hui », puis Vente / Stock & clients / Gestion, puis Paramètres et Aide sous un trait. */
function menuHTML() {
  const visibles = sectionsVisibles();
  const groupes = [];
  visibles.filter((s) => s.groupe !== 'bas').forEach((s) => {
    const nom = s.groupe || '';
    let g = groupes.find((x) => x.nom === nom);
    if (!g) { g = { nom, sections: [] }; groupes.push(g); }
    g.sections.push(s);
  });
  const bas = visibles.filter((s) => s.groupe === 'bas');
  return `${groupes.map((g) => `${g.nom ? `<span class="menu-groupe">${esc(g.nom)}</span>` : ''}${g.sections.map(lienMenu).join('')}`).join('')}
    <div class="menu-bas">${bas.map(lienMenu).join('')}</div>`;
}

/** Pastille or « Devis » : devis en attente (brouillon ou envoyé). */
async function majBadgeDevis() {
  if (!aModule('devis') || !peut('devis.creer')) return;
  try {
    const { sb } = await import('./supabase.js');
    const { count } = await sb.from('proformas').select('id', { count: 'exact', head: true }).eq('boutique_id', etat.boutique.id).in('statut', ['brouillon', 'envoye']);
    document.querySelectorAll('[data-ref="badge-devis"]').forEach((b) => { b.textContent = count ? String(count) : ''; });
  } catch { /* pastille facultative */ }
}

/** Couleur de l'activité (fine touche : liseré du sélecteur de boutique et de l'en-tête téléphone). */
function couleurActivite() {
  const c = activite()?.couleur;
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : 'transparent';
}

/** Redessine les liens du menu, la barre du bas et la touche de couleur (modules ou activité changés). */
export function majMenu() {
  const shell = document.querySelector('.shell');
  if (!shell) return;
  const actif = shell.querySelector('.menu-liens .lien-menu.actif')?.dataset.route;
  const liens = shell.querySelector('.menu-liens');
  if (liens) liens.innerHTML = menuHTML();
  if (actif) shell.querySelector(`.menu-liens [data-route="${actif}"]`)?.classList.add('actif');
  // Activité changée (ou modules connus après la coquille) : barre du bas et bouton rond refaits.
  const barre = shell.querySelector('.barre-bas');
  if (barre && barre.dataset.logistique !== String(estLogistique())) {
    barre.innerHTML = barreBasHTML();
    barre.dataset.logistique = String(estLogistique());
    const rond = shell.querySelector('.bouton-vendre');
    if (rond) { rond.href = lienBoutonRond(); rond.innerHTML = boutonRondHTML(); }
  }
  onglets().forEach((o) => { const el = shell.querySelector(`[data-ref="onglet-${o.route}"]`); if (el) el.textContent = libelleOnglet(o); });
  majBadgeDevis();
  shell.querySelectorAll('.selecteur-bouton, .entete-mobile').forEach((el) => el.style.setProperty('--couleur-activite', couleurActivite()));
  if (aModule('messages')) majCreditSmsAffiche();
  if (aModule('boutique_en_ligne')) verifierCommandes();
  majBadgeAide();
}
window.addEventListener('modules:change', majMenu);

/* ------------------------------------------------------------ Éléments du menu */

/** Libellé d'une section : « Stock » suit le vocabulaire de l'activité (« Modèles & stock », « Prestations »…). */
function libelleSection(section, court = true) {
  // « Articles & stock » (« Modèles & stock » en habillement) ; « Menu », « Prestations » restent tels quels.
  if (section.route === 'stock') return vocab('menu') && vocab('menu') !== 'Stock' ? vocab('menu') : `${vocab('articles') || 'Articles'} & stock`;
  if (section.route === 'clients' && !moduleVisible('credits')) return 'Clients';
  // « Vendeurs » suit le vocabulaire de l'activité (activites.vocab.vendeurs, « Employés » pour le transit).
  if (section.route === 'vendeurs') return vocab('vendeurs') || section.libelle;
  return court ? section.libelleCourt || section.libelle : section.libelle;
}

function lienMenu(section) {
  return `
    <a href="#/${section.route}" class="lien-menu ${verrouillee(section) ? 'verrouille' : ''}" data-route="${section.route}" ${section.routes ? `data-routes="${section.routes.join(' ')}"` : ''}>
      ${icone(section.icone, 17, 1.7)}
      <span class="lien-menu-libelle">${esc(libelleSection(section))}</span>
      ${section.soldeSms ? '<span class="badge-sms" data-ref="badge-sms" aria-label="SMS restants"></span>' : ''}
      ${section.badgeDevis ? '<span class="badge-commandes" data-ref="badge-devis"></span>' : ''}
      ${verrouillee(section) ? `<span class="cadenas-menu" title="Option à activer">${icone('cadenas', 14, 1.9)}<span class="sr-only">option à activer</span></span>` : section.badgeCommandes ? '<span class="badge-commandes" data-ref="badge-commandes"></span>' : ''}
      ${section.badgeAide ? '<span class="badge-commandes" data-ref="badge-aide"></span>' : ''}
    </a>`;
}

/** Bouton « boutique active » + liste déroulante des autres boutiques. */
function selecteurBoutique() {
  const b = etat.boutique;
  const autres = etat.boutiques.filter((x) => x.boutique.id !== b.id);
  return `
    <div class="selecteur-boutique">
      <button type="button" class="selecteur-bouton" data-action="ouvrir-boutiques" aria-expanded="false" aria-controls="liste-boutiques" style="--couleur-activite:${esc(couleurActivite())}">
        <span class="selecteur-initiales" aria-hidden="true">${esc(initiales(b.nom))}</span>
        <span class="selecteur-textes">
          <span class="selecteur-nom">${esc(b.nom)}</span>
          <span class="selecteur-sous">${esc(descriptionBoutique(b))}</span>
        </span>
        ${icone('chevronBas', 16, 2)}
      </button>
      <div class="liste-boutiques" id="liste-boutiques" hidden>
        ${autres.map((x) => `
          <button type="button" class="item-boutique" data-action="changer-boutique" data-id="${esc(x.boutique.id)}">
            <span class="selecteur-nom">${esc(x.boutique.nom)}</span>
            <span class="selecteur-sous">${esc(descriptionBoutique(x.boutique))}</span>
          </button>`).join('')}
        ${peut('ouvrir_boutique') ? `<a class="item-boutique item-nouvelle" href="#/nouvelle-boutique?creer=1">${icone('plus', 16, 2.2)} Créer une autre boutique</a>` : ''}
        <a class="item-boutique item-nouvelle" href="#/rejoindre">${icone('connexion', 16, 2.2)} Rejoindre une boutique avec un code</a>
      </div>
    </div>`;
}

function descriptionBoutique(boutique) {
  return [boutique.ville, TYPES_ACTIVITE[boutique.type_activite] || ''].filter(Boolean).join(' · ');
}

function basculerListeBoutiques(bouton) {
  const liste = bouton.parentElement.querySelector('.liste-boutiques');
  const ouvert = liste.hidden;
  liste.hidden = !ouvert;
  bouton.setAttribute('aria-expanded', String(ouvert));
}

// Fermeture de la liste des boutiques au clic extérieur ou sur Échap.
document.addEventListener('click', (e) => {
  if (e.target.closest('.selecteur-boutique')) return;
  document.querySelectorAll('.liste-boutiques').forEach((l) => { l.hidden = true; });
  document.querySelectorAll('.selecteur-bouton').forEach((b) => b.setAttribute('aria-expanded', 'false'));
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.liste-boutiques').forEach((l) => { l.hidden = true; });
});

/** Active une autre boutique et repart de son tableau de bord. */
export async function changerBoutique(id) {
  if (!choisirBoutique(id)) return;
  await Promise.all([chargerEtatLicence(), chargerModules(id, { annoncer: false })]);
  retirerShell();
  naviguer('aujourdhui');
}

/* ------------------------------------------------------------ Licence */

/** Statut affiché d'une licence : Active, Bientôt (≤ 5 jours) ou Expirée. */
export function statutLicence(l) {
  if (l.expiree) return { libelle: 'Expirée', classe: 'statut-expire' };
  if (l.joursRestants !== null && l.joursRestants <= 5) return { libelle: 'Bientôt', classe: 'statut-bientot' };
  return { libelle: 'Active', classe: 'statut-actif' };
}

/** Ligne fine du menu : « Essai · 11 jours restants », barre de progression et lien « Activer » / « Renouveler ». */
function ligneLicence() {
  const l = infosLicence();
  const essai = String(l.formule || '').toLowerCase() === 'essai';
  let reste = 'date de fin non définie';
  if (l.expiree) reste = 'expirée';
  else if (l.joursRestants !== null) reste = `${jours(l.joursRestants)} restant${l.joursRestants > 1 ? 's' : ''}`;
  const pct = Math.max(0, Math.min(100, Math.round((l.progression || 0) * 100)));
  return `
    <a class="ligne-licence ${l.expiree ? 'expiree' : ''}" href="#/licence" aria-label="Licence ${esc(l.formule)} : ${esc(reste)}">
      <span class="ligne-licence-haut"><strong>${esc(l.formule)}</strong><span>${esc(reste)}</span><span class="ligne-licence-action">${essai ? 'Activer' : 'Renouveler'}</span></span>
      <span class="ligne-licence-barre" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></span>
    </a>`;
}

/** Carte licence : theme 'sombre' (menu latéral) ou 'clair' (panneau Plus / accueil téléphone). */
export function carteLicence(theme = 'sombre') {
  const l = infosLicence();
  const statut = statutLicence(l);

  let texte = 'Date de fin non définie';
  if (l.expiree) texte = `Expirée depuis le <strong>${esc(formatDate(l.fin, 'court'))}</strong>`;
  else if (l.fin) texte = `Expire dans <strong>${jours(l.joursRestants)}</strong> · le ${esc(formatDate(l.fin, 'court'))}`;

  return `
    <div class="carte-licence carte-licence-${theme}">
      <div class="carte-licence-haut">
        <span class="carte-licence-formule">Licence ${esc(l.formule)}</span>
        <span class="statut-licence ${statut.classe}">${statut.libelle}</span>
      </div>
      <span class="carte-licence-texte">${texte}</span>
      <div class="jauge-licence" role="progressbar" aria-label="Durée restante de la licence" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(l.progression * 100)}">
        <div class="jauge-licence-remplie ${l.joursRestants !== null && l.joursRestants <= 5 ? 'faible' : ''}" style="width:${Math.round(l.progression * 100)}%"></div>
      </div>
      <a class="btn btn-licence" href="#/licence">Renouveler</a>
    </div>`;
}

/* ------------------------------------------------------------ Panneau « Plus » (téléphone) */

function ouvrirPanneauPlus() {
  const autres = etat.boutiques.filter((x) => x.boutique.id !== etat.boutique.id);
  const sections = sectionsVisibles().filter((s) => !routesBarreBas().includes(s.route));
  const { el, fermer } = ouvrirModale({
    titre: 'Menu',
    variante: 'feuille',
    contenu: `
      <div class="plus-boutique">
        <span class="plus-boutique-nom">${esc(etat.boutique.nom)}</span>
        <span class="plus-boutique-sous">${esc(descriptionBoutique(etat.boutique))}</span>
      </div>
      ${autres.length ? `
        <div class="plus-groupe">
          <span class="plus-groupe-titre">Changer de boutique</span>
          ${autres.map((x) => `
            <button type="button" class="plus-lien" data-id="${esc(x.boutique.id)}">
              ${icone('magasin', 20)}<span>${esc(x.boutique.nom)}</span>
            </button>`).join('')}
        </div>` : ''}
      <div class="plus-groupe">
        ${sections.map((s, i) => `${s.groupe && s.groupe !== 'bas' && s.groupe !== sections[i - 1]?.groupe ? `<span class="plus-groupe-titre">${esc(s.groupe)}</span>` : ''}
          <a href="#/${s.route}" class="plus-lien ${verrouillee(s) ? 'verrouille' : ''}">
            ${icone(s.icone, 20, 1.7)}<span>${esc(libelleSection(s, false))}</span>
            ${s.badgeDevis ? '<span class="badge-commandes" data-ref="badge-devis"></span>' : ''}
            ${verrouillee(s) ? `<span class="cadenas-menu">${icone('cadenas', 14, 1.9)}<span class="sr-only">option à activer</span></span>` : s.badgeCommandes ? '<span class="badge-commandes" data-ref="badge-commandes"></span>' : ''}
            ${s.badgeAide ? '<span class="badge-commandes" data-ref="badge-aide"></span>' : ''}
          </a>`).join('')}
        ${peut('ouvrir_boutique') ? `<a href="#/nouvelle-boutique?creer=1" class="plus-lien">${icone('plus', 20)}<span>Créer une autre boutique</span></a>` : ''}
        <a href="#/rejoindre" class="plus-lien">${icone('connexion', 20)}<span>Rejoindre une boutique avec un code</span></a>
      </div>
      ${carteLicence('clair')}
      <button type="button" class="btn btn-secondaire btn-bloc" data-action="deconnexion-plus">
        ${icone('deconnexion', 18, 2)} Se déconnecter
      </button>`
  });
  // Badge « Commandes » du panneau : même valeur que le menu, relue tout de suite.
  const badgeMenu = document.querySelector('.sidebar [data-ref="badge-commandes"]')?.textContent || '';
  el.querySelectorAll('[data-ref="badge-commandes"]').forEach((b) => { b.textContent = badgeMenu; });
  majBadgeDevis();
  verifierCommandes();
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="deconnexion-plus"]')) { fermer(); deconnecter(); }
    const boutonBoutique = e.target.closest('button[data-id]');
    if (boutonBoutique) { fermer(); changerBoutique(boutonBoutique.dataset.id); }
    if (e.target.closest('a[href^="#/"]')) fermer();
  });
}

/* ------------------------------------------------------------ Écran « Bientôt disponible » */

export function afficherBientot(conteneur, section) {
  conteneur.innerHTML = `
    <div class="page">
      <section class="carte bientot">
        <span class="bientot-icone">${icone(section.icone, 36, 1.7)}</span>
        <h1>${esc(section.libelle)}</h1>
        ${section.badge ? `<span class="badge-premium">${esc(section.badge)}</span>` : ''}
        <p class="bientot-texte">${esc(section.description || '')}</p>
        <p class="bientot-statut">${icone('horloge', 16, 2)} Bientôt disponible dans YOUMMA Business</p>
        <a class="btn btn-primaire" href="#/aujourdhui">Retour à « Aujourd’hui »</a>
      </section>
    </div>`;
}
