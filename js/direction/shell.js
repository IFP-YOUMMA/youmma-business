/**
 * direction/shell.js — Coquille de la direction (étapes 20 et 26) : barre latérale SANS sélecteur de boutique.
 * Étape 26 : plus de portes. Tableau de bord · Les boutiques (leur nombre) · Créer une boutique · ADMINISTRATION (les
 * outils de la plateforme, super administrateur seulement, avec leurs pastilles) · Accès · Se déconnecter.
 * Sur téléphone, le bandeau sous le logo garde l'essentiel ; l'administration s'ouvre par les tuiles du tableau de bord.
 */
import { deconnecter } from '../auth.js';
import { esc, icone, logoMarque, logoSymbole, formatNombre } from '../utils.js';
import { moi, cache, estSuperAdmin } from './commun.js';
import { OUTILS, pastillesHTML } from './administration.js';

/** Écrans rattachés à une entrée du menu (la fiche et la création appartiennent aux boutiques). */
const PARENT = { fiche: 'boutiques', terrain: 'boutiques', chercher: 'boutiques', recherche: 'boutiques' };

function liens() {
  const total = cache.total;
  return {
    principaux: [
      { route: '', libelle: 'Tableau de bord', icone: 'maison' },
      { route: 'boutiques', libelle: 'Les boutiques', icone: 'magasin', compte: total },
      { route: 'boutiques/nouvelle', libelle: 'Créer une boutique', icone: 'plus', creer: true }
    ],
    administration: estSuperAdmin() ? OUTILS : [],
    fin: moi().peut_gerer_acces ? [{ route: 'acces', libelle: 'Accès', icone: 'bouclier', pastilles: [['acces', 'gris']] }] : []
  };
}

const lien = (l, classe) => `<a href="#/${l.route}" class="${classe}${l.creer ? ' dir-lien-creer' : ''}" data-route="${esc(l.route)}">${icone(l.icone, 17, 1.7)}<span class="lien-menu-libelle">${esc(l.libelle)}</span>${l.compte !== undefined && l.compte !== null ? `<span class="dir-compte">${formatNombre(Number(l.compte) || 0)}</span>` : ''}${l.pastilles ? pastillesHTML(l.pastilles) : ''}</a>`;

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
  shell.querySelector('[data-zone="dir-liens"]').innerHTML = [
    ...l.principaux.map((x) => lien(x, 'lien-menu')),
    l.administration.length ? `<span class="dir-menu-titre">Administration</span>${l.administration.map((x) => lien(x, 'lien-menu')).join('')}` : '',
    l.fin.length ? `<span class="dir-menu-separateur" aria-hidden="true"></span>${l.fin.map((x) => lien(x, 'lien-menu')).join('')}` : ''
  ].join('');
  shell.querySelector('[data-zone="dir-liens-mobile"]').innerHTML = [...l.principaux, ...l.fin].map((x) => lien(x, 'dir-lien-mobile')).join('');
  const racine = PARENT[actif.split('/')[0]] || actif.split('/')[0];
  shell.querySelectorAll('[data-route]').forEach((a) => {
    const on = a.dataset.route === racine;
    a.classList.toggle('actif', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
