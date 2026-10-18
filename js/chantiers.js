/**
 * chantiers.js — Comptes chantier (maquettes Chantier.dc.html, ChantierMobile.dc.html, Releve.dc.html).
 *
 *  - #/chantiers                      : liste, 3 indicateurs, ouverture d'un chantier
 *  - #/chantiers/<id>                 : compte (solde, registre, matériaux livrés, actions)
 *  - #/chantiers/<id>/enlevement      : nouvel enlèvement (plein écran sur téléphone)
 *  - #/chantiers/<id>/releve          : situation globale imprimable (A4)
 *
 * Le registre est en ajout seul : rien n'est effacé, une annulation ajoute une ligne.
 * Toutes les écritures passent par des fonctions serveur.
 */
import { sb } from './supabase.js';
import { etat, peut, licenceExpiree } from './state.js';
import { naviguer } from './router.js';
import { chargerNomsMembres } from './clients-commun.js';
import {
  COLONNES_CHANTIER, badgeSolde, ouvrirFormulaireChantier, ouvrirVersement, compresserImage,
  envoyerPhotoBon, afficherPhotoBon
} from './chantiers-commun.js';
import { imprimerBonEnlevement } from './recu.js';
import {
  esc, icone, toast, confirmer, ouvrirModale, boutonOccupe, messageErreur, capitaliser,
  formatNombre, formatGNF, formatQuantite, formatDate, formatTelephone, formatNumeroVente, dateISO, ecartJours,
  lireNombre, lireStockage, ecrireStockage, uniteDivisible, chargerParLots, texteSolde, classeSolde,
  MODES_PAIEMENT
} from './utils.js';

const COLONNES_MOUVEMENT = 'id, chantier_id, type, montant, mode, vente_id, personne, note, photo_path, annule, solde_apres, fait_par, created_at';
const COLONNES_PRODUIT_CAISSE = 'id, nom, unite, prix_detail, prix_gros, stock, seuil_alerte, sur_commande, code_barre';
const TAILLE_LOT_IN = 100;
const NB_HABITUELS = 8;
const NB_SUGGESTIONS = 5;
const FILTRES_REGISTRE = [['tout', 'Tout'], ['enlevements', 'Enlèvements'], ['versements', 'Versements']];
const FILTRES_LISTE = [['ouvert', 'Ouverts'], ['cloture', 'Clôturés'], ['tous', 'Tous']];

const estMobile = () => window.matchMedia('(max-width: 899.98px)').matches;
const jourDe = (horodatage) => String(horodatage).slice(0, 10); // Conakry = UTC

function normaliserTexte(texte) {
  return String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** « Aujourd’hui 09:42 », « Hier 17:10 », sinon « 15/10 08:31 ». */
function dateCourte(horodatage) {
  const heure = formatDate(horodatage, 'heure');
  const ecart = ecartJours(horodatage);
  if (ecart === 0) return `Aujourd’hui ${heure}`;
  if (ecart === -1) return `Hier ${heure}`;
  return `${formatDate(horodatage, 'jourMois')} ${heure}`;
}

/** Exécute une requête par lots d'identifiants (URL courtes) et concatène les résultats. */
async function parLots(ids, requete) {
  const lignes = [];
  for (let i = 0; i < ids.length; i += TAILLE_LOT_IN) {
    const { data, error } = await requete(ids.slice(i, i + TAILLE_LOT_IN));
    if (error) throw error;
    lignes.push(...data);
  }
  return lignes;
}

/** « Ciment CPJ 42,5 ×30, Fer Ø10 ×12 +1 ». */
function resumeArticles(lignes) {
  const textes = lignes.map((l) => `${l.nom_produit} ×${formatNombre(l.quantite, 3)}`);
  return textes.slice(0, 2).join(', ') + (textes.length > 2 ? ` +${textes.length - 2}` : '');
}

/* =========================================================================
   Données d'un chantier
   ========================================================================= */

/** Chantier + client (ou null si introuvable dans la boutique). */
async function chargerChantier(id) {
  const { data: chantier, error } = await sb.from('chantiers').select(COLONNES_CHANTIER)
    .eq('boutique_id', etat.boutique.id).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!chantier) return null;
  const { data: client } = await sb.from('clients').select('id, nom, telephone').eq('id', chantier.client_id).maybeSingle();
  return { chantier, client: client || { id: chantier.client_id, nom: 'Client', telephone: null } };
}

/**
 * Registre complet (ordre chronologique) + numéros des ventes et lignes des enlèvements.
 * Renvoie { mouvements, numeros: Map vente_id → numero, lignes: Map vente_id → [lignes] }.
 */
async function chargerRegistre(idChantier) {
  const mouvements = await chargerParLots((d, f) => sb.from('chantier_mouvements').select(COLONNES_MOUVEMENT)
    .eq('chantier_id', idChantier).order('created_at', { ascending: true }).range(d, f));
  const idsVentes = [...new Set(mouvements.map((m) => m.vente_id).filter(Boolean))];
  const [ventes, lignesVentes] = await Promise.all([
    parLots(idsVentes, (ids) => sb.from('ventes').select('id, numero').in('id', ids)),
    parLots(idsVentes, (ids) => sb.from('ventes_lignes')
      .select('id, vente_id, produit_id, nom_produit, unite, quantite, prix_unitaire, total').in('vente_id', ids))
  ]);
  const lignes = new Map();
  lignesVentes.forEach((l) => {
    if (!lignes.has(l.vente_id)) lignes.set(l.vente_id, []);
    lignes.get(l.vente_id).push(l);
  });
  return { mouvements, numeros: new Map(ventes.map((v) => [v.id, v.numero])), lignes };
}

/** Totaux non annulés : versé, enlevé, nombres. */
function totauxRegistre(mouvements) {
  const t = { verse: 0, nbVersements: 0, enleve: 0, nbEnlevements: 0 };
  mouvements.forEach((m) => {
    if (m.annule) return;
    if (m.type === 'versement') { t.verse += Number(m.montant) || 0; t.nbVersements++; }
    if (m.type === 'enlevement') { t.enleve += Number(m.montant) || 0; t.nbEnlevements++; }
  });
  return t;
}

/** Cumul par article des enlèvements non annulés. */
function materiauxLivres(mouvements, lignes) {
  const cumul = new Map();
  mouvements.filter((m) => m.type === 'enlevement' && !m.annule).forEach((m) => {
    (lignes.get(m.vente_id) || []).forEach((l) => {
      const cle = `${l.nom_produit}|${l.unite || ''}`;
      const c = cumul.get(cle) || { nom: l.nom_produit, unite: l.unite, quantite: 0, total: 0 };
      c.quantite += Number(l.quantite) || 0;
      c.total += Number(l.total) || 0;
      cumul.set(cle, c);
    });
  });
  return [...cumul.values()].sort((a, b) => b.total - a.total);
}

/** Message WhatsApp de situation (texte). */
function messageSituation(chantier, client, totaux, solde, rappelPdf = false) {
  const etatSolde = solde < 0 ? `Reste à payer : ${formatGNF(-solde)}` : solde > 0 ? `Avance disponible : ${formatGNF(solde)}` : 'Compte soldé';
  return `Bonjour ${client.nom}, voici la situation du chantier « ${chantier.nom} » (${chantier.numero}) au ${formatDate(new Date(), 'court')} :\n`
    + `- Total versé : ${formatGNF(totaux.verse)}\n- Total enlevé : ${formatGNF(totaux.enleve)}\n- ${etatSolde}\n`
    + `${rappelPdf ? 'Je vous envoie aussi le PDF de la situation.\n' : ''}Merci. ${etat.boutique.nom}`;
}

