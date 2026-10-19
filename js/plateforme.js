/**
 * plateforme.js — Ce que la plateforme YOUMMA impose à l'appli des boutiques :
 *
 *  - maintenance (etat_plateforme) : écran plein pour les boutiques, bandeau pour l'équipe YOUMMA ;
 *  - licence (etat_licence) : bandeau J-7…J-1, délai de grâce, lecture seule, suspension, et
 *    désactivation des boutons d'écriture en lecture seule (avant même l'erreur LICENCE_EXPIREE) ;
 *  - annonces (mes_annonces / fermer_annonce) : un bandeau bleu, le plus récent, fermable ;
 *  - mot de passe provisoire (mon_mdp_temporaire) : écran obligatoire « Choisissez votre mot de passe ».
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import { esc, icone, logoComplet, formatDate, boutonOccupe, messageErreur, toast, lireStockage, ecrireStockage } from './utils.js';

const premiere = (r) => (Array.isArray(r) ? r[0] : r) || null;
const LONGUEUR_MIN_MDP = 6;

/* =========================================================================
   Plateforme : maintenance, WhatsApp du support
   ========================================================================= */

export async function chargerEtatPlateforme() {
  try {
    const { data, error } = await sb.rpc('etat_plateforme');
    if (error) throw error;
    etat.plateforme = premiere(data) || {};
  } catch (err) {
    console.warn('[YOUMMA] État de la plateforme indisponible :', err);
    etat.plateforme = etat.plateforme || {};
  }
  return etat.plateforme;
}

/** Numéro WhatsApp du support YOUMMA (paramètre de la plateforme), format 224XXXXXXXXX. */
export function whatsappSupport() {
  return String(etat.plateforme?.support_whatsapp || '224620836081').replace(/\D/g, '');
}
export const lienSupport = (message = '') => `https://wa.me/${whatsappSupport()}${message ? `?text=${encodeURIComponent(message)}` : ''}`;

/** Écran plein « Maintenance » (boutiques). continuer : affiche un lien « Accès équipe YOUMMA ». */
export function afficherMaintenance(conteneur, { continuer = null } = {}) {
  const p = etat.plateforme || {};
  conteneur.innerHTML = `
    <div class="ecran-auth ecran-maintenance">
      ${logoComplet('sombre')}
      <div class="carte-auth">
        <span class="maintenance-icone">${icone('horloge', 40, 1.8)}</span>
        <div class="auth-titres">
          <h1>Maintenance en cours</h1>
          <p>${esc(p.message || 'YOUMMA Business est en maintenance pour quelques minutes. Merci de votre patience.')}</p>
        </div>
        <a class="btn btn-whatsapp btn-bloc btn-grand" href="${esc(lienSupport('Bonjour YOUMMA, j’ai une question pendant la maintenance.'))}" target="_blank" rel="noopener">${icone('whatsapp', 20, 2)} WhatsApp du support</a>
        <button type="button" class="btn btn-secondaire btn-bloc" data-action="recharger">Réessayer</button>
        ${continuer ? '<button type="button" class="btn-lien" data-action="equipe">Accès équipe YOUMMA</button>' : ''}
      </div>
    </div>`;
  conteneur.querySelector('[data-action="recharger"]').addEventListener('click', () => location.reload());
  conteneur.querySelector('[data-action="equipe"]')?.addEventListener('click', continuer);
}

/* =========================================================================
   Mot de passe provisoire
   ========================================================================= */

export async function mdpTemporaireExige() {
  try {
    const { data, error } = await sb.rpc('mon_mdp_temporaire');
    if (error) throw error;
    const v = premiere(data);
    return v === true || v?.temporaire === true || data === true;
  } catch (err) {
    console.warn('[YOUMMA] Vérification du mot de passe provisoire impossible :', err);
    return false;
  }
}

