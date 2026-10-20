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
import { moduleVisible, aModule, vocab, activite, chargerModules } from './modules.js';
import {
  esc, icone, logoMarque, logoSymbole, ouvrirModale, formatDate, jours, TYPES_ACTIVITE
} from './utils.js';

/** Sections du menu. `active` = disponible ; `droit` = réservée à un rôle (voir peut() dans state.js). */
export const SECTIONS = [
  { route: 'tableau-de-bord', libelle: 'Tableau de bord', icone: 'tableau', active: true },
  { route: 'caisse', libelle: 'Caisse', icone: 'caisse', active: true },
  { route: 'ventes', libelle: 'Ventes', icone: 'ventes', active: true },
  { route: 'proformas', libelle: 'Devis', icone: 'document', active: true, droit: 'devis.creer', module: 'devis' },
  { route: 'stock', libelle: 'Stock', icone: 'stock', active: true },
  { route: 'clients', libelle: 'Clients & crédits', icone: 'clients', active: true },
  { route: 'chantiers', libelle: 'Chantiers', icone: 'casque', active: true, module: 'chantiers' },
  { route: 'depenses', libelle: 'Dépenses', icone: 'depenses', active: true },
  { route: 'rapports', libelle: 'Rapports', icone: 'rapports', active: true, droit: 'rapports' },
  { route: 'vendeurs', libelle: 'Vendeurs', icone: 'vendeurs', active: true, droit: 'equipe' },
  { route: 'messages', libelle: 'Messages', icone: 'sms', active: true, droit: 'messages.voir', soldeSms: true, module: 'messages' },
  // Commandes de la boutique en ligne (badge : nombre de commandes « nouvelle », relu toutes les 60 s).
  { route: 'commandes', libelle: 'Commandes en ligne', libelleCourt: 'Commandes', icone: 'enLigne', active: true, droit: 'commandes.voir', badgeCommandes: true, module: 'boutique_en_ligne' },
  { route: 'affiche', libelle: 'Affiche du jour', icone: 'image', active: true, droit: 'affiche.partager', module: 'affiche' },
  { route: 'parametres', libelle: 'Paramètres', icone: 'parametres', active: true },
  // Administration de la plateforme : visible seulement pour l'équipe YOUMMA (est_admin_plateforme).
  { route: 'aide', libelle: 'Aide', icone: 'aide', active: true, badgeAide: true },
  // Panneau d'administration : page séparée (admin/), visible seulement pour l'équipe YOUMMA.
  { route: 'admin', lien: 'admin/', libelle: 'Admin YOUMMA', icone: 'bouclier', active: true, admin: true }
];

/**
 * Sections visibles pour le rôle du membre courant.
 * Boutique de matériaux : « Chantiers » est mis en avant, juste après « Caisse ».
 */
function sectionsVisibles() {
  // Droits du rôle ET modules de la boutique (un module en lecture seule reste visible pour consulter et encaisser).
  const visibles = SECTIONS.filter((section) => (!section.droit || peut(section.droit)) && (!section.admin || etat.adminPlateforme)
    && (!section.module || moduleVisible(section.module)));
  if (etat.boutique?.type_activite !== 'materiaux') return visibles;
  const chantiers = visibles.find((section) => section.route === 'chantiers');
  if (!chantiers) return visibles;
  const autres = visibles.filter((section) => section !== chantiers);
  autres.splice(autres.findIndex((section) => section.route === 'caisse') + 1, 0, chantiers);
  return autres;
}

/** Onglet « Stock » : libellé du menu de l'activité (« Stock », « Menu », « Prestations »…). */
function libelleOnglet(o) {
  return o.vocab ? vocab('menu') : o.libelle;
}

