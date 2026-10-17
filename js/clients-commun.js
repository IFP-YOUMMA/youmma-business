/**
 * clients-commun.js — Règles de crédit partagées (échéance, statut, badges, totaux)
 * et formulaire client (création / modification).
 *
 * Utilisé par la page Clients & crédits, le tableau de bord et la caisse :
 * les mêmes règles donnent partout les mêmes chiffres.
 */
import { sb } from './supabase.js';
import { etat } from './state.js';
import {
  esc, toast, ouvrirModale, boutonOccupe, messageErreur, normaliserTelephone, formatTelephone,
  formatDate, ecartJours, jours, prenom
} from './utils.js';

export const COLONNES_CLIENT = 'id, nom, telephone, solde_credit, notes, created_at';
/** Une échéance dans les N prochains jours rend le client « bientôt ». */
const JOURS_BIENTOT = 7;

/* ------------------------------------------------------------ Règles de crédit */

/**
 * Statut de crédit :
 *  - 'aucun'   : solde nul (rien à payer)
 *  - 'retard'  : solde > 0 et échéance dépassée
 *  - 'bientot' : solde > 0 et échéance dans les 7 prochains jours
 *  - 'ok'      : solde > 0 et échéance plus lointaine ou absente
 */
function statutCredit(solde, echeance) {
  if (!(solde > 0)) return { code: 'aucun', ecart: null };
  if (!echeance) return { code: 'ok', ecart: null };
  const ecart = ecartJours(echeance);
  if (ecart < 0) return { code: 'retard', ecart };
  if (ecart <= JOURS_BIENTOT) return { code: 'bientot', ecart };
  return { code: 'ok', ecart };
}

/** Ajoute au client son échéance et son statut de crédit. */
export function completerClient(client, echeance) {
  const solde = Number(client.solde_credit) || 0;
  return { ...client, solde_credit: solde, echeance: echeance || null, statut: statutCredit(solde, echeance) };
}

/** Totaux des crédits d'une liste de clients complétés. */
export function totauxCredits(clients) {
  const t = { total: 0, nbDebiteurs: 0, retard: 0, nbRetard: 0, semaine: 0, nbSemaine: 0 };
  clients.forEach((c) => {
    if (c.statut.code === 'aucun') return;
    t.total += c.solde_credit;
    t.nbDebiteurs++;
    if (c.statut.code === 'retard') { t.retard += c.solde_credit; t.nbRetard++; }
    if (c.statut.code === 'bientot') { t.semaine += c.solde_credit; t.nbSemaine++; }
  });
  return t;
}

/**
 * Échéance de chaque client = echeance de sa vente à crédit validée la plus récente.
 * Renvoie Map client_id → echeance.
 */
async function chargerEcheances(idBoutique, idClient = null) {
  let requete = sb.from('ventes')
    .select('client_id, echeance, created_at')
    .eq('boutique_id', idBoutique)
    .eq('mode_paiement', 'credit')
    .eq('statut', 'validee')
    .not('client_id', 'is', null)
    .order('created_at', { ascending: false });
  if (idClient) requete = requete.eq('client_id', idClient).limit(1);
  const { data, error } = await requete;
  if (error) throw error;
  const echeances = new Map();
  data.forEach((v) => { if (!echeances.has(v.client_id)) echeances.set(v.client_id, v.echeance); });
  return echeances;
}

/** Tous les clients de la boutique avec statut, plus les totaux des crédits. */
export async function chargerSituationCredits(idBoutique) {
  const [clientsRes, echeances] = await Promise.all([
    sb.from('clients').select(COLONNES_CLIENT).eq('boutique_id', idBoutique).order('nom'),
    chargerEcheances(idBoutique)
  ]);
  if (clientsRes.error) throw clientsRes.error;
  const clients = clientsRes.data.map((c) => completerClient(c, echeances.get(c.id)));
  return { clients, totaux: totauxCredits(clients) };
}

/** Un seul client complété (ou null s'il n'existe pas dans cette boutique). */
export async function chargerClient(idBoutique, idClient) {
  const [clientRes, echeances] = await Promise.all([
    sb.from('clients').select(COLONNES_CLIENT).eq('boutique_id', idBoutique).eq('id', idClient).maybeSingle(),
    chargerEcheances(idBoutique, idClient)
  ]);
  if (clientRes.error) throw clientRes.error;
  return clientRes.data ? completerClient(clientRes.data, echeances.get(idClient)) : null;
}

