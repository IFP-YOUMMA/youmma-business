/**
 * commandes.js — Commandes en ligne (maquette Commandes.dc.html), #/commandes et #/commandes/<id>.
 *
 * Cycle : nouvelle → confirmée → prête → livrée (devient une vente : stock, reçu, crédit possible)
 *         ou annulée (motif). Le vendeur traite les commandes et peut refuser une commande nouvelle ;
 *         annuler après confirmation est réservé au gérant.
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import { naviguer } from './router.js';
import { imprimerRecuVente } from './recu.js';
import { ouvrirDocument } from './documents/donnees.js';
import { chargerSoldeSms } from './sms.js';
import { verifierCommandes } from './alertes-commandes.js';
import { ouvrirOrganiserLivraison } from './livraisons.js';
import { aModule } from './modules.js';
import {
  esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, formatNombre, formatGNF, formatDate, formatQuantite,
  formatTelephone, formatNumeroVente, prenom, dateISO, decalerDate, MODES_PAIEMENT, MODES_CAISSE, lienBoutique
} from './utils.js';

const STATUTS = {
  nouvelle: { libelle: 'Nouvelle', detail: 'Nouvelle · à confirmer', classe: 'nouvelle' },
  confirmee: { libelle: 'Confirmée', detail: 'Confirmée · à préparer', classe: 'confirmee' },
  prete: { libelle: 'Prête', detail: 'Prête · à livrer', classe: 'prete' },
  livree: { libelle: 'Livrée', detail: 'Livrée et encaissée', classe: 'livree' },
  annulee: { libelle: 'Annulée', detail: 'Annulée', classe: 'annulee' }
};
const ETAPES = ['nouvelle', 'confirmee', 'prete', 'livree'];
const ONGLETS = [
  ['a-traiter', 'À traiter', ['nouvelle', 'confirmee', 'prete']],
  ['nouvelle', 'Nouvelles', ['nouvelle']],
  ['confirmee', 'Confirmées', ['confirmee']],
  ['prete', 'Prêtes', ['prete']],
  ['livree', 'Livrées', ['livree']],
  ['annulee', 'Annulées', ['annulee']]
];
const JOURS_HISTORIQUE = 30;
const ECHEANCE_PAR_DEFAUT_JOURS = 7;
const COLONNES = 'id, numero, client_id, nom, telephone, reception, zone_id, zone_nom, frais, adresse, note, lignes, sous_total, total, statut, motif, vente_id, traite_par, created_at, confirmee_at, livree_at';
const estMobile = () => window.matchMedia('(max-width: 899.98px)').matches;

/** « il y a 6 min », « 11:20 », « Hier 17:05 », « 12/10 09:48 ». */
function quand(date) {
  const d = new Date(date);
  const minutes = Math.round((Date.now() - d.getTime()) / 60000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const jour = formatDate(d, 'court');
  if (jour === formatDate(new Date(), 'court')) return formatDate(d, 'heure');
  if (jour === formatDate(new Date(Date.now() - 864e5), 'court')) return `Hier ${formatDate(d, 'heure')}`;
  return `${formatDate(d, 'jourMois')} ${formatDate(d, 'heure')}`;
}

function badge(statut) {
  const st = STATUTS[statut] || { libelle: statut, classe: '' };
  return `<span class="badge-commande-web ${st.classe}">${esc(st.libelle)}</span>`;
}

function resumeLignes(c) {
  const n = (c.lignes || []).length;
  return `${n} article${n > 1 ? 's' : ''} · ${c.reception === 'livraison' ? `Livraison${c.zone_nom ? ' ' + c.zone_nom : ''}` : 'Retrait'}`;
}

/** Message WhatsApp pré-rempli selon l'étape. */
function texteWhatsApp(c) {
  const b = etat.boutique.nom;
  const p = prenom(c.nom) || c.nom || '';
  const total = formatGNF(c.total);
  if (c.statut === 'nouvelle') return `Bonjour ${p}, ici ${b}. Nous avons bien reçu votre commande ${c.numero} (${total}). Pouvez-vous nous confirmer ${c.reception === 'livraison' ? 'l’adresse de livraison' : 'l’heure de passage'} ?`;
  if (c.statut === 'confirmee') return `Bonjour ${p}, votre commande ${c.numero} (${total}) est confirmée. Nous la préparons et vous prévenons dès qu’elle est prête. ${b}`;
  if (c.statut === 'prete') {
    return c.reception === 'livraison'
      ? `Bonjour ${p}, votre commande ${c.numero} est prête : le livreur part bientôt vers ${c.zone_nom || 'chez vous'}. Total à payer : ${total}. ${b}`
      : `Bonjour ${p}, votre commande ${c.numero} est prête : vous pouvez passer la récupérer chez ${b}. Total à payer : ${total}.`;
  }
  if (c.statut === 'livree') return `Bonjour ${p}, merci pour votre achat chez ${b} (commande ${c.numero}). À bientôt !`;
  return `Bonjour ${p}, désolé : votre commande ${c.numero} chez ${b} ne peut pas être servie${c.motif ? ` (${c.motif})` : ''}. Contactez-nous pour une autre solution.`;
}
const lienWhatsAppClient = (c) => `https://wa.me/${String(c.telephone || '').replace(/\D/g, '')}?text=${encodeURIComponent(texteWhatsApp(c))}`;

export function afficherCommandes(conteneur, params) {
  const boutique = etat.boutique;
  const idDemande = params.get('id') || null;
  const s = { commandes: [], onglet: 'a-traiter', selection: idDemande, enLigne: null, jeton: 0, comptesTermines: {} };
  const pageDetail = Boolean(idDemande) && estMobile();

  if (pageDetail) {
    conteneur.innerHTML = `
      <div class="page page-detail-commande">
        <div class="detail-page-entete">
          <a href="#/commandes" class="btn-icone btn-icone-sombre" aria-label="Retour aux commandes">${icone('retour', 20, 2)}</a>
          <span class="fiche-page-titre">Commande</span>
        </div>
        <section class="detail-commande" data-zone="detail"></section>
      </div>`;
    chargerEtAfficherDetail(conteneur.querySelector('[data-zone="detail"]'), idDemande, 'page', () => afficherCommandes(conteneur, params));
    return;
  }

  conteneur.innerHTML = `
    <div class="page page-commandes">
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour seul-ordi" href="#/tableau-de-bord">← Tableau de bord</a>
          <h1>Commandes en ligne</h1>
          <span data-zone="sous-titre">Reçues depuis votre boutique en ligne</span>
        </div>
        <div class="kpis-commandes" data-zone="kpis"></div>
      </header>
      <div class="liens-commandes">
        ${peut('boutique_en_ligne.gerer') ? `<a class="btn btn-secondaire btn-petit" href="#/boutique-en-ligne">${icone('enLigne', 16, 2)} Ma boutique en ligne</a>` : ''}
        <a class="btn btn-secondaire btn-petit" href="#/affiche">${icone('image', 16, 2)} Affiche du jour</a>
      </div>
      <nav class="onglets" role="tablist" aria-label="Statut" data-zone="onglets"></nav>
      <div class="commandes-corps">
        <section class="liste-commandes-web" aria-label="Liste des commandes" data-zone="liste">
          ${'<div class="carte carte-commande"><span class="squelette" style="height:16px;width:40%"></span><span class="squelette" style="height:12px;width:70%;margin-top:8px"></span></div>'.repeat(4)}
        </section>
        <section class="detail-commande seul-ordi" aria-label="Détail de la commande" data-zone="detail"></section>
      </div>
    </div>`;
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);

  const ongletCourant = () => ONGLETS.find(([code]) => code === s.onglet);
  const filtrees = () => s.commandes.filter((c) => ongletCourant()[2].includes(c.statut));
  const compte = (statuts) => s.commandes.filter((c) => statuts.includes(c.statut)).length;

  function renderOnglets() {
    zone('onglets').innerHTML = ONGLETS.map(([code, libelle, statuts]) => `
      <button type="button" class="onglet-messages onglet-commandes ${code === s.onglet ? 'actif' : ''}" role="tab" aria-selected="${code === s.onglet}" data-onglet="${code}">
        ${esc(libelle)} <span class="compteur-onglet">${compte(statuts)}</span>
      </button>`).join('');
  }

  function renderKpis(montantMois) {
    const nouvelles = compte(['nouvelle']);
    const aLivrer = compte(['confirmee', 'prete']);
    zone('kpis').innerHTML = `
      <div class="kpi-commande"><span>Nouvelles</span><strong class="encre-orange">${formatNombre(nouvelles)}</strong></div>
      <div class="kpi-commande"><span>À livrer</span><strong class="encre-bleu">${formatNombre(aLivrer)}</strong></div>
      ${peut('voir_chiffres_globaux') ? `<div class="kpi-commande"><span>Ventes en ligne (mois)</span><strong class="encre-vert" data-ref="mois">${montantMois === undefined ? '…' : formatNombre(montantMois)}</strong></div>` : ''}`;
  }

  function renderListe() {
    const liste = filtrees();
    zone('liste').innerHTML = liste.length ? liste.map((c) => `
      <button type="button" class="carte carte-commande ${c.id === s.selection ? 'selectionnee' : ''}" data-commande="${esc(c.id)}" ${c.id === s.selection ? 'aria-current="true"' : ''}>
        <span class="cc-ligne">
          ${c.statut === 'nouvelle' ? '<span class="point-nouvelle" aria-hidden="true"></span>' : ''}
          <span class="cc-numero">${esc(c.numero)}</span>
          <span class="discret">${esc(quand(c.created_at))}</span>
          ${badge(c.statut)}
        </span>
        <span class="cc-ligne cc-ligne-client">
          <span class="gras">${esc(c.nom)}</span>
          <span class="cc-total">${formatNombre(c.total)} <span class="unite-gnf">GNF</span></span>
        </span>
        <span class="discret">${esc(resumeLignes(c))}</span>
      </button>`).join('') : `
      <div class="carte etat-vide">
        <p>${s.onglet === 'a-traiter' ? 'Aucune commande à traiter. Partagez le lien de votre boutique pour en recevoir.' : 'Aucune commande ici.'}</p>
        ${s.onglet === 'a-traiter' && peut('boutique_en_ligne.gerer') ? '<a class="btn btn-primaire" href="#/boutique-en-ligne">Ma boutique en ligne</a>' : ''}
      </div>`;
    if (s.onglet === 'livree' || s.onglet === 'annulee') {
      zone('liste').insertAdjacentHTML('beforeend', `<p class="discret note-liste">Les ${JOURS_HISTORIQUE} derniers jours.</p>`);
    }
  }

  function selectionner(id, { remplacerUrl = true } = {}) {
    s.selection = id;
    renderListe();
    if (estMobile()) { naviguer(`commandes/${encodeURIComponent(id)}`); return; }
    if (remplacerUrl) history.replaceState(null, '', `#/commandes/${encodeURIComponent(id)}`);
    chargerEtAfficherDetail(zone('detail'), id, 'panneau', () => charger({ garderSelection: true }));
  }

  async function charger({ garderSelection = false } = {}) {
    const jeton = ++s.jeton;
    const depuis = `${decalerDate(dateISO(), -JOURS_HISTORIQUE)}T00:00:00Z`;
    const [actives, terminees, reglages] = await Promise.all([
      sb.from('commandes_web').select(COLONNES).eq('boutique_id', boutique.id).in('statut', ['nouvelle', 'confirmee', 'prete']).order('created_at', { ascending: false }).limit(300),
      sb.from('commandes_web').select(COLONNES).eq('boutique_id', boutique.id).in('statut', ['livree', 'annulee']).gte('created_at', depuis).order('created_at', { ascending: false }).limit(300),
      s.enLigne ? Promise.resolve({ data: s.enLigne }) : sb.from('boutiques_en_ligne').select('slug, actif').eq('boutique_id', boutique.id).maybeSingle()
    ]);
    if (jeton !== s.jeton || !conteneur.isConnected) return;
    if (actives.error || terminees.error) {
      zone('liste').innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(actives.error || terminees.error))}</p>`;
      return;
    }
    s.commandes = [...actives.data, ...terminees.data];
    s.enLigne = reglages.data || null;
    if (s.enLigne?.slug) {
      zone('sous-titre').innerHTML = `Reçues depuis votre boutique en ligne · <a href="${esc(lienBoutique(s.enLigne.slug))}" target="_blank" rel="noopener" class="gras">voir ma boutique</a>${s.enLigne.actif ? '' : ' <span class="tag-ferme">fermée</span>'}`;
    }
    // Une commande ouverte par l'adresse : on se place sur son onglet.
    const choisie = s.commandes.find((c) => c.id === s.selection);
    if (choisie && !garderSelection && !ongletCourant()[2].includes(choisie.statut)) s.onglet = choisie.statut;
    renderOnglets();
    renderKpis();
    renderListe();
    if (!estMobile()) {
      const premiere = filtrees()[0];
      if (s.selection) chargerEtAfficherDetail(zone('detail'), s.selection, 'panneau', () => charger({ garderSelection: true }));
      else if (premiere) selectionner(premiere.id);
      else zone('detail').innerHTML = '<div class="fiche-vide"><p>Choisissez une commande pour voir le détail.</p></div>';
    }
    if (peut('voir_chiffres_globaux')) {
      const debut = dateISO().slice(0, 8) + '01';
      const { data } = await sb.rpc('stats_boutique_en_ligne', { p_boutique: boutique.id, p_debut: debut, p_fin: dateISO() });
      const st = (Array.isArray(data) ? data[0] : data) || {};
      const cellule = conteneur.querySelector('[data-ref="mois"]');
      if (cellule) cellule.textContent = formatNombre(st.montant_livre || 0);
    }
  }

  conteneur.addEventListener('click', (e) => {
    const onglet = e.target.closest('[data-onglet]');
    if (onglet) {
      s.onglet = onglet.dataset.onglet;
      renderOnglets();
      renderListe();
      const premiere = filtrees()[0];
      if (!estMobile() && premiere && !filtrees().some((c) => c.id === s.selection)) selectionner(premiere.id);
      return;
    }
    const carte = e.target.closest('[data-commande]');
    if (carte) selectionner(carte.dataset.commande);
  });

  // Nouvelle commande détectée par la surveillance (toutes les 60 s) : on recharge la liste.
  const surNouvelles = () => charger({ garderSelection: true });
  window.addEventListener('yb:commandes', surNouvelles);
  charger();
  return () => window.removeEventListener('yb:commandes', surNouvelles);
}

/* =========================================================================
   Détail d'une commande
   ========================================================================= */

async function chargerEtAfficherDetail(cadre, id, mode, apresAction) {
  cadre.dataset.commande = id;
  cadre.innerHTML = '<div class="carte dc-carte">' + '<span class="squelette" style="height:18px;width:50%"></span><span class="squelette" style="height:60px;margin-top:12px"></span>'.repeat(2) + '</div>';
  const { data: c, error } = await sb.from('commandes_web').select(COLONNES).eq('boutique_id', etat.boutique.id).eq('id', id).maybeSingle();
  if (cadre.dataset.commande !== id || !cadre.isConnected) return;
  if (error || !c) {
    cadre.innerHTML = `<div class="carte fiche-vide"><p>${error ? esc(messageErreur(error)) : 'Cette commande est introuvable.'}</p><a class="btn btn-secondaire" href="#/commandes">Retour aux commandes</a></div>`;
    return;
  }
  const ids = [...new Set((c.lignes || []).map((l) => l.produit_id).filter(Boolean))];
  const [stocksRes, achatsRes, venteRes] = await Promise.all([
    ids.length ? sb.from('produits').select('id, stock, seuil_alerte, sur_commande, unite').in('id', ids) : Promise.resolve({ data: [] }),
    c.client_id ? sb.from('ventes').select('id', { count: 'exact', head: true }).eq('client_id', c.client_id).eq('statut', 'validee') : Promise.resolve({ count: null }),
    c.vente_id ? sb.from('ventes').select('id, numero').eq('id', c.vente_id).maybeSingle() : Promise.resolve({ data: null })
  ]);
  if (cadre.dataset.commande !== id || !cadre.isConnected) return;
  const stocks = new Map((stocksRes.data || []).map((p) => [p.id, p]));
  renderDetail(cadre, c, { stocks, nbAchats: achatsRes.count, vente: venteRes.data, mode, apresAction });
}

function renderDetail(cadre, c, { stocks, nbAchats, vente, mode, apresAction }) {
  const st = STATUTS[c.statut] || STATUTS.nouvelle;
  const termine = c.statut === 'livree' || c.statut === 'annulee';
  const indexEtape = ETAPES.indexOf(c.statut);
  const alertes = [];
  const lignes = (c.lignes || []).map((l) => {
    const p = stocks.get(l.produit_id);
    let texteStock = '—';
    let classe = '';
    if (p) {
      if (p.sur_commande) { texteStock = 'Sur cmd'; classe = 'stock-moyen'; }
      else {
        const stock = Number(p.stock) || 0;
        texteStock = formatNombre(stock, 3);
        if (stock < Number(l.quantite)) {
          classe = 'stock-insuffisant';
          if (!termine) alertes.push(`${l.nom} : ${formatQuantite(l.quantite, l.unite)} en commande, seulement ${formatQuantite(stock, l.unite)} en stock.`);
        } else classe = stock - Number(l.quantite) <= Number(p.seuil_alerte || 0) ? 'stock-moyen' : 'stock-ok';
      }
    }
    return { ...l, texteStock, classe };
  });
  const peutRefuser = !termine && (c.statut === 'nouvelle' ? peut('commandes.traiter') : peut('commandes.annuler'));
  const telephone = String(c.telephone || '').replace(/\D/g, '');

  cadre.innerHTML = `
    <div class="carte dc-carte">
      <div class="dc-entete">
        <h2>Commande ${esc(c.numero)}</h2>
        <span class="badge-commande-web grand ${st.classe}">${esc(st.detail)}</span>
        <span class="discret dc-date">${esc(quand(c.created_at))}</span>
      </div>
      ${c.statut === 'annulee' ? `<p class="bandeau-annulee">${icone('alerte', 16, 2)} Commande annulée${c.motif ? ` : ${esc(c.motif)}` : ''}</p>` : `
        <ol class="etapes-commande" aria-label="Étapes">
          ${ETAPES.map((e, i) => `<li class="${i <= indexEtape ? 'faite' : ''} ${i === indexEtape ? 'courante' : ''}"><span class="etape-barre"></span><span>${esc(STATUTS[e].libelle)}</span></li>`).join('')}
        </ol>`}
      <div class="dc-blocs">
        <div class="dc-bloc">
          <span class="dc-bloc-titre">Client</span>
          <span class="tres-gras">${esc(c.nom)}</span>
          <span>${esc(formatTelephone(c.telephone))}${c.client_id ? ` · <a class="texte-succes gras" href="#/clients/${encodeURIComponent(c.client_id)}">client connu${nbAchats !== null && nbAchats !== undefined ? ` (${nbAchats} achat${nbAchats > 1 ? 's' : ''})` : ''}</a>` : ' · <span class="discret">nouveau client</span>'}</span>
        </div>
        <div class="dc-bloc">
          <span class="dc-bloc-titre">${c.reception === 'livraison' ? `Livraison${c.zone_nom ? ' · ' + esc(c.zone_nom) : ''}` : 'Retrait en boutique'}</span>
          ${c.reception === 'livraison' ? `<span>${esc(c.adresse || '—')}</span>` : '<span>Le client passe récupérer sa commande.</span>'}
          ${c.note ? `<span class="discret">Note : ${esc(c.note)}</span>` : ''}
        </div>
      </div>
      <div class="tableau-cadre-simple">
        <table class="tableau-commande">
          <thead><tr><th>Article</th><th class="droite">Qté</th><th class="droite">Stock</th><th class="droite">Montant</th></tr></thead>
          <tbody>
            ${lignes.map((l) => `
              <tr>
                <td class="gras">${esc(l.nom)}<span class="discret dc-prix-unitaire">${formatNombre(l.prix)} / ${esc(l.unite || 'unité')}</span></td>
                <td class="droite">${esc(formatQuantite(l.quantite, l.unite))}</td>
                <td class="droite gras ${l.classe}">${esc(l.texteStock)}</td>
                <td class="droite gras">${formatNombre(l.total)}</td>
              </tr>`).join('')}
            ${c.reception === 'livraison' ? `<tr><td colspan="3" class="discret">Livraison${c.zone_nom ? ' ' + esc(c.zone_nom) : ''}</td><td class="droite gras">${Number(c.frais) ? formatNombre(c.frais) : 'Gratuit'}</td></tr>` : ''}
            <tr class="ligne-total"><td colspan="3">Total</td><td class="droite">${formatGNF(c.total)}</td></tr>
          </tbody>
        </table>
      </div>
      ${alertes.length ? `<div class="alerte-stock-commande">${icone('alerte', 18, 2)}<span>${alertes.map(esc).join('<br>')} Appelez le client pour proposer une livraison en deux fois ou une date.</span></div>` : ''}
      ${vente ? `<a class="client-bouton" href="#/ventes/${encodeURIComponent(vente.id)}"><span class="avatar">${icone('ventes', 18, 2)}</span><span class="client-textes"><span class="gras">Vente ${esc(formatNumeroVente(vente.numero))}</span><span class="discret">${c.livree_at ? `Livrée le ${esc(formatDate(c.livree_at, 'complet'))} · ` : ''}voir la vente</span></span>${icone('chevronDroite', 16, 2)}</a>` : ''}
      <div class="dc-actions">
        ${c.statut === 'nouvelle' && peut('commandes.traiter') ? '<button type="button" class="btn btn-primaire btn-action-principale" data-action="confirmer">Confirmer la commande</button>' : ''}
        ${c.statut === 'confirmee' && peut('commandes.traiter') ? '<button type="button" class="btn btn-primaire btn-action-principale" data-action="prete">Marquer prête</button>' : ''}
        ${(c.statut === 'prete' || c.statut === 'confirmee') && peut('commandes.traiter') ? `<button type="button" class="btn ${c.statut === 'prete' ? 'btn-primaire btn-action-principale' : 'btn-secondaire'}" data-action="livrer">Livrée et encaissée</button>` : ''}
        ${vente ? `<button type="button" class="btn btn-secondaire" data-action="facture">${icone('document', 18, 2)} Facture A4</button>` : ''}
        ${vente ? `<button type="button" class="btn btn-secondaire" data-action="recu">${icone('imprimante', 18, 2)} Ticket</button>` : ''}
        ${aModule('livraisons') && c.reception === 'livraison' && c.statut !== 'annulee' ? `<button type="button" class="btn btn-secondaire" data-action="organiser-livraison">${icone('camion', 18, 2)} Organiser la livraison</button>` : ''}
        ${telephone ? `<a class="btn btn-whatsapp" href="${esc(lienWhatsAppClient(c))}" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} WhatsApp</a>` : ''}
        ${telephone ? `<a class="btn btn-secondaire" href="tel:+${esc(telephone)}">${icone('telephone', 18, 2)} Appeler</a>` : ''}
        ${peutRefuser ? `<button type="button" class="btn btn-refuser" data-action="refuser">${c.statut === 'nouvelle' ? 'Refuser' : 'Annuler'}</button>` : ''}
      </div>
      ${!termine ? '<p class="discret dc-note">Après confirmation : « Prête » puis <strong>« Livrée et encaissée »</strong> — la commande devient une vente (stock baissé, reçu, mode de paiement choisi à ce moment-là : espèces, OM, MoMo ou crédit).</p>' : ''}
    </div>`;

  cadre.onclick = async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const bouton = e.target.closest('button');
    if (action === 'confirmer' || action === 'prete') {
      boutonOccupe(bouton, true, action === 'confirmer' ? 'Confirmation…' : 'Enregistrement…');
      const { error } = await sb.rpc('changer_statut_commande', { p_commande: c.id, p_statut: action === 'confirmer' ? 'confirmee' : 'prete', p_motif: null });
      boutonOccupe(bouton, false);
      if (error) { toast(messageErreur(error), 'erreur'); return; }
      toast(action === 'confirmer' ? `Commande ${c.numero} confirmée.` : `Commande ${c.numero} prête.`, 'succes');
      verifierCommandes();
      apresAction();
    }
    if (action === 'livrer') ouvrirLivraison(c, apresAction);
    if (action === 'refuser') ouvrirRefus(c, apresAction);
    if (action === 'organiser-livraison') ouvrirOrganiserLivraison({ commande: { nom: c.nom, telephone: c.telephone, adresse: [c.zone_nom, c.adresse].filter(Boolean).join(' · '), vente_id: c.vente_id || null } });
    if (action === 'recu') imprimerRecuCommande(c, vente, bouton);
    if (action === 'facture') ouvrirDocument({ type: 'facture', vente: vente.id, retour: `#/commandes/${encodeURIComponent(c.id)}` });
  };
}