/** Onglets de la barre du bas (téléphone). */
const ONGLETS = [
  { route: 'tableau-de-bord', libelle: 'Accueil', icone: 'tableau' },
  { route: 'caisse', libelle: 'Caisse', icone: 'caisse' },
  { route: 'caisse?vendre=1', libelle: 'Vendre', icone: 'plusCercle', central: true },
  { route: 'stock', libelle: 'Stock', icone: 'stock', vocab: true }
];
/** Sections accessibles depuis « Plus » (celles absentes de la barre du bas). */
const ROUTES_BARRE_BAS = ['tableau-de-bord', 'caisse', 'stock'];

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
    const actif = lien.dataset.route === route;
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
        <a class="sidebar-logo" href="#/tableau-de-bord" aria-label="YOUMMA Business — Tableau de bord">${logoMarque('sombre', 34)}</a>
        ${selecteurBoutique()}
        <div class="menu-liens">${sectionsVisibles().map(lienMenu).join('')}</div>
        ${carteLicence('sombre')}
        <button type="button" class="lien-menu lien-deconnexion" data-action="deconnexion">
          ${icone('deconnexion', 20)}<span>Se déconnecter</span>
        </button>
      </nav>

      <div class="colonne">
        <header class="entete-mobile" style="--couleur-activite:${esc(couleurActivite())}">
          ${logoSymbole(34, 'YOUMMA Business')}
          <div class="entete-mobile-textes">
            <span class="entete-mobile-nom">${esc(b.nom)}</span>
            <span class="entete-mobile-sous">${esc(b.ville || '')} · Licence ${esc(licence.formule)}${licence.joursRestants !== null ? ' · ' + licence.joursRestants + ' j' : ''}</span>
          </div>
        </header>
        <div data-zone="bandeau-plateforme">${bandeauMaintenanceHTML()}</div>
        <div data-zone="bandeau-licence">${bandeauLicenceHTML()}</div>
        <div data-zone="bandeau-annonce"></div>
        <div data-zone="bandeau-sms"></div>
        <main id="vue" tabindex="-1"></main>
      </div>

      <nav class="barre-bas" aria-label="Navigation">
        ${ONGLETS.map((o) => `
          <a href="#/${o.route}" class="onglet ${o.central ? 'onglet-central' : ''}" ${o.central ? '' : `data-route="${o.route}"`}>
            <span class="onglet-icone">${icone(o.icone, 22, 1.9)}</span><span data-ref="onglet-${esc(o.route.split('?')[0])}">${esc(libelleOnglet(o))}</span>
          </a>`).join('')}
        <button type="button" class="onglet" data-action="plus" aria-haspopup="dialog">
          <span class="onglet-icone">${icone('menu', 22, 1.9)}</span>Plus
        </button>
      </nav>
    </div>`;

  const shell = app.querySelector('.shell');
  brancherShell(shell);
  if (aModule('messages')) majCreditSmsAffiche(); // badge du menu et bandeau « crédit bas » (gérant / propriétaire)
  if (aModule('boutique_en_ligne')) demarrerSurveillanceCommandes(); // badge « Commandes » + toast et son à chaque nouvelle commande
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
  return sectionsVisibles().filter((s) => !s.admin).map((s) => ({ route: s.route, libelle: libelleSection(s, false), icone: s.icone }));
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
  if (liens) liens.innerHTML = sectionsVisibles().map(lienMenu).join('');
  if (actif) shell.querySelector(`.menu-liens [data-route="${actif}"]`)?.classList.add('actif');
  ONGLETS.forEach((o) => { const el = shell.querySelector(`[data-ref="onglet-${o.route.split('?')[0]}"]`); if (el) el.textContent = libelleOnglet(o); });
  shell.querySelectorAll('.selecteur-bouton, .entete-mobile').forEach((el) => el.style.setProperty('--couleur-activite', couleurActivite()));
  if (aModule('messages')) majCreditSmsAffiche();
  if (aModule('boutique_en_ligne')) verifierCommandes();
  majBadgeAide();
}
window.addEventListener('modules:change', majMenu);

/* ------------------------------------------------------------ Éléments du menu */

/** Libellé d'une section : « Stock » suit le vocabulaire de l'activité (« Modèles & stock », « Prestations »…). */
function libelleSection(section, court = true) {
  if (section.route === 'stock') return vocab('menu') || section.libelle;
  if (section.route === 'clients' && !moduleVisible('credits')) return 'Clients';
  return court ? section.libelleCourt || section.libelle : section.libelle;
}

function lienMenu(section) {
  return `
    <a href="${section.lien || `#/${section.route}`}" class="lien-menu" data-route="${section.route}">
      ${icone(section.icone, 20)}
      <span class="lien-menu-libelle">${esc(libelleSection(section))}</span>
      ${section.badge ? `<span class="badge-premium">${esc(section.badge)}</span>` : ''}
      ${section.soldeSms ? '<span class="badge-sms" data-ref="badge-sms" aria-label="SMS restants"></span>' : ''}
      ${section.badgeCommandes ? '<span class="badge-commandes" data-ref="badge-commandes"></span>' : ''}
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
  naviguer('tableau-de-bord');
}

/* ------------------------------------------------------------ Licence */

/** Statut affiché d'une licence : Active, Bientôt (≤ 5 jours) ou Expirée. */
export function statutLicence(l) {
  if (l.expiree) return { libelle: 'Expirée', classe: 'statut-expire' };
  if (l.joursRestants !== null && l.joursRestants <= 5) return { libelle: 'Bientôt', classe: 'statut-bientot' };
  return { libelle: 'Active', classe: 'statut-actif' };
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
  const sections = sectionsVisibles().filter((s) => !ROUTES_BARRE_BAS.includes(s.route));
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
        ${sections.map((s) => `
          <a href="${s.lien || `#/${s.route}`}" class="plus-lien">
            ${icone(s.icone, 20)}<span>${esc(libelleSection(s, false))}</span>
            ${s.badge ? `<span class="badge-premium">${esc(s.badge)}</span>` : ''}
            ${s.badgeCommandes ? '<span class="badge-commandes" data-ref="badge-commandes"></span>' : ''}
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
        <a class="btn btn-primaire" href="#/tableau-de-bord">Retour au tableau de bord</a>
      </section>
    </div>`;
}
