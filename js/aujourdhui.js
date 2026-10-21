/**
 * aujourdhui.js — Écran « Aujourd'hui » (étape 14, maquettes DashV2 et DashV2Mobile).
 *
 * Un seul appel pour les chiffres : stats_aujourdhui(p_boutique) →
 *   { patron, ventes_jour, nb_ventes_jour, ventes_hier, especes_attendues, depenses_jour, a_encaisser, credits_total,
 *     dettes_chantiers, benefice_jour, benefice_semaine, ventes_7j: [{ jour, total }], paiements_7j: { mode: montant },
 *     a_faire: { commandes, devis, livraisons, stock_bas, retards, affiche } }
 * benefice_* : null pour un vendeur (seul le propriétaire les reçoit) ; une entrée de a_faire vaut null quand
 * son module n'est pas actif. Les dernières ventes sont lues à part (comme avant).
 */
import { sb } from './supabase.js';
import { etat, estGerant, estProprietaire, utilisateur } from './state.js';
import { naviguer } from './router.js';
import { aModule, moduleVisible } from './modules.js';
import {
  esc, icone, capitaliser, initiales, formatNombre, formatGNF, formatMillions, formatDate, formatNumeroVente, dateISO, MODES_PAIEMENT
} from './utils.js';

const JOURS_COURTS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const n = (v) => Number(v) || 0;
const gnf = (v) => `${formatNombre(v)}<span class="auj-unite">GNF</span>`;

/** Courbe des 7 jours (petit trait sous les ventes du jour). */
function courbe(points) {
  if (points.length < 2) return '';
  const max = Math.max(1, ...points.map((p) => p.total));
  const coords = points.map((p, i) => `${((i / (points.length - 1)) * 104).toFixed(1)},${(26 - (p.total / max) * 22).toFixed(1)}`).join(' ');
  return `<svg class="auj-courbe" width="104" height="28" viewBox="0 0 104 28" fill="none" aria-hidden="true"><polyline points="${coords}" stroke="#0F7B5F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/></svg>`;
}

/** Les 7 derniers jours, complétés à 0 (du plus ancien à aujourd'hui). */
function septJours(ventes7j) {
  const parJour = new Map((ventes7j || []).map((d) => [String(d.jour).slice(0, 10), n(d.total)]));
  return Array.from({ length: 7 }, (_, i) => {
    const jour = dateISO(i - 6);
    return { jour, total: parJour.get(jour) || 0 };
  });
}

