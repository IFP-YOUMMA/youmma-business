/**
 * utils.js — Outils partagés : échappement HTML, formatage (GNF, quantités, dates),
 * téléphone guinéen, traduction des erreurs, toasts, modales, icônes et logo.
 */

export const FUSEAU = 'Africa/Conakry';
// Séparateur de milliers et espace avant l’unité : espace insécable normale (U+00A0),
// bien visible (l’espace fine U+202F était presque invisible avec Manrope).
const ESPACE_INSECABLE = '\u00A0';
const MS_JOUR = 86400000;

/* =========================================================================
   Échappement et petites aides
   ========================================================================= */

/** Échappe une valeur avant de l'insérer dans du HTML (protection XSS). */
export function esc(valeur) {
  return String(valeur ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Met la première lettre en majuscule. */
export function capitaliser(texte) {
  const t = String(texte || '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Premier mot d'un nom complet (« Mamadou Diallo » → « Mamadou »). */
export function prenom(nomComplet) {
  return String(nomComplet || '').trim().split(/\s+/)[0] || '';
}

/** Initiales sur deux lettres (« Entreprise Bah BTP » → « EB »). */
export function initiales(nom) {
  const mots = String(nom || '').trim().split(/\s+/).filter(Boolean);
  return ((mots[0]?.[0] || '') + (mots[1]?.[0] || '')).toUpperCase() || '?';
}

/** Lit un nombre saisi par l'utilisateur (accepte « 2 500 », « 2,5 »). Renvoie null si vide ou invalide. */
export function lireNombre(saisie) {
  const texte = String(saisie ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (texte === '') return null;
  const n = Number(texte);
  return Number.isFinite(n) ? n : null;
}

const TAILLE_LOT = 1000;

/**
 * Charge toutes les lignes d'une requête Supabase par lots de 1 000 (limite par défaut de l'API).
 * requete(debut, fin) doit renvoyer la requête avec .range(debut, fin).
 */
export async function chargerParLots(requete) {
  const lignes = [];
  for (let debut = 0; ; debut += TAILLE_LOT) {
    const { data, error } = await requete(debut, debut + TAILLE_LOT - 1);
    if (error) throw error;
    lignes.push(...data);
    if (data.length < TAILLE_LOT) return lignes;
  }
}

/** Retarde l'appel d'une fonction tant que l'utilisateur continue de taper. */
export function differer(fonction, delai = 250) {
  let minuterie;
  return (...args) => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => fonction(...args), delai);
  };
}

/** Lecture sûre du localStorage (navigation privée, stockage bloqué…). */
export function lireStockage(cle, defaut = null) {
  try {
    const valeur = localStorage.getItem(cle);
    return valeur === null ? defaut : JSON.parse(valeur);
  } catch {
    return defaut;
  }
}

/** Écriture sûre du localStorage. `null` supprime la clé. Renvoie false en cas d'échec. */
export function ecrireStockage(cle, valeur) {
  try {
    if (valeur === null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, JSON.stringify(valeur));
    return true;
  } catch {
    return false;
  }
}

/* =========================================================================
   Nombres, montants et quantités
   ========================================================================= */

/** « 2450000 » → « 2 450 000 » (espaces fines insécables), décimales à la française. */
export function formatNombre(valeur, decimalesMax = 0) {
  const arrondi = Number((Number(valeur) || 0).toFixed(decimalesMax));
  const [entier, decimales] = Math.abs(arrondi).toString().split('.');
  const groupes = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE_INSECABLE);
  return (arrondi < 0 ? '−' : '') + groupes + (decimales ? ',' + decimales : '');
}

/**
 * Champ de montant en GNF (type texte, clavier numérique) : ne garde que les chiffres et
 * ajoute les espaces de milliers pendant la saisie. Renvoie le montant (ou null si vide).
 */
export function formaterSaisieMontant(champ) {
  const chiffres = champ.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const montant = chiffres ? Number(chiffres) : null;
  champ.value = chiffres ? formatNombre(montant) : '';
  return montant;
}

/** « 2450000 » → « 2 450 000 GNF » (sans décimales). */
export function formatGNF(valeur) {
  return formatNombre(Math.round(Number(valeur) || 0)) + ESPACE_INSECABLE + 'GNF';
}

/** Montant en millions pour l'histogramme : 4850000 → « 4,85 M ». */
export function formatMillions(valeur) {
  const millions = (Number(valeur) || 0) / 1e6;
  if (millions === 0) return '0';
  const arrondi = Number(millions.toFixed(millions >= 10 ? 1 : 2));
  if (arrondi === 0) return '< 0,01' + ESPACE_INSECABLE + 'M';
  return String(arrondi).replace('.', ',') + ESPACE_INSECABLE + 'M';
}

/** Unités proposées dans le formulaire article (saisie libre possible). */
export const UNITES = ['pièce', 'sac', 'barre', 'feuille', 'kg', 'tonne', 'm²', 'm', 'litre', 'seau', 'carton', 'voyage', 'paquet'];

const PLURIELS = {
  'pièce': 'pièces', sac: 'sacs', barre: 'barres', feuille: 'feuilles', tonne: 'tonnes',
  litre: 'litres', seau: 'seaux', carton: 'cartons', voyage: 'voyages', paquet: 'paquets'
};
const UNITES_DIVISIBLES = ['kg', 'tonne', 'm²', 'm2', 'm', 'litre', 'l'];

/** Vrai si l'unité accepte des quantités décimales (kg, m², litre…). */
export function uniteDivisible(unite) {
  return UNITES_DIVISIBLES.includes(String(unite || '').trim().toLowerCase());
}

/** « 8, sac » → « 8 sacs » ; « 2,5, kg » → « 2,5 kg ». */
export function formatQuantite(quantite, unite) {
  const n = Number(quantite) || 0;
  const u = String(unite || '').trim();
  const libelle = Math.abs(n) >= 2 ? (PLURIELS[u.toLowerCase()] || u) : u;
  return formatNombre(n, 3) + (libelle ? ESPACE_INSECABLE + libelle : '');
}

/* =========================================================================
   Dates (fuseau Africa/Conakry)
   ========================================================================= */

const FORMATS_DATE = {
  long: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  court: { day: '2-digit', month: '2-digit', year: 'numeric' },
  jourMois: { day: '2-digit', month: '2-digit' },
  heure: { hour: '2-digit', minute: '2-digit', hour12: false },
  complet: { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false },
  jourCourt: { weekday: 'short' },
  moisAnnee: { month: 'long', year: 'numeric' }
};

/** Formate une date en français : 'long' → « samedi 17 octobre 2026 », 'heure' → « 09:42 »… */
export function formatDate(date, format = 'long') {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, ...FORMATS_DATE[format] }).format(d);
}

