/**
 * direction/administration.js — Étape 26 : l'administration de la plateforme vient dans l'application.
 *
 * Les outils de l'ancienne page admin/ (js/admin/*.js) sont montés tels quels dans la coquille de direction, avec la
 * même signature qu'avant : afficher…(conteneur, { id, params, majCompteurs }). Une seule connexion : la session de
 * l'application. Réservés au super administrateur (moi().role), comme dans l'ancienne console.
 *
 * Trois outils ne reviennent pas, #/boutiques les remplace : « Toutes les boutiques » (sa fiche avancée est montée dans
 * la fiche de la boutique), « Boutiques en ligne » (couper / réactiver une vitrine : même endroit) et « Licences &
 * paiements » (paiements à valider : dans la fiche de chaque boutique, et la vue d'ensemble — formules, paiements à
 * valider, renouvellements, encaissements — sous les statistiques).
 * « Paramètres » de l'ancienne console s'appelle ici « Réglages » : « Paramètres » désigne déjà ceux d'une boutique.
 */
import { admin, rpc as rpcAdmin, premiere } from '../admin/commun.js';
import { cache, chargerAccueil, estSuperAdmin, moi } from './commun.js';
import { naviguer } from '../router.js';

/** Statistiques, puis la vue d'ensemble de l'argent (ancien outil « Licences & paiements »), sur la même page. */
async function statistiquesEtArgent() {
  const [{ afficherAccueil }, { afficherLicences }] = await Promise.all([import('../admin/accueil.js'), import('../admin/licences.js')]);
  return (conteneur, opts) => {
    conteneur.innerHTML = '<div data-zone="stats"></div><div class="dir-argent" data-zone="argent"></div>';
    afficherAccueil(conteneur.querySelector('[data-zone="stats"]'), opts);
    afficherLicences(conteneur.querySelector('[data-zone="argent"]'), opts);
  };
}
/** Les modules de l'ancienne console, chargés à la première ouverture (pas au démarrage de l'application). */
const module = (chemin, nom) => () => import(chemin).then((m) => m[nom]);

/**
 * Les outils, dans l'ordre de la navigation. pastille : clé de accueil().administration et sa couleur
 * (rouge : support ; ambre : SMS en file ; gris : un simple compte). Une valeur à 0 n'affiche rien.
 */
export const OUTILS = [
  { route: 'utilisateurs', libelle: 'Utilisateurs', icone: 'clients', vue: module('../admin/utilisateurs.js', 'afficherUtilisateurs'), pastilles: [['utilisateurs', 'gris']] },
  { route: 'sms', libelle: 'SMS & messages', icone: 'sms', vue: module('../admin/sms.js', 'afficherSms'), pastilles: [['sms_en_file', 'ambre'], ['sms_echecs', 'rouge']] },
  { route: 'annonces', libelle: 'Annonces', icone: 'document', vue: module('../admin/annonces.js', 'afficherAnnonces') },
  { route: 'fetes', libelle: 'Fêtes', icone: 'horloge', vue: module('../admin/fetes.js', 'afficherFetes') },
  { route: 'support', libelle: 'Support', icone: 'aide', vue: module('../admin/support.js', 'afficherSupport'), pastilles: [['support', 'rouge']] },
  { route: 'equipe', libelle: 'Équipe & journal', icone: 'vendeurs', vue: module('../admin/equipe.js', 'afficherEquipe') },
  { route: 'stockage', libelle: 'Stockage', icone: 'image', vue: module('../admin/stockage.js', 'afficherStockage') },
  { route: 'reglages', libelle: 'Réglages', icone: 'parametres', vue: module('../admin/parametres.js', 'afficherParametres') },
  { route: 'statistiques', libelle: 'Statistiques', icone: 'rapports', vue: statistiquesEtArgent, pastilles: [['paiements', 'ambre']] }
];

/** Pastilles d'un outil (ou de l'accès), lues dans accueil().administration ; rien pour une valeur à 0 ou absente. */
export function pastillesHTML(cles = []) {
  const a = cache.accueil?.administration || {};
  return cles.map(([cle, ton]) => {
    const n = Number(a[cle]) || 0;
    return n ? `<span class="dir-pastille-admin ${ton}" data-pastille="${cle}">${n}</span>` : '';
  }).join('');
}

/** Rafraîchit les pastilles après une action dans un outil (ancien majCompteurs) : accueil() relu, liens redessinés. */
export async function majCompteurs() {
  try { await chargerAccueil(); } catch { return null; }
  const { majLiens } = await import('./shell.js');
  majLiens();
  return cache.accueil?.administration || null;
}

/** Les outils lisent admin.moi (rôle) : admin_moi() une fois, à la première ouverture d'un outil. */
let moiCharge = null;
function assurerAdmin() {
  if (!moiCharge) {
    moiCharge = rpcAdmin('admin_moi').then(premiere).catch(() => null).then((m) => { admin.moi = m || { nom: moi().nom, role: moi().role }; });
  }
  return moiCharge;
}

/** Route de la direction pour un outil : réservé au super administrateur, sinon retour au tableau de bord. */
export function routeOutil(outil) {
  return (conteneur, params) => {
    if (!estSuperAdmin()) { naviguer('', { remplacer: true }); return undefined; }
    conteneur.innerHTML = '<div class="dir-page dir-page-admin"><span class="squelette" style="height:320px"></span></div>';
    let nettoyage = null;
    Promise.all([assurerAdmin(), outil.vue()]).then(([, vue]) => {
      if (!conteneur.isConnected) return;
      conteneur.innerHTML = '<div class="dir-page dir-page-admin" data-zone="outil"></div>';
      const r = vue(conteneur.querySelector('[data-zone="outil"]'), { id: params.get('id'), params, majCompteurs });
      if (typeof r === 'function') nettoyage = r;
    }).catch((err) => {
      if (!conteneur.isConnected) return;
      conteneur.innerHTML = '<div class="dir-page"><p class="bloc-erreur"></p></div>';
      conteneur.querySelector('.bloc-erreur').textContent = String(err?.message || err);
    });
    return () => nettoyage?.();
  };
}

/** Pour la fiche d'une boutique : les fonctions de l'ancien outil « Toutes les boutiques » ont besoin d'admin.moi. */
export const preparerAdmin = assurerAdmin;
