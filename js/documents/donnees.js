/**
 * donnees.js — Données des documents A4 : réglages de la boutique (obtenir_documents), émission du numéro
 * (emettre_document), vente ou devis complets, URL signées du cachet et de la signature (bucket privé
 * « documents », 1 h), et ouverture de la page d'impression document.html.
 */
import { sb } from '../supabase.js';
import { etat, estGerant } from '../state.js';
import { REGLAGES_DEFAUT, OPTIONS_DEFAUT } from './rendu.js';
import { completerLignesBase } from '../unites.js';

/** Où apparaît le logo (Paramètres → Logo & images) : tout est activé par défaut. */
export const USAGES_LOGO_DEFAUT = { factures: true, ticket: true, vitrine: true, affiches: true, devis: true, apercu: true };

const cacheReglages = new Map();

/** Réglages des documents de la boutique (la ligne est créée au premier appel). */
export async function chargerReglages(idBoutique = etat.boutique?.id, { recharger = false } = {}) {
  if (!recharger && cacheReglages.has(idBoutique)) return cacheReglages.get(idBoutique);
  const { data, error } = await sb.rpc('obtenir_documents', { p_boutique: idBoutique });
  if (error) throw error;
  const ligne = (Array.isArray(data) ? data[0] : data) || {};
  const reglages = normaliserReglages(ligne);
  cacheReglages.set(idBoutique, reglages);
  return reglages;
}
export const oublierReglages = (idBoutique) => cacheReglages.delete(idBoutique);
/** Réglages déjà chargés (sans requête) ; null s'ils ne l'ont pas encore été. */
export const reglagesEnCache = (idBoutique) => cacheReglages.get(idBoutique) || null;

export function normaliserReglages(ligne = {}) {
  return {
    ...REGLAGES_DEFAUT,
    ...Object.fromEntries(Object.entries(ligne).filter(([, v]) => v !== null && v !== undefined)),
    prefixes: { ...REGLAGES_DEFAUT.prefixes, ...(ligne.prefixes || {}) },
    options: { ...OPTIONS_DEFAUT, ...(ligne.options || {}) },
    logo_usages: { ...USAGES_LOGO_DEFAUT, ...(ligne.logo_usages || {}) },
    paiements: {
      om: { actif: false, numero: '', logo_url: null, ...(ligne.paiements?.om || {}) },
      momo: { actif: false, numero: '', logo_url: null, ...(ligne.paiements?.momo || {}) },
      especes: { actif: true, ...(ligne.paiements?.especes || {}) }
    },
    partenaires: Array.isArray(ligne.partenaires) ? ligne.partenaires.slice(0, 6) : []
  };
}

/** Type du document de vente selon les réglages (« facture » ou « recu »). */
export const typeVente = (reglages) => (reglages?.titre_vente === 'recu' ? 'recu' : 'facture');

/** Émet (ou retrouve) le document : même numéro si la même vente est réimprimée avec le même type. */
export async function emettreDocument(type, { vente = null, proforma = null } = {}, idBoutique = etat.boutique?.id) {
  const { data, error } = await sb.rpc('emettre_document', { p_boutique: idBoutique, p_type: type, p_vente: vente, p_proforma: proforma });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) || null;
}

/** Document déjà émis pour une vente (vente annulée : on n'en émet pas de nouveau). */
export async function documentExistant(type, idVente) {
  const { data } = await sb.from('documents_emis').select('id, type, numero, code, total, created_at')
    .eq('vente_id', idVente).eq('type', type).limit(1);
  return data?.[0] || null;
}

/** Cachet et signature : URL signées (1 h), seulement pour le gérant/propriétaire ou si cachet_vendeurs. */
export async function imagesSignature(reglages) {
  if (!reglages || (!estGerant() && !reglages.cachet_vendeurs)) return { cachetUrl: null, signatureUrl: null };
  const signer = async (chemin) => {
    if (!chemin) return null;
    const { data, error } = await sb.storage.from('documents').createSignedUrl(chemin, 3600);
    return error ? null : data?.signedUrl || null;
  };
  const [cachetUrl, signatureUrl] = await Promise.all([signer(reglages.cachet_path), signer(reglages.signature_path)]);
  return { cachetUrl, signatureUrl };
}

