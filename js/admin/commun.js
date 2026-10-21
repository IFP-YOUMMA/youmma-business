/**
 * admin/commun.js — Outils partagés du panneau d'administration YOUMMA.
 *
 *  - appel des RPC admin (le serveur contrôle le rôle ; ACCES_REFUSE → « Action réservée au super admin ») ;
 *  - fonction Edge admin-comptes (création de boutique, mot de passe provisoire, blocage) ;
 *  - libellés (licences, journal), export CSV pour Excel, fenêtre « mot de passe provisoire ».
 */
import { sb } from '../supabase.js';
import {
  esc, icone, toast, ouvrirModale, messageErreur, formatGNF, formatNombre, formatDate, formatTelephone, copierTexte, TYPES_ACTIVITE
} from '../utils.js';

/** Administrateur connecté : { user_id, nom, role, telephone }. */
export const admin = { moi: null };
export const estSuper = () => admin.moi?.role === 'super_admin';

/** Message d'erreur du panneau (ACCES_REFUSE : action réservée au super admin). */
export function erreurAdmin(err) {
  const brut = String(err?.message || err?.erreur || err || '');
  if (brut.includes('ACCES_REFUSE')) return 'Action réservée au super admin.';
  return messageErreur(err);
}

/** Appel RPC : renvoie data, ou lève une erreur. */
export async function rpc(nom, params = {}) {
  const { data, error } = await sb.rpc(nom, params);
  if (error) throw error;
  return data;
}
export const premiere = (r) => (Array.isArray(r) ? r[0] : r) ?? null;
/** Première valeur définie parmi plusieurs noms de champ (tolère de petites variations de la RPC). */
export const champ = (o, ...cles) => { for (const c of cles) if (o?.[c] !== undefined && o?.[c] !== null) return o[c]; return undefined; };
export const liste = (r, ...cles) => (Array.isArray(r) ? r : (cles.map((c) => r?.[c]).find(Array.isArray) || []));

/** Fonction Edge admin-comptes (le JWT de la session est envoyé automatiquement). */
export async function appelComptes(corps) {
  const { data, error } = await sb.functions.invoke('admin-comptes', { body: corps });
  if (error) {
    let code = error.message;
    try { const r = await error.context?.json?.(); if (r?.erreur) code = r.erreur; } catch { /* corps illisible */ }
    throw Object.assign(new Error(code), { code });
  }
  if (data?.erreur) throw Object.assign(new Error(data.erreur), { code: data.erreur });
  return data;
}

/* ------------------------------------------------------------ Libellés */

export const TYPES = TYPES_ACTIVITE;

/** Activités (table « activites » : 10 valeurs, emoji, couleur) ; repli sur la liste interne. Mises en cache. */
let activitesCache = null;
export async function chargerActivites() {
  if (activitesCache) return activitesCache;
  const { data } = await sb.from('activites').select('code, nom, emoji, couleur, ordre').order('ordre');
  activitesCache = data?.length ? data : Object.entries(TYPES_ACTIVITE).map(([code, nom], i) => ({ code, nom, emoji: '', couleur: '', ordre: i }));
  return activitesCache;
}
/** Tuiles radio des activités (formulaires admin). */
export function tuilesActivites(activites, nom, choisie = '') {
  return `<div class="grille-types adm-grille-activites">${activites.map((a) => `
    <label class="carte-type ${a.code === choisie ? 'choisie' : ''}" ${a.couleur ? `style="--couleur-activite:${esc(a.couleur)}"` : ''}>
      <input type="radio" name="${esc(nom)}" value="${esc(a.code)}" ${a.code === choisie ? 'checked' : ''} required>
      <span class="carte-type-icone">${a.emoji ? `<span class="carte-type-emoji" aria-hidden="true">${esc(a.emoji)}</span>` : icone('magasin', 22, 1.8)}</span>
      <span class="carte-type-libelle">${esc(a.nom)}</span>
    </label>`).join('')}</div>`;
}
/** Met en avant la tuile cochée (à brancher sur le formulaire). */
export function suivreTuiles(form) {
  form.addEventListener('change', (e) => {
    if (e.target.type !== 'radio' || !e.target.closest('.carte-type')) return;
    form.querySelectorAll('.carte-type').forEach((c) => c.classList.toggle('choisie', c.querySelector('input').checked));
  });
}
export const MODES_PAIEMENT_YOUMMA = {
  especes: 'Espèces', orange_money: 'Orange Money', mtn_momo: 'MTN MoMo', virement: 'Virement', chapchap: 'ChapChap Pay', offert: 'Offert'
};

