/**
 * admin.js — Administration YOUMMA (#/admin), réservée à l'équipe de la plateforme
 * (est_admin_plateforme). Recherche des boutiques et ajout de crédit SMS (recharger_sms).
 */
import { sb } from './supabase.js';
import { etat } from './state.js';
import { PACKS_SMS } from './sms.js';
import {
  esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, differer, formatGNF, formatNombre, formatDate,
  formatTelephone, lireNombre, formaterSaisieMontant
} from './utils.js';

export function afficherAdmin(conteneur) {
  const s = { boutiques: [], recherche: '', jeton: 0 };
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);

  conteneur.innerHTML = `
    <div class="page page-admin">
      <header class="page-entete">
        <div class="page-titres">
          <h1>Administration YOUMMA</h1>
          <span>Boutiques de la plateforme et crédit SMS</span>
        </div>
        <label class="recherche-entete recherche-clients">
          ${icone('recherche', 18, 2)}
          <span class="sr-only">Rechercher une boutique</span>
          <input id="recherche-admin" type="search" placeholder="Nom de boutique ou téléphone…" autocomplete="off">
        </label>
      </header>
      <section class="carte carte-admin" aria-label="Boutiques">
        <div class="tableau-cadre">
          <table class="tableau tableau-admin">
            <thead><tr><th>Boutique</th><th>Propriétaire</th><th>Licence</th><th class="droite">SMS</th><th></th></tr></thead>
            <tbody data-zone="lignes"><tr><td colspan="5" class="discret">Chargement…</td></tr></tbody>
          </table>
        </div>
      </section>
    </div>`;

  function render() {
    zone('lignes').innerHTML = s.boutiques.length ? s.boutiques.map((b) => `
      <tr>
        <td><span class="gras">${esc(b.nom)}</span><br><span class="discret">${esc([b.ville, b.telephone ? formatTelephone(b.telephone) : ''].filter(Boolean).join(' · '))}</span></td>
        <td>${esc(b.proprietaire || '—')}<br><span class="discret">${esc(b.tel_proprietaire ? formatTelephone(b.tel_proprietaire) : '')}</span></td>
        <td>${esc(b.licence_formule || '—')}<br><span class="discret">${b.licence_fin ? 'fin ' + esc(formatDate(b.licence_fin, 'court')) : ''}</span></td>
        <td class="droite tres-gras ${Number(b.solde_sms) < 20 ? 'texte-danger' : ''}">${formatNombre(b.solde_sms)}</td>
        <td class="droite"><button type="button" class="btn btn-secondaire btn-petit" data-recharger="${esc(b.id)}">${icone('plus', 16, 2.2)} Ajouter des SMS</button></td>
      </tr>`).join('') : `<tr><td colspan="5" class="discret">Aucune boutique ne correspond${s.recherche ? ` à « ${esc(s.recherche)} »` : ''}.</td></tr>`;
  }

  async function charger() {
    const jeton = ++s.jeton;
    const { data, error } = await sb.rpc('admin_boutiques', { p_recherche: s.recherche.trim() || null });
    if (jeton !== s.jeton) return;
    if (error) { zone('lignes').innerHTML = `<tr><td colspan="5" class="bloc-erreur">${esc(messageErreur(error))}</td></tr>`; return; }
    s.boutiques = data || [];
    render();
  }

  function ouvrirRecharge(boutique) {
    let pack = PACKS_SMS[0];
    const { el, fermer } = ouvrirModale({
      titre: `Ajouter des SMS · ${boutique.nom}`,
      contenu: `
        <form class="form-modale" novalidate>
          <p class="texte-modale">Solde actuel : <strong>${formatNombre(boutique.solde_sms)} SMS</strong></p>
          <div class="packs-sms" role="group" aria-label="Pack">
            ${PACKS_SMS.map((p, i) => `<button type="button" class="pack-sms" data-pack="${i}" aria-pressed="${i === 0}"><span class="pack-nb">${formatNombre(p.nb)} SMS</span><span class="pack-prix">${formatGNF(p.prix)}</span></button>`).join('')}
          </div>
          <div class="rangee-champs">
            <div class="champ"><label for="adm-nb">Nombre de SMS (négatif = correction)</label><input id="adm-nb" name="nb" class="input" type="text" inputmode="numeric" value="${pack.nb}"></div>
            <div class="champ"><label for="adm-montant">Montant payé (GNF)</label><input id="adm-montant" name="montant" class="input input-montant" type="text" inputmode="numeric" value="${formatNombre(pack.prix)}"></div>
          </div>
          <div class="champ"><label for="adm-ref">Référence (ex. n° de transaction Orange Money)</label><input id="adm-ref" name="reference" class="input" type="text" maxlength="80"></div>
          <p class="erreur-form" role="alert" hidden></p>
          <div class="modale-actions">
            <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
            <button type="submit" class="btn btn-primaire">Ajouter les SMS</button>
          </div>
        </form>`
    });
    const formulaire = el.querySelector('form');
    el.addEventListener('click', (e) => {
      const bouton = e.target.closest('[data-pack]');
      if (!bouton) return;
      pack = PACKS_SMS[Number(bouton.dataset.pack)];
      el.querySelectorAll('[data-pack]').forEach((b) => b.setAttribute('aria-pressed', String(b === bouton)));
      formulaire.nb.value = pack.nb;
      formulaire.montant.value = formatNombre(pack.prix);
    });
    formulaire.nb.addEventListener('input', () => el.querySelectorAll('[data-pack]').forEach((b) => b.setAttribute('aria-pressed', 'false')));
    formulaire.montant.addEventListener('input', (e) => formaterSaisieMontant(e.target));
    formulaire.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nb = Math.round(lireNombre(formulaire.nb.value.replace(/\s/g, '')) || 0);
      const zoneErreur = formulaire.querySelector('.erreur-form');
      if (!nb) { zoneErreur.textContent = 'Indiquez un nombre de SMS (différent de 0).'; zoneErreur.hidden = false; return; }
      const bouton = formulaire.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      const { data, error } = await sb.rpc('recharger_sms', {
        p_boutique: boutique.id,
        p_nb: nb,
        p_montant: Math.round(lireNombre(formulaire.montant.value) || 0),
        p_reference: formulaire.reference.value.trim() || null
      });
      if (error) { boutonOccupe(bouton, false); zoneErreur.textContent = messageErreur(error); zoneErreur.hidden = false; return; }
      const solde = Number(Array.isArray(data) ? data[0] : data);
      boutique.solde_sms = Number.isFinite(solde) ? solde : Number(boutique.solde_sms) + nb;
      fermer();
      render();
      toast(`${boutique.nom} : ${nb > 0 ? '+' : ''}${formatNombre(nb)} SMS · nouveau solde ${formatNombre(boutique.solde_sms)} SMS.`, 'succes', 6000);
    });
  }

  conteneur.querySelector('#recherche-admin').addEventListener('input', differer((e) => { s.recherche = e.target.value; charger(); }, 300));
  conteneur.addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-recharger]');
    if (bouton) ouvrirRecharge(s.boutiques.find((b) => b.id === bouton.dataset.recharger));
  });
  if (!etat.adminPlateforme) return;
  charger();
}
