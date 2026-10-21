/**
 * admin/fetes.js — Plateforme › Fêtes (étape 15) : la liste de la table « fetes » (affiches de fête préparées
 * d'avance). Les dates « approximatif » (fêtes musulmanes, selon la lune) sont en orange « à confirmer » ;
 * le super admin corrige la date, le nom, le message et l'émoji (admin_fete). Les agents consultent.
 */
import { sb } from '../supabase.js';
import { esc, toast, ouvrirModale, boutonOccupe, formatDate } from '../utils.js';
import { estSuper, rpc, erreurAdmin, blocErreur, squelette } from './commun.js';

export function afficherFetes(conteneur) {
  const modif = estSuper();
  conteneur.innerHTML = `
    <header class="adm-entete"><div class="adm-titres"><h1>Fêtes</h1>
      <span class="discret">Affiches de fête préparées d’avance pour toutes les boutiques. Les dates qui dépendent de la lune sont à confirmer chaque année.</span></div></header>
    <section class="adm-carte" data-zone="liste">${squelette(6)}</section>`;
  const zone = conteneur.querySelector('[data-zone="liste"]');
  let fetes = [];

  async function charger() {
    const { data, error } = await sb.from('fetes').select('*').order('jour');
    if (!conteneur.isConnected) return;
    if (error) { zone.innerHTML = blocErreur(error); return; }
    fetes = data || [];
    const aConfirmer = fetes.filter((f) => f.approximatif).length;
    zone.innerHTML = `
      ${aConfirmer ? `<p class="adm-fetes-alerte">${aConfirmer} date${aConfirmer > 1 ? 's' : ''} à confirmer (lune) : corrigez-les dès que la date officielle est annoncée.</p>` : ''}
      <div class="tableau-adm-cadre"><table class="tableau-adm">
        <thead><tr><th>Date</th><th>Fête</th><th>Message</th><th class="droite"></th></tr></thead>
        <tbody>${fetes.map((f) => `
          <tr class="${f.approximatif ? 'adm-fete-approx' : ''}">
            <td data-label="Date"><strong>${esc(formatDate(`${String(f.jour).slice(0, 10)}T12:00:00Z`, 'long'))}</strong>${f.approximatif ? ' <span class="pastille-admin orange">à confirmer</span>' : ''}</td>
            <td data-label="Fête">${esc(f.emoji || '')} ${esc(f.nom || '')}</td>
            <td data-label="Message" class="discret">${esc(f.message || '')}</td>
            <td class="droite">${modif ? `<button type="button" class="btn btn-secondaire btn-petit" data-corriger="${esc(f.id ?? f.jour)}">Corriger</button>` : ''}</td>
          </tr>`).join('') || '<tr><td colspan="4" class="vide-admin">Aucune fête.</td></tr>'}</tbody>
      </table></div>
      ${modif ? '' : '<p class="aide">Lecture seule : seul le super admin corrige les fêtes.</p>'}`;
  }

  function corriger(cle) {
    const f = fetes.find((x) => String(x.id ?? x.jour) === String(cle));
    if (!f) return;
    const { el, fermer } = ouvrirModale({
      titre: `Corriger : ${f.nom || 'fête'}`,
      contenu: `<form class="form-modale" novalidate>
        <div class="rangee-champs">
          <div class="champ"><label for="fe-jour">Date</label><input id="fe-jour" class="input" type="date" value="${esc(String(f.jour).slice(0, 10))}" required></div>
          <div class="champ"><label for="fe-emoji">Émoji</label><input id="fe-emoji" class="input" maxlength="4" value="${esc(f.emoji || '')}"></div>
        </div>
        <div class="champ"><label for="fe-nom">Nom</label><input id="fe-nom" class="input" maxlength="60" value="${esc(f.nom || '')}" required></div>
        <div class="champ"><label for="fe-message">Message de l’affiche</label><textarea id="fe-message" class="input" rows="3" maxlength="200">${esc(f.message || '')}</textarea></div>
        <label class="case-option"><input type="checkbox" id="fe-approx" ${f.approximatif ? 'checked' : ''}> Date encore à confirmer (lune)</label>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`
    });
    const form = el.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const z = form.querySelector('.erreur-form');
      const jour = form.querySelector('#fe-jour').value;
      const nom = form.querySelector('#fe-nom').value.trim();
      if (!jour || !nom) { z.textContent = 'La date et le nom sont obligatoires.'; z.hidden = false; return; }
      const bouton = form.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      try {
        await rpc('admin_fete', {
          p_id: f.id ?? null, p_jour: jour, p_nom: nom, p_message: form.querySelector('#fe-message').value.trim() || null,
          p_emoji: form.querySelector('#fe-emoji').value.trim() || null, p_approximatif: form.querySelector('#fe-approx').checked
        });
        fermer();
        toast('Fête enregistrée. Les plans des boutiques suivront au prochain calcul.', 'succes');
        charger();
      } catch (err) { boutonOccupe(bouton, false); z.textContent = erreurAdmin(err); z.hidden = false; }
    });
  }

  zone.addEventListener('click', (e) => { const b = e.target.closest('[data-corriger]'); if (b) corriger(b.dataset.corriger); });
  charger();
}