/** Vente complète : lignes, client (solde), chantier (« récupéré par »), commande en ligne, vendeur. */
export async function chargerVente(idVente, idBoutique = etat.boutique?.id) {
  const [venteRes, lignesRes] = await Promise.all([
    sb.from('ventes')
      .select('id, numero, created_at, client_id, vendeur_id, type_prix, sous_total, remise, total, mode_paiement, echeance, statut, chantier_id, frais_livraison, commande_web_id')
      .eq('boutique_id', idBoutique).eq('id', idVente).maybeSingle(),
    sb.from('ventes_lignes').select('produit_id, nom_produit, unite, quantite, prix_unitaire, total, facteur, quantite_base').eq('vente_id', idVente)
  ]);
  if (venteRes.error) throw venteRes.error;
  if (lignesRes.error) throw lignesRes.error;
  await completerLignesBase(lignesRes.data);
  const vente = venteRes.data;
  if (!vente) throw new Error('VENTE_INTROUVABLE');
  const [client, chantier, mouvement, commande, vendeur] = await Promise.all([
    vente.client_id ? sb.from('clients').select('id, nom, telephone, solde_credit').eq('id', vente.client_id).maybeSingle().then((r) => r.data) : null,
    vente.chantier_id ? sb.from('chantiers').select('id, numero, nom, adresse').eq('id', vente.chantier_id).maybeSingle().then((r) => r.data) : null,
    vente.chantier_id ? sb.from('chantier_mouvements').select('personne').eq('vente_id', idVente).eq('type', 'enlevement').limit(1).then((r) => r.data?.[0] || null) : null,
    vente.commande_web_id ? sb.from('commandes_web').select('id, numero, nom, telephone, reception, zone_nom, adresse').eq('id', vente.commande_web_id).maybeSingle().then((r) => r.data) : null,
    vente.vendeur_id ? sb.from('membres').select('id, user_id, nom').eq('boutique_id', idBoutique)
      .then((r) => (r.data || []).find((m) => m.user_id === vente.vendeur_id || m.id === vente.vendeur_id)?.nom || null) : null
  ]);
  return {
    vente,
    lignes: (lignesRes.data || []).map((l) => ({ nom: l.nom_produit, unite: l.unite, quantite: l.quantite, prix: l.prix_unitaire, total: l.total, base: l.base || null })),
    client: client || (commande ? { nom: commande.nom, telephone: commande.telephone } : null),
    chantier,
    recuperePar: mouvement?.personne || null,
    livraison: commande ? { zone: commande.reception === 'livraison' ? commande.zone_nom || 'Livraison' : null, adresse: commande.reception === 'livraison' ? commande.adresse : null, commande: commande.numero } : null,
    vendeur
  };
}

/** Devis complet (client libre ou client de la boutique). */
export async function chargerProforma(idProforma, idBoutique = etat.boutique?.id) {
  const { data: pf, error } = await sb.from('proformas').select('*').eq('boutique_id', idBoutique).eq('id', idProforma).maybeSingle();
  if (error) throw error;
  if (!pf) throw new Error('PROFORMA_INTROUVABLE');
  let client = { nom: pf.client_nom, telephone: pf.client_tel, info: pf.client_info };
  if (pf.client_id) {
    const { data } = await sb.from('clients').select('id, nom, telephone').eq('id', pf.client_id).maybeSingle();
    if (data) client = { ...data, info: pf.client_info };
  }
  const vendeur = pf.cree_par
    ? (await sb.from('membres').select('nom').eq('boutique_id', idBoutique).eq('user_id', pf.cree_par).limit(1)).data?.[0]?.nom || null : null;
  return {
    proforma: pf,
    lignes: (pf.lignes || []).map((l) => ({ nom: l.nom, unite: l.unite, quantite: l.quantite, prix: l.prix, total: l.total })),
    client: client.nom ? client : null,
    vendeur
  };
}

/**
 * Ouvre la page d'impression d'un document (même onglet : fonctionne aussi dans l'appli installée).
 * { type, vente, proforma } ; essai : réglages en brouillon (sessionStorage), sans numéro.
 */
export function ouvrirDocument({ type, vente = null, proforma = null, essai = false, retour = location.hash }) {
  const params = new URLSearchParams({ b: etat.boutique?.id || '', type });
  if (vente) params.set('vente', vente);
  if (proforma) params.set('proforma', proforma);
  if (essai) params.set('essai', '1');
  try { sessionStorage.setItem('yb_document_retour', retour || '#/aujourdhui'); } catch { /* retour par défaut */ }
  location.href = `document.html?${params}`;
}
