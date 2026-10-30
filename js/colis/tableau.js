/**
 * colis/tableau.js — Accueil de l'activité « logistique » (étape 16, maquette ColisTableau), #/colis.
 *
 * La recherche d'abord (un client appelle, on tape son nom, on lit son statut) → mes_colis(p_recherche).
 * Quatre chiffres (tableau_colis.resume et encaisse_jour) : en attente au départ, en route, à retirer, encaissé
 * aujourd'hui (une ligne par monnaie, jamais additionnées). Derniers colis (Tous · Au départ · À retirer · Problème),
 * envois en cours, taux du jour, bureaux.
 */
import { esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, differer, formatNombre, formatDate, lireNombre } from '../utils.js';
import { api, chargerAgences, montant, nomDevise, pastilleStatut, iconeColis, MODES, poids as poidsTexte, drapeauHTML } from './commun.js';

/** Taux XOF → GNF parmi tableau_colis.taux (le premier sinon). */
const tauxPrincipal = (liste) => liste.find((x) => x.de === 'XOF' && x.vers === 'GNF') || liste[0] || null;

export function afficherColisTableau(conteneur, params) {
  // #/colis?filtre=a_peser (depuis « À faire aujourd'hui »), #/colis?q=… (recherche de l'accueil du transit).
  const s = { tableau: null, agences: [], onglet: params?.get('filtre') || 'tous', recherche: params?.get('q') || '', jeton: 0 };
  conteneur.innerHTML = `
    <div class="page page-colis">
      <header class="col-entete">
        <div class="col-entete-titres"><h1>Colis</h1><span class="discret" data-ref="sous-titre"></span></div>
        <label class="col-recherche"><span class="sr-only">Rechercher un colis</span>${icone('recherche', 17, 2)}
          <input type="search" data-ref="recherche" placeholder="Numéro de colis, nom, téléphone…" autocomplete="off" enterkeyhint="search"></label>
        <a class="btn btn-primaire col-nouveau" href="#/nouveau-colis">${icone('plus', 16, 2.6)} Nouveau colis</a>
      </header>
      <section class="col-kpis" data-zone="kpis">${'<div class="carte col-kpi"><span class="squelette" style="height:60px"></span></div>'.repeat(4)}</section>
      <div class="col-grille">
        <section class="carte col-derniers">
          <div class="col-carte-entete"><h2 data-ref="titre-liste">Derniers colis</h2>
            <nav class="col-onglets" data-zone="onglets" aria-label="Filtre"></nav></div>
          <div data-zone="liste"><span class="squelette" style="height:240px"></span></div>
        </section>
        <aside class="col-cote">
          <section class="carte col-envois" data-zone="envois"></section>
          <section class="carte col-taux" data-zone="taux"></section>
          <section class="carte col-bureaux" data-zone="bureaux"></section>
        </aside>
      </div>
    </div>`;
  const zone = (n) => conteneur.querySelector(`[data-zone="${n}"]`);
  const ref = (n) => conteneur.querySelector(`[data-ref="${n}"]`);
  ref('recherche').value = s.recherche;
  ref('recherche').focus({ preventScroll: true });

  /* ---------------- Chiffres */

  function renderKpis() {
    const r = s.tableau.resume;
    const dep = s.agences.find((a) => a.devise === 'XOF') || s.agences[0];
    const arr = s.agences.find((a) => a.id !== dep?.id);
    const envoisRoute = s.tableau.envois.filter((e) => e.statut === 'en_route');
    // Ville d'une monnaie : le bureau qui encaisse dans cette monnaie (FCFA à Dakar, GNF à Conakry).
    const villeDe = (devise) => s.tableau.agences.find((a) => a.devise === devise)?.ville;
    const kpi = (libelle, valeur, unite, sous, classeSous = '') => `
      <div class="carte col-kpi"><span class="etiquette-carte">${esc(libelle)}</span>
        <div class="col-kpi-valeur"><strong class="nombre-gros">${valeur}</strong><span>${esc(unite)}</span></div>
        <span class="col-kpi-sous ${classeSous}">${sous}</span></div>`;
    zone('kpis').innerHTML = [
      kpi(`En attente à ${dep?.ville || 'au départ'}`, formatNombre(r.attente), 'colis', esc(poidsTexte(r.poids_attente))),
      kpi('En route', formatNombre(r.en_route), 'colis', esc(envoisRoute.map((e) => [e.numero, e.reference].filter(Boolean).join(' · ')).join(' — ') || 'Aucun envoi en route')),
      kpi(`À retirer à ${arr?.ville || 'l’arrivée'}`, formatNombre(r.a_retirer), 'colis', r.dorment ? `dont ${formatNombre(r.dorment)} depuis plus de 7 jours` : 'Aucun colis ne dort', r.dorment ? 'texte-danger' : ''),
      `<div class="carte col-kpi"><span class="etiquette-carte">Encaissé aujourd’hui</span>
        ${s.tableau.encaisse_jour.length ? s.tableau.encaisse_jour.map((e, i) => `<div class="col-kpi-valeur ${i ? 'second' : ''}"><strong class="${i ? '' : 'nombre-gros'}">${i ? '+ ' : ''}${formatNombre(e.montant)}</strong><span>${esc(nomDevise(e.devise))}${villeDe(e.devise) ? ` à ${esc(villeDe(e.devise))}` : ''}</span></div>`).join('')
          : '<div class="col-kpi-valeur"><strong class="nombre-gros">0</strong></div><span class="col-kpi-sous">Rien encaissé pour l’instant</span>'}</div>`
    ].join('');
    ref('sous-titre').textContent = `${s.agences.map((a) => a.ville || a.nom).join(' ⇄ ')}`;
  }

  /* ---------------- Liste */

  const ONGLETS = () => {
    const dep = s.agences.find((a) => a.devise === 'XOF') || s.agences[0];
    return [['tous', 'Tous', null], ['a_peser', 'À peser', 'a_peser'], ['attente', `À ${dep?.ville || 'au départ'}`, 'attente'], ['en_route', 'En route', 'en_route'], ['a_retirer', 'À retirer', 'a_retirer'], ['probleme', 'Problème', 'probleme']];
  };
  function renderOnglets() {
    zone('onglets').innerHTML = ONGLETS().map(([c, l]) => `<button type="button" class="col-onglet ${c === s.onglet && !s.recherche ? 'actif' : ''}" data-onglet="${c}" aria-pressed="${c === s.onglet}">${esc(l)}</button>`).join('');
  }

  /** Ligne de mes_colis : depart et arrivee sont des villes ; dort est vrai au-delà de 7 jours en « à retirer ». */
  function ligne(c) {
    // Montant figé dans le colis : payé (montant au départ) ou à payer à l'arrivée (montant dû, en monnaie d'arrivée).
    // Carton déposé sans pesée : ni poids ni prix tant qu'il n'est pas pesé.
    if (c.statut === 'a_peser') return ligneAPeser(c);
    const affiche = c.paye ? montant(c.montant, c.devise) : montant(c.du_montant, c.du_devise);
    return `<tr data-colis="${esc(c.id)}">
      <td><a class="col-num" href="#/colis/${encodeURIComponent(c.id)}">${esc(c.numero)}</a></td>
      <td><strong>${esc(c.expediteur_nom)}</strong><span class="col-sous">→ ${esc(c.destinataire_nom)}${c.arrivee ? ` · ${esc(c.arrivee)}` : ''}</span></td>
      <td class="droite">${esc(poidsTexte(c.poids).replace(',00', ''))}</td>
      <td class="col-mode-cell">${iconeColis(MODES[c.mode]?.icone || 'colis', 16)} ${esc(MODES[c.mode]?.libelle || c.mode)}</td>
      <td>${pastilleStatut(c.statut)}${c.statut === 'a_retirer' && c.dort ? '<span class="col-dort">dort ici depuis plus de 7 jours</span>' : ''}</td>
      <td class="droite"><strong class="col-chiffre">${esc(affiche)}</strong><span class="col-sous">${c.paye ? 'payé' : 'à l’arrivée'}</span></td>
    </tr>`;
  }

  function ligneAPeser(c) {
    return `<tr data-colis="${esc(c.id)}">
      <td><a class="col-num" href="#/colis/${encodeURIComponent(c.id)}">${esc(c.numero)}</a></td>
      <td><strong>${esc(c.compte ? `${c.compte} · ${c.expediteur_nom}` : c.expediteur_nom)}</strong><span class="col-sous">${c.recu_de ? `déposé par ${esc(c.recu_de)}` : ''}</span></td>
      <td class="droite">—</td>
      <td class="col-mode-cell">—</td>
      <td>${pastilleStatut(c.statut)}</td>
      <td class="droite"><a class="btn btn-primaire btn-petit" href="#/peser/${encodeURIComponent(c.id)}">Peser</a></td>
    </tr>`;
  }

  async function chargerListe() {
    const jeton = ++s.jeton;
    const filtre = ONGLETS().find(([c]) => c === s.onglet)?.[2] || null;
    zone('liste').innerHTML = '<span class="squelette" style="height:200px"></span>';
    let liste;
    try { liste = await api.liste({ filtre: s.recherche ? null : filtre, recherche: s.recherche || null, limite: s.recherche ? 30 : 12 }); } catch (err) {
      if (jeton === s.jeton) zone('liste').innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`;
      return;
    }
    if (jeton !== s.jeton || !conteneur.isConnected) return;
    ref('titre-liste').textContent = s.recherche ? `Résultats pour « ${s.recherche} »` : 'Derniers colis';
    zone('liste').innerHTML = liste.length ? `
      <div class="tableau-cadre"><table class="col-tableau">
        <thead><tr><th>N° suivi</th><th>Expéditeur → destinataire</th><th class="droite">Poids</th><th>Mode</th><th>Où</th><th class="droite">Montant</th></tr></thead>
        <tbody>${liste.map(ligne).join('')}</tbody></table></div>`
      : `<p class="col-vide">${s.recherche ? 'Aucun colis ne correspond. Vérifiez le numéro ou le nom.' : 'Aucun colis ici.'}</p>`;
  }

  /* ---------------- Colonne de droite */

  function renderEnvois() {
    const envois = s.tableau.envois;
    zone('envois').innerHTML = `
      <div class="col-carte-entete"><h2>Envois en cours</h2><a class="col-lien" href="#/envois?nouveau=1">+ Nouvel envoi</a></div>
      ${envois.length ? envois.map((e) => {
        const arrive = e.statut === 'arrive';
        return `<a class="col-envoi" href="#/envois/${encodeURIComponent(e.id)}">
          <span class="col-envoi-icone">${iconeColis(MODES[e.mode]?.icone || 'camion', 18)}</span>
          <span class="col-envoi-textes"><strong>${esc([e.numero, e.reference].filter(Boolean).join(' · '))}</strong>
            <span>${esc(MODES[e.mode]?.libelle || e.mode)} · ${formatNombre(e.colis)} colis · ${esc(poidsTexte(e.poids).replace(',00', ''))}</span></span>
          <span class="col-statut ${arrive ? 'vert' : e.statut === 'en_route' ? 'bleu' : 'gris'}">${arrive ? 'Arrivé' : e.statut === 'en_route' ? 'En route' : 'En préparation'}</span>
          <span class="col-envoi-dates">${e.depart_le ? `Parti le ${esc(formatDate(e.depart_le, 'jourMois'))}` : 'Pas encore parti'}${e.arrivee_prevue ? ` · arrivée prévue ${esc(formatDate(e.arrivee_prevue, 'jourMois'))}` : ''}</span>
        </a>`;
      }).join('') : '<p class="col-vide">Aucun envoi en cours. Groupez les colis en attente dans un camion ou un vol.</p>'}`;
  }

  function renderTaux() {
    const t = tauxPrincipal(s.tableau.taux);
    const jours = t?.maj_le ? Math.floor((Date.now() - new Date(t.maj_le).getTime()) / 864e5) : null;
    zone('taux').innerHTML = `
      <h2>Taux du jour</h2>
      <div class="col-taux-valeur"><strong class="nombre-gros">${t ? esc(String(t.taux).replace('.', ',')) : '—'}</strong><span>${esc(t?.vers || 'GNF')} pour 1 ${esc(nomDevise(t?.de || 'XOF'))}</span></div>
      <p class="discret">${t?.maj_le ? `Modifié le ${esc(formatDate(t.maj_le, 'jourMois'))}. ` : 'Aucun taux enregistré. '}Sert à convertir les colis payés à l’arrivée.</p>
      ${jours !== null && jours > 7 ? `<p class="col-alerte-taux">${icone('alerte', 15, 2)} Le taux n’a pas bougé depuis ${jours} jours.</p>` : ''}
      <button type="button" class="btn btn-secondaire btn-bloc" data-action="taux">Changer le taux</button>`;
  }

  function renderBureaux() {
    zone('bureaux').innerHTML = `<h2>Entrepôts</h2>${s.tableau.agences.map((a) => {
      const depart = a.devise === 'XOF';
      return `<div class="col-bureau"><span class="col-pays" title="${esc(a.code)}">${drapeauHTML(a.drapeau, a.code)}</span><span class="col-bureau-textes"><strong>${esc(a.nom)}</strong><span>${depart ? 'En attente de départ' : 'À retirer'}</span></span><strong class="col-chiffre">${formatNombre(depart ? a.en_attente : a.a_retirer)}</strong></div>`;
    }).join('')}`;
  }

  function changerTaux() {
    const t = tauxPrincipal(s.tableau.taux);
    const { el, fermer } = ouvrirModale({
      titre: 'Changer le taux du jour',
      contenu: `<form class="form-modale" novalidate>
        <div class="champ"><label for="col-taux">GNF pour 1 FCFA</label><input id="col-taux" class="input col-gros" type="text" inputmode="decimal" value="${esc(String(t?.taux ?? '').replace('.', ','))}"></div>
        <p class="discret">Les colis déjà enregistrés gardent le montant écrit sur leur bordereau.</p>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`
    });
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = lireNombre(el.querySelector('#col-taux').value);
      const z = el.querySelector('.erreur-form');
      if (!v || v <= 0) { z.textContent = 'Taux invalide.'; z.hidden = false; return; }
      boutonOccupe(el.querySelector('[type=submit]'), true);
      try { await api.taux(t?.de || 'XOF', t?.vers || 'GNF', v); fermer(); toast('Taux enregistré.', 'succes'); charger(); }
      catch (err) { boutonOccupe(el.querySelector('[type=submit]'), false); z.textContent = messageErreur(err); z.hidden = false; }
    });
  }

  /* ---------------- Chargement et évènements */

  async function charger() {
    try {
      const [agences, tableau] = await Promise.all([chargerAgences(), api.tableau()]);
      if (!conteneur.isConnected) return;
      s.agences = agences;
      s.tableau = tableau;
      renderKpis(); renderOnglets(); renderEnvois(); renderTaux(); renderBureaux();
    } catch (err) {
      zone('kpis').innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`;
    }
    chargerListe();
  }

  const rechercher = differer(() => { renderOnglets(); chargerListe(); }, 300);
  ref('recherche').addEventListener('input', (e) => { s.recherche = e.target.value.trim(); rechercher(); });
  conteneur.addEventListener('click', (e) => {
    const o = e.target.closest('[data-onglet]');
    if (o) { s.onglet = o.dataset.onglet; s.recherche = ''; ref('recherche').value = ''; renderOnglets(); chargerListe(); }
    if (e.target.closest('[data-action="taux"]')) changerTaux();
    const tr = e.target.closest('tr[data-colis]');
    if (tr && !e.target.closest('a')) location.hash = `#/colis/${encodeURIComponent(tr.dataset.colis)}`;
  });
  charger();
}
