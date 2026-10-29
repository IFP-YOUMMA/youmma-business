/**
 * parametres.js — Page Paramètres (maquette Parametres.dc.html).
 *
 *  - Ma boutique (gérant / propriétaire) : coordonnées et message en bas des reçus.
 *  - Mon compte (tous) : nom (modifier_mon_nom), téléphone de connexion, mot de passe.
 *  - Logo de la boutique (gérant / propriétaire), compressé à 512 px, bucket « produits ».
 *  - Sur cet appareil (tous) : son des nouvelles commandes en ligne (préférence locale).
 *  - Licence (tous, lecture) · Mes boutiques (gérant / propriétaire) · Déconnexion.
 */
import { sb } from './supabase.js';
import { etat, utilisateur, peut, infosLicence, COLONNES_BOUTIQUE, LIBELLES_ROLES } from './state.js';
import { deconnecter } from './auth.js';
import { modifierLogo } from './images/actions.js';
import { sonCommandesActif, reglerSonCommandes, jouerSonCommande } from './alertes-commandes.js';
import { changerBoutique, statutLicence, majNomBoutiqueAffiche } from './layout.js';
import { estLogistique } from './modules.js';
import { monterReglagesColis } from './colis/reglages.js';
import {
  esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, initiales, formatDate, formatTelephone,
  normaliserTelephone, jours, TYPES_ACTIVITE
} from './utils.js';

const LONGUEUR_MAX_MESSAGE = 160;
const LONGUEUR_MIN_MDP = 6;
const VERSION = '1.0';

/** Téléphone de connexion, déduit de l'e-mail technique 224XXXXXXXXX@tel.yoummabusiness.app. */
function telephoneConnexion() {
  const local = String(utilisateur()?.email || '').split('@')[0];
  return /^\d{12}$/.test(local) ? formatTelephone(local) : '—';
}

