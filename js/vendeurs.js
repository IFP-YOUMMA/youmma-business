/**
 * vendeurs.js — Page Vendeurs (maquette Vendeurs.dc.html) : équipe et ventes de chacun,
 * gestion des membres (⋮), invitations par code (création, envoi WhatsApp, annulation).
 *
 * Toutes les écritures passent par des fonctions serveur :
 * creer_invitation, annuler_invitation, modifier_membre.
 */
import { sb } from './supabase.js';
import { etat, utilisateur, peut, estProprietaire, LIBELLES_ROLES } from './state.js';
import {
  esc, icone, toast, confirmer, ouvrirModale, boutonOccupe, messageErreur, initiales, prenom,
  formatGNF, formatDate, formatTelephone, normaliserTelephone, bornesPeriode, chargerParLots, copierTexte
} from './utils.js';

const ADRESSE_APPLI = 'https://ifp-youmma.github.io/youmma-business/';
const ORDRE_ROLES = { proprietaire: 0, gerant: 1, vendeur: 2 };
const DESCRIPTIONS_ROLES = {
  vendeur: 'Vend à la caisse, encaisse les remboursements, ajoute des clients et des dépenses. Ne voit ni les prix d’achat, ni le chiffre d’affaires global. Ne peut ni annuler une vente, ni modifier le stock.',
  gerant: 'Tous les droits du vendeur, plus : stock, annulation des ventes, suppression des dépenses, rapports et gestion de l’équipe.'
};

const estMobile = () => window.matchMedia('(max-width: 899.98px)').matches;

/** « 482913 » → « 482 913 ». */
function formatCode(code) {
  const c = String(code).padStart(6, '0');
  return `${c.slice(0, 3)} ${c.slice(3)}`;
}

/** Message d'invitation envoyé sur WhatsApp. */
function messageInvitation(nom, code) {
  return `Bonjour ${nom}, je vous invite à rejoindre la boutique ${etat.boutique.nom} sur YOUMMA Business. `
    + `1) Ouvrez ${ADRESSE_APPLI} 2) Créez votre compte avec votre numéro `
    + `3) Choisissez « J'ai un code d'invitation » et tapez : ${formatCode(code)}. Ce code est valable 3 jours.`;
}

/** Lien WhatsApp vers le numéro de la personne (ou sans numéro : choix du contact dans WhatsApp). */
function lienWhatsAppInvitation(telephone, nom, code) {
  return `https://wa.me/${telephone ? normaliserTelephone(telephone) || '' : ''}?text=${encodeURIComponent(messageInvitation(nom, code))}`;
}

/** « Expire dans 2 jours » / « 5 heures » / « moins d'une heure ». */
function texteExpiration(expireAt) {
  const restantMs = new Date(expireAt).getTime() - Date.now();
  const heures = Math.floor(restantMs / 3600000);
  if (heures >= 24) {
    const n = Math.floor(heures / 24);
    return `Expire dans ${n} jour${n > 1 ? 's' : ''}`;
  }
  if (heures >= 1) return `Expire dans ${heures} heure${heures > 1 ? 's' : ''}`;
  return 'Expire dans moins d’une heure';
}

