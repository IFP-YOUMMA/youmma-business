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

/** Copie un texte dans le presse-papiers (avec repli pour les anciens navigateurs). Renvoie true si réussi. */
export async function copierTexte(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    const champ = Object.assign(document.createElement('textarea'), { value: texte });
    champ.setAttribute('readonly', '');
    champ.style.position = 'fixed';
    champ.style.opacity = '0';
    document.body.appendChild(champ);
    champ.select();
    const ok = document.execCommand('copy');
    champ.remove();
    return ok;
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

/** Solde d'un chantier : « Avance 650 000 GNF », « Doit 1 050 000 GNF » ou « Soldé ». */
export function texteSolde(solde) {
  const n = Number(solde) || 0;
  if (n > 0) return `Avance ${formatGNF(n)}`;
  if (n < 0) return `Doit ${formatGNF(-n)}`;
  return 'Soldé';
}

/** Classe de couleur du solde : solde-avance (vert), solde-dette (rouge) ou solde-nul (gris). */
export function classeSolde(solde) {
  const n = Number(solde) || 0;
  if (n > 0) return 'solde-avance';
  if (n < 0) return 'solde-dette';
  return 'solde-nul';
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
  moisAnnee: { month: 'long', year: 'numeric' },
  moisCourtAnnee: { month: 'short', year: 'numeric' }
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
 * 'jour' | '7j' | 'semaine' (depuis lundi) | 'mois' | 'moisDernier' | 'annee'.
 */
export function bornesPeriode(code) {
  const aujourdhui = dateISO();
  const debutMois = aujourdhui.slice(0, 8) + '01';
  if (code === '7j') return { du: decalerDate(aujourdhui, -6), au: aujourdhui };
  if (code === 'semaine') {
    const [a, m, j] = aujourdhui.split('-').map(Number);
    const joursDepuisLundi = (new Date(Date.UTC(a, m - 1, j)).getUTCDay() + 6) % 7;
    return { du: decalerDate(aujourdhui, -joursDepuisLundi), au: aujourdhui };
  }
  if (code === 'annee') return { du: aujourdhui.slice(0, 5) + '01-01', au: aujourdhui };
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
  general: 'Autre commerce',
  // Étape 11 : activités ajoutées (libellés de repli ; la table « activites » fait foi).
  cosmetiques: 'Cosmétiques',
  telephones: 'Téléphones & électronique',
  pieces_auto: 'Pièces auto',
  pharmacie: 'Pharmacie',
  restaurant: 'Restaurant'
};

/** Modes de paiement : libellés et couleurs des maquettes. */
export const MODES_PAIEMENT = {
  especes: { libelle: 'Espèces', court: 'Espèces', couleur: '#0A3D33', fond: '#E6ECE9', encre: '#0A3D33' },
  orange_money: { libelle: 'Orange Money', court: 'Orange Money', couleur: '#EF6C00', fond: '#FFE8D6', encre: '#8A3B00' },
  mtn_momo: { libelle: 'MTN MoMo', court: 'MTN MoMo', couleur: '#FBC02D', fond: '#FFF4C2', encre: '#5C4600' },
  credit: { libelle: 'À crédit', court: 'Crédit', couleur: '#90A4AE', fond: '#FBE9E7', encre: '#9A2E0A' },
  // Enlèvement sur un compte chantier (payé par l'avance ou mis en dette du chantier).
  chantier: { libelle: 'Chantier', court: 'Chantier', couleur: '#3BA58A', fond: '#E0F2EC', encre: '#0A5E48' }
};

/** Modes proposés à la caisse (le mode « chantier » passe par l'écran d'enlèvement). */
export const MODES_CAISSE = ['especes', 'orange_money', 'mtn_momo', 'credit'];

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
  LICENCE_EXPIREE: 'Votre licence a expiré : la boutique est en lecture seule. Contactez YOUMMA pour la renouveler.',
  CLIENT_REQUIS_POUR_CREDIT: 'Une vente à crédit nécessite un client. Choisissez ou créez le client.',
  PANIER_VIDE: 'Le panier est vide. Ajoutez au moins un article.',
  PRODUIT_INTROUVABLE: 'Un article du panier est introuvable ou a été désactivé. La liste a été rechargée.',
  QUANTITE_INVALIDE: 'Une quantité n’est pas valide. Vérifiez les quantités du panier.',
  CLIENT_INCONNU: 'Ce client est introuvable dans votre boutique.',
  MONTANT_SUPERIEUR_A_LA_DETTE: 'Le montant dépasse ce que le client doit. Vérifiez le montant reçu.',
  MONTANT_INVALIDE: 'Le montant n’est pas valide. Saisissez un montant supérieur à 0.',
  VENTE_INTROUVABLE: 'Cette vente est introuvable dans votre boutique.',
  DEJA_ANNULEE: 'Cette vente a déjà été annulée.',
  CODE_INVALIDE: 'Code invalide ou expiré.',
  CODE_INDISPONIBLE: 'Impossible de créer un code pour le moment. Réessayez dans un instant.',
  DEJA_MEMBRE: 'Vous faites déjà partie de cette boutique.',
  SEUL_PROPRIETAIRE: 'Seul le propriétaire de la boutique peut faire cette action.',
  PAS_SOI_MEME: 'Vous ne pouvez pas modifier votre propre accès.',
  PROPRIETAIRE_INTOUCHABLE: 'Le propriétaire de la boutique ne peut pas être modifié.',
  MEMBRE_INTROUVABLE: 'Ce membre est introuvable dans la boutique.',
  INVITATION_INTROUVABLE: 'Cette invitation est introuvable ou a déjà été utilisée.',
  ROLE_INVALIDE: 'Ce rôle n’est pas valide.',
  NOM_REQUIS: 'Indiquez un nom.',
  PAS_INVALIDE: 'Période de rapport invalide.',
  CHANTIER_INTROUVABLE: 'Ce chantier est introuvable dans votre boutique.',
  CHANTIER_CLOTURE: 'Ce chantier est clôturé.',
  CHANTIER_DEJA_OUVERT: 'Ce client a déjà un chantier ouvert.',
  SOLDE_NON_NUL: 'Le solde n’est pas à zéro.',
  MOUVEMENT_INTROUVABLE: 'Cette opération est introuvable sur le chantier.',
  TYPE_INVALIDE: 'Type d’opération invalide.',
  CREDIT_SMS_INSUFFISANT: 'Crédit SMS insuffisant — rechargez pour envoyer.',
  AUCUN_DESTINATAIRE: 'Aucun client ne correspond.',
  TEXTE_REQUIS: 'Écrivez le texte du message.',
  TEXTE_TROP_LONG: 'Message trop long (3 SMS maximum).',
  TELEPHONE_INVALIDE: 'Numéro de téléphone invalide.',
  MODELE_INCONNU: 'Ce type de message est inconnu.',
  CAMPAGNE_INTROUVABLE: 'Cette campagne est introuvable.',
  FOURNISSEUR_INTROUVABLE: 'Ce fournisseur est introuvable.',
  COMMANDE_INTROUVABLE: 'Cette commande est introuvable.',
  DEJA_RELANCE: 'Ce client a déjà été relancé aujourd’hui.',
  AUCUNE_DETTE: 'Ce client ne doit rien.',
  CLIENT_INTROUVABLE: 'Ce client est introuvable.',
  BOUTIQUE_INTROUVABLE: 'Cette boutique est introuvable.',
  PAIEMENT_INTROUVABLE: 'Ce paiement est introuvable.',
  DEJA_TRAITE: 'Déjà traité par quelqu’un d’autre : la liste a été rechargée.',
  MOTIF_REQUIS: 'Indiquez le motif.',
  COMPTE_INTROUVABLE: 'Aucun compte YOUMMA Business avec ce numéro.',
  COMPTE_EXISTE: 'Un compte existe déjà avec ce numéro.',
  DERNIER_SUPER_ADMIN: 'Impossible : il doit rester au moins un super admin actif.',
  DEMANDE_INTROUVABLE: 'Cette demande d’aide est introuvable.',
  TROP_DE_DEMANDES: 'Trop de demandes envoyées : réessayez dans un moment ou écrivez-nous sur WhatsApp.',
  BOUTIQUE_SUSPENDUE: 'Cette boutique est suspendue. Contactez YOUMMA.',
  BOUTIQUE_FERMEE: 'La boutique ne prend pas de commandes pour le moment.',
  RECEPTION_INVALIDE: 'Choisissez le retrait en boutique ou la livraison.',
  ZONE_REQUISE: 'Choisissez une zone de livraison.',
  ADRESSE_REQUISE: 'Indiquez votre quartier et un repère.',
  PANIER_TROP_GRAND: 'Trop d’articles dans le panier (50 maximum).',
  TROP_DE_COMMANDES: 'Trop de commandes avec ce numéro, réessayez dans une heure.',
  ADRESSE_INVALIDE: 'Adresse : lettres sans accents, chiffres et tirets, 3 à 40 caractères.',
  ADRESSE_PRISE: 'Cette adresse est déjà prise.',
  HORAIRES_INVALIDES: 'Horaires invalides : vérifiez l’heure d’ouverture et de fermeture.',
  COMMANDE_TERMINEE: 'Cette commande est déjà livrée ou annulée.',
  STATUT_INVALIDE: 'Cette étape n’est pas possible pour cette commande.',
  PROMO_INVALIDE: 'Le prix promo doit être inférieur au prix de détail.',
  PROFORMA_INTROUVABLE: 'Ce devis est introuvable dans votre boutique.',
  MODULE_INACTIF: 'Cette fonction n’est pas activée pour votre boutique — Paramètres › Mes modules.',
  MODULE_FORMULE: 'Disponible avec une formule supérieure.',
  MODULE_BIENTOT: 'Ce module sera bientôt disponible.',
  MODULE_BLOQUE: 'Désactivé par YOUMMA — contactez le support.',
  MODULE_INCONNU: 'Ce module est inconnu.',
  ACTIVITE_INCONNUE: 'Cette activité est inconnue.',
  PROFORMA_VERROUILLEE: 'Ce devis a déjà été accepté ou transformé en vente : il ne peut plus être modifié.',
  // Étape 12 : tailles & couleurs
  VARIANTE_INTROUVABLE: 'Cette taille ou cette couleur n’existe plus pour ce modèle. Rechargez la page.',
  TAILLE_INCONNUE: 'Cette taille ne fait pas partie de la grille du modèle.',
  COULEUR_INCONNUE: 'Cette couleur ne fait pas partie du modèle.',
  VARIANTE_VIDE: 'Ajoutez au moins une taille ou une couleur, avec au moins une case.',
  TROP_DE_VARIANTES: 'Trop de cases pour un seul modèle : réduisez le nombre de tailles ou de couleurs.',
  // Étape 13 : unités multiples et livraisons
  UNITE_INTROUVABLE: 'Cette unité de vente n’existe plus pour cet article. Rechargez la page.',
  TROP_D_UNITES: '10 unités de vente au maximum par article.',
  UNITE_ET_VARIANTE: 'Un article à tailles ou couleurs ne se vend pas dans une autre unité.',
  MOTIF_REQUIS: 'Indiquez le motif de l’annulation.',
  LIVRAISON_INTROUVABLE: 'Cette livraison est introuvable.',
  LIVRAISON_TERMINEE: 'Cette livraison est déjà livrée ou annulée.'
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
  // Tailles & couleurs : messages avec le nom du modèle ou le libellé de la case.
  const uniteBase = brut.match(/UNITE_DE_BASE\s*:?\s*(.*)$/);
  if (uniteBase) return `${uniteBase[1].trim() ? `« ${uniteBase[1].trim()} »` : 'Cette unité'} est déjà l’unité de base.`;
  const facteur = brut.match(/FACTEUR_INVALIDE\s*:?\s*(.*)$/);
  if (facteur) return `Indiquez combien d’unités de base font ${facteur[1].trim() ? `une « ${facteur[1].trim()} »` : 'la nouvelle unité'} (nombre positif, différent de 1).`;
  const requise = brut.match(/VARIANTE_REQUISE\s*:?\s*(.*)$/);
  if (requise) return `Choisissez la taille et la couleur${requise[1].trim() ? ` pour « ${requise[1].trim()} »` : ''}.`;
  const avecStock = brut.match(/VARIANTE_AVEC_STOCK\s*:?\s*(.*?)\s*\(\s*([\d.,]+)\s*en stock\s*\)/i);
  if (avecStock) { const n = Number(avecStock[2].replace(',', '.')) || 0; return `Impossible de retirer ${avecStock[1]} : il reste ${formatNombre(n)} pièce${n > 1 ? 's' : ''}. Videz d’abord son stock.`; }
  if (brut.includes('VARIANTE_AVEC_STOCK')) return 'Impossible de retirer une case qui a encore du stock. Videz d’abord son stock.';
  const epuise = brut.match(/PRODUIT_EPUISE\s*:?\s*(.+)$/i);
  if (epuise) return `« ${epuise[1].trim()} » est épuisé : retirez-le du panier.`;
  if (brut.includes('PRODUIT_EPUISE')) return 'Un article du panier est épuisé.';
  // Module masqué : message clair, et les modules de la boutique sont relus (menu redessiné).
  const enCoursModule = brut.match(/MODULE_EN_COURS\s*:?\s*(.*)$/);
  if (enCoursModule) return `Impossible de masquer ce module${enCoursModule[1] ? ` : ${enCoursModule[1].trim().replace(/\.$/, '')}` : ''}. Terminez d’abord ces opérations.`;
  if (brut.includes('MODULE_INACTIF') && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('yb:module-inactif'));
  const quota = brut.match(/QUOTA_PHOTOS\s*:?\s*(\d+)/);
  if (quota || brut.includes('QUOTA_PHOTOS')) {
    return `Limite de ${quota ? formatNombre(Number(quota[1])) + ' ' : ''}photos atteinte pour votre formule. Retirez des photos ou passez à une formule supérieure.`;
  }
  for (const [code, message] of Object.entries(MESSAGES_METIER)) {
    if (brut.includes(code)) return message;
  }

  if (/invalid login credentials/i.test(brut)) return 'Numéro ou mot de passe incorrect.';
  if (/already (been )?registered|already exists/i.test(brut)) return 'Ce numéro a déjà un compte. Connectez-vous.';
  if (/email not confirmed/i.test(brut)) return 'Ce compte n’est pas encore activé. Contactez le support YOUMMA.';
  if (/password should be at least/i.test(brut)) return 'Le mot de passe doit contenir au moins 6 caractères.';
  if (/different from the old password|same_password/i.test(brut)) return 'Le nouveau mot de passe doit être différent de l’ancien.';
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
  bouclier: 'M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z',
  casque: 'M2 18h20M4 18v-2a8 8 0 0 1 16 0v2M10 8V5h4v3M8.5 10.5L9 8M15.5 10.5L15 8',
  document: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8',
  photo: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  connexion: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  inviter: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
  points: 'M12 5h.01M12 12h.01M12 19h.01',
  telecharger: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  copier: 'M8 8h12v12H8zM4 16V4h12',
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
  magasin: 'M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6',
  enLigne: 'M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6',
  aide: 'M12 21a9 9 0 1 0-9-9c0 1.6.4 3 1.1 4.3L3 21l4.7-1.1A9 9 0 0 0 12 21zM9 10a3 3 0 1 1 4 2.8V14M12 17h.01',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2M6 6h1M17 6h1M6 17h1',
  partager: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13',
  image: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  livraison: 'M1 4h14v12H1zM15 9h4l3 3v4h-7M5.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'
};

/** Icône par défaut d'un article selon son unité (sac, barre, tôle…). */
const ICONES_PAR_UNITE = { sac: 'sac', barre: 'barre', feuille: 'tole', 'tôle': 'tole', seau: 'seau', 'm²': 'carreau', m2: 'carreau', voyage: 'camion', kg: 'clou' };
export function iconeUnite(unite) {
  return ICONES_PAR_UNITE[String(unite || '').toLowerCase()] || 'stock';
}

/** Adresse publique de la boutique en ligne (?s=… : marche partout) et version courte (…/b/<slug>, via 404.html). */
export function lienBoutique(slug) {
  return new URL(`b/?s=${encodeURIComponent(slug)}`, racineSite()).href;
}
export function lienCourtBoutique(slug) {
  return new URL(`b/${encodeURIComponent(slug)}`, racineSite()).href.replace(/^https?:\/\//, '');
}
function racineSite() {
  const ici = location.href.split('#')[0].split('?')[0];
  return new URL(/\/b\/[^/]*$/.test(new URL(ici).pathname) ? '../' : './', ici);
}

/* =========================================================================
   Connexion par téléphone (e-mail technique, partagé par l'appli et le panneau admin)
   ========================================================================= */

const DOMAINE_TECHNIQUE = 'tel.yoummabusiness.app';

/** E-mail technique dérivé d'un numéro déjà normalisé (224XXXXXXXXX@tel.yoummabusiness.app). */
export function emailDepuisTelephone(telephoneNormalise) {
  return `${telephoneNormalise}@${DOMAINE_TECHNIQUE}`;
}

/** Téléphone de connexion (224XXXXXXXXX) déduit de l'e-mail technique, ou null. */
export function telephoneDepuisEmail(email) {
  const local = String(email || '').split('@')[0];
  return /^\d{12}$/.test(local) ? local : null;
}

/* =========================================================================
   Promotions (règle identique au serveur : prix_promo < prix_detail et non expirée)
   ========================================================================= */

/** Vrai si l'article a une promotion active aujourd'hui (fin incluse, fuseau Conakry). */
export function promoActive(p, jour = dateISO()) {
  if (p?.prix_promo === null || p?.prix_promo === undefined || p.prix_promo === '') return false;
  return Number(p.prix_promo) < Number(p.prix_detail) && (!p.promo_fin || String(p.promo_fin).slice(0, 10) >= jour);
}

/** Prix de vente appliqué : détail (ou promo active) ; au gros, le plus bas du prix de gros et de la promo. */
export function prixApplique(p, typePrix = 'detail') {
  const promo = promoActive(p);
  const detail = promo ? Number(p.prix_promo) : Number(p.prix_detail) || 0;
  if (typePrix === 'gros' && p.prix_gros !== null && p.prix_gros !== undefined) {
    return promo ? Math.min(Number(p.prix_gros), detail) : Number(p.prix_gros);
  }
  return detail;
}

/** Renvoie un SVG d'icône (trait). `nom` = clé de ICONES. */
export function icone(nom, taille = 20, epaisseur = 1.8) {
  return `<svg width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${epaisseur}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${ICONES[nom] || ''}"></path></svg>`;
}

/** Adresse d'un fichier de img/logo/, valable depuis l'appli, admin/ et b/. */
export const urlLogo = (fichier) => new URL(`../img/logo/${fichier}`, import.meta.url).href;

/** Attend le chargement des images d'un conteneur (au plus `delai` ms), avant une impression. */
export function imagesPretes(conteneur, delai = 1500) {
  const attentes = [...conteneur.querySelectorAll('img')].filter((i) => !i.complete)
    .map((i) => new Promise((ok) => { i.addEventListener('load', ok, { once: true }); i.addEventListener('error', ok, { once: true }); }));
  return Promise.race([Promise.all(attentes), new Promise((ok) => setTimeout(ok, delai))]);
}

/** Symbole seul (cercle or, arc vert, barres) pour les petites tailles. alt vide : le texte est à côté. */
export function logoSymbole(taille = 34, alt = '') {
  return `<img class="logo-symbole" src="${urlLogo('youmma-business-symbole.png')}" width="${taille}" height="${taille}" alt="${esc(alt)}" decoding="async">`;
}

/** Symbole + « YOUMMA Business » en texte (menus, en-têtes). theme : 'sombre' (fond foncé) ou 'clair'. */
export function logoMarque(theme = 'sombre', taille = 34, sousTitre = '') {
  return `<div class="logo logo-${theme}">${logoSymbole(taille)}<div class="logo-texte"><span class="logo-nom">YOUMMA Business</span>${sousTitre ? `<span class="logo-sous">${esc(sousTitre)}</span>` : ''}</div></div>`;
}

/** Logo complet (image, 120 px de large minimum). theme : 'sombre' (fond foncé) ou 'clair'. */
export function logoComplet(theme = 'sombre', largeur = 160) {
  const fichier = theme === 'sombre' ? 'youmma-business-logo-fond-fonce.png' : 'youmma-business-logo.png';
  const l = Math.max(120, largeur);
  return `<img class="logo-complet" src="${urlLogo(fichier)}" width="${l}" height="${l}" alt="YOUMMA Business" decoding="async">`;
}
