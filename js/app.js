/**
 * app.js — Point d'entrée : chargement de la session, table des routes,
 * protections d'accès (connexion, boutique) et enregistrement du service worker.
 */
import { sb, configurationValide } from './supabase.js';
import { etat, chargerSession, chargerBoutiques, viderEtat, peut } from './state.js';
import { demarrerRouteur, lireRoute, naviguer } from './router.js';
import { afficherConnexion, afficherInscription, deconnecter } from './auth.js';
import { afficherOnboarding } from './onboarding.js';
import { preparerShell, retirerShell, afficherBientot, SECTIONS } from './layout.js';
import { afficherAujourdhui } from './aujourdhui.js';
import { afficherCaisse } from './caisse.js';
import { afficherStock } from './stock.js';
import { afficherClients } from './clients.js';
import { afficherVentes } from './ventes.js';
import { afficherDepenses } from './depenses.js';
import { afficherVendeurs } from './vendeurs.js';
import { afficherRapports } from './rapports.js';
import { afficherParametres } from './parametres.js';
import { afficherChantiers } from './chantiers.js';
import { afficherMessages } from './messages.js';
import { afficherAide } from './aide.js';
import { afficherLicence } from './licence.js';
import { chargerEtatPlateforme, chargerEtatLicence, controlesApresConnexion, afficherMaintenance } from './plateforme.js';
import { afficherBoutiqueOnglets } from './boutique-onglets.js';
import { afficherProformas } from './proformas.js';
import { afficherReglagesDocuments } from './documents/reglages.js';
import { afficherIdentite } from './identite.js';
import { esc, logoComplet, messageErreur, fermerModales, toast } from './utils.js';
import { chargerModules, modulesPour, accesRoute } from './modules.js';
import { afficherMesModules } from './mes-modules.js';
import { estLogistique } from './modules.js';
import { afficherColisTableau } from './colis/tableau.js';
import { afficherNouveauColis } from './colis/nouveau.js';
import { afficherFicheColis } from './colis/fiche.js';
import { afficherEtiquettes } from './colis/etiquettes.js';
import { afficherEnvois } from './colis/envois.js';