function lienWhatsAppClient(client, message) {
  return `https://wa.me/${client.telephone || ''}?text=${encodeURIComponent(message)}`;
}

/** Point d'entrée de toutes les routes #/chantiers… */
export function afficherChantiers(conteneur, params) {
  const id = params.get('id');
  const vue = params.get('vue');
  if (id && vue === 'enlevement') afficherEnlevement(conteneur, id, params);
  else if (id && vue === 'releve') afficherReleve(conteneur, id);
  else if (id) afficherCompte(conteneur, id, params);
  else afficherListe(conteneur);
}

/* =========================================================================
   Liste des chantiers
   ========================================================================= */

function afficherListe(conteneur) {
  const boutique = etat.boutique;
  const s = { chantiers: [], clients: new Map(), derniers: new Map(), filtre: 'ouvert', recherche: '' };
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);

  conteneur.innerHTML = `
    <div class="page page-chantiers">
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour seul-ordi" href="#/tableau-de-bord">← Tableau de bord</a>
          <h1>Chantiers</h1>
          <span>Avances, enlèvements et versements de vos clients chantier</span>
        </div>
        <div class="dash-entete-actions entete-clients-actions">
          <label class="recherche-entete recherche-clients">
            ${icone('recherche', 18, 2)}
            <span class="sr-only">Rechercher un chantier</span>
            <input id="recherche-chantiers" type="search" placeholder="Chantier, client ou n°…" autocomplete="off">
          </label>
          <button type="button" class="btn btn-primaire" data-action="ouvrir">${icone('plus', 18, 2.4)} Ouvrir un chantier</button>
        </div>
      </header>
      <section class="kpis-clients kpis-chantiers" aria-label="Résumé des chantiers" data-zone="kpis">
        ${'<div class="carte kpi-client"><span class="squelette" style="height:13px;width:60%"></span><span class="squelette" style="height:26px;width:80%"></span></div>'.repeat(3)}
      </section>
      <section class="carte clients-liste" aria-label="Liste des chantiers">
        <div class="puces" role="group" aria-label="Filtrer" data-zone="filtres"></div>
        <div class="entete-liste-chantiers seul-ordi" aria-hidden="true">
          <span>N°</span><span>Chantier</span><span>Client</span><span>Dernier mouvement</span><span>Statut</span><span class="droite">Solde</span>
        </div>
        <ul class="liste-chantiers" data-zone="liste">
          ${'<li class="squelette-ligne"><span class="squelette" style="height:14px;width:45%"></span><span class="squelette" style="height:10px;width:70%"></span></li>'.repeat(4)}
        </ul>
      </section>
    </div>`;

  function filtres() {
    const q = normaliserTexte(s.recherche.trim());
    return s.chantiers.filter((c) => (s.filtre === 'tous' || c.statut === s.filtre)
      && (!q || [c.nom, c.numero, c.adresse, s.clients.get(c.client_id)].some((t) => normaliserTexte(t).includes(q))));
  }

  function render() {
    const ouverts = s.chantiers.filter((c) => c.statut === 'ouvert');
    const dettes = ouverts.reduce((t, c) => t + Math.max(0, -Number(c.solde)), 0);
    const avances = ouverts.reduce((t, c) => t + Math.max(0, Number(c.solde)), 0);
    zone('kpis').innerHTML = [
      { libelle: 'Dettes chantier', valeur: formatGNF(dettes), sous: `${ouverts.filter((c) => c.solde < 0).length} chantier(s) en dette`, encre: 'var(--danger)' },
      { libelle: 'Avances disponibles', valeur: formatGNF(avances), sous: `${ouverts.filter((c) => c.solde > 0).length} chantier(s) en avance`, encre: 'var(--succes)' },
      { libelle: 'Chantiers ouverts', valeur: String(ouverts.length), sous: `${s.chantiers.length - ouverts.length} clôturé(s)`, encre: 'var(--text)' }
    ].map((k) => `
      <div class="carte kpi-client">
        <span class="kpi-libelle">${esc(k.libelle)}</span>
        <span class="kpi-client-valeur" style="color:${k.encre}">${esc(k.valeur)}</span>
        <span class="kpi-client-sous">${esc(k.sous)}</span>
      </div>`).join('');
    zone('filtres').innerHTML = FILTRES_LISTE.map(([code, libelle]) => {
      const n = code === 'tous' ? s.chantiers.length : s.chantiers.filter((c) => c.statut === code).length;
      return `<button type="button" class="puce ${code === s.filtre ? 'active' : ''}" data-filtre="${code}" aria-pressed="${code === s.filtre}">${esc(libelle)} (${n})</button>`;
    }).join('');

    const liste = filtres();
    if (!s.chantiers.length) {
      zone('liste').innerHTML = `
        <li class="etat-vide etat-vide-large">
          <p>Aucun chantier pour l’instant. Ouvrez un compte chantier pour suivre l’avance d’un client et ses enlèvements.</p>
          <button type="button" class="btn btn-primaire" data-action="ouvrir">Ouvrir un chantier</button>
        </li>`;
      return;
    }
    zone('liste').innerHTML = liste.length ? liste.map((c) => `
      <li>
        <a class="ligne-chantier" href="#/chantiers/${encodeURIComponent(c.id)}">
          <span class="lch-numero">${esc(c.numero)}</span>
          <span class="lch-nom"><span class="gras">${esc(c.nom)}</span>${c.adresse ? `<span class="discret">${esc(c.adresse)}</span>` : ''}</span>
          <span class="lch-client">${esc(s.clients.get(c.client_id) || '—')}</span>
          <span class="lch-dernier discret">${esc(s.derniers.has(c.id) ? dateCourte(s.derniers.get(c.id)) : '—')}</span>
          <span class="lch-statut"><span class="badge-statut-chantier ${c.statut}">${c.statut === 'ouvert' ? 'Ouvert' : 'Clôturé'}</span></span>
          <span class="lch-solde">${badgeSolde(c.solde)}</span>
        </a>
      </li>`).join('') : '<li class="etat-vide etat-vide-large"><p>Aucun chantier dans ce filtre.</p></li>';
  }

  async function charger() {
    try {
      const chantiers = await chargerParLots((d, f) => sb.from('chantiers').select(COLONNES_CHANTIER)
        .eq('boutique_id', boutique.id).order('created_at', { ascending: false }).range(d, f));
      const idsClients = [...new Set(chantiers.map((c) => c.client_id))];
      const [clients, mouvements] = await Promise.all([
        parLots(idsClients, (ids) => sb.from('clients').select('id, nom').in('id', ids)),
        chargerParLots((d, f) => sb.from('chantier_mouvements').select('chantier_id, created_at')
          .eq('boutique_id', boutique.id).order('created_at', { ascending: false }).range(d, f))
      ]);
      s.chantiers = chantiers.map((c) => ({ ...c, solde: Number(c.solde) || 0 }));
      s.clients = new Map(clients.map((c) => [c.id, c.nom]));
      mouvements.forEach((m) => { if (!s.derniers.has(m.chantier_id)) s.derniers.set(m.chantier_id, m.created_at); });
      render();
    } catch (err) {
      zone('liste').innerHTML = `<li class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</li>`;
      zone('kpis').innerHTML = '';
    }
  }

  conteneur.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="ouvrir"]')) { ouvrirFormulaireChantier(); return; }
    const filtre = e.target.closest('[data-filtre]');
    if (filtre) { s.filtre = filtre.dataset.filtre; render(); }
  });
  conteneur.querySelector('#recherche-chantiers').addEventListener('input', (e) => { s.recherche = e.target.value; render(); });
  charger();
}

