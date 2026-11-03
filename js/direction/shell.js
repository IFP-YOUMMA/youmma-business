/**
 * direction/shell.js — Coquille du tableau de bord de direction (étape 20) : barre latérale d'accueil SANS sélecteur
 * de boutique (on n'entre dans une boutique que par sa porte), une entrée par porte renvoyée par le serveur,
 * Accès si la personne gère les accès, déconnexion. Sur téléphone, les mêmes liens en bandeau sous le logo.
 */
import { deconnecter } from '../auth.js';
import { esc, icone, logoMarque, logoSymbole } from '../utils.js';
import { portes, routePorte, moi } from './commun.js';

function liens() {
  return [
    { route: '', libelle: 'Accueil', icone: 'maison' },
    ...portes().map((p) => ({ route: routePorte(p), libelle: p.nom || p.nom_public, couleur: p.couleur, icone: p.facturation === 'licence' ? 'magasin' : 'colis' })),
    ...(moi().peut_gerer_acces ? [{ route: 'acces', libelle: 'Accès', icone: 'bouclier' }] : [])
  ];
}

const lien = (l, classe) => `<a href="#/${l.route}" class="${classe}" data-route="${esc(l.route)}">${icone(l.icone, 17, 1.7)}<span class="lien-menu-libelle">${esc(l.libelle)}</span>${l.couleur ? `<span class="dir-pastille-porte" style="background:${esc(l.couleur)}"></span>` : ''}</a>`;

/** Construit (si besoin) la coquille, allume l'entrée de la route et renvoie un conteneur de vue neuf. */
export function preparerDirection(route) {
  const app = document.getElementById('app');
  let shell = app.querySelector('.dir-shell');
  if (!shell) {
    app.innerHTML = `
      <div class="shell dir-shell">
        <nav class="sidebar" aria-label="Direction">
          <a class="sidebar-logo" href="#/" aria-label="Accueil de la direction">${logoMarque('sombre', 30)}</a>
          <div class="menu-liens" data-zone="dir-liens"></div>
          <button type="button" class="lien-menu lien-deconnexion" data-action="dir-deconnexion">${icone('deconnexion', 15, 1.7)}<span>Se déconnecter</span></button>
        </nav>
        <div class="colonne">
          <header class="dir-barre-mobile">
            <a href="#/" class="dir-barre-logo" aria-label="Accueil de la direction">${logoSymbole(30)}</a>
            <nav class="dir-barre-liens" data-zone="dir-liens-mobile" aria-label="Direction"></nav>
            <button type="button" class="btn-icone dir-barre-sortie" data-action="dir-deconnexion" aria-label="Se déconnecter">${icone('deconnexion', 18, 2)}</button>
          </header>
          <main id="vue" tabindex="-1"></main>
        </div>
      </div>`;
    shell = app.querySelector('.dir-shell');
    shell.addEventListener('click', (e) => { if (e.target.closest('[data-action="dir-deconnexion"]')) deconnecter(); });
  }
  majLiens(route);
  const ancienne = shell.querySelector('#vue');
  const vue = ancienne.cloneNode(false);
  ancienne.replaceWith(vue);
  window.scrollTo(0, 0);
  return vue;
}

/** Redessine les liens (les portes arrivent avec direction_accueil ou console_accueil). */
export function majLiens(route = null) {
  const shell = document.querySelector('.dir-shell');
  if (!shell) return;
  const actif = route ?? shell.dataset.route ?? '';
  shell.dataset.route = actif;
  const l = liens();
  shell.querySelector('[data-zone="dir-liens"]').innerHTML = l.map((x) => lien(x, 'lien-menu')).join('');
  shell.querySelector('[data-zone="dir-liens-mobile"]').innerHTML = l.map((x) => lien(x, 'dir-lien-mobile')).join('');
  shell.querySelectorAll('[data-route]').forEach((a) => {
    const on = a.dataset.route === actif.split('/')[0] || (a.dataset.route && actif.startsWith(a.dataset.route));
    a.classList.toggle('actif', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