export function afficherVendeurs(conteneur) {
  const boutique = etat.boutique;
  const moi = utilisateur()?.id;
  const s = { membres: [], ventes: new Map(), invitations: [], periode: 'jour' };
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);

  conteneur.innerHTML = `
    <div class="page page-vendeurs">
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour seul-ordi" href="#/aujourdhui">← Aujourd’hui</a>
          <h1>Vendeurs</h1>
          <span>Votre équipe et ses ventes · ${esc(boutique.nom)}</span>
        </div>
        <button type="button" class="btn btn-primaire" data-action="inviter">${icone('inviter', 18, 2.2)} Inviter un vendeur</button>
      </header>

      <div class="clients-corps">
        <div class="vendeurs-gauche">
          <section class="carte equipe" aria-labelledby="titre-equipe">
            <div class="bloc-entete">
              <h2 id="titre-equipe" data-zone="titre-equipe">Équipe</h2>
              <div class="segments" role="group" aria-label="Période des ventes">
                <button type="button" class="segment actif" data-periode="jour" aria-pressed="true">Aujourd’hui</button>
                <button type="button" class="segment" data-periode="mois" aria-pressed="false">Ce mois</button>
              </div>
            </div>
            <ul class="liste-equipe" data-zone="equipe">
              ${'<li class="squelette-ligne"><span class="squelette" style="height:16px;width:50%"></span><span class="squelette" style="height:12px;width:70%"></span></li>'.repeat(3)}
            </ul>
          </section>
          <section class="carte invitations" aria-labelledby="titre-invitations">
            <h2 id="titre-invitations" data-zone="titre-invitations">Invitations en attente</h2>
            <ul class="liste-invitations" data-zone="invitations"></ul>
          </section>
        </div>
        <aside class="fiche-cadre invitation-cadre seul-ordi" aria-label="Inviter un vendeur">
          ${formulaireInvitationHTML('o')}
          <div data-zone="resultat-o"></div>
        </aside>
      </div>
    </div>`;

  /* ---------------- Formulaire d'invitation */

  function formulaireInvitationHTML(suffixe) {
    const roles = peut('nommer_gerant') ? ['vendeur', 'gerant'] : ['vendeur'];
    return `
      <form class="form-invitation" novalidate>
        <h2>Inviter un vendeur</h2>
        <div class="champ">
          <label for="inv-nom-${suffixe}">Nom du vendeur</label>
          <input id="inv-nom-${suffixe}" name="nom" class="input" type="text" maxlength="80" required placeholder="Ex. Ousmane Bangoura">
        </div>
        <div class="champ">
          <label for="inv-tel-${suffixe}">Son téléphone (pour l’envoi sur WhatsApp)</label>
          <input id="inv-tel-${suffixe}" name="telephone" class="input" type="tel" inputmode="tel" placeholder="6XX XX XX XX (facultatif)">
        </div>
        <fieldset class="champ">
          <legend class="etiquette">Rôle</legend>
          ${roles.map((role, i) => `
            <label class="choix-role">
              <input type="radio" name="role" value="${role}" ${i === 0 ? 'checked' : ''}>
              <span class="choix-role-textes">
                <span class="tres-gras">${esc(LIBELLES_ROLES[role])}</span>
                <span class="discret">${esc(DESCRIPTIONS_ROLES[role])}</span>
              </span>
            </label>`).join('')}
        </fieldset>
        <p class="erreur-form" role="alert" hidden></p>
        <button type="submit" class="btn btn-primaire btn-grand">Créer le code d’invitation</button>
      </form>`;
  }

  function resultatHTML(invitation, nom, telephone) {
    return `
      <div class="resultat-invitation">
        <span class="resultat-libelle">Code à donner à ${esc(prenom(nom))}</span>
        <span class="code-invitation">${formatCode(invitation.code)}</span>
        <span class="resultat-libelle">Valable 3 jours · une seule utilisation</span>
        <div class="resultat-actions">
          <button type="button" class="btn btn-copier" data-copier="${esc(String(invitation.code))}">${icone('copier', 18, 2)} Copier</button>
          <a class="btn btn-whatsapp" href="${esc(lienWhatsAppInvitation(telephone, nom, invitation.code))}" target="_blank" rel="noopener">${icone('whatsapp', 20, 2)} Envoyer sur WhatsApp</a>
        </div>
        <span class="resultat-aide">${esc(prenom(nom))} ouvre YOUMMA Business, crée son compte avec son numéro, puis choisit « J’ai un code d’invitation ».</span>
      </div>`;
  }

  function brancherFormulaire(formulaire, zoneResultat) {
    const zoneErreur = formulaire.querySelector('.erreur-form');
    const erreur = (message) => { zoneErreur.textContent = message; zoneErreur.hidden = !message; };
    formulaire.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nom = formulaire.nom.value.trim();
      const saisieTel = formulaire.telephone.value.trim();
      const telephone = saisieTel ? normaliserTelephone(saisieTel) : null;
      const role = formulaire.role.value || 'vendeur';
      if (nom.length < 2) return erreur('Indiquez le nom de la personne à inviter.');
      if (saisieTel && !telephone) return erreur('Numéro invalide. Exemple : 620 00 00 00.');
      erreur('');
      const bouton = formulaire.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Création du code…');
      const { data, error } = await sb.rpc('creer_invitation', {
        p_boutique: boutique.id, p_nom: nom, p_telephone: telephone, p_role: role
      });
      boutonOccupe(bouton, false);
      if (error) { erreur(messageErreur(error)); return; }
      const invitation = (Array.isArray(data) ? data[0] : data) || {};
      zoneResultat.innerHTML = resultatHTML(invitation, nom, telephone);
      formulaire.reset();
      toast(`Code d’invitation créé pour ${nom}.`, 'succes');
      chargerInvitations();
    });
  }

  function ouvrirInvitationMobile() {
    const { el } = ouvrirModale({
      titre: 'Inviter un vendeur',
      variante: 'feuille',
      contenu: `${formulaireInvitationHTML('m')}<div data-zone="resultat-m"></div>`
    });
    el.querySelector('.form-invitation h2').remove();
    brancherFormulaire(el.querySelector('form'), el.querySelector('[data-zone="resultat-m"]'));
    el.addEventListener('click', surClicCopier);
  }

  async function surClicCopier(e) {
    const bouton = e.target.closest('[data-copier]');
    if (!bouton) return;
    toast(await copierTexte(bouton.dataset.copier) ? 'Code copié.' : 'Copie impossible : notez le code.', 'info');
  }

  /* ---------------- Équipe */

  /** Peut-on modifier ce membre ? Jamais le propriétaire ni soi-même ; un gérant seulement par le propriétaire. */
  function estModifiable(m) {
    return m.role !== 'proprietaire' && m.user_id !== moi && (m.role === 'vendeur' || estProprietaire());
  }

  function renderEquipe() {
    const membres = [...s.membres].sort((a, b) => (a.actif === b.actif ? 0 : a.actif ? -1 : 1)
      || ORDRE_ROLES[a.role] - ORDRE_ROLES[b.role]
      || a.nom.localeCompare(b.nom, 'fr'));
    zone('titre-equipe').textContent = `Équipe (${membres.length})`;
    zone('equipe').innerHTML = membres.map((m) => {
      const ventes = s.ventes.get(m.user_id) || s.ventes.get(m.id) || { total: 0, nb: 0 };
      const role = m.actif ? (LIBELLES_ROLES[m.role] || m.role) : 'Désactivé';
      const depuis = m.created_at ? `depuis ${formatDate(m.created_at, 'moisAnnee')}` : '';
      const infos = [m.telephone ? formatTelephone(m.telephone) : 'Sans téléphone', depuis].filter(Boolean).join(' · ');
      return `
        <li class="membre ${m.actif ? '' : 'inactif'}">
          <span class="avatar avatar-membre">${esc(initiales(m.nom))}</span>
          <div class="membre-textes">
            <div class="membre-nom">
              <span class="tres-gras">${esc(m.nom)}${m.user_id === moi ? ' <span class="discret">(vous)</span>' : ''}</span>
              <span class="badge-role badge-role-${m.actif ? m.role : 'inactif'}">${esc(role)}</span>
            </div>
            <span class="discret">${esc(infos)}</span>
          </div>
          <div class="membre-ventes">
            ${m.actif
              ? `<span class="tres-gras">${formatGNF(ventes.total)}</span><span class="discret">${ventes.nb} vente${ventes.nb > 1 ? 's' : ''}</span>`
              : '<span class="tres-gras">—</span><span class="discret">ne peut plus se connecter</span>'}
          </div>
          ${estModifiable(m)
            ? `<button type="button" class="btn-icone btn-icone-clair" data-membre="${esc(m.id)}" aria-label="Gérer ${esc(m.nom)}">${icone('points', 18, 2.4)}</button>`
            : '<span class="membre-sans-action" aria-hidden="true"></span>'}
        </li>`;
    }).join('');
  }

  function ouvrirMenuMembre(id) {
    const m = s.membres.find((x) => x.id === id);
    if (!m || !estModifiable(m)) return;
    const actions = [];
    if (m.actif && estProprietaire()) {
      actions.push(m.role === 'vendeur'
        ? { code: 'gerant', libelle: 'Passer gérant', role: 'gerant', actif: true,
          message: `${m.nom} pourra gérer le stock, annuler des ventes, voir les rapports et gérer l’équipe.` }
        : { code: 'vendeur', libelle: 'Passer vendeur', role: 'vendeur', actif: true,
          message: `${m.nom} n’aura plus accès au stock, aux rapports ni à l’équipe.` });
    }
    actions.push(m.actif
      ? { code: 'desactiver', libelle: 'Désactiver', role: m.role, actif: false, danger: true,
        message: `${m.nom} ne pourra plus se connecter à la boutique. Ses ventes restent dans l’historique.` }
      : { code: 'reactiver', libelle: 'Réactiver', role: m.role, actif: true,
        message: `${m.nom} pourra de nouveau se connecter à la boutique.` });

    const { el, fermer } = ouvrirModale({
      titre: m.nom,
      variante: 'feuille',
      contenu: `
        <p class="texte-modale">${esc(m.actif ? LIBELLES_ROLES[m.role] : 'Désactivé')}${m.telephone ? ' · ' + esc(formatTelephone(m.telephone)) : ''}</p>
        <div class="menu-membre">
          ${actions.map((a) => `<button type="button" class="btn ${a.danger ? 'btn-annuler-vente' : 'btn-secondaire'} btn-bloc" data-choix="${a.code}">${esc(a.libelle)}</button>`).join('')}
        </div>`
    });
    el.addEventListener('click', async (e) => {
      const choix = actions.find((a) => a.code === e.target.closest('[data-choix]')?.dataset.choix);
      if (!choix) return;
      fermer();
      if (!(await confirmer(choix.message, { titre: choix.libelle, libelleOk: choix.libelle, danger: choix.danger }))) return;
      const { error } = await sb.rpc('modifier_membre', { p_membre: m.id, p_role: choix.role, p_actif: choix.actif });
      if (error) { toast(messageErreur(error), 'erreur', 6000); return; }
      toast(`${m.nom} : modification enregistrée.`, 'succes');
      chargerEquipe();
    });
  }

  /* ---------------- Invitations en attente */

  function renderInvitations() {
    zone('titre-invitations').textContent = `Invitations en attente (${s.invitations.length})`;
    zone('invitations').innerHTML = s.invitations.length ? s.invitations.map((inv) => `
      <li class="invitation">
        <span class="code-badge">${formatCode(inv.code)}</span>
        <div class="invitation-textes">
          <span class="gras">${esc(inv.nom || 'Invité')} · ${esc(LIBELLES_ROLES[inv.role] || inv.role)}</span>
          <span class="invitation-expire">${esc(texteExpiration(inv.expire_at))}</span>
        </div>
        <div class="invitation-actions">
          <a class="btn btn-secondaire btn-petit" href="${esc(lienWhatsAppInvitation(inv.telephone, inv.nom || '', inv.code))}" target="_blank" rel="noopener">${icone('whatsapp', 16, 2)} Renvoyer sur WhatsApp</a>
          <button type="button" class="btn btn-annuler-vente btn-petit" data-annuler-invitation="${esc(inv.id)}">Annuler</button>
        </div>
      </li>`).join('') : '<li class="etat-vide"><p>Aucune invitation en attente.</p></li>';
  }

  async function annulerInvitation(id) {
    const inv = s.invitations.find((x) => x.id === id);
    if (!inv || !(await confirmer(`Le code ${formatCode(inv.code)} ne pourra plus être utilisé.`, { titre: 'Annuler l’invitation', libelleOk: 'Annuler l’invitation', danger: true }))) return;
    const { error } = await sb.rpc('annuler_invitation', { p_invitation: id });
    if (error) { toast(messageErreur(error), 'erreur'); return; }
    toast('Invitation annulée.', 'succes');
    chargerInvitations();
  }

  /* ---------------- Données */

  async function chargerEquipe() {
    const { du } = bornesPeriode(s.periode);
    try {
      const [membresRes, ventes] = await Promise.all([
        sb.from('membres').select('*').eq('boutique_id', boutique.id),
        chargerParLots((d, f) => sb.from('ventes').select('vendeur_id, total')
          .eq('boutique_id', boutique.id).eq('statut', 'validee')
          .gte('created_at', `${du}T00:00:00Z`).range(d, f))
      ]);
      if (membresRes.error) throw membresRes.error;
      s.membres = membresRes.data;
      s.ventes = new Map();
      ventes.forEach((v) => {
        const t = s.ventes.get(v.vendeur_id) || { total: 0, nb: 0 };
        t.total += Number(v.total) || 0;
        t.nb += 1;
        s.ventes.set(v.vendeur_id, t);
      });
      renderEquipe();
    } catch (err) {
      zone('equipe').innerHTML = `<li class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</li>`;
    }
  }

  async function chargerInvitations() {
    const { data, error } = await sb.from('invitations')
      .select('id, code, role, nom, telephone, expire_at, utilise_par, annulee, created_at')
      .eq('boutique_id', boutique.id)
      .is('utilise_par', null)
      .eq('annulee', false)
      .gt('expire_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (error) {
      zone('invitations').innerHTML = `<li class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(error))}</li>`;
      return;
    }
    s.invitations = data;
    renderInvitations();
  }

  /* ---------------- Événements */

  conteneur.addEventListener('click', (e) => {
    surClicCopier(e);
    if (e.target.closest('[data-action="inviter"]')) {
      if (estMobile()) { ouvrirInvitationMobile(); return; }
      const champ = conteneur.querySelector('#inv-nom-o');
      champ.scrollIntoView({ behavior: 'smooth', block: 'center' });
      champ.focus({ preventScroll: true });
      return;
    }
    const periode = e.target.closest('[data-periode]');
    if (periode) {
      s.periode = periode.dataset.periode;
      conteneur.querySelectorAll('[data-periode]').forEach((b) => {
        b.classList.toggle('actif', b === periode);
        b.setAttribute('aria-pressed', String(b === periode));
      });
      chargerEquipe();
      return;
    }
    const membre = e.target.closest('[data-membre]');
    if (membre) { ouvrirMenuMembre(membre.dataset.membre); return; }
    const annulation = e.target.closest('[data-annuler-invitation]');
    if (annulation) annulerInvitation(annulation.dataset.annulerInvitation);
  });

  brancherFormulaire(conteneur.querySelector('.invitation-cadre form'), zone('resultat-o'));
  chargerEquipe();
  chargerInvitations();
}