/** Prénoms des membres de la boutique, par id de membre et par user_id. */
export async function chargerNomsMembres(idBoutique) {
  const { data } = await sb.from('membres').select('id, user_id, nom').eq('boutique_id', idBoutique);
  const noms = new Map();
  (data || []).forEach((m) => {
    noms.set(m.id, prenom(m.nom));
    if (m.user_id) noms.set(m.user_id, prenom(m.nom));
  });
  return noms;
}

/* ------------------------------------------------------------ Affichage de l'échéance */

/** Texte d'échéance : 'court' (listes) ou 'long' (fiche). */
export function texteEcheance(client, format = 'court') {
  const { code, ecart } = client.statut;
  if (code === 'aucun') return 'Rien à payer';
  if (!client.echeance) return 'Sans échéance';
  if (code === 'retard') {
    return format === 'court'
      ? `Dépassée · ${-ecart} j`
      : `Échéance dépassée de ${jours(-ecart)} (${formatDate(client.echeance, 'court')})`;
  }
  return format === 'court'
    ? `Le ${formatDate(client.echeance, 'jourMois')}`
    : `Échéance le ${formatDate(client.echeance, 'court')}`;
}

/** Badge coloré d'échéance (rouge retard, orange bientôt, vert ok, gris rien à payer). */
export function badgeEcheance(client, format = 'court') {
  return `<span class="badge-echeance badge-${client.statut.code}">${esc(texteEcheance(client, format))}</span>`;
}

/* ------------------------------------------------------------ Formulaire client */

/**
 * Modale de création (client = null) ou de modification d'un client : nom, téléphone, notes.
 * onEnregistre(client) reçoit la ligne enregistrée (colonnes COLONNES_CLIENT).
 */
export function ouvrirFormulaireClient({ client = null, onEnregistre } = {}) {
  const creation = !client;
  const { el, fermer } = ouvrirModale({
    titre: creation ? 'Nouveau client' : 'Modifier le client',
    contenu: `
      <form class="form-modale" novalidate>
        <div class="champ">
          <label for="client-nom">Nom du client</label>
          <input id="client-nom" name="nom" class="input" type="text" required maxlength="120"
            value="${esc(client?.nom || '')}" placeholder="Ex. Alpha Soumah ou Entreprise Bah BTP">
        </div>
        <div class="champ">
          <label for="client-tel">Téléphone (facultatif)</label>
          <input id="client-tel" name="telephone" class="input" type="tel" inputmode="tel"
            value="${esc(client?.telephone ? formatTelephone(client.telephone) : '')}" placeholder="6XX XX XX XX">
        </div>
        <div class="champ">
          <label for="client-notes">Notes (facultatif)</label>
          <textarea id="client-notes" name="notes" class="input" rows="3" maxlength="500"
            placeholder="Ex. chantier à Kagbélen, paie en fin de mois">${esc(client?.notes || '')}</textarea>
        </div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
          <button type="submit" class="btn btn-primaire">${creation ? 'Enregistrer le client' : 'Enregistrer'}</button>
        </div>
      </form>`
  });
  const formulaire = el.querySelector('form');
  const zoneErreur = formulaire.querySelector('.erreur-form');
  const erreur = (message) => { zoneErreur.textContent = message; zoneErreur.hidden = !message; };

  formulaire.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nom = formulaire.nom.value.trim();
    const saisieTel = formulaire.telephone.value.trim();
    const telephone = saisieTel ? normaliserTelephone(saisieTel) : null;
    const notes = formulaire.notes.value.trim() || null;
    if (nom.length < 2) return erreur('Indiquez le nom du client.');
    if (saisieTel && !telephone) return erreur('Numéro invalide. Exemple : 620 00 00 00.');
    erreur('');

    const bouton = formulaire.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Enregistrement…');
    const requete = creation
      ? sb.from('clients').insert({ boutique_id: etat.boutique.id, nom, telephone, notes })
      : sb.from('clients').update({ nom, telephone, notes }).eq('id', client.id);
    const { data, error } = await requete.select(COLONNES_CLIENT).single();
    if (error) {
      erreur(messageErreur(error));
      boutonOccupe(bouton, false);
      return;
    }
    fermer();
    toast(creation ? `Client « ${data.nom} » ajouté.` : 'Client mis à jour.', 'succes');
    onEnregistre?.(data);
  });
}
