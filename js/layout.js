/**
 * layout.js — Coquille de l'application connectée : menu latéral (ordinateur),
 * en-tête et barre du bas (téléphone), panneau « Plus », carte licence,
 * bandeau de licence expirée et écran « Bientôt disponible ».
 */
import { etat, infosLicence, choisirBoutique, peut } from './state.js';
import { naviguer } from './router.js';
import { deconnecter } from './auth.js';
import {
  esc, icone, logoComplet, logoGoutte, ouvrirModale, formatDate, jours, lienWhatsApp, TYPES_ACTIVITE
} from './utils.js';

/** Sections du menu. `active` = disponible ; `droit` = réservée à un rôle (voir peut() dans state.js). */
export const SECTIONS = [
  { route: 'tableau-de-bord', libelle: 'Tableau de bord', icone: 'tableau', active: true },
  { route: 'caisse', libelle: 'Caisse', icone: 'caisse', active: true },
  { route: 'ventes', libelle: 'Ventes', icone: 'ventes', active: true },
  { route: 'stock', libelle: 'Stock', icone: 'stock', active: true },
  { route: 'clients', libelle: 'Clients & crédits', icone: 'clients', active: true },
  { route: 'depenses', libelle: 'Dépenses', icone: 'depenses', active: true },
  { route: 'rapports', libelle: 'Rapports', icone: 'rapports', active: true, droit: 'rapports' },
  { route: 'vendeurs', libelle: 'Vendeurs', icone: 'vendeurs', active: true, droit: 'equipe' },
  { route: 'boutique-en-ligne', libelle: 'Boutique en ligne', libelleCourt: 'En ligne', icone: 'enLigne', badge: 'Premium',
    description: 'Une vitrine en ligne pour recevoir des commandes de vos clients sur WhatsApp.' },
  { route: 'parametres', libelle: 'Paramètres', icone: 'parametres', active: true }
];

/** Sections visibles pour le rôle du membre courant. */
function sectionsVisibles() {
  return SECTIONS.filter((section) => !section.droit || peut(section.droit));
}

/** Onglets de la barre du bas (téléphone). */
const ONGLETS = [
  { route: 'tableau-de-bord', libelle: 'Accueil', icone: 'tableau' },
  { route: 'caisse', libelle: 'Caisse', icone: 'caisse' },
  { route: 'caisse?vendre=1', libelle: 'Vendre', icone: 'plusCercle', central: true },
  { route: 'stock', libelle: 'Stock', icone: 'stock' }
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
  const vue = shell.querySelector('#vue');
  vue.innerHTML = '';
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
        <a class="sidebar-logo" href="#/tableau-de-bord" aria-label="YOUMMA Business — Tableau de bord">${logoComplet('sombre')}</a>
        ${selecteurBoutique()}
        <div class="menu-liens">${sectionsVisibles().map(lienMenu).join('')}</div>
        ${carteLicence('sombre')}
        <button type="button" class="lien-menu lien-deconnexion" data-action="deconnexion">
          ${icone('deconnexion', 20)}<span>Se déconnecter</span>
        </button>
      </nav>

      <div class="colonne">
        <header class="entete-mobile">
          ${logoGoutte(30)}
          <div class="entete-mobile-textes">
            <span class="entete-mobile-nom">${esc(b.nom)}</span>
            <span class="entete-mobile-sous">${esc(b.ville || '')} · Licence ${esc(licence.formule)}${licence.joursRestants !== null ? ' · ' + licence.joursRestants + ' j' : ''}</span>
          </div>
        </header>
        ${licence.expiree ? bandeauLicence() : ''}
        <main id="vue" tabindex="-1"></main>
      </div>

      <nav class="barre-bas" aria-label="Navigation">
        ${ONGLETS.map((o) => `
          <a href="#/${o.route}" class="onglet ${o.central ? 'onglet-central' : ''}" ${o.central ? '' : `data-route="${o.route}"`}>
            <span class="onglet-icone">${icone(o.icone, 22, 1.9)}</span>${esc(o.libelle)}
          </a>`).join('')}
        <button type="button" class="onglet" data-action="plus" aria-haspopup="dialog">
          <span class="onglet-icone">${icone('menu', 22, 1.9)}</span>Plus
        </button>
      </nav>
    </div>`;

  const shell = app.querySelector('.shell');
  brancherShell(shell);
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

/* ------------------------------------------------------------ Éléments du menu */

function lienMenu(section) {
  return `
    <a href="#/${section.route}" class="lien-menu" data-route="${section.route}">
      ${icone(section.icone, 20)}
      <span class="lien-menu-libelle">${esc(section.libelleCourt || section.libelle)}</span>
      ${section.badge ? `<span class="badge-premium">${esc(section.badge)}</span>` : ''}
    </a>`;
}

/** Bouton « boutique active » + liste déroulante des autres boutiques. */
function selecteurBoutique() {
  const b = etat.boutique;
  const autres = etat.boutiques.filter((x) => x.boutique.id !== b.id);
  return `
    <div class="selecteur-boutique">
      <button type="button" class="selecteur-bouton" data-action="ouvrir-boutiques" aria-expanded="false" aria-controls="liste-boutiques">
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
export function changerBoutique(id) {
  if (!choisirBoutique(id)) return;
  retirerShell();
  naviguer('tableau-de-bord');
}

/* ------------------------------------------------------------ Licence */

/** Message WhatsApp de renouvellement. */
export function lienRenouvellement() {
  return lienWhatsApp(`Bonjour YOUMMA, je souhaite renouveler la licence de ma boutique ${etat.boutique.nom}`);
}

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
      <a class="btn btn-licence" href="${esc(lienRenouvellement())}" target="_blank" rel="noopener">Renouveler</a>
    </div>`;
}

function bandeauLicence() {
  return `
    <div class="bandeau-licence" role="alert">
      ${icone('alerte', 20, 2)}
      <span>Votre licence a expiré. Vous pouvez consulter vos données mais plus enregistrer de ventes.</span>
      <a class="btn btn-bandeau" href="${esc(lienRenouvellement())}" target="_blank" rel="noopener">Renouveler</a>
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
          <a href="#/${s.route}" class="plus-lien">
            ${icone(s.icone, 20)}<span>${esc(s.libelle)}</span>
            ${s.badge ? `<span class="badge-premium">${esc(s.badge)}</span>` : ''}
          </a>`).join('')}
        ${peut('ouvrir_boutique') ? `<a href="#/nouvelle-boutique?creer=1" class="plus-lien">${icone('plus', 20)}<span>Créer une autre boutique</span></a>` : ''}
        <a href="#/rejoindre" class="plus-lien">${icone('connexion', 20)}<span>Rejoindre une boutique avec un code</span></a>
      </div>
      ${carteLicence('clair')}
      <button type="button" class="btn btn-secondaire btn-bloc" data-action="deconnexion-plus">
        ${icone('deconnexion', 18, 2)} Se déconnecter
      </button>`
  });
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