const ETATS_LICENCE = {
  active: ['Active', 'vert'], grace: ['Délai de grâce', 'orange'], lecture_seule: ['Lecture seule', 'rouge'],
  expiree: ['Expirée', 'rouge'], suspendue: ['Suspendue', 'gris'], essai: ['Essai', 'orange']
};
const COULEURS_FORMULES = { essai: 'orange', essentiel: 'vert', pro: 'or', premium: 'violet' };

/** Pastille de licence : formule (couleur) ou état anormal (expirée, suspendue). */
export function badgeLicence(b) {
  const etat = champ(b, 'etat_licence', 'etat');
  if (b?.suspendue || etat === 'suspendue') return '<span class="pastille-admin gris">Suspendue</span>';
  if (etat === 'lecture_seule' || etat === 'expiree') return '<span class="pastille-admin rouge">Expirée</span>';
  if (etat === 'grace') return '<span class="pastille-admin rouge">Grâce</span>';
  const formule = String(champ(b, 'licence_formule', 'formule') || 'essai').toLowerCase();
  const nom = champ(b, 'formule_nom') || formule.charAt(0).toUpperCase() + formule.slice(1);
  return `<span class="pastille-admin ${COULEURS_FORMULES[formule] || 'marque'}">${esc(nom)}</span>`;
}
export function etatLicenceTexte(etat) {
  const [libelle, couleur] = ETATS_LICENCE[etat] || ETATS_LICENCE.active;
  return `<span class="pastille-admin ${couleur}">${esc(libelle)}</span>`;
}

/** « il y a 4 min », « hier », « 12 oct. ». */
export function ilYa(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  if (j === 1) return 'hier';
  if (j < 30) return `il y a ${j} j`;
  return formatDate(d, 'court');
}

/** Avatar d'une boutique : son logo s'il existe, sinon ses initiales. */
export function avatarBoutique(b = {}, grand = false) {
  return `<span class="adm-avatar ${grand ? 'grand' : ''} ${b.logo_url ? 'avec-logo' : ''}">${b.logo_url ? `<img src="${esc(b.logo_url)}" alt="" width="${grand ? 56 : 36}" height="${grand ? 56 : 36}" loading="lazy" decoding="async">` : esc(initiales(b.nom))}</span>`;
}

export function initiales(nom) {
  const mots = String(nom || '').trim().split(/\s+/).filter(Boolean);
  return ((mots[0]?.[0] || '') + (mots[1]?.[0] || '')).toUpperCase() || '?';
}

export const telLocal = (t) => (t ? formatTelephone(t).replace(/^\+224\s*/, '') : '—');
export const lienWa = (tel, texte = '') => `https://wa.me/${String(tel || '').replace(/\D/g, '')}${texte ? `?text=${encodeURIComponent(texte)}` : ''}`;
/** Racine de l'appli des boutiques (…/youmma-business/). */
export const urlAppli = () => new URL('../', location.href.split('#')[0]).href;
export const urlVitrine = (slug) => new URL(`../b/?s=${encodeURIComponent(slug)}`, location.href.split('#')[0]).href;
export const gnf = (n) => formatGNF(Number(n) || 0);
export const nombre = (n) => formatNombre(Number(n) || 0);

