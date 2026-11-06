/**
 * admin/console/accueil.js — Accueil de la console de direction (étape 19, maquette DirectionAccueil), #/accueil.
 *
 * Une zone par espace renvoyé par console_accueil(), séparée par un filet de sa couleur et ses visages : le marché du
 * monde (affaire commune) puis YOUMMA Business (affaire seule). Chaque zone a ses chiffres et ses portes, choisies selon
 * la facturation de l'espace. Dessous : « Ce qui demande une décision aujourd'hui » (console_decisions, classé par
 * urgence, les espaces mélangés) et, pour qui gère les accès, la miniature de ce que verra l'associé.
 */
import { esc, icone, formatNombre, formatDate } from '../../utils.js';
import { rpc } from '../commun.js';
import { direction, moi, espaces, espace, peutGererAcces, estSuperAdmin, montantEspace, visages, erreurConsole, montrerLiensMarche } from './commun.js';

/** Portes d'un espace, selon sa facturation (les écrans du marché et de la logistique ne sont pas encore construits). */
function portes(e) {
  if (e.facturation === 'commission') {
    return [
      ['Les vendeurs', `#/espace/${e.code}`, 'clients'],
      ['Nouveau vendeur', `#/terrain?espace=${e.code}`, 'plus'],
      ['Commandes et règlements', '#/bientot/marche', 'panier', true], // mène au marché : caché s'il est en veille
      ['Colis et corridors', '#/bientot/logistique', 'camion']
    ];
  }
  return [
    ['Les licences', `#/espace/${e.code}`, 'cadenas'],
    ['Nouvelle boutique', `#/terrain?espace=${e.code}`, 'plus'],
    ...(estSuperAdmin() ? [['Paiements à valider', '#/licences', 'caisse']] : [])
  ];
}

function chiffres(e) {
  const c = (valeur, libelle, ton = '') => `<div class="cs-chiffre"><strong class="${ton}">${valeur}</strong><span>${esc(libelle)}</span></div>`;
  return [
    c(formatNombre(e.boutiques), e.facturation === 'commission' ? 'vendeurs' : 'boutiques'),
    e.facturation === 'licence' ? c(formatNombre(e.payantes), 'payantes') : '',
    c(formatNombre(e.a_relancer), 'à relancer', e.a_relancer ? 'rouge' : ''),
    c(formatNombre(e.endormies), 'n’ouvrent plus', e.endormies ? 'rouge' : '')
  ].join('');
}

function zone(e) {
  return `<section class="cs-zone" style="--cs-couleur:${esc(e.couleur)}">
    <div class="cs-filet"><span class="cs-filet-trait"></span>${visages(e)}<span class="cs-filet-nom">${esc(e.nom_public)}${e.commun ? '' : ' — votre affaire seule'}</span><span class="cs-filet-trait"></span></div>
    <div class="cs-zone-corps">
      <div class="carte cs-zone-tete">
        <div class="cs-zone-titres"><h2>${esc(e.nom_public)}</h2><p>${esc(e.description)}</p></div>
        <div class="cs-chiffres">${chiffres(e)}</div>
      </div>
      <div class="carte cs-argent">
        <span class="etiquette-carte">${e.facturation === 'commission' ? 'Commissions, 30 derniers jours' : 'Licences encaissées, 30 derniers jours'}</span>
        <strong class="cs-argent-valeur">${esc(montantEspace(e, e.recette_30j))}</strong>
        <span class="etiquette-carte">Argent des clients en caisse</span>
        <strong class="cs-argent-caisse">${esc(montantEspace(e, e.en_caisse))}</strong>
        <span class="cs-avertissement">ne vous appartient pas encore</span>
      </div>
      <nav class="cs-portes" aria-label="${esc(e.nom_public)}">${portes(e).map(([libelle, lien, ic, marche]) => `<a class="cs-porte" href="${lien}" ${marche ? 'data-lien-marche hidden' : ''}>${icone(ic, 18, 2)}<span>${esc(libelle)}</span>${icone('retour', 14, 2)}</a>`).join('')}</nav>
    </div>
  </section>`;
}

