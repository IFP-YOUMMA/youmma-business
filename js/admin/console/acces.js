/**
 * admin/console/acces.js — Les accès à la console (étape 19, maquette DirectionAcces), #/acces.
 *
 * Page présente seulement si console_accueil().moi.peut_gerer_acces : pour les autres, la route renvoie à l'accueil
 * sans aucun appel. console_acces() liste qui entre ; console_ouvrir_acces(p_telephone, p_nom, p_role, p_portee,
 * p_ville) n'envoie aucun SMS : elle renvoie { acces, prevenir: { tel, texte } } et la console propose un bouton
 * WhatsApp avec ce texte, relu avant l'envoi. console_fermer_acces(p_user) ; la base refuse de fermer le super
 * administrateur (SUPER_ADMIN_PROTEGE) ou son propre accès (PAS_SOI_MEME), et d'en créer un second (SUPER_ADMIN_UNIQUE).
 */
import { esc, icone, ouvrirModale, boutonOccupe, confirmer, toast, formatDate } from '../../utils.js';
import { rpc, initiales, telLocal, lienWa } from '../commun.js';
import { espaces, entete, erreurConsole, telInternational } from './commun.js';

const ROLES = { super_admin: 'Super administrateur', admin_espace: 'Administrateur', agent: 'Agent' };

/** Ce que chaque rôle voit et peut faire (texte de la maquette ; les droits eux-mêmes sont décidés par la base). */
function droits(a) {
  const nomEspace = a.espace_nom || 'son espace';
  if (a.role === 'super_admin') {
    return [[true, 'Tous les espaces — tout, y compris l’argent'], [true, 'Les licences de Guinée — recettes, relances, suspensions'],
      [true, 'Ouvrir et fermer les accès des autres'], [true, 'Changer les tarifs, les commissions, les taux'], [true, 'Supprimer une boutique ou un vendeur']];
  }
  if (a.role === 'admin_espace') {
    return [[true, `${nomEspace} — vendeurs, commandes, commissions, affiches`], [true, `L’argent de ${nomEspace} — recettes et partage`],
      [false, 'Les licences de Guinée — invisibles'], [false, 'Ouvrir un accès ou changer les droits'], [false, 'Supprimer une boutique ou un vendeur']];
  }
  return [[true, a.portee === 'tout' ? 'Les boutiques de tous les espaces, pour les aider' : `Les boutiques de ${nomEspace}`],
    [true, 'Enregistrer un paiement, que le super administrateur valide'], [false, 'Ouvrir un accès ou changer les droits'], [false, 'Supprimer une boutique ou un vendeur']];
}

function carte(a) {
  const ferme = a.actif === false;
  const fermable = !a.est_moi && a.role !== 'super_admin' && !ferme;
  const ton = a.role === 'super_admin' ? 'violet' : a.role === 'admin_espace' ? 'vert' : 'gris';
  const espaceRole = a.portee && a.portee !== 'tout' ? espaces().find((e) => e.code === a.portee) : null;
  return `<article class="carte cs-acces ${ferme ? 'ferme' : ''}" ${espaceRole ? `style="--cs-couleur:${esc(espaceRole.couleur)}"` : ''}>
    <div class="cs-acces-tete">
      <span class="cs-avatar-acces ${ton}">${esc(initiales(a.nom))}</span>
      <div class="cs-acces-nom"><strong>${esc(a.nom || '—')}${a.est_moi ? ' <small>(vous)</small>' : ''}</strong>
        <span>${esc([a.ville, a.telephone ? telLocal(a.telephone) : '', a.created_at ? `depuis le ${formatDate(a.created_at, 'court')}` : ''].filter(Boolean).join(' · '))}</span></div>
      <span class="pastille-admin ${ton}">${esc(ROLES[a.role] || a.role)}${a.role === 'admin_espace' && a.espace_nom ? ` — ${esc(a.espace_nom)}` : ''}</span>
    </div>
    <div class="cs-acces-corps">
      <span class="etiquette-carte">Ce qu’il voit et ce qu’il peut faire</span>
      <ul class="cs-droits">${droits(a).map(([oui, texte]) => `<li class="${oui ? 'oui' : 'non'}">${icone(oui ? 'valide' : 'fermer', 14, 2.4)}<span>${esc(texte)}</span></li>`).join('')}</ul>
    </div>
    ${a.role === 'super_admin' ? '<p class="cs-acces-pied violet"><strong>C’est le seul compte qui peut tout.</strong> Il n’y en a qu’un, et il ne se partage pas : si deux personnes utilisent le même, vous ne saurez jamais qui a fait quoi.</p>' : ''}
    ${a.role === 'admin_espace' ? '<p class="cs-acces-pied vert">Il voit tout de votre affaire commune, <strong>argent compris</strong> — c’est la sienne autant que la vôtre. Ce qu’il ne peut pas faire, c’est effacer et donner des droits.</p>' : ''}
    ${ferme ? '<p class="cs-acces-pied">Accès fermé.</p>' : ''}
    ${fermable ? `<div class="cs-actions-bloc"><button type="button" class="btn btn-secondaire cs-btn-danger" data-fermer-acces="${esc(a.user_id)}" data-nom="${esc(a.nom || '')}">Fermer son accès</button></div>` : ''}
  </article>`;
}

