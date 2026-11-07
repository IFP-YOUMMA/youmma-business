/**
 * admin/app.js — Console de direction YOUMMA (admin/index.html), étape 19. Remplace le panneau d'administration.
 *
 * Même compte que l'appli (téléphone + mot de passe). Accès : console_accueil() répond. Tout ce que la console montre
 * part de cette réponse : le menu, les portes et les routes sont construits à partir des espaces qu'elle renvoie, jamais
 * d'une liste écrite ici. Un associé (admin_espace) n'a qu'un espace : la porte des licences n'existe pas, la page des
 * accès non plus, et aucune route ne tente d'appel sur un espace qu'il ne voit pas.
 *
 * Routes : #/accueil, #/espace/<code>, #/fiche/<id>, #/acces, #/terrain?espace=<code>, #/recherche?q=, #/bientot/<quoi>.
 * Outils (super administrateur seulement) : les rubriques de l'ancien panneau, gardées telles quelles
 * (#/statistiques, #/boutiques, #/licences, #/utilisateurs, #/sms, …).
 */
import { sb, configurationValide } from '../supabase.js';
import { esc, icone, logoComplet, logoSymbole, normaliserTelephone, emailDepuisTelephone, boutonOccupe, messageErreur, fermerModales } from '../utils.js';
import { admin, rpc, premiere, champ, telLocal, urlAppli, erreurAdmin } from './commun.js';
import { direction, moi, espaces, espace, peutGererAcces, estSuperAdmin, erreurConsole, montrerLiensMarche } from './console/commun.js';
import { afficherAccueilDirection } from './console/accueil.js';
import { afficherEspace } from './console/espace.js';
import { afficherFiche } from './console/fiche.js';
import { afficherAcces } from './console/acces.js';
import { afficherTerrain } from './console/terrain.js';
import { afficherRecherche, afficherBientot } from './console/recherche.js';
import { afficherAccueil } from './accueil.js';
import { afficherBoutiques } from './boutiques.js';
import { afficherLicences } from './licences.js';
import { afficherUtilisateurs } from './utilisateurs.js';
import { afficherSms } from './sms.js';
import { afficherVitrines } from './vitrines.js';
import { afficherAnnonces } from './annonces.js';
import { afficherSupport } from './support.js';
import { afficherEquipe } from './equipe.js';
import { afficherParametres } from './parametres.js';
import { afficherStockage } from './stockage.js';
import { afficherFetes } from './fetes.js';
import { chargerModes } from '../modes-paiement.js';

const racine = document.getElementById('admin');

