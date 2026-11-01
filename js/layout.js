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
import { moduleVisible, aModule, enOption, vocab, activite, chargerModules, donneesModules, infoModule } from './modules.js';
import {
  esc, icone, logoMarque, logoSymbole, ouvrirModale, formatDate, jours, initiales, TYPES_ACTIVITE
} from './utils.js';

/**
 * Comment ouvrir chaque module (étape 18f) : route, icône, libellé. Ce n'est PAS la liste du menu : une entrée n'existe
 * que si la base met son code dans actifs (ou dans lecture_seule, grisée), dans l'ordre qu'elle donne (mes_modules).
 * Un module sans écran à lui (documents, crédits, variantes…) n'a pas d'entrée. `routes` : écrans qui allument
 * l'entrée ; `droit` : rôle (peut() dans state.js) ; `court` : libellé de la barre du bas ; `onglet` : candidat à la
 * barre du bas (téléphone) ; `dans` : écran déjà ouvert par l'entrée d'un autre module (ventes dans la caisse).
 */
const ECRANS = {
  tableau_de_bord: { route: 'aujourdhui', routes: ['aujourdhui', 'transit'], libelle: 'Aujourd’hui', court: 'Accueil', icone: 'maison' },
  caisse: { route: 'caisse', routes: ['caisse', 'ventes'], libelle: 'Caisse & ventes', court: 'Caisse', icone: 'caisse', onglet: true },
  ventes: { route: 'ventes', libelle: 'Ventes', icone: 'ventes', dans: 'caisse' },
  devis: { route: 'proformas', libelle: 'Devis', icone: 'document', droit: 'devis.creer', badgeDevis: true },
  boutique_en_ligne: { route: 'boutique-en-ligne', libelle: 'Boutique en ligne', icone: 'enLigne', droit: 'commandes.voir', badgeCommandes: true },
  stock: { route: 'stock', libelle: 'Articles & stock', court: 'Stock', icone: 'stock', onglet: true },
  clients: { route: 'clients', libelle: 'Clients & crédits', court: 'Clients', icone: 'clients', onglet: true },
  chantiers: { route: 'chantiers', libelle: 'Chantiers', icone: 'casque' },
  messages: { route: 'messages', libelle: 'Messages', icone: 'sms', droit: 'messages.voir', soldeSms: true },
  depenses: { route: 'depenses', libelle: 'Dépenses', icone: 'depenses' },
  rapports: { route: 'rapports', libelle: 'Rapports', icone: 'rapports', droit: 'rapports' },
  vendeurs: { route: 'vendeurs', libelle: 'Vendeurs', icone: 'vendeurs', droit: 'equipe' },
  parametres: { route: 'parametres', libelle: 'Paramètres', icone: 'parametres' },
  // Étapes 16 et 18 — logistique et transit : recevoir, peser, nouveau colis et comptes s'ouvrent depuis « Colis ».
  colis: { route: 'colis', routes: ['colis', 'nouveau-colis', 'recevoir', 'peser', 'comptes'], libelle: 'Colis', icone: 'colis', onglet: true },
  envois: { route: 'envois', libelle: 'Envois', icone: 'camion', onglet: true },
  agences: { route: 'agences', libelle: 'Agences', icone: 'magasin', onglet: true },
  marche: { route: 'marche', libelle: 'Marché', icone: 'panier' }
};

/**
 * Entrées du menu : codes de actifs dans l'ordre de la base, puis ceux de lecture_seule (grisés), filtrés par le rôle.
 * Rien d'autre : un code absent de ces deux listes n'a aucune entrée dans la page.
 */
function sectionsVisibles() {
  const d = donneesModules();
  const actifs = d?.actifs || [];
  const codes = [...actifs.map((code) => [code, false]), ...(d?.lecture_seule || []).filter((c) => !actifs.includes(c)).map((code) => [code, true])];
  return codes.map(([code, lecture]) => ({ code, lecture, ...ECRANS[code] }))
    .filter((s) => s.route && !(s.dans && actifs.includes(s.dans)) && (!s.droit || peut(s.droit)));
}

