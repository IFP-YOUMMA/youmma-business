/**
 * app.js — Point d'entrée : chargement de la session, table des routes,
 * protections d'accès (connexion, boutique) et enregistrement du service worker.
 */
import { sb, configurationValide } from './supabase.js';
import { etat, chargerSession, chargerBoutiques, viderEtat, peut, chargerEntree, estDirection, routeEntree, dansBoutique, sortirDeBoutique } from './state.js';
import { preparerDirection } from './direction/shell.js';
import { OUTILS, routeOutil } from './direction/administration.js';
import { demarrerRouteur, lireRoute, naviguer } from './router.js';
import { afficherConnexion, afficherInscription, deconnecter } from './auth.js';
import { afficherOnboarding } from './onboarding.js';
import { preparerShell, retirerShell, routeAccueil, ecranModule } from './layout.js';
import { chargerEtatPlateforme, chargerEtatLicence, controlesApresConnexion, afficherMaintenance, verrouillerModule } from './plateforme.js';
import { esc, logoComplet, messageErreur, fermerModales, toast } from './utils.js';
import { chargerModules, modulesPour, accesRoute, moduleDeRoute, estLogistique, infoModule } from './modules.js';
import { chargerModes } from './modes-paiement.js';
import { reprendreDepannage } from './depannage.js';
import { surveillerUsage } from './installation.js';

/* ------------------------------------------------------------ Écrans différés (étape 28) */

/**
 * Un écran se charge à sa première ouverture : chargeur → promesse de la vue. Le module reste ensuite en mémoire
 * (prete() renvoie la vue sans attendre : une seconde ouverture est immédiate). Un échec n'est pas retenu : le
 * prochain essai repart de zéro, avec une adresse neuve (« ?r=1 », « ?r=2 »…) — le navigateur garde en mémoire un module
 * dont le téléchargement a échoué et refuserait sinon de le redemander, même une fois le réseau revenu.
 */
function differe(charger) {
  let vue = null;
  let enCours = null;
  let echecs = 0;
  const chargeur = () => {
    if (vue) return Promise.resolve(vue);
    if (!enCours) enCours = charger(echecs ? `?r=${echecs}` : '').then((v) => { vue = v; return v; }, (err) => { enCours = null; echecs++; throw err; });
    return enCours;
  };
  chargeur.prete = () => vue;
  chargeur.echecs = () => echecs;
  return chargeur;
}
/** Écran d'un module : ecran((q) => import('./caisse.js' + q), 'afficherCaisse') — q : suffixe d'un nouvel essai. */
const ecran = (importer, nom) => differe((q) => importer(q).then((m) => m[nom]));
/** Écrans de la direction rangés dans direction/portes.js (fiche, création, accès…). */
const porte = (nom) => ecran((q) => import('./direction/portes.js' + q), nom);

/** Sur téléphone, une fiche (#/clients/<id>, #/ventes/<id>) s'ouvre en plein écran. */
const detailPleinEcran = (params) => params.has('id') && window.matchMedia('(max-width: 899.98px)').matches;
/** #/colis (tableau), #/colis/<id> (fiche), #/colis/<id>/etiquette (étiquettes) : les trois vues, chargées ensemble. */
const afficherColis = differe(async (q) => {
  const [t, e, f] = await Promise.all([import('./colis/tableau.js' + q), import('./colis/etiquettes.js' + q), import('./colis/fiche.js' + q)]);
  return (conteneur, params) => {
    const id = params.get('id');
    if (!id) return t.afficherColisTableau(conteneur, params);
    if (params.get('vue') === 'etiquette') return e.afficherEtiquettes(conteneur, id, params);
    return f.afficherFicheColis(conteneur, id);
  };
});

/**
 * publique : accessible sans connexion · horsShell : sans menu (onboarding)
 * pleinEcran : menu masqué (booléen, ou fonction des paramètres de la route)
 * droit : action requise (peut() dans state.js), sinon retour au tableau de bord
 * redirection : ancienne adresse → nouvelle (étape 14), avec les paramètres de la route
 */