/* =========================================================================
   Compte chantier
   ========================================================================= */

function afficherCompte(conteneur, id, params) {
  const s = { chantier: null, client: null, registre: null, noms: new Map(), filtre: 'tout' };
  conteneur.innerHTML = `
    <div class="page page-chantier">
      <div class="squelette" style="height:60px;width:50%"></div>
      <div class="squelette" style="height:120px;border-radius:18px"></div>
    </div>`;

  /** Phrase sous le solde : depuis quand l'avance est épuisée, etc. */
  function explication(solde) {
    if (solde > 0) return 'Les prochains enlèvements seront déduits de cette avance.';
    if (solde === 0) return 'Aucune avance ni dette pour le moment.';
    const mouvements = s.registre.mouvements;
    let depuis = null;
    for (let i = mouvements.length - 1; i >= 0; i--) {
      const avant = i > 0 ? Number(mouvements[i - 1].solde_apres) : 0;
      if (Number(mouvements[i].solde_apres) < 0 && avant >= 0) {
        if (avant > 0) depuis = mouvements[i].created_at;
        break;
      }
    }
    return depuis
      ? `L’avance est épuisée depuis le ${formatDate(depuis, 'jourMois')}. Les prochains enlèvements s’ajoutent à la dette.`
      : 'Les enlèvements s’ajoutent à la dette jusqu’au prochain versement.';
  }

  function titreMouvement(m) {
    const numero = formatNumeroVente(s.registre.numeros.get(m.vente_id));
    if (m.type === 'enlevement') return `Enlèvement · ${numero}`;
    if (m.type === 'versement') return `Versement · ${MODES_PAIEMENT[m.mode]?.libelle || m.mode || ''}`;
    if (m.type === 'annulation_enlevement') return `Annulation enlèvement · ${numero}`;
    return 'Annulation versement';
  }

  function detailMouvement(m) {
    if (m.type === 'enlevement') return resumeArticles(s.registre.lignes.get(m.vente_id) || []);
    const parts = [];
    if (m.type === 'versement' && m.fait_par && s.noms.get(m.fait_par)) parts.push(`reçu par ${s.noms.get(m.fait_par)}`);
    if (m.note) parts.push(m.note);
    return parts.join(' · ');
  }

  function ligneRegistreHTML(m) {
    const chantierOuvert = s.chantier.statut === 'ouvert';
    const credit = m.type === 'versement' || m.type === 'annulation_enlevement';
    const classe = { enlevement: 'enlevement', versement: 'versement' }[m.type] || 'annulation';
    const icones = { enlevement: 'stock', versement: 'plus', annulation_enlevement: 'annuler', annulation_versement: 'annuler' };
    const titre = titreMouvement(m);
    // Photo du bon et annulation d'un versement (gérant), sous le détail de l'opération.
    const actions = [
      m.photo_path ? `<button type="button" class="btn-lien" data-photo="${esc(m.photo_path)}">${icone('photo', 16, 2)} Photo du bon</button>` : '',
      m.type === 'versement' && !m.annule && chantierOuvert && peut('annuler_versement')
        ? `<button type="button" class="btn-lien btn-lien-danger" data-annuler-versement="${esc(m.id)}">Annuler ce versement</button>` : ''
    ].join('');
    return `
      <li class="ligne-registre type-${classe} ${m.annule ? 'annulee' : ''}">
        <span class="lr-date">${esc(dateCourte(m.created_at))}</span>
        <span class="lr-operation">
          <span class="hist-icone">${icone(icones[m.type] || 'document', 16, 2.2)}</span>
          <span class="hist-textes">
            <span class="hist-titre">${m.vente_id && m.type === 'enlevement'
              ? `<a href="#/ventes/${encodeURIComponent(m.vente_id)}">${esc(titre)}</a>` : esc(titre)}${m.annule ? ' <span class="tag-annulee">Annulé</span>' : ''}</span>
            <span class="discret">${esc(detailMouvement(m))}</span>
            ${actions ? `<span class="lr-actions">${actions}</span>` : ''}
          </span>
        </span>
        <span class="lr-personne">${esc(m.personne || '—')}</span>
        <span class="lr-montant">${credit ? '+' : '−'} ${formatNombre(m.montant)}</span>
        <span class="lr-solde">${badgeSolde(m.solde_apres)}</span>
      </li>`;
  }

  function renderRegistre() {
    const types = { tout: null, enlevements: ['enlevement', 'annulation_enlevement'], versements: ['versement', 'annulation_versement'] }[s.filtre];
    const liste = [...s.registre.mouvements].reverse().filter((m) => !types || types.includes(m.type));
    conteneur.querySelector('[data-zone="registre"]').innerHTML = liste.length
      ? liste.map(ligneRegistreHTML).join('')
      : '<li class="etat-vide"><p>Aucune opération pour l’instant.</p></li>';
  }

  function render() {
    const { chantier: c, client } = s;
    const solde = Number(c.solde) || 0;
    const ouvert = c.statut === 'ouvert';
    const totaux = totauxRegistre(s.registre.mouvements);
    const dernier = s.registre.mouvements[s.registre.mouvements.length - 1];
    const materiaux = materiauxLivres(s.registre.mouvements, s.registre.lignes);
    const messageWa = messageSituation(c, client, totaux, solde);

    conteneur.innerHTML = `
      <div class="page page-chantier">
        <header class="page-entete">
          <div class="page-titres">
            <a class="lien-retour" href="#/chantiers">← Chantiers</a>
            <div class="titre-chantier">
              <h1>${esc(c.nom)}</h1>
              <span class="badge-statut-chantier ${c.statut}">${ouvert ? 'Chantier ouvert' : 'Clôturé'}</span>
              ${peut('modifier_chantier') ? `<button type="button" class="btn-icone btn-icone-clair" data-action="modifier" aria-label="Modifier le chantier">${icone('crayon', 18, 2)}</button>` : ''}
            </div>
            <span><a href="#/clients/${encodeURIComponent(client.id)}">${esc(client.nom)}</a>${client.telephone ? ` · ${esc(formatTelephone(client.telephone))}` : ''} · ouvert le ${esc(formatDate(c.created_at, 'court'))} · ${esc(c.numero)}${c.adresse ? ` · ${esc(c.adresse)}` : ''}</span>
          </div>
          <div class="actions-chantier">
            ${ouvert ? `
              <a class="btn btn-primaire" href="#/chantiers/${encodeURIComponent(c.id)}/enlevement">${icone('stock', 18, 2.2)} Nouvel enlèvement</a>
              <button type="button" class="btn btn-succes" data-action="versement">${icone('plus', 18, 2.2)} Versement</button>` : ''}
            <a class="btn btn-secondaire" href="#/chantiers/${encodeURIComponent(c.id)}/releve">${icone('document', 18, 2)} Situation globale</a>
          </div>
        </header>

        ${ouvert ? '' : `<p class="bandeau-annulee">${icone('alerte', 16, 2)} Chantier clôturé le ${esc(formatDate(c.cloture_at || c.created_at, 'court'))}</p>`}

        <section class="chiffres-chantier">
          <div class="bloc-solde-chantier">
            <span class="bsc-libelle">${solde < 0 ? 'Reste à payer' : solde > 0 ? 'Avance disponible' : 'Solde'}</span>
            <span class="bsc-montant ${classeSolde(solde)}">${solde === 0 ? 'Soldé' : `${formatNombre(Math.abs(solde))} <span>GNF</span>`}</span>
            <span class="bsc-explication">${esc(explication(solde))}</span>
          </div>
          ${[
            { libelle: 'Total versé', valeur: formatGNF(totaux.verse), sous: `${totaux.nbVersements} versement${totaux.nbVersements > 1 ? 's' : ''}`, encre: 'var(--succes)' },
            { libelle: 'Total enlevé', valeur: formatGNF(totaux.enleve), sous: `${totaux.nbEnlevements} enlèvement${totaux.nbEnlevements > 1 ? 's' : ''}`, encre: 'var(--primary-dark)' },
            { libelle: 'Dernier mouvement', valeur: dernier ? capitaliser(dateCourte(dernier.created_at).split(' ')[0]) : '—', sous: dernier ? `${titreMouvement(dernier)} à ${formatDate(dernier.created_at, 'heure')}` : 'Aucune opération', encre: 'var(--text)' }
          ].map((k) => `
            <div class="carte kpi-client">
              <span class="kpi-libelle">${esc(k.libelle)}</span>
              <span class="kpi-client-valeur" style="color:${k.encre}">${esc(k.valeur)}</span>
              <span class="kpi-client-sous">${esc(k.sous)}</span>
            </div>`).join('')}
        </section>

        <div class="clients-corps">
          <section class="carte registre" aria-labelledby="titre-registre">
            <div class="bloc-entete">
              <h2 id="titre-registre">Registre</h2>
              <div class="segments" role="group" aria-label="Filtrer">
                ${FILTRES_REGISTRE.map(([code, libelle]) => `<button type="button" class="segment ${code === s.filtre ? 'actif' : ''}" data-filtre="${code}" aria-pressed="${code === s.filtre}">${esc(libelle)}</button>`).join('')}
              </div>
            </div>
            <div class="entete-registre seul-ordi" aria-hidden="true">
              <span>Date</span><span>Opération</span><span>Récupéré / versé par</span><span class="droite">Montant</span><span class="droite">Solde après</span>
            </div>
            <ul class="liste-registre" data-zone="registre"></ul>
          </section>

          <aside class="chantier-cote">
            <section class="carte section-parametres">
              <h2>Matériaux livrés sur ce chantier</h2>
              ${materiaux.length ? `<ul class="liste-materiaux">${materiaux.map((m) => `
                <li><span class="materiau-textes"><span class="gras">${esc(m.nom)}</span><span class="discret">${esc(formatQuantite(m.quantite, m.unite))}</span></span><span class="tres-gras">${formatGNF(m.total)}</span></li>`).join('')}</ul>`
                : '<p class="discret">Aucun enlèvement pour l’instant.</p>'}
            </section>
            <section class="carte section-parametres">
              <h2>Envoyer au client</h2>
              ${client.telephone
                ? `<a class="btn btn-whatsapp btn-bloc" href="${esc(lienWhatsAppClient(client, messageWa))}" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} Situation par WhatsApp</a>`
                : `<button type="button" class="btn btn-whatsapp btn-bloc" disabled title="Aucun numéro enregistré pour ce client">${icone('whatsapp', 18, 2)} Situation par WhatsApp</button>`}
              <button type="button" class="btn btn-secondaire btn-bloc" data-action="sms">Relancer par SMS</button>
              ${peut('cloturer_chantier')
                ? (ouvert
                  ? '<button type="button" class="btn btn-secondaire btn-bloc btn-discret" data-action="cloturer">Clôturer le chantier</button>'
                  : '<button type="button" class="btn btn-secondaire btn-bloc" data-action="rouvrir">Rouvrir le chantier</button>')
                : ''}
            </section>
          </aside>
        </div>
      </div>`;
    renderRegistre();
  }

  async function charger() {
    try {
      const [base, noms] = await Promise.all([chargerChantier(id), chargerNomsMembres(etat.boutique.id)]);
      if (!base) {
        conteneur.innerHTML = `<div class="page"><section class="carte bientot"><h1>Chantier introuvable</h1>
          <p class="bientot-texte">Ce chantier n’existe pas ou n’appartient pas à cette boutique.</p>
          <a class="btn btn-primaire" href="#/chantiers">Retour aux chantiers</a></section></div>`;
        return;
      }
      s.chantier = { ...base.chantier, solde: Number(base.chantier.solde) || 0 };
      s.client = base.client;
      s.noms = noms;
      s.registre = await chargerRegistre(id);
    } catch (err) {
      conteneur.innerHTML = `<div class="page"><p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p></div>`;
      return;
    }
    if (!conteneur.isConnected) return;
    render();
    // Retour d'un enlèvement (#/chantiers/<id>?bon=<vente_id>) : proposer le bon à imprimer.
    const venteBon = params.get('bon');
    if (venteBon) {
      history.replaceState(null, '', `#/chantiers/${encodeURIComponent(id)}`);
      proposerBon(venteBon);
    }
  }

  function proposerBon(idVente) {
    const mouvement = s.registre.mouvements.find((m) => m.vente_id === idVente && m.type === 'enlevement');
    if (!mouvement) return;
    const lignes = s.registre.lignes.get(idVente) || [];
    const bon = {
      numero: s.registre.numeros.get(idVente),
      date: mouvement.created_at,
      chantier: s.chantier,
      client: s.client.nom,
      recuperePar: mouvement.personne,
      servi: s.noms.get(mouvement.fait_par) || etat.membre?.nom,
      lignes,
      total: Number(mouvement.montant),
      soldeApres: Number(mouvement.solde_apres),
      note: mouvement.note
    };
    const { el, fermer } = ouvrirModale({
      titre: 'Enlèvement enregistré',
      contenu: `
        <div class="confirmation">
          <span class="confirmation-icone">${icone('valide', 32, 2.6)}</span>
          <p class="confirmation-numero">Vente ${esc(formatNumeroVente(bon.numero))} · ${esc(s.chantier.nom)}</p>
          <p class="confirmation-total">${formatGNF(bon.total)}</p>
          <div class="confirmation-monnaie"><span>Solde après</span><strong class="${classeSolde(bon.soldeApres)}">${esc(texteSolde(bon.soldeApres))}</strong></div>
        </div>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire btn-grand" data-action="imprimer">${icone('imprimante', 18, 2)} Imprimer le bon d’enlèvement</button>
          <button type="button" class="btn btn-primaire btn-grand" data-fermer>Terminé</button>
        </div>`
    });
    el.querySelector('[data-action="imprimer"]').addEventListener('click', () => { imprimerBonEnlevement(bon); fermer(); });
  }

  /* ---------------- Actions du gérant */

  async function annulerVersement(idMouvement) {
    const m = s.registre.mouvements.find((x) => x.id === idMouvement);
    if (!m) return;
    const ok = await confirmer(`Le versement de ${formatGNF(m.montant)} sera annulé : une ligne « Annulation versement » est ajoutée au registre et le solde est corrigé.`, {
      titre: 'Annuler ce versement', libelleOk: 'Annuler le versement', danger: true
    });
    if (!ok) return;
    const { error } = await sb.rpc('annuler_versement_chantier', { p_mouvement: idMouvement });
    if (error) { toast(messageErreur(error), 'erreur', 6000); return; }
    toast('Versement annulé.', 'succes');
    charger();
  }

  async function cloturer() {
    const solde = s.chantier.solde;
    let message = 'Le chantier sera clôturé : plus d’enlèvement ni de versement possible. Vous pourrez le rouvrir.';
    if (solde < 0) message = `Le client doit encore ${formatGNF(-solde)}. Clôturer quand même le chantier ?`;
    if (solde > 0) message = `Il reste une avance de ${formatGNF(solde)} à rembourser au client. Clôturer quand même le chantier ?`;
    if (!(await confirmer(message, { titre: 'Clôturer le chantier', libelleOk: 'Clôturer', danger: solde !== 0 }))) return;
    const { error } = await sb.rpc('cloturer_chantier', { p_chantier: id, p_forcer: solde !== 0 });
    if (error) { toast(messageErreur(error), 'erreur', 6000); return; }
    toast('Chantier clôturé.', 'succes');
    charger();
  }

  async function rouvrir() {
    if (!(await confirmer('Le chantier sera de nouveau ouvert aux enlèvements et versements.', { titre: 'Rouvrir le chantier', libelleOk: 'Rouvrir' }))) return;
    const { error } = await sb.rpc('rouvrir_chantier', { p_chantier: id });
    if (error) { toast(messageErreur(error), 'erreur', 6000); return; }
    toast('Chantier rouvert.', 'succes');
    charger();
  }

  function modifier() {
    const { el, fermer } = ouvrirModale({
      titre: 'Modifier le chantier',
      contenu: `
        <form class="form-modale" novalidate>
          <div class="champ"><label for="mod-nom">Nom du chantier</label><input id="mod-nom" name="nom" class="input" type="text" maxlength="80" required value="${esc(s.chantier.nom)}"></div>
          <div class="champ"><label for="mod-adresse">Adresse / quartier</label><input id="mod-adresse" name="adresse" class="input" type="text" maxlength="120" value="${esc(s.chantier.adresse || '')}"></div>
          <p class="erreur-form" role="alert" hidden></p>
          <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
        </form>`
    });
    const formulaire = el.querySelector('form');
    formulaire.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nom = formulaire.nom.value.trim();
      const zoneErreur = formulaire.querySelector('.erreur-form');
      if (nom.length < 2) { zoneErreur.textContent = 'Indiquez le nom du chantier.'; zoneErreur.hidden = false; return; }
      const bouton = formulaire.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      const { error } = await sb.rpc('modifier_chantier', { p_chantier: id, p_nom: nom, p_adresse: formulaire.adresse.value.trim() || null });
      if (error) { boutonOccupe(bouton, false); zoneErreur.textContent = messageErreur(error); zoneErreur.hidden = false; return; }
      fermer();
      toast('Chantier mis à jour.', 'succes');
      charger();
    });
  }

  conteneur.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'versement') ouvrirVersement(s.chantier, s.client, () => charger());
    if (action === 'sms') toast('Bientôt disponible : les relances SMS arrivent à une prochaine mise à jour.', 'info');
    if (action === 'cloturer') cloturer();
    if (action === 'rouvrir') rouvrir();
    if (action === 'modifier') modifier();
    const filtre = e.target.closest('[data-filtre]');
    if (filtre) {
      s.filtre = filtre.dataset.filtre;
      conteneur.querySelectorAll('[data-filtre]').forEach((b) => { b.classList.toggle('actif', b === filtre); b.setAttribute('aria-pressed', String(b === filtre)); });
      renderRegistre();
    }
    const photo = e.target.closest('[data-photo]');
    if (photo) afficherPhotoBon(photo.dataset.photo);
    const annulation = e.target.closest('[data-annuler-versement]');
    if (annulation) annulerVersement(annulation.dataset.annulerVersement);
  });

  charger();
}