/* ------------------------------------------------------------ Livrée et encaissée */

async function ouvrirLivraison(c, apres) {
  const avecTel = Boolean(c.telephone);
  const s = { mode: 'especes', echeance: dateISO(ECHEANCE_PAR_DEFAUT_JOURS) };
  const { el, fermer } = ouvrirModale({
    titre: `Livrer la commande ${c.numero}`,
    contenu: `
      <form class="form-modale" novalidate>
        <p class="texte-modale">Total à encaisser : <strong>${formatGNF(c.total)}</strong>${Number(c.frais) ? ` (dont livraison ${formatGNF(c.frais)})` : ''}.</p>
        <div class="champ">
          <span class="etiquette">Mode de paiement</span>
          <div class="modes-livraison" role="radiogroup" aria-label="Mode de paiement">
            ${MODES_CAISSE.map((m) => `<button type="button" class="mode-livraison" role="radio" data-mode="${m}" aria-checked="${m === s.mode}">${esc(MODES_PAIEMENT[m].libelle)}</button>`).join('')}
          </div>
        </div>
        <div class="champ" data-zone="echeance" hidden>
          <label for="liv-echeance">Date d’échéance (crédit)</label>
          <input id="liv-echeance" class="input" type="date" min="${dateISO()}" value="${s.echeance}">
        </div>
        <label class="case-option ${avecTel ? '' : 'inactive'}"><input type="checkbox" name="recu" ${avecTel ? '' : 'disabled'}> Envoyer le reçu par SMS${avecTel ? ` au ${esc(formatTelephone(c.telephone))}` : ''}</label>
        <p class="aide">La commande devient une vente : le stock baisse et le reçu est disponible. ${c.client_id ? '' : 'Le client sera créé automatiquement à partir de son téléphone.'}</p>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
          <button type="submit" class="btn btn-primaire">Valider la livraison</button>
        </div>
      </form>`
  });
  const form = el.querySelector('form');
  const zoneErreur = el.querySelector('.erreur-form');
  if (avecTel) chargerSoldeSms().then((solde) => { if (solde > 0 && form.isConnected) form.recu.checked = true; }).catch(() => {});
  el.addEventListener('click', (e) => {
    const mode = e.target.closest('[data-mode]');
    if (!mode) return;
    s.mode = mode.dataset.mode;
    el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b === mode)));
    el.querySelector('[data-zone="echeance"]').hidden = s.mode !== 'credit';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const echeance = el.querySelector('#liv-echeance').value;
    if (s.mode === 'credit' && (!echeance || echeance < dateISO())) {
      zoneErreur.textContent = 'Choisissez une date d’échéance à venir.';
      zoneErreur.hidden = false;
      return;
    }
    const bouton = form.querySelector('[type="submit"]');
    boutonOccupe(bouton, true, 'Enregistrement…');
    const { data, error } = await sb.rpc('livrer_commande', {
      p_commande: c.id, p_mode: s.mode, p_echeance: s.mode === 'credit' ? echeance : null, p_recu_sms: Boolean(form.recu.checked)
    });
    boutonOccupe(bouton, false);
    if (error) { zoneErreur.textContent = messageErreur(error); zoneErreur.hidden = false; return; }
    const r = (Array.isArray(data) ? data[0] : data) || {};
    fermer();
    toast(`Commande ${c.numero} livrée : vente ${formatNumeroVente(r.numero)} (${formatGNF(r.total ?? c.total)}).`, 'succes', 8000,
      r.vente_id ? { href: `#/ventes/${encodeURIComponent(r.vente_id)}`, libelle: 'Voir le reçu' } : null);
    verifierCommandes();
    apres();
  });
}

