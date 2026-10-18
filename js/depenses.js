/**
 * depenses.js — Page Dépenses (maquette Depenses.dc.html).
 *
 * Droits (RLS) : lecture et ajout pour tous les membres, suppression pour le gérant / propriétaire,
 * pas de modification (pour corriger : supprimer puis ressaisir).
 */
import { sb } from './supabase.js';
import { etat, peut, utilisateur } from './state.js';
import { chargerNomsMembres } from './clients-commun.js';
import {
  esc, icone, toast, confirmer, ouvrirModale, boutonOccupe, messageErreur, capitaliser,
  formatGNF, formatDate, dateISO, decalerDate, bornesPeriode, chargerParLots, formaterSaisieMontant
} from './utils.js';

const CATEGORIES = ['Transport', 'Manutention', 'Loyer', 'Électricité', 'Salaires', 'Crédit téléphone', 'Taxes', 'Autre'];
const PERIODES = [['jour', 'Aujourd’hui'], ['7j', '7 jours'], ['mois', 'Ce mois'], ['moisDernier', 'Mois dernier']];
const TITRES_REPARTITION = {
  jour: 'Où part l’argent aujourd’hui',
  '7j': 'Où part l’argent ces 7 derniers jours',
  mois: 'Où part l’argent ce mois-ci',
  moisDernier: 'Où part l’argent le mois dernier'
};
const LONGUEUR_MAX_LIBELLE = 120;
const COLONNES_DEPENSE = 'id, libelle, categorie, montant, saisi_par, created_at';

