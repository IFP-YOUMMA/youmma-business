/**
 * onboarding.js — Création d'une boutique (première boutique ou boutique supplémentaire).
 */
import { sb } from './supabase.js';
import { etat, utilisateur, chargerBoutiques, choisirBoutique } from './state.js';
import { naviguer } from './router.js';
import { deconnecter } from './auth.js';
import {
  esc, icone, logoComplet, normaliserTelephone, formatTelephone, messageErreur, boutonOccupe, toast, TYPES_ACTIVITE
} from './utils.js';

const ICONES_TYPES = {
  materiaux: 'brique',
  habillement: 'chemise',
  alimentation: 'panier',
  services: 'outil',
  general: 'magasin'
};

const VILLES = [
  'Conakry', 'Dubréka', 'Coyah', 'Kindia', 'Forécariah', 'Boffa', 'Boké', 'Kamsar', 'Fria', 'Télimélé',
  'Mamou', 'Dalaba', 'Pita', 'Labé', 'Lélouma', 'Kankan', 'Siguiri', 'Kouroussa', 'Kérouané',
  'Faranah', 'Dabola', 'Kissidougou', 'Guéckédou', 'Macenta', 'Nzérékoré', 'Beyla', 'Lola', 'Yomou'
];

export function afficherOnboarding(conteneur) {
  const user = utilisateur();
  const premiereBoutique = etat.boutiques.length === 0;
  const telephoneParDefaut = user?.user_metadata?.telephone ? formatTelephone(user.user_metadata.telephone) : '';

  conteneur.innerHTML = `
    <div class="ecran-onboarding">
      <header class="onboarding-entete">
        <div class="onboarding-haut">
          ${logoComplet('sombre')}
          ${premiereBoutique
            ? '<button type="button" class="btn btn-fantome-sombre" data-action="deconnexion">Se déconnecter</button>'
            : '<a class="btn btn-fantome-sombre" href="#/tableau-de-bord">Retour</a>'}
        </div>
        <div class="onboarding-titres">
          <h1>${premiereBoutique ? 'Créons votre boutique' : 'Nouvelle boutique'}</h1>
          <p>Ces informations apparaîtront sur vos reçus. Vous pourrez les modifier plus tard.</p>
        </div>
      </header>
      <main class="onboarding-contenu">
        <form class="carte onboarding-form" novalidate>
          <div class="champ">
            <label for="nom-boutique">Nom de la boutique</label>
            <input class="input" id="nom-boutique" name="nom" type="text" placeholder="Ex. Diallo Matériaux" required autocomplete="organization">
          </div>

          <fieldset class="champ champ-types">
            <legend>Type d’activité</legend>
            <div class="grille-types">
              ${Object.entries(TYPES_ACTIVITE).map(([valeur, libelle]) => `
                <label class="carte-type">
                  <input type="radio" name="type" value="${valeur}" required>
                  <span class="carte-type-icone">${icone(ICONES_TYPES[valeur], 26, 1.8)}</span>
                  <span class="carte-type-libelle">${esc(libelle)}</span>
                </label>`).join('')}
            </div>
          </fieldset>

          <div class="rangee-champs">
            <div class="champ">
              <label for="ville">Ville</label>
              <input class="input" id="ville" name="ville" type="text" list="liste-villes" placeholder="Ex. Conakry" required autocomplete="address-level2">
              <datalist id="liste-villes">${VILLES.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
            </div>
            <div class="champ">
              <label for="tel-boutique">Téléphone de la boutique</label>
              <input class="input" id="tel-boutique" name="telephone" type="tel" inputmode="tel" placeholder="6XX XX XX XX" value="${esc(telephoneParDefaut)}" required>
            </div>
          </div>

          <p class="erreur-form" role="alert" hidden></p>
          <button type="submit" class="btn btn-primaire btn-bloc btn-grand">Créer ma boutique</button>
          ${premiereBoutique ? '<p class="note-centree">Essai gratuit de 14 jours, sans engagement.</p>' : ''}
        </form>
      </main>
    </div>`;

  const formulaire = conteneur.querySelector('form');
  conteneur.querySelector('[data-action="deconnexion"]')?.addEventListener('click', deconnecter);

  // Mise en avant de la carte « type d'activité » choisie.
  formulaire.addEventListener('change', (e) => {
    if (e.target.name !== 'type') return;
    formulaire.querySelectorAll('.carte-type').forEach((carte) => {
      carte.classList.toggle('choisie', carte.querySelector('input').checked);
    });
  });

  formulaire.addEventListener('submit', (e) => {
    e.preventDefault();
    creerBoutique(formulaire);
  });
}

/** Valide le formulaire puis appelle la fonction serveur creer_boutique. */
async function creerBoutique(formulaire) {
  const zoneErreur = formulaire.querySelector('.erreur-form');
  const afficherErreur = (message) => { zoneErreur.textContent = message; zoneErreur.hidden = !message; };

  const nom = formulaire.nom.value.trim();
  const type = formulaire.type.value;
  const ville = formulaire.ville.value.trim();
  const telephone = normaliserTelephone(formulaire.telephone.value);
  if (nom.length < 2) return afficherErreur('Indiquez le nom de la boutique.');
  if (!type) return afficherErreur('Choisissez le type d’activité.');
  if (!ville) return afficherErreur('Indiquez la ville.');
  if (!telephone) return afficherErreur('Numéro de téléphone invalide. Exemple : 620 00 00 00.');
  afficherErreur('');

  const bouton = formulaire.querySelector('[type=submit]');
  boutonOccupe(bouton, true, 'Création de la boutique…');
  try {
    const user = utilisateur();
    const { data: idBoutique, error } = await sb.rpc('creer_boutique', {
      p_nom: nom,
      p_type: type,
      p_ville: ville,
      p_telephone: telephone,
      p_nom_proprietaire: user?.user_metadata?.nom || nom
    });
    if (error) throw error;

    await chargerBoutiques();
    choisirBoutique(idBoutique);
    toast('Votre essai gratuit de 14 jours commence aujourd’hui', 'succes', 6000);
    naviguer('tableau-de-bord', { remplacer: true });
  } catch (err) {
    afficherErreur(messageErreur(err));
    boutonOccupe(bouton, false);
  }
}
