/**
 * colis/reglages.js — Réglages de l'activité « logistique » (étape 16), dans Paramètres : trois panneaux de gérant.
 *  - Mes bureaux (table agences) : code, ville, drapeau, adresse, téléphone, horaires, monnaie. Le code devient
 *    non modifiable dès qu'un colis existe pour ce bureau (il est dans les numéros déjà imprimés).
 *  - Mes corridors (table tarifs_colis, étape 18) : un corridor = un bureau de départ + un bureau d'arrivée + un mode.
 *    Prix au kilo, prix au m³, minimum, diviseur volumétrique, délai, jours de départ (ISO 1 = lundi), capacité.
 *  - Mes comptes clients (étape 18) : voir comptes.js.
 *  - Le taux du jour (modifier_taux) : 1 FCFA = x GNF, date de mise à jour, rappel au-delà de 7 jours.
 */
import { sb } from '../supabase.js';
import { etat, estGerant } from '../state.js';
import { esc, toast, boutonOccupe, messageErreur, lireNombre, formatNombre, formatDate, ouvrirModale } from '../utils.js';
import { api, chargerAgences, codePays, formatTel, normaliserTel, nomDevise, MODES, JOURS_ISO } from './commun.js';
import { monterComptesClients } from './comptes.js';

const DIVISEUR_DEFAUT = { avion: 6000, route: 5000, bateau: 5000 };
const COLONNES_TARIF = 'id, nom, agence_depart, agence_arrivee, mode, prix_kg, prix_m3, minimum_kg, frais_fixe, diviseur, delai_jours, jours_depart, capacite_kg, devise, supplements, actif, ordre';