/** Date du jour à Conakry au format AAAA-MM-JJ, éventuellement décalée de n jours. */
export function dateISO(decalageJours = 0) {
  const d = new Date(Date.now() + decalageJours * MS_JOUR);
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Ajoute n jours à une date AAAA-MM-JJ (n négatif pour reculer). */
export function decalerDate(iso, n) {
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}

/**
 * Bornes d'une période usuelle, en dates AAAA-MM-JJ incluses (fuseau Conakry) :
 * 'jour' | '7j' | 'mois' | 'moisDernier'.
 */
export function bornesPeriode(code) {
  const aujourdhui = dateISO();
  const debutMois = aujourdhui.slice(0, 8) + '01';
  if (code === '7j') return { du: decalerDate(aujourdhui, -6), au: aujourdhui };
  if (code === 'mois') return { du: debutMois, au: aujourdhui };
  if (code === 'moisDernier') {
    const finMoisDernier = decalerDate(debutMois, -1);
    return { du: finMoisDernier.slice(0, 8) + '01', au: finMoisDernier };
  }
  return { du: aujourdhui, au: aujourdhui };
}

/** Nombre de jours entre aujourd'hui et une date (positif = dans le futur, négatif = dépassée). */
export function ecartJours(date) {
  const [a, m, j] = String(date).slice(0, 10).split('-').map(Number);
  const [a0, m0, j0] = dateISO().split('-').map(Number);
  return Math.round((Date.UTC(a, m - 1, j) - Date.UTC(a0, m0 - 1, j0)) / MS_JOUR);
}

/** « 1 jour » / « 5 jours ». */
export function jours(n) {
  return `${n} jour${Math.abs(n) > 1 ? 's' : ''}`;
}

/* =========================================================================
   Téléphone guinéen
   ========================================================================= */

/**
 * Normalise un numéro guinéen au format 224XXXXXXXXX.
 * Accepte « 6XX XX XX XX », « +224 6XX… », « 00224 6XX… ». Renvoie null si invalide.
 */
export function normaliserTelephone(saisie) {
  let chiffres = String(saisie || '').trim().replace(/[\s.\-()]/g, '');
  if (chiffres.startsWith('+')) chiffres = chiffres.slice(1);
  else if (chiffres.startsWith('00')) chiffres = chiffres.slice(2);
  if (!/^\d+$/.test(chiffres)) return null;
  if (chiffres.length === 9) chiffres = '224' + chiffres;
  return /^224[36]\d{8}$/.test(chiffres) ? chiffres : null;
}

/** « 224621234567 » → « +224 621 23 45 67 » (affichage). */
export function formatTelephone(numero) {
  const n = normaliserTelephone(numero);
  if (!n) return String(numero || '');
  const local = n.slice(3);
  return `+224 ${local.slice(0, 3)} ${local.slice(3, 5)} ${local.slice(5, 7)} ${local.slice(7)}`;
}

/* =========================================================================
   Libellés métier
   ========================================================================= */

export const TYPES_ACTIVITE = {
  materiaux: 'Matériaux de construction',
  habillement: 'Habillement',
  alimentation: 'Alimentation',
  services: 'Prestations de services',
  general: 'Autre commerce'
};

/** Modes de paiement : libellés et couleurs des maquettes. */
export const MODES_PAIEMENT = {
  especes: { libelle: 'Espèces', court: 'Espèces', couleur: '#0B1F3A', fond: '#E8ECF2', encre: '#0B1F3A' },
  orange_money: { libelle: 'Orange Money', court: 'Orange Money', couleur: '#EF6C00', fond: '#FFE8D6', encre: '#8A3B00' },
  mtn_momo: { libelle: 'MTN MoMo', court: 'MTN MoMo', couleur: '#FBC02D', fond: '#FFF4C2', encre: '#5C4600' },
  credit: { libelle: 'À crédit', court: 'Crédit', couleur: '#90A4AE', fond: '#FBE9E7', encre: '#9A2E0A' }
};

/** Numéro de vente lisible : 232 → « V-0232 » (un texte déjà formaté est gardé tel quel). */
export function formatNumeroVente(numero) {
  if (numero === null || numero === undefined || numero === '') return '—';
  return /^\d+$/.test(String(numero)) ? 'V-' + String(numero).padStart(4, '0') : String(numero);
}

const WHATSAPP_YOUMMA = '224620836081';

/** Lien WhatsApp vers YOUMMA avec un message pré-rempli. */
export function lienWhatsApp(message) {
  return `https://wa.me/${WHATSAPP_YOUMMA}?text=${encodeURIComponent(message)}`;
}

/* =========================================================================
   Traduction des erreurs
   ========================================================================= */

const MESSAGES_METIER = {
  NON_CONNECTE: 'Votre session a expiré. Reconnectez-vous.',
  ACCES_REFUSE: 'Vous n’avez pas les droits pour faire cette action dans cette boutique.',
  LICENCE_EXPIREE: 'Votre licence a expiré : impossible d’enregistrer une vente. Renouvelez-la pour continuer.',
  CLIENT_REQUIS_POUR_CREDIT: 'Une vente à crédit nécessite un client. Choisissez ou créez le client.',
  PANIER_VIDE: 'Le panier est vide. Ajoutez au moins un article.',
  PRODUIT_INTROUVABLE: 'Un article du panier est introuvable ou a été désactivé. La liste a été rechargée.',
  QUANTITE_INVALIDE: 'Une quantité n’est pas valide. Vérifiez les quantités du panier.',
  CLIENT_INCONNU: 'Ce client est introuvable dans votre boutique.',
  MONTANT_SUPERIEUR_A_LA_DETTE: 'Le montant dépasse ce que le client doit. Vérifiez le montant reçu.',
  MONTANT_INVALIDE: 'Le montant n’est pas valide. Saisissez un montant supérieur à 0.',
  VENTE_INTROUVABLE: 'Cette vente est introuvable dans votre boutique.',
  DEJA_ANNULEE: 'Cette vente a déjà été annulée.'
};

/** Transforme n'importe quelle erreur (RPC, Auth, réseau) en message français clair. */
export function messageErreur(err) {
  const brut = String(err?.message || err?.error_description || err || '');

  const stock = brut.match(/STOCK_INSUFFISANT\s*:?\s*(.*?)\s*\(\s*reste\s*([-\d.,]+)\s*\)/i);
  if (stock) {
    const reste = formatNombre(Number(stock[2].replace(',', '.')) || 0, 3);
    return `Stock insuffisant pour « ${stock[1]} » : il n’en reste que ${reste}.`;
  }
  if (brut.includes('STOCK_INSUFFISANT')) return 'Stock insuffisant pour un article du panier.';
  for (const [code, message] of Object.entries(MESSAGES_METIER)) {
    if (brut.includes(code)) return message;
  }

  if (/invalid login credentials/i.test(brut)) return 'Numéro ou mot de passe incorrect.';
  if (/already (been )?registered|already exists/i.test(brut)) return 'Ce numéro a déjà un compte. Connectez-vous.';
  if (/email not confirmed/i.test(brut)) return 'Ce compte n’est pas encore activé. Contactez le support YOUMMA.';
  if (/password should be at least/i.test(brut)) return 'Le mot de passe doit contenir au moins 6 caractères.';
  if (/rate limit|too many/i.test(brut)) return 'Trop de tentatives. Patientez quelques minutes puis réessayez.';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(brut)) {
    return 'Pas de connexion internet. Vérifiez votre réseau puis réessayez.';
  }
  if (/jwt expired|session missing|invalid refresh token/i.test(brut)) return 'Votre session a expiré. Reconnectez-vous.';
  if (err?.code === '23505' || /duplicate key/i.test(brut)) return 'Cet élément existe déjà (nom ou code-barres en double).';
  if (err?.code === '23514' || /check constraint/i.test(brut)) return 'Une valeur saisie est refusée par la base de données. Vérifiez le formulaire.';
  if (err?.code === '42501' || /row-level security|permission denied/i.test(brut)) {
    return 'Vous n’avez pas les droits pour faire cette action.';
  }

  console.error('[YOUMMA] Erreur non traduite :', err);
  return 'Une erreur est survenue. Réessayez dans un instant.';
}

