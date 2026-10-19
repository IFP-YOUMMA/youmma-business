/**
 * dashboard.js — Tableau de bord (maquettes Main.dc.html et Mobile.dc.html) avec les vraies données.
 * Chaque bloc se charge indépendamment et affiche un squelette en attendant.
 */
import { chargerAfficheDuJour, donneesAffiche, publierAffiche } from './affiche-jour.js';
import { genererAffiche, versImage } from './affiche.js';
import { sb } from './supabase.js';
import { etat, peut, utilisateur } from './state.js';
import { naviguer } from './router.js';
import { carteLicence } from './layout.js';
import { chargerSituationCredits, texteEcheance } from './clients-commun.js';
import { boutonsRelanceHTML, relancerParSms, chargerSoldeSms } from './sms.js';

/** Clients affichés dans « Crédits clients à relancer » (pour les boutons de relance). */
const clientsARelancer = new Map();
import {
  esc, icone, prenom, initiales, capitaliser, formatNombre, formatGNF, formatMillions,
  formatQuantite, formatDate, dateISO, formatNumeroVente, MODES_PAIEMENT
} from './utils.js';

const ORDRE_MODES = ['especes', 'orange_money', 'mtn_momo', 'credit', 'chantier'];
const HAUTEUR_MAX_BARRE = 160;

export function afficherTableauDeBord(conteneur) {
  // Un vendeur ne voit pas les chiffres globaux de la boutique : tableau de bord personnel.
  if (!peut('voir_chiffres_globaux')) {
    afficherTableauVendeur(conteneur);
    return;
  }
  const b = etat.boutique;
  conteneur.innerHTML = gabarit(b);
  brancherEvenements(conteneur);

  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);
  // Situation des crédits calculée une seule fois, partagée par les indicateurs et la liste.
  const situation = chargerSituationCredits(b.id).catch((err) => { console.error(err); return null; });
  chargerStats(b.id, zone, situation);
  chargerStockBas(b.id, zone('stock'));
  chargerCredits(situation, zone('credits'));
  if (peut('messages.voir')) afficherSoldeSms(zone('sms-restants'));
  chargerDernieresVentes(b.id, zone('ventes'));
  chargerBlocEnLigne(zone('en-ligne'));
}

/* ------------------------------------------------------------ Tableau de bord vendeur */

function afficherTableauVendeur(conteneur) {
  const b = etat.boutique;
  const uid = utilisateur()?.id;
  conteneur.innerHTML = `
    <div class="page page-vendeur">
      <header class="dash-entete">
        <div class="dash-entete-textes">
          <h1>Bonjour, ${esc(prenom(etat.membre?.nom) || 'et bienvenue')}</h1>
          <span>${esc(capitaliser(formatDate(new Date(), 'long')))} · bonne journée de vente !</span>
        </div>
      </header>
      <a class="btn btn-primaire btn-cta-vendeur" href="#/caisse?vendre=1">${icone('plus', 22, 2.4)} Nouvelle vente</a>
      <section class="vendeur-jour" aria-label="Mes ventes du jour" data-zone="mes-ventes">
        <span class="vendeur-jour-titre">Mes ventes du jour</span>
        <span class="squelette" style="height:38px;width:220px"></span>
      </section>
      <nav class="raccourcis" aria-label="Raccourcis">
        ${[['caisse', 'Caisse', 'caisse'], ['clients', 'Clients', 'client'], ['stock', 'Stock', 'stock']]
          .map(([route, libelle, ic]) => `<a href="#/${route}" class="acces-rapide">${icone(ic, 24, 1.8)}${libelle}</a>`).join('')}
      </nav>
      <section class="rangee dash-en-ligne" data-zone="en-ligne" hidden></section>
      <section class="carte bloc-liste">
        <div class="bloc-entete">
          <h2>Mes dernières ventes</h2>
          <a class="lien-bloc" href="#/ventes">Tout voir</a>
        </div>
        <div data-zone="ventes">${squelettesLignes(4)}</div>
      </section>
    </div>`;
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);
  chargerMesVentesDuJour(b.id, uid, zone('mes-ventes'));
  chargerMesDernieresVentes(b.id, uid, zone('ventes'));
  chargerBlocEnLigne(zone('en-ligne'));
}

/* ------------------------------------------------------------ Boutique en ligne : affiche du jour + commandes */

