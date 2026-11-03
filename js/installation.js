/**
 * installation.js — Installer l'application, au bon moment (étape 21). Autonome : utilisable par l'appli et par a/.
 *
 * La règle : on installe quand on ouvre l'application tous les jours ; on ne demande jamais à quelqu'un qui vient
 * une fois.
 *  1. Pages publiques (a/, c/, f/, m/, s/) : aucune invitation à l'ouverture (elles ne déclarent pas de manifeste,
 *     et l'invitation automatique du navigateur est de toute façon interceptée ici).
 *  2. Après une commande confirmée sur a/ : une bande discrète, refusable pour toujours (bandeSuivi).
 *  3. Dans l'espace de travail : invitation au troisième jour d'utilisation (surveillerUsage), avec le vrai argument.
 * iPhone : Safari n'a pas de bouton d'installation → les trois étapes en images (Partager → Sur l'écran d'accueil →
 * Ajouter). Tout le stockage local est enveloppé dans try/catch.
 */

let invite = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); invite = e; });
window.addEventListener('appinstalled', () => { invite = null; document.querySelector('.yi-bande')?.remove(); });

export const estInstallee = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const estIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const lire = (cle) => { try { return localStorage.getItem(cle); } catch { return null; } };
const ecrire = (cle, valeur) => { try { localStorage.setItem(cle, valeur); } catch { /* stockage refusé */ } };
const aujourdhui = () => new Date().toISOString().slice(0, 10);

const STYLE = `
.yi-bande { position: fixed; left: 12px; right: 12px; bottom: calc(76px + env(safe-area-inset-bottom, 0px)); z-index: 60; max-width: 560px; margin: 0 auto;
  background: #FFFFFF; border: 1px solid #E6ECE9; border-radius: 14px; box-shadow: 0 10px 28px rgba(14, 31, 26, .16); padding: 12px 14px;
  display: flex; flex-direction: column; gap: 10px; font-family: 'Manrope', system-ui, sans-serif; color: #0E1F1A; }
.yi-bande.statique { position: static; box-shadow: none; margin: 0; max-width: none; }
.yi-bande strong { font-size: 14.5px; }
.yi-bande p { margin: 0; font-size: 13px; color: #5B6B65; line-height: 1.4; }
.yi-boutons { display: flex; flex-wrap: wrap; gap: 8px; }
.yi-btn { min-height: 40px; padding: 0 14px; border-radius: 10px; border: 1px solid #E6ECE9; background: #FFFFFF; color: #0A3D33; font: inherit; font-size: 13.5px; font-weight: 800; cursor: pointer; }
.yi-btn.p { background: #0F7B5F; border-color: #0F7B5F; color: #FFFFFF; }
.yi-btn.lien { border: 0; background: none; color: #5B6B65; text-decoration: underline; padding: 0 4px; }
.yi-fond { position: fixed; inset: 0; z-index: 80; background: rgba(10, 30, 25, .55); display: flex; align-items: flex-end; justify-content: center; }
.yi-feuille { width: 100%; max-width: 480px; background: #FFFFFF; border-radius: 18px 18px 0 0; padding: 18px 16px calc(18px + env(safe-area-inset-bottom, 0px));
  font-family: 'Manrope', system-ui, sans-serif; color: #0E1F1A; display: flex; flex-direction: column; gap: 14px; max-height: 90vh; overflow: auto; }
.yi-feuille h2 { margin: 0; font-size: 18px; }
.yi-etapes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.yi-etapes li { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 12px; align-items: center; }
.yi-image { width: 64px; height: 64px; border-radius: 14px; background: #F2F4F7; display: grid; place-items: center; }
.yi-image svg { width: 34px; height: 34px; }
.yi-etapes strong { display: block; font-size: 14.5px; }
.yi-etapes span { font-size: 13px; color: #5B6B65; }
`;
function style() {
  if (document.getElementById('yi-style')) return;
  const s = document.createElement('style');
  s.id = 'yi-style';
  s.textContent = STYLE;
  document.head.append(s);
}

/** Les images des étapes : dessinées ici (SVG), à l'image des icônes de Safari et de Chrome. */
const IMG = {
  partager: '<svg viewBox="0 0 24 24" fill="none" stroke="#0A84FF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
  ecran: '<svg viewBox="0 0 24 24" fill="none" stroke="#1C1C1E" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
  ajouter: '<svg viewBox="0 0 40 24"><rect x="1" y="3" width="38" height="18" rx="5" fill="#0A84FF"/><text x="20" y="16" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" font-weight="700" fill="#FFFFFF">Ajouter</text></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="#1C1C1E"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
  installer: '<svg viewBox="0 0 24 24" fill="none" stroke="#0F7B5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7v7M9 11l3 3 3-3"/></svg>'
};

