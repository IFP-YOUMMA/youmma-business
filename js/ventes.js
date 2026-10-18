/**
 * ventes.js — Historique des ventes (maquette Ventes.dc.html).
 *
 *  - #/ventes        : filtres, indicateurs, liste ; sur ordinateur le détail s'affiche à droite.
 *  - #/ventes/<id>   : sur ordinateur, même page avec cette vente sélectionnée ;
 *                      sur téléphone, détail en plein écran.
 *
 * Les ventes sont en lecture seule : l'annulation passe par la fonction serveur annuler_vente
 * (gérant / propriétaire), qui remet le stock et corrige la dette du client.
 */
import { sb } from './supabase.js';
import { etat, peut, utilisateur } from './state.js';
import { naviguer } from './router.js';
import { imprimerRecuVente } from './recu.js';
import {
  esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, initiales, prenom, capitaliser,
  formatNombre, formatGNF, formatQuantite, formatDate, formatNumeroVente, dateISO, decalerDate,
  bornesPeriode, ecartJours, chargerParLots, MODES_PAIEMENT
} from './utils.js';

const TAILLE_PAGE = 50;
const PERIODES = [
  ['jour', 'Aujourd’hui'], ['7j', '7 jours'], ['mois', 'Ce mois'], ['moisDernier', 'Mois dernier'], ['choix', 'Choisir…']
];

const estMobile = () => window.matchMedia('(max-width: 899.98px)').matches;