/** Route de l'accueil : première entrée du menu (Aujourd'hui), sinon Paramètres (toujours ouvert). */
export function routeAccueil() {
  return sectionsVisibles().find((s) => !s.lecture)?.route || 'parametres';
}

/** Option payante pas encore payée (grisée avec un cadenas, mène à la page d'activation). */
function verrouillee(section) {
  return Boolean(section.code && enOption(section.code));
}

/** Barre du bas (téléphone) : l'accueil, puis les trois premiers modules d'usage courant que la base a activés. */
function onglets() {
  const visibles = sectionsVisibles().filter((s) => !s.lecture);
  return [...visibles.slice(0, 1), ...visibles.slice(1).filter((s) => s.onglet).slice(0, 3)];
}
const libelleOnglet = (s) => (s.code === 'stock' ? vocab('menu') : s.court || libelleSection(s));
/** Sections accessibles depuis « Plus » (celles absentes de la barre du bas). */
const routesBarreBas = () => onglets().map((o) => o.route);
const signatureBarre = () => onglets().map((o) => o.code).join(' ');
function barreBasHTML() {
  return `${onglets().map((o) => `
          <a href="#/${o.route}" class="onglet" data-route="${o.route}" ${o.routes ? `data-routes="${o.routes.join(' ')}"` : ''}>
            <span class="onglet-icone">${icone(o.icone, 21, 1.7)}</span><span data-ref="onglet-${esc(o.route)}">${esc(libelleOnglet(o))}</span>
          </a>`).join('')}
        <button type="button" class="onglet" data-action="plus" aria-haspopup="dialog">
          <span class="onglet-icone">${icone('menu', 21, 1.7)}</span>Plus
        </button>`;
}
/** Bouton rond : « Recevoir » si la base a activé les colis, « Vendre » si elle a activé la caisse, sinon aucun. */
const actionRonde = () => (aModule('colis') ? { lien: '#/recevoir', texte: 'Recevoir' } : aModule('caisse') ? { lien: '#/caisse?vendre=1', texte: 'Vendre' } : null);
const boutonRondHTML = () => `${icone('plus', 18, 2.8)}<span>${esc(actionRonde()?.texte || '')}</span>`;
const lienBoutonRond = () => actionRonde()?.lien || '#/';

/* ------------------------------------------------------------ Coquille */

/**
 * Construit (si besoin) la coquille, marque la page active et renvoie le conteneur de la vue.
 * pleinEcran : masque menus (caisse).
 */
export function preparerShell({ route, pleinEcran = false, lecture = null }) {
  let shell = document.querySelector('.shell');
  if (!shell || shell.dataset.boutique !== etat.boutique.id) {
    shell = construireShell();
  }
  shell.classList.toggle('plein', pleinEcran);
  bandeauModule(shell, lecture);
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
        <div class="menu-bas">${lienAide()}</div>
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
        <div data-zone="bandeau-module"></div>
        <main id="vue" tabindex="-1"></main>
      </div>

      <nav class="barre-bas" aria-label="Navigation" data-barre="${esc(signatureBarre())}">${barreBasHTML()}
      </nav>
      <a class="bouton-vendre" href="${lienBoutonRond()}" ${actionRonde() ? '' : 'hidden'}>${boutonRondHTML()}</a>
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
  return sectionsVisibles().map((s) => ({ route: s.route, libelle: libelleSection(s), icone: s.icone, lecture: s.lecture }));
}

/** Menu : les entrées de sectionsVisibles(), dans l'ordre de la base, sans rien ajouter. */
function menuHTML() {
  return sectionsVisibles().map(lienMenu).join('');
}

/** Aide YOUMMA : pas un module de la boutique, sous le menu avec la licence et la déconnexion. */
function lienAide() {
  return `
    <a href="#/aide" class="lien-menu" data-route="aide">${icone('aide', 17, 1.7)}<span class="lien-menu-libelle">Aide</span><span class="badge-commandes" data-ref="badge-aide"></span></a>`;
}