function normaliserTexte(texte) {
  return String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Libellé affiché d'une catégorie enregistrée (tolère « electricite », « credit_telephone »…). */
function libelleCategorie(valeur) {
  const n = normaliserTexte(valeur).replace(/[_-]+/g, ' ');
  return CATEGORIES.find((c) => normaliserTexte(c) === n) || capitaliser(valeur || 'Autre');
}

export function afficherDepenses(conteneur) {
  const boutique = etat.boutique;
  const gerer = peut('supprimer_depense');
  const aujourdhui = dateISO();
  const debutMois = bornesPeriode('mois').du;
  const s = {
    periode: 'mois',
    depenses: [],
    debutCharge: null,
    ventesMois: 0,
    categorie: null,
    charge: false,
    jeton: 0
  };
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);
  const nomsMembres = chargerNomsMembres(boutique.id);
  let noms = new Map();

  conteneur.innerHTML = `
    <div class="page page-depenses">
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour seul-ordi" href="#/tableau-de-bord">← Tableau de bord</a>
          <h1>Dépenses</h1>
        </div>
        <div class="segments segments-cadre" role="group" aria-label="Période">
          ${PERIODES.map(([code, libelle]) => `
            <button type="button" class="segment ${code === s.periode ? 'actif' : ''}" data-periode="${code}" aria-pressed="${code === s.periode}">${esc(libelle)}</button>`).join('')}
        </div>
      </header>

      <section class="kpis-clients" aria-label="Résumé" data-zone="kpis">
        ${'<div class="carte kpi-client"><span class="squelette" style="height:13px;width:60%"></span><span class="squelette" style="height:26px;width:80%"></span><span class="squelette" style="height:12px;width:55%"></span></div>'.repeat(4)}
      </section>

      <div class="depenses-corps">
        <div class="carte depenses-form seul-ordi">${formulaireHTML('o', true)}</div>
        <div class="depenses-droite">
          <section class="carte repartition" data-zone="repartition">
            <h2>${esc(TITRES_REPARTITION[s.periode])}</h2>
            ${'<span class="squelette" style="height:22px"></span>'.repeat(4)}
          </section>
          <section class="carte depenses-liste" aria-label="Liste des dépenses">
            <div class="entete-liste-depenses seul-ordi ${gerer ? 'avec-action' : ''}" aria-hidden="true">
              <span>Date</span><span>Description</span><span>Catégorie</span><span>Saisi par</span><span class="droite">Montant</span>${gerer ? '<span></span>' : ''}
            </div>
            <ul class="liste-depenses" data-zone="liste"></ul>
          </section>
        </div>
      </div>

      <button type="button" class="btn btn-primaire fab-depense seul-mobile" data-action="ouvrir-formulaire">${icone('plus', 20, 2.4)} Dépense</button>
    </div>`;

  /* ---------------- Formulaire « Nouvelle dépense » */

  function formulaireHTML(suffixe, avecTitre) {
    return `
      <form class="form-depense" novalidate>
        ${avecTitre ? '<h2>Nouvelle dépense</h2>' : ''}
        <div class="champ">
          <label for="dep-montant-${suffixe}">Montant (GNF)</label>
          <input id="dep-montant-${suffixe}" class="input input-montant" type="text" inputmode="numeric" autocomplete="off" placeholder="0" data-ref="montant">
        </div>
        <div class="champ">
          <span class="etiquette" id="dep-cat-${suffixe}">Catégorie</span>
          <div class="puces puces-categories" role="group" aria-labelledby="dep-cat-${suffixe}">
            ${CATEGORIES.map((c) => `<button type="button" class="puce ${c === s.categorie ? 'active' : ''}" data-categorie="${esc(c)}" aria-pressed="${c === s.categorie}">${esc(c)}</button>`).join('')}
          </div>
        </div>
        <div class="champ">
          <label for="dep-libelle-${suffixe}">Description</label>
          <input id="dep-libelle-${suffixe}" class="input" type="text" maxlength="${LONGUEUR_MAX_LIBELLE}" placeholder="Ex. Camion livraison chantier Kagbélen" data-ref="libelle">
        </div>
        <div class="champ">
          <label for="dep-date-${suffixe}">Date</label>
          <input id="dep-date-${suffixe}" class="input" type="date" max="${aujourdhui}" value="${aujourdhui}" data-ref="date">
        </div>
        <p class="erreur-form" role="alert" hidden></p>
        <button type="submit" class="btn btn-primaire btn-grand">Enregistrer la dépense</button>
      </form>`;
  }

  /** Branche un formulaire (en ligne sur ordinateur ou dans le panneau du bas sur téléphone). */
  function brancherFormulaire(formulaire, { apresSucces } = {}) {
    const champ = (ref) => formulaire.querySelector(`[data-ref="${ref}"]`);
    const zoneErreur = formulaire.querySelector('.erreur-form');
    const erreur = (message) => { zoneErreur.textContent = message; zoneErreur.hidden = !message; };
    let montant = null;

    champ('montant').addEventListener('input', (e) => { montant = formaterSaisieMontant(e.target); });
    formulaire.addEventListener('click', (e) => {
      const puce = e.target.closest('[data-categorie]');
      if (!puce) return;
      s.categorie = puce.dataset.categorie;
      formulaire.querySelectorAll('[data-categorie]').forEach((b) => {
        b.classList.toggle('active', b === puce);
        b.setAttribute('aria-pressed', String(b === puce));
      });
    });

    formulaire.addEventListener('submit', async (e) => {
      e.preventDefault();
      const libelle = champ('libelle').value.trim();
      const date = champ('date').value;
      if (!(montant > 0)) return erreur('Indiquez un montant supérieur à 0.');
      if (!s.categorie) return erreur('Choisissez une catégorie.');
      if (!libelle) return erreur('Ajoutez une courte description.');
      if (!date) return erreur('Choisissez la date de la dépense.');
      if (date > dateISO()) return erreur('La date ne peut pas être dans le futur.');
      erreur('');

      // Aujourd'hui : heure actuelle ; date passée : midi (Conakry = UTC).
      const createdAt = date === dateISO() ? new Date().toISOString() : `${date}T12:00:00Z`;
      const bouton = formulaire.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      const { data, error } = await sb.from('depenses')
        .insert({
          boutique_id: boutique.id,
          libelle,
          categorie: s.categorie,
          montant,
          saisi_par: utilisateur()?.id,
          created_at: createdAt
        })
        .select(COLONNES_DEPENSE)
        .single();
      boutonOccupe(bouton, false);
      if (error) { erreur(messageErreur(error)); return; }

      s.depenses.unshift(data);
      s.depenses.sort((a, b) => b.created_at.localeCompare(a.created_at));
      toast(`Dépense de ${formatGNF(data.montant)} enregistrée.`, 'succes');
      // Formulaire vidé, catégorie conservée.
      montant = null;
      champ('montant').value = '';
      champ('libelle').value = '';
      champ('date').value = dateISO();
      renderTout();
      apresSucces?.();
    });
  }

  function ouvrirFormulaireMobile() {
    const { el, fermer } = ouvrirModale({ titre: 'Nouvelle dépense', variante: 'feuille', contenu: formulaireHTML('m', false) });
    brancherFormulaire(el.querySelector('form'), { apresSucces: fermer });
  }

  /* ---------------- Calculs et rendu */

  const somme = (liste) => liste.reduce((t, d) => t + (Number(d.montant) || 0), 0);
  const jourDe = (d) => String(d.created_at).slice(0, 10); // Conakry = UTC

  function depensesPeriode() {
    const { du, au } = bornesPeriode(s.periode);
    return s.depenses.filter((d) => jourDe(d) >= du && jourDe(d) <= au);
  }

  function renderKpis() {
    const duJour = s.depenses.filter((d) => jourDe(d) === dateISO());
    const duMois = s.depenses.filter((d) => jourDe(d) >= debutMois);
    const totalMois = somme(duMois);
    const part = s.ventesMois > 0 ? `${String(Math.round((totalMois / s.ventesMois) * 1000) / 10).replace('.', ',')} %` : '—';
    const nb = (n) => `${n} dépense${n > 1 ? 's' : ''}`;
    zone('kpis').innerHTML = [
      { libelle: 'Dépenses aujourd’hui', valeur: formatGNF(somme(duJour)), sous: nb(duJour.length), encre: 'var(--text)' },
      { libelle: 'Dépenses ce mois', valeur: formatGNF(totalMois), sous: nb(duMois.length), encre: 'var(--text)' },
      { libelle: 'Ventes ce mois', valeur: formatGNF(s.ventesMois), sous: 'chiffre d’affaires', encre: 'var(--succes)' },
      { libelle: 'Part des dépenses', valeur: part, sous: s.ventesMois > 0 ? 'du chiffre d’affaires' : 'aucune vente ce mois', encre: 'var(--alerte)' }
    ].map((k) => `
      <div class="carte kpi-client">
        <span class="kpi-libelle">${esc(k.libelle)}</span>
        <span class="kpi-client-valeur" style="color:${k.encre}">${esc(k.valeur)}</span>
        <span class="kpi-client-sous">${esc(k.sous)}</span>
      </div>`).join('');
  }

  function renderRepartition() {
    const liste = depensesPeriode();
    const total = somme(liste);
    const parCategorie = new Map();
    liste.forEach((d) => {
      const c = libelleCategorie(d.categorie);
      parCategorie.set(c, (parCategorie.get(c) || 0) + (Number(d.montant) || 0));
    });
    const lignes = [...parCategorie.entries()].sort((a, b) => b[1] - a[1]);
    zone('repartition').innerHTML = `
      <h2>${esc(TITRES_REPARTITION[s.periode])}</h2>
      ${lignes.length ? lignes.map(([categorie, montant]) => {
        const pct = total ? Math.round((montant / total) * 100) : 0;
        return `
          <div class="repartition-ligne">
            <div class="repartition-haut">
              <span class="gras">${esc(categorie)}</span>
              <span class="tres-gras">${formatGNF(montant)} <span class="discret">· ${pct} %</span></span>
            </div>
            <div class="jauge jauge-repartition" role="img" aria-label="${esc(`${categorie} : ${pct} %`)}"><div style="width:${pct}%"></div></div>
          </div>`;
      }).join('') : '<p class="discret">Aucune dépense sur cette période.</p>'}`;
  }

  function renderListe() {
    const liste = depensesPeriode();
    if (!liste.length) {
      zone('liste').innerHTML = '<li class="etat-vide etat-vide-large"><p>Aucune dépense sur cette période.</p></li>';
      return;
    }
    zone('liste').innerHTML = liste.map((d) => `
      <li class="ligne-depense ${gerer ? 'avec-action' : ''}">
        <span class="ld-date">${esc(formatDate(d.created_at, 'jourMois'))} · ${esc(formatDate(d.created_at, 'heure'))}</span>
        <span class="ld-libelle">${esc(d.libelle)}</span>
        <span class="ld-categorie"><span class="badge-categorie">${esc(libelleCategorie(d.categorie))}</span></span>
        <span class="ld-par">${esc(noms.get(d.saisi_par) || '—')}</span>
        <span class="ld-montant">${formatGNF(d.montant)}</span>
        ${gerer ? `<span class="ld-action"><button type="button" class="btn-icone btn-supprimer" data-supprimer="${esc(d.id)}" aria-label="Supprimer la dépense « ${esc(d.libelle)} »">${icone('corbeille', 16, 2)}</button></span>` : ''}
      </li>`).join('');
  }

  function renderTout() {
    if (!s.charge) return;
    renderKpis();
    renderRepartition();
    renderListe();
  }

  /* ---------------- Données */

  async function charger() {
    const jeton = ++s.jeton;
    // Une seule plage couvre la période choisie et le mois en cours (indicateurs).
    const debut = [bornesPeriode(s.periode).du, debutMois].sort()[0];
    zone('liste').innerHTML = '<li class="squelette-ligne"><span class="squelette" style="height:14px;width:50%"></span></li>'.repeat(4);
    try {
      const [depenses, ventes, mapNoms] = await Promise.all([
        chargerParLots((d, f) => sb.from('depenses').select(COLONNES_DEPENSE)
          .eq('boutique_id', boutique.id)
          .gte('created_at', `${debut}T00:00:00Z`)
          .lt('created_at', `${decalerDate(aujourdhui, 1)}T00:00:00Z`)
          .order('created_at', { ascending: false })
          .range(d, f)),
        chargerParLots((d, f) => sb.from('ventes').select('total')
          .eq('boutique_id', boutique.id)
          .eq('statut', 'validee')
          .gte('created_at', `${debutMois}T00:00:00Z`)
          .range(d, f)),
        nomsMembres
      ]);
      if (jeton !== s.jeton) return;
      s.depenses = depenses;
      s.ventesMois = ventes.reduce((t, v) => t + (Number(v.total) || 0), 0);
      noms = mapNoms;
    } catch (err) {
      if (jeton !== s.jeton) return;
      const message = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p>`;
      zone('kpis').innerHTML = message;
      zone('liste').innerHTML = `<li>${message}</li>`;
      return;
    }
    s.charge = true;
    renderTout();
  }

  async function supprimer(id) {
    const depense = s.depenses.find((d) => d.id === id);
    if (!depense) return;
    const ok = await confirmer(`Supprimer cette dépense de ${formatGNF(depense.montant)} ?`, {
      titre: 'Supprimer la dépense', libelleOk: 'Supprimer', danger: true
    });
    if (!ok) return;
    const { data, error } = await sb.from('depenses').delete().eq('id', id).eq('boutique_id', boutique.id).select('id');
    if (error) { toast(messageErreur(error), 'erreur'); return; }
    // RLS : une suppression refusée ne renvoie pas d'erreur mais aucune ligne.
    if (!data.length) { toast('Suppression refusée : seuls le gérant et le propriétaire peuvent supprimer une dépense.', 'erreur'); return; }
    s.depenses = s.depenses.filter((d) => d.id !== id);
    renderTout();
    toast('Dépense supprimée.', 'succes');
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
      charger();
      return;
    }
    if (e.target.closest('[data-action="ouvrir-formulaire"]')) { ouvrirFormulaireMobile(); return; }
    const corbeille = e.target.closest('[data-supprimer]');
    if (corbeille) supprimer(corbeille.dataset.supprimer);
  });

  brancherFormulaire(conteneur.querySelector('.depenses-form form'));
  charger();
}
