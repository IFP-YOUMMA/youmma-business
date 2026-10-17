/**
 * auth.js — Écrans de connexion et d'inscription (identifiant = téléphone), déconnexion.
 *
 * Supabase Auth fonctionne par e-mail : on dérive un e-mail technique invisible
 * du numéro normalisé (224XXXXXXXXX@tel.yoummabusiness.app).
 */
import { sb } from './supabase.js';
import { etat, chargerBoutiques, viderEtat } from './state.js';
import { naviguer } from './router.js';
import {
  esc, icone, logoComplet, normaliserTelephone, messageErreur, boutonOccupe, lienWhatsApp
} from './utils.js';

const DOMAINE_TECHNIQUE = 'tel.yoummabusiness.app';
const LONGUEUR_MIN_MDP = 6;

/** E-mail technique dérivé d'un numéro déjà normalisé. */
function emailDepuisTelephone(telephoneNormalise) {
  return `${telephoneNormalise}@${DOMAINE_TECHNIQUE}`;
}

/** Champ mot de passe avec bouton afficher / masquer. */
function champMotDePasse(id, libelle, autocomplete) {
  return `
    <div class="champ">
      <label for="${id}">${esc(libelle)}</label>
      <div class="champ-mdp">
        <input class="input" id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" minlength="${LONGUEUR_MIN_MDP}" required>
        <button type="button" class="btn-voir-mdp" data-voir="${id}" aria-label="Afficher le mot de passe" aria-pressed="false">${icone('oeil', 20)}</button>
      </div>
    </div>`;
}

/** Branche les boutons afficher / masquer le mot de passe. */
function brancherAffichageMotDePasse(racine) {
  racine.querySelectorAll('[data-voir]').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      const champ = racine.querySelector('#' + bouton.dataset.voir);
      const visible = champ.type === 'text';
      champ.type = visible ? 'password' : 'text';
      bouton.setAttribute('aria-pressed', String(!visible));
      bouton.setAttribute('aria-label', visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
      bouton.innerHTML = icone(visible ? 'oeil' : 'oeilBarre', 20);
    });
  });
}

/** Cadre commun aux deux écrans (fond navy, carte blanche, logo). */
function cadreAuth(titre, sousTitre, formulaire, piedCarte) {
  return `
    <div class="ecran-auth">
      <div class="carte-auth">
        ${logoComplet('clair')}
        <div class="auth-titres">
          <h1>${esc(titre)}</h1>
          <p>${esc(sousTitre)}</p>
        </div>
        ${formulaire}
        <p class="auth-bascule">${piedCarte}</p>
      </div>
      <p class="auth-pied">YOUMMA Business · un produit YOUMMA SARLU</p>
    </div>`;
}

/** Affiche un message d'erreur dans le formulaire (ou le masque si message vide). */
function afficherErreur(formulaire, message) {
  const zone = formulaire.querySelector('.erreur-form');
  zone.textContent = message;
  zone.hidden = !message;
}

/** Après connexion : tableau de bord si l'utilisateur a une boutique, sinon onboarding. */
async function entrerDansLApplication(session) {
  etat.session = session;
  await chargerBoutiques();
  naviguer(etat.boutique ? 'tableau-de-bord' : 'nouvelle-boutique', { remplacer: true });
}

/* ---------------------------------------------------------------- Connexion */