export function afficherAujourdhui(conteneur) {
  const boutique = etat.boutique;
  const vendeur = !estGerant();
  const date = capitaliser(formatDate(new Date(), 'long'));
  conteneur.innerHTML = `
    <div class="page page-aujourdhui">
      <header class="auj-entete seul-ordi">
        <div class="auj-titres"><h1>Aujourd’hui</h1><span>${esc(date)} · ${esc([boutique.nom, boutique.ville].filter(Boolean).join(', '))}</span></div>
        <label class="auj-recherche"><span class="sr-only">Rechercher un article</span>${icone('recherche', 15, 2)}
          <input type="search" placeholder="Rechercher un article…" autocomplete="off" data-ref="recherche"></label>
        <a class="btn btn-primaire auj-nouvelle-vente" href="#/caisse?vendre=1">${icone('plus', 15, 2.6)} Nouvelle vente</a>
        <span class="auj-avatar" title="${esc(etat.membre?.nom || '')}">${esc(initiales(etat.membre?.nom || boutique.nom))}</span>
      </header>
      <section class="auj-hero seul-mobile" data-zone="hero" aria-label="Ventes du jour">
        <span class="auj-hero-libelle">Ventes du jour</span>
        <div class="auj-hero-ligne"><strong class="auj-hero-montant"><span class="squelette" style="height:34px;width:120px;opacity:.3"></span></strong></div>
      </section>
      <div class="auj-corps">
        <section class="auj-kpis" data-zone="kpis" aria-label="Chiffres du jour">${'<div class="carte auj-kpi"><span class="squelette" style="height:12px;width:60%"></span><span class="squelette" style="height:26px;width:70%"></span></div>'.repeat(4)}</section>
        <div class="auj-grille">
          <div class="auj-gauche">
            <section class="carte auj-graphique" data-zone="graphique"><span class="squelette" style="height:190px"></span></section>
            <section class="carte auj-ventes" data-zone="ventes" aria-label="Dernières ventes"><span class="squelette" style="height:180px"></span></section>
          </div>
          <div class="auj-droite">
            <section class="carte auj-afaire" data-zone="afaire" aria-label="À faire aujourd'hui"><span class="squelette" style="height:160px"></span></section>
            <section class="carte auj-affiche" data-zone="affiche" hidden></section>
            <section class="carte auj-paiements" data-zone="paiements" aria-label="Modes de paiement"></section>
          </div>
        </div>
      </div>
    </div>`;
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);

  conteneur.querySelector('[data-ref="recherche"]').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) naviguer(`stock?q=${encodeURIComponent(e.target.value.trim())}`);
  });

  /* ---------------- Chiffres */

  function carte({ libelle, valeur, sous, encre = '', patron = false, extra = '', classe = '' }) {
    return `
      <div class="carte auj-kpi ${classe}">
        <span class="auj-etiquette-ligne"><span class="auj-etiquette">${esc(libelle)}</span>${patron ? '<span class="auj-patron">PATRON</span>' : ''}</span>
        <div class="auj-kpi-valeur"><strong class="auj-nombre">${valeur}</strong>${extra}</div>
        <span class="auj-kpi-sous ${encre}">${esc(sous)}</span>
      </div>`;
  }

  function renderKpis(s, mesVentes) {
    const jours = septJours(s.ventes_7j);
    const especes = n(s.especes_attendues);
    const depenses = n(s.depenses_jour);
    const parts = [];
    if (moduleVisible('credits') && n(s.credits_total)) parts.push(`crédits ${formatMillions(s.credits_total)}`);
    if (moduleVisible('chantiers') && n(s.dettes_chantiers)) parts.push(`chantiers ${formatMillions(s.dettes_chantiers)}`);
    const sousEncaisser = parts.length ? capitaliser(parts.join(' · ')) : moduleVisible('chantiers') ? 'Aucun crédit, aucune dette chantier' : 'Aucun crédit en cours';
    const cartes = [
      carte({ libelle: 'Ventes du jour', valeur: gnf(s.ventes_jour), extra: courbe(jours), sous: `Hier : ${formatGNF(s.ventes_hier)}`, classe: 'auj-kpi-ventes' }),
      carte({ libelle: 'Espèces attendues en caisse', valeur: gnf(especes),
        sous: especes <= 0 ? 'Rien à remettre ce soir' : depenses ? `À remettre ce soir, après vos dépenses du jour (${formatGNF(depenses)})` : 'À remettre ce soir' }),
      carte({ libelle: 'À encaisser', valeur: gnf(s.a_encaisser), sous: sousEncaisser })
    ];
    if (s.patron && s.benefice_jour !== null && s.benefice_jour !== undefined) {
      const semaine = n(s.benefice_semaine);
      cartes.push(carte({ libelle: 'Bénéfice du jour', patron: true, valeur: gnf(s.benefice_jour),
        sous: s.benefice_semaine === null || s.benefice_semaine === undefined ? 'Ventes moins coût des marchandises' : `Semaine : ${semaine >= 0 ? '+' : '−'}${formatGNF(Math.abs(semaine))}`,
        encre: semaine < 0 ? 'texte-danger' : 'texte-succes' }));
    } else {
      cartes.push(carte({ libelle: 'Mes ventes du jour', valeur: gnf(mesVentes.total), sous: mesVentes.nb ? `${mesVentes.nb} vente${mesVentes.nb > 1 ? 's' : ''} encaissée${mesVentes.nb > 1 ? 's' : ''}` : 'Aucune vente pour l’instant' }));
    }
    // Téléphone : les ventes du jour sont dans l'en-tête vert ; une 4ᵉ petite carte « Dépenses du jour ».
    cartes.push(carte({ libelle: 'Dépenses du jour', valeur: gnf(depenses), sous: depenses ? 'Saisies aujourd’hui' : 'Aucune dépense', classe: 'auj-kpi-depenses' }));
    zone('kpis').innerHTML = cartes.join('');
    zone('hero').innerHTML = `
      <span class="auj-hero-libelle">Ventes du jour</span>
      <div class="auj-hero-ligne"><strong class="auj-hero-montant auj-nombre">${formatNombre(s.ventes_jour)}</strong><span class="auj-hero-gnf">GNF</span>
        <span class="auj-hero-hier">Hier ${formatNombre(s.ventes_hier)}</span></div>`;
  }

  /* ---------------- À faire */

  function renderAFaire(a = {}) {
    const lignes = [];
    const ligne = (couleur, ic, titre, sous, action, href) => `
      <a class="auj-tache" href="${href}">
        <span class="auj-tache-icone ${couleur}">${icone(ic, 17, 1.7)}</span>
        <span class="auj-tache-textes"><strong>${esc(titre)}</strong>${sous ? `<span>${esc(sous)}</span>` : ''}</span>
        <span class="auj-tache-action">${esc(action)} ›</span>
      </a>`;
    const c = a.commandes;
    if (c && n(c.nb)) lignes.push(ligne('ambre', 'enLigne', `${c.nb} commande${c.nb > 1 ? 's' : ''} en ligne`, [c.dernier, n(c.total) ? formatGNF(c.total) : ''].filter(Boolean).join(' · '), 'Traiter', '#/boutique-en-ligne?onglet=commandes'));
    const d = a.devis;
    if (d && n(d.nb)) lignes.push(ligne('vert', 'document', `${d.nb} devis en attente`, [n(d.total) ? `${formatMillions(d.total)} GNF` : '', n(d.jours) ? `le plus ancien : ${d.jours} j` : ''].filter(Boolean).join(' · '), 'Relancer', '#/proformas'));
    const l = a.livraisons;
    if (l && n(l.nb)) lignes.push(ligne('bleu', 'camion', `${l.nb} livraison${l.nb > 1 ? 's' : ''} à faire partir`, l.prochaine || '', 'Faire partir', '#/ventes?onglet=livraisons'));
    const sb2 = a.stock_bas;
    if (sb2 && n(sb2.nb)) lignes.push(ligne('rouge', 'stock', `${sb2.nb} article${sb2.nb > 1 ? 's' : ''} à commander`, sb2.noms || '', 'Voir', '#/stock?filtre=bas'));
    const r = a.retards;
    if (r && n(r.nb)) lignes.push(ligne('rouge', 'client', `${r.nb} crédit${r.nb > 1 ? 's' : ''} en retard`, n(r.total) ? formatGNF(r.total) : '', 'Relancer', '#/clients'));
    const af = a.affiche;
    if (af && aModule('affiche')) lignes.push(ligne('vert', 'image', 'Affiche du jour prête', [af.produit, n(af.prix) ? formatGNF(af.prix) : ''].filter(Boolean).join(' · '), 'Publier', '#/boutique-en-ligne?onglet=affiche'));
    zone('afaire').innerHTML = `
      <div class="auj-carte-entete"><h2>À faire aujourd’hui</h2>${lignes.length ? `<span class="auj-compteur">${lignes.length}</span>` : ''}</div>
      ${lignes.length ? lignes.join('') : `
        <div class="auj-rien">${icone('valide', 22, 2.2)}<p>Tout est à jour. Bonne journée !</p>
          <a class="btn btn-secondaire" href="#/caisse?vendre=1">${icone('plus', 15, 2.6)} Nouvelle vente</a></div>`}`;
  }

  /* ---------------- Graphique 7 jours */

  function renderGraphique(ventes7j) {
    const jours = septJours(ventes7j);
    const total = jours.reduce((t, j) => t + j.total, 0);
    const max = Math.max(1, ...jours.map((j) => j.total));
    const aujourdhui = dateISO();
    zone('graphique').innerHTML = `
      <div class="auj-carte-entete"><div><h2>Ventes des 7 derniers jours</h2>
        <span class="auj-sous-titre">Total ${formatGNF(total)} · moyenne ${formatNombre(Math.round(total / 7))}/jour</span></div></div>
      <div class="auj-barres" role="img" aria-label="${esc(jours.map((j) => `${formatDate(`${j.jour}T12:00:00Z`, 'court')} : ${formatGNF(j.total)}`).join(' ; '))}">
        ${jours.map((j) => {
          const jourSemaine = JOURS_COURTS[new Date(`${j.jour}T12:00:00Z`).getUTCDay()];
          const h = j.total ? Math.max(6, Math.round((j.total / max) * 128)) : 5;
          return `<div class="auj-barre-col">
            <span class="auj-barre-valeur ${j.total ? '' : 'vide'}">${j.total ? esc(formatMillions(j.total)) : '—'}</span>
            <span class="auj-barre ${j.total ? '' : 'vide'}" style="height:${h}px"></span>
            <span class="auj-barre-jour ${j.jour === aujourdhui ? 'actif' : ''}">${jourSemaine}</span></div>`;
        }).join('')}
      </div>`;
  }

  /* ---------------- Modes de paiement (7 jours) */

  function renderPaiements(p = {}) {
    const modes = Object.keys(MODES_PAIEMENT).filter((m) => n(p[m]) > 0 || ['especes', 'orange_money', 'mtn_momo'].includes(m)
      || (m === 'credit' && moduleVisible('credits')) || (m === 'chantier' && moduleVisible('chantiers')));
    const total = modes.reduce((t, m) => t + n(p[m]), 0);
    zone('paiements').innerHTML = `
      <div class="auj-carte-entete"><h2>Modes de paiement</h2><span class="auj-sous-titre">7 jours</span></div>
      <span class="auj-empile">${total ? modes.filter((m) => n(p[m])).map((m) => `<span style="width:${(n(p[m]) / total) * 100}%;background:${MODES_PAIEMENT[m].couleur}"></span>`).join('') : ''}</span>
      <div class="auj-modes">${modes.map((m) => `
        <div class="auj-mode ${n(p[m]) ? '' : 'nul'}"><span class="auj-mode-pastille" style="background:${MODES_PAIEMENT[m].couleur}"></span>
          <span class="auj-mode-nom">${esc(MODES_PAIEMENT[m].court)}</span><strong class="auj-nombre">${formatNombre(n(p[m]))}</strong>
          <span class="auj-mode-pct">${total && n(p[m]) ? `${Math.round((n(p[m]) / total) * 100)} %` : ''}</span></div>`).join('')}</div>`;
  }

  /* ---------------- Affiche du jour */

  function renderAffiche(af) {
    const z = zone('affiche');
    if (!af || !aModule('affiche')) { z.hidden = true; return; }
    z.hidden = false;
    z.innerHTML = `
      <div class="auj-affiche-corps">
        <span class="auj-affiche-vignette" aria-hidden="true"><span>${esc(formatNombre(af.prix))}</span></span>
        <div class="auj-affiche-textes"><span class="auj-etiquette">Affiche du jour</span>
          <strong>${esc([af.produit, n(af.prix) ? formatGNF(af.prix) : ''].filter(Boolean).join(' · '))}</strong>
          <span class="auj-sous-titre">Prête pour WhatsApp et Facebook.</span>
          <div class="auj-affiche-boutons"><a class="btn btn-whatsapp btn-petit" href="#/boutique-en-ligne?onglet=affiche">Publier</a>
            <a class="btn btn-secondaire btn-petit" href="#/boutique-en-ligne?onglet=affiche">Changer</a></div></div>
      </div>`;
  }

  /* ---------------- Dernières ventes (le vendeur voit les siennes) */

  async function chargerVentes() {
    const uid = utilisateur()?.id;
    let requete = sb.from('ventes').select('id, numero, created_at, client_id, vendeur_id, mode_paiement, total')
      .eq('boutique_id', boutique.id).eq('statut', 'validee').order('created_at', { ascending: false }).limit(6);
    if (vendeur && uid) requete = requete.eq('vendeur_id', uid);
    const { data: ventes, error } = await requete;
    const z = zone('ventes');
    if (!z?.isConnected) return [];
    if (error) { z.innerHTML = '<p class="bloc-erreur">Impossible de charger les dernières ventes.</p>'; return []; }
    const idsClients = [...new Set(ventes.map((v) => v.client_id).filter(Boolean))];
    const [lignes, clients] = await Promise.all([
      ventes.length ? sb.from('ventes_lignes').select('vente_id, nom_produit, quantite').in('vente_id', ventes.map((v) => v.id)) : Promise.resolve({ data: [] }),
      idsClients.length ? sb.from('clients').select('id, nom').in('id', idsClients) : Promise.resolve({ data: [] })
    ]);
    const noms = new Map((clients.data || []).map((c) => [c.id, c.nom]));
    const articles = new Map();
    (lignes.data || []).forEach((l) => { if (!articles.has(l.vente_id)) articles.set(l.vente_id, []); articles.get(l.vente_id).push(`${l.nom_produit} ×${formatNombre(l.quantite, 3)}`); });
    const liste = ventes.map((v) => {
      const a = articles.get(v.id) || [];
      return { ...v, client: noms.get(v.client_id) || 'Client comptoir', articles: a.slice(0, 2).join(', '), plus: Math.max(0, a.length - 2), mode: MODES_PAIEMENT[v.mode_paiement] || MODES_PAIEMENT.especes };
    });
    z.innerHTML = `
      <div class="auj-carte-entete auj-entete-tableau"><h2>${vendeur ? 'Mes dernières ventes' : 'Dernières ventes'}</h2><a class="auj-lien" href="#/ventes">Historique complet ›</a></div>
      ${!liste.length ? `<div class="auj-rien"><p>Aucune vente pour l’instant.</p><a class="btn btn-secondaire" href="#/caisse?vendre=1">Faire une vente</a></div>` : `
      <div class="tableau-cadre seul-ordi"><table class="auj-tableau">
        <thead><tr><th>Vente</th><th>Client</th><th>Articles</th><th>Paiement</th><th class="droite">Montant</th></tr></thead>
        <tbody>${liste.map((v) => `<tr>
          <td><a class="gras auj-nombre" href="#/ventes/${encodeURIComponent(v.id)}">${esc(formatNumeroVente(v.numero))}</a><span class="auj-heure">${esc(formatDate(v.created_at, 'heure'))}</span></td>
          <td class="gras">${esc(v.client)}</td>
          <td class="auj-articles">${esc(v.articles)}${v.plus ? `<span class="auj-plus">+${v.plus}</span>` : ''}</td>
          <td><span class="auj-paiement"><span style="background:${v.mode.couleur}"></span>${esc(v.mode.court)}</span></td>
          <td class="droite"><strong class="auj-nombre">${formatNombre(v.total)}</strong><span class="auj-unite">GNF</span></td></tr>`).join('')}</tbody>
      </table></div>
      <ul class="auj-liste-ventes seul-mobile">${liste.map((v) => `
        <li><a href="#/ventes/${encodeURIComponent(v.id)}">
          <span class="auj-vente-heure">${esc(formatDate(v.created_at, 'heure').replace(/:.*/, 'h'))}</span>
          <span class="auj-tache-textes"><strong>${esc(v.client)}</strong><span>${esc(v.articles)}${v.plus ? ` +${v.plus}` : ''}</span></span>
          <span class="auj-vente-montant"><strong class="auj-nombre">${formatNombre(v.total)}</strong><span>${esc(v.mode.court)}</span></span></a></li>`).join('')}</ul>`}`;
    return ventes;
  }

  /** Vendeur : total et nombre de ses ventes du jour (carte « Mes ventes du jour »). */
  async function mesVentesDuJour() {
    const uid = utilisateur()?.id;
    if (!uid) return { total: 0, nb: 0 };
    const { data } = await sb.from('ventes').select('total').eq('boutique_id', boutique.id).eq('vendeur_id', uid).eq('statut', 'validee').gte('created_at', `${dateISO()}T00:00:00`);
    return { total: (data || []).reduce((t, v) => t + n(v.total), 0), nb: (data || []).length };
  }

  (async () => {
    const [res, mes] = await Promise.all([
      sb.rpc('stats_aujourdhui', { p_boutique: boutique.id }),
      !estProprietaire() ? mesVentesDuJour() : Promise.resolve({ total: 0, nb: 0 }),
      chargerVentes()
    ]);
    if (!conteneur.isConnected) return;
    if (res.error) {
      zone('kpis').innerHTML = '<p class="bloc-erreur">Impossible de charger les chiffres du jour. Vérifiez votre connexion.</p>';
      ['graphique', 'afaire'].forEach((z) => { zone(z).innerHTML = ''; });
      return;
    }
    const s = (Array.isArray(res.data) ? res.data[0] : res.data) || {};
    renderKpis(s, mes);
    renderAFaire(s.a_faire || {});
    renderGraphique(s.ventes_7j);
    renderPaiements(s.paiements_7j || {});
    renderAffiche(s.a_faire?.affiche);
  })();
}