/* =========================================================================
   Nouvel enlèvement
   ========================================================================= */

function afficherEnlevement(conteneur, id, params) {
  const cleSuggestions = `yb_recupere_${id}`;
  const s = {
    chantier: null, client: null, produits: [], habituels: [], panier: new Map(),
    typePrix: params.get('prix') === 'gros' ? 'gros' : 'detail',
    recherche: '', autresOuverts: false, photo: null, enCours: false
  };
  conteneur.innerHTML = `
    <div class="enlevement"><div class="detail-page-entete enlevement-entete"><span class="squelette" style="height:44px;width:60%"></span></div>
    <div class="enlevement-corps">${'<div class="squelette" style="height:60px"></div>'.repeat(4)}</div></div>`;

  const prixArticle = (p) => (s.typePrix === 'gros' && p.prix_gros !== null && p.prix_gros !== undefined ? Number(p.prix_gros) : Number(p.prix_detail) || 0);
  const quantiteMax = (p) => (p.sur_commande ? Infinity : Math.max(0, Number(p.stock) || 0));
  const total = () => Math.round([...s.panier.entries()].reduce((t, [pid, q]) => {
    const p = s.produits.find((x) => x.id === pid);
    return t + (p ? prixArticle(p) * q : 0);
  }, 0));

  function definirQuantite(pid, saisie) {
    const p = s.produits.find((x) => x.id === pid);
    if (!p) return;
    if (saisie === null || saisie <= 0) { s.panier.delete(pid); renderListes(); renderPied(); return; }
    let q = uniteDivisible(p.unite) ? Math.round(saisie * 1000) / 1000 : Math.max(1, Math.round(saisie));
    if (q > quantiteMax(p)) {
      q = quantiteMax(p);
      toast(`Stock insuffisant : il reste ${formatQuantite(q, p.unite)} de « ${p.nom} ».`, 'erreur');
    }
    if (q <= 0) s.panier.delete(pid);
    else s.panier.set(pid, q);
    renderListes();
    renderPied();
  }

  function etatStock(p) {
    if (p.sur_commande) return { classe: 'stock-ok', texte: 'sur commande' };
    const stock = Number(p.stock) || 0;
    const seuil = Number(p.seuil_alerte) || 0;
    if (stock <= 0) return { classe: 'stock-bas', texte: 'épuisé' };
    return { classe: stock <= seuil ? 'stock-bas' : stock <= 2 * seuil ? 'stock-moyen' : 'stock-ok', texte: `stock ${formatQuantite(stock, p.unite)}` };
  }

  function ligneArticleHTML(p) {
    const q = s.panier.get(p.id) || 0;
    const stock = etatStock(p);
    const epuise = !p.sur_commande && (Number(p.stock) || 0) <= 0;
    const idChamp = `enl-${p.id}`;
    return `
      <li class="article-enlevement ${q ? 'choisi' : ''} ${epuise ? 'epuise' : ''}">
        <span class="ae-textes">
          <span class="gras">${esc(p.nom)}</span>
          <span class="discret">${formatNombre(prixArticle(p))} GNF / ${esc(p.unite || 'unité')} · <span class="${stock.classe}">${esc(stock.texte)}</span></span>
        </span>
        <span class="stepper ${q ? 'stepper-actif' : ''}">
          <button type="button" data-moins="${esc(p.id)}" aria-label="Diminuer ${esc(p.nom)}" ${q ? '' : 'disabled'}>−</button>
          <label class="sr-only" for="${idChamp}">Quantité de ${esc(p.nom)}</label>
          <input id="${idChamp}" class="stepper-qte" type="text" inputmode="decimal" autocomplete="off" value="${q ? String(q).replace('.', ',') : '0'}" data-qte="${esc(p.id)}" ${epuise ? 'disabled' : ''}>
          <button type="button" data-plus="${esc(p.id)}" aria-label="Augmenter ${esc(p.nom)}" ${epuise ? 'disabled' : ''}>+</button>
        </span>
      </li>`;
  }

  function renderListes() {
    const habituels = s.habituels.map((pid) => s.produits.find((p) => p.id === pid)).filter(Boolean);
    // Les articles ajoutés depuis le stock restent visibles en haut, avec les habituels.
    const ajoutes = [...s.panier.keys()].filter((pid) => !s.habituels.includes(pid)).map((pid) => s.produits.find((p) => p.id === pid)).filter(Boolean);
    conteneur.querySelector('[data-zone="habituels"]').innerHTML = [...habituels, ...ajoutes].length
      ? [...habituels, ...ajoutes].map(ligneArticleHTML).join('')
      : '<li class="discret">Premier enlèvement sur ce chantier : choisissez les articles dans le stock.</li>';
    const zoneAutres = conteneur.querySelector('[data-zone="autres"]');
    zoneAutres.hidden = !s.autresOuverts;
    if (s.autresOuverts) {
      const q = normaliserTexte(s.recherche.trim());
      const liste = s.produits.filter((p) => !q || normaliserTexte(p.nom).includes(q) || String(p.code_barre || '').includes(q));
      conteneur.querySelector('[data-zone="liste-stock"]').innerHTML = liste.length
        ? liste.map(ligneArticleHTML).join('')
        : `<li class="discret">Aucun article ne correspond à « ${esc(s.recherche)} ».</li>`;
    }
  }

  function renderPied() {
    const t = total();
    const avant = s.chantier.solde;
    const apres = avant - t;
    const nb = s.panier.size;
    let avertissement = '';
    if (t > 0 && avant > 0 && t > avant) avertissement = `L’avance (${formatNombre(avant)}) ne couvre pas tout : ${formatGNF(t - avant)} passent en dette.`;
    else if (t > 0 && avant <= 0) avertissement = 'Cet enlèvement s’ajoute à la dette du chantier.';
    const bloque = licenceExpiree();
    conteneur.querySelector('[data-zone="pied"]').innerHTML = `
      <div class="ligne-apercu"><span class="discret">Cet enlèvement · ${nb} article${nb > 1 ? 's' : ''}</span><span class="tres-gras">${formatGNF(t)}</span></div>
      <div class="solde-apres ${classeSolde(apres)}"><span>Solde après</span><strong>${esc(texteSolde(apres))}</strong></div>
      ${avertissement ? `<span class="avertissement-dette">${esc(avertissement)}</span>` : ''}
      ${bloque ? '<p class="note-licence">Votre licence a expiré : impossible d’enregistrer un enlèvement.</p>' : ''}
      <button type="button" class="btn btn-primaire btn-grand btn-bloc" data-action="enregistrer" ${!nb || s.enCours || bloque ? 'disabled' : ''}>
        ${s.enCours ? '<span class="spinner" aria-hidden="true"></span>Enregistrement…' : 'Enregistrer l’enlèvement'}
      </button>`;
  }

  function renderPhoto() {
    const zone = conteneur.querySelector('[data-zone="photo"]');
    zone.innerHTML = s.photo
      ? `<div class="apercu-photo"><img src="${esc(s.photo.url)}" alt="Photo du bon"><span class="discret">Photo compressée · ${s.photo.ko} Ko</span>
          <button type="button" class="btn-lien btn-lien-danger" data-action="retirer-photo">Retirer</button></div>`
      : `<label class="btn btn-pointille btn-bloc" for="photo-bon">${icone('photo', 18, 2)} Photo du bon signé (facultatif)</label>`;
  }

  function render() {
    const { chantier: c, client } = s;
    const suggestions = lireStockage(cleSuggestions, []);
    conteneur.innerHTML = `
      <div class="enlevement">
        <header class="detail-page-entete enlevement-entete">
          <div class="enlevement-haut">
            <a href="#/chantiers/${encodeURIComponent(c.id)}" class="btn-icone btn-icone-sombre" aria-label="Retour au chantier">${icone('retour', 20, 2)}</a>
            <div class="enlevement-titres">
              <span class="fiche-page-titre">Nouvel enlèvement</span>
              <span class="enlevement-sous">${esc(c.nom)} · ${esc(client.nom)}</span>
            </div>
          </div>
          <div class="avant-enlevement"><span>Avant cet enlèvement</span><strong class="${classeSolde(c.solde)}">${esc(texteSolde(c.solde))}</strong></div>
        </header>

        ${c.statut !== 'ouvert' ? `<div class="enlevement-corps"><p class="bandeau-annulee">Ce chantier est clôturé : aucun enlèvement possible.</p><a class="btn btn-secondaire" href="#/chantiers/${encodeURIComponent(c.id)}">Retour au compte</a></div>` : `
        <div class="enlevement-corps">
          <div class="segments" role="group" aria-label="Type de prix">
            <button type="button" class="segment ${s.typePrix === 'detail' ? 'actif' : ''}" data-prix="detail" aria-pressed="${s.typePrix === 'detail'}">Prix détail</button>
            <button type="button" class="segment ${s.typePrix === 'gros' ? 'actif' : ''}" data-prix="gros" aria-pressed="${s.typePrix === 'gros'}">Prix gros</button>
          </div>
          <span class="etiquette">Articles habituels de ce chantier</span>
          <ul class="liste-enlevement" data-zone="habituels"></ul>
          <button type="button" class="btn-lien btn-lien-gauche" data-action="autres" aria-expanded="${s.autresOuverts}">${s.autresOuverts ? '− Masquer le stock' : '+ Autre article du stock'}</button>
          <div class="autres-articles" data-zone="autres" hidden>
            <label class="recherche-caisse">
              ${icone('recherche', 20, 2)}
              <span class="sr-only">Rechercher un article</span>
              <input id="recherche-enlevement" type="search" placeholder="Rechercher un article…" autocomplete="off" value="${esc(s.recherche)}">
            </label>
            <ul class="liste-enlevement" data-zone="liste-stock"></ul>
          </div>

          <div class="rangee-champs">
            <div class="champ">
              <label for="recupere-par">Récupéré par</label>
              <input id="recupere-par" class="input" type="text" maxlength="100" list="suggestions-recupere" placeholder="Ex. Chauffeur Alseny · camion RC-4521">
              <datalist id="suggestions-recupere">${suggestions.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
            </div>
            <div class="champ">
              <label for="note-enlevement">Note (facultatif)</label>
              <input id="note-enlevement" class="input" type="text" maxlength="160">
            </div>
          </div>
          <input id="photo-bon" class="sr-only" type="file" accept="image/*" capture="environment">
          <div data-zone="photo"></div>
        </div>
        <section class="pied-enlevement" aria-label="Total de l’enlèvement" data-zone="pied"></section>`}
      </div>`;
    if (c.statut !== 'ouvert') return;
    renderListes();
    renderPhoto();
    renderPied();
  }

  /* ---------------- Photo du bon */

  async function choisirPhoto(fichier) {
    if (!fichier) return;
    try {
      const blob = await compresserImage(fichier);
      if (s.photo) URL.revokeObjectURL(s.photo.url);
      s.photo = { blob, url: URL.createObjectURL(blob), ko: Math.round(blob.size / 1024) };
      renderPhoto();
    } catch (err) {
      console.error(err);
      toast('Impossible de lire cette photo. Essayez une autre image.', 'erreur');
    }
  }

  /* ---------------- Enregistrement */

  async function enregistrer() {
    if (s.enCours || !s.panier.size) return;
    const recuperePar = conteneur.querySelector('#recupere-par').value.trim();
    const note = conteneur.querySelector('#note-enlevement').value.trim();
    s.enCours = true;
    renderPied();
    let chemin = null;
    if (s.photo) {
      try {
        chemin = await envoyerPhotoBon(id, s.photo.blob);
      } catch (err) {
        console.error(err);
        const sansPhoto = await confirmer('La photo du bon n’a pas pu être envoyée (connexion ?). Enregistrer l’enlèvement sans photo ?', { titre: 'Photo non envoyée', libelleOk: 'Enregistrer sans photo' });
        if (!sansPhoto) { s.enCours = false; renderPied(); return; }
      }
    }
    const { data, error } = await sb.rpc('enregistrer_enlevement', {
      p_chantier: id,
      p_lignes: [...s.panier.entries()].map(([produit_id, quantite]) => ({ produit_id, quantite })),
      p_type_prix: s.typePrix,
      p_recupere_par: recuperePar || null,
      p_note: note || null,
      p_photo_path: chemin
    });
    s.enCours = false;
    if (error) {
      renderPied();
      toast(messageErreur(error), 'erreur', 6000);
      return;
    }
    const resultat = (Array.isArray(data) ? data[0] : data) || {};
    if (recuperePar) {
      const liste = [recuperePar, ...lireStockage(cleSuggestions, []).filter((v) => v !== recuperePar)].slice(0, NB_SUGGESTIONS);
      ecrireStockage(cleSuggestions, liste);
    }
    if (s.photo) URL.revokeObjectURL(s.photo.url);
    toast(`Enlèvement ${formatNumeroVente(resultat.numero)} enregistré · ${texteSolde(resultat.solde)}.`, 'succes');
    naviguer(`chantiers/${id}?bon=${encodeURIComponent(resultat.vente_id)}`, { remplacer: true });
  }

  /* ---------------- Données */

  async function charger() {
    try {
      const base = await chargerChantier(id);
      if (!base) { conteneur.innerHTML = '<div class="page"><p class="bloc-erreur">Ce chantier est introuvable dans votre boutique.</p></div>'; return; }
      const [produitsRes, ventesChantier] = await Promise.all([
        sb.from('produits').select(COLONNES_PRODUIT_CAISSE).eq('boutique_id', etat.boutique.id).eq('actif', true).order('nom'),
        chargerParLots((d, f) => sb.from('ventes').select('id').eq('chantier_id', id).eq('statut', 'validee').range(d, f))
      ]);
      if (produitsRes.error) throw produitsRes.error;
      const lignes = await parLots(ventesChantier.map((v) => v.id), (ids) => sb.from('ventes_lignes').select('produit_id, quantite').in('vente_id', ids));
      const cumul = new Map();
      lignes.forEach((l) => cumul.set(l.produit_id, (cumul.get(l.produit_id) || 0) + (Number(l.quantite) || 0)));
      s.chantier = { ...base.chantier, solde: Number(base.chantier.solde) || 0 };
      s.client = base.client;
      s.produits = produitsRes.data;
      s.habituels = [...cumul.entries()].sort((a, b) => b[1] - a[1]).map(([pid]) => pid)
        .filter((pid) => s.produits.some((p) => p.id === pid)).slice(0, NB_HABITUELS);
      s.autresOuverts = !s.habituels.length;
      // Articles venant de la caisse : ?lignes=<produit>:<quantité>,…
      String(params.get('lignes') || '').split(',').filter(Boolean).forEach((paire) => {
        const [pid, q] = paire.split(':');
        const p = s.produits.find((x) => x.id === pid);
        const quantite = Math.min(Number(q) || 0, p ? quantiteMax(p) : 0);
        if (p && quantite > 0) s.panier.set(pid, quantite);
      });
    } catch (err) {
      conteneur.innerHTML = `<div class="page"><p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p></div>`;
      return;
    }
    if (conteneur.isConnected) render();
  }

  conteneur.addEventListener('click', (e) => {
    const plus = e.target.closest('[data-plus]');
    if (plus) { definirQuantite(plus.dataset.plus, (s.panier.get(plus.dataset.plus) || 0) + 1); return; }
    const moins = e.target.closest('[data-moins]');
    if (moins) { definirQuantite(moins.dataset.moins, (s.panier.get(moins.dataset.moins) || 0) - 1); return; }
    const prix = e.target.closest('[data-prix]');
    if (prix) {
      s.typePrix = prix.dataset.prix;
      conteneur.querySelectorAll('[data-prix]').forEach((b) => { b.classList.toggle('actif', b === prix); b.setAttribute('aria-pressed', String(b === prix)); });
      renderListes();
      renderPied();
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'autres') {
      s.autresOuverts = !s.autresOuverts;
      e.target.closest('button').textContent = s.autresOuverts ? '− Masquer le stock' : '+ Autre article du stock';
      e.target.closest('button').setAttribute('aria-expanded', String(s.autresOuverts));
      renderListes();
      if (s.autresOuverts) conteneur.querySelector('#recherche-enlevement').focus();
    }
    if (action === 'retirer-photo') { URL.revokeObjectURL(s.photo.url); s.photo = null; conteneur.querySelector('#photo-bon').value = ''; renderPhoto(); }
    if (action === 'enregistrer') enregistrer();
  });
  conteneur.addEventListener('input', (e) => {
    if (e.target.id === 'recherche-enlevement') { s.recherche = e.target.value; renderListes(); }
  });
  conteneur.addEventListener('change', (e) => {
    if (e.target.dataset.qte) {
      const q = lireNombre(e.target.value);
      if (q === null) renderListes();
      else definirQuantite(e.target.dataset.qte, q);
    }
    if (e.target.id === 'photo-bon') choisirPhoto(e.target.files[0]);
  });

  charger();
}

/* =========================================================================
   Situation globale (relevé A4)
   ========================================================================= */

function afficherReleve(conteneur, id) {
  const boutique = etat.boutique;
  const s = { chantier: null, client: null, registre: null, du: null, au: dateISO(), inclureAnnulees: false };
  conteneur.innerHTML = '<div class="page"><div class="squelette" style="height:400px;border-radius:18px"></div></div>';

  function libelleOperation(m) {
    const numero = formatNumeroVente(s.registre.numeros.get(m.vente_id));
    let texte;
    if (m.type === 'enlevement') texte = `${numero} · ${resumeArticles(s.registre.lignes.get(m.vente_id) || [])}`;
    else if (m.type === 'versement') texte = `Versement ${MODES_PAIEMENT[m.mode]?.libelle || ''}${m.personne ? ' · ' + m.personne : ''}`;
    else if (m.type === 'annulation_enlevement') texte = `Annulation ${numero}`;
    else texte = 'Annulation versement';
    return texte + (m.annule ? ' (annulé)' : '');
  }

  function calculer() {
    const tous = s.registre.mouvements;
    const avant = tous.filter((m) => jourDe(m.created_at) < s.du);
    const dansPeriode = tous.filter((m) => jourDe(m.created_at) >= s.du && jourDe(m.created_at) <= s.au);
    const jusquaFin = tous.filter((m) => jourDe(m.created_at) <= s.au);
    const soldeDebut = avant.length ? Number(avant[avant.length - 1].solde_apres) : 0;
    const soldeFin = jusquaFin.length ? Number(jusquaFin[jusquaFin.length - 1].solde_apres) : soldeDebut;
    const lignes = s.inclureAnnulees ? dansPeriode : dansPeriode.filter((m) => !m.annule && !m.type.startsWith('annulation'));
    return {
      soldeDebut, soldeFin, lignes,
      partiel: s.du > jourDe(s.chantier.created_at),
      totaux: totauxRegistre(dansPeriode),
      materiaux: materiauxLivres(dansPeriode, s.registre.lignes)
    };
  }

  function documentHTML() {
    const c = s.chantier;
    const client = s.client;
    const r = calculer();
    const totalMateriaux = r.materiaux.reduce((t, m) => t + m.total, 0);
    const libelleFin = r.soldeFin < 0 ? 'Reste à payer' : r.soldeFin > 0 ? 'Avance disponible' : 'Solde';
    const lieu = [boutique.commune, boutique.ville].filter(Boolean).join(', ');
    return `
      <article class="releve-document">
        <header class="releve-entete">
          <div class="releve-boutique">
            <span class="releve-nom-boutique">${esc(boutique.nom)}</span>
            <span class="discret">${esc([lieu, boutique.telephone ? formatTelephone(boutique.telephone) : ''].filter(Boolean).join(' · '))}</span>
          </div>
          <div class="releve-titre">
            <span class="releve-grand-titre">SITUATION DE CHANTIER</span>
            <span class="discret">N° ${esc(c.numero)} · éditée le ${esc(formatDate(new Date(), 'court'))} à ${esc(formatDate(new Date(), 'heure'))}</span>
            <span class="discret">Période : du ${esc(formatDate(`${s.du}T12:00:00Z`, 'court'))} au ${esc(formatDate(`${s.au}T12:00:00Z`, 'court'))}</span>
          </div>
        </header>
        <section class="releve-parties">
          <div><span class="releve-etiquette">CLIENT</span><span class="tres-gras">${esc(client.nom)}</span><span class="discret">${esc(client.telephone ? formatTelephone(client.telephone) : '')}</span></div>
          <div><span class="releve-etiquette">CHANTIER</span><span class="tres-gras">${esc(c.nom)}</span><span class="discret">Ouvert le ${esc(formatDate(c.created_at, 'court'))}${c.adresse ? ' · ' + esc(c.adresse) : ''}</span></div>
        </section>
        <section class="releve-resume">
          <div><span>Total versé</span><strong class="texte-succes">${formatGNF(r.totaux.verse)}</strong></div>
          <div><span>Total enlevé</span><strong class="texte-enleve">${formatGNF(r.totaux.enleve)}</strong></div>
          <div class="releve-solde"><span>${libelleFin}</span><strong class="${classeSolde(r.soldeFin)}">${r.soldeFin === 0 ? 'Soldé' : formatGNF(Math.abs(r.soldeFin))}</strong></div>
        </section>
        <section>
          <h2 class="releve-section">MATÉRIAUX LIVRÉS</h2>
          <table class="releve-table releve-materiaux">
            <thead><tr><th>Article</th><th class="droite">Quantité</th><th class="droite">Montant</th></tr></thead>
            <tbody>
              ${r.materiaux.length ? r.materiaux.map((m) => `<tr><td class="mi-gras">${esc(m.nom)}</td><td class="droite">${esc(formatQuantite(m.quantite, m.unite))}</td><td class="droite gras">${formatNombre(m.total)}</td></tr>`).join('')
                : '<tr><td colspan="3" class="discret">Aucun enlèvement sur cette période.</td></tr>'}
              <tr class="releve-total"><td>Total</td><td></td><td class="droite">${formatNombre(totalMateriaux)}</td></tr>
            </tbody>
          </table>
        </section>
        <section>
          <h2 class="releve-section">DÉTAIL DES MOUVEMENTS</h2>
          <table class="releve-table releve-mouvements">
            <thead><tr><th>Date</th><th>Opération</th><th class="droite">Versé</th><th class="droite">Enlevé</th><th class="droite">Solde</th></tr></thead>
            <tbody>
              ${r.partiel ? `<tr class="releve-debut"><td>${esc(formatDate(`${s.du}T12:00:00Z`, 'jourMois'))}</td><td>Solde au début de la période</td><td></td><td></td><td class="droite tres-gras ${classeSolde(r.soldeDebut)}">${esc(texteSolde(r.soldeDebut))}</td></tr>` : ''}
              ${r.lignes.map((m) => {
                const credit = m.type === 'versement' || m.type === 'annulation_enlevement';
                return `<tr class="${m.annule ? 'annulee' : ''}">
                  <td>${esc(formatDate(m.created_at, 'jourMois'))}</td>
                  <td>${esc(libelleOperation(m))}</td>
                  <td class="droite texte-succes gras">${credit ? formatNombre(m.montant) : ''}</td>
                  <td class="droite gras">${credit ? '' : formatNombre(m.montant)}</td>
                  <td class="droite tres-gras ${classeSolde(m.solde_apres)}">${esc(texteSolde(m.solde_apres))}</td>
                </tr>`;
              }).join('') || '<tr><td colspan="5" class="discret">Aucun mouvement sur cette période.</td></tr>'}
            </tbody>
          </table>
        </section>
        <section class="releve-signatures">
          <div>Pour la boutique</div>
          <div>Le client (lu et approuvé)</div>
        </section>
        <footer class="releve-pied">
          ${boutique.message_recu ? `<span>${esc(boutique.message_recu)}</span>` : ''}
          <span>Document généré par YOUMMA Business · un produit YOUMMA SARLU</span>
        </footer>
      </article>`;
  }

  function render() {
    const r = calculer();
    const message = messageSituation(s.chantier, s.client, r.totaux, r.soldeFin, true);
    conteneur.innerHTML = `
      <div class="page page-releve">
        <div class="releve-outils">
          <a class="lien-retour" href="#/chantiers/${encodeURIComponent(id)}">← ${esc(s.chantier.nom)}</a>
          <div class="releve-filtres">
            <div class="champ"><label for="rel-du">Du</label><input id="rel-du" class="input" type="date" value="${s.du}" min="${jourDe(s.chantier.created_at)}" max="${dateISO()}"></div>
            <div class="champ"><label for="rel-au">Au</label><input id="rel-au" class="input" type="date" value="${s.au}" min="${jourDe(s.chantier.created_at)}" max="${dateISO()}"></div>
            <label class="filtre-case"><input type="checkbox" id="rel-annulees" ${s.inclureAnnulees ? 'checked' : ''}> Inclure les opérations annulées</label>
          </div>
          <div class="rapport-actions">
            <button type="button" class="btn btn-secondaire" data-action="imprimer">${icone('imprimante', 18, 2)} Imprimer</button>
            ${s.client.telephone
              ? `<a class="btn btn-whatsapp" href="${esc(lienWhatsAppClient(s.client, message))}" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} Envoyer par WhatsApp</a>`
              : `<button type="button" class="btn btn-whatsapp" disabled title="Aucun numéro enregistré pour ce client">${icone('whatsapp', 18, 2)} Envoyer par WhatsApp</button>`}
          </div>
          <p class="aide">Pour envoyer le PDF : « Imprimer », choisissez « Enregistrer en PDF », puis joignez le fichier dans WhatsApp.</p>
        </div>
        <div class="releve-cadre">${documentHTML()}</div>
      </div>`;
  }

  function imprimer() {
    document.body.classList.add('impression-rapport');
    const retirer = () => document.body.classList.remove('impression-rapport');
    window.addEventListener('afterprint', retirer, { once: true });
    window.print();
    setTimeout(retirer, 1000);
  }

  async function charger() {
    try {
      const base = await chargerChantier(id);
      if (!base) { conteneur.innerHTML = '<div class="page"><p class="bloc-erreur">Ce chantier est introuvable dans votre boutique.</p></div>'; return; }
      s.chantier = { ...base.chantier, solde: Number(base.chantier.solde) || 0 };
      s.client = base.client;
      s.du = jourDe(s.chantier.created_at);
      s.registre = await chargerRegistre(id);
    } catch (err) {
      conteneur.innerHTML = `<div class="page"><p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p></div>`;
      return;
    }
    if (conteneur.isConnected) render();
  }

  conteneur.addEventListener('change', (e) => {
    if (e.target.id === 'rel-annulees') s.inclureAnnulees = e.target.checked;
    if (e.target.id === 'rel-du' || e.target.id === 'rel-au') {
      const du = conteneur.querySelector('#rel-du').value;
      const au = conteneur.querySelector('#rel-au').value;
      if (!du || !au) return;
      [s.du, s.au] = du <= au ? [du, au] : [au, du];
    }
    render();
  });
  conteneur.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="imprimer"]')) imprimer();
  });

  charger();
}