export function afficherConnexion(conteneur) {
  const lienOubli = lienWhatsApp('Bonjour YOUMMA, j’ai oublié le mot de passe de mon compte YOUMMA Business.');
  conteneur.innerHTML = cadreAuth(
    'Connexion',
    'Gérez votre boutique où que vous soyez.',
    `<form class="form-auth" novalidate>
      <div class="champ">
        <label for="telephone">Numéro de téléphone</label>
        <input class="input" id="telephone" name="telephone" type="tel" inputmode="tel" autocomplete="tel" placeholder="6XX XX XX XX" required>
      </div>
      ${champMotDePasse('mot-de-passe', 'Mot de passe', 'current-password')}
      <p class="erreur-form" role="alert" hidden></p>
      <button type="submit" class="btn btn-primaire btn-bloc btn-grand">Se connecter</button>
      <a class="lien-discret" href="${esc(lienOubli)}" target="_blank" rel="noopener">Mot de passe oublié ? Contactez YOUMMA sur WhatsApp</a>
    </form>`,
    'Pas encore de compte ? <a href="#/inscription">Créer un compte</a>'
  );

  const formulaire = conteneur.querySelector('form');
  brancherAffichageMotDePasse(formulaire);
  formulaire.addEventListener('submit', async (e) => {
    e.preventDefault();
    const telephone = normaliserTelephone(formulaire.telephone.value);
    const motDePasse = formulaire['mot-de-passe'].value;
    if (!telephone) return afficherErreur(formulaire, 'Numéro invalide. Exemple : 620 00 00 00.');
    if (motDePasse.length < LONGUEUR_MIN_MDP) return afficherErreur(formulaire, 'Le mot de passe contient au moins 6 caractères.');

    afficherErreur(formulaire, '');
    const bouton = formulaire.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Connexion…');
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: emailDepuisTelephone(telephone), password: motDePasse });
      if (error) throw error;
      await entrerDansLApplication(data.session);
    } catch (err) {
      afficherErreur(formulaire, messageErreur(err));
      boutonOccupe(bouton, false);
    }
  });
}

/* -------------------------------------------------------------- Inscription */

export function afficherInscription(conteneur) {
  conteneur.innerHTML = cadreAuth(
    'Créer un compte',
    'Quelques secondes suffisent. Votre numéro sera votre identifiant.',
    `<form class="form-auth" novalidate>
      <div class="champ">
        <label for="nom">Nom complet</label>
        <input class="input" id="nom" name="nom" type="text" autocomplete="name" placeholder="Ex. Mamadou Diallo" required>
      </div>
      <div class="champ">
        <label for="telephone">Numéro de téléphone</label>
        <input class="input" id="telephone" name="telephone" type="tel" inputmode="tel" autocomplete="tel" placeholder="6XX XX XX XX" required>
      </div>
      ${champMotDePasse('mot-de-passe', 'Mot de passe (6 caractères minimum)', 'new-password')}
      ${champMotDePasse('confirmation', 'Confirmer le mot de passe', 'new-password')}
      <p class="erreur-form" role="alert" hidden></p>
      <button type="submit" class="btn btn-primaire btn-bloc btn-grand">Créer mon compte</button>
    </form>`,
    'Déjà un compte ? <a href="#/connexion">Se connecter</a>'
  );

  const formulaire = conteneur.querySelector('form');
  brancherAffichageMotDePasse(formulaire);
  formulaire.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nom = formulaire.nom.value.trim();
    const telephone = normaliserTelephone(formulaire.telephone.value);
    const motDePasse = formulaire['mot-de-passe'].value;
    if (nom.length < 2) return afficherErreur(formulaire, 'Indiquez votre nom complet.');
    if (!telephone) return afficherErreur(formulaire, 'Numéro invalide. Exemple : 620 00 00 00.');
    if (motDePasse.length < LONGUEUR_MIN_MDP) return afficherErreur(formulaire, 'Le mot de passe doit contenir au moins 6 caractères.');
    if (motDePasse !== formulaire.confirmation.value) return afficherErreur(formulaire, 'Les deux mots de passe ne sont pas identiques.');

    afficherErreur(formulaire, '');
    const bouton = formulaire.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Création du compte…');
    try {
      const { data, error } = await sb.auth.signUp({
        email: emailDepuisTelephone(telephone),
        password: motDePasse,
        options: { data: { nom, telephone } }
      });
      if (error) throw error;
      // Supabase renvoie un utilisateur sans « identities » quand le compte existe déjà.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('User already registered');
      }
      if (!data.session) {
        // Confirmation d'e-mail activée côté Supabase : impossible avec un e-mail technique.
        throw new Error('Email not confirmed');
      }
      await entrerDansLApplication(data.session);
    } catch (err) {
      afficherErreur(formulaire, messageErreur(err));
      boutonOccupe(bouton, false);
    }
  });
}

/* -------------------------------------------------------------- Déconnexion */

/** Ferme la session et revient à l'écran de connexion. */
export async function deconnecter() {
  try {
    await sb.auth.signOut();
  } catch (err) {
    console.warn('[YOUMMA] Déconnexion hors ligne :', err);
  }
  viderEtat();
  document.querySelector('.shell')?.remove();
  naviguer('connexion', { remplacer: true });
}