export function afficherParametres(conteneur) {
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);
  const gerer = peut('parametres_boutique');

  conteneur.innerHTML = `
    <div class="page page-parametres">
      <header class="page-titres">
        <a class="lien-retour seul-ordi" href="#/aujourdhui">← Aujourd’hui</a>
        <h1>Paramètres</h1>
      </header>
      ${estLogistique() && gerer ? '<div class="col-reglages" data-zone="reglages-colis"></div>' : ''}
      <div class="clients-corps">
        <div class="parametres-gauche">
          ${gerer ? '<section class="carte section-parametres" aria-labelledby="titre-boutique" data-zone="boutique"></section>' : ''}
          <section class="carte section-parametres" aria-labelledby="titre-compte" data-zone="compte"></section>
        </div>
        <div class="parametres-droite">
          ${peut('parametres_boutique') ? `<a class="carte lien-reglages-documents" href="#/modules">
            <span class="avatar">${icone('tableau', 20, 2)}</span>
            <span class="client-textes"><span class="gras">Mes modules</span><span class="discret">Fonctions affichées selon votre activité : crédits, devis, chantiers, boutique en ligne…</span></span>
            ${icone('chevronDroite', 18, 2)}</a>` : ''}
          ${peut('documents.reglages') ? `<a class="carte lien-reglages-documents" href="#/identite">
            <span class="avatar">${icone('image', 20, 2)}</span>
            <span class="client-textes"><span class="gras">Logo &amp; images</span><span class="discret">Logo partout, photo de couverture, logos Orange Money / MTN MoMo et partenaires</span></span>
            ${icone('chevronDroite', 18, 2)}</a>` : ''}
          ${peut('documents.reglages') ? `<a class="carte lien-reglages-documents" href="#/documents">
            <span class="avatar">${icone('document', 20, 2)}</span>
            <span class="client-textes"><span class="gras">Documents : factures, reçus, devis</span><span class="discret">Modèle, couleurs, logo, RCCM/NIF, cachet et signature, QR de vérification</span></span>
            ${icone('chevronDroite', 18, 2)}</a>` : ''}
          <section class="licence-parametres" aria-labelledby="titre-licence" data-zone="licence"></section>
          ${gerer ? '<section class="carte section-parametres" aria-labelledby="titre-boutiques" data-zone="boutiques"></section>' : ''}
          <button type="button" class="btn btn-annuler-vente btn-grand btn-bloc" data-action="deconnexion">${icone('deconnexion', 18, 2)} Se déconnecter</button>
          <p class="pied-version">YOUMMA Business · version ${VERSION} · un produit YOUMMA SARLU</p>
        </div>
      </div>
    </div>`;

  /* ---------------- Ma boutique */

  function renderBoutique() {
    const b = etat.boutique;
    zone('boutique').innerHTML = `
      <div class="bloc-entete">
        <h2 id="titre-boutique">Ma boutique</h2>
        <span class="badge-categorie">${esc(TYPES_ACTIVITE[b.type_activite] || 'Commerce')}</span>
      </div>
      <div class="bloc-logo">
        <span class="logo-boutique" data-zone="logo">${b.logo_url ? `<img src="${esc(b.logo_url)}" alt="Logo de ${esc(b.nom)}">` : esc(initiales(b.nom))}</span>
        <span class="bloc-logo-textes">
          <span class="gras">Logo</span>
          <span class="discret">Affiché sur votre boutique en ligne et l’affiche du jour. Carré de préférence.</span>
          <button type="button" class="btn btn-secondaire btn-petit" data-action="logo">${icone('photo', 16, 2)} ${b.logo_url ? 'Changer le logo' : 'Ajouter un logo'}</button>
        </span>
      </div>
      <form class="form-modale" novalidate>
        <div class="rangee-champs">
          <div class="champ"><label for="par-nom">Nom de la boutique</label><input id="par-nom" name="nom" class="input" type="text" maxlength="80" required value="${esc(b.nom)}"></div>
          <div class="champ"><label for="par-tel">Téléphone (affiché sur les reçus)</label><input id="par-tel" name="telephone" class="input" type="tel" inputmode="tel" value="${esc(b.telephone ? formatTelephone(b.telephone) : '')}"></div>
          <div class="champ"><label for="par-ville">Ville</label><input id="par-ville" name="ville" class="input" type="text" maxlength="60" value="${esc(b.ville || '')}"></div>
          <div class="champ"><label for="par-commune">Quartier / commune</label><input id="par-commune" name="commune" class="input" type="text" maxlength="60" value="${esc(b.commune || '')}"></div>
        </div>
        <div class="champ">
          <label for="par-message">Message en bas des reçus</label>
          <input id="par-message" name="message_recu" class="input" type="text" maxlength="${LONGUEUR_MAX_MESSAGE}" value="${esc(b.message_recu || '')}" placeholder="Ex. Merci de votre confiance ! Marchandise vendue ni reprise ni échangée." aria-describedby="aide-message">
          <small class="aide" id="aide-message"><span data-zone="compteur">${String(b.message_recu || '').length}</span> / ${LONGUEUR_MAX_MESSAGE} caractères · vide : « Merci de votre confiance ! »</small>
        </div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="actions-droite"><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`;
    zone('boutique').querySelector('[data-action="logo"]').addEventListener('click', () => {
      modifierLogo({ nom: b.nom, apres: () => renderBoutique() });
    });
    const formulaire = zone('boutique').querySelector('form');
    const zoneErreur = formulaire.querySelector('.erreur-form');
    const erreur = (m) => { zoneErreur.textContent = m; zoneErreur.hidden = !m; };
    formulaire.message_recu.addEventListener('input', (e) => { zone('compteur').textContent = String(e.target.value.length); });
    formulaire.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nom = formulaire.nom.value.trim();
      const saisieTel = formulaire.telephone.value.trim();
      const telephone = saisieTel ? normaliserTelephone(saisieTel) : null;
      if (nom.length < 2) return erreur('Indiquez le nom de la boutique.');
      if (saisieTel && !telephone) return erreur('Numéro invalide. Exemple : 620 00 00 00.');
      erreur('');
      const bouton = formulaire.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      const { data, error } = await sb.from('boutiques')
        .update({
          nom,
          telephone,
          ville: formulaire.ville.value.trim() || null,
          commune: formulaire.commune.value.trim() || null,
          message_recu: formulaire.message_recu.value.trim() || null
        })
        .eq('id', etat.boutique.id)
        .select(COLONNES_BOUTIQUE)
        .single();
      boutonOccupe(bouton, false);
      if (error) { erreur(messageErreur(error)); return; }
      Object.assign(etat.boutique, data);
      majNomBoutiqueAffiche();
      renderBoutiques();
      toast('Informations de la boutique enregistrées.', 'succes');
    });
  }

  /* ---------------- Mon compte */

  function renderCompte() {
    const nom = etat.membre?.nom || utilisateur()?.user_metadata?.nom || '—';
    zone('compte').innerHTML = `
      <h2 id="titre-compte">Mon compte</h2>
      <div class="compte-identite">
        <span class="avatar avatar-grand">${esc(initiales(nom))}</span>
        <div class="compte-textes">
          <span class="tres-gras">${esc(nom)} · ${esc(LIBELLES_ROLES[etat.membre?.role] || '')}</span>
          <span class="discret">Connexion avec le ${esc(telephoneConnexion())}</span>
        </div>
        <button type="button" class="btn btn-secondaire" data-action="modifier-nom">Modifier mon nom</button>
      </div>
      <form class="form-mdp" novalidate>
        <div class="champ"><label for="mdp-nouveau">Nouveau mot de passe</label><input id="mdp-nouveau" name="mdp" class="input" type="password" autocomplete="new-password" minlength="${LONGUEUR_MIN_MDP}"></div>
        <div class="champ"><label for="mdp-confirmation">Confirmer</label><input id="mdp-confirmation" name="confirmation" class="input" type="password" autocomplete="new-password" minlength="${LONGUEUR_MIN_MDP}"></div>
        <div class="champ champ-bouton"><button type="submit" class="btn btn-secondaire btn-bloc" data-lecture-ok>Changer le mot de passe</button></div>
        <p class="erreur-form" role="alert" hidden></p>
      </form>
      <div class="sur-appareil">
        <h3 class="fiche-sous-titre">Sur cet appareil</h3>
        <label class="case-option"><input type="checkbox" data-action="son-commandes" ${sonCommandesActif() ? 'checked' : ''}> Son à chaque nouvelle commande en ligne</label>
      </div>`;
    zone('compte').querySelector('[data-action="son-commandes"]').addEventListener('change', (e) => {
      reglerSonCommandes(e.target.checked);
      if (e.target.checked) jouerSonCommande();
      toast(e.target.checked ? 'Son des commandes activé sur cet appareil.' : 'Son des commandes désactivé sur cet appareil.', 'succes');
    });
    const formulaire = zone('compte').querySelector('form');
    const zoneErreur = formulaire.querySelector('.erreur-form');
    const erreur = (m) => { zoneErreur.textContent = m; zoneErreur.hidden = !m; };
    formulaire.addEventListener('submit', async (e) => {
      e.preventDefault();
      const mdp = formulaire.mdp.value;
      if (mdp.length < LONGUEUR_MIN_MDP) return erreur('Le mot de passe doit contenir au moins 6 caractères.');
      if (mdp !== formulaire.confirmation.value) return erreur('Les deux mots de passe ne sont pas identiques.');
      erreur('');
      const bouton = formulaire.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Modification…');
      const { error } = await sb.auth.updateUser({ password: mdp });
      boutonOccupe(bouton, false);
      if (error) { erreur(messageErreur(error)); return; }
      formulaire.reset();
      toast('Mot de passe modifié.', 'succes');
    });
  }

  function ouvrirModificationNom() {
    const { el, fermer } = ouvrirModale({
      titre: 'Modifier mon nom',
      contenu: `
        <form class="form-modale" novalidate>
          <div class="champ"><label for="mon-nom">Nom complet</label><input id="mon-nom" name="nom" class="input" type="text" maxlength="80" required value="${esc(etat.membre?.nom || '')}"></div>
          <p class="aide">Ce nom apparaît sur les reçus et dans l’équipe de toutes vos boutiques.</p>
          <p class="erreur-form" role="alert" hidden></p>
          <div class="modale-actions">
            <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
            <button type="submit" class="btn btn-primaire">Enregistrer</button>
          </div>
        </form>`
    });
    const formulaire = el.querySelector('form');
    formulaire.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nom = formulaire.nom.value.trim();
      const zoneErreur = formulaire.querySelector('.erreur-form');
      if (nom.length < 2) { zoneErreur.textContent = 'Indiquez votre nom complet.'; zoneErreur.hidden = false; return; }
      const bouton = formulaire.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      const { error } = await sb.rpc('modifier_mon_nom', { p_nom: nom });
      if (error) {
        boutonOccupe(bouton, false);
        zoneErreur.textContent = messageErreur(error);
        zoneErreur.hidden = false;
        return;
      }
      // Même nom dans toutes les boutiques (fait par le serveur) et pour les prochaines inscriptions à une boutique.
      etat.boutiques.forEach((x) => { if (x.membre) x.membre.nom = nom; });
      sb.auth.updateUser({ data: { nom } }).catch(() => {});
      fermer();
      renderCompte();
      toast('Nom mis à jour.', 'succes');
    });
  }

  /* ---------------- Licence */

  function renderLicence() {
    const l = infosLicence();
    const statut = statutLicence(l);
    let texte = 'Date de fin non définie';
    if (l.expiree) texte = `Expirée depuis le ${formatDate(l.fin, 'court')}`;
    else if (l.fin) texte = `Se termine le ${formatDate(l.fin, 'court')} · reste ${jours(l.joursRestants)}`;
    zone('licence').innerHTML = `
      <div class="bloc-entete">
        <h2 id="titre-licence">Licence</h2>
        <span class="statut-licence ${statut.classe}">${esc(statut.libelle)}</span>
      </div>
      <span class="licence-formule">${l.formule === 'Essai' ? 'Essai gratuit' : `Licence ${esc(l.formule)}`}</span>
      <span class="licence-texte">${esc(texte)}</span>
      <div class="jauge-licence" role="progressbar" aria-label="Durée restante de la licence" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(l.progression * 100)}">
        <div class="jauge-licence-remplie" style="width:${Math.round(l.progression * 100)}%"></div>
      </div>
      <a class="btn btn-licence btn-grand" href="#/licence">Ma licence et renouvellement</a>
      <a class="btn btn-secondaire btn-bloc" href="#/aide">${icone('aide', 18, 2)} Aide : écrire à YOUMMA</a>`;
  }

  /* ---------------- Mes boutiques */

  function etatBoutique(b) {
    if (b.id === etat.boutique.id) return { libelle: 'Boutique active', classe: 'texte-succes' };
    const l = infosLicence(b);
    if (l.expiree) return { libelle: 'Expirée', classe: 'texte-danger' };
    if (String(b.licence_formule || '').toLowerCase() === 'essai') return { libelle: 'Essai', classe: 'texte-alerte' };
    return { libelle: 'Ouverte', classe: 'texte-succes' };
  }

  function renderBoutiques() {
    if (!zone('boutiques')) return;
    zone('boutiques').innerHTML = `
      <h2 id="titre-boutiques">Mes boutiques</h2>
      <ul class="liste-mes-boutiques">
        ${etat.boutiques.map(({ boutique: b, membre }) => {
          const e = etatBoutique(b);
          const active = b.id === etat.boutique.id;
          return `
            <li>
              <button type="button" class="ma-boutique ${active ? 'active' : ''}" data-boutique="${esc(b.id)}" ${active ? 'aria-current="true"' : ''}>
                <span class="ma-boutique-textes">
                  <span class="gras">${esc(b.nom)}</span>
                  <span class="discret">${esc([b.ville, LIBELLES_ROLES[membre?.role]].filter(Boolean).join(' · '))}</span>
                </span>
                <span class="gras ${e.classe}">${esc(e.libelle)}</span>
              </button>
            </li>`;
        }).join('')}
      </ul>
      ${peut('ouvrir_boutique') ? '<a class="btn btn-pointille" href="#/nouvelle-boutique?creer=1">+ Ouvrir une nouvelle boutique</a>' : ''}
      <a class="btn btn-secondaire" href="#/rejoindre">${icone('connexion', 18, 2)} Rejoindre une boutique avec un code</a>`;
  }

  /* ---------------- Événements */

  conteneur.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'deconnexion') deconnecter();
    if (action === 'modifier-nom') ouvrirModificationNom();
    const autre = e.target.closest('[data-boutique]');
    if (autre && autre.dataset.boutique !== etat.boutique.id) changerBoutique(autre.dataset.boutique);
  });

  if (gerer) { renderBoutique(); renderBoutiques(); }
  renderCompte();
  renderLicence();
  if (zone('reglages-colis')) monterReglagesColis(zone('reglages-colis'));
}
