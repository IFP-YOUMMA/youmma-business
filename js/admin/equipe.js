/**
 * admin/equipe.js — Équipe YOUMMA & journal (maquette AdminPlateforme.dc.html) : membres de l'équipe
 * (rôle, dernière connexion ; ajouter par téléphone, changer de rôle, désactiver — super admin ; le
 * dernier super admin est protégé côté serveur), rappel des droits de l'agent, journal des actions.
 */
import { esc, icone, toast, confirmer, ouvrirModale, boutonOccupe, formatDate, normaliserTelephone } from '../utils.js';
import { admin, estSuper, rpc, champ, liste, erreurAdmin, ilYa, telLocal, libelleAction, detailsAction, blocErreur, squelette } from './commun.js';

const ROLES = { super_admin: 'Super admin', agent: 'Agent' };

export function afficherEquipe(conteneur) {
  const s = { equipe: [], boutique: null };
  conteneur.innerHTML = `
    <header class="adm-entete"><div class="adm-titres"><h1>Équipe &amp; journal</h1><span class="discret">Qui a accès au panneau, et tout ce qui a été fait</span></div></header>
    <div class="adm-rangee">
      <section class="adm-carte adm-moitie">
        <div class="adm-carte-entete"><h2>Équipe YOUMMA</h2>${estSuper() ? `<button type="button" class="btn btn-secondaire btn-petit" data-action="ajouter">${icone('plus', 16, 2.4)} Ajouter</button>` : ''}</div>
        <div data-zone="equipe">${squelette(3)}</div>
        <p class="discret adm-droits"><strong>Super admin</strong> : tout. <strong>Agent</strong> : voir, prolonger un essai, enregistrer un paiement à valider, ajouter des SMS (1 000 max.), note interne, relances, support, nouveau mot de passe. Pas de prix, pas de validation de paiement, pas de suspension, pas d’annonces, pas d’équipe ni de paramètres.</p>
      </section>
      <section class="adm-carte adm-moitie">
        <div class="adm-carte-entete"><h2>Journal des actions admin</h2>
          <span class="discret" data-ref="filtre-journal"></span></div>
        <div data-zone="journal">${squelette(5)}</div>
      </section>
    </div>`;
  const zone = (n) => conteneur.querySelector(`[data-zone="${n}"]`);

  async function chargerEquipe() {
    try {
      s.equipe = liste(await rpc('admin_equipe'), 'lignes');
      if (!conteneur.isConnected) return;
      zone('equipe').innerHTML = s.equipe.length ? `<ul class="adm-liste-equipe">${s.equipe.map((m) => `
        <li class="${m.actif === false ? 'inactif' : ''}">
          <span class="adm-ligne-textes"><strong>${esc(m.nom || '—')}${m.user_id === admin.moi?.user_id ? ' (vous)' : ''}</strong>
            <span class="discret">${esc(telLocal(m.telephone))} · ${m.actif === false ? 'désactivé' : `vu ${esc(ilYa(champ(m, 'derniere_connexion', 'last_sign_in_at')))}`}</span></span>
          <span class="pastille-admin ${m.role === 'super_admin' ? 'nuit' : 'bleu'}">${esc(ROLES[m.role] || m.role)}</span>
          ${estSuper() && m.user_id !== admin.moi?.user_id ? `<button type="button" class="btn btn-secondaire btn-petit" data-modifier="${esc(m.user_id)}">Modifier</button>` : ''}
        </li>`).join('')}</ul>` : '<p class="vide-admin">Aucun membre.</p>';
    } catch (err) { zone('equipe').innerHTML = blocErreur(err); }
  }

  async function chargerJournal() {
    try {
      const lignes = liste(await rpc('admin_journal', { p_limite: 100, p_boutique: s.boutique?.id || null }), 'lignes');
      if (!conteneur.isConnected) return;
      conteneur.querySelector('[data-ref="filtre-journal"]').innerHTML = s.boutique ? `${esc(s.boutique.nom)} · <button type="button" class="btn-lien" data-action="tout-journal">tout voir</button>` : '';
      zone('journal').innerHTML = lignes.length ? `<ul class="adm-journal">${lignes.map((j) => `
        <li><span class="discret">${esc(formatDate(j.created_at, 'complet'))}</span>
          <span class="gras">${esc(champ(j, 'admin_nom', 'par', 'auteur') || '')}</span>
          <span>${champ(j, 'boutique_nom') ? `<button type="button" class="btn-lien" data-filtre-boutique="${esc(j.boutique_id)}" data-nom="${esc(j.boutique_nom)}">${esc(j.boutique_nom)}</button> : ` : ''}${esc(libelleAction(j.action))}${detailsAction(j.details) ? ` · ${esc(detailsAction(j.details))}` : ''}</span></li>`).join('')}</ul>`
        : '<p class="vide-admin">Aucune action.</p>';
    } catch (err) { zone('journal').innerHTML = blocErreur(err); }
  }

  function ouvrirAjout() {
    const { el, fermer } = ouvrirModale({
      titre: 'Ajouter un membre à l’équipe YOUMMA',
      contenu: `
        <form class="form-modale" novalidate>
          <p class="texte-modale">La personne doit déjà avoir un compte YOUMMA Business (créé depuis l’appli avec son téléphone).</p>
          <div class="champ"><label for="eq-tel">Téléphone</label><input id="eq-tel" class="input" type="tel" inputmode="tel" placeholder="620 00 00 00" required></div>
          <div class="champ"><label for="eq-nom">Nom</label><input id="eq-nom" class="input" type="text" maxlength="80" required></div>
          <div class="champ"><label for="eq-role">Rôle</label><select id="eq-role" class="input"><option value="agent">Agent</option><option value="super_admin">Super admin</option></select></div>
          <p class="erreur-form" role="alert" hidden></p>
          <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Ajouter</button></div>
        </form>`
    });
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const z = el.querySelector('.erreur-form');
      const tel = normaliserTelephone(el.querySelector('#eq-tel').value);
      const nom = el.querySelector('#eq-nom').value.trim();
      if (!tel) { z.textContent = 'Numéro invalide.'; z.hidden = false; return; }
      if (nom.length < 2) { z.textContent = 'Indiquez le nom.'; z.hidden = false; return; }
      const bouton = e.target.querySelector('[type=submit]');
      boutonOccupe(bouton, true, '…');
      try { await rpc('admin_ajouter_membre_equipe', { p_telephone: tel, p_nom: nom, p_role: el.querySelector('#eq-role').value }); fermer(); toast(`${nom} ajouté(e) à l’équipe.`, 'succes'); chargerEquipe(); chargerJournal(); }
      catch (err) { boutonOccupe(bouton, false); z.textContent = erreurAdmin(err); z.hidden = false; }
    });
  }

  function ouvrirModification(m) {
    const { el, fermer } = ouvrirModale({
      titre: `Modifier ${m.nom || 'le membre'}`,
      contenu: `
        <form class="form-modale" novalidate>
          <div class="champ"><label for="eqm-role">Rôle</label><select id="eqm-role" class="input">${Object.entries(ROLES).map(([c, l]) => `<option value="${c}" ${c === m.role ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <label class="case-option"><input type="checkbox" id="eqm-actif" ${m.actif === false ? '' : 'checked'}> Accès au panneau actif</label>
          <p class="erreur-form" role="alert" hidden></p>
          <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
        </form>`
    });
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const actif = el.querySelector('#eqm-actif').checked;
      if (!actif && !(await confirmer(`Désactiver l’accès de ${m.nom || 'ce membre'} au panneau ?`, { titre: 'Désactiver', libelleOk: 'Désactiver', danger: true }))) return;
      const z = el.querySelector('.erreur-form');
      const bouton = e.target.querySelector('[type=submit]');
      boutonOccupe(bouton, true, '…');
      try { await rpc('admin_modifier_membre_equipe', { p_user: m.user_id, p_role: el.querySelector('#eqm-role').value, p_actif: actif }); fermer(); toast('Membre mis à jour.', 'succes'); chargerEquipe(); chargerJournal(); }
      catch (err) { boutonOccupe(bouton, false); z.textContent = erreurAdmin(err); z.hidden = false; }
    });
  }

  conteneur.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'ajouter') ouvrirAjout();
    if (action === 'tout-journal') { s.boutique = null; chargerJournal(); }
    const m = e.target.closest('[data-modifier]');
    if (m) ouvrirModification(s.equipe.find((x) => x.user_id === m.dataset.modifier));
    const f = e.target.closest('[data-filtre-boutique]');
    if (f) { s.boutique = { id: f.dataset.filtreBoutique, nom: f.dataset.nom }; chargerJournal(); }
  });
  chargerEquipe();
  chargerJournal();
}