const TABLEAU_ROLES = [
  ['Recevoir et peser la marchandise', 'o', 'o', 'o', 'o'],
  ['Encaisser un versement', 'o', 'o', 'o', 'o'],
  ['Créer un envoi, le faire partir', 'o', 'o', 'b', 'x'],
  ['Payer un vendeur', 'o', 'o', 'x', 'x'],
  ['Voir les recettes des affaires communes', 'o', 'o', 'b', 'x'],
  ['Changer un tarif ou une commission', 'o', 'o', 'x', 'x'],
  ['Voir les licences de Guinée', 'o', 'x', 'x', 'x'],
  ['Ouvrir ou fermer un accès', 'o', 'x', 'x', 'x'],
  ['Supprimer une boutique ou un colis', 'o', 'x', 'x', 'x']
];
const caseRole = (v) => (v === 'o' ? `<span class="cs-oui" aria-label="oui">${icone('valide', 16, 2.4)}</span>` : v === 'b' ? '<span class="cs-son-bureau">Son bureau</span>' : `<span class="cs-non" aria-label="non">${icone('fermer', 14, 2)}</span>`);

export function afficherAcces(conteneur) {
  conteneur.innerHTML = `
    <div class="cs-page">
      ${entete({ titre: 'Les accès', sous: 'Qui entre dans la console, et jusqu’où', couleur: '#0A3D33', actions: `<button type="button" class="cs-btn-entete" data-action="ajouter">${icone('plus', 16, 2)} Ajouter un accès</button>` })}
      <div class="cs-grille-acces" data-zone="acces"><span class="squelette" style="height:280px"></span></div>
      <section class="carte cs-roles">
        <div class="cs-bloc-tete"><h2>Les rôles que vous pouvez donner</h2><span class="discret">Un employé du bureau n’est pas un administrateur</span></div>
        <div class="tableau-adm-cadre"><table class="tableau-adm cs-tableau-roles">
          <thead><tr><th>Peut…</th><th>Super admin</th><th>Admin d’un espace</th><th>Chef de bureau</th><th>Employé</th></tr></thead>
          <tbody>${TABLEAU_ROLES.map(([t, ...c]) => `<tr><td data-label="Peut…">${esc(t)}</td>${c.map((v, i) => `<td data-label="${['Super admin', 'Admin d’un espace', 'Chef de bureau', 'Employé'][i]}">${caseRole(v)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
      </section>
      <div class="cs-encarts">
        <section class="carte cs-encart cs-encart-jaune"><h2>Un compte par personne, jamais un compte partagé</h2>
          <p>Le jour où un versement manque, la seule question qui compte est « qui l’a encaissé ». Avec un compte partagé entre trois employés, cette question n’a pas de réponse, et vous vous retrouvez à soupçonner trois personnes au lieu d’en interroger une.</p></section>
        <section class="carte cs-encart"><h2>Ce qui se passe si vous perdez votre téléphone</h2>
          <p>Le super administrateur est unique : personne, pas même votre associé, ne peut le remplacer depuis l’application. Gardez un deuxième moyen de vous reconnecter — un numéro de secours — sinon il faudra passer par nous pour rouvrir la porte.</p>
          <div class="cs-secours" data-zone="secours"></div></section>
      </div>
    </div>`;
  const zone = conteneur.querySelector('[data-zone="acces"]');
  const rendre = (acces) => {
    const tri = [...(acces || [])].sort((a, b) => ['super_admin', 'admin_espace', 'agent'].indexOf(a.role) - ['super_admin', 'admin_espace', 'agent'].indexOf(b.role) || Number(b.actif !== false) - Number(a.actif !== false));
    zone.innerHTML = tri.map(carte).join('') || '<p class="col-vide">Aucun accès.</p>';
  };
  const charger = async () => {
    try { rendre(await rpc('console_acces')); } catch (err) { zone.innerHTML = `<p class="bloc-erreur">${esc(erreurConsole(err))}</p>`; }
  };

  // Numéro de secours : mon_acces() dit s'il manque ; numero_de_secours(p_telephone) l'enregistre.
  const zoneSecours = conteneur.querySelector('[data-zone="secours"]');
  const secours = async () => {
    try {
      const m = await rpc('mon_acces');
      zoneSecours.innerHTML = m?.secours_manquant || !m?.tel_secours
        ? `<p class="cs-secours-manque">${icone('alerte', 16, 2)} Aucun numéro de secours enregistré.</p>
           <button type="button" class="btn btn-secondaire btn-bloc" data-action="secours">${icone('telephone', 18, 2)} Enregistrer un numéro de secours</button>`
        : `<p class="cs-secours-ok">${icone('valide', 16, 2.4)} Numéro de secours : <strong>${esc(telLocal(m.tel_secours))}</strong></p>
           <button type="button" class="btn btn-secondaire btn-bloc" data-action="secours">Changer le numéro de secours</button>`;
    } catch (err) { zoneSecours.innerHTML = `<p class="bloc-erreur">${esc(erreurConsole(err))}</p>`; }
  };
  secours();

  conteneur.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-action="ajouter"]')) { ouvrirAjout(rendre); return; }
    if (ev.target.closest('[data-action="secours"]')) { ouvrirSecours(secours); return; }
    const b = ev.target.closest('[data-fermer-acces]');
    if (b) {
      if (!(await confirmer(`Fermer l’accès de ${b.dataset.nom || 'cette personne'} à la console ? Son compte de l’application reste ouvert.`, { titre: 'Fermer un accès', libelleOk: 'Fermer l’accès', danger: true }))) return;
      try { await rpc('console_fermer_acces', { p_user: b.dataset.fermerAcces }); toast('Accès fermé.', 'succes'); charger(); } catch (err) { toast(erreurConsole(err), 'erreur'); }
    }
  });
  charger();
}