/** Outils de l'ancien panneau (super administrateur seulement). compteur : clé de a_traiter (admin_stats). */
const OUTILS = [
  { route: 'statistiques', libelle: 'Statistiques', icone: 'M4 20V10M10 20V4M16 20v-7M22 20H2', vue: afficherAccueil },
  { route: 'boutiques', libelle: 'Toutes les boutiques', icone: 'M4 10h16l-1-5H5zM5 10v10h14V10M9 20v-5h6v5', vue: afficherBoutiques },
  { route: 'licences', libelle: 'Licences & paiements', icone: 'M3 7h18v12H3zM3 11h18M7 15h4', vue: afficherLicences, compteur: 'paiements_a_valider' },
  { route: 'utilisateurs', libelle: 'Utilisateurs', icone: 'M16 20v-2a4 4 0 0 0-8 0v2M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', vue: afficherUtilisateurs },
  { route: 'sms', libelle: 'SMS & messages', icone: 'M4 5h16v11H8l-4 4z', vue: afficherSms },
  { route: 'vitrines', libelle: 'Boutiques en ligne', icone: 'M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', vue: afficherVitrines },
  { route: 'annonces', libelle: 'Annonces', icone: 'M3 11v2l13 5V6zM16 8a4 4 0 0 1 0 8M7 13l1 6h3l-1-5', vue: afficherAnnonces },
  { route: 'support', libelle: 'Support', icone: 'M12 21a9 9 0 1 0-9-9c0 1.6.4 3 1.1 4.3L3 21l4.7-1.1A9 9 0 0 0 12 21zM9 10a3 3 0 1 1 4 2.8V14M12 17h.01', vue: afficherSupport, compteur: 'support_ouvertes' },
  { route: 'equipe', libelle: 'Équipe & journal', icone: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 11a3 3 0 1 0 0-6M3 20v-1a5 5 0 0 1 10 0v1M15 14a5 5 0 0 1 6 5v1', vue: afficherEquipe },
  { route: 'fetes', libelle: 'Fêtes', icone: 'M4 7h16v13H4zM4 11h16M9 3v6M15 3v6', vue: afficherFetes },
  { route: 'stockage', libelle: 'Stockage', icone: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6', vue: afficherStockage },
  { route: 'parametres', libelle: 'Paramètres', icone: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4', vue: afficherParametres }
];
const svg = (d, taille = 17) => `<svg width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"></path></svg>`;

/** Écrans de la console. garde : la route n'existe que si elle renvoie vrai (sinon retour à l'accueil, sans appel). */
const CONSOLE = {
  accueil: { titre: () => 'Direction', vue: afficherAccueilDirection },
  espace: { titre: (id) => espace(id)?.nom_public || 'Espace', vue: afficherEspace, garde: (id) => Boolean(espace(id)) },
  fiche: { titre: () => 'Fiche', vue: afficherFiche, garde: (id) => Boolean(id) },
  acces: { titre: () => 'Les accès', vue: afficherAcces, garde: () => peutGererAcces() },
  terrain: { titre: () => 'Nouveau sur le terrain', vue: afficherTerrain, garde: (id, params) => Boolean(espace(params.get('espace')) || espaces().length) },
  recherche: { titre: () => 'Recherche', vue: afficherRecherche },
  bientot: { titre: () => 'Bientôt', vue: afficherBientot }
};

/* ------------------------------------------------------------ Connexion */

function afficherConnexion(message = '') {
  racine.innerHTML = `
    <div class="ecran-auth">
      <div class="adm-logo-auth">${logoComplet('sombre')}<span>DIRECTION</span></div>
      <div class="carte-auth">
        <div class="auth-titres"><h1>Connexion à la console</h1><p>Même compte que l’appli : téléphone et mot de passe.</p></div>
        <form class="form-auth" novalidate>
          <div class="champ"><label for="adm-tel">Téléphone</label><input id="adm-tel" name="telephone" class="input" type="tel" inputmode="tel" autocomplete="username" placeholder="620 00 00 00" required></div>
          <div class="champ"><label for="adm-mdp">Mot de passe</label><input id="adm-mdp" name="mdp" class="input" type="password" autocomplete="current-password" required></div>
          <p class="erreur-form" role="alert" ${message ? '' : 'hidden'}>${esc(message)}</p>
          <button type="submit" class="btn btn-primaire btn-bloc btn-grand">Se connecter</button>
        </form>
        <a class="btn-lien" href="${esc(urlAppli())}">Retour à l’appli des boutiques</a>
      </div>
    </div>`;
  const form = racine.querySelector('form');
  const zoneErreur = form.querySelector('.erreur-form');
  form.telephone.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const telephone = normaliserTelephone(form.telephone.value);
    if (!telephone) { zoneErreur.textContent = 'Numéro invalide. Exemple : 620 00 00 00 ou 77 123 45 67.'; zoneErreur.hidden = false; return; }
    const bouton = form.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Connexion…');
    const { error } = await sb.auth.signInWithPassword({ email: emailDepuisTelephone(telephone), password: form.mdp.value });
    boutonOccupe(bouton, false);
    if (error) { zoneErreur.textContent = messageErreur(error); zoneErreur.hidden = false; return; }
    demarrer();
  });
}

function afficherAccesRefuse() {
  racine.innerHTML = `
    <div class="ecran-auth">
      <div class="adm-logo-auth">${logoComplet('sombre')}<span>DIRECTION</span></div>
      <div class="carte-auth">
        <div class="auth-titres"><h1>Accès réservé à la direction</h1><p>Ce compte n’a pas accès à la console.</p></div>
        <a class="btn btn-primaire btn-bloc btn-grand" href="${esc(urlAppli())}">Ouvrir l’appli des boutiques</a>
        <button type="button" class="btn btn-secondaire btn-bloc" data-action="deconnexion">Se déconnecter</button>
      </div>
    </div>`;
  racine.querySelector('[data-action="deconnexion"]').addEventListener('click', async () => { await sb.auth.signOut(); afficherConnexion(); });
}

/* ------------------------------------------------------------ Coquille */

const ROLES = { super_admin: 'Super administrateur', admin_espace: 'Administrateur', agent: 'Agent' };

/** Menu construit à partir des espaces de console_accueil() : un groupe par espace, ses portes selon sa facturation. */
function menuEspaces() {
  return espaces().map((e) => {
    const vendeurs = e.facturation === 'commission';
    return `<div class="adm-groupe cs-groupe" style="--cs-couleur:${esc(e.couleur)}">
      <span class="adm-groupe-titre"><span class="cs-point" style="background:${esc(e.couleur)}"></span>${esc(e.nom_public)}</span>
      <a href="#/espace/${encodeURIComponent(e.code)}" class="adm-lien" data-route="espace/${esc(e.code)}">${icone(vendeurs ? 'clients' : 'cadenas', 17, 2)}<span>${vendeurs ? 'Les vendeurs' : 'Les licences'}</span></a>
      <a href="#/terrain?espace=${encodeURIComponent(e.code)}" class="adm-lien" data-route="terrain/${esc(e.code)}">${icone('plus', 17, 2)}<span>${vendeurs ? 'Nouveau vendeur' : 'Nouvelle boutique'}</span></a>
      ${vendeurs ? `<a href="#/bientot/marche" class="adm-lien" data-route="bientot/marche" data-lien-marche hidden>${icone('panier', 17, 2)}<span>Commandes</span></a>
      <a href="#/bientot/logistique" class="adm-lien" data-route="bientot/logistique">${icone('camion', 17, 2)}<span>Colis</span></a>` : ''}
    </div>`;
  }).join('');
}

function construireCoquille() {
  const m = moi();
  racine.innerHTML = `
    <div class="adm-shell cs-shell">
      <div class="adm-voile" data-action="fermer-menu" hidden></div>
      <nav class="adm-menu" aria-label="Console de direction" id="adm-menu">
        <a class="adm-logo" href="#/accueil">${logoSymbole(34)}<span><strong>YOUMMA</strong><em>DIRECTION</em></span></a>
        <div class="adm-liens">
          <a href="#/accueil" class="adm-lien" data-route="accueil">${icone('maison', 17, 2)}<span>Accueil</span></a>
          ${menuEspaces()}
          ${peutGererAcces() ? `<div class="adm-groupe"><a href="#/acces" class="adm-lien" data-route="acces">${icone('bouclier', 17, 2)}<span>Les accès</span></a></div>` : ''}
          ${estSuperAdmin() ? `<details class="adm-groupe cs-outils"><summary class="adm-groupe-titre">${icone('outil', 15, 2)} Outils</summary>
            ${OUTILS.map((r) => `<a href="#/${r.route}" class="adm-lien" data-route="${r.route}">${svg(r.icone)}<span>${esc(r.libelle)}</span>${r.compteur ? `<span class="adm-compteur" data-compteur="${r.compteur}"></span>` : ''}</a>`).join('')}
          </details>` : ''}
        </div>
        <div class="adm-moi">
          <span class="gras">${esc(m.nom || 'Direction')}</span>
          <span class="adm-moi-sous">${esc(ROLES[m.role] || m.role || '')}${admin.moi?.telephone ? ` · ${esc(telLocal(admin.moi.telephone))}` : ''}</span>
          <a class="adm-moi-lien" href="${esc(urlAppli())}">Ouvrir l’appli des boutiques</a>
          <button type="button" class="adm-deconnexion" data-action="deconnexion">${icone('deconnexion', 16, 2)} Déconnexion</button>
        </div>
      </nav>
      <div class="adm-colonne">
        <header class="adm-barre">
          <button type="button" class="adm-burger" data-action="ouvrir-menu" aria-label="Ouvrir le menu" aria-controls="adm-menu" aria-expanded="false">☰</button>
          <span class="adm-barre-titre" data-ref="titre-barre">Direction</span>
          <form class="adm-recherche" role="search" data-form="recherche">
            ${icone('recherche', 18, 2)}
            <label class="sr-only" for="adm-recherche">Rechercher une boutique</label>
            <input id="adm-recherche" type="search" placeholder="Boutique, vendeur, téléphone…" autocomplete="off">
          </form>
        </header>
        <div class="adm-bandeau" data-zone="bandeau"></div>
        <main class="adm-contenu" id="adm-vue" tabindex="-1"></main>
      </div>
    </div>`;
  const shell = racine.querySelector('.adm-shell');
  montrerLiensMarche(shell); // « Commandes » (marché) : seulement si le marché n'est pas en veille
  const menu = (ouvert) => {
    shell.classList.toggle('menu-ouvert', ouvert);
    shell.querySelector('.adm-voile').hidden = !ouvert;
    shell.querySelector('.adm-burger').setAttribute('aria-expanded', String(ouvert));
  };
  shell.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'ouvrir-menu') menu(true);
    if (action === 'fermer-menu') menu(false);
    if (action === 'deconnexion') { window.onhashchange = null; await sb.auth.signOut(); history.replaceState(null, '', location.pathname); afficherConnexion(); }
    if (e.target.closest('.adm-lien')) menu(false);
  });
  shell.querySelector('[data-form="recherche"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = shell.querySelector('#adm-recherche').value.trim();
    location.hash = `#/recherche?q=${encodeURIComponent(q)}`;
  });
}