/* ------------------------------------------------------------ Refuser / annuler */

function ouvrirRefus(c, apres) {
  const nouvelle = c.statut === 'nouvelle';
  const { el, fermer } = ouvrirModale({
    titre: `${nouvelle ? 'Refuser' : 'Annuler'} la commande ${c.numero}`,
    contenu: `
      <form class="form-modale" novalidate>
        <div class="champ">
          <label for="motif-commande">Motif (le client le verra si vous le prévenez sur WhatsApp)</label>
          <input id="motif-commande" class="input" type="text" maxlength="160" list="motifs-commande" placeholder="Ex. article épuisé">
          <datalist id="motifs-commande">
            <option value="Article épuisé"><option value="Zone non desservie"><option value="Client injoignable"><option value="Commande en double">
          </datalist>
        </div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire" data-fermer>Retour</button>
          <button type="submit" class="btn btn-danger">${nouvelle ? 'Refuser la commande' : 'Annuler la commande'}</button>
        </div>
      </form>`
  });
  const form = el.querySelector('form');
  el.querySelector('#motif-commande').focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const motif = el.querySelector('#motif-commande').value.trim();
    const zoneErreur = el.querySelector('.erreur-form');
    if (!motif) { zoneErreur.textContent = 'Indiquez le motif.'; zoneErreur.hidden = false; return; }
    const bouton = form.querySelector('[type="submit"]');
    boutonOccupe(bouton, true, 'Enregistrement…');
    const { error } = await sb.rpc('changer_statut_commande', { p_commande: c.id, p_statut: 'annulee', p_motif: motif });
    boutonOccupe(bouton, false);
    if (error) { zoneErreur.textContent = messageErreur(error); zoneErreur.hidden = false; return; }
    fermer();
    toast(`Commande ${c.numero} ${nouvelle ? 'refusée' : 'annulée'}. Prévenez le client sur WhatsApp.`, 'succes', 6000);
    verifierCommandes();
    apres();
  });
}

/* ------------------------------------------------------------ Reçu */

async function imprimerRecuCommande(c, vente, bouton) {
  boutonOccupe(bouton, true, 'Préparation…');
  const [venteRes, lignesRes] = await Promise.all([
    sb.from('ventes').select('numero, created_at, sous_total, remise, total, mode_paiement, echeance, frais_livraison').eq('id', vente.id).single(),
    sb.from('ventes_lignes').select('nom_produit, unite, quantite, prix_unitaire, total').eq('vente_id', vente.id)
  ]);
  boutonOccupe(bouton, false);
  if (venteRes.error || lignesRes.error) { toast(messageErreur(venteRes.error || lignesRes.error), 'erreur'); return; }
  const v = venteRes.data;
  imprimerRecuVente({
    numero: v.numero, date: v.created_at, vendeur: etat.membre?.nom || '—', client: c.nom, lignes: lignesRes.data,
    sousTotal: Number(v.sous_total), remise: Number(v.remise), total: Number(v.total), mode: v.mode_paiement,
    montantRecu: null, echeance: v.mode_paiement === 'credit' ? v.echeance : null,
    fraisLivraison: Number(v.frais_livraison) || 0, commande: c.numero
  }, { idVente: vente.id });
}
