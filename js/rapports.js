/**
 * rapports.js — Page Rapports (maquette Rapports.dc.html), gérant / propriétaire uniquement.
 *
 * Une seule requête : la fonction serveur rapport_periode(p_boutique, p_debut, p_fin, p_pas),
 * avec p_debut inclus et p_fin exclu. Export CSV (Excel) et impression A4.
 */
import { sb } from './supabase.js';
import { etat } from './state.js';
import {
  esc, icone, toast, messageErreur, capitaliser, formatNombre, formatGNF, formatMillions, formatQuantite,
  formatDate, dateISO, decalerDate, bornesPeriode, MODES_PAIEMENT
} from './utils.js';

const PERIODES = [
  ['semaine', 'Cette semaine'], ['mois', 'Ce mois'], ['moisDernier', 'Mois dernier'], ['annee', 'Cette année'], ['choix', 'Choisir…']
];
const TITRES_EVOLUTION = { jour: 'Ventes et dépenses par jour', semaine: 'Ventes et dépenses par semaine', mois: 'Ventes et dépenses par mois' };
const TRIS = [['ca', 'Chiffre d’affaires'], ['marge', 'Marge'], ['quantite', 'Quantité']];
const ORDRE_MODES = ['especes', 'orange_money', 'mtn_momo', 'credit', 'chantier'];
const HAUTEUR_BARRE = 160;
const MAX_VALEURS_AFFICHEES = 12;

/** Nombre de jours d'une période (bornes incluses). */
function nombreJours(du, au) {
  return Math.round((Date.parse(au) - Date.parse(du)) / 86400000) + 1;
}

/** Pas automatique : jour jusqu'à 31 jours, semaine jusqu'à 120 jours, sinon mois. */
function pasPour(du, au) {
  const n = nombreJours(du, au);
  if (n <= 31) return 'jour';
  if (n <= 120) return 'semaine';
  return 'mois';
}

/** Libellé d'un point de l'évolution : « 17/10 », « Sem. du 13/10 », « oct. 2026 ». */
function libellePoint(debut, pas) {
  const date = `${String(debut).slice(0, 10)}T12:00:00Z`;
  if (pas === 'semaine') return `Sem. du ${formatDate(date, 'jourMois')}`;
  if (pas === 'mois') return formatDate(date, 'moisCourtAnnee');
  return formatDate(date, 'jourMois');
}

/** Normalise la réponse de rapport_periode (nombres, listes vides par défaut). */
function normaliserRapport(data) {
  const r = (Array.isArray(data) ? data[0] : data) || {};
  const n = (v) => Number(v) || 0;
  return {
    ca: n(r.chiffre_affaires),
    nbVentes: n(r.nb_ventes),
    remises: n(r.remises),
    cout: n(r.cout_marchandises),
    marge: n(r.marge_brute),
    nbSansPrixAchat: n(r.nb_lignes_sans_prix_achat),
    caSansPrixAchat: n(r.ca_sans_prix_achat),
    depenses: n(r.depenses),
    evolution: (r.evolution || []).map((e) => ({ debut: String(e.debut).slice(0, 10), ventes: n(e.ventes), depenses: n(e.depenses) })),
    parVendeur: (r.par_vendeur || []).map((v) => ({ nom: v.nom || '—', total: n(v.total), nb: n(v.nb) })),
    parMode: r.par_mode || {},
    topArticles: (r.top_articles || []).map((a) => ({
      nom: a.nom, unite: a.unite, quantite: n(a.quantite), ca: n(a.ca),
      marge: a.marge === null || a.marge === undefined ? null : n(a.marge)
    })),
    parCategorie: (r.par_categorie_depense || []).map((c) => ({ categorie: c.categorie || 'Autre', total: n(c.total) }))
  };
}

/** Taux en pourcentage, une décimale à la française (« 18,2 % »), ou « — ». */
function taux(part, total) {
  if (!total) return '—';
  return `${String(Math.round((part / total) * 1000) / 10).replace('.', ',')} %`;
}