const ROUTES = {
  connexion: { vue: afficherConnexion, publique: true },
  inscription: { vue: afficherInscription, publique: true },
  // Écran de choix : rejoindre avec un code ou créer sa boutique (?creer=1 : formulaire de création).
  'nouvelle-boutique': { vue: afficherOnboarding, horsShell: true },
  rejoindre: { vue: afficherOnboarding, horsShell: true },
  // Écran « Aujourd'hui » (étape 14) ; l'ancien tableau de bord y renvoie.
  aujourdhui: { vue: ecran((q) => import('./aujourdhui.js' + q), 'afficherAujourdhui') },
  'tableau-de-bord': { redirection: () => 'aujourdhui' },
  // « Caisse & ventes » : onglets Caisse (#/caisse), Ventes (#/ventes), Livraisons (#/ventes?onglet=livraisons).
  caisse: { vue: ecran((q) => import('./caisse.js' + q), 'afficherCaisse'), pleinEcran: true },
  stock: { vue: ecran((q) => import('./stock.js' + q), 'afficherStock') },
  clients: { vue: ecran((q) => import('./clients.js' + q), 'afficherClients'), pleinEcran: detailPleinEcran },
  // Même logique pour le détail d'une vente (#/ventes/<id>).
  ventes: { vue: ecran((q) => import('./ventes.js' + q), 'afficherVentes'), pleinEcran: detailPleinEcran },
  depenses: { vue: ecran((q) => import('./depenses.js' + q), 'afficherDepenses') },
  vendeurs: { vue: ecran((q) => import('./vendeurs.js' + q), 'afficherVendeurs'), droit: 'equipe' },
  rapports: { vue: ecran((q) => import('./rapports.js' + q), 'afficherRapports'), droit: 'rapports' },
  parametres: { vue: ecran((q) => import('./parametres.js' + q), 'afficherParametres') },
  // #/chantiers, #/chantiers/<id>, #/chantiers/<id>/enlevement (plein écran sur téléphone), #/chantiers/<id>/releve
  chantiers: {
    vue: ecran((q) => import('./chantiers.js' + q), 'afficherChantiers'),
    pleinEcran: (params) => params.get('vue') === 'enlevement' && window.matchMedia('(max-width: 899.98px)').matches
  },
  // #/messages (onglet dans l'adresse : #/messages/campagnes…), #/messages/campagne (nouvelle campagne)
  messages: { vue: ecran((q) => import('./messages.js' + q), 'afficherMessages'), droit: 'messages.voir' },
  aide: { vue: ecran((q) => import('./aide.js' + q), 'afficherAide') },
  licence: { vue: ecran((q) => import('./licence.js' + q), 'afficherLicence') },
  // « Boutique en ligne » (étape 14) : onglets Commandes · Articles en ligne · Affiche du jour · Livraison & zones · Réglages.
  // #/boutique-en-ligne/<id> : détail d'une commande (en page sur téléphone).
  'boutique-en-ligne': { vue: ecran((q) => import('./boutique-onglets.js' + q), 'afficherBoutiqueOnglets'), droit: 'commandes.voir', pleinEcran: detailPleinEcran },
  commandes: { redirection: (params) => (params.get('id') ? `boutique-en-ligne/${encodeURIComponent(params.get('id'))}` : 'boutique-en-ligne') },
  affiche: { redirection: () => 'affiches' },
  // Étape 15b — l'affiche du jour a sa route (module « affiche »), hors de la boutique en ligne.
  affiches: { vue: ecran((q) => import('./affiche-jour.js' + q), 'afficherAfficheJour'), droit: 'affiche.partager' },
  // #/proformas (liste), #/proformas/nouveau, #/proformas/<id> (éditeur)
  proformas: { vue: ecran((q) => import('./proformas.js' + q), 'afficherProformas'), droit: 'devis.creer', pleinEcran: detailPleinEcran },
  // Paramètres → Documents (réglages des factures, reçus, devis)
  documents: { vue: ecran((q) => import('./documents/reglages.js' + q), 'afficherReglagesDocuments'), droit: 'documents.reglages' },
  // Paramètres → Logo & images (logo, couverture, paiements, partenaires, miniatures)
  identite: { vue: ecran((q) => import('./identite.js' + q), 'afficherIdentite'), droit: 'documents.reglages' },
  // Paramètres → Mes modules (gérant et propriétaire)
  modules: { vue: ecran((q) => import('./mes-modules.js' + q), 'afficherMesModules'), droit: 'parametres_boutique' },
  // Livraisons & camions (module « livraisons ») : onglet de « Caisse & ventes ».
  livraisons: { redirection: () => 'ventes?onglet=livraisons' },
  // Étape 16 — logistique de colis : accueil, nouveau colis, fiche, étiquettes, envois groupés.
  colis: { vue: afficherColis },
  'nouveau-colis': { vue: ecran((q) => import('./colis/nouveau.js' + q), 'afficherNouveauColis') },
  envois: { vue: ecran((q) => import('./colis/envois.js' + q), 'afficherEnvois') },
  // Étape 18 — transit : accueil des corridors, réception au nom d'un compte, pesée au téléphone, comptes commerçants.
  transit: { vue: ecran((q) => import('./colis/transit.js' + q), 'afficherTransit') },
  recevoir: { vue: ecran((q) => import('./colis/reception.js' + q), 'afficherReception') },
  peser: { vue: differe((q) => import('./colis/reception.js' + q).then((m) => (conteneur, params) => m.afficherPesee(conteneur, params.get('id')))) },
  comptes: { vue: ecran((q) => import('./colis/comptes.js' + q), 'afficherComptes') },
  // Étape 18f — modules « agences » et « marche » du menu de la logistique.
  agences: { vue: ecran((q) => import('./colis/reglages.js' + q), 'afficherAgences') },
  // Étape 21 — le marché : bureau de Conakry (commandes, versements, fournisseurs, expédition) et règlements.
  marche: { vue: ecran((q) => import('./marche/bureau.js' + q), 'afficherMarche') }
};