/** Écran obligatoire : choisir son mot de passe (6 caractères min., confirmation). */
export function afficherChoixMotDePasse(conteneur, apres) {
  conteneur.innerHTML = `
    <div class="ecran-auth">
      ${logoComplet('sombre')}
      <div class="carte-auth">
        <div class="auth-titres">
          <h1>Choisissez votre mot de passe</h1>
          <p>Votre compte a été créé (ou réinitialisé) par l’équipe YOUMMA avec un mot de passe provisoire. Choisissez maintenant le vôtre : vous l’utiliserez à chaque connexion.</p>
        </div>
        <form class="form-auth" novalidate>
          <div class="champ"><label for="mdp-nouveau-obligatoire">Nouveau mot de passe</label>
            <input id="mdp-nouveau-obligatoire" name="mdp" class="input" type="password" autocomplete="new-password" minlength="${LONGUEUR_MIN_MDP}" required></div>
          <div class="champ"><label for="mdp-confirmation-obligatoire">Confirmer</label>
            <input id="mdp-confirmation-obligatoire" name="confirmation" class="input" type="password" autocomplete="new-password" minlength="${LONGUEUR_MIN_MDP}" required></div>
          <p class="erreur-form" role="alert" hidden></p>
          <button type="submit" class="btn btn-primaire btn-bloc btn-grand" data-lecture-ok>Enregistrer mon mot de passe</button>
        </form>
      </div>
    </div>`;
  const form = conteneur.querySelector('form');
  const zoneErreur = form.querySelector('.erreur-form');
  const erreur = (m) => { zoneErreur.textContent = m; zoneErreur.hidden = !m; };
  form.mdp.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mdp = form.mdp.value;
    if (mdp.length < LONGUEUR_MIN_MDP) return erreur('Le mot de passe doit contenir au moins 6 caractères.');
    if (mdp !== form.confirmation.value) return erreur('Les deux mots de passe ne sont pas identiques.');
    erreur('');
    const bouton = form.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Enregistrement…');
    const { error } = await sb.auth.updateUser({ password: mdp });
    if (error) { boutonOccupe(bouton, false); erreur(messageErreur(error)); return; }
    const fin = await sb.rpc('mdp_change_fait');
    boutonOccupe(bouton, false);
    if (fin.error) { erreur(messageErreur(fin.error)); return; }
    toast('Mot de passe enregistré.', 'succes');
    apres();
  });
  return undefined;
}

/**
 * Contrôles après connexion (démarrage ou nouvelle connexion) : maintenance puis mot de passe provisoire.
 * Renvoie true si un écran bloquant a été affiché ; continuer() relance la suite normale.
 */
export async function controlesApresConnexion(continuer) {
  const app = document.getElementById('app');
  if (etat.plateforme?.maintenance && !etat.adminPlateforme) {
    afficherMaintenance(app);
    return true;
  }
  if (etat.session && await mdpTemporaireExige()) {
    afficherChoixMotDePasse(app, continuer);
    return true;
  }
  return false;
}

/* =========================================================================
   Licence : état, bandeau, lecture seule
   ========================================================================= */

export async function chargerEtatLicence(boutique = etat.boutique) {
  if (!boutique) return null;
  try {
    const { data, error } = await sb.rpc('etat_licence', { p_boutique: boutique.id });
    if (error) throw error;
    if (boutique === etat.boutique) etat.licence = premiere(data);
  } catch (err) {
    console.warn('[YOUMMA] État de la licence indisponible :', err);
  }
  appliquerLectureSeule();
  return etat.licence;
}

export const enLectureSeule = () => ['lecture_seule', 'suspendue'].includes(etat.licence?.etat);
export const MESSAGE_LECTURE_SEULE = 'Boutique en lecture seule : vous pouvez consulter vos données mais plus vendre ni modifier.';

/** Bandeau licence (null si rien à signaler). Vendeur : seulement lecture seule / suspension. */
export function bandeauLicenceHTML() {
  const l = etat.licence;
  if (!l?.etat) return '';
  const responsable = peut('parametres_boutique');
  const renouveler = responsable ? `<a class="btn btn-bandeau" href="#/licence">Renouveler</a>` : '';
  if (l.etat === 'suspendue') {
    return `<div class="bandeau-licence" role="alert">${icone('alerte', 20, 2)}<span>Boutique suspendue${l.motif_suspension ? ` : ${esc(l.motif_suspension)}` : ''}. Contactez YOUMMA.</span>${renouveler}</div>`;
  }
  if (l.etat === 'lecture_seule') {
    return `<div class="bandeau-licence" role="alert">${icone('alerte', 20, 2)}<span>${MESSAGE_LECTURE_SEULE}</span>${renouveler}</div>`;
  }
  if (!responsable) return '';
  if (l.etat === 'grace') {
    const restant = l.fin_grace ? Math.max(0, Math.ceil((new Date(`${String(l.fin_grace).slice(0, 10)}T23:59:59Z`) - Date.now()) / 864e5)) : null;
    return `<div class="bandeau-licence" role="alert">${icone('alerte', 20, 2)}<span>Licence expirée — encore ${restant ?? '?'} jour${restant > 1 ? 's' : ''} avant la lecture seule.</span>${renouveler}</div>`;
  }
  const j = Number(l.jours_restants);
  if (l.etat === 'active' && l.fin && j >= 0 && j <= 7) {
    return `<div class="bandeau-licence bandeau-licence-bientot" role="status">${icone('horloge', 20, 2)}<span>Votre licence se termine le ${esc(formatDate(l.fin, 'jourMois'))}${j <= 1 ? (j === 0 ? ' (aujourd’hui)' : ' (demain)') : ` (dans ${j} jours)`}.</span>${renouveler}</div>`;
  }
  return '';
}

