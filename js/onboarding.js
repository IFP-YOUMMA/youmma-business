/**
 * onboarding.js — Entrée dans une boutique (maquette Rejoindre.dc.html) :
 *  - #/nouvelle-boutique et #/rejoindre : choix « J’ai un code d’invitation » (mis en avant)
 *    ou « Créer ma propre boutique » ;
 *  - #/nouvelle-boutique?creer=1 : formulaire de création (première boutique ou boutique supplémentaire).
 */
import { sb } from './supabase.js';
import { etat, utilisateur, chargerBoutiques, choisirBoutique, peut, LIBELLES_ROLES } from './state.js';
import { naviguer } from './router.js';
import { deconnecter } from './auth.js';
import {
  esc, icone, logoMarque, normaliserTelephone, formatTelephone, messageErreur, boutonOccupe, toast, prenom, TYPES_ACTIVITE
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

/** Nom de l'utilisateur connecté (saisi à l'inscription, sinon son nom de membre). */
function nomUtilisateur() {
  return utilisateur()?.user_metadata?.nom || etat.membre?.nom || '';
}

export function afficherOnboarding(conteneur, params) {
  // Ouvrir une boutique : première boutique, ou propriétaire de la boutique active.
  const peutCreer = etat.boutiques.length === 0 || peut('ouvrir_boutique');
  if (params?.get('creer') && peutCreer) afficherCreation(conteneur);
  else afficherChoix(conteneur, peutCreer);
}

/** Bouton en haut à droite : déconnexion (aucune boutique) ou retour au tableau de bord. */
function boutonEntete() {
  return etat.boutiques.length === 0
    ? '<button type="button" class="btn btn-fantome-sombre" data-action="deconnexion">Se déconnecter</button>'
    : '<a class="btn btn-fantome-sombre" href="#/tableau-de-bord">Retour</a>';
}

/* ------------------------------------------------------------ Choix : code d'invitation ou création */

function afficherChoix(conteneur, peutCreer) {
  const premiere = etat.boutiques.length === 0;
  const prenomUtilisateur = prenom(nomUtilisateur());
  conteneur.innerHTML = `
    <div class="ecran-onboarding">
      <header class="onboarding-entete">
        <div class="onboarding-haut">${logoMarque('sombre', 34)}${boutonEntete()}</div>
        <div class="onboarding-titres onboarding-titres-etroits">
          <h1>${premiere ? `Bienvenue${prenomUtilisateur ? ', ' + esc(prenomUtilisateur) : ''}` : 'Rejoindre une boutique'}</h1>
          <p>${premiere ? 'Créez votre boutique, ou rejoignez celle de votre patron.' : 'Saisissez le code d’invitation reçu de la boutique.'}</p>
        </div>
      </header>
      <main class="onboarding-contenu choix-contenu">
        <section class="carte carte-code" aria-labelledby="titre-code">
          <div class="choix-entete">
            <span class="choix-icone choix-icone-active">${icone('connexion', 22, 2)}</span>
            <span class="choix-textes">
              <span class="choix-titre" id="titre-code">J’ai un code d’invitation</span>
              <span class="discret">Reçu de votre patron par WhatsApp</span>
            </span>
          </div>
          <label class="sr-only" for="code-invitation">Code d’invitation à 6 chiffres</label>
          <input id="code-invitation" class="input input-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000 000">
          <div data-zone="verification" aria-live="polite"></div>
          <button type="button" class="btn btn-primaire btn-grand btn-bloc" data-action="rejoindre" disabled>Rejoindre la boutique</button>
        </section>
        ${peutCreer ? `
          <div class="separateur-ou" aria-hidden="true"><span></span>ou<span></span></div>
          <a class="carte choix-creer" href="#/nouvelle-boutique?creer=1">
            <span class="choix-icone">${icone('magasin', 22, 2)}</span>
            <span class="choix-textes">
              <span class="choix-titre">Créer ma propre boutique</span>
              <span class="discret">${premiere ? 'Essai gratuit de 14 jours' : 'Une boutique de plus, avec sa propre licence'}</span>
            </span>
            ${icone('chevronDroite', 18, 2)}
          </a>` : ''}
      </main>
    </div>`;

  conteneur.querySelector('[data-action="deconnexion"]')?.addEventListener('click', deconnecter);
  const champ = conteneur.querySelector('#code-invitation');
  const zone = conteneur.querySelector('[data-zone="verification"]');
  const bouton = conteneur.querySelector('[data-action="rejoindre"]');
  let codeVerifie = null;
  let jeton = 0;

  async function verifier(code) {
    const moi = ++jeton;
    zone.innerHTML = '<p class="discret">Vérification du code…</p>';
    const { data, error } = await sb.rpc('verifier_invitation', { p_code: code });
    if (moi !== jeton) return;
    if (error) {
      zone.innerHTML = `<p class="encadre-erreur">${icone('alerte', 18, 2)} <span>${esc(messageErreur(error))}</span></p>`;
      return;
    }
    const invitation = (Array.isArray(data) ? data[0] : data) || {};
    const role = (LIBELLES_ROLES[invitation.role] || invitation.role || 'membre').toLowerCase();
    codeVerifie = code;
    bouton.disabled = false;
    zone.innerHTML = `
      <p class="encadre-succes">${icone('valide', 20, 2.4)}
        <span><strong>${esc(invitation.boutique || 'Boutique')}${invitation.ville ? ' · ' + esc(invitation.ville) : ''}</strong><br>
        Vous rejoindrez cette boutique comme ${esc(role)}.</span>
      </p>`;
  }

  champ.addEventListener('input', () => {
    // 6 chiffres, espace automatique au milieu : « 482 913 ».
    const chiffres = champ.value.replace(/\D/g, '').slice(0, 6);
    champ.value = chiffres.length > 3 ? `${chiffres.slice(0, 3)} ${chiffres.slice(3)}` : chiffres;
    if (chiffres.length === 6 && chiffres !== codeVerifie) {
      verifier(chiffres);
    } else if (chiffres.length < 6) {
      jeton++;
      codeVerifie = null;
      bouton.disabled = true;
      zone.innerHTML = '';
    }
  });

  bouton.addEventListener('click', async () => {
    if (!codeVerifie) return;
    boutonOccupe(bouton, true, 'Connexion à la boutique…');
    try {
      const { data, error } = await sb.rpc('rejoindre_boutique', { p_code: codeVerifie, p_nom: nomUtilisateur() });
      if (error) throw error;
      const idBoutique = Array.isArray(data) ? data[0] : data;
      await chargerBoutiques();
      choisirBoutique(idBoutique);
      toast(`Bienvenue dans la boutique ${etat.boutique?.nom || ''} !`, 'succes', 6000);
      naviguer('tableau-de-bord', { remplacer: true });
    } catch (err) {
      zone.innerHTML = `<p class="encadre-erreur">${icone('alerte', 18, 2)} <span>${esc(messageErreur(err))}</span></p>`;
      boutonOccupe(bouton, false);
    }
  });
  champ.focus({ preventScroll: true });
}

/* ------------------------------------------------------------ Création d'une boutique */

function afficherCreation(conteneur) {
  const user = utilisateur();
  const premiereBoutique = etat.boutiques.length === 0;
  const telephoneParDefaut = user?.user_metadata?.telephone ? formatTelephone(user.user_metadata.telephone) : '';

  conteneur.innerHTML = `
    <div class="ecran-onboarding">
      <header class="onboarding-entete">
        <div class="onboarding-haut">${logoMarque('sombre', 34)}${boutonEntete()}</div>
        <div class="onboarding-titres">
          <h1>${premiereBoutique ? 'Créons votre boutique' : 'Nouvelle boutique'}</h1>
          <p>Ces informations apparaîtront sur vos reçus. Vous pourrez les modifier plus tard.</p>
        </div>
      </header>
      <main class="onboarding-contenu">
        <form class="carte onboarding-form" novalidate>
          <a class="lien-code" href="#/nouvelle-boutique">← J’ai plutôt un code d’invitation</a>
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
    const { data: idBoutique, error } = await sb.rpc('creer_boutique', {
      p_nom: nom,
      p_type: type,
      p_ville: ville,
      p_telephone: telephone,
      p_nom_proprietaire: nomUtilisateur() || nom
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
