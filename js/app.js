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
import { afficherTableauDeBord } from './dashboard.js';
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
import { afficherCommandes } from './commandes.js';
import { afficherBoutiqueEnLigne } from './boutique-en-ligne.js';
import { afficherAfficheJour } from './affiche-jour.js';
import { afficherProformas } from './proformas.js';
import { afficherReglagesDocuments } from './documents/reglages.js';
import { afficherIdentite } from './identite.js';
import { esc, logoComplet, messageErreur, fermerModales, toast } from './utils.js';

/** Sur téléphone, une fiche (#/clients/<id>, #/ventes/<id>) s'ouvre en plein écran. */
const detailPleinEcran = (params) => params.has('id') && window.matchMedia('(max-width: 899.98px)').matches;

/**
 * publique : accessible sans connexion · horsShell : sans menu (onboarding)
 * pleinEcran : menu masqué (booléen, ou fonction des paramètres de la route)
 * droit : action requise (peut() dans state.js), sinon retour au tableau de bord
 * admin : réservée à l'équipe YOUMMA (est_admin_plateforme), sinon retour au tableau de bord
 */
const ROUTES = {
  connexion: { vue: afficherConnexion, publique: true },
  inscription: { vue: afficherInscription, publique: true },
  // Écran de choix : rejoindre avec un code ou créer sa boutique (?creer=1 : formulaire de création).
  'nouvelle-boutique': { vue: afficherOnboarding, horsShell: true },
  rejoindre: { vue: afficherOnboarding, horsShell: true },
  'tableau-de-bord': { vue: afficherTableauDeBord },
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
  // Panneau d'administration YOUMMA : page séparée admin/ (l'ancien écran #/admin y renvoie).
  admin: { vue: () => { location.href = 'admin/'; }, admin: true },
  aide: { vue: afficherAide },
  licence: { vue: afficherLicence },
  // #/commandes, #/commandes/<id> (détail en page sur téléphone)
  commandes: { vue: afficherCommandes, droit: 'commandes.voir', pleinEcran: detailPleinEcran },
  'boutique-en-ligne': { vue: afficherBoutiqueEnLigne, droit: 'boutique_en_ligne.gerer' },
  affiche: { vue: afficherAfficheJour, droit: 'affiche.partager' },
  // #/proformas (liste), #/proformas/nouveau, #/proformas/<id> (éditeur)
  proformas: { vue: afficherProformas, droit: 'devis.creer', pleinEcran: detailPleinEcran },
  // Paramètres → Documents (réglages des factures, reçus, devis)
  documents: { vue: afficherReglagesDocuments, droit: 'documents.reglages' },
  // Paramètres → Logo & images (logo, couverture, paiements, partenaires, miniatures)
  identite: { vue: afficherIdentite, droit: 'documents.reglages' }
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
  const accueil = etat.boutique ? 'tableau-de-bord' : 'nouvelle-boutique';

  if (!route) return naviguer(etat.session ? accueil : 'connexion', { remplacer: true });
  if (route.publique && etat.session) return naviguer(accueil, { remplacer: true });
  if (!route.publique && !etat.session) return naviguer('connexion', { remplacer: true });
  if (!route.publique && !route.horsShell && !etat.boutique) return naviguer('nouvelle-boutique', { remplacer: true });
  if (route.admin && !etat.adminPlateforme) return naviguer('tableau-de-bord', { remplacer: true });
  if (route.droit && !peut(route.droit)) {
    toast('Accès réservé au gérant.', 'erreur');
    return naviguer('tableau-de-bord', { remplacer: true });
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