/** Bandeau d'un module en lecture seule (lecture_seule de la base) : on consulte, on n'ajoute plus. */
function bandeauModule(shell, code) {
  const zone = shell.querySelector('[data-zone="bandeau-module"]');
  if (!zone) return;
  const nom = code ? (infoModule(code)?.nom || ECRANS[code]?.libelle || code) : '';
  zone.innerHTML = code ? `<p class="bandeau-lecture-seule">${esc(nom)} n’est plus compris dans votre boutique : vous pouvez consulter ce qui existe, mais plus rien ajouter ni modifier.</p>` : '';
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
  // Modules changés (ou connus après la coquille) : barre du bas et bouton rond refaits.
  const barre = shell.querySelector('.barre-bas');
  if (barre && barre.dataset.barre !== signatureBarre()) {
    barre.innerHTML = barreBasHTML();
    barre.dataset.barre = signatureBarre();
  }
  const rond = shell.querySelector('.bouton-vendre');
  if (rond) { rond.href = lienBoutonRond(); rond.innerHTML = boutonRondHTML(); rond.hidden = !actionRonde(); }
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
function libelleSection(section) {
  // « Articles & stock » (« Modèles & stock » en habillement) ; « Menu », « Prestations » restent tels quels.
  if (section.route === 'stock') return vocab('menu') && vocab('menu') !== 'Stock' ? vocab('menu') : `${vocab('articles') || 'Articles'} & stock`;
  if (section.route === 'clients' && !moduleVisible('credits')) return 'Clients';
  // « Vendeurs » suit le vocabulaire de l'activité (activites.vocab.vendeurs, « Employés » pour le transit).
  if (section.route === 'vendeurs') return vocab('vendeurs') || section.libelle;
  return section.libelle;
}

function lienMenu(section) {
  return `
    <a href="#/${section.route}" class="lien-menu ${verrouillee(section) ? 'verrouille' : ''} ${section.lecture ? 'en-lecture' : ''}" data-route="${section.route}" data-module="${esc(section.code)}" ${section.routes ? `data-routes="${section.routes.join(' ')}"` : ''}>
      ${icone(section.icone, 17, 1.7)}
      <span class="lien-menu-libelle">${esc(libelleSection(section))}</span>
      ${section.soldeSms ? '<span class="badge-sms" data-ref="badge-sms" aria-label="SMS restants"></span>' : ''}
      ${section.badgeDevis ? '<span class="badge-commandes" data-ref="badge-devis"></span>' : ''}
      ${verrouillee(section) ? `<span class="cadenas-menu" title="Option à activer">${icone('cadenas', 14, 1.9)}<span class="sr-only">option à activer</span></span>` : section.badgeCommandes ? '<span class="badge-commandes" data-ref="badge-commandes"></span>' : ''}
      ${section.lecture ? '<span class="lecture-menu">lecture seule</span>' : ''}
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
        ${sections.map((s) => `
          <a href="#/${s.route}" class="plus-lien ${verrouillee(s) ? 'verrouille' : ''} ${s.lecture ? 'en-lecture' : ''}" data-module="${esc(s.code)}">
            ${icone(s.icone, 20, 1.7)}<span>${esc(libelleSection(s))}</span>
            ${s.badgeDevis ? '<span class="badge-commandes" data-ref="badge-devis"></span>' : ''}
            ${verrouillee(s) ? `<span class="cadenas-menu">${icone('cadenas', 14, 1.9)}<span class="sr-only">option à activer</span></span>` : s.badgeCommandes ? '<span class="badge-commandes" data-ref="badge-commandes"></span>' : ''}
            ${s.lecture ? '<span class="lecture-menu">lecture seule</span>' : ''}
          </a>`).join('')}
        <a href="#/aide" class="plus-lien">${icone('aide', 20, 1.7)}<span>Aide</span><span class="badge-commandes" data-ref="badge-aide"></span></a>
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
        <a class="btn btn-primaire" href="#/${routeAccueil()}">Retour à l’accueil</a>
      </section>
    </div>`;
}