/**
 * Étape 20 — tableau de bord de direction (mon_entree → « direction ») : #/ et ses portes, dans leur coquille.
 * Les écrans de boutique ne s'ouvrent qu'après être entré par une porte (dansBoutique) ; sinon retour à #/.
 */
const ROUTES_DIRECTION = {
  // Étape 26 : un seul tableau de bord (accueil()), une seule liste de boutiques, l'administration au même endroit.
  '': differe((q) => import('./direction/tableau.js' + q).then((m) => (conteneur) => { sortirDeBoutique(); return m.afficherTableau(conteneur); })),
  boutiques: ecran((q) => import('./direction/boutiques.js' + q), 'afficherListeBoutiques'), // #/boutiques, #/boutiques/nouvelle, #/boutiques/<id> → fiche
  fiche: porte('afficherFicheDirection'),
  terrain: porte('afficherTerrainDirection'),
  acces: porte('afficherAccesDirection'),
  espace: porte('afficherEspaceDirection'),
  chercher: porte('afficherRechercheDirection'),
  recherche: porte('afficherRechercheDirection'),
  // Hors navigation : écrans de l'ancienne porte logistique, encore visés par des décisions (« Peser », « Payer »).
  'marche-monde': porte('afficherMarcheMonde'),
  // Outils de l'administration (super administrateur), montés dans cette coquille : une seule connexion.
  ...Object.fromEntries(OUTILS.map((o) => [o.route, routeOutil(o)])),
  // Anciens liens : l'accueil de la console est #/ ; licences et paiements vivent sous les statistiques.
  accueil: () => naviguer('', { remplacer: true }),
  licences: () => naviguer('statistiques', { remplacer: true })
};

/* ------------------------------------------------------------ Chargement d'un écran (étape 28) */

let jetonNavigation = 0;
const DELAI_INDICATEUR = 150;

/** Zone de l'écran courant : le contenu de la coquille (#vue), sinon la page entière (#app). */
const zoneEcran = () => document.getElementById('vue') || document.getElementById('app');

/**
 * Charge la vue d'un écran, puis rappelle suite(). L'écran précédent reste affiché pendant le chargement ; au-delà de
 * 150 ms, un indicateur discret prend la place du contenu (masqué, pas retiré). En cas d'échec (réseau tombé entre deux
 * écrans), le contenu précédent revient avec « Réessayer » : jamais de page vide. Une navigation plus récente annule
 * celle-ci ; un second appui sur « Réessayer » repart proprement (le bouton est retiré dès le premier appui).
 */