function ouvrirAjout(rendre) {
  const { el, fermer } = ouvrirModale({
    titre: 'Ajouter un accès',
    contenu: `
      <form class="form-modale" novalidate>
        <p class="texte-modale">La personne doit avoir déjà ouvert l’application une fois avec ce numéro. Aucun SMS n’est envoyé : vous la prévenez vous-même par WhatsApp.</p>
        <div class="rangee-champs">
          <div class="champ"><label for="ac-tel">Téléphone</label><input id="ac-tel" class="input" type="tel" inputmode="tel" placeholder="620 00 00 00 ou +221 77…" required></div>
          <div class="champ"><label for="ac-nom">Nom</label><input id="ac-nom" class="input" type="text" maxlength="80" required></div>
        </div>
        <div class="rangee-champs">
          <div class="champ"><label for="ac-role">Rôle</label><select id="ac-role" class="input">
            <option value="admin_espace">Administrateur d’un espace</option>
            <option value="agent">Agent</option>
            <option value="super_admin">Super administrateur (il n’y en a qu’un)</option>
          </select></div>
          <div class="champ"><label for="ac-portee">Espace</label><select id="ac-portee" class="input">
            ${espaces().map((e) => `<option value="${esc(e.code)}">${esc(e.nom_public)}</option>`).join('')}
            <option value="tout" data-agent>Tous les espaces</option>
          </select></div>
        </div>
        <div class="champ"><label for="ac-ville">Ville (facultatif)</label><input id="ac-ville" class="input" type="text" maxlength="60" placeholder="Dakar"></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Ouvrir l’accès</button></div>
      </form>`
  });
  const q = (s) => el.querySelector(s);
  const erreur = (m) => { const z = q('.erreur-form'); z.textContent = m; z.hidden = !m; };
  const majPortee = () => {
    const role = q('#ac-role').value;
    const tout = q('#ac-portee [data-agent]');
    tout.hidden = role === 'admin_espace';
    if (role === 'admin_espace' && q('#ac-portee').value === 'tout') q('#ac-portee').selectedIndex = 0;
  };
  q('#ac-role').addEventListener('change', majPortee);
  majPortee();
  q('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    erreur('');
    const tel = telInternational(q('#ac-tel').value);
    const nom = q('#ac-nom').value.trim();
    if (!tel) { erreur('Numéro invalide. Un numéro étranger commence par son indicatif (+221, +225…).'); return; }
    if (!nom) { erreur('Indiquez le nom de la personne.'); return; }
    const bouton = q('[type=submit]');
    boutonOccupe(bouton, true, 'Ouverture…');
    try {
      const r = await rpc('console_ouvrir_acces', { p_telephone: tel, p_nom: nom, p_role: q('#ac-role').value, p_portee: q('#ac-portee').value, p_ville: q('#ac-ville').value.trim() || null });
      fermer();
      rendre(r?.acces || []);
      if (r?.prevenir) afficherPrevenir(r.prevenir);
    } catch (err) {
      boutonOccupe(bouton, false);
      erreur(erreurConsole(err));
    }
  });
}

