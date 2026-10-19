/**
 * clients.js — Page Clients & crédits (maquettes Clients.dc.html et ClientsMobile.dc.html).
 *
 *  - #/clients        : indicateurs, filtres, liste ; sur ordinateur la fiche s'affiche à droite.
 *  - #/clients/<id>   : sur ordinateur, même page avec ce client sélectionné ;
 *                       sur téléphone, page « Fiche client » en plein écran.
 *
 * Le solde n'est jamais écrit directement : les remboursements passent par la
 * fonction serveur enregistrer_remboursement.
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import { naviguer } from './router.js';
import {
  completerClient, totauxCredits, chargerSituationCredits, chargerClient,
  chargerNomsMembres, badgeEcheance, ouvrirFormulaireClient
} from './clients-commun.js';
import { imprimerRecuRemboursement } from './recu.js';
import { ouvrirDocument } from './documents/donnees.js';
import { LIBELLES_DOCUMENTS } from './documents/rendu.js';
import { COLONNES_CHANTIER, badgeSolde, ouvrirFormulaireChantier } from './chantiers-commun.js';
import { relancerParSms } from './sms.js';
import {
  esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, initiales,
  formatNombre, formatGNF, formatDate, formatTelephone, formatNumeroVente,
  dateISO, formaterSaisieMontant, MODES_PAIEMENT
} from './utils.js';

const LIMITE_HISTORIQUE = 30;
const TAILLE_LOT_IN = 100;
const MODES_REMBOURSEMENT = ['especes', 'orange_money', 'mtn_momo'];
const FILTRES = [
  { code: 'tous', libelle: 'Tous', garde: () => true },
  { code: 'credit', libelle: 'Avec crédit', garde: (c) => c.statut.code !== 'aucun' },
  { code: 'retard', libelle: 'En retard', garde: (c) => c.statut.code === 'retard' },
  { code: 'sans', libelle: 'Sans crédit', garde: (c) => c.statut.code === 'aucun' }
];

const estMobile = () => window.matchMedia('(max-width: 899.98px)').matches;

/** Recherche insensible aux accents et à la casse. */
function normaliserTexte(texte) {
  return String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** « Ciment CPJ 42,5 ×30, Fer Ø10 ×12 » (2 articles max, puis « +N »). */
function resumeArticles(lignes) {
  const textes = lignes.map((l) => `${l.nom_produit} ×${formatNombre(l.quantite, 3)}`);
  return textes.slice(0, 2).join(', ') + (textes.length > 2 ? ` +${textes.length - 2}` : '');
}

/** Lignes de ventes pour une liste d'ids (requêtes découpées pour garder des URL courtes). */
async function chargerLignesVentes(idsVentes) {
  const parVente = new Map();
  for (let i = 0; i < idsVentes.length; i += TAILLE_LOT_IN) {
    const { data, error } = await sb.from('ventes_lignes')
      .select('vente_id, nom_produit, quantite, unite')
      .in('vente_id', idsVentes.slice(i, i + TAILLE_LOT_IN));
    if (error) throw error;
    data.forEach((l) => {
      if (!parVente.has(l.vente_id)) parVente.set(l.vente_id, []);
      parVente.get(l.vente_id).push(l);
    });
  }
  return parVente;
}

/** Point d'entrée de la route #/clients et #/clients/<id>. */
export function afficherClients(conteneur, params) {
  const idDemande = params.get('id');
  if (idDemande && estMobile()) afficherFichePage(conteneur, idDemande);
  else afficherListe(conteneur, idDemande);
}

/* =========================================================================
   Page liste (+ fiche à droite sur ordinateur)
   ========================================================================= */

function afficherListe(conteneur, idSelection) {
  const boutique = etat.boutique;
  const s = {
    clients: [],
    totaux: null,
    rembourse: { montant: 0, nb: 0 },
    derniersAchats: new Map(),
    filtre: 'credit',
    recherche: '',
    selection: idSelection,
    charge: false
  };
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);
  const nomsMembres = chargerNomsMembres(boutique.id);

  conteneur.innerHTML = `
    <div class="page page-clients">
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour seul-ordi" href="#/tableau-de-bord">← Tableau de bord</a>
          <h1>Clients &amp; crédits</h1>
        </div>
        <div class="dash-entete-actions entete-clients-actions">
          <label class="recherche-entete recherche-clients">
            ${icone('recherche', 18, 2)}
            <span class="sr-only">Rechercher un client</span>
            <input id="recherche-clients" type="search" placeholder="Nom ou téléphone du client…" autocomplete="off">
          </label>
          <button type="button" class="btn btn-primaire" data-action="nouveau-client">${icone('plus', 18, 2.4)} Nouveau client</button>
        </div>
      </header>

      <section class="kpis-clients" aria-label="Résumé des crédits" data-zone="kpis">
        ${'<div class="carte kpi-client"><span class="squelette" style="height:13px;width:60%"></span><span class="squelette" style="height:26px;width:80%"></span><span class="squelette" style="height:12px;width:55%"></span></div>'.repeat(4)}
      </section>

      <div class="clients-corps">
        <section class="carte clients-liste" aria-label="Liste des clients">
          <div class="puces" role="group" aria-label="Filtrer" data-zone="filtres"></div>
          <div class="entete-liste-clients seul-ordi" aria-hidden="true">
            <span>Client</span><span>Échéance</span><span>Dernier achat</span><span class="droite">Doit</span>
          </div>
          <ul class="liste-clients-page" data-zone="liste">
            ${'<li class="squelette-ligne"><span class="squelette" style="height:14px;width:45%"></span><span class="squelette" style="height:10px;width:70%"></span></li>'.repeat(6)}
          </ul>
        </section>
        <aside class="fiche-cadre seul-ordi" aria-label="Fiche client" data-zone="fiche"></aside>
      </div>
    </div>`;

  /* ---------------- Rendu */

  function clientsFiltres() {
    const garde = FILTRES.find((f) => f.code === s.filtre).garde;
    const q = normaliserTexte(s.recherche.trim());
    const chiffres = s.recherche.replace(/\D/g, '');
    return s.clients
      .filter((c) => garde(c))
      .filter((c) => !q
        || normaliserTexte(c.nom).includes(q)
        || (chiffres.length >= 3 && String(c.telephone || '').includes(chiffres)))
      .sort((a, b) => (a.statut.code === 'retard' ? 0 : 1) - (b.statut.code === 'retard' ? 0 : 1)
        || b.solde_credit - a.solde_credit
        || a.nom.localeCompare(b.nom, 'fr'));
  }

  function renderKpis() {
    const t = s.totaux;
    const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
    zone('kpis').innerHTML = [
      { libelle: 'Total des crédits', valeur: t.total, encre: 'var(--text)',
        sous: `${pluriel(t.nbDebiteurs, 'client doit', 'clients doivent')} de l’argent` },
      { libelle: 'En retard', valeur: t.retard, encre: 'var(--danger)',
        sous: `${pluriel(t.nbRetard, 'client', 'clients')} · échéance dépassée` },
      { libelle: 'À encaisser cette semaine', valeur: t.semaine, encre: 'var(--alerte)',
        sous: `${pluriel(t.nbSemaine, 'échéance', 'échéances')} d’ici 7 jours` },
      { libelle: 'Remboursé ce mois', valeur: s.rembourse.montant, encre: 'var(--succes)',
        sous: pluriel(s.rembourse.nb, 'paiement reçu', 'paiements reçus') }
    ].map((k) => `
      <div class="carte kpi-client">
        <span class="kpi-libelle">${esc(k.libelle)}</span>
        <span class="kpi-client-valeur" style="color:${k.encre}">${formatGNF(k.valeur)}</span>
        <span class="kpi-client-sous">${esc(k.sous)}</span>
      </div>`).join('');
  }

  function renderFiltres() {
    zone('filtres').innerHTML = FILTRES.map((f) => {
      const n = s.clients.filter(f.garde).length;
      const actif = f.code === s.filtre;
      return `<button type="button" class="puce ${actif ? 'active' : ''}" data-filtre="${f.code}" aria-pressed="${actif}">${esc(f.libelle)} (${n})</button>`;
    }).join('');
  }

  function renderListe() {
    if (!s.charge) return;
    if (!s.clients.length) {
      zone('liste').innerHTML = `
        <li class="etat-vide etat-vide-large">
          <p>Aucun client pour l’instant. Ajoutez vos clients pour suivre leurs achats et leurs crédits.</p>
          <button type="button" class="btn btn-primaire" data-action="nouveau-client">Ajouter un client</button>
        </li>`;
      return;
    }
    const liste = clientsFiltres();
    if (!liste.length) {
      zone('liste').innerHTML = `<li class="etat-vide etat-vide-large"><p>${s.recherche.trim() ? `Aucun client ne correspond à « ${esc(s.recherche.trim())} ».` : 'Aucun client dans ce filtre.'}</p></li>`;
      return;
    }
    zone('liste').innerHTML = liste.map((c) => {
      const choisi = c.id === s.selection;
      return `
        <li>
          <button type="button" class="ligne-client ${choisi ? 'selectionnee' : ''}" data-client="${esc(c.id)}" ${choisi ? 'aria-current="true"' : ''}>
            <span class="lc-client">
              <span class="avatar">${esc(initiales(c.nom))}</span>
              <span class="lc-textes">
                <span class="gras">${esc(c.nom)}</span>
                <span class="discret">${esc(c.telephone ? formatTelephone(c.telephone) : 'Sans téléphone')}</span>
              </span>
            </span>
            <span class="lc-echeance">${badgeEcheance(c, 'court')}</span>
            <span class="lc-achat">${esc(s.derniersAchats.get(c.id) || '—')}</span>
            <span class="lc-montant ${c.statut.code === 'retard' ? 'texte-danger' : ''}">${c.solde_credit > 0 ? formatGNF(c.solde_credit) : '—'}</span>
          </button>
        </li>`;
    }).join('');
  }

  function renderTout() {
    renderKpis();
    renderFiltres();
    renderListe();
  }

  /* ---------------- Sélection et fiche (ordinateur) */

  async function selectionner(id, { defiler = false } = {}) {
    const client = s.clients.find((c) => c.id === id);
    if (!client) return;
    s.selection = id;
    history.replaceState(null, '', `#/clients/${encodeURIComponent(id)}`);
    conteneur.querySelectorAll('.ligne-client').forEach((ligne) => {
      const choisi = ligne.dataset.client === id;
      ligne.classList.toggle('selectionnee', choisi);
      if (choisi) ligne.setAttribute('aria-current', 'true');
      else ligne.removeAttribute('aria-current');
    });
    monterFiche(zone('fiche'), client, { mode: 'cadre', nomsMembres, onMaj: majClient });
    // Fiche passée sous la liste (écrans moyens) : on la fait apparaître.
    const fiche = zone('fiche');
    if (defiler && fiche.offsetTop > conteneur.querySelector('.clients-liste').offsetTop + 10) {
      fiche.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function selectionParDefaut() {
    if (estMobile()) return;
    const premier = s.clients.some((c) => c.id === s.selection) ? s.selection : clientsFiltres()[0]?.id;
    if (premier) selectionner(premier);
    else zone('fiche').innerHTML = '<div class="fiche-vide"><p>Sélectionnez un client pour voir sa fiche.</p></div>';
  }

  /** Mise à jour après un remboursement ou une modification de client. */
  function majClient(clientMaj, { montantRembourse = 0 } = {}) {
    const index = s.clients.findIndex((c) => c.id === clientMaj.id);
    if (index >= 0) s.clients[index] = clientMaj;
    s.totaux = totauxCredits(s.clients);
    if (montantRembourse) {
      s.rembourse.montant += montantRembourse;
      s.rembourse.nb += 1;
    }
    renderTout();
  }

  function nouveauClient() {
    ouvrirFormulaireClient({
      onEnregistre: (ligne) => {
        const client = completerClient(ligne, null);
        s.clients.push(client);
        s.totaux = totauxCredits(s.clients);
        s.filtre = 'tous';
        renderTout();
        if (estMobile()) naviguer(`clients/${client.id}`);
        else selectionner(client.id, { defiler: true });
      }
    });
  }

  /* ---------------- Données */

  async function chargerDerniersAchats() {
    const { data, error } = await sb.from('ventes')
      .select('id, client_id, created_at')
      .eq('boutique_id', boutique.id)
      .eq('statut', 'validee')
      .not('client_id', 'is', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const dernieres = new Map();
    data.forEach((v) => { if (!dernieres.has(v.client_id)) dernieres.set(v.client_id, v); });
    const lignes = await chargerLignesVentes([...dernieres.values()].map((v) => v.id));
    const textes = new Map();
    dernieres.forEach((v, idClient) => {
      const resume = resumeArticles(lignes.get(v.id) || []);
      textes.set(idClient, `${resume ? resume + ' · ' : ''}${formatDate(v.created_at, 'jourMois')}`);
    });
    return textes;
  }

  async function chargerRembourseMois() {
    const debutMois = `${dateISO().slice(0, 8)}01T00:00:00Z`; // Conakry = UTC
    const { data, error } = await sb.from('paiements_credit')
      .select('montant')
      .eq('boutique_id', boutique.id)
      .gte('created_at', debutMois);
    if (error) throw error;
    return { montant: data.reduce((somme, p) => somme + (Number(p.montant) || 0), 0), nb: data.length };
  }

  async function charger() {
    try {
      const [situation, achats, rembourse] = await Promise.all([
        chargerSituationCredits(boutique.id), chargerDerniersAchats(), chargerRembourseMois()
      ]);
      s.clients = situation.clients;
      s.totaux = situation.totaux;
      s.derniersAchats = achats;
      s.rembourse = rembourse;
    } catch (err) {
      const message = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p>`;
      zone('kpis').innerHTML = message;
      zone('liste').innerHTML = `<li>${message}</li>`;
      return;
    }
    s.charge = true;
    // Client demandé dans l'URL mais hors filtre : on élargit le filtre pour le montrer.
    const demande = s.clients.find((c) => c.id === s.selection);
    if (demande && !FILTRES.find((f) => f.code === s.filtre).garde(demande)) s.filtre = 'tous';
    renderTout();
    selectionParDefaut();
  }

  /* ---------------- Événements */

  conteneur.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="nouveau-client"]')) return nouveauClient();
    const filtre = e.target.closest('[data-filtre]');
    if (filtre) {
      s.filtre = filtre.dataset.filtre;
      renderFiltres();
      renderListe();
      return undefined;
    }
    const ligne = e.target.closest('[data-client]');
    if (ligne && ligne.closest('[data-zone="liste"]')) {
      if (estMobile()) naviguer(`clients/${ligne.dataset.client}`);
      else selectionner(ligne.dataset.client, { defiler: true });
    }
    return undefined;
  });
  conteneur.querySelector('#recherche-clients').addEventListener('input', (e) => {
    s.recherche = e.target.value;
    renderListe();
  });

  charger();
}

/* =========================================================================
   Fiche client en pleine page (téléphone)
   ========================================================================= */

async function afficherFichePage(conteneur, idClient) {
  // La fiche est montée dans son propre cadre (et pas dans #vue, partagé par toutes les pages).
  conteneur.innerHTML = `
    <div class="fiche-page-cadre">
      <div class="fiche-client fiche-page">
        <div class="fiche-entete">
          <div class="fiche-page-haut">
            <a href="#/clients" class="btn-icone btn-icone-sombre" aria-label="Retour à la liste des clients">${icone('retour', 20, 2)}</a>
            <span class="fiche-page-titre">Fiche client</span>
          </div>
          <span class="squelette" style="height:52px;width:70%"></span>
          <span class="squelette" style="height:40px;width:55%"></span>
        </div>
      </div>
    </div>`;
  const cadre = conteneur.querySelector('.fiche-page-cadre');
  let client;
  try {
    client = await chargerClient(etat.boutique.id, idClient);
  } catch (err) {
    cadre.querySelector('.fiche-entete').insertAdjacentHTML('beforeend', `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`);
    return;
  }
  if (!cadre.isConnected) return;
  if (!client) {
    cadre.innerHTML = `
      <div class="page"><section class="carte bientot">
        <h1>Client introuvable</h1>
        <p class="bientot-texte">Ce client n’existe pas ou n’appartient pas à cette boutique.</p>
        <a class="btn btn-primaire" href="#/clients">Retour aux clients</a>
      </section></div>`;
    return;
  }
  monterFiche(cadre, client, { mode: 'page', nomsMembres: chargerNomsMembres(etat.boutique.id) });
}

/* =========================================================================
   Fiche client (commune au cadre ordinateur et à la page téléphone)
   ========================================================================= */

/**
 * Affiche la fiche d'un client dans `zone` et gère ses actions.
 * mode : 'cadre' (à droite de la liste) ou 'page' (téléphone, plein écran).
 * onMaj(client, { montantRembourse }) : prévient la liste d'un changement.
 */
function monterFiche(zone, clientInitial, { mode, nomsMembres, onMaj }) {
  const boutique = etat.boutique;
  let client = clientInitial;
  const remb = { montant: null, mode: 'especes', enCours: false, detteSoldee: false };
  const histo = { limite: LIMITE_HISTORIQUE, html: '' };

  function rendre() {
    const tel = client.telephone;
    const messageWhatsApp = client.solde_credit > 0
      ? `Bonjour ${client.nom}, c’est la boutique ${boutique.nom}. Petit rappel : il reste ${formatGNF(client.solde_credit)} à régler. Merci !`
      : `Bonjour ${client.nom}, c’est la boutique ${boutique.nom}.`;
    const depuis = client.created_at ? ` · client depuis ${formatDate(client.created_at, 'moisAnnee')}` : '';

    zone.innerHTML = `
      <div class="fiche-client fiche-${mode} ${client.solde_credit > 0 ? 'avec-remboursement' : ''}">
        <div class="fiche-entete">
          ${mode === 'page' ? `
            <div class="fiche-page-haut">
              <a href="#/clients" class="btn-icone btn-icone-sombre" aria-label="Retour à la liste des clients">${icone('retour', 20, 2)}</a>
              <span class="fiche-page-titre">Fiche client</span>
            </div>` : ''}
          <div class="fiche-identite">
            <span class="avatar-fiche">${esc(initiales(client.nom))}</span>
            <div class="fiche-identite-textes">
              <span class="fiche-nom">${esc(client.nom)}</span>
              <span class="fiche-sous">${esc((tel ? formatTelephone(tel) : 'Sans téléphone') + depuis)}</span>
            </div>
            <button type="button" class="btn-icone btn-icone-sombre btn-crayon" data-action="modifier" aria-label="Modifier le client">${icone('crayon', 18, 2)}</button>
          </div>
          <div class="fiche-reste">
            <span class="fiche-reste-libelle">Reste à payer</span>
            <span class="fiche-reste-montant">${formatNombre(client.solde_credit)} <span>GNF</span></span>
            ${badgeEcheance(client, 'long')}
          </div>
          ${client.notes ? `<p class="fiche-notes">${esc(client.notes)}</p>` : ''}
        </div>

        <div class="fiche-corps">
          <div class="actions-client">
            <button type="button" class="action-client" data-action="relancer" ${tel && client.solde_credit > 0 && peut('clients.relancer') ? '' : `disabled title="${tel ? 'Ce client ne doit rien' : 'Aucun numéro enregistré'}"`}>${icone('sms', 20, 2)}<span>Relancer<span class="seul-ordi"> par</span> SMS</span></button>
            ${tel
              ? `<a class="action-client" href="tel:+${esc(tel)}">${icone('telephone', 20, 2)}<span>Appeler</span></a>`
              : `<button type="button" class="action-client" disabled title="Aucun numéro enregistré">${icone('telephone', 20, 2)}<span>Appeler</span></button>`}
            ${tel
              ? `<a class="action-client seul-mobile" href="https://wa.me/${esc(tel)}?text=${encodeURIComponent(messageWhatsApp)}" target="_blank" rel="noopener">${icone('whatsapp', 20, 2)}<span>WhatsApp</span></a>`
              : `<button type="button" class="action-client seul-mobile" disabled title="Aucun numéro enregistré">${icone('whatsapp', 20, 2)}<span>WhatsApp</span></button>`}
            <a class="action-client seul-ordi" href="#/caisse?client=${encodeURIComponent(client.id)}">${icone('plus', 20, 2)}<span>Nouvelle vente</span></a>
          </div>

          ${peut('messages.modifier') ? `
            <label class="case-option case-promo">
              <input type="checkbox" data-action="stop-promo" ${client.stop_promo ? 'checked' : ''}>
              <span><strong>Ne pas envoyer de promotions</strong> <span class="discret">(campagnes SMS). Les reçus et relances de crédit restent envoyés.</span></span>
            </label>` : ''}

          <section class="bloc-chantier-client" aria-label="Chantier" data-zone="chantier-client"></section>

          ${remb.detteSoldee ? `<p class="dette-soldee" role="status">${icone('valide', 18, 2.4)} Dette soldée ✔</p>` : ''}
          ${client.solde_credit > 0 ? blocRemboursementHTML() : ''}

          <section class="historique-client" aria-label="Historique">
            <h2>Historique</h2>
            <div data-zone="historique">${histo.html || squelettesHistorique()}</div>
          </section>

          <section class="documents-client" aria-label="Documents émis" data-zone="documents-client" hidden></section>
        </div>
      </div>`;
    majApercu();
    chargerHistorique();
    chargerChantiersClient();
    chargerDocumentsClient();
  }

  /* ---------------- Documents émis pour ce client (factures, reçus, bons, devis) */

  async function chargerDocumentsClient() {
    const zoneDocs = zone.querySelector('[data-zone="documents-client"]');
    try {
      const [ventes, devis] = await Promise.all([
        sb.from('ventes').select('id').eq('boutique_id', boutique.id).eq('client_id', client.id).order('created_at', { ascending: false }).limit(300),
        sb.from('proformas').select('id').eq('boutique_id', boutique.id).eq('client_id', client.id).limit(300)
      ]);
      const docs = [];
      const parPaquets = async (colonne, ids) => {
        for (let i = 0; i < ids.length; i += 100) {
          const { data } = await sb.from('documents_emis').select('id, type, numero, total, created_at, vente_id, proforma_id').in(colonne, ids.slice(i, i + 100));
          docs.push(...(data || []));
        }
      };
      await parPaquets('vente_id', (ventes.data || []).map((v) => v.id));
      await parPaquets('proforma_id', (devis.data || []).map((p) => p.id));
      if (!zoneDocs.isConnected || !docs.length) return;
      docs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      zoneDocs.hidden = false;
      zoneDocs.innerHTML = `<h2>Documents émis</h2>
        <ul class="liste-documents-client">${docs.slice(0, 30).map((d) => `
          <li><button type="button" class="item-document" data-doc-type="${esc(d.type)}" data-doc-vente="${esc(d.vente_id || '')}" data-doc-proforma="${esc(d.proforma_id || '')}">
            ${icone('document', 18, 2)}
            <span class="client-textes"><span class="gras">${esc(d.numero)}</span><span class="discret">${esc(LIBELLES_DOCUMENTS[d.type] || d.type)} · ${esc(formatDate(d.created_at, 'court'))}</span></span>
            <span class="gras">${d.type === 'bon_livraison' ? '' : formatGNF(d.total)}</span>
          </button></li>`).join('')}</ul>`;
      zoneDocs.onclick = (e) => {
        const b = e.target.closest('.item-document');
        if (!b) return;
        ouvrirDocument({ type: b.dataset.docType, vente: b.dataset.docVente || null, proforma: b.dataset.docProforma || null });
      };
    } catch { /* section facultative */ }
  }

  function squelettesHistorique() {
    return '<div class="squelette-ligne"><span class="squelette" style="height:14px;width:55%"></span><span class="squelette" style="height:10px;width:75%"></span></div>'.repeat(3);
  }

  /* ---------------- Chantiers du client */

  async function chargerChantiersClient() {
    const zoneChantier = zone.querySelector('[data-zone="chantier-client"]');
    const { data, error } = await sb.from('chantiers').select(COLONNES_CHANTIER)
      .eq('boutique_id', boutique.id).eq('client_id', client.id).order('created_at', { ascending: false });
    if (!zoneChantier?.isConnected) return;
    if (error) { zoneChantier.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(error))}</p>`; return; }
    const ouvert = data.find((c) => c.statut === 'ouvert');
    const clotures = data.filter((c) => c.statut !== 'ouvert');
    zoneChantier.innerHTML = `
      <h2>Chantier</h2>
      ${ouvert ? `
        <div class="chantier-ouvert-client">
          <span class="client-textes"><span class="gras">${esc(ouvert.nom)}</span><span class="discret">${esc(ouvert.numero)}</span></span>
          ${badgeSolde(ouvert.solde)}
          <a class="btn btn-secondaire btn-petit" href="#/chantiers/${encodeURIComponent(ouvert.id)}">Ouvrir le compte</a>
        </div>` : '<button type="button" class="btn btn-secondaire btn-bloc" data-action="ouvrir-chantier">Ouvrir un chantier pour ce client</button>'}
      ${clotures.length ? `<ul class="chantiers-clotures">${clotures.map((c) => `
        <li><a href="#/chantiers/${encodeURIComponent(c.id)}">${esc(c.numero)} · ${esc(c.nom)}</a> <span class="discret">clôturé</span></li>`).join('')}</ul>` : ''}`;
  }

  /* ---------------- Remboursement */

  function blocRemboursementHTML() {
    return `
      <section class="bloc-remboursement" aria-labelledby="titre-remb-${mode}">
        <span class="poignee seul-mobile" aria-hidden="true"></span>
        <h2 id="titre-remb-${mode}">Encaisser un remboursement</h2>
        <div class="champ">
          <label for="montant-remb-${mode}">Montant reçu (GNF)</label>
          <div class="montant-saisie">
            <input id="montant-remb-${mode}" class="input input-montant" type="text" inputmode="numeric" autocomplete="off"
              data-ref="montant-remb" placeholder="0" value="${remb.montant ? formatNombre(remb.montant) : ''}" aria-describedby="erreur-remb-${mode}">
            <button type="button" class="btn btn-secondaire" data-action="tout">Tout</button>
          </div>
          <p class="erreur-champ" id="erreur-remb-${mode}" data-ref="erreur-remb" hidden></p>
        </div>
        <div class="modes-remb" role="group" aria-label="Mode de paiement">
          ${MODES_REMBOURSEMENT.map((code) => `
            <button type="button" class="mode-remb" data-mode-remb="${code}" aria-pressed="${remb.mode === code}">${esc(MODES_PAIEMENT[code].libelle)}</button>`).join('')}
        </div>
        <div class="ligne-apercu">
          <span class="discret">Nouveau solde<span class="seul-ordi"> après paiement</span></span>
          <span class="gras" data-ref="nouveau-solde">${formatGNF(client.solde_credit)}</span>
        </div>
        <label class="case-sms inactive seul-ordi">
          <input type="checkbox" disabled>
          <span>Envoyer un reçu de paiement par SMS <small>(bientôt)</small></span>
        </label>
        <button type="button" class="btn btn-primaire btn-grand" data-action="valider-remb" disabled>Valider le remboursement</button>
      </section>`;
  }

  /** Met à jour l'aperçu du nouveau solde, le message d'erreur et l'état du bouton. */
  function majApercu() {
    const bloc = zone.querySelector('.bloc-remboursement');
    if (!bloc) return;
    const montant = remb.montant || 0;
    const depasse = montant > client.solde_credit;
    bloc.querySelector('[data-ref="nouveau-solde"]').textContent = formatGNF(Math.max(0, client.solde_credit - montant));
    const erreur = bloc.querySelector('[data-ref="erreur-remb"]');
    erreur.textContent = depasse ? `Le montant dépasse ce que le client doit (${formatGNF(client.solde_credit)}).` : '';
    erreur.hidden = !depasse;
    bloc.querySelector('.input-montant').setAttribute('aria-invalid', String(depasse));
    const bouton = bloc.querySelector('[data-action="valider-remb"]');
    if (!remb.enCours) bouton.disabled = !(montant > 0) || depasse;
  }

  /** Saisie du montant : chiffres uniquement, espaces de milliers ajoutés pendant la frappe. */
  function saisirMontant(champ) {
    remb.montant = formaterSaisieMontant(champ);
    majApercu();
  }

  async function validerRemboursement(bouton) {
    const montant = remb.montant || 0;
    if (remb.enCours || !(montant > 0) || montant > client.solde_credit) return;
    remb.enCours = true;
    boutonOccupe(bouton, true, 'Enregistrement…');
    const ancienSolde = client.solde_credit;
    const { data, error } = await sb.rpc('enregistrer_remboursement', {
      p_boutique: boutique.id,
      p_client: client.id,
      p_montant: montant,
      p_mode: remb.mode
    });
    remb.enCours = false;
    if (error) {
      boutonOccupe(bouton, false);
      majApercu();
      toast(messageErreur(error), 'erreur', 6000);
      return;
    }
    const retour = Number(Array.isArray(data) ? data[0] : data);
    const nouveauSolde = Number.isFinite(retour) ? retour : Math.max(0, ancienSolde - montant);
    const recu = {
      date: new Date().toISOString(),
      client: client.nom,
      montant,
      mode: remb.mode,
      ancienSolde,
      nouveauSolde,
      encaissePar: etat.membre?.nom || '—'
    };
    client = completerClient({ ...client, solde_credit: nouveauSolde }, client.echeance);
    remb.montant = null;
    remb.mode = 'especes';
    remb.detteSoldee = nouveauSolde === 0;
    toast(`Remboursement de ${formatGNF(montant)} enregistré`, 'succes');
    onMaj?.(client, { montantRembourse: montant });
    rendre();
    proposerRecu(recu);
  }

  function proposerRecu(recu) {
    const { el, fermer } = ouvrirModale({
      titre: 'Remboursement enregistré',
      contenu: `
        <div class="confirmation">
          <span class="confirmation-icone">${icone('valide', 32, 2.6)}</span>
          <p class="confirmation-numero">${esc(recu.client)} · ${esc(MODES_PAIEMENT[recu.mode].libelle)}</p>
          <p class="confirmation-total">${formatGNF(recu.montant)}</p>
          ${recu.nouveauSolde === 0
            ? '<p class="dette-soldee">Dette soldée ✔</p>'
            : `<div class="confirmation-monnaie"><span>Reste à payer</span><strong>${formatGNF(recu.nouveauSolde)}</strong></div>`}
        </div>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire btn-grand" data-action="imprimer">${icone('imprimante', 18, 2)} Imprimer le reçu</button>
          <button type="button" class="btn btn-primaire btn-grand" data-fermer>Terminé</button>
        </div>`
    });
    el.querySelector('[data-action="imprimer"]').addEventListener('click', () => {
      imprimerRecuRemboursement(recu);
      fermer();
    });
  }

  /* ---------------- Historique */

  async function chargerHistorique() {
    const zoneHisto = zone.querySelector('[data-zone="historique"]');
    const idClient = client.id;
    let ventes, paiements, lignes, noms;
    try {
      const [ventesRes, paiementsRes] = await Promise.all([
        sb.from('ventes')
          .select('id, numero, created_at, total, statut')
          .eq('boutique_id', boutique.id)
          .eq('client_id', idClient)
          .eq('mode_paiement', 'credit')
          .order('created_at', { ascending: false })
          .limit(histo.limite),
        sb.from('paiements_credit')
          .select('id, montant, mode, encaisse_par, created_at')
          .eq('boutique_id', boutique.id)
          .eq('client_id', idClient)
          .order('created_at', { ascending: false })
          .limit(histo.limite)
      ]);
      if (ventesRes.error) throw ventesRes.error;
      if (paiementsRes.error) throw paiementsRes.error;
      ventes = ventesRes.data;
      paiements = paiementsRes.data;
      [lignes, noms] = await Promise.all([chargerLignesVentes(ventes.map((v) => v.id)), nomsMembres]);
    } catch (err) {
      if (zoneHisto.isConnected) zoneHisto.innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p>`;
      return;
    }
    if (!zoneHisto.isConnected || client.id !== idClient) return;

    const elements = [
      ...ventes.map((v) => ({ type: 'vente', date: v.created_at, v })),
      ...paiements.map((p) => ({ type: 'paiement', date: p.created_at, p }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    const encorePlus = elements.length > histo.limite || ventes.length === histo.limite || paiements.length === histo.limite;

    if (!elements.length) {
      histo.html = '<p class="discret historique-vide">Aucun achat à crédit ni remboursement pour ce client.</p>';
    } else {
      histo.html = `
        <ul class="historique-liste">
          ${elements.slice(0, histo.limite).map((e) => (e.type === 'vente'
            ? ligneVenteHTML(e.v, lignes.get(e.v.id) || [])
            : lignePaiementHTML(e.p, noms))).join('')}
        </ul>
        ${encorePlus ? '<button type="button" class="btn btn-secondaire btn-bloc" data-action="voir-plus">Voir plus</button>' : ''}`;
    }
    zoneHisto.innerHTML = histo.html;
  }

  function ligneVenteHTML(v, lignes) {
    const annulee = v.statut === 'annulee';
    const resume = resumeArticles(lignes);
    return `
      <li>
        <button type="button" class="hist-ligne hist-vente ${annulee ? 'annulee' : ''}" data-vente="${esc(v.id)}"
          aria-label="Ouvrir la vente ${esc(formatNumeroVente(v.numero))}">
          <span class="hist-icone">${icone('ventes', 16, 2.2)}</span>
          <span class="hist-textes">
            <span class="hist-titre">Achat à crédit · ${esc(formatNumeroVente(v.numero))}${annulee ? ' <span class="tag-annulee">Annulée</span>' : ''}</span>
            <span class="discret">${esc(formatDate(v.created_at, 'court'))}${resume ? ' · ' + esc(resume) : ''}</span>
          </span>
          <span class="hist-montant">+ ${formatNombre(v.total)}</span>
        </button>
      </li>`;
  }

  function lignePaiementHTML(p, noms) {
    const nom = noms.get(p.encaisse_par);
    return `
      <li class="hist-ligne hist-paiement">
        <span class="hist-icone">${icone('moins', 16, 2.2)}</span>
        <span class="hist-textes">
          <span class="hist-titre">Remboursement · ${esc(MODES_PAIEMENT[p.mode]?.libelle || p.mode)}</span>
          <span class="discret">${esc(formatDate(p.created_at, 'court'))}${nom ? ' · reçu par ' + esc(nom) : ''}</span>
        </span>
        <span class="hist-montant">− ${formatNombre(p.montant)}</span>
      </li>`;
  }

  /* ---------------- Événements */

  zone.onclick = (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'modifier') {
      ouvrirFormulaireClient({
        client,
        onEnregistre: (ligne) => {
          client = completerClient({ ...client, ...ligne }, client.echeance);
          onMaj?.(client);
          rendre();
        }
      });
    }
    if (action === 'ouvrir-chantier') ouvrirFormulaireChantier({ client });
    if (action === 'relancer') relancerParSms(client, client.solde_credit);
    if (action === 'tout') {
      remb.montant = client.solde_credit;
      const champ = zone.querySelector('[data-ref="montant-remb"]');
      champ.value = formatNombre(remb.montant);
      majApercu();
    }
    if (action === 'valider-remb') validerRemboursement(e.target.closest('button'));
    if (action === 'voir-plus') {
      histo.limite += LIMITE_HISTORIQUE;
      e.target.closest('button').replaceWith(Object.assign(document.createElement('p'), { className: 'discret', textContent: 'Chargement…' }));
      chargerHistorique();
    }
    const mode = e.target.closest('[data-mode-remb]');
    if (mode) {
      remb.mode = mode.dataset.modeRemb;
      zone.querySelectorAll('[data-mode-remb]').forEach((b) => b.setAttribute('aria-pressed', String(b === mode)));
    }
    const vente = e.target.closest('[data-vente]');
    // Détail, réimpression et annulation : page Historique des ventes.
    if (vente) naviguer(`ventes/${vente.dataset.vente}`);
  };
  zone.onchange = async (e) => {
    if (e.target.dataset.action !== 'stop-promo') return;
    const stop = e.target.checked;
    const { error } = await sb.from('clients').update({ stop_promo: stop }).eq('id', client.id);
    if (error) { e.target.checked = !stop; toast(messageErreur(error), 'erreur'); return; }
    client = { ...client, stop_promo: stop };
    toast(stop ? 'Ce client ne recevra plus les promotions.' : 'Ce client recevra de nouveau les promotions.', 'succes');
  };
  zone.oninput = (e) => {
    if (e.target.dataset.ref === 'montant-remb') saisirMontant(e.target);
  };

  rendre();
}