/** Libellés du journal (admin_actions.action) en français. */
const ACTIONS = {
  boutique_creee: 'Boutique créée pour un client',
  licence_prolongee: 'Licence prolongée',
  licence_jours: 'Licence prolongée',
  licence_mois: 'Licence prolongée',
  licence_date: 'Date de fin de licence modifiée',
  licence: 'Licence modifiée',
  essai_prolonge: 'Essai prolongé',
  formule_changee: 'Formule changée',
  modules: 'Modules modifiés',
  modules_modifies: 'Modules modifiés',
  suspension: 'Boutique suspendue',
  boutique_suspendue: 'Boutique suspendue',
  reactivation: 'Boutique réactivée',
  boutique_reactivee: 'Boutique réactivée',
  note: 'Note interne modifiée',
  note_interne: 'Note interne modifiée',
  recharge_sms: 'SMS ajoutés',
  recharger_sms: 'SMS ajoutés',
  paiement_enregistre: 'Paiement enregistré',
  paiement_valide: 'Paiement validé',
  option: 'Option boutique en ligne',
  admin_option: 'Option boutique en ligne',
  option_tarif: 'Tarif de l’option modifié',
  paiement_refuse: 'Paiement refusé',
  relance_licence: 'Relance de licence envoyée',
  relances_licence: 'Relances de licence envoyées',
  formule_modifiee: 'Formule modifiée',
  sms_renvoyes: 'SMS renvoyés',
  vitrine_coupee: 'Boutique en ligne coupée',
  vitrine_reactivee: 'Boutique en ligne réactivée',
  vitrine: 'Boutique en ligne modifiée',
  annonce_publiee: 'Annonce publiée',
  annonce_retiree: 'Annonce retirée',
  support_reponse: 'Réponse au support',
  aide_reponse: 'Réponse au support',
  support_statut: 'Statut d’une demande d’aide',
  aide_statut: 'Statut d’une demande d’aide',
  equipe_ajout: 'Membre de l’équipe ajouté',
  equipe_ajoute: 'Membre de l’équipe ajouté',
  equipe_modif: 'Membre de l’équipe modifié',
  equipe_modifie: 'Membre de l’équipe modifié',
  parametres: 'Paramètres modifiés',
  parametres_modifies: 'Paramètres modifiés',
  mdp_reinitialise: 'Mot de passe provisoire créé',
  utilisateur_bloque: 'Compte bloqué',
  utilisateur_debloque: 'Compte débloqué',
  maintenance: 'Mode maintenance modifié'
};
export function libelleAction(action) {
  const a = String(action || '');
  return ACTIONS[a] || (a ? a.charAt(0).toUpperCase() + a.slice(1).replace(/_/g, ' ') : 'Action');
}
/** Détails lisibles d'une ligne de journal (jsonb). */
export function detailsAction(details) {
  if (!details || typeof details !== 'object') return details ? String(details) : '';
  const morceaux = [];
  const d = details;
  if (d.formule) morceaux.push(`formule ${d.formule}`);
  if (d.jours) morceaux.push(`${d.jours} j`);
  if (d.mois) morceaux.push(`${d.mois} mois`);
  if (d.fin || d.nouvelle_fin) morceaux.push(`jusqu’au ${formatDate(d.fin || d.nouvelle_fin, 'court')}`);
  if (d.nb || d.nb_sms) morceaux.push(`${nombre(d.nb || d.nb_sms)} SMS`);
  if (d.montant) morceaux.push(gnf(d.montant));
  if (d.motif) morceaux.push(`motif : ${d.motif}`);
  if (d.reference) morceaux.push(`réf. ${d.reference}`);
  if (d.role) morceaux.push(d.role === 'super_admin' ? 'super admin' : d.role);
  return morceaux.join(' · ');
}

/* ------------------------------------------------------------ Export CSV (Excel) */