/** Compteurs des outils (paiements à valider, demandes d'aide) et bandeau maintenance : super administrateur seulement. */
export async function majCompteurs() {
  if (!estSuperAdmin()) return null;
  try {
    const stats = premiere(await rpc('admin_stats')) || {};
    const t = stats.a_traiter || {};
    document.querySelectorAll('[data-compteur]').forEach((el) => {
      const n = Number(t[el.dataset.compteur]) || 0;
      el.textContent = n ? String(n) : '';
    });
    const zone = document.querySelector('[data-zone="bandeau"]');
    if (zone) zone.innerHTML = champ(stats.sante, 'maintenance') ? `<p class="adm-bandeau-maintenance">${icone('alerte', 18, 2)} Mode maintenance actif : les boutiques voient l’écran de maintenance. <a href="#/reglages">Réglages</a></p>` : '';
    return stats;
  } catch { return null; }
}

/* ------------------------------------------------------------ Routeur */

function lireHash() {
  const [chemin, requete = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [route, id, sous] = chemin.split('/');
  return { route: route || 'accueil', id: id ? decodeURIComponent(id) : null, sous: sous || null, params: new URLSearchParams(requete) };
}

let nettoyage = null;
function router() {
  const { route, id, sous, params } = lireHash();
  const ecran = CONSOLE[route];
  const outil = estSuperAdmin() ? OUTILS.find((r) => r.route === route) : null;
  if ((!ecran && !outil) || (ecran?.garde && !ecran.garde(id, params))) { location.replace('#/accueil'); return; }
  nettoyage?.();
  nettoyage = null;
  fermerModales();
  // Lien actif : l'espace de la page (vendeurs, licences, terrain) ou la route.
  const cle = route === 'espace' ? `espace/${id}` : route === 'terrain' ? `terrain/${params.get('espace')}` : route === 'bientot' ? `bientot/${id}` : route;
  document.querySelectorAll('.adm-lien').forEach((a) => {
    const actif = a.dataset.route === cle;
    a.classList.toggle('actif', actif);
    if (actif) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (outil) { const d = document.querySelector('.cs-outils'); if (d) d.open = true; }
  const libelle = ecran ? ecran.titre(id) : outil.libelle;
  const titre = document.querySelector('[data-ref="titre-barre"]');
  if (titre) titre.textContent = libelle;
  document.title = `${libelle} · Direction YOUMMA`;
  // Conteneur neuf à chaque écran : les écouteurs de l'écran précédent ne s'accumulent pas.
  const ancienne = document.getElementById('adm-vue');
  if (!ancienne) return;
  const vue = ancienne.cloneNode(false);
  ancienne.replaceWith(vue);
  window.scrollTo(0, 0);
  const r = (ecran ? ecran.vue : outil.vue)(vue, { id, sous, params, majCompteurs });
  if (typeof r === 'function') nettoyage = r;
}

/* ------------------------------------------------------------ Démarrage */

export async function demarrer() {
  if (!configurationValide) { racine.innerHTML = '<p class="bloc-erreur">Configuration Supabase manquante (js/config.js).</p>'; return; }
  const { data } = await sb.auth.getSession();
  if (!data?.session) { afficherConnexion(); return; }
  try {
    direction.accueil = await rpc('console_accueil');
    chargerModes('licence'); // noms des modes dans les historiques de paiement
  } catch (err) {
    const brut = String(err?.message || err || '');
    if (/ACCES_REFUSE|42501|permission/i.test(brut + (err?.code || ''))) { afficherAccesRefuse(); return; }
    afficherConnexion(erreurConsole(err));
    return;
  }
  if (!direction.accueil?.moi || !espaces().length) { afficherAccesRefuse(); return; }
  // Les outils de l'ancien panneau lisent admin.moi (super admin / agent) : seulement pour qui y a droit.
  if (estSuperAdmin() || moi().role === 'agent') {
    try { admin.moi = premiere(await rpc('admin_moi')); } catch { admin.moi = null; }
  }
  if (!admin.moi) admin.moi = { nom: moi().nom, role: moi().role };
  construireCoquille();
  document.body.classList.toggle('role-agent', !estSuperAdmin());
  if (!location.hash || location.hash === '#') location.replace('#/accueil');
  window.onhashchange = router;
  router();
  majCompteurs();
}

demarrer().catch((err) => {
  console.error(err);
  racine.innerHTML = `<div class="ecran-auth"><div class="carte-auth"><h1>Connexion impossible</h1><p>${esc(erreurAdmin(err))}</p><button type="button" class="btn btn-primaire" onclick="location.reload()">Réessayer</button></div></div>`;
});