/* =========================================================================
   Notifications (toasts)
   ========================================================================= */

/**
 * Affiche un message temporaire. type : 'info' | 'succes' | 'erreur'.
 * action (facultative) : { libelle, href } → lien affiché dans le message.
 */
export function toast(message, type = 'info', duree = 4000, action = null) {
  const zone = document.getElementById('toasts');
  if (!zone) return;
  const element = document.createElement('div');
  element.className = `toast toast-${type}`;
  element.setAttribute('role', type === 'erreur' ? 'alert' : 'status');
  element.textContent = message;
  if (action) {
    const lien = document.createElement('a');
    lien.className = 'toast-action';
    lien.href = action.href;
    lien.textContent = action.libelle;
    element.classList.add('toast-avec-action');
    element.append(' ', lien);
  }
  zone.appendChild(element);
  setTimeout(() => {
    element.classList.add('toast-sortie');
    setTimeout(() => element.remove(), 300);
  }, duree);
}

/* =========================================================================
   Boutons occupés (anti double clic)
   ========================================================================= */

/** Désactive un bouton et affiche un indicateur pendant une opération, puis le restaure. */
export function boutonOccupe(bouton, occupe, texteOccupe = 'Patientez…') {
  if (!bouton) return;
  if (occupe) {
    bouton.dataset.contenu = bouton.innerHTML;
    bouton.disabled = true;
    bouton.setAttribute('aria-busy', 'true');
    bouton.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(texteOccupe)}`;
  } else {
    bouton.disabled = false;
    bouton.removeAttribute('aria-busy');
    if (bouton.dataset.contenu !== undefined) bouton.innerHTML = bouton.dataset.contenu;
  }
}

/* =========================================================================
   Modales
   ========================================================================= */

let compteurModale = 0;
/** Modales ouvertes, de la plus ancienne à la plus récente (Échap ferme la dernière). */
const pileModales = [];

/**
 * Ouvre une fenêtre modale. variante : '' | 'large' | 'feuille' (panneau du bas sur téléphone).
 * Renvoie { el, fermer } ; `el` est la boîte de dialogue.
 */
export function ouvrirModale({ titre, contenu, variante = '', onFermer } = {}) {
  const id = `modale-titre-${++compteurModale}`;
  const fond = document.createElement('div');
  fond.className = 'modale-fond';
  fond.innerHTML = `
    <div class="modale ${variante ? 'modale-' + variante : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}">
      <div class="modale-entete">
        <h2 id="${id}">${esc(titre)}</h2>
        <button type="button" class="btn-icone btn-icone-clair" data-fermer aria-label="Fermer">${icone('fermer', 20, 2)}</button>
      </div>
      <div class="modale-corps">${contenu}</div>
    </div>`;
  const elementPrecedent = document.activeElement;
  document.body.appendChild(fond);
  document.body.classList.add('sans-defilement');
  pileModales.push(fond);

  function surTouche(e) {
    if (e.key === 'Escape' && pileModales[pileModales.length - 1] === fond) fermer();
  }
  function fermer() {
    if (!fond.isConnected) return;
    pileModales.splice(pileModales.indexOf(fond), 1);
    fond.remove();
    document.removeEventListener('keydown', surTouche);
    if (!document.querySelector('.modale-fond')) document.body.classList.remove('sans-defilement');
    if (elementPrecedent?.isConnected) elementPrecedent.focus({ preventScroll: true });
    onFermer?.();
  }
  fond.addEventListener('click', (e) => {
    if (e.target === fond || e.target.closest('[data-fermer]')) fermer();
  });
  document.addEventListener('keydown', surTouche);

  const premierChamp = fond.querySelector('[autofocus], input:not([type=hidden]):not([disabled]), select, textarea');
  (premierChamp || fond.querySelector('[data-fermer]')).focus({ preventScroll: true });

  return { el: fond.querySelector('.modale'), fermer };
}

/** Ferme toutes les modales ouvertes (changement de page). */
export function fermerModales() {
  pileModales.length = 0;
  document.querySelectorAll('.modale-fond').forEach((m) => m.remove());
  document.body.classList.remove('sans-defilement');
}

/** Demande de confirmation. Renvoie une promesse résolue à true ou false. */
export function confirmer(message, { titre = 'Confirmation', libelleOk = 'Confirmer', danger = false } = {}) {
  return new Promise((resoudre) => {
    let reponse = false;
    const { el, fermer } = ouvrirModale({
      titre,
      contenu: `
        <p class="texte-modale">${esc(message)}</p>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primaire'}" data-ok>${esc(libelleOk)}</button>
        </div>`,
      onFermer: () => resoudre(reponse)
    });
    el.querySelector('[data-ok]').addEventListener('click', () => { reponse = true; fermer(); });
    el.querySelector('[data-ok]').focus();
  });
}

/* =========================================================================
   Icônes (tracés repris des maquettes) et logo
   ========================================================================= */

export const ICONES = {
  tableau: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  caisse: 'M3 7h18v12H3zM3 11h18M7 15h3',
  ventes: 'M6 2L3 6v14h18V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  stock: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  clients: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  client: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  depenses: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  rapports: 'M3 3v18h18M7 15l4-4 3 3 6-6',
  vendeurs: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  enLigne: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  parametres: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  recherche: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  plusCercle: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM8 12h8M12 8v8',
  menu: 'M4 6h16M4 12h16M4 18h16',
  chevronBas: 'M6 9l6 6 6-6',
  chevronDroite: 'M9 18l6-6-6-6',
  retour: 'M15 18l-6-6 6-6',
  fermer: 'M18 6L6 18M6 6l12 12',
  sms: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  oeil: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  oeilBarre: 'M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18 18 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M1 1l22 22',
  deconnexion: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  horloge: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  imprimante: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  valide: 'M20 6L9 17l-5-5',
  alerte: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  crayon: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  entree: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  inventaire: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  annuler: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  corbeille: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  moins: 'M5 12h14',
  telephone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z',
  whatsapp: 'M3 21l1.7-5A9 9 0 1 1 8 19.3z',
  // Vignettes d'articles (maquette caisse)
  sac: 'M6 3h12l2 18H4zM9 3v4a3 3 0 0 0 6 0V3',
  barre: 'M4 20L20 4M7 20L20 7M4 17L17 4',
  tole: 'M3 8l3-2 3 2 3-2 3 2 3-2 3 2v10l-3-2-3 2-3-2-3 2-3-2-3 2z',
  seau: 'M5 7h14l-1.5 13h-11zM5 7a7 3 0 0 1 14 0M9 4h6',
  clou: 'M8 3h8M12 3v15l-1 3M12 18l1 3',
  carreau: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z',
  camion: 'M1 6h13v10H1zM14 10h4l4 3v3h-8M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  brique: 'M3 6h18v12H3zM3 12h18M9 6v6M15 12v6',
  // Types d'activité (onboarding)
  chemise: 'M8 3L3 6l2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z',
  panier: 'M5 9h14l-1.5 11h-11zM9 9l3-6 3 6M9 13v3M15 13v3',
  outil: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4z',
  magasin: 'M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6'
};

/** Renvoie un SVG d'icône (trait). `nom` = clé de ICONES. */
export function icone(nom, taille = 20, epaisseur = 1.8) {
  return `<svg width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${epaisseur}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${ICONES[nom] || ''}"></path></svg>`;
}

let compteurLogo = 0;

/** La goutte YOUMMA en dégradé avec le « y » blanc. */
export function logoGoutte(largeur = 36) {
  const id = `yg${++compteurLogo}`;
  const hauteur = Math.round((largeur * 40) / 36);
  return `<svg width="${largeur}" height="${hauteur}" viewBox="0 0 32 36" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4FC3F7"></stop><stop offset="1" stop-color="#1565C0"></stop></linearGradient></defs><path d="M16 1C16 1 3 15 3 22a13 13 0 0 0 26 0C29 15 16 1 16 1z" fill="url(#${id})"></path><text x="16" y="28" text-anchor="middle" font-family="Manrope, sans-serif" font-weight="800" font-size="15" fill="#FFFFFF">y</text></svg>`;
}

/** Logo complet : goutte + « YOUMMA / BUSINESS ». theme : 'sombre' (fond navy) ou 'clair'. */
export function logoComplet(theme = 'sombre') {
  return `<div class="logo logo-${theme}">${logoGoutte()}<div class="logo-texte"><span class="logo-nom">YOUMMA</span><span class="logo-sous">BUSINESS</span></div></div>`;
}