/** Miniature de la console telle que l'associé la verra : construite à partir des espaces communs, pas une image. */
function miniature(communs, nomAssocie) {
  return `<section class="carte cs-miniature-bloc">
    <h2>Ce que voit ${esc(nomAssocie || 'votre associé')}</h2>
    <p class="discret">Sa console n’a que ${communs.length > 1 ? 'les espaces communs' : 'l’espace commun'}. Les licences n’y existent pas, ni la page des accès.</p>
    <div class="cs-miniature" aria-hidden="true">
      <div class="cs-mini-barre">Direction · ${esc(nomAssocie || 'associé')}</div>
      ${communs.map((e) => `<div class="cs-mini-zone" style="--cs-couleur:${esc(e.couleur)}"><strong>${esc(e.nom_public)}</strong>
        <span>${formatNombre(e.boutiques)} vendeurs · ${esc(montantEspace(e, e.recette_30j))} sur 30 j</span>
        <span class="cs-mini-caisse">${esc(montantEspace(e, e.en_caisse))} en caisse · ne vous appartient pas encore</span></div>`).join('')}
    </div>
  </section>`;
}

export function afficherAccueilDirection(conteneur) {
  conteneur.innerHTML = '<div class="cs-page"><span class="squelette" style="height:320px"></span></div>';
  (async () => {
    let decisions = [];
    let acces = [];
    try {
      const [accueil, d, a] = await Promise.all([
        rpc('console_accueil'), rpc('console_decisions'),
        peutGererAcces() ? rpc('console_acces').catch(() => []) : Promise.resolve([])
      ]);
      direction.accueil = accueil;
      decisions = d || [];
      acces = a || [];
    } catch (err) {
      conteneur.innerHTML = `<div class="cs-page"><p class="bloc-erreur">${esc(erreurConsole(err))}</p></div>`;
      return;
    }
    if (!conteneur.isConnected) return;
    const m = moi();
    const tri = [...decisions].sort((x, y) => x.urgence - y.urgence);
    const communs = espaces().filter((e) => e.commun);
    const associe = acces.find((x) => x.role === 'admin_espace' && communs.some((e) => e.code === x.portee));
    conteneur.innerHTML = `
      <div class="cs-page">
        <header class="cs-accueil-tete">
          <div><h1>Direction</h1><span class="discret">${esc(formatDate(new Date(), 'long'))} · ${esc(m.nom || '')}</span></div>
        </header>
        ${espaces().map(zone).join('')}
        <div class="cs-bas">
          <section class="carte cs-decisions">
            <div class="cs-bloc-tete"><h2>Ce qui demande une décision aujourd’hui</h2><span class="discret">${espaces().length > 1 ? 'Les espaces mélangés, par urgence' : 'Par urgence'}</span></div>
            ${tri.length ? `<ul class="cs-liste-decisions">${tri.map((x) => {
              const e = espace(x.espace);
              return `<li class="urgence-${x.urgence === 1 ? 'rouge' : 'orange'}">
                <span class="cs-pastille-urgence">${icone('alerte', 16, 2)}</span>
                <span class="cs-decision-textes"><strong>${esc(x.quoi)}</strong><span>${esc(x.detail || '')}</span></span>
                ${e ? `<span class="cs-etiquette-espace" style="--cs-couleur:${esc(e.couleur)}">${esc(e.nom_public)}</span>` : ''}
                ${x.cible ? `<a class="col-lien" href="#/fiche/${encodeURIComponent(x.cible)}">Ouvrir ›</a>` : ''}
              </li>`;
            }).join('')}</ul>` : '<p class="col-vide">Rien ne bloque aujourd’hui.</p>'}
          </section>
          ${peutGererAcces() && communs.length && espaces().some((e) => !e.commun) ? miniature(communs, associe?.nom) : ''}
        </div>
      </div>`;
    montrerLiensMarche(conteneur);
  })();
}