function chargerPuis(chargeur, suite) {
  const jeton = ++jetonNavigation;
  const zone = zoneEcran();
  zone?.querySelector(':scope > .echec-ecran')?.remove();
  const minuterie = setTimeout(() => {
    if (jeton !== jetonNavigation || !zone?.isConnected) return;
    zone.classList.add('vue-attente');
    if (!zone.querySelector(':scope > .chargement-ecran')) zone.insertAdjacentHTML('afterbegin', '<div class="chargement-ecran" role="status"><span class="spinner" aria-hidden="true"></span>Chargement…</div>');
  }, DELAI_INDICATEUR);
  const nettoyer = () => {
    clearTimeout(minuterie);
    zone?.classList.remove('vue-attente');
    zone?.querySelector(':scope > .chargement-ecran')?.remove();
  };
  chargeur().then(() => {
    if (jeton !== jetonNavigation) return;
    nettoyer();
    suite();
  }, (err) => {
    if (jeton !== jetonNavigation) return;
    nettoyer();
    console.warn('[YOUMMA] Écran non chargé :', err?.message || err);
    const cible = zone?.isConnected ? zone : zoneEcran();
    if (!cible) return;
    cible.insertAdjacentHTML('afterbegin', `<div class="echec-ecran" role="alert"><span>Cet écran n’a pas pu se charger.</span><button type="button" class="btn btn-secondaire btn-petit" data-reessayer-ecran>Réessayer</button></div>`);
    const bandeau = cible.querySelector(':scope > .echec-ecran');
    // Un module voisin déjà tombé (une dépendance de l'écran) reste refusé par le navigateur jusqu'au rechargement :
    // après un nouvel essai manqué, réseau présent, « Réessayer » recharge la page sur la même adresse.
    const recharger = chargeur.echecs() >= 2 && navigator.onLine;
    bandeau.querySelector('[data-reessayer-ecran]').addEventListener('click', () => {
      if (recharger) { location.reload(); return; }
      bandeau.remove();
      chargerPuis(chargeur, suite);
    }, { once: true });
  });
}

/** Vue prête tout de suite (module déjà en mémoire, ou écran non différé), sinon null. */
const vuePrete = (vue) => (typeof vue?.prete === 'function' ? vue.prete() : vue);

function afficherDirection(nom, vue, params) {
  const prete = vuePrete(vue);
  if (!prete) { chargerPuis(vue, () => resoudre()); return; }
  jetonNavigation++;
  nettoyerVue?.();
  nettoyerVue = null;
  fermerModales();
  verrouillerModule(false);
  const conteneur = preparerDirection(nom);
  const nettoyage = prete(conteneur, params);
  if (typeof nettoyage === 'function') nettoyerVue = nettoyage;
}

/** Pages d'un module à acheter (cadenas) et d'activation de la boutique en ligne, chargées au besoin. */
const pagesAAcheter = differe(async (q) => {
  const [a, o] = await Promise.all([import('./module-a-acheter.js' + q), import('./option-boutique.js' + q)]);
  return { afficherModuleAAcheter: a.afficherModuleAAcheter, afficherActivationOption: o.afficherActivationOption, CODE_OPTION: o.CODE_OPTION };
});

/** Écrans qui gèrent eux-mêmes leur lecture seule (chantiers : on peut encore encaisser un versement). */
const LECTURE_GEREE = ['chantiers'];

let nettoyerVue = null;

