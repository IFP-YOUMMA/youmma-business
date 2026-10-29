/**
 * colis/reglages.js — Réglages de l'activité « logistique » (étape 16), dans Paramètres : trois panneaux de gérant.
 *  - Mes bureaux (table agences) : code, ville, drapeau, adresse, téléphone, horaires, monnaie. Le code devient
 *    non modifiable dès qu'un colis existe pour ce bureau (il est dans les numéros déjà imprimés).
 *  - Mes tarifs (table tarifs_colis) : par trajet et par mode, prix au kilo, minimum, frais fixes, délai, suppléments.
 *  - Le taux du jour (modifier_taux) : 1 FCFA = x GNF, date de mise à jour, rappel au-delà de 7 jours.
 */
import { sb } from '../supabase.js';
import { etat, estGerant } from '../state.js';
import { esc, toast, boutonOccupe, messageErreur, lireNombre, formatNombre, formatDate, ouvrirModale } from '../utils.js';
import { api, chargerAgences, codePays, formatTel, normaliserTel, nomDevise, MODES } from './commun.js';

export function monterReglagesColis(zone) {
  const gerant = estGerant();
  const s = { agences: [], tarifs: [], taux: null, avecColis: new Set() };
  zone.innerHTML = `
    <section class="carte col-reglage" data-zone="bureaux"><span class="squelette" style="height:140px"></span></section>
    <section class="carte col-reglage" data-zone="tarifs"><span class="squelette" style="height:140px"></span></section>
    <section class="carte col-reglage" data-zone="taux"><span class="squelette" style="height:80px"></span></section>`;
  const sous = (n) => zone.querySelector(`[data-zone="${n}"]`);

  async function charger() {
    try {
      const b = etat.boutique.id;
      const [agences, tarifs, taux] = await Promise.all([
        chargerAgences({ forcer: true }),
        sb.from('tarifs_colis').select('id, agence_depart, agence_arrivee, mode, prix_kg, minimum_kg, frais_fixe, delai_jours, devise, supplements, actif').eq('boutique_id', b),
        sb.from('taux_change').select('de, vers, taux, maj_le').eq('boutique_id', b).order('maj_le', { ascending: false }).limit(1)
      ]);
      if (tarifs.error) throw tarifs.error;
      s.agences = agences;
      s.tarifs = tarifs.data || [];
      s.taux = (taux.data || [])[0] || null;
      const comptes = await Promise.all(agences.map((a) => sb.from('colis').select('id', { count: 'exact', head: true }).eq('agence_depart', a.id).then((r) => [a.id, r.count || 0])));
      s.avecColis = new Set(comptes.filter(([, n]) => n > 0).map(([id]) => id));
      if (!zone.isConnected) return;
      renderBureaux(); renderTarifs(); renderTaux();
    } catch (err) {
      zone.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`;
    }
  }

  /* ---------------- Bureaux */

  function renderBureaux() {
    sous('bureaux').innerHTML = `
      <div class="col-carte-entete"><h2>Mes bureaux</h2>${gerant ? '<button type="button" class="btn btn-secondaire btn-petit" data-bureau="">+ Ajouter un bureau</button>' : ''}</div>
      ${s.agences.map((a) => `<div class="col-bureau-ligne">
        <span class="col-pays">${esc(codePays(a))}</span>
        <span class="col-bureau-textes"><strong>${esc(a.code)} · ${esc(a.ville || '')}${a.nom && a.nom !== a.ville ? ` — ${esc(a.nom)}` : ''}</strong>
          <span>${esc([a.adresse, formatTel(a.telephone), a.horaires, nomDevise(a.devise)].filter(Boolean).join(' · '))}</span></span>
        ${gerant ? `<button type="button" class="btn btn-secondaire btn-petit" data-bureau="${esc(a.id)}">Modifier</button>` : ''}
      </div>`).join('') || '<p class="col-vide">Aucun bureau. Ajoutez le bureau de départ et celui d’arrivée.</p>'}
      <p class="discret">Le code (DK, CY…) est au début de chaque numéro de colis : il ne se change plus dès qu’un colis existe.</p>`;
  }

  function modifierBureau(id) {
    const a = s.agences.find((x) => x.id === id) || { code: '', nom: '', ville: '', pays: '', drapeau: '', adresse: '', telephone: '', horaires: '', devise: 'XOF' };
    const codeBloque = s.avecColis.has(a.id);
    const { el, fermer } = ouvrirModale({
      titre: a.id ? `Bureau ${a.code}` : 'Nouveau bureau',
      variante: 'large',
      contenu: `<form class="form-modale" novalidate>
        <div class="rangee-champs">
          <div class="champ"><label for="ag-code">Code</label><input id="ag-code" class="input" maxlength="3" value="${esc(a.code)}" ${codeBloque ? 'readonly' : ''} style="text-transform:uppercase">
            ${codeBloque ? '<small class="aide">Non modifiable : des colis portent déjà ce code dans leur numéro.</small>' : ''}</div>
          <div class="champ"><label for="ag-ville">Ville</label><input id="ag-ville" class="input" maxlength="60" value="${esc(a.ville || '')}"></div>
          <div class="champ"><label for="ag-nom">Nom du bureau</label><input id="ag-nom" class="input" maxlength="80" value="${esc(a.nom || '')}" placeholder="Ex. Bureau de Madina"></div>
        </div>
        <div class="rangee-champs">
          <div class="champ"><label for="ag-pays">Pays</label><input id="ag-pays" class="input" maxlength="40" value="${esc(a.pays || '')}" placeholder="Sénégal"></div>
          <div class="champ"><label for="ag-drapeau">Drapeau</label><input id="ag-drapeau" class="input" maxlength="8" value="${esc(a.drapeau || '')}" placeholder="🇸🇳"></div>
          <div class="champ"><label for="ag-devise">Monnaie</label><select id="ag-devise" class="input"><option value="XOF" ${a.devise === 'XOF' ? 'selected' : ''}>FCFA (XOF)</option><option value="GNF" ${a.devise === 'GNF' ? 'selected' : ''}>GNF</option></select></div>
        </div>
        <div class="champ"><label for="ag-adresse">Adresse</label><input id="ag-adresse" class="input" maxlength="160" value="${esc(a.adresse || '')}"></div>
        <div class="rangee-champs">
          <div class="champ"><label for="ag-tel">Téléphone</label><input id="ag-tel" class="input" type="tel" value="${esc(formatTel(a.telephone))}"></div>
          <div class="champ"><label for="ag-horaires">Horaires</label><input id="ag-horaires" class="input" maxlength="80" value="${esc(a.horaires || '')}" placeholder="Lun–sam, 8 h – 18 h"></div>
        </div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`
    });
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = (sel) => el.querySelector(sel).value.trim();
      const z = el.querySelector('.erreur-form');
      const erreur = (t) => { z.textContent = t; z.hidden = !t; };
      const code = v('#ag-code').toUpperCase();
      if (!/^[A-Z]{2,3}$/.test(code)) return erreur('Code : 2 ou 3 lettres (ex. DK, CY).');
      if (!v('#ag-ville')) return erreur('Indiquez la ville.');
      const tel = v('#ag-tel') ? normaliserTel(v('#ag-tel')) : null;
      if (v('#ag-tel') && !tel) return erreur('Téléphone : numéro sénégalais ou guinéen attendu.');
      const ligne = { nom: v('#ag-nom') || null, ville: v('#ag-ville'), pays: v('#ag-pays') || null, drapeau: v('#ag-drapeau') || null, adresse: v('#ag-adresse') || null, telephone: tel, horaires: v('#ag-horaires') || null, devise: v('#ag-devise') };
      if (!codeBloque) ligne.code = code;
      boutonOccupe(el.querySelector('[type=submit]'), true);
      const r = a.id ? await sb.from('agences').update(ligne).eq('id', a.id) : await sb.from('agences').insert({ ...ligne, boutique_id: etat.boutique.id, actif: true });
      if (r.error) { boutonOccupe(el.querySelector('[type=submit]'), false); return erreur(messageErreur(r.error)); }
      fermer(); toast('Bureau enregistré.', 'succes'); charger();
    });
  }

  /* ---------------- Tarifs */

  function renderTarifs() {

    const trajets = [];
    s.agences.forEach((d) => s.agences.forEach((a) => { if (d.id !== a.id) trajets.push([d, a]); }));
    sous('tarifs').innerHTML = `
      <h2>Mes tarifs</h2>
      ${trajets.map(([d, a]) => `<div class="col-trajet-tarifs"><h3>${esc(d.ville)} → ${esc(a.ville)}</h3>
        <div class="tableau-cadre"><table class="col-tableau">
          <thead><tr><th>Mode</th><th class="droite">Prix au kilo</th><th class="droite">Minimum</th><th class="droite">Frais fixes</th><th class="droite">Délai</th><th>Suppléments</th><th></th></tr></thead>
          <tbody>${Object.entries(MODES).map(([m, lib]) => {
            const t = s.tarifs.find((x) => x.agence_depart === d.id && x.agence_arrivee === a.id && x.mode === m);
            const dev = t?.devise || d.devise;
            return `<tr><td><strong>${esc(lib.libelle)}</strong></td>
              ${t ? `<td class="droite">${formatNombre(t.prix_kg)} ${esc(nomDevise(dev))}</td><td class="droite">${formatNombre(t.minimum_kg, 2)} kg</td><td class="droite">${formatNombre(t.frais_fixe)}</td><td class="droite">${t.delai_jours} j</td>
              <td>${(t.supplements || []).map((x) => `${esc(x.nom)} +${formatNombre(x.montant)}`).join(', ') || '—'}</td>` : '<td colspan="5" class="discret">Pas de tarif</td>'}
              <td>${gerant ? `<button type="button" class="btn btn-secondaire btn-petit" data-tarif="${esc(d.id)}|${esc(a.id)}|${m}">${t ? 'Modifier' : 'Ajouter'}</button>` : ''}</td></tr>`;
          }).join('')}</tbody></table></div></div>`).join('') || '<p class="col-vide">Ajoutez d’abord deux bureaux.</p>'}
      <p class="discret">Le prix d’un colis est toujours calculé par la base à partir de ces tarifs.</p>`;

  }

  function modifierTarif(cle) {
    const [dep, arr, mode] = cle.split('|');
    const d = s.agences.find((a) => a.id === dep);
    const t = s.tarifs.find((x) => x.agence_depart === dep && x.agence_arrivee === arr && x.mode === mode) || { prix_kg: '', minimum_kg: 1, frais_fixe: 0, delai_jours: mode === 'avion' ? 3 : 12, devise: d?.devise || 'XOF', supplements: [] };
    let sup = (t.supplements || []).map((x) => ({ ...x }));
    const { el, fermer } = ouvrirModale({
      titre: `Tarif ${MODES[mode].libelle.toLowerCase()} · ${d?.ville || ''} → ${s.agences.find((a) => a.id === arr)?.ville || ''}`,
      variante: 'large',
      contenu: `<form class="form-modale" novalidate>
        <div class="rangee-champs">
          <div class="champ"><label for="tf-prix">Prix au kilo (${esc(nomDevise(t.devise))})</label><input id="tf-prix" class="input" inputmode="numeric" value="${esc(String(t.prix_kg ?? ''))}"></div>
          <div class="champ"><label for="tf-min">Minimum facturable (kg)</label><input id="tf-min" class="input" inputmode="decimal" value="${esc(String(t.minimum_kg ?? ''))}"></div>
          <div class="champ"><label for="tf-fixe">Frais fixes</label><input id="tf-fixe" class="input" inputmode="numeric" value="${esc(String(t.frais_fixe ?? 0))}"></div>
          <div class="champ"><label for="tf-delai">Délai (jours)</label><input id="tf-delai" class="input" type="number" min="1" value="${esc(String(t.delai_jours ?? ''))}"></div>
        </div>
        <span class="etiquette">Suppléments</span><div data-ref="sup"></div>
        <button type="button" class="btn-ajout-pointille" data-action="ajouter-sup">+ Ajouter un supplément</button>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`
    });
    const lireSup = () => { el.querySelectorAll('[data-sup]').forEach((l) => { sup[Number(l.dataset.sup)] = { nom: l.querySelector('[data-c="nom"]').value.trim(), montant: lireNombre(l.querySelector('[data-c="montant"]').value) || 0 }; }); };
    const rendreSup = () => {
      el.querySelector('[data-ref="sup"]').innerHTML = sup.map((x, i) => `<div class="col-frais-ligne" data-sup="${i}"><input class="input" data-c="nom" value="${esc(x.nom)}" placeholder="Ex. Téléphone"><input class="input droite" data-c="montant" inputmode="numeric" value="${x.montant ? esc(String(x.montant)) : ''}" placeholder="0"><button type="button" class="btn-icone" data-retirer-sup="${i}" aria-label="Retirer">×</button></div>`).join('');
    };
    rendreSup();
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="ajouter-sup"]')) { lireSup(); sup.push({ nom: '', montant: 0 }); rendreSup(); }
      const r = e.target.closest('[data-retirer-sup]');
      if (r) { lireSup(); sup.splice(Number(r.dataset.retirerSup), 1); rendreSup(); }
    });
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      lireSup();
      const z = el.querySelector('.erreur-form');
      const prix = lireNombre(el.querySelector('#tf-prix').value);
      const min = lireNombre(el.querySelector('#tf-min').value);
      const delai = Number(el.querySelector('#tf-delai').value);
      if (!prix || prix <= 0 || min === null || min < 0 || !delai) { z.textContent = 'Prix, minimum et délai sont obligatoires.'; z.hidden = false; return; }
      const ligne = { prix_kg: prix, minimum_kg: min, frais_fixe: lireNombre(el.querySelector('#tf-fixe').value) || 0, delai_jours: delai, supplements: sup.filter((x) => x.nom && x.montant > 0) };
      boutonOccupe(el.querySelector('[type=submit]'), true);
      const r = t.id ? await sb.from('tarifs_colis').update(ligne).eq('id', t.id)
        : await sb.from('tarifs_colis').insert({ ...ligne, boutique_id: etat.boutique.id, agence_depart: dep, agence_arrivee: arr, mode, devise: t.devise, actif: true });
      if (r.error) { boutonOccupe(el.querySelector('[type=submit]'), false); z.textContent = messageErreur(r.error); z.hidden = false; return; }
      fermer(); toast('Tarif enregistré.', 'succes'); charger();
    });
  }

  /* ---------------- Taux */

  function renderTaux() {
    const t = s.taux;
    const jours = t?.maj_le ? Math.floor((Date.now() - new Date(t.maj_le).getTime()) / 864e5) : null;
    sous('taux').innerHTML = `
      <h2>Le taux du jour</h2>
      <div class="col-taux-ligne">
        <span class="col-taux-egal">1 FCFA = <strong class="nombre-gros">${t ? esc(String(t.taux).replace('.', ',')) : '—'}</strong> GNF</span>
        ${gerant ? `<label class="sr-only" for="col-taux-saisie">Nouveau taux</label><input id="col-taux-saisie" class="input" inputmode="decimal" placeholder="${t ? esc(String(t.taux).replace('.', ',')) : '14,5'}">
          <button type="button" class="btn btn-primaire" data-action="taux">Enregistrer</button>` : ''}
      </div>
      <p class="${jours !== null && jours > 7 ? 'col-alerte-taux' : 'discret'}">${t?.maj_le ? `Mis à jour le <strong>${esc(formatDate(t.maj_le, 'long'))}</strong>.` : 'Jamais réglé.'}
        ${jours !== null && jours > 7 ? ` Le taux n’a pas bougé depuis ${jours} jours.` : ''}</p>
      <p class="discret">Un taux oublié, c’est de l’argent perdu à chaque colis payé à l’arrivée. Les colis déjà enregistrés gardent leur montant.</p>`;
  }

  zone.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-bureau]');
    if (b) modifierBureau(b.dataset.bureau);
    const t = e.target.closest('[data-tarif]');
    if (t) modifierTarif(t.dataset.tarif);
    if (e.target.closest('[data-action="taux"]')) {
      const v = lireNombre(zone.querySelector('#col-taux-saisie').value);
      if (!v || v <= 0) { toast('Taux invalide.', 'erreur'); return; }
      const bouton = e.target.closest('button');
      boutonOccupe(bouton, true);
      try { await api.taux('XOF', 'GNF', v); toast('Taux enregistré.', 'succes'); charger(); } catch (err) { boutonOccupe(bouton, false); toast(messageErreur(err), 'erreur'); }
    }
  });
  charger();
}