/** Sur téléphone, une fiche (#/clients/<id>, #/ventes/<id>) s'ouvre en plein écran. */
const detailPleinEcran = (params) => params.has('id') && window.matchMedia('(max-width: 899.98px)').matches;
/** Accueil : « Colis » pour une boutique de logistique (étape 16), « Aujourd'hui » sinon. */
const routeAccueil = () => (estLogistique() ? 'colis' : 'aujourdhui');
/** #/colis (tableau), #/colis/<id> (fiche), #/colis/<id>/etiquette (étiquettes). */
function afficherColis(conteneur, params) {
  const id = params.get('id');
  if (!id) return afficherColisTableau(conteneur, params);
  if (params.get('vue') === 'etiquette') return afficherEtiquettes(conteneur, id, params);
  return afficherFicheColis(conteneur, id);
}

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
  aujourdhui: { vue: afficherAujourdhui },
  'tableau-de-bord': { redirection: () => 'aujourdhui' },
  // « Caisse & ventes » : onglets Caisse (#/caisse), Ventes (#/ventes), Livraisons (#/ventes?onglet=livraisons).
  caisse: { vue: afficherCaisse, pleinEcran: true },
  stock: { vue: afficherStock },
  clients: { vue: afficherClients, pleinEcran: detailPleinEcran },
  // Même logique pour le détail d'une vente (#/ventes/<id>).
  ventes: { vue: afficherVentes, pleinEcran: detailPleinEcran },
  depenses: { vue: afficherDepenses },
  vendeurs: { vue: afficherVendeurs, droit: 'equipe' },
  rapports: { vue: afficherRapports, droit: 'rapports' },
  parametres: { vue: afficherParametres },
  // #/chantiers, #/chantiers/<id>, #/chantiers/<id>/enlevement (plein écran sur téléphone), #/chantiers/<id>/releve
  chantiers: {
    vue: afficherChantiers,
    pleinEcran: (params) => params.get('vue') === 'enlevement' && window.matchMedia('(max-width: 899.98px)').matches
  },
  // #/messages (onglet dans l'adresse : #/messages/campagnes…), #/messages/campagne (nouvelle campagne)
  messages: { vue: afficherMessages, droit: 'messages.voir' },
  aide: { vue: afficherAide },
  licence: { vue: afficherLicence },
  // « Boutique en ligne » (étape 14) : onglets Commandes · Articles en ligne · Affiche du jour · Livraison & zones · Réglages.
  // #/boutique-en-ligne/<id> : détail d'une commande (en page sur téléphone).
  'boutique-en-ligne': { vue: afficherBoutiqueOnglets, droit: 'commandes.voir', pleinEcran: detailPleinEcran },
  commandes: { redirection: (params) => (params.get('id') ? `boutique-en-ligne/${encodeURIComponent(params.get('id'))}` : 'boutique-en-ligne') },
  affiche: { redirection: () => 'boutique-en-ligne?onglet=affiche' },
  // #/proformas (liste), #/proformas/nouveau, #/proformas/<id> (éditeur)
  proformas: { vue: afficherProformas, droit: 'devis.creer', pleinEcran: detailPleinEcran },
  // Paramètres → Documents (réglages des factures, reçus, devis)
  documents: { vue: afficherReglagesDocuments, droit: 'documents.reglages' },
  // Paramètres → Logo & images (logo, couverture, paiements, partenaires, miniatures)
  identite: { vue: afficherIdentite, droit: 'documents.reglages' },
  // Paramètres → Mes modules (gérant et propriétaire)
  modules: { vue: afficherMesModules, droit: 'parametres_boutique' },
  // Livraisons & camions (module « livraisons ») : onglet de « Caisse & ventes ».
  livraisons: { redirection: () => 'ventes?onglet=livraisons' },
  // Étape 16 — logistique de colis : accueil, nouveau colis, fiche, étiquettes, envois groupés.
  colis: { vue: afficherColis },
  'nouveau-colis': { vue: afficherNouveauColis },
  envois: { vue: afficherEnvois }
};
SECTIONS.filter((section) => !section.active).forEach((section) => {
  ROUTES[section.route] = { vue: (conteneur) => afficherBientot(conteneur, section) };
});

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
  const accueil = etat.boutique ? 'aujourdhui' : 'nouvelle-boutique';

  if (!route) return naviguer(etat.session ? accueil : 'connexion', { remplacer: true });
  if (route.publique && etat.session) return naviguer(accueil, { remplacer: true });
  if (!route.publique && !etat.session) return naviguer('connexion', { remplacer: true });
  if (!route.publique && !route.horsShell && !etat.boutique) return naviguer('nouvelle-boutique', { remplacer: true });
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
  // Boutique de logistique : « Aujourd'hui » devient « Colis » (sans message).
  if (!route.publique && !route.horsShell && etat.boutique && estLogistique() && nom === 'aujourdhui') return naviguer('colis', { remplacer: true });
  // Écran d'un module masqué (lien ancien, favori) : retour à l'accueil avec le message.
  if (!route.publique && !route.horsShell && accesRoute(nom) === 'refuse') {
    toast(messageErreur('MODULE_INACTIF'), 'erreur', 6000);
    return naviguer(routeAccueil(), { remplacer: true });
  }

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
    conteneur = preparerShell({ route: nom, pleinEcran });
  }
  const nettoyage = route.vue(conteneur, params);
  if (typeof nettoyage === 'function') nettoyerVue = nettoyage;
  return undefined;
}

/** Modules modifiés (choix, activité, rechargement) : on quitte un écran devenu inaccessible, on redessine l'accueil. */
window.addEventListener('modules:change', () => {
  if (!etat.boutique || !document.querySelector('.shell')) return;
  const nom = lireRoute().nom.split('/')[0];
  if (accesRoute(nom) === 'refuse') { toast(messageErreur('MODULE_INACTIF'), 'erreur', 6000); naviguer(routeAccueil(), { remplacer: true }); return; }
  if (nom === 'aujourdhui' || nom === 'colis') resoudre();
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

async function demarrer() {
  if (!configurationValide) {
    afficherAideConfiguration();
    return;
  }
  try {
    await chargerSession();
    if (etat.session) await chargerBoutiques();
    await Promise.all([chargerEtatPlateforme(), etat.boutique ? chargerEtatLicence() : null]);
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