async function chargerBlocEnLigne(zone) {
  if (!zone) return;
  const [commandes, afficheRes] = await Promise.all([
    peut('commandes.voir')
      ? sb.from('commandes_web').select('statut').eq('boutique_id', etat.boutique.id).in('statut', ['nouvelle', 'confirmee', 'prete'])
      : Promise.resolve({ data: [] }),
    peut('affiche.partager') ? chargerAfficheDuJour().catch(() => null) : Promise.resolve(null)
  ]);
  if (!zone.isConnected) return;
  const actives = commandes.data || [];
  const nouvelles = actives.filter((c) => c.statut === 'nouvelle').length;
  const affiche = afficheRes?.affiche?.produit ? afficheRes : null;
  if (!actives.length && !affiche) return;
  zone.hidden = false;
  zone.innerHTML = `
    ${actives.length ? `
      <a class="carte carte-commandes-dash" href="#/commandes">
        <span class="kpi-icone" style="background:#FFF4EA;color:#7A3300">${icone('enLigne', 18, 2)}</span>
        <span class="ccd-textes">
          <span class="tres-gras">Commandes en ligne à traiter</span>
          <span class="discret">${nouvelles ? `${nouvelles} nouvelle${nouvelles > 1 ? 's' : ''} à confirmer · ` : ''}${actives.length} au total</span>
        </span>
        <span class="ccd-nombre">${actives.length}</span>
      </a>` : ''}
    ${affiche ? `
      <div class="carte carte-affiche-dash">
        <a class="cad-miniature" href="#/affiche" aria-label="Ouvrir l’affiche du jour" data-zone="miniature"><span class="squelette"></span></a>
        <span class="cad-textes">
          <span class="tres-gras">Affiche du jour</span>
          <span class="discret">${esc(affiche.affiche.produit.nom)} · ${formatNombre(affiche.affiche.produit.prix)} GNF</span>
          <button type="button" class="btn btn-whatsapp btn-petit" data-action="publier-affiche">${icone('whatsapp', 16, 2)} Publier</button>
        </span>
      </div>` : ''}`;
  if (!affiche) return;
  const donnees = donneesAffiche(affiche.affiche, affiche);
  zone.querySelector('[data-action="publier-affiche"]').addEventListener('click', async (e) => {
    const bouton = e.currentTarget;
    bouton.disabled = true;
    try { await publierAffiche(donnees, 'facebook'); } catch (err) { console.error(err); }
    bouton.disabled = false;
  });
  try {
    const blob = await versImage(await genererAffiche(donnees, 'facebook'), 'facebook');
    const cadre = zone.querySelector('[data-zone="miniature"]');
    if (cadre?.isConnected) cadre.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="Affiche du jour : ${esc(donnees.produit.nom)}">`;
  } catch (err) { console.warn('[YOUMMA] Miniature affiche :', err); }
}

async function chargerMesVentesDuJour(idBoutique, uid, zone) {
  const { data, error } = await sb.from('ventes')
    .select('total')
    .eq('boutique_id', idBoutique)
    .eq('vendeur_id', uid)
    .eq('statut', 'validee')
    .gte('created_at', `${dateISO()}T00:00:00Z`); // Conakry = UTC
  if (error) { console.error(error); zone.innerHTML = erreurBloc(); return; }
  const total = data.reduce((t, v) => t + (Number(v.total) || 0), 0);
  zone.innerHTML = `
    <span class="vendeur-jour-titre">Mes ventes du jour</span>
    <span class="vendeur-jour-montant">${formatNombre(total)} <span>GNF</span></span>
    <span class="vendeur-jour-nb">${data.length ? `${data.length} vente${data.length > 1 ? 's' : ''} aujourd’hui` : 'Pas encore de vente aujourd’hui'}</span>`;
}

async function chargerMesDernieresVentes(idBoutique, uid, zone) {
  const { data: ventes, error } = await sb.from('ventes')
    .select('id, numero, created_at, client_id, mode_paiement, total, statut')
    .eq('boutique_id', idBoutique)
    .eq('vendeur_id', uid)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) { console.error(error); zone.innerHTML = erreurBloc(); return; }
  if (!ventes.length) {
    zone.innerHTML = etatVide('Vos ventes apparaîtront ici. Lancez-vous depuis la caisse !', { href: '#/caisse', libelle: 'Ouvrir la caisse' });
    return;
  }
  const idsClients = [...new Set(ventes.map((v) => v.client_id).filter(Boolean))];
  const { data: clients } = idsClients.length
    ? await sb.from('clients').select('id, nom').in('id', idsClients)
    : { data: [] };
  const noms = new Map((clients || []).map((c) => [c.id, c.nom]));
  zone.innerHTML = `
    <ul class="liste-ventes-mobile">
      ${ventes.map((v) => `
        <li>
          <a class="vente-mobile" href="#/ventes/${encodeURIComponent(v.id)}">
            <div class="vente-mobile-haut">
              <span class="gras">${esc(formatNumeroVente(v.numero))} · ${esc(formatDate(v.created_at, 'heure'))}</span>
              <span class="tres-gras ${v.statut === 'annulee' ? 'montant-annule' : ''}">${formatGNF(v.total)}</span>
            </div>
            <div class="vente-mobile-bas">
              <span class="ligne-sous">${esc(noms.get(v.client_id) || 'Client comptoir')} · ${esc(formatDate(v.created_at, 'jourMois'))}</span>
              ${v.statut === 'annulee' ? '<span class="badge-paiement badge-annulee">Annulée</span>' : badgePaiement(MODES_PAIEMENT[v.mode_paiement] || MODES_PAIEMENT.especes)}
            </div>
          </a>
        </li>`).join('')}
    </ul>`;
}

/* ------------------------------------------------------------ Gabarit */

function gabarit(b) {
  const aujourdhui = capitaliser(formatDate(new Date(), 'long'));
  return `
    <div class="page page-accueil">
      <section class="dash-hero seul-mobile" aria-label="Ventes d’aujourd’hui" data-zone="hero">
        <span class="dash-hero-titre">Ventes d’aujourd’hui</span>
        <span class="squelette" style="height:38px;width:220px"></span>
        <span class="squelette" style="height:16px;width:160px"></span>
      </section>

      <header class="dash-entete seul-ordi">
        <div class="dash-entete-textes">
          <h1>Bonjour, ${esc(prenom(etat.membre?.nom) || 'et bienvenue')}</h1>
          <span>${esc(aujourdhui)} · voici l’activité de votre boutique aujourd’hui</span>
          ${peut('messages.voir') ? '<span class="ligne-sms" data-zone="sms-restants"></span>' : ''}
        </div>
        <div class="dash-entete-actions">
          <form class="recherche-entete" role="search" data-form="recherche">
            ${icone('recherche', 18, 2)}
            <label class="sr-only" for="recherche-accueil">Rechercher un article</label>
            <input id="recherche-accueil" type="search" placeholder="Rechercher un article…" autocomplete="off">
          </form>
          <a class="btn btn-primaire" href="#/caisse">${icone('plus', 18, 2.4)} Nouvelle vente</a>
        </div>
      </header>

      <a class="btn btn-primaire btn-cta-mobile seul-mobile" href="#/caisse">${icone('plus', 22, 2.4)} Nouvelle vente</a>

      <section class="kpis seul-ordi" aria-label="Indicateurs du jour" data-zone="kpis">
        ${'<div class="carte kpi"><span class="squelette" style="height:14px;width:60%"></span><span class="squelette" style="height:30px;width:80%"></span><span class="squelette" style="height:14px;width:50%"></span></div>'.repeat(4)}
      </section>

      <section class="kpis-mobile seul-mobile" aria-label="Indicateurs du jour" data-zone="kpis-mobile">
        ${'<div class="kpi-mobile"><span class="squelette" style="height:12px;width:60%"></span><span class="squelette" style="height:22px;width:85%"></span></div>'.repeat(4)}
      </section>

      <nav class="acces-rapides seul-mobile" aria-label="Accès rapides">
        ${[['stock', 'Stock', 'stock'], ['clients', 'Clients', 'client'], ['depenses', 'Dépenses', 'depenses'],
          // Boutique de matériaux : accès direct aux chantiers à la place des rapports.
          b.type_activite === 'materiaux' ? ['chantiers', 'Chantiers', 'casque'] : ['rapports', 'Rapports', 'rapports']]
          .map(([route, libelle, ic]) => `<a href="#/${route}" class="acces-rapide">${icone(ic, 22, 1.8)}${libelle}</a>`).join('')}
      </nav>

      <section class="rangee dash-en-ligne" data-zone="en-ligne" hidden></section>

      <section class="rangee dash-graphiques">
        <div class="carte bloc-graphique" data-zone="graphique">
          <div class="bloc-entete">
            <div class="bloc-titres">
              <h2>Ventes des 7 derniers jours</h2>
              <span class="squelette" style="height:14px;width:180px"></span>
            </div>
            ${selecteurPeriode()}
          </div>
          <div class="squelette" style="height:200px"></div>
        </div>
        <div class="carte bloc-paiements" data-zone="paiements">
          <div class="bloc-titres"><h2>Modes de paiement</h2><span class="squelette" style="height:14px;width:150px"></span></div>
          <div class="squelette" style="height:14px;border-radius:999px"></div>
          ${'<div class="squelette" style="height:18px"></div>'.repeat(4)}
        </div>
      </section>

      <section class="rangee">
        <div class="carte bloc-liste">
          <div class="bloc-entete">
            <h2>Stock bas · à commander</h2>
            <a class="lien-bloc" href="#/stock?filtre=bas">Voir le stock</a>
          </div>
          <div data-zone="stock">${squelettesLignes(3)}</div>
        </div>
        <div class="carte bloc-liste">
          <div class="bloc-entete">
            <h2>Crédits clients à relancer</h2>
            <a class="lien-bloc seul-ordi" href="#/clients">Tous les crédits</a>
            <span class="total-credits seul-mobile" data-zone="credits-total"></span>
          </div>
          <div data-zone="credits">${squelettesLignes(3)}</div>
        </div>
      </section>

      <div class="seul-mobile dash-licence">${carteLicence('clair')}</div>

      <section class="carte bloc-liste dash-ventes">
        <div class="bloc-entete">
          <h2>Dernières ventes</h2>
          <a class="lien-bloc" href="#/ventes">Historique complet</a>
        </div>
        <div data-zone="ventes">${squelettesLignes(4)}</div>
      </section>

      <footer class="pied-page">YOUMMA Business · un produit YOUMMA SARLU</footer>
    </div>`;
}

function selecteurPeriode() {
  return `
    <div class="segments" role="group" aria-label="Période">
      <button type="button" class="segment actif" aria-pressed="true">Semaine</button>
      <button type="button" class="segment" aria-pressed="false" disabled title="Bientôt disponible">Mois</button>
      <button type="button" class="segment" aria-pressed="false" disabled title="Bientôt disponible">Année</button>
    </div>`;
}

function squelettesLignes(n) {
  return '<div class="squelette-ligne"><span class="squelette" style="height:14px;width:55%"></span><span class="squelette" style="height:10px;width:85%"></span></div>'.repeat(n);
}

function brancherEvenements(conteneur) {
  conteneur.querySelector('[data-form="recherche"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.currentTarget.querySelector('input').value.trim();
    naviguer('stock' + (q ? '?q=' + encodeURIComponent(q) : ''));
  });
  conteneur.addEventListener('click', (e) => {
    const relance = e.target.closest('[data-relancer-sms]');
    if (relance) {
      const client = clientsARelancer.get(relance.dataset.relancerSms);
      if (client) relancerParSms(client, client.solde_credit);
    }
    // Toute la ligne d'une vente ouvre son détail (le n° reste un vrai lien pour le clavier).
    const ligne = e.target.closest('tr[data-vente]');
    if (ligne && !e.target.closest('a')) naviguer(`ventes/${ligne.dataset.vente}`);
  });
}

/** Message d'erreur compact dans un bloc. */
function erreurBloc(message = 'Impossible de charger ces informations. Vérifiez votre connexion.') {
  return `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(message)}</p>`;
}

/** État vide encourageant. */
function etatVide(texte, lien = null) {
  return `
    <div class="etat-vide">
      <p>${esc(texte)}</p>
      ${lien ? `<a class="btn btn-secondaire" href="${lien.href}">${esc(lien.libelle)}</a>` : ''}
    </div>`;
}

/* ------------------------------------------------------------ Indicateurs (RPC stats_tableau_bord) */

async function chargerStats(idBoutique, zone, situationPromesse) {
  const [{ data, error }, situation] = await Promise.all([
    sb.rpc('stats_tableau_bord', { p_boutique: idBoutique }),
    situationPromesse
  ]);
  if (error) {
    console.error(error);
    ['kpis', 'kpis-mobile', 'graphique', 'paiements', 'hero'].forEach((z) => { zone(z).innerHTML = erreurBloc(); });
    return;
  }
  const s = normaliserStats(data);
  // Crédits : mêmes règles et mêmes chiffres que la page Clients & crédits.
  if (situation) {
    s.credits_total = situation.totaux.total;
    s.nb_clients_credit = situation.totaux.nbDebiteurs;
    s.nb_credits_retard = situation.totaux.nbRetard;
  }
  const variation = variationVentes(s);

  zone('hero').innerHTML = `
    <span class="dash-hero-titre">Ventes d’aujourd’hui</span>
    <span class="dash-hero-montant">${formatNombre(s.ventes_jour)} <span>GNF</span></span>
    <span class="dash-hero-variation">${esc(variation.texte)}</span>`;

  zone('kpis').innerHTML = [
    { libelle: 'Ventes du jour', valeur: s.ventes_jour, sous: variation.texte, encreSous: variation.encre,
      teinte: '#E3EEFB', encre: '#0D47A1', icone: 'rapports' },
    { libelle: 'Encaissé aujourd’hui', valeur: s.encaisse_jour, sous: `Dépenses : ${formatGNF(s.depenses_jour)}`, encreSous: '#5A6B82',
      teinte: '#E0F2F1', encre: '#00695C', icone: 'caisse' },
    { libelle: 'Crédits en cours', valeur: s.credits_total,
      sous: `${s.nb_clients_credit} client${s.nb_clients_credit > 1 ? 's' : ''} · ${s.nb_credits_retard} en retard`
        + (s.dettes_chantiers > 0 ? ` · + Chantiers : ${formatGNF(s.dettes_chantiers)} dus` : ''),
      encreSous: s.nb_credits_retard > 0 ? '#B23A0E' : '#5A6B82', teinte: '#FBE9E7', encre: '#BF360C', icone: 'client' },
    { libelle: 'Valeur du stock', valeur: s.valeur_stock,
      sous: s.nb_stock_bas > 0 ? `${s.nb_stock_bas} article${s.nb_stock_bas > 1 ? 's' : ''} sous le seuil` : 'Aucun article sous le seuil',
      encreSous: s.nb_stock_bas > 0 ? '#8A5A00' : '#1B6E2A', teinte: '#FFF3CD', encre: '#8A5A00', icone: 'stock' }
  ].map(kpiHTML).join('');

  zone('kpis-mobile').innerHTML = [
    { libelle: 'Encaissé', valeur: formatNombre(s.encaisse_jour), sous: 'Espèces + mobile', encre: '#5A6B82' },
    { libelle: 'Crédits en cours', valeur: formatNombre(s.credits_total),
      sous: s.nb_credits_retard > 0 ? `${s.nb_credits_retard} en retard` : `${s.nb_clients_credit} client${s.nb_clients_credit > 1 ? 's' : ''}`,
      encre: s.nb_credits_retard > 0 ? '#B23A0E' : '#5A6B82' },
    { libelle: 'Dépenses du jour', valeur: formatNombre(s.depenses_jour), sous: 'Aujourd’hui', encre: '#5A6B82' },
    { libelle: 'Stock bas', valeur: `${s.nb_stock_bas} article${s.nb_stock_bas > 1 ? 's' : ''}`,
      sous: s.nb_stock_bas > 0 ? 'À commander' : 'Tout va bien', encre: s.nb_stock_bas > 0 ? '#8A5A00' : '#1B6E2A' }
  ].map((k) => `
    <div class="kpi-mobile">
      <span class="kpi-mobile-libelle">${esc(k.libelle)}</span>
      <span class="kpi-mobile-valeur">${esc(k.valeur)}</span>
      <span class="kpi-mobile-sous" style="color:${k.encre}">${esc(k.sous)}</span>
    </div>`).join('');

  zone('credits-total').textContent = s.credits_total > 0 ? formatGNF(s.credits_total) : '';
  zone('graphique').innerHTML = graphiqueHTML(s.ventes_7j);
  zone('paiements').innerHTML = paiementsHTML(s.paiements_jour);
}

/** Convertit les valeurs de la RPC en nombres (les champs absents valent 0). */
function normaliserStats(data) {
  const brut = (Array.isArray(data) ? data[0] : data) || {};
  const champs = ['ventes_jour', 'nb_ventes_jour', 'ventes_hier', 'encaisse_jour', 'depenses_jour', 'credits_total',
    'nb_clients_credit', 'nb_credits_retard', 'valeur_stock', 'nb_stock_bas', 'dettes_chantiers'];
  const s = {};
  champs.forEach((c) => { s[c] = Number(brut[c]) || 0; });
  s.ventes_7j = Array.isArray(brut.ventes_7j) ? brut.ventes_7j : [];
  s.paiements_jour = brut.paiements_jour && typeof brut.paiements_jour === 'object' ? brut.paiements_jour : {};
  return s;
}

/** « ▲ 12 % vs hier · 23 ventes » avec la couleur adaptée. */
function variationVentes(s) {
  const nb = `${s.nb_ventes_jour} vente${s.nb_ventes_jour > 1 ? 's' : ''}`;
  if (s.ventes_hier <= 0) {
    return { texte: s.nb_ventes_jour ? nb + ' aujourd’hui' : 'Aucune vente pour l’instant', encre: '#5A6B82' };
  }
  const pct = Math.round(((s.ventes_jour - s.ventes_hier) / s.ventes_hier) * 100);
  if (pct >= 0) return { texte: `▲ ${pct} % vs hier · ${nb}`, encre: '#1B6E2A' };
  return { texte: `▼ ${Math.abs(pct)} % vs hier · ${nb}`, encre: '#A51C1C' };
}

function kpiHTML(k) {
  return `
    <div class="carte kpi">
      <div class="kpi-haut">
        <span class="kpi-libelle">${esc(k.libelle)}</span>
        <span class="kpi-icone" style="background:${k.teinte};color:${k.encre}">${icone(k.icone, 18, 2)}</span>
      </div>
      <span class="kpi-valeur">${formatNombre(k.valeur)} <span>GNF</span></span>
      <span class="kpi-sous" style="color:${k.encreSous}">${esc(k.sous)}</span>
    </div>`;
}

/** Histogramme des 7 derniers jours (jours sans vente complétés à 0). */
function graphiqueHTML(ventes7j) {
  const parJour = new Map(ventes7j.map((d) => [String(d.jour).slice(0, 10), Number(d.total) || 0]));
  const joursSemaine = [];
  for (let i = 6; i >= 0; i--) {
    const iso = dateISO(-i);
    joursSemaine.push({ iso, total: parJour.get(iso) || 0 });
  }
  const max = Math.max(...joursSemaine.map((j) => j.total), 1);
  const total = joursSemaine.reduce((somme, j) => somme + j.total, 0);
  const libelleJour = (iso) => capitaliser(formatDate(iso + 'T12:00:00Z', 'jourCourt').replace('.', ''));
  const description = joursSemaine.map((j) => `${formatDate(j.iso + 'T12:00:00Z', 'long')} : ${formatGNF(j.total)}`).join(', ');

  return `
    <div class="bloc-entete">
      <div class="bloc-titres">
        <h2>Ventes des 7 derniers jours</h2>
        <span>Total : ${formatGNF(total)}</span>
      </div>
      ${selecteurPeriode()}
    </div>
    <div class="histogramme" role="img" aria-label="${esc('Histogramme des ventes. ' + description)}">
      ${joursSemaine.map((j, i) => `
        <div class="histo-colonne">
          <span class="histo-valeur">${formatMillions(j.total)}</span>
          <div class="histo-barre ${i === joursSemaine.length - 1 ? 'aujourdhui' : ''}" style="height:${j.total > 0 ? Math.max(4, Math.round((j.total / max) * HAUTEUR_MAX_BARRE)) : 2}px"></div>
        </div>`).join('')}
    </div>
    <div class="histo-jours">${joursSemaine.map((j) => `<span>${esc(libelleJour(j.iso))}</span>`).join('')}</div>
    ${total === 0 ? '<p class="note-centree">Vos ventes apparaîtront ici dès votre première vente.</p>' : ''}`;
}

/** Barre empilée + légende des modes de paiement du jour. */
function paiementsHTML(paiements) {
  const lignes = ORDRE_MODES.map((mode) => ({ mode, montant: Number(paiements[mode]) || 0 }));
  const total = lignes.reduce((s, l) => s + l.montant, 0);
  lignes.forEach((l) => { l.pct = total ? Math.round((l.montant / total) * 100) : 0; });
  const description = lignes.map((l) => `${MODES_PAIEMENT[l.mode].court} ${l.pct} %`).join(', ');

  return `
    <div class="bloc-titres">
      <h2>Modes de paiement</h2>
      <span>Aujourd’hui · ${formatGNF(total)}</span>
    </div>
    <div class="barre-empilee" role="img" aria-label="${esc(total ? 'Répartition : ' + description : 'Aucun paiement aujourd’hui')}">
      ${total ? lignes.filter((l) => l.montant > 0).map((l) => `<div style="width:${(l.montant / total) * 100}%;background:${MODES_PAIEMENT[l.mode].couleur}"></div>`).join('') : ''}
    </div>
    <div class="legende-paiements">
      ${lignes.map((l) => `
        <div class="legende-ligne">
          <span class="legende-pastille" style="background:${MODES_PAIEMENT[l.mode].couleur}"></span>
          <span class="legende-libelle">${esc(MODES_PAIEMENT[l.mode].court)}</span>
          <span class="legende-montant">${formatNombre(l.montant)}</span>
          <span class="legende-pct">${l.pct} %</span>
        </div>`).join('')}
    </div>`;
}

/* ------------------------------------------------------------ Stock bas */

async function chargerStockBas(idBoutique, zone) {
  const { data, error } = await sb
    .from('produits')
    .select('id, nom, unite, stock, seuil_alerte, sur_commande')
    .eq('boutique_id', idBoutique)
    .eq('actif', true);
  if (error) { console.error(error); zone.innerHTML = erreurBloc(); return; }

  if (!data.length) {
    zone.innerHTML = etatVide('Ajoutez vos articles pour suivre votre stock et être prévenu avant la rupture.',
      { href: '#/stock?ajouter=1', libelle: 'Ajouter mes premiers articles' });
    return;
  }
  const ratio = (p) => (Number(p.seuil_alerte) > 0 ? Number(p.stock) / Number(p.seuil_alerte) : 0);
  const bas = data
    .filter((p) => !p.sur_commande && Number(p.stock) <= Number(p.seuil_alerte))
    .sort((a, b) => ratio(a) - ratio(b))
    .slice(0, 5);
  if (!bas.length) {
    zone.innerHTML = etatVide('Aucun article sous le seuil d’alerte. Votre stock est en bonne santé !');
    return;
  }
  zone.innerHTML = bas.map((p) => {
    const r = ratio(p);
    const critique = r <= 0.5;
    return `
      <div class="ligne-stock-bas">
        <div class="ligne-stock-bas-haut">
          <span class="ligne-nom">${esc(p.nom)}</span>
          <span class="ligne-qte seul-ordi" style="color:${critique ? '#C62828' : '#B26A00'}">${esc(formatQuantite(p.stock, p.unite))}</span>
          <span class="pastille-stock seul-mobile ${critique ? 'bas' : 'moyen'}">${esc(formatQuantite(p.stock, p.unite))}</span>
        </div>
        <div class="jauge seul-ordi"><div style="width:${Math.min(100, Math.round(r * 100))}%;background:${critique ? '#C62828' : '#B26A00'}"></div></div>
        <span class="ligne-sous seul-ordi">Seuil d’alerte : ${esc(formatQuantite(p.seuil_alerte, p.unite))}</span>
      </div>`;
  }).join('');
}

/* ------------------------------------------------------------ Crédits à relancer */

/** Petite ligne « SMS : X restants » sous l'en-tête (gérant / propriétaire). */
async function afficherSoldeSms(zone) {
  try {
    const solde = await chargerSoldeSms();
    if (!zone?.isConnected) return;
    zone.innerHTML = `${icone('sms', 14, 2)} SMS : <strong>${formatNombre(solde)}</strong> restant${solde > 1 ? 's' : ''} · <a href="#/messages">Messages</a>`;
    zone.classList.toggle('bas', solde < 20);
  } catch (err) {
    console.warn('[YOUMMA] Solde SMS indisponible :', err);
  }
}

/** Couleur du texte d'échéance selon le statut de crédit (couleurs de la maquette). */
const ENCRES_ECHEANCE = { retard: '#B23A0E', bientot: '#8A5A00', ok: '#5A6B82', aucun: '#5A6B82' };

/** Les 5 plus gros soldes, avec la même règle d'échéance que la page Clients & crédits. */
async function chargerCredits(situationPromesse, zone) {
  const situation = await situationPromesse;
  if (!situation) { zone.innerHTML = erreurBloc(); return; }
  const clients = situation.clients
    .filter((c) => c.solde_credit > 0)
    .sort((a, b) => b.solde_credit - a.solde_credit)
    .slice(0, 5);
  if (!clients.length) {
    zone.innerHTML = etatVide('Aucun crédit en cours. Les ventes à crédit apparaîtront ici pour être relancées.');
    return;
  }
  clientsARelancer.clear();
  clients.forEach((c) => clientsARelancer.set(c.id, c));
  zone.innerHTML = clients.map((c) => {
    const encre = ENCRES_ECHEANCE[c.statut.code];
    return `
      <div class="ligne-credit">
        <a class="ligne-credit-lien" href="#/clients/${encodeURIComponent(c.id)}" aria-label="Fiche de ${esc(c.nom)}">
          <span class="avatar">${esc(initiales(c.nom))}</span>
          <span class="ligne-credit-textes">
            <span class="ligne-nom">${esc(c.nom)}</span>
            <span class="ligne-sous seul-ordi" style="color:${encre}">${esc(texteEcheance(c, 'long'))}</span>
            <span class="ligne-sous seul-mobile" style="color:${encre}">${formatNombre(c.solde_credit)} GNF · ${esc(texteEcheance(c, 'court'))}</span>
          </span>
        </a>
        <span class="ligne-montant seul-ordi">${formatGNF(c.solde_credit)}</span>
        ${boutonsRelanceHTML(c, c.solde_credit)}
      </div>`;
  }).join('');
}

/* ------------------------------------------------------------ Dernières ventes */

async function chargerDernieresVentes(idBoutique, zone) {
  const { data: ventes, error } = await sb
    .from('ventes')
    .select('id, numero, created_at, client_id, vendeur_id, mode_paiement, total')
    .eq('boutique_id', idBoutique)
    .eq('statut', 'validee')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) { console.error(error); zone.innerHTML = erreurBloc(); return; }
  if (!ventes.length) {
    zone.innerHTML = etatVide('Aucune vente pour l’instant. Votre première vente se fait en quelques secondes depuis la caisse.',
      { href: '#/caisse', libelle: 'Faire ma première vente' });
    return;
  }

  const idsClients = [...new Set(ventes.map((v) => v.client_id).filter(Boolean))];
  const [lignes, clients, membres] = await Promise.all([
    sb.from('ventes_lignes').select('vente_id, nom_produit, quantite').in('vente_id', ventes.map((v) => v.id)),
    idsClients.length ? sb.from('clients').select('id, nom').in('id', idsClients) : Promise.resolve({ data: [] }),
    sb.from('membres').select('id, user_id, nom').eq('boutique_id', idBoutique)
  ]);

  const nomsClients = new Map((clients.data || []).map((c) => [c.id, c.nom]));
  const nomsVendeurs = new Map();
  (membres.data || []).forEach((m) => {
    nomsVendeurs.set(m.id, prenom(m.nom));
    nomsVendeurs.set(m.user_id, prenom(m.nom));
  });
  const articles = new Map();
  (lignes.data || []).forEach((l) => {
    if (!articles.has(l.vente_id)) articles.set(l.vente_id, []);
    articles.get(l.vente_id).push(`${l.nom_produit} ×${formatNombre(l.quantite, 3)}`);
  });

  const lignesVentes = ventes.map((v) => {
    const liste = articles.get(v.id) || [];
    return {
      id: v.id,
      numero: formatNumeroVente(v.numero),
      heure: formatDate(v.created_at, 'heure'),
      client: nomsClients.get(v.client_id) || 'Client comptoir',
      articles: liste.slice(0, 2).join(', ') + (liste.length > 2 ? ` +${liste.length - 2}` : ''),
      mode: MODES_PAIEMENT[v.mode_paiement] || MODES_PAIEMENT.especes,
      vendeur: nomsVendeurs.get(v.vendeur_id) || '—',
      total: v.total
    };
  });

  zone.innerHTML = `
    <div class="tableau-cadre seul-ordi">
      <table class="tableau">
        <thead>
          <tr><th>N° vente</th><th>Heure</th><th>Client</th><th>Articles</th><th>Paiement</th><th>Vendeur</th><th class="droite">Montant</th></tr>
        </thead>
        <tbody>
          ${lignesVentes.map((v) => `
            <tr class="ligne-cliquable" data-vente="${esc(v.id)}">
              <td class="gras"><a class="lien-vente" href="#/ventes/${encodeURIComponent(v.id)}">${esc(v.numero)}</a></td>
              <td class="discret">${esc(v.heure)}</td>
              <td class="mi-gras">${esc(v.client)}</td>
              <td class="secondaire">${esc(v.articles)}</td>
              <td>${badgePaiement(v.mode)}</td>
              <td class="secondaire">${esc(v.vendeur)}</td>
              <td class="droite tres-gras">${formatGNF(v.total)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <ul class="liste-ventes-mobile seul-mobile">
      ${lignesVentes.map((v) => `
        <li>
          <a class="vente-mobile" href="#/ventes/${encodeURIComponent(v.id)}">
          <div class="vente-mobile-haut">
            <span class="gras">${esc(v.numero)} · ${esc(v.heure)}</span>
            <span class="tres-gras">${formatGNF(v.total)}</span>
          </div>
          <span class="ligne-sous">${esc(v.client)} · ${esc(v.articles)}</span>
          <div class="vente-mobile-bas">${badgePaiement(v.mode)}<span class="ligne-sous">${esc(v.vendeur)}</span></div>
          </a>
        </li>`).join('')}
    </ul>`;
}

function badgePaiement(mode) {
  return `<span class="badge-paiement" style="background:${mode.fond};color:${mode.encre}">${esc(mode.court)}</span>`;
}
