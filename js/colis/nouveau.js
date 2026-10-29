/**
 * colis/nouveau.js — Enregistrer un colis (étape 16, maquette ColisNouveau), #/nouveau-colis.
 *
 * Tient sur un téléphone, à une main, et se remplit de haut en bas : trajet (les deux bureaux, Avion / Route avec
 * le délai du tarif), qui envoie, qui reçoit, le colis, les deux photos obligatoires, à payer (tarif_colis,
 * recalculé à chaque changement), qui paie (maintenant ou à l'arrivée), puis « Enregistrer et imprimer l'étiquette »
 * → photos montées → enregistrer_colis → écran d'étiquette directement (pas de confirmation intermédiaire).
 * Aucun prix n'est inventé ici : le total vient de tarif_colis ; le montant à l'arrivée est figé par la base.
 */
import { sb } from '../supabase.js';
import { etat } from '../state.js';
import { naviguer } from '../router.js';
import { esc, icone, toast, boutonOccupe, messageErreur, differer, lireNombre, formatNombre } from '../utils.js';
import {
  api, chargerAgences, codePays, normaliserTel, montant, nomDevise, iconeColis, MODES, MODES_PAIEMENT_COLIS
} from './commun.js';
import { monterPhotos } from './photos.js';

export function afficherNouveauColis(conteneur) {
  const s = {
    agences: [], depart: null, arrivee: null, mode: 'avion', tarifs: {}, tarif: null, jeton: 0, taux: null,
    supplements: new Set(), paye: true, payeMode: 'especes', photosPretes: false, douaneTouchee: false, enCours: false
  };
  conteneur.innerHTML = `<div class="page page-colis-nouveau"><div class="squelette" style="height:420px"></div></div>`;
  let photos = null;

  async function demarrer() {
    try {
      const [agences, tableau] = await Promise.all([chargerAgences(), api.tableau().catch(() => null)]);
      s.agences = agences.filter((a) => a.actif !== false);
      // tableau_colis.taux : [{ de, vers, taux, maj_le }] ; celui de FCFA vers GNF sert à l'aperçu « à l'arrivée ».
      s.taux = tableau?.taux.find((x) => x.de === 'XOF' && x.vers === 'GNF')?.taux ?? null;
    } catch (err) {
      conteneur.innerHTML = `<div class="page"><p class="bloc-erreur">${esc(messageErreur(err))}</p></div>`;
      return;
    }
    if (s.agences.length < 2) {
      conteneur.innerHTML = `<div class="page"><div class="carte aff-vide"><p><strong>Il faut deux bureaux</strong> (départ et arrivée) avant d’enregistrer un colis.</p><a class="btn btn-primaire" href="#/parametres">Ajouter mes bureaux</a></div></div>`;
      return;
    }
    s.depart = s.agences.find((a) => a.devise === 'XOF') || s.agences[0];
    s.arrivee = s.agences.find((a) => a.id !== s.depart.id && codePays(a) !== codePays(s.depart)) || s.agences.find((a) => a.id !== s.depart.id);
    render();
    chargerTarifsModes();
  }

  const agence = (id) => s.agences.find((a) => a.id === id);
  const ref = (n) => conteneur.querySelector(`[data-ref="${n}"]`);
  const champSaisi = (id) => conteneur.querySelector(`#${id}`)?.value.trim() || '';

  function render() {
    conteneur.innerHTML = `
      <div class="page page-colis-nouveau">
        <header class="col-nouveau-entete">
          <a href="#/colis" class="btn-icone" aria-label="Retour aux colis">${icone('retour', 20, 2)}</a>
          <h1>Nouveau colis</h1>
          <span class="discret" data-ref="bureau">Bureau de ${esc(s.depart.ville || s.depart.nom)}</span>
        </header>
        <form class="col-formulaire" novalidate>
          <section class="carte col-bloc">
            <div class="col-trajet">
              <label class="col-trajet-bout"><span class="col-trajet-etiquette">DE</span>
                <select class="col-trajet-select" data-ref="depart" aria-label="Bureau de départ">${s.agences.map((a) => `<option value="${a.id}" ${a.id === s.depart.id ? 'selected' : ''}>${esc(a.ville || a.nom)} · ${esc(codePays(a))}</option>`).join('')}</select></label>
              <span class="col-fleche">${iconeColis('fleche', 20)}</span>
              <label class="col-trajet-bout droite"><span class="col-trajet-etiquette">VERS</span>
                <select class="col-trajet-select" data-ref="arrivee" aria-label="Bureau d’arrivée">${s.agences.filter((a) => a.id !== s.depart.id).map((a) => `<option value="${a.id}" ${a.id === s.arrivee?.id ? 'selected' : ''}>${esc(a.ville || a.nom)} · ${esc(codePays(a))}</option>`).join('')}</select></label>
              <button type="button" class="btn-icone col-inverser" data-action="inverser" aria-label="Inverser le trajet">⇄</button>
            </div>
            <div class="col-modes" role="group" aria-label="Mode d’envoi">
              ${Object.entries(MODES).map(([code, m]) => `<button type="button" class="col-mode ${code === s.mode ? 'actif' : ''}" data-mode="${code}" aria-pressed="${code === s.mode}">
                <strong>${iconeColis(m.icone, 18)} ${esc(m.libelle)}</strong><span data-ref="mode-${code}">…</span></button>`).join('')}
            </div>
          </section>

          <section class="carte col-bloc">
            <h2>Qui envoie</h2>
            <div class="rangee-champs">
              <div class="champ"><label for="col-exp-nom">Nom</label><input id="col-exp-nom" class="input" autocomplete="off" maxlength="80" required></div>
              <div class="champ"><label for="col-exp-tel">Téléphone</label><input id="col-exp-tel" class="input" type="tel" inputmode="tel" maxlength="20" placeholder="${codePays(s.depart) === 'SN' ? '77 123 45 67' : '620 53 82 90'}" required></div>
            </div>
            <h2 class="col-sous-titre">Qui reçoit</h2>
            <div class="rangee-champs">
              <div class="champ"><label for="col-dest-nom">Nom</label><input id="col-dest-nom" class="input" autocomplete="off" maxlength="80" required></div>
              <div class="champ"><label for="col-dest-tel">Téléphone</label><input id="col-dest-tel" class="input" type="tel" inputmode="tel" maxlength="20" placeholder="${codePays(s.arrivee) === 'SN' ? '77 123 45 67' : '620 53 82 90'}" required></div>
            </div>
            <div class="champ"><span class="etiquette">Ville de retrait</span><span class="col-retrait" data-ref="retrait">${esc(retraitTexte())}</span></div>
          </section>

          <section class="carte col-bloc">
            <h2>Le colis</h2>
            <div class="champ"><label for="col-contenu">Contenu</label><input id="col-contenu" class="input" maxlength="200" placeholder="Ex. Vêtements et chaussures" required></div>
            <div class="champ"><label for="col-douane">Contenu pour la douane (facultatif)</label><input id="col-douane" class="input" maxlength="200" placeholder="Repris du contenu"></div>
            <div class="rangee-champs col-rangee-3">
              <div class="champ"><label for="col-poids">Poids (kg)</label><input id="col-poids" class="input col-gros" type="text" inputmode="decimal" placeholder="0" required>
                <small class="aide col-minimum" data-ref="minimum" hidden></small></div>
              <div class="champ"><label for="col-nb">Nombre de colis</label><input id="col-nb" class="input col-gros" type="number" inputmode="numeric" min="1" step="1" value="1"></div>
              <div class="champ"><label for="col-valeur">Valeur déclarée (facultatif)</label><input id="col-valeur" class="input" type="text" inputmode="numeric" placeholder="0"></div>
            </div>
            <div class="col-supplements" data-ref="supplements"></div>
            <div class="col-photos" data-zone="photos"></div>
          </section>

          <section class="carte col-bloc col-a-payer" data-ref="a-payer">
            <p class="discret">Entrez le poids pour voir le prix.</p>
          </section>

          <section class="carte col-bloc">
            <h2>Qui paie ?</h2>
            <div class="col-payeurs" role="group" aria-label="Qui paie">
              <button type="button" class="col-payeur ${s.paye ? 'actif' : ''}" data-paye="1" aria-pressed="${s.paye}"><strong>Maintenant</strong><span data-ref="payeur-maintenant">L’expéditeur paie au dépôt</span></button>
              <button type="button" class="col-payeur ${s.paye ? '' : 'actif'}" data-paye="0" aria-pressed="${!s.paye}"><strong>À l’arrivée</strong><span data-ref="payeur-arrivee">Le destinataire paie au retrait</span></button>
            </div>
            <div class="col-modes-paiement" data-ref="modes-paiement" ${s.paye ? '' : 'hidden'}>
              ${MODES_PAIEMENT_COLIS.map(([c, l]) => `<label class="puce-jour"><input type="radio" name="paye-mode" value="${c}" ${c === s.payeMode ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}
            </div>
          </section>

          <p class="erreur-form" role="alert" hidden></p>
          <div class="col-enregistrer">
            <button type="submit" class="btn btn-primaire btn-grand btn-bloc" data-ref="enregistrer" disabled>Enregistrer et imprimer l’étiquette</button>
            <span class="discret" data-ref="manque">Il manque les deux photos.</span>
          </div>
        </form>
      </div>`;
    photos = monterPhotos(conteneur.querySelector('[data-zone="photos"]'), { surChangement: (pret) => { s.photosPretes = pret; majBouton(); } });
    brancher();
  }

  function retraitTexte() {
    const a = s.arrivee;
    return a ? `${a.ville || ''}${a.nom && a.nom !== a.ville ? ` — ${a.nom}` : ''}`.trim() : '—';
  }

  /* ---------------- Tarifs */

  /**
   * Prix au kilo et délai de chaque mode (sous les boutons), lus dans la grille tarifs_colis du trajet : un mode sans
   * tarif actif (souvent le bateau) n'est pas proposé. Le prix du colis, lui, vient toujours de tarif_colis.
   */
  async function chargerTarifsModes() {
    const { data, error } = await sb.from('tarifs_colis').select('mode, prix_kg, delai_jours, devise, supplements')
      .eq('boutique_id', etat.boutique.id).eq('agence_depart', s.depart.id).eq('agence_arrivee', s.arrivee.id).eq('actif', true);
    const lignes = error ? [] : data;
    for (const mode of Object.keys(MODES)) {
      const t = lignes.find((x) => x.mode === mode) || null;
      s.tarifs[mode] = t;
      const z = ref(`mode-${mode}`);
      if (z) z.textContent = t ? `${formatNombre(t.prix_kg)} ${t.devise === 'XOF' ? 'F' : nomDevise(t.devise)}/kg · ${t.delai_jours} jour${t.delai_jours > 1 ? 's' : ''}` : 'Pas de tarif';
      const bouton = conteneur.querySelector(`[data-mode="${mode}"]`);
      if (bouton) bouton.hidden = !t && mode !== s.mode;
    }
    recalculer();
  }

  const recalculer = differer(async () => {
    const poids = lireNombre(champSaisi('col-poids'));
    const z = ref('a-payer');
    if (!z) return;
    if (!poids || poids <= 0) { s.tarif = null; z.innerHTML = '<p class="discret">Entrez le poids pour voir le prix.</p>'; majPayeurs(); majBouton(); return; }
    const jeton = ++s.jeton;
    z.classList.add('calcul');
    let t;
    try {
      t = await api.tarif({ depart: s.depart.id, arrivee: s.arrivee.id, mode: s.mode, poids, supplements: [...s.supplements] });
    } catch (err) {
      if (jeton !== s.jeton) return;
      s.tarif = null;
      z.classList.remove('calcul');
      z.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`;
      majBouton();
      return;
    }
    if (jeton !== s.jeton || !z.isConnected) return;
    z.classList.remove('calcul');
    s.tarif = t;
    renderSupplements(t);
    const minimum = ref('minimum');
    // Poids facturé supérieur au poids pesé : on le dit en clair sous le champ.
    if (Number(t.poids_facture) > Number(poids)) {
      minimum.hidden = false;
      minimum.textContent = `${formatNombre(poids, 2)} kg pesés — facturés au minimum de ${formatNombre(t.poids_facture, 2)} kg`;
    } else minimum.hidden = true;
    const prixKg = t.devise === 'XOF' ? 'F' : nomDevise(t.devise);
    z.innerHTML = `
      <details class="col-detail-prix">
        <summary><span>À payer</span><strong class="col-total">${formatNombre(t.total)} <small>${esc(nomDevise(t.devise))}</small></strong></summary>
        <div class="col-ligne-prix"><span>${formatNombre(t.poids_facture, 2)} kg × ${formatNombre(t.prix_kg)} ${prixKg}</span><strong>${formatNombre(t.marchandise)}</strong></div>
        ${Number(t.frais_fixe) ? `<div class="col-ligne-prix"><span>Emballage et frais fixes</span><strong>${formatNombre(t.frais_fixe)}</strong></div>` : ''}
        ${Number(t.supplements) ? `<div class="col-ligne-prix"><span>Suppléments</span><strong>${formatNombre(t.supplements)}</strong></div>` : ''}
        <div class="col-ligne-prix"><span>Délai prévu</span><strong>${t.delai_jours} jour${t.delai_jours > 1 ? 's' : ''}</strong></div>
      </details>
      ${montantArrivee(t) ? `<p class="discret">soit ${montant(montantArrivee(t).montant, montantArrivee(t).devise)} au taux du jour${s.taux ? ` (1 F = ${String(s.taux).replace('.', ',')} ${esc(s.arrivee.devise)})` : ''}</p>` : ''}`;
    majPayeurs();
    majBouton();
  }, 300);

  /**
   * Montant dû à l'arrivée, dans la monnaie du bureau d'arrivée : celui de tarif_colis s'il le donne, sinon le total
   * converti au taux du jour (affichage avant enregistrement ; la base fige ensuite le montant dans le colis).
   */
  function montantArrivee(t) {
    if (!t || !s.arrivee || s.arrivee.devise === t.devise) return t ? { montant: t.total, devise: t.devise } : null;
    if (t.du_montant != null) return { montant: t.du_montant, devise: t.du_devise };
    if (!s.taux) return null;
    return { montant: Math.round(Number(t.total) * Number(s.taux)), devise: s.arrivee.devise };
  }

  function renderSupplements(t) {
    // Suppléments du trajet : ceux renvoyés par tarif_colis, sinon ceux de la grille (avant la saisie du poids).
    const base = t || s.tarifs[s.mode];
    const possibles = (t ? t.supplements_possibles : s.tarifs[s.mode]?.supplements) || [];
    const z = ref('supplements');
    if (!possibles.length) { z.innerHTML = ''; return; }
    if (z.dataset.signature === JSON.stringify(possibles)) return;
    z.dataset.signature = JSON.stringify(possibles);
    z.innerHTML = `<span class="etiquette">Suppléments</span><div class="col-puces">${possibles.map((p) => `
      <label class="col-supplement"><input type="checkbox" value="${esc(p.nom)}" ${s.supplements.has(p.nom) ? 'checked' : ''}><span>${esc(p.nom)} <strong>+${formatNombre(p.montant)} ${base.devise === 'XOF' ? 'F' : esc(nomDevise(base.devise))}</strong></span></label>`).join('')}</div>`;
  }

  function majPayeurs() {
    const t = s.tarif;
    const exp = champSaisi('col-exp-nom').split(/\s+/)[0];
    const dest = champSaisi('col-dest-nom').split(/\s+/)[0];
    const arr = montantArrivee(t);
    ref('payeur-maintenant').textContent = t ? `${exp || 'L’expéditeur'} · ${montant(t.total, t.devise)}` : 'L’expéditeur paie au dépôt';
    ref('payeur-arrivee').textContent = arr ? `${dest || 'Le destinataire'} · ${montant(arr.montant, arr.devise)}` : 'Le destinataire paie au retrait';
  }

  function manques() {
    const m = [];
    if (!champSaisi('col-exp-nom') || !champSaisi('col-exp-tel')) m.push('l’expéditeur');
    if (!champSaisi('col-dest-nom') || !champSaisi('col-dest-tel')) m.push('le destinataire');
    if (!champSaisi('col-contenu')) m.push('le contenu');
    if (!s.tarif) m.push('le poids');
    if (!s.photosPretes) m.push('les deux photos');
    return m;
  }
  function majBouton() {
    const m = manques();
    const b = ref('enregistrer');
    if (!b || s.enCours) return;
    b.disabled = m.length > 0;
    ref('manque').textContent = m.length ? `Il manque ${m.join(', ').replace(/, ([^,]*)$/, ' et $1')}.` : '';
  }

  /* ---------------- Enregistrement */

  async function enregistrer(bouton) {
    const z = conteneur.querySelector('.erreur-form');
    const erreur = (t) => { z.textContent = t; z.hidden = !t; };
    const expTel = normaliserTel(champSaisi('col-exp-tel'));
    const destTel = normaliserTel(champSaisi('col-dest-tel'));
    if (!expTel) return erreur('Téléphone de l’expéditeur : numéro sénégalais (77…) ou guinéen (6…) attendu.');
    if (!destTel) return erreur('Téléphone du destinataire : numéro sénégalais (77…) ou guinéen (6…) attendu.');
    if (!photos.pret()) return erreur('Les deux photos sont obligatoires.');
    erreur('');
    s.enCours = true;
    boutonOccupe(bouton, true, 'Enregistrement…');
    let fichiers = null;
    try {
      fichiers = await photos.envoyer();
      const r = await api.enregistrer({
        depart: s.depart.id, arrivee: s.arrivee.id, mode: s.mode,
        expediteurNom: champSaisi('col-exp-nom'), expediteurTel: expTel, destinataireNom: champSaisi('col-dest-nom'), destinataireTel: destTel,
        contenu: champSaisi('col-contenu'), contenuDouane: champSaisi('col-douane') || champSaisi('col-contenu'),
        poids: lireNombre(champSaisi('col-poids')), nbColis: Math.max(1, Number(champSaisi('col-nb')) || 1),
        valeurDeclaree: lireNombre(champSaisi('col-valeur')),
        supplements: [...s.supplements], paye: s.paye, payeMode: s.paye ? s.payeMode : null,
        photoBascule: fichiers.bascule, photoContenu: fichiers.contenu
      });
      photos.arreter();
      // Le jeton n'est lisible qu'ici : on le garde pour l'étiquette (la fiche le relit par suivi_interne).
      try { sessionStorage.setItem(`yb_colis_${r.id}`, JSON.stringify({ jeton: r.jeton, lien: r.lien })); } catch { /* facultatif */ }
      naviguer(`colis/${encodeURIComponent(r.id)}/etiquette`);
    } catch (err) {
      if (fichiers?.envoyes?.length) await photos.nettoyer(fichiers.envoyes);
      s.enCours = false;
      boutonOccupe(bouton, false);
      erreur(messageErreur(err));
      majBouton();
    }
  }

  /* ---------------- Évènements */

  function brancher() {
    const form = conteneur.querySelector('form');
    form.addEventListener('input', (e) => {
      if (e.target.id === 'col-contenu' && !s.douaneTouchee) form.querySelector('#col-douane').placeholder = e.target.value || 'Repris du contenu';
      if (e.target.id === 'col-douane') s.douaneTouchee = Boolean(e.target.value);
      if (e.target.id === 'col-poids') recalculer();
      if (['col-exp-nom', 'col-dest-nom'].includes(e.target.id)) majPayeurs();
      majBouton();
    });
    form.addEventListener('change', (e) => {
      if (e.target.closest('[data-ref="supplements"]')) {
        if (e.target.checked) s.supplements.add(e.target.value); else s.supplements.delete(e.target.value);
        recalculer();
      }
      if (e.target.name === 'paye-mode') s.payeMode = e.target.value;
      if (e.target.dataset.ref === 'depart') { s.depart = agence(e.target.value); if (s.arrivee?.id === s.depart.id) s.arrivee = s.agences.find((a) => a.id !== s.depart.id); rendreTrajet(); }
      if (e.target.dataset.ref === 'arrivee') { s.arrivee = agence(e.target.value); rendreTrajet(); }
    });
    form.addEventListener('click', (e) => {
      const mode = e.target.closest('[data-mode]');
      if (mode) {
        s.mode = mode.dataset.mode;
        form.querySelectorAll('[data-mode]').forEach((b) => { b.classList.toggle('actif', b === mode); b.setAttribute('aria-pressed', String(b === mode)); });
        recalculer();
      }
      const payeur = e.target.closest('[data-paye]');
      if (payeur) {
        s.paye = payeur.dataset.paye === '1';
        form.querySelectorAll('[data-paye]').forEach((b) => { b.classList.toggle('actif', b === payeur); b.setAttribute('aria-pressed', String(b === payeur)); });
        ref('modes-paiement').hidden = !s.paye;
      }
      if (e.target.closest('[data-action="inverser"]')) { [s.depart, s.arrivee] = [s.arrivee, s.depart]; rendreTrajet(); }
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); enregistrer(ref('enregistrer')); });
  }

  /** Changement de trajet : sélecteurs, ville de retrait, bureau, tarifs ; la saisie en cours est gardée. */
  function rendreTrajet() {
    const dep = ref('depart');
    const arr = ref('arrivee');
    dep.value = s.depart.id;
    arr.innerHTML = s.agences.filter((a) => a.id !== s.depart.id).map((a) => `<option value="${a.id}" ${a.id === s.arrivee?.id ? 'selected' : ''}>${esc(a.ville || a.nom)} · ${esc(codePays(a))}</option>`).join('');
    ref('retrait').textContent = retraitTexte();
    ref('bureau').textContent = `Bureau de ${s.depart.ville || s.depart.nom}`;
    s.supplements.clear();
    ref('supplements').dataset.signature = '';
    chargerTarifsModes();
  }

  demarrer();
  return () => photos?.arreter();
}