export function afficherRapports(conteneur) {
  const boutique = etat.boutique;
  const aujourdhui = dateISO();
  const s = { periode: 'mois', du: aujourdhui, au: aujourdhui, rapport: null, tri: 'ca', jeton: 0 };
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);

  function bornes() {
    return s.periode === 'choix' ? { du: s.du, au: s.au } : bornesPeriode(s.periode);
  }

  function libellePeriode() {
    const { du, au } = bornes();
    const titres = {
      semaine: 'Cette semaine',
      mois: capitaliser(formatDate(`${du}T12:00:00Z`, 'moisAnnee')),
      moisDernier: capitaliser(formatDate(`${du}T12:00:00Z`, 'moisAnnee')),
      annee: `Année ${du.slice(0, 4)}`,
      choix: 'Période choisie'
    };
    const format = du.slice(0, 4) === au.slice(0, 4) && s.periode !== 'choix' ? 'jourMois' : 'court';
    return `${titres[s.periode]} · du ${formatDate(`${du}T12:00:00Z`, format)} au ${formatDate(`${au}T12:00:00Z`, format)}`;
  }

  conteneur.innerHTML = `
    <div class="page page-rapports">
      <div class="rapport-impression-entete">
        <strong>${esc(boutique.nom)}</strong> · Rapport · <span data-zone="periode-impression"></span>
      </div>
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour seul-ordi" href="#/tableau-de-bord">← Tableau de bord</a>
          <h1>Rapports</h1>
          <span data-zone="sous-titre"></span>
        </div>
        <div class="rapport-actions">
          <div class="segments segments-cadre" role="group" aria-label="Période">
            ${PERIODES.map(([code, libelle]) => `
              <button type="button" class="segment ${code === s.periode ? 'actif' : ''}" data-periode="${code}" aria-pressed="${code === s.periode}">${esc(libelle)}</button>`).join('')}
          </div>
          <button type="button" class="btn btn-secondaire" data-action="exporter">${icone('telecharger', 18, 2)} Exporter (Excel)</button>
          <button type="button" class="btn btn-secondaire" data-action="imprimer">${icone('imprimante', 18, 2)} Imprimer</button>
        </div>
      </header>
      <div class="dates-perso rapport-actions" data-zone="dates" hidden>
        <div class="champ"><label for="rapport-du">Du</label><input id="rapport-du" class="input" type="date" max="${aujourdhui}" value="${aujourdhui}"></div>
        <div class="champ"><label for="rapport-au">Au</label><input id="rapport-au" class="input" type="date" max="${aujourdhui}" value="${aujourdhui}"></div>
      </div>
      <div data-zone="contenu">
        <div class="squelette" style="height:96px;border-radius:18px"></div>
      </div>
    </div>`;

  /* ---------------- Rendu */

  function renderTout() {
    const r = s.rapport;
    const { du, au } = bornes();
    const pas = pasPour(du, au);
    const net = r.marge - r.depenses;
    zone('contenu').innerHTML = `
      <section class="bandeau-benefice" aria-label="Bénéfice de la période">
        ${[
          ['Ventes', formatNombre(r.ca), ''],
          ['−', '', 'operateur'],
          ['Coût des marchandises', formatNombre(r.cout), ''],
          ['=', '', 'operateur'],
          [`Marge brute (${taux(r.marge, r.ca)})`, formatNombre(r.marge), 'marge'],
          ['− Dépenses', formatNombre(r.depenses), 'depenses'],
          ['Bénéfice net', formatGNF(net), net < 0 ? 'net negatif' : 'net']
        ].map(([libelle, valeur, classe]) => `
          <div class="benefice-bloc ${classe}">
            <span class="benefice-libelle">${esc(libelle)}</span>
            ${valeur ? `<span class="benefice-valeur">${esc(valeur)}</span>` : ''}
          </div>`).join('')}
      </section>
      ${r.nbSansPrixAchat > 0
        ? `<p class="note-alerte note-marge">${icone('alerte', 16, 2)} <span>${r.nbSansPrixAchat} ligne${r.nbSansPrixAchat > 1 ? 's' : ''} vendue${r.nbSansPrixAchat > 1 ? 's' : ''} sans prix d’achat (${esc(formatGNF(r.caSansPrixAchat))} de ventes) ne ${r.nbSansPrixAchat > 1 ? 'sont' : 'est'} pas comptée${r.nbSansPrixAchat > 1 ? 's' : ''} dans la marge. <a href="#/stock">Ajoutez les prix d’achat dans le Stock.</a></span></p>`
        : '<p class="note-marge discret">Le coût des marchandises est calculé avec le prix d’achat enregistré au moment de chaque vente.</p>'}

      <div class="rangee rapport-rangee">
        <section class="carte bloc-evolution">
          <div class="bloc-entete">
            <h2>${esc(TITRES_EVOLUTION[pas])}</h2>
            <div class="legende-double">
              <span><span class="pastille-ventes"></span>Ventes</span>
              <span><span class="pastille-depenses"></span>Dépenses</span>
            </div>
          </div>
          ${evolutionHTML(r.evolution, pas)}
        </section>
        <section class="carte bloc-vendeurs">
          <h2>Ventes par vendeur</h2>
          ${barresHTML(r.parVendeur.map((v) => ({ libelle: v.nom, valeur: v.total, detail: `${v.nb} vente${v.nb > 1 ? 's' : ''}` })), 'Aucune vente sur cette période.')}
        </section>
      </div>

      <div class="rangee rapport-rangee">
        <section class="carte bloc-paiements">${paiementsHTML(r.parMode)}</section>
        <section class="carte bloc-vendeurs">
          <h2>Dépenses par catégorie</h2>
          ${barresHTML(r.parCategorie.map((c) => ({ libelle: c.categorie, valeur: c.total })), 'Aucune dépense sur cette période.', true)}
        </section>
      </div>

      <section class="carte bloc-top">
        <div class="bloc-entete">
          <h2>Articles les plus vendus</h2>
          <div class="segments" role="group" aria-label="Trier par">
            ${TRIS.map(([code, libelle]) => `<button type="button" class="segment ${code === s.tri ? 'actif' : ''}" data-tri="${code}" aria-pressed="${code === s.tri}">${esc(libelle)}</button>`).join('')}
          </div>
        </div>
        <div data-zone="top">${topHTML()}</div>
      </section>`;
  }

  function evolutionHTML(points, pas) {
    if (!points.length || points.every((p) => !p.ventes && !p.depenses)) {
      return '<p class="discret">Aucune vente ni dépense sur cette période.</p>';
    }
    const max = Math.max(...points.map((p) => Math.max(p.ventes, p.depenses)), 1);
    const valeurs = points.length <= MAX_VALEURS_AFFICHEES;
    const hauteur = (v) => (v > 0 ? Math.max(3, Math.round((v / max) * HAUTEUR_BARRE)) : 0);
    const description = points.map((p) => `${libellePoint(p.debut, pas)} : ventes ${formatGNF(p.ventes)}, dépenses ${formatGNF(p.depenses)}`).join(' ; ');
    return `
      <div class="graph-double-cadre">
        <div class="graph-double" role="img" aria-label="${esc(description)}" style="min-width:${points.length * 46}px">
          ${points.map((p) => `
            <div class="gd-groupe" title="${esc(`${libellePoint(p.debut, pas)} — ventes ${formatGNF(p.ventes)} · dépenses ${formatGNF(p.depenses)}`)}">
              <div class="gd-barres">
                <div class="gd-colonne">
                  ${valeurs ? `<span class="gd-valeur">${formatMillions(p.ventes)}</span>` : ''}
                  <div class="gd-barre ventes" style="height:${hauteur(p.ventes)}px"></div>
                </div>
                <div class="gd-colonne">
                  ${valeurs ? `<span class="gd-valeur">${formatMillions(p.depenses)}</span>` : ''}
                  <div class="gd-barre depenses" style="height:${hauteur(p.depenses)}px"></div>
                </div>
              </div>
              <span class="gd-libelle">${esc(libellePoint(p.debut, pas))}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  /** Liste de barres horizontales (vendeurs, catégories de dépenses). */
  function barresHTML(lignes, vide, avecPourcentage = false) {
    if (!lignes.length) return `<p class="discret">${esc(vide)}</p>`;
    const tri = [...lignes].sort((a, b) => b.valeur - a.valeur);
    const total = tri.reduce((t, l) => t + l.valeur, 0);
    const max = tri[0].valeur || 1;
    return tri.map((l) => `
      <div class="repartition-ligne">
        <div class="repartition-haut">
          <span class="gras">${esc(l.libelle)}</span>
          <span class="tres-gras">${formatGNF(l.valeur)}${avecPourcentage ? ` <span class="discret">· ${total ? Math.round((l.valeur / total) * 100) : 0} %</span>` : ''}</span>
        </div>
        <div class="jauge jauge-repartition"><div style="width:${Math.round((l.valeur / max) * 100)}%"></div></div>
        ${l.detail ? `<span class="discret">${esc(l.detail)}</span>` : ''}
      </div>`).join('');
  }

  function paiementsHTML(parMode) {
    const lignes = ORDRE_MODES.map((mode) => ({ mode, montant: Number(parMode[mode]) || 0 }));
    const total = lignes.reduce((t, l) => t + l.montant, 0);
    return `
      <div class="bloc-titres"><h2>Modes de paiement</h2><span>Total · ${formatGNF(total)}</span></div>
      <div class="barre-empilee" role="img" aria-label="${esc(lignes.map((l) => `${MODES_PAIEMENT[l.mode].court} ${taux(l.montant, total)}`).join(', '))}">
        ${total ? lignes.filter((l) => l.montant > 0).map((l) => `<div style="width:${(l.montant / total) * 100}%;background:${MODES_PAIEMENT[l.mode].couleur}"></div>`).join('') : ''}
      </div>
      <div class="legende-paiements">
        ${lignes.map((l) => `
          <div class="legende-ligne">
            <span class="legende-pastille" style="background:${MODES_PAIEMENT[l.mode].couleur}"></span>
            <span class="legende-libelle">${esc(MODES_PAIEMENT[l.mode].court)}</span>
            <span class="legende-montant">${formatNombre(l.montant)}</span>
            <span class="legende-pct">${total ? Math.round((l.montant / total) * 100) : 0} %</span>
          </div>`).join('')}
      </div>`;
  }

  function articlesTries() {
    const cle = { ca: 'ca', marge: 'marge', quantite: 'quantite' }[s.tri];
    return [...s.rapport.topArticles].sort((a, b) => (b[cle] ?? -Infinity) - (a[cle] ?? -Infinity));
  }

  function topHTML() {
    const articles = articlesTries();
    if (!articles.length) return '<p class="discret">Aucun article vendu sur cette période.</p>';
    return `
      <div class="tableau-cadre">
        <table class="tableau tableau-top">
          <thead>
            <tr><th>#</th><th>Article</th><th class="droite">Quantité</th><th class="droite">Chiffre d’affaires</th><th class="droite">Marge</th><th class="droite">Taux</th></tr>
          </thead>
          <tbody>
            ${articles.map((a, i) => `
              <tr>
                <td class="discret gras">${i + 1}</td>
                <td class="gras">${esc(a.nom)}</td>
                <td class="droite secondaire">${esc(formatQuantite(a.quantite, a.unite))}</td>
                <td class="droite tres-gras">${formatGNF(a.ca)}</td>
                <td class="droite tres-gras ${a.marge === null ? 'discret' : 'texte-succes'}">${a.marge === null ? '—' : formatGNF(a.marge)}</td>
                <td class="droite secondaire">${a.marge === null ? '—' : taux(a.marge, a.ca)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  /* ---------------- Données */

  async function charger() {
    const { du, au } = bornes();
    const jeton = ++s.jeton;
    zone('sous-titre').textContent = libellePeriode();
    zone('periode-impression').textContent = libellePeriode();
    zone('contenu').innerHTML = `<div class="squelette" style="height:96px;border-radius:18px"></div>
      <div class="rangee rapport-rangee"><div class="carte bloc-evolution"><div class="squelette" style="height:220px"></div></div><div class="carte bloc-vendeurs"><div class="squelette" style="height:220px"></div></div></div>`;
    const { data, error } = await sb.rpc('rapport_periode', {
      p_boutique: boutique.id,
      p_debut: du,
      p_fin: decalerDate(au, 1),
      p_pas: pasPour(du, au)
    });
    if (jeton !== s.jeton) return;
    if (error) {
      s.rapport = null;
      zone('contenu').innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(error))}</p>`;
      return;
    }
    s.rapport = normaliserRapport(data);
    renderTout();
  }

  /* ---------------- Export CSV (Excel) */

  function exporterCsv() {
    const r = s.rapport;
    if (!r) { toast('Le rapport n’est pas encore chargé.', 'info'); return; }
    const { du, au } = bornes();
    const pas = pasPour(du, au);
    const champ = (v) => {
      const texte = String(v ?? '');
      return /[;"\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
    };
    const entier = (v) => (v === null || v === undefined ? '' : Math.round(Number(v) || 0));
    const lignes = [
      ['Rapport YOUMMA Business', boutique.nom],
      ['Période', `du ${formatDate(`${du}T12:00:00Z`, 'court')} au ${formatDate(`${au}T12:00:00Z`, 'court')}`],
      [],
      ['Résumé du bénéfice', 'Montant (GNF)'],
      ['Ventes', entier(r.ca)],
      ['Nombre de ventes', entier(r.nbVentes)],
      ['Remises', entier(r.remises)],
      ['Coût des marchandises', entier(r.cout)],
      ['Marge brute', entier(r.marge)],
      ['Taux de marge', taux(r.marge, r.ca)],
      ['Dépenses', entier(r.depenses)],
      ['Bénéfice net', entier(r.marge - r.depenses)],
      ['Lignes vendues sans prix d’achat', entier(r.nbSansPrixAchat)],
      ['Ventes sans prix d’achat', entier(r.caSansPrixAchat)],
      [],
      ['Évolution', 'Ventes (GNF)', 'Dépenses (GNF)'],
      ...r.evolution.map((p) => [libellePoint(p.debut, pas), entier(p.ventes), entier(p.depenses)]),
      [],
      ['Ventes par vendeur', 'Montant (GNF)', 'Nombre de ventes'],
      ...r.parVendeur.map((v) => [v.nom, entier(v.total), entier(v.nb)]),
      [],
      ['Rang', 'Article', 'Quantité', 'Unité', 'Chiffre d’affaires (GNF)', 'Marge (GNF)'],
      ...articlesTries().map((a, i) => [i + 1, a.nom, String(a.quantite).replace('.', ','), a.unite || '', entier(a.ca), entier(a.marge)]),
      [],
      ['Dépenses par catégorie', 'Montant (GNF)'],
      ...r.parCategorie.map((c) => [c.categorie, entier(c.total)])
    ];
    const csv = '﻿' + lignes.map((l) => l.map(champ).join(';')).join('\r\n');
    const nomFichier = `rapport-${normaliserNomFichier(boutique.nom)}-${du}-${au}.csv`;
    const lien = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
      download: nomFichier
    });
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(lien.href), 1000);
    toast(`Fichier « ${nomFichier} » téléchargé.`, 'succes');
  }

  /* ---------------- Impression A4 */

  function imprimer() {
    if (!s.rapport) { toast('Le rapport n’est pas encore chargé.', 'info'); return; }
    document.body.classList.add('impression-rapport');
    const retirer = () => document.body.classList.remove('impression-rapport');
    window.addEventListener('afterprint', retirer, { once: true });
    window.print();
    setTimeout(retirer, 1000);
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
    const tri = e.target.closest('[data-tri]');
    if (tri) {
      s.tri = tri.dataset.tri;
      conteneur.querySelectorAll('[data-tri]').forEach((b) => {
        b.classList.toggle('actif', b === tri);
        b.setAttribute('aria-pressed', String(b === tri));
      });
      zone('top').innerHTML = topHTML();
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'exporter') exporterCsv();
    if (action === 'imprimer') imprimer();
  });

  zone('dates').addEventListener('change', () => {
    const du = conteneur.querySelector('#rapport-du');
    const au = conteneur.querySelector('#rapport-au');
    if (!du.value || !au.value) return;
    s.du = du.value > aujourdhui ? aujourdhui : du.value;
    s.au = au.value > aujourdhui ? aujourdhui : au.value;
    if (s.du > s.au) [s.du, s.au] = [s.au, s.du];
    du.value = s.du;
    au.value = s.au;
    charger();
  });

  charger();
}

/** Nom de fichier sans accents ni espaces : « Diallo Matériaux » → « diallo-materiaux ». */
function normaliserNomFichier(texte) {
  return String(texte).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'boutique';
}