export function majBandeauLicence() {
  const zone = document.querySelector('[data-zone="bandeau-licence"]');
  if (zone) zone.innerHTML = bandeauLicenceHTML();
}

/* Désactivation des boutons d'écriture en lecture seule (sans attendre l'erreur du serveur). */
const SELECTEUR_ECRITURE = [
  '#vue button[type="submit"]', '#vue button.btn-primaire', '#vue button.btn-danger', '#vue button.btn-valider',
  '.modale-fond button[type="submit"]', '.modale-fond button.btn-primaire', '.modale-fond button.btn-danger',
  '#vue .interrupteur', '#vue [data-ajouter]', '#vue [data-action="ajouter"]'
].join(', ');
let observateur = null;

function verrouiller(racine = document) {
  if (!enLectureSeule()) return;
  racine.querySelectorAll?.(SELECTEUR_ECRITURE).forEach((b) => {
    if (b.closest('[data-lecture-ok]') || b.hasAttribute('data-fermer') || b.hasAttribute('data-ok') || b.dataset.verrouLicence) return;
    b.dataset.verrouLicence = '1';
    b.disabled = true;
    b.setAttribute('aria-disabled', 'true');
    b.title = MESSAGE_LECTURE_SEULE;
  });
}

/** Active / retire le verrouillage selon l'état de licence courant. */
export function appliquerLectureSeule() {
  const actif = enLectureSeule();
  document.body.classList.toggle('lecture-seule', actif);
  majBandeauLicence();
  if (!actif) {
    observateur?.disconnect();
    observateur = null;
    document.querySelectorAll('[data-verrou-licence]').forEach((b) => {
      delete b.dataset.verrouLicence;
      b.disabled = false;
      b.removeAttribute('aria-disabled');
      if (b.title === MESSAGE_LECTURE_SEULE) b.removeAttribute('title');
    });
    return;
  }
  verrouiller();
  if (!observateur) {
    observateur = new MutationObserver(() => verrouiller());
    observateur.observe(document.body, { childList: true, subtree: true });
  }
}

/* =========================================================================
   Annonces
   ========================================================================= */

export async function afficherAnnonces() {
  const zone = document.querySelector('[data-zone="bandeau-annonce"]');
  if (!zone || !etat.boutique) return;
  const idB = etat.boutique.id;
  const { data, error } = await sb.rpc('mes_annonces', { p_boutique: idB });
  if (error || !zone.isConnected || etat.boutique?.id !== idB) { if (error) console.warn('[YOUMMA] Annonces :', error); return; }
  const fermees = lireStockage('yb_annonces_fermees', []) || [];
  const liste = (Array.isArray(data) ? data : []).filter((a) => !fermees.includes(a.id))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const a = liste[0];
  if (!a) { zone.innerHTML = ''; return; }
  zone.innerHTML = `
    <div class="bandeau-annonce" role="status">
      ${icone('sms', 18, 2)}
      <span>${esc(a.texte)}</span>
      <button type="button" class="btn-icone btn-fermer-bandeau" data-fermer-annonce="${esc(a.id)}" aria-label="Fermer l’annonce" data-lecture-ok>${icone('fermer', 18, 2)}</button>
    </div>`;
  zone.onclick = async (e) => {
    const b = e.target.closest('[data-fermer-annonce]');
    if (!b) return;
    zone.innerHTML = '';
    ecrireStockage('yb_annonces_fermees', [...fermees, a.id].slice(-50));
    const { error: err } = await sb.rpc('fermer_annonce', { p_annonce: a.id });
    if (err) console.warn('[YOUMMA] Annonce non fermée côté serveur :', err);
    afficherAnnonces();
  };
}

/** Bandeau maintenance pour l'équipe YOUMMA (qui peut continuer à travailler). */
export function bandeauMaintenanceHTML() {
  if (!etat.plateforme?.maintenance || !etat.adminPlateforme) return '';
  return `<div class="bandeau-licence bandeau-maintenance" role="status">${icone('horloge', 20, 2)}<span>Mode maintenance actif : les boutiques voient l’écran de maintenance. Vous pouvez continuer (équipe YOUMMA).</span><a class="btn btn-bandeau" href="admin/#/parametres">Paramètres</a></div>`;
}