/** Affiche la page correspondant au hash courant, après les contrôles d'accès. */
function resoudre() {
  const lu = lireRoute();
  // « clients/<id> » → route « clients » avec le paramètre id ; « chantiers/<id>/releve » → en plus vue=releve.
  const [nom, identifiant, sousVue] = lu.nom.split('/');
  const params = lu.params;
  if (identifiant) params.set('id', decodeURIComponent(identifiant));
  if (sousVue) params.set('vue', sousVue);
  const route = ROUTES[nom];
  const accueil = routeEntree();

  // Étape 20 : la direction arrive sur #/ ; un gérant ou un vendeur ne voit jamais ces écrans.
  const routeDirection = Object.prototype.hasOwnProperty.call(ROUTES_DIRECTION, nom) ? ROUTES_DIRECTION[nom] : null;
  if (etat.session && estDirection()) {
    if (routeDirection) return afficherDirection(nom, routeDirection, params);
    if (!route || (!route.publique && !route.horsShell && (!etat.boutique || dansBoutique() !== etat.boutique.id))) return naviguer('', { remplacer: true });
  } else if (routeDirection) return naviguer(etat.session ? accueil : 'connexion', { remplacer: true });

  if (!route) return naviguer(etat.session ? accueil : 'connexion', { remplacer: true });
  if (route.publique && etat.session) return naviguer(accueil, { remplacer: true });
  if (!route.publique && !etat.session) return naviguer('connexion', { remplacer: true });
  if (!route.publique && !route.horsShell && !etat.boutique) return naviguer('rejoindre', { remplacer: true });
  if (route.redirection) return naviguer(route.redirection(params), { remplacer: true });
  if (route.droit && !peut(route.droit)) {
    toast('Accès réservé au gérant.', 'erreur');
    return naviguer('aujourdhui', { remplacer: true });
  }
  // Modules de la boutique : connus avant d'afficher un écran (copie locale immédiate, sinon réseau).
  if (!route.publique && !route.horsShell && etat.boutique && !modulesPour(etat.boutique.id)) {
    chargerModules(etat.boutique.id, { annoncer: false }).then(() => resoudre());
    return undefined;
  }
  // Boutique de logistique : « Aujourd'hui » devient celui du transit (sans message).
  if (!route.publique && !route.horsShell && etat.boutique && estLogistique() && nom === 'aujourdhui') return naviguer('transit', { remplacer: true });
  // Écran d'un module masqué (lien ancien, favori) : retour à l'accueil avec le message.
  if (!route.publique && !route.horsShell && accesRoute(nom) === 'refuse') {
    toast(messageErreur('MODULE_INACTIF'), 'erreur', 6000);
    return naviguer(routeAccueil(), { remplacer: true });
  }

  // Étape 28 : la vue (et, pour un module à acheter, sa page) est chargée avant de toucher à l'écran courant.
  const acces = route.publique || route.horsShell ? 'ok' : accesRoute(nom);
  const aAcheter = acces === 'formule' || (acces === 'option' && nom !== 'boutique-en-ligne');
  const chargeur = aAcheter ? pagesAAcheter : route.vue;
  const prete = vuePrete(chargeur);
  if (!prete) { chargerPuis(chargeur, () => resoudre()); return undefined; }
  jetonNavigation++;

  nettoyerVue?.();
  nettoyerVue = null;
  fermerModales();

  let conteneur;
  if (route.publique || route.horsShell) {
    retirerShell();
    conteneur = document.getElementById('app');
    window.scrollTo(0, 0);
  } else {
    const pleinEcran = typeof route.pleinEcran === 'function' ? route.pleinEcran(params) : Boolean(route.pleinEcran);
    // Module dans lecture_seule : l'écran s'ouvre, avec un bandeau et sans ses boutons d'écriture.
    const lecture = accesRoute(nom) === 'lecture' && !LECTURE_GEREE.includes(nom) ? moduleDeRoute(nom) : null;
    conteneur = preparerShell({ route: nom, pleinEcran, lecture });
    verrouillerModule(Boolean(lecture));
  }
  // Module à acheter (cadenas) : la page qui dit ce qu'il apporte et ce qu'il coûte. La boutique en ligne a la sienne.
  if (aAcheter) {
    const { afficherModuleAAcheter, afficherActivationOption, CODE_OPTION } = prete;
    // Module qui dépend de la vitrine (l'affiche) : la page d'activation de la boutique en ligne.
    if (acces === 'option' && infoModule(moduleDeRoute(nom))?.depend_de === CODE_OPTION) return afficherActivationOption(conteneur);
    afficherModuleAAcheter(conteneur, moduleDeRoute(nom), ecranModule(moduleDeRoute(nom)) || {});
    return undefined;
  }
  const nettoyage = prete(conteneur, params);
  if (typeof nettoyage === 'function') nettoyerVue = nettoyage;
  return undefined;
}

/** Modules modifiés (choix, activité, rechargement) : on quitte un écran devenu inaccessible, on redessine l'accueil. */
window.addEventListener('modules:change', () => {
  if (!etat.boutique || !document.querySelector('.shell') || document.querySelector('.dir-shell')) return;
  const nom = lireRoute().nom.split('/')[0];
  if (accesRoute(nom) === 'refuse') { toast(messageErreur('MODULE_INACTIF'), 'erreur', 6000); naviguer(routeAccueil(), { remplacer: true }); return; }
  if (nom === 'aujourdhui' || nom === 'colis' || nom === 'transit') resoudre();
  // Option payée ou terminée pendant qu'on regarde la boutique en ligne : onglets ↔ page d'activation.
  else if (nom === 'boutique-en-ligne' && (accesRoute(nom) === 'option') !== Boolean(document.querySelector('.page-option'))) resoudre();
});