export function monterReglagesColis(zone) {
  const gerant = estGerant();
  const s = { agences: [], tarifs: [], taux: null, avecColis: new Set() };
  zone.innerHTML = `
    <section class="carte col-reglage" data-zone="bureaux"><span class="squelette" style="height:140px"></span></section>
    <section class="carte col-reglage" data-zone="tarifs"><span class="squelette" style="height:140px"></span></section>
    <section class="carte col-reglage" data-zone="taux"><span class="squelette" style="height:80px"></span></section>
    <section class="carte col-reglage" data-zone="comptes"></section>`;
  const sous = (n) => zone.querySelector(`[data-zone="${n}"]`);

  async function charger() {
    try {
      const b = etat.boutique.id;
      const [agences, tarifs, taux] = await Promise.all([
        chargerAgences({ forcer: true }),
        sb.from('tarifs_colis').select(COLONNES_TARIF).eq('boutique_id', b).order('ordre'),
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
      if (!s.comptesMontes) { s.comptesMontes = true; monterComptesClients(sous('comptes'), { titre: 'Mes comptes clients' }); }
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

  /* ---------------- Corridors */

  const ville = (id) => s.agences.find((x) => x.id === id)?.ville || '—';
  const joursTexte = (j) => (j?.length ? JOURS_ISO.filter(([n]) => j.includes(n)).map(([, l]) => l).join(' · ') : 'à la demande');

  function renderTarifs() {
    sous('tarifs').innerHTML = `
      <div class="col-carte-entete"><h2>Mes corridors</h2>${gerant && s.agences.length > 1 ? '<button type="button" class="btn btn-secondaire btn-petit" data-tarif="">+ Ouvrir un corridor</button>' : ''}</div>
      <p class="discret">Un corridor, c’est un bureau de départ, un bureau d’arrivée et un mode (avion, route ou bateau), avec ses prix et ses jours de départ.</p>
      ${s.tarifs.length ? `<div class="tableau-cadre"><table class="col-tableau col-corridors">
        <thead><tr><th>Corridor</th><th class="droite">Prix / kg</th><th class="droite">Prix / m³</th><th class="droite">Minimum</th><th class="droite">Diviseur</th><th class="droite">Délai</th><th>Départs</th><th class="droite">Capacité</th><th></th></tr></thead>
        <tbody>${s.tarifs.map((x) => `<tr class="${x.actif ? '' : 'col-inactif'}">
          <td><strong>${esc(x.nom || `${ville(x.agence_depart)} → ${ville(x.agence_arrivee)}`)}</strong><span class="col-sous">${esc(ville(x.agence_depart))} → ${esc(ville(x.agence_arrivee))} · ${esc(MODES[x.mode]?.libelle || x.mode)}${x.actif ? '' : ' · fermé'}</span></td>
          <td class="droite">${formatNombre(x.prix_kg)} ${esc(nomDevise(x.devise))}</td>
          <td class="droite">${x.prix_m3 ? formatNombre(x.prix_m3) : '—'}</td>
          <td class="droite">${formatNombre(x.minimum_kg, 2)} kg</td>
          <td class="droite">${x.diviseur ? formatNombre(x.diviseur) : '—'}</td>
          <td class="droite">${x.delai_jours ?? '—'} j</td>
          <td>${esc(joursTexte(x.jours_depart))}</td>
          <td class="droite">${x.capacite_kg ? `${formatNombre(x.capacite_kg)} kg` : '—'}</td>
          <td>${gerant ? `<button type="button" class="btn btn-secondaire btn-petit" data-tarif="${esc(x.id)}">Modifier</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="col-vide">${s.agences.length > 1 ? 'Aucun corridor. Ouvrez le premier : Dakar → Conakry par avion, par exemple.' : 'Ajoutez d’abord deux bureaux.'}</p>`}
      <p class="discret">Le diviseur volumétrique transforme le volume en kilos (6 000 pour l’avion, 5 000 pour la route et la mer) : un carton de 60 × 40 × 35 pèse 14 kg « en place » par avion. Le prix est toujours calculé par la base.</p>`;
  }

  function modifierTarif(id) {
    const existant = s.tarifs.find((x) => x.id === id);
    const t = existant || { nom: '', agence_depart: s.agences[0]?.id, agence_arrivee: s.agences[1]?.id, mode: 'avion', prix_kg: '', prix_m3: null, minimum_kg: 1, frais_fixe: 0, diviseur: 6000, delai_jours: 3, jours_depart: [], capacite_kg: null, supplements: [], actif: true };
    let sup = (t.supplements || []).map((x) => ({ ...x }));
    const options = (choisi) => s.agences.map((a) => `<option value="${a.id}" ${a.id === choisi ? 'selected' : ''}>${esc(a.ville || a.nom)}</option>`).join('');
    const { el, fermer } = ouvrirModale({
      titre: existant ? `Corridor ${existant.nom || ''}` : 'Ouvrir un corridor',
      variante: 'large',
      contenu: `<form class="form-modale" novalidate>
        <div class="rangee-champs">
          <div class="champ"><label for="tf-dep">Départ</label><select id="tf-dep" class="input" ${existant ? 'disabled' : ''}>${options(t.agence_depart)}</select></div>
          <div class="champ"><label for="tf-arr">Arrivée</label><select id="tf-arr" class="input" ${existant ? 'disabled' : ''}>${options(t.agence_arrivee)}</select></div>
          <div class="champ"><label for="tf-mode">Mode</label><select id="tf-mode" class="input" ${existant ? 'disabled' : ''}>${Object.entries(MODES).map(([m, x]) => `<option value="${m}" ${m === t.mode ? 'selected' : ''}>${esc(x.libelle)}</option>`).join('')}</select></div>
        </div>
        <div class="champ"><label for="tf-nom">Nom affiché</label><input id="tf-nom" class="input" maxlength="80" value="${esc(t.nom || '')}" placeholder="Ex. Dakar → Conakry · avion"></div>
        <div class="rangee-champs">
          <div class="champ"><label for="tf-prix">Prix au kilo</label><input id="tf-prix" class="input" inputmode="numeric" value="${esc(String(t.prix_kg ?? ''))}"></div>
          <div class="champ"><label for="tf-m3">Prix au m³ (facultatif)</label><input id="tf-m3" class="input" inputmode="numeric" value="${esc(String(t.prix_m3 ?? ''))}"></div>
          <div class="champ"><label for="tf-min">Minimum facturable (kg)</label><input id="tf-min" class="input" inputmode="decimal" value="${esc(String(t.minimum_kg ?? ''))}"></div>
        </div>
        <div class="rangee-champs">
          <div class="champ"><label for="tf-div">Diviseur volumétrique</label><input id="tf-div" class="input" inputmode="numeric" value="${esc(String(t.diviseur ?? ''))}"><small class="aide">6 000 avion · 5 000 route et mer</small></div>
          <div class="champ"><label for="tf-delai">Délai (jours)</label><input id="tf-delai" class="input" type="number" min="1" value="${esc(String(t.delai_jours ?? ''))}"></div>
          <div class="champ"><label for="tf-cap">Capacité du véhicule (kg)</label><input id="tf-cap" class="input" inputmode="numeric" value="${esc(String(t.capacite_kg ?? ''))}"></div>
          <div class="champ"><label for="tf-fixe">Frais fixes</label><input id="tf-fixe" class="input" inputmode="numeric" value="${esc(String(t.frais_fixe ?? 0))}"></div>
        </div>
        <fieldset class="col-jours"><legend class="etiquette">Jours de départ</legend>
          ${JOURS_ISO.map(([n, l]) => `<label class="puce-jour"><input type="checkbox" value="${n}" ${(t.jours_depart || []).includes(n) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>
        <span class="etiquette">Suppléments</span><div data-ref="sup"></div>
        <button type="button" class="btn-ajout-pointille" data-action="ajouter-sup">+ Ajouter un supplément</button>
        <label class="col-case"><input type="checkbox" id="tf-actif" ${t.actif ? 'checked' : ''}> Corridor ouvert</label>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`
    });
    const lireSup = () => { el.querySelectorAll('[data-sup]').forEach((l) => { sup[Number(l.dataset.sup)] = { nom: l.querySelector('[data-c="nom"]').value.trim(), montant: lireNombre(l.querySelector('[data-c="montant"]').value) || 0 }; }); };
    const rendreSup = () => {
      el.querySelector('[data-ref="sup"]').innerHTML = sup.map((x, i) => `<div class="col-frais-ligne" data-sup="${i}"><input class="input" data-c="nom" value="${esc(x.nom)}" placeholder="Ex. Téléphone"><input class="input droite" data-c="montant" inputmode="numeric" value="${x.montant ? esc(String(x.montant)) : ''}" placeholder="0"><button type="button" class="btn-icone" data-retirer-sup="${i}" aria-label="Retirer">×</button></div>`).join('');
    };
    rendreSup();
    // Nouveau corridor : le diviseur suit le mode tant qu'on ne l'a pas changé à la main.
    el.querySelector('#tf-mode').addEventListener('change', (e) => { if (!existant) el.querySelector('#tf-div').value = DIVISEUR_DEFAUT[e.target.value]; });
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="ajouter-sup"]')) { lireSup(); sup.push({ nom: '', montant: 0 }); rendreSup(); }
      const rs = e.target.closest('[data-retirer-sup]');
      if (rs) { lireSup(); sup.splice(Number(rs.dataset.retirerSup), 1); rendreSup(); }
    });
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      lireSup();
      const z = el.querySelector('.erreur-form');
      const v = (sel) => el.querySelector(sel).value;
      const dep = v('#tf-dep');
      const arr = v('#tf-arr');
      const mode = v('#tf-mode');
      const prix = lireNombre(v('#tf-prix'));
      const min = lireNombre(v('#tf-min'));
      const div = lireNombre(v('#tf-div'));
      const delai = Number(v('#tf-delai'));
      if (dep === arr) { z.textContent = 'Le départ et l’arrivée doivent être deux bureaux différents.'; z.hidden = false; return; }
      if (!prix || prix <= 0 || min === null || min < 0 || !div || div <= 0 || !delai) { z.textContent = 'Prix au kilo, minimum, diviseur et délai sont obligatoires.'; z.hidden = false; return; }
      if (!existant && s.tarifs.some((x) => x.agence_depart === dep && x.agence_arrivee === arr && x.mode === mode)) { z.textContent = 'Ce corridor existe déjà : modifiez-le dans la liste.'; z.hidden = false; return; }
      const ligne = {
        nom: v('#tf-nom').trim() || null, prix_kg: prix, prix_m3: lireNombre(v('#tf-m3')) || null, minimum_kg: min, diviseur: Math.round(div), delai_jours: delai,
        capacite_kg: lireNombre(v('#tf-cap')) || null, frais_fixe: lireNombre(v('#tf-fixe')) || 0,
        jours_depart: [...el.querySelectorAll('.col-jours input:checked')].map((c) => Number(c.value)),
        supplements: sup.filter((x) => x.nom && x.montant > 0), actif: el.querySelector('#tf-actif').checked
      };
      boutonOccupe(el.querySelector('[type=submit]'), true);
      const devise = s.agences.find((a) => a.id === dep)?.devise || 'XOF';
      const res = existant ? await sb.from('tarifs_colis').update(ligne).eq('id', existant.id)
        : await sb.from('tarifs_colis').insert({ ...ligne, boutique_id: etat.boutique.id, agence_depart: dep, agence_arrivee: arr, mode, devise, ordre: s.tarifs.length + 1 });
      if (res.error) { boutonOccupe(el.querySelector('[type=submit]'), false); z.textContent = messageErreur(res.error); z.hidden = false; return; }
      fermer(); toast('Corridor enregistré.', 'succes'); charger();
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
    if (t) modifierTarif(t.dataset.tarif || null);
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