/** CSV UTF-8 avec BOM, séparateur « ; », lignes CRLF : s'ouvre directement dans Excel avec les accents. */
export function exporterCsv(nomFichier, colonnes, lignes) {
  const cellule = (v) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const contenu = [colonnes.map(([titre]) => cellule(titre)).join(';'),
    ...lignes.map((l) => colonnes.map(([, f]) => cellule(f(l))).join(';'))].join('\r\n');
  const blob = new Blob(['﻿', contenu], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nomFichier;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return contenu;
}

/* ------------------------------------------------------------ Mot de passe provisoire */

/** Fenêtre : mot de passe en grand, Copier, Envoyer par WhatsApp au propriétaire. */
export function afficherMotDePasse({ titre = 'Mot de passe provisoire', telephone, motDePasse, nom = '' }) {
  const message = `Bonjour${nom ? ` ${nom}` : ''}, votre compte YOUMMA Business : téléphone ${telLocal(telephone)}, mot de passe provisoire ${motDePasse}, à changer à la première connexion. Lien : ${urlAppli()}`;
  const { el } = ouvrirModale({
    titre,
    contenu: `
      <p class="texte-modale">À transmettre au client. Il devra choisir son propre mot de passe à la première connexion.</p>
      <div class="mdp-provisoire" aria-label="Mot de passe provisoire">${esc(motDePasse)}</div>
      <p class="discret centre">Téléphone de connexion : <strong>${esc(telLocal(telephone))}</strong></p>
      <div class="modale-actions">
        <button type="button" class="btn btn-secondaire" data-action="copier">${icone('copier', 18, 2)} Copier</button>
        <a class="btn btn-whatsapp" href="${esc(lienWa(telephone, message))}" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} Envoyer par WhatsApp</a>
        <button type="button" class="btn btn-primaire" data-fermer>Terminé</button>
      </div>`
  });
  el.querySelector('[data-action="copier"]').addEventListener('click', async () => {
    const ok = await copierTexte(message);
    toast(ok ? 'Message copié (téléphone et mot de passe).' : 'Copie impossible : notez le mot de passe.', ok ? 'succes' : 'erreur');
  });
}

/** Nouveau mot de passe provisoire pour un utilisateur (confirmation puis fonction Edge). */
export async function nouveauMotDePasse(utilisateur, confirmer) {
  if (!(await confirmer(`Créer un nouveau mot de passe provisoire pour ${utilisateur.nom || telLocal(utilisateur.telephone)} ? L’ancien ne marchera plus.`,
    { titre: 'Nouveau mot de passe', libelleOk: 'Créer le mot de passe' }))) return;
  try {
    const r = await appelComptes({ action: 'reinitialiser_mdp', user_id: utilisateur.user_id });
    afficherMotDePasse({ telephone: utilisateur.telephone, motDePasse: r.mot_de_passe, nom: utilisateur.nom });
  } catch (err) {
    toast(erreurAdmin(err), 'erreur');
  }
}

/** Tableau → cartes sous 768 px : chaque cellule porte data-label. */
export function tableau(colonnes, lignes, { classe = '', vide = 'Aucune donnée.', attributsLigne = () => '' } = {}) {
  if (!lignes.length) return `<p class="vide-admin">${esc(vide)}</p>`;
  return `
    <div class="tableau-adm-cadre">
      <table class="tableau-adm ${classe}">
        <thead><tr>${colonnes.map(([titre, , opt = {}]) => `<th class="${opt.droite ? 'droite' : ''}">${esc(titre)}</th>`).join('')}</tr></thead>
        <tbody>${lignes.map((l) => `<tr ${attributsLigne(l)}>${colonnes.map(([titre, f, opt = {}]) => `<td data-label="${esc(titre)}" class="${opt.droite ? 'droite' : ''}">${f(l)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`;
}

export function blocErreur(err) {
  return `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(erreurAdmin(err))}</p>`;
}
export const squelette = (n = 3) => '<span class="squelette" style="height:18px;margin:8px 0"></span>'.repeat(n);