/** Écran affiché tant que js/config.js n'est pas rempli. */
function afficherAideConfiguration() {
  document.getElementById('app').innerHTML = `
    <div class="ecran-auth">
      ${logoComplet('sombre')}
      <div class="carte-auth">
        <div class="auth-titres">
          <h1>Configuration requise</h1>
          <p>Renseignez <strong>SUPABASE_URL</strong> et <strong>SUPABASE_ANON_KEY</strong> dans le fichier <code>js/config.js</code>, puis rechargez la page.</p>
        </div>
      </div>
    </div>`;
}

/** Écran d'erreur au démarrage (souvent : pas de réseau). */
function afficherErreurDemarrage(message) {
  document.getElementById('app').innerHTML = `
    <div class="ecran-auth">
      ${logoComplet('sombre')}
      <div class="carte-auth">
        <div class="auth-titres">
          <h1>Connexion impossible</h1>
          <p>${esc(message)}</p>
        </div>
        <button type="button" class="btn btn-primaire btn-bloc btn-grand" data-action="reessayer">Réessayer</button>
        <button type="button" class="btn btn-secondaire btn-bloc" data-action="deconnexion">Se déconnecter</button>
      </div>
    </div>`;
  document.querySelector('[data-action="reessayer"]').addEventListener('click', () => location.reload());
  document.querySelector('[data-action="deconnexion"]').addEventListener('click', async () => {
    await deconnecter();
    location.reload();
  });
}

/** Vrai si l'on travaille dans une boutique (la direction seulement après y être entrée par une porte). */
const dansUneBoutique = () => Boolean(etat.boutique) && (!estDirection() || dansBoutique() === etat.boutique.id);

async function demarrer() {
  if (!configurationValide) {
    afficherAideConfiguration();
    return;
  }
  try {
    await chargerSession();
    if (etat.session) await chargerBoutiques();
    if (etat.session) await chargerEntree(); // étape 20 : direction, boutique ou aucune
    if (etat.session && estDirection() && dansBoutique()) await reprendreDepannage(dansBoutique()); // page rechargée pendant un dépannage
    await Promise.all([chargerEtatPlateforme(), dansUneBoutique() ? chargerEtatLicence() : null]);
  } catch (err) {
    afficherErreurDemarrage(messageErreur(err));
    return;
  }
  // Maintenance (sauf équipe YOUMMA) et mot de passe provisoire : écrans bloquants avant l'appli.
  if (etat.plateforme?.maintenance && !etat.session) {
    afficherMaintenance(document.getElementById('app'), { continuer: () => demarrerRouteur(resoudre) });
    return;
  }
  if (await controlesApresConnexion(() => location.reload())) return;

  // « Dernier usage » de la console de direction : un ping au chargement, pas à chaque écran (la base n'écrit que
  // toutes les 20 minutes). Sans attendre ni bloquer : une erreur ici ne doit jamais empêcher l'appli de s'ouvrir.
  if (dansUneBoutique()) sb.rpc('ping_boutique', { p_boutique: etat.boutique.id }).then(() => {}, () => {});
  // Modes de paiement de la caisse et des remboursements, gardés pour les écrans (et hors ligne).
  if (dansUneBoutique()) ['vente', 'credit'].forEach((usage) => chargerModes(usage));
  // Espace de travail : invitation à installer au troisième jour d'utilisation (jamais sur les pages publiques).
  if (etat.session) setTimeout(surveillerUsage, 4000);

  sb.auth.onAuthStateChange((evenement, session) => {
    if (evenement === 'SIGNED_OUT') {
      if (!etat.session) return;
      viderEtat();
      retirerShell();
      naviguer('connexion', { remplacer: true });
    } else if (session) {
      etat.session = session;
    }
  });

  demarrerRouteur(resoudre);
}

function enregistrerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const enregistrer = () => navigator.serviceWorker.register('./sw.js')
    .catch((err) => console.warn('[YOUMMA] Service worker non enregistré :', err));
  // Le module peut finir de charger après l'événement « load » (import du CDN Supabase) :
  // dans ce cas, on enregistre tout de suite.
  if (document.readyState === 'complete') enregistrer();
  else window.addEventListener('load', enregistrer);
}

enregistrerServiceWorker();
demarrer();
