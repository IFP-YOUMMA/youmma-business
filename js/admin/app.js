/**
 * admin/app.js — Panneau d'administration YOUMMA (admin/index.html), maquettes Admin*.dc.html.
 *
 * Même compte que l'appli (téléphone + mot de passe). Accès : admin_moi() non nul (équipe YOUMMA).
 * Menu latéral (tiroir sur téléphone), routage par hash : #/accueil, #/boutiques, #/boutiques/<id>,
 * #/licences, #/utilisateurs, #/sms, #/vitrines, #/annonces, #/support, #/equipe, #/parametres.
 * Les données se rechargent à l'ouverture de chaque rubrique (pas de temps réel).
 */
import { sb, configurationValide } from '../supabase.js';
import { esc, icone, logoComplet, logoSymbole, normaliserTelephone, emailDepuisTelephone, boutonOccupe, messageErreur, fermerModales } from '../utils.js';
import { admin, estSuper, rpc, premiere, champ, telLocal, urlAppli, erreurAdmin } from './commun.js';
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

const racine = document.getElementById('admin');

/** Rubriques du menu (icônes des maquettes). compteur : clé de a_traiter (admin_stats). */
const RUBRIQUES = [
  { route: 'accueil', libelle: 'Vue d’ensemble', icone: 'M3 12l9-8 9 8M5 10v10h14V10', vue: afficherAccueil },
  { route: 'boutiques', libelle: 'Boutiques', icone: 'M4 10h16l-1-5H5zM5 10v10h14V10M9 20v-5h6v5', vue: afficherBoutiques },
  { route: 'licences', libelle: 'Licences & paiements', icone: 'M3 7h18v12H3zM3 11h18M7 15h4', vue: afficherLicences, compteur: 'paiements_a_valider' },
  { route: 'utilisateurs', libelle: 'Utilisateurs', icone: 'M16 20v-2a4 4 0 0 0-8 0v2M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', vue: afficherUtilisateurs },
  { route: 'sms', libelle: 'SMS & messages', icone: 'M4 5h16v11H8l-4 4z', vue: afficherSms },
  { route: 'vitrines', libelle: 'Boutiques en ligne', icone: 'M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', vue: afficherVitrines },
  { route: 'annonces', libelle: 'Annonces', icone: 'M3 11v2l13 5V6zM16 8a4 4 0 0 1 0 8M7 13l1 6h3l-1-5', vue: afficherAnnonces },
  { route: 'support', libelle: 'Support', icone: 'M12 21a9 9 0 1 0-9-9c0 1.6.4 3 1.1 4.3L3 21l4.7-1.1A9 9 0 0 0 12 21zM9 10a3 3 0 1 1 4 2.8V14M12 17h.01', vue: afficherSupport, compteur: 'support_ouvertes' },
  { route: 'equipe', libelle: 'Équipe & journal', icone: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 11a3 3 0 1 0 0-6M3 20v-1a5 5 0 0 1 10 0v1M15 14a5 5 0 0 1 6 5v1', vue: afficherEquipe },
  { route: 'stockage', libelle: 'Stockage', icone: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6', vue: afficherStockage },
  { route: 'parametres', libelle: 'Paramètres', icone: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z', vue: afficherParametres }
];
const svg = (d, taille = 17) => `<svg width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"></path></svg>`;

/* ------------------------------------------------------------ Connexion */

function afficherConnexion(message = '') {
  racine.innerHTML = `
    <div class="ecran-auth">
      <div class="adm-logo-auth">${logoComplet('sombre')}<span>ADMINISTRATION</span></div>
      <div class="carte-auth">
        <div class="auth-titres"><h1>Connexion équipe YOUMMA</h1><p>Même compte que l’appli : téléphone et mot de passe.</p></div>
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
    if (!telephone) { zoneErreur.textContent = 'Numéro invalide. Exemple : 620 00 00 00.'; zoneErreur.hidden = false; return; }
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
      <div class="adm-logo-auth">${logoComplet('sombre')}<span>ADMINISTRATION</span></div>
      <div class="carte-auth">
        <div class="auth-titres"><h1>Accès réservé à l’équipe YOUMMA</h1><p>Ce compte n’a pas accès au panneau d’administration.</p></div>
        <a class="btn btn-primaire btn-bloc btn-grand" href="${esc(urlAppli())}">Ouvrir l’appli des boutiques</a>
        <button type="button" class="btn btn-secondaire btn-bloc" data-action="deconnexion">Se déconnecter</button>
      </div>
    </div>`;
  racine.querySelector('[data-action="deconnexion"]').addEventListener('click', async () => { await sb.auth.signOut(); afficherConnexion(); });
}

/* ------------------------------------------------------------ Coquille */

function construireCoquille() {
  const m = admin.moi;
  racine.innerHTML = `
    <div class="adm-shell">
      <div class="adm-voile" data-action="fermer-menu" hidden></div>
      <nav class="adm-menu" aria-label="Administration" id="adm-menu">
        <a class="adm-logo" href="#/accueil">${logoSymbole(34)}<span><strong>YOUMMA Business</strong><em>ADMINISTRATION</em></span></a>
        <div class="adm-liens">
          ${RUBRIQUES.map((r) => `
            <a href="#/${r.route}" class="adm-lien" data-route="${r.route}">${svg(r.icone)}<span>${esc(r.libelle)}</span>${r.compteur ? `<span class="adm-compteur" data-compteur="${r.compteur}"></span>` : ''}</a>`).join('')}
        </div>
        <div class="adm-moi">
          <span class="gras">${esc(m.nom || 'Équipe YOUMMA')}</span>
          <span class="adm-moi-sous">${estSuper() ? 'Super admin' : 'Agent'} · ${esc(telLocal(m.telephone))}</span>
          <a class="adm-moi-lien" href="${esc(urlAppli())}">Ouvrir l’appli des boutiques</a>
          <button type="button" class="adm-deconnexion" data-action="deconnexion">${icone('deconnexion', 16, 2)} Déconnexion</button>
        </div>
      </nav>
      <div class="adm-colonne">
        <header class="adm-barre">
          <button type="button" class="adm-burger" data-action="ouvrir-menu" aria-label="Ouvrir le menu" aria-controls="adm-menu" aria-expanded="false">☰</button>
          <span class="adm-barre-titre" data-ref="titre-barre">Administration</span>
          <form class="adm-recherche" role="search" data-form="recherche">
            ${icone('recherche', 18, 2)}
            <label class="sr-only" for="adm-recherche">Rechercher une boutique</label>
            <input id="adm-recherche" type="search" placeholder="Boutique, téléphone…" autocomplete="off">
          </form>
        </header>
        <div class="adm-bandeau" data-zone="bandeau"></div>
        <main class="adm-contenu" id="adm-vue" tabindex="-1"></main>
      </div>
    </div>`;
  const shell = racine.querySelector('.adm-shell');
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
    location.hash = `#/boutiques?q=${encodeURIComponent(q)}`;
  });
}

/** Compteurs du menu (paiements à valider, demandes d'aide) et bandeau maintenance. */
export async function majCompteurs() {
  try {
    const stats = premiere(await rpc('admin_stats')) || {};
    const t = stats.a_traiter || {};
    document.querySelectorAll('[data-compteur]').forEach((el) => {
      const n = Number(t[el.dataset.compteur]) || 0;
      el.textContent = n ? String(n) : '';
    });
    const zone = document.querySelector('[data-zone="bandeau"]');
    if (zone) zone.innerHTML = champ(stats.sante, 'maintenance') ? `<p class="adm-bandeau-maintenance">${icone('alerte', 18, 2)} Mode maintenance actif : les boutiques voient l’écran de maintenance. <a href="#/parametres">Paramètres</a></p>` : '';
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
  const rubrique = RUBRIQUES.find((r) => r.route === route);
  if (!rubrique) { location.replace('#/accueil'); return; }
  nettoyage?.();
  nettoyage = null;
  fermerModales();
  document.querySelectorAll('.adm-lien').forEach((a) => {
    const actif = a.dataset.route === route;
    a.classList.toggle('actif', actif);
    if (actif) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const titre = document.querySelector('[data-ref="titre-barre"]');
  if (titre) titre.textContent = rubrique.libelle;
  document.title = `${rubrique.libelle} · Administration YOUMMA`;
  // Conteneur neuf à chaque rubrique : les écouteurs de la rubrique précédente ne s'accumulent pas.
  const ancienne = document.getElementById('adm-vue');
  if (!ancienne) return;
  const vue = ancienne.cloneNode(false);
  ancienne.replaceWith(vue);
  window.scrollTo(0, 0);
  const r = rubrique.vue(vue, { id, sous, params, majCompteurs });
  if (typeof r === 'function') nettoyage = r;
}

/* ------------------------------------------------------------ Démarrage */

export async function demarrer() {
  if (!configurationValide) { racine.innerHTML = '<p class="bloc-erreur">Configuration Supabase manquante (js/config.js).</p>'; return; }
  const { data } = await sb.auth.getSession();
  if (!data?.session) { afficherConnexion(); return; }
  try {
    admin.moi = premiere(await rpc('admin_moi'));
  } catch (err) {
    afficherConnexion(erreurAdmin(err));
    return;
  }
  if (!admin.moi) { afficherAccesRefuse(); return; }
  construireCoquille();
  document.body.classList.toggle('role-agent', !estSuper());
  if (!location.hash || location.hash === '#') location.replace('#/accueil');
  window.onhashchange = router;
  router();
  majCompteurs();
}

demarrer().catch((err) => {
  console.error(err);
  racine.innerHTML = `<div class="ecran-auth"><div class="carte-auth"><h1>Connexion impossible</h1><p>${esc(erreurAdmin(err))}</p><button type="button" class="btn btn-primaire" onclick="location.reload()">Réessayer</button></div></div>`;
});