function ouvrirSecours(apres) {
  const { el, fermer } = ouvrirModale({
    titre: 'Numéro de secours',
    contenu: `
      <form class="form-modale" novalidate>
        <p class="texte-modale">Un deuxième numéro, à vous, pour vous reconnecter si vous perdez votre téléphone. Pas celui d’un employé.</p>
        <div class="champ"><label for="sc-tel">Téléphone de secours</label><input id="sc-tel" class="input" type="tel" inputmode="tel" placeholder="620 00 00 00" required></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`
  });
  el.querySelector('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const z = el.querySelector('.erreur-form');
    const tel = telInternational(el.querySelector('#sc-tel').value);
    if (!tel) { z.textContent = 'Numéro invalide.'; z.hidden = false; return; }
    const bouton = el.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Enregistrement…');
    try { await rpc('numero_de_secours', { p_telephone: tel }); fermer(); toast('Numéro de secours enregistré.', 'succes'); apres(); } catch (err) { boutonOccupe(bouton, false); z.textContent = erreurConsole(err); z.hidden = false; }
  });
}

/** Le texte que la base a préparé, à relire, puis WhatsApp. */
function afficherPrevenir(p) {
  ouvrirModale({
    titre: 'Accès ouvert — prévenez la personne',
    contenu: `
      <p class="texte-modale">Relisez le message avant de l’envoyer. Il part de votre WhatsApp, pas par SMS.</p>
      <blockquote class="cs-message-prevenir">${esc(p.texte || '')}</blockquote>
      <p class="discret">À : <strong>${esc(telLocal(p.tel))}</strong></p>
      <div class="modale-actions">
        <button type="button" class="btn btn-secondaire" data-fermer>Plus tard</button>
        <a class="btn btn-whatsapp" href="${esc(lienWa(p.tel, p.texte || ''))}" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} Envoyer sur WhatsApp</a>
      </div>`
  });
}
