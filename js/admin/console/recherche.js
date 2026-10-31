/**
 * admin/console/recherche.js — Recherche de la barre du haut (étape 19), #/recherche?q=…, et pages « bientôt ».
 *
 * La recherche interroge console_boutiques(espace, null, q) pour chaque espace renvoyé par console_accueil(), et pour
 * eux seulement : un associé ne cherche jamais dans les licences, la base n'est même pas appelée pour cet espace.
 */
import { esc, icone, formatNombre } from '../../utils.js';
import { rpc } from '../commun.js';
import { espaces, entete, erreurConsole, dernierUsage } from './commun.js';

export function afficherRecherche(conteneur, { params }) {
  const q = (params.get('q') || '').trim();
  conteneur.innerHTML = `<div class="cs-page">${entete({ titre: q ? `« ${q} »` : 'Rechercher', sous: 'Dans les espaces que vous voyez' })}<div data-zone="resultats"><span class="squelette" style="height:200px"></span></div></div>`;
  const zone = conteneur.querySelector('[data-zone="resultats"]');
  if (!q) { zone.innerHTML = '<p class="col-vide">Tapez un nom, une ville ou un téléphone dans la barre du haut.</p>'; return; }
  (async () => {
    const blocs = await Promise.all(espaces().map(async (e) => {
      try {
        const lignes = (await rpc('console_boutiques', { p_espace: e.code, p_filtre: null, p_recherche: q, p_limite: 30 })) || [];
        return { e, lignes };
      } catch (err) { return { e, erreur: erreurConsole(err), lignes: [] }; }
    }));
    if (!conteneur.isConnected) return;
    const total = blocs.reduce((n, b) => n + b.lignes.length, 0);
    zone.innerHTML = blocs.map(({ e, lignes, erreur }) => `
      <section class="carte cs-resultats" style="--cs-couleur:${esc(e.couleur)}">
        <div class="cs-bloc-tete"><h2><span class="cs-point" style="background:${esc(e.couleur)}"></span>${esc(e.nom_public)}</h2><span class="discret">${formatNombre(lignes.length)} résultat${lignes.length > 1 ? 's' : ''}</span></div>
        ${erreur ? `<p class="bloc-erreur">${esc(erreur)}</p>` : lignes.length ? `<ul class="cs-liste-resultats">${lignes.map((b) => `
          <li><a href="#/fiche/${encodeURIComponent(b.id)}"><strong>${esc(b.nom)}</strong><span>${esc([b.ville, `dernier usage : ${dernierUsage(b.derniere_activite)}`].filter(Boolean).join(' · '))}</span>${icone('retour', 14, 2)}</a></li>`).join('')}</ul>` : '<p class="col-vide">Rien ici.</p>'}
      </section>`).join('') + (total ? '' : '<p class="discret">Aucune boutique ne correspond.</p>');
  })();
}

const BIENTOT = {
  marche: ['Commandes et règlements', 'Les commandes du marché du monde, les règlements aux vendeurs et le partage arrivent à l’étape suivante. Les chiffres de cet espace restent à zéro d’ici là : c’est normal.'],
  logistique: ['Colis et corridors', 'Le suivi des colis, des corridors et des entrepôts dans la console arrive bientôt. Les agences continuent d’utiliser leur application.']
};

export function afficherBientot(conteneur, { id }) {
  const [titre, texte] = BIENTOT[id] || ['Bientôt', 'Cet écran n’est pas encore construit.'];
  conteneur.innerHTML = `<div class="cs-page">${entete({ titre, sous: 'Bientôt' })}
    <section class="carte cs-bientot">${icone('horloge', 40, 1.6)}<h2>Cet écran arrive bientôt</h2><p>${esc(texte)}</p><a class="btn btn-primaire" href="#/accueil">Retour à l’accueil</a></section></div>`;
}