/** Recherche insensible aux accents et à la casse. */
function normaliserTexte(texte) {
  return String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Noms des clients (Map id → nom) et membres de la boutique (vendeurs). */
async function chargerReferences(idBoutique) {
  const [clients, membresRes] = await Promise.all([
    chargerParLots((debut, fin) => sb.from('clients').select('id, nom').eq('boutique_id', idBoutique).range(debut, fin)),
    sb.from('membres').select('id, user_id, nom').eq('boutique_id', idBoutique).order('nom')
  ]);
  if (membresRes.error) throw membresRes.error;
  return { clients: new Map(clients.map((c) => [c.id, c.nom])), membres: membresRes.data };
}

/** Membre correspondant à ventes.vendeur_id (id de membre ou user_id). */
function trouverMembre(refs, idVendeur) {
  return refs.membres.find((m) => m.id === idVendeur || m.user_id === idVendeur) || null;
}

/** « Aujourd’hui 09:42 », « Hier 17:10 », sinon « 15/10 08:31 ». */
function dateCourte(horodatage) {
  const heure = formatDate(horodatage, 'heure');
  const ecart = ecartJours(horodatage);
  if (ecart === 0) return `Aujourd’hui ${heure}`;
  if (ecart === -1) return `Hier ${heure}`;
  return `${formatDate(horodatage, 'jourMois')} ${heure}`;
}

/** Badge de paiement (couleurs existantes), ou « Annulée » en gris. */
function badgeVente(vente) {
  if (vente.statut === 'annulee') return '<span class="badge-paiement badge-annulee">Annulée</span>';
  const m = MODES_PAIEMENT[vente.mode_paiement] || MODES_PAIEMENT.especes;
  return `<span class="badge-paiement" style="background:${m.fond};color:${m.encre}">${esc(m.court)}</span>`;
}

/** Point d'entrée des routes #/ventes et #/ventes/<id>. */
export function afficherVentes(conteneur, params) {
  const idDemande = params.get('id');
  if (idDemande && estMobile()) afficherDetailPage(conteneur, idDemande);
  else afficherHistorique(conteneur, idDemande);
}

/* =========================================================================
   Page historique (+ détail à droite sur ordinateur)
   ========================================================================= */

function afficherHistorique(conteneur, idSelection) {
  const boutique = etat.boutique;
  const aujourdhui = dateISO();
  const s = {
    periode: 'jour',
    du: aujourdhui,
    au: aujourdhui,
    mode: '',
    vendeur: '',
    recherche: '',
    annulees: false,
    ventes: [],
    affichees: TAILLE_PAGE,
    selection: idSelection,
    charge: false,
    jeton: 0,
    refs: null
  };
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);
  const refsPromesse = chargerReferences(boutique.id);
  // Un vendeur ne voit que ses propres ventes.
  const toutesLesVentes = peut('voir_toutes_ventes');
  const uid = utilisateur()?.id;

  conteneur.innerHTML = `
    <div class="page page-ventes">
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour seul-ordi" href="#/tableau-de-bord">← Tableau de bord</a>
          <h1>Historique des ventes</h1>
        </div>
        <label class="recherche-entete recherche-ventes">
          ${icone('recherche', 18, 2)}
          <span class="sr-only">Rechercher une vente</span>
          <input id="recherche-ventes" type="search" placeholder="N° de vente ou nom du client…" autocomplete="off">
        </label>
      </header>

      <div class="filtres-ventes">
        <div class="segments segments-cadre" role="group" aria-label="Période">
          ${PERIODES.map(([code, libelle]) => `
            <button type="button" class="segment ${code === s.periode ? 'actif' : ''}" data-periode="${code}" aria-pressed="${code === s.periode}">${esc(libelle)}</button>`).join('')}
        </div>
        <label class="filtre-select">
          <span class="sr-only">Mode de paiement</span>
          <select id="filtre-mode">
            <option value="">Paiement : tous</option>
            ${Object.entries(MODES_PAIEMENT).map(([code, m]) => `<option value="${code}">${esc(m.court)}</option>`).join('')}
          </select>
        </label>
        <label class="filtre-select" ${toutesLesVentes ? '' : 'hidden'}>
          <span class="sr-only">Vendeur</span>
          <select id="filtre-vendeur" data-zone="vendeurs"><option value="">Vendeur : tous</option></select>
        </label>
        <label class="filtre-case">
          <input type="checkbox" id="filtre-annulees">
          Afficher les ventes annulées
        </label>
      </div>
      <div class="dates-perso" data-zone="dates" hidden>
        <div class="champ"><label for="ventes-du">Du</label><input id="ventes-du" class="input" type="date" max="${aujourdhui}" value="${aujourdhui}"></div>
        <div class="champ"><label for="ventes-au">Au</label><input id="ventes-au" class="input" type="date" max="${aujourdhui}" value="${aujourdhui}"></div>
      </div>

      <section class="kpis-clients" aria-label="Résumé de la période" data-zone="kpis">
        ${'<div class="carte kpi-client"><span class="squelette" style="height:13px;width:60%"></span><span class="squelette" style="height:26px;width:80%"></span><span class="squelette" style="height:12px;width:55%"></span></div>'.repeat(4)}
      </section>

      <div class="clients-corps">
        <section class="carte ventes-liste" aria-label="Liste des ventes">
          <div class="entete-liste-ventes seul-ordi" aria-hidden="true">
            <span>N°</span><span>Date</span><span>Client</span><span>Paiement</span><span>Vendeur</span><span class="droite">Montant</span>
          </div>
          <ul class="liste-ventes-page" data-zone="liste"></ul>
          <div class="charger-plus" data-zone="plus"></div>
        </section>
        <aside class="fiche-cadre detail-cadre seul-ordi" aria-label="Détail de la vente" data-zone="detail"></aside>
      </div>
    </div>`;

  /* ---------------- Filtres et calculs */

  function nomClient(v) {
    return v.client_id ? (s.refs?.clients.get(v.client_id) || 'Client') : 'Client comptoir';
  }

  function ventesFiltrees({ inclureAnnulees = s.annulees } = {}) {
    const q = normaliserTexte(s.recherche.trim());
    const chiffres = s.recherche.replace(/\D/g, '');
    const vendeur = s.vendeur ? s.refs.membres.find((m) => m.id === s.vendeur) : null;
    return s.ventes.filter((v) => (inclureAnnulees || v.statut === 'validee')
      && (!s.mode || v.mode_paiement === s.mode)
      && (!vendeur || v.vendeur_id === vendeur.id || v.vendeur_id === vendeur.user_id)
      && (!q
        || normaliserTexte(nomClient(v)).includes(q)
        || normaliserTexte(formatNumeroVente(v.numero)).includes(q)
        || (chiffres && String(v.numero).includes(String(Number(chiffres))))));
  }

  function renderKpis() {
    const toutes = ventesFiltrees({ inclureAnnulees: true });
    const validees = toutes.filter((v) => v.statut === 'validee');
    const annulees = toutes.filter((v) => v.statut === 'annulee');
    const somme = (liste) => liste.reduce((t, v) => t + (Number(v.total) || 0), 0);
    const ca = somme(validees);
    const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
    zone('kpis').innerHTML = [
      { libelle: 'Chiffre d’affaires', valeur: formatGNF(ca), sous: `${pluriel(validees.length, 'vente')} validée${validees.length > 1 ? 's' : ''}`, encre: 'var(--text)' },
      { libelle: 'Encaissé', valeur: formatGNF(somme(validees.filter((v) => v.mode_paiement !== 'credit'))), sous: 'hors ventes à crédit', encre: 'var(--succes)' },
      { libelle: 'Panier moyen', valeur: formatGNF(validees.length ? ca / validees.length : 0), sous: 'par vente', encre: 'var(--text)' },
      { libelle: 'Annulées', valeur: pluriel(annulees.length, 'vente'), sous: `${formatGNF(somme(annulees))} remis en stock`, encre: 'var(--danger)' }
    ].map((k) => `
      <div class="carte kpi-client">
        <span class="kpi-libelle">${esc(k.libelle)}</span>
        <span class="kpi-client-valeur" style="color:${k.encre}">${esc(k.valeur)}</span>
        <span class="kpi-client-sous">${esc(k.sous)}</span>
      </div>`).join('');
  }

  function renderListe() {
    if (!s.charge) return;
    const liste = ventesFiltrees();
    if (!liste.length) {
      const vide = s.ventes.length ? 'Aucune vente ne correspond à ces filtres.' : 'Aucune vente sur cette période.';
      zone('liste').innerHTML = `<li class="etat-vide etat-vide-large"><p>${vide}</p>${s.ventes.length ? '' : '<a class="btn btn-secondaire" href="#/caisse">Ouvrir la caisse</a>'}</li>`;
      zone('plus').innerHTML = '';
      return;
    }
    zone('liste').innerHTML = liste.slice(0, s.affichees).map((v) => {
      const choisie = v.id === s.selection;
      const vendeur = trouverMembre(s.refs, v.vendeur_id);
      return `
        <li>
          <button type="button" class="ligne-vente ${choisie ? 'selectionnee' : ''}" data-vente="${esc(v.id)}" ${choisie ? 'aria-current="true"' : ''}>
            <span class="lv-numero">${esc(formatNumeroVente(v.numero))}</span>
            <span class="lv-date">${esc(dateCourte(v.created_at))}</span>
            <span class="lv-client">${esc(nomClient(v))}</span>
            <span class="lv-paiement">${badgeVente(v)}</span>
            <span class="lv-vendeur">${esc(vendeur ? prenom(vendeur.nom) : '—')}</span>
            <span class="lv-montant ${v.statut === 'annulee' ? 'annule' : ''}">${formatGNF(v.total)}</span>
          </button>
        </li>`;
    }).join('');
    const reste = liste.length - s.affichees;
    zone('plus').innerHTML = reste > 0
      ? `<button type="button" class="btn btn-secondaire" data-action="plus">Charger plus de ventes (${reste} restante${reste > 1 ? 's' : ''})</button>`
      : '';
  }

  function renderVendeurs() {
    zone('vendeurs').innerHTML = '<option value="">Vendeur : tous</option>'
      + s.refs.membres.map((m) => `<option value="${esc(m.id)}">${esc(m.nom)}</option>`).join('');
  }

  /* ---------------- Sélection et détail (ordinateur) */

  function selectionner(id, { defiler = false } = {}) {
    s.selection = id;
    history.replaceState(null, '', `#/ventes/${encodeURIComponent(id)}`);
    conteneur.querySelectorAll('.ligne-vente').forEach((ligne) => {
      const choisie = ligne.dataset.vente === id;
      ligne.classList.toggle('selectionnee', choisie);
      if (choisie) ligne.setAttribute('aria-current', 'true');
      else ligne.removeAttribute('aria-current');
    });
    monterDetail(zone('detail'), id, { mode: 'cadre', refsPromesse, onMaj: majVente });
    const detail = zone('detail');
    if (defiler && detail.offsetTop > conteneur.querySelector('.ventes-liste').offsetTop + 10) {
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function selectionParDefaut() {
    if (estMobile()) return;
    const id = s.selection || ventesFiltrees()[0]?.id;
    if (id) selectionner(id);
    else zone('detail').innerHTML = '<div class="fiche-vide"><p>Sélectionnez une vente pour voir son détail.</p></div>';
  }

  /** Après annulation : liste et indicateurs recalculés. */
  function majVente(venteMaj) {
    const v = s.ventes.find((x) => x.id === venteMaj.id);
    if (v) v.statut = venteMaj.statut;
    renderKpis();
    renderListe();
  }

  /* ---------------- Données */

  async function charger() {
    const { du, au } = s.periode === 'choix' ? { du: s.du, au: s.au } : bornesPeriode(s.periode);
    const jeton = ++s.jeton;
    s.charge = false;
    zone('liste').innerHTML = '<li class="squelette-ligne"><span class="squelette" style="height:14px;width:45%"></span><span class="squelette" style="height:10px;width:70%"></span></li>'.repeat(6);
    zone('plus').innerHTML = '';
    try {
      const [ventes, refs] = await Promise.all([
        chargerParLots((debut, fin) => {
          let requete = sb.from('ventes')
            .select('id, numero, created_at, client_id, vendeur_id, mode_paiement, total, statut')
            .eq('boutique_id', boutique.id)
            .gte('created_at', `${du}T00:00:00Z`) // Conakry = UTC
            .lt('created_at', `${decalerDate(au, 1)}T00:00:00Z`);
          if (!toutesLesVentes) requete = requete.eq('vendeur_id', uid);
          return requete.order('created_at', { ascending: false }).range(debut, fin);
        }),
        refsPromesse
      ]);
      if (jeton !== s.jeton) return;
      if (!s.refs) { s.refs = refs; renderVendeurs(); }
      s.ventes = ventes;
    } catch (err) {
      if (jeton !== s.jeton) return;
      const message = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p>`;
      zone('kpis').innerHTML = message;
      zone('liste').innerHTML = `<li>${message}</li>`;
      return;
    }
    s.charge = true;
    s.affichees = TAILLE_PAGE;
    renderKpis();
    renderListe();
    selectionParDefaut();
  }

  function rafraichirFiltres() {
    s.affichees = TAILLE_PAGE;
    renderKpis();
    renderListe();
  }

  /* ---------------- Événements */

  conteneur.addEventListener('click', (e) => {
    const periode = e.target.closest('[data-periode]');
    if (periode) {
      s.periode = periode.dataset.periode;
      conteneur.querySelectorAll('[data-periode]').forEach((b) => {
        b.classList.toggle('actif', b === periode);
        b.setAttribute('aria-pressed', String(b === periode));
      });
      zone('dates').hidden = s.periode !== 'choix';
      charger();
      return;
    }
    if (e.target.closest('[data-action="plus"]')) {
      s.affichees += TAILLE_PAGE;
      renderListe();
      return;
    }
    const ligne = e.target.closest('.ligne-vente');
    if (ligne) {
      if (estMobile()) naviguer(`ventes/${ligne.dataset.vente}`);
      else selectionner(ligne.dataset.vente, { defiler: true });
    }
  });
  conteneur.querySelector('#recherche-ventes').addEventListener('input', (e) => { s.recherche = e.target.value; rafraichirFiltres(); });
  conteneur.querySelector('#filtre-mode').addEventListener('change', (e) => { s.mode = e.target.value; rafraichirFiltres(); });
  zone('vendeurs').addEventListener('change', (e) => { s.vendeur = e.target.value; rafraichirFiltres(); });
  conteneur.querySelector('#filtre-annulees').addEventListener('change', (e) => { s.annulees = e.target.checked; rafraichirFiltres(); });
  zone('dates').addEventListener('change', () => {
    const du = conteneur.querySelector('#ventes-du');
    const au = conteneur.querySelector('#ventes-au');
    if (!du.value || !au.value) return;
    // Pas de date future ; « du » après « au » : on inverse.
    s.du = du.value > aujourdhui ? aujourdhui : du.value;
    s.au = au.value > aujourdhui ? aujourdhui : au.value;
    if (s.du > s.au) [s.du, s.au] = [s.au, s.du];
    du.value = s.du;
    au.value = s.au;
    charger();
  });

  charger();
}

/* =========================================================================
   Détail en pleine page (téléphone)
   ========================================================================= */

function afficherDetailPage(conteneur, idVente) {
  // Monté dans son propre cadre (pas directement dans #vue, partagé par toutes les pages).
  conteneur.innerHTML = '<div class="fiche-page-cadre"></div>';
  monterDetail(conteneur.querySelector('.fiche-page-cadre'), idVente, {
    mode: 'page',
    refsPromesse: chargerReferences(etat.boutique.id)
  });
}

/* =========================================================================
   Détail d'une vente (cadre ordinateur ou page téléphone)
   ========================================================================= */

async function monterDetail(zone, idVente, { mode, refsPromesse, onMaj }) {
  const boutique = etat.boutique;
  const gerer = peut('annuler_vente');
  zone.dataset.vente = idVente;
  zone.onclick = null;
  zone.innerHTML = `
    ${mode === 'page' ? enteteDetailPage('Vente') : ''}
    <div class="dv-corps">
      ${'<div class="squelette-ligne"><span class="squelette" style="height:16px;width:50%"></span><span class="squelette" style="height:12px;width:80%"></span></div>'.repeat(4)}
    </div>`;

  let vente, lignes, refs;
  try {
    const [venteRes, lignesRes, references] = await Promise.all([
      sb.from('ventes')
        .select('id, numero, created_at, client_id, vendeur_id, type_prix, sous_total, remise, total, mode_paiement, echeance, statut')
        .eq('boutique_id', boutique.id).eq('id', idVente).maybeSingle(),
      sb.from('ventes_lignes').select('nom_produit, unite, quantite, prix_unitaire, total').eq('vente_id', idVente),
      refsPromesse
    ]);
    if (venteRes.error) throw venteRes.error;
    if (lignesRes.error) throw lignesRes.error;
    vente = venteRes.data;
    lignes = lignesRes.data;
    refs = references;
  } catch (err) {
    if (zone.dataset.vente === idVente) zone.querySelector('.dv-corps').innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p>`;
    return;
  }
  // L'utilisateur a choisi une autre vente entre-temps.
  if (!zone.isConnected || zone.dataset.vente !== idVente) return;
  // Vente d'un autre vendeur ouverte par l'adresse : réservée au gérant.
  if (vente && !peut('voir_toutes_ventes') && vente.vendeur_id !== utilisateur()?.id) vente = null;
  if (!vente) {
    zone.querySelector('.dv-corps').innerHTML = `
      <div class="fiche-vide"><p>Cette vente est introuvable dans votre boutique.</p>
      <a class="btn btn-secondaire" href="#/ventes">Retour à l’historique</a></div>`;
    return;
  }

  const client = vente.client_id ? { id: vente.client_id, nom: refs.clients.get(vente.client_id) || 'Client' } : null;
  const vendeur = trouverMembre(refs, vente.vendeur_id);

  function rendre() {
    const annulee = vente.statut === 'annulee';
    const dateComplete = `${capitaliser(formatDate(vente.created_at, 'long').split(' ')[0])} ${formatDate(vente.created_at, 'court')} à ${formatDate(vente.created_at, 'heure')}`;
    zone.innerHTML = `
      ${mode === 'page' ? enteteDetailPage(`Vente ${formatNumeroVente(vente.numero)}`) : ''}
      <div class="dv-corps ${annulee ? 'est-annulee' : ''}">
        <div class="dv-entete">
          <div class="dv-titres">
            <span class="discret">Vente</span>
            <span class="dv-numero">${esc(formatNumeroVente(vente.numero))}</span>
            <span class="discret">${esc(dateComplete)} · vendeur : ${esc(vendeur ? prenom(vendeur.nom) : '—')}</span>
          </div>
          ${annulee ? badgeVente(vente) : `<span class="badge-paiement" style="background:${MODES_PAIEMENT[vente.mode_paiement].fond};color:${MODES_PAIEMENT[vente.mode_paiement].encre}">${esc(MODES_PAIEMENT[vente.mode_paiement].libelle)}</span>`}
        </div>

        ${annulee ? `<p class="bandeau-annulee">${icone('alerte', 16, 2)} Vente annulée</p>` : ''}

        ${client ? `
          <a class="client-bouton" href="#/clients/${encodeURIComponent(client.id)}">
            <span class="avatar">${esc(initiales(client.nom))}</span>
            <span class="client-textes">
              <span class="gras">${esc(client.nom)}</span>
              <span class="discret">${vente.echeance && vente.mode_paiement === 'credit' ? `Échéance le ${esc(formatDate(vente.echeance, 'court'))} · ` : ''}voir la fiche</span>
            </span>
            ${icone('chevronDroite', 16, 2)}
          </a>` : `
          <div class="client-bouton client-comptoir">
            <span class="avatar">${icone('client', 18, 2)}</span>
            <span class="client-textes"><span class="gras">Client comptoir</span><span class="discret">Vente sans client associé</span></span>
          </div>`}

        <ul class="detail-lignes">
          ${lignes.map((l) => `
            <li>
              <span class="detail-lignes-textes">
                <span class="gras">${esc(l.nom_produit)}</span>
                <span class="discret">${esc(formatQuantite(l.quantite, l.unite))} × ${formatGNF(l.prix_unitaire)}</span>
              </span>
              <span class="gras">${formatGNF(l.total)}</span>
            </li>`).join('')}
        </ul>

        <div class="totaux">
          <div class="totaux-ligne"><span class="discret">Sous-total${vente.type_prix === 'gros' ? ' (prix gros)' : ''}</span><span class="gras">${formatGNF(vente.sous_total)}</span></div>
          <div class="totaux-ligne"><span class="discret">Remise</span><span class="gras">${Number(vente.remise) ? '− ' : ''}${formatGNF(vente.remise)}</span></div>
          <div class="totaux-ligne totaux-final"><span>Total</span><span class="total-grand ${annulee ? 'annule' : ''}">${formatNombre(vente.total)} <span class="unite-gnf">GNF</span></span></div>
        </div>

        <div class="dv-actions">
          <button type="button" class="btn btn-secondaire" data-action="reimprimer">${icone('imprimante', 18, 2)} Réimprimer le reçu</button>
          ${gerer && !annulee ? `<button type="button" class="btn btn-annuler-vente" data-action="annuler">${icone('annuler', 18, 2)} Annuler la vente</button>` : ''}
        </div>
        ${gerer && !annulee ? '<p class="discret dv-note">L’annulation remet les articles en stock et retire le montant de la dette du client. Réservée au gérant.</p>' : ''}
      </div>`;
  }

  function reimprimer() {
    imprimerRecuVente({
      numero: vente.numero,
      date: vente.created_at,
      vendeur: vendeur?.nom || '—',
      client: client?.nom || null,
      lignes,
      sousTotal: Number(vente.sous_total),
      remise: Number(vente.remise),
      total: Number(vente.total),
      mode: vente.mode_paiement,
      montantRecu: null,
      echeance: vente.mode_paiement === 'credit' ? vente.echeance : null
    }, { mentions: vente.statut === 'annulee' ? ['DUPLICATA', 'ANNULÉE'] : ['DUPLICATA'] });
  }

  function confirmerAnnulation() {
    const numero = formatNumeroVente(vente.numero);
    const { el, fermer } = ouvrirModale({
      titre: 'Annuler la vente',
      contenu: `
        <p class="texte-modale">Vente <strong>${esc(numero)}</strong> · ${formatGNF(vente.total)}</p>
        <ul class="liste-consequences">
          <li>Les articles reviendront en stock.</li>
          ${vente.mode_paiement === 'credit' && client ? `<li>${formatGNF(vente.total)} seront retirés de la dette de ${esc(client.nom)}.</li>` : ''}
          <li>La vente restera visible dans l’historique, marquée « Annulée ».</li>
        </ul>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire" data-fermer>Garder la vente</button>
          <button type="button" class="btn btn-danger" data-action="confirmer">Oui, annuler la vente</button>
        </div>`
    });
    const bouton = el.querySelector('[data-action="confirmer"]');
    bouton.addEventListener('click', async () => {
      if (bouton.disabled) return;
      boutonOccupe(bouton, true, 'Annulation…');
      el.querySelector('[data-fermer].btn').disabled = true;
      const { error } = await sb.rpc('annuler_vente', { p_vente: vente.id });
      if (error) {
        boutonOccupe(bouton, false);
        el.querySelector('[data-fermer].btn').disabled = false;
        toast(messageErreur(error), 'erreur', 6000);
        if (String(error.message).includes('DEJA_ANNULEE')) {
          vente.statut = 'annulee';
          fermer();
          rendre();
          onMaj?.(vente);
        }
        return;
      }
      vente.statut = 'annulee';
      fermer();
      toast(`Vente ${numero} annulée.`, 'succes');
      rendre();
      onMaj?.(vente);
    });
  }

  zone.onclick = (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'reimprimer') reimprimer();
    if (action === 'annuler') confirmerAnnulation();
  };
  rendre();
}

/** En-tête navy du détail en plein écran (téléphone). */
function enteteDetailPage(titre) {
  return `
    <div class="detail-page-entete">
      <a href="#/ventes" class="btn-icone btn-icone-sombre" aria-label="Retour à l’historique des ventes">${icone('retour', 20, 2)}</a>
      <span class="fiche-page-titre">${esc(titre)}</span>
    </div>`;
}