/** Feuille des étapes : iPhone (Partager → Sur l'écran d'accueil → Ajouter) ou Android (menu ⋮ → Installer). */
export function montrerEtapes({ titre = 'Ajouter à l’écran d’accueil' } = {}) {
  style();
  const ios = estIos();
  const etapes = ios
    ? [[IMG.partager, 'Touchez « Partager »', 'Le carré avec une flèche, en bas de Safari.'], [IMG.ecran, '« Sur l’écran d’accueil »', 'Faites défiler la liste pour le trouver.'], [IMG.ajouter, 'Touchez « Ajouter »', 'En haut à droite. L’icône apparaît sur votre écran.']]
    : [[IMG.menu, 'Ouvrez le menu', 'Les trois points, en haut à droite du navigateur.'], [IMG.installer, '« Installer l’application »', 'Ou « Ajouter à l’écran d’accueil ».'], [IMG.ecran, 'Confirmez', 'L’icône apparaît sur votre écran.']];
  const fond = document.createElement('div');
  fond.className = 'yi-fond';
  fond.innerHTML = `<div class="yi-feuille" role="dialog" aria-modal="true" aria-labelledby="yi-titre">
    <h2 id="yi-titre">${titre}</h2>
    <ol class="yi-etapes">${etapes.map(([img, t, d]) => `<li><span class="yi-image" aria-hidden="true">${img}</span><span><strong>${t}</strong><span>${d}</span></span></li>`).join('')}</ol>
    <button type="button" class="yi-btn p" data-yi="fermer">J’ai compris</button></div>`;
  document.body.append(fond);
  fond.addEventListener('click', (e) => { if (e.target === fond || e.target.closest('[data-yi="fermer"]')) fond.remove(); });
}

/** Installer : la fenêtre du navigateur si elle est disponible (Android, ordinateur), sinon les étapes. */
export async function installer() {
  if (invite) {
    const e = invite;
    invite = null;
    e.prompt();
    try { await e.userChoice; } catch { /* rien */ }
    return;
  }
  montrerEtapes();
}

function bande({ titre, texte, refus, plusTard = null, cible = null }) {
  style();
  const b = document.createElement('div');
  b.className = `yi-bande ${cible ? 'statique' : ''}`;
  b.setAttribute('role', 'region');
  b.setAttribute('aria-label', titre);
  b.innerHTML = `<strong>${titre}</strong><p>${texte}</p>
    <div class="yi-boutons"><button type="button" class="yi-btn p" data-yi="installer">${estIos() ? 'Comment faire' : 'Installer'}</button>
      ${plusTard ? '<button type="button" class="yi-btn" data-yi="plus-tard">Plus tard</button>' : ''}
      <button type="button" class="yi-btn lien" data-yi="jamais">Ne plus me le proposer</button></div>`;
  b.addEventListener('click', (e) => {
    const a = e.target.closest('[data-yi]')?.dataset.yi;
    if (a === 'installer') installer();
    if (a === 'plus-tard') { ecrire(plusTard, aujourdhui()); b.remove(); }
    if (a === 'jamais') { ecrire(refus, '1'); b.remove(); }
  });
  (cible || document.body).append(b);
  return b;
}

/**
 * 2. Après une commande confirmée (a/) : « Gardez votre suivi à portée de main », dans la page, refusable pour toujours.
 */
export function bandeSuivi(cible) {
  if (!cible || estInstallee() || lire('yb_install_suivi_refus') === '1') return null;
  return bande({
    titre: 'Gardez votre suivi à portée de main',
    texte: 'Ajoutez cette page à votre écran d’accueil : vous retrouverez votre commande en un geste, jusqu’au retrait.',
    refus: 'yb_install_suivi_refus',
    cible
  });
}

/**
 * 3. Espace de travail : compte les jours d'utilisation (dates distinctes) et invite au troisième, avec le vrai argument.
 */
export function surveillerUsage() {
  if (estInstallee()) return;
  let jours = [];
  try { jours = JSON.parse(lire('yb_jours_usage') || '[]'); } catch { jours = []; }
  if (!jours.includes(aujourdhui())) { jours = [...jours, aujourdhui()].slice(-10); ecrire('yb_jours_usage', JSON.stringify(jours)); }
  if (jours.length < 3 || lire('yb_install_refus') === '1' || lire('yb_install_plus_tard') === aujourdhui()) return;
  if (document.querySelector('.yi-bande')) return;
  bande({
    titre: 'Installez l’application sur ce téléphone',
    texte: 'L’application garde ses fichiers en mémoire : elle s’ouvre plus vite et vous consommerez moins de données.',
    refus: 'yb_install_refus',
    plusTard: 'yb_install_plus_tard'
  });
}
