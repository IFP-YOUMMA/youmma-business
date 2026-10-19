/**
 * admin/boutiques.js — Boutiques (maquette AdminBoutiques.dc.html) : recherche, filtres, liste paginée
 * (50), export Excel, création d'une boutique pour un client, et fiche (panneau à droite sur ordinateur,
 * page sur téléphone) : Résumé · Membres · Licence & paiements · SMS · Boutique en ligne · Activité.
 */
import { sb } from '../supabase.js';
import { esc, icone, toast, confirmer, ouvrirModale, boutonOccupe, differer, formatDate, normaliserTelephone, lireNombre, formaterSaisieMontant, formatNombre } from '../utils.js';
import { PACKS_SMS } from '../sms.js';
import {
  estSuper, rpc, premiere, champ, liste, appelComptes, erreurAdmin, badgeLicence, etatLicenceTexte, ilYa, initiales, telLocal, lienWa,
  urlVitrine, gnf, nombre, exporterCsv, afficherMotDePasse, nouveauMotDePasse, tableau, blocErreur, squelette, libelleAction,
  detailsAction, TYPES, MODES_PAIEMENT_YOUMMA
} from './commun.js';
import { ouvrirEnregistrerPaiement } from './licences.js';

const FILTRES = [['toutes', 'Toutes'], ['actives', 'Actives'], ['essai', 'Essai'], ['expirent_7j', 'Expirent < 7 j'], ['expirees', 'Expirées'], ['suspendues', 'Suspendues'], ['inactives', 'Inactives 7 j']];
const PAGE = 50;
const MODULES = [['chantiers', 'Chantiers'], ['boutique_en_ligne', 'Boutique en ligne'], ['messages', 'Messages SMS'], ['affiches', 'Affiches du jour']];
const ONGLETS = [['resume', 'Résumé'], ['membres', 'Membres'], ['licence', 'Licence & paiements'], ['sms', 'SMS'], ['vitrine', 'Boutique en ligne'], ['activite', 'Activité']];
const ROLES = { proprietaire: 'Propriétaire', gerant: 'Gérant', vendeur: 'Vendeur' };
const estMobile = () => window.matchMedia('(max-width: 899.98px)').matches;

const finTexte = (b) => (champ(b, 'licence_fin', 'fin') ? formatDate(champ(b, 'licence_fin', 'fin'), 'court') : '—');
function couleurFin(b) {
  const fin = champ(b, 'licence_fin', 'fin');
  if (!fin) return '';
  const j = (new Date(`${String(fin).slice(0, 10)}T23:59:59Z`) - Date.now()) / 864e5;
  return j < 0 ? 'texte-danger' : j <= 7 ? 'texte-alerte' : '';
}

/** Formules (lecture publique). */
async function chargerFormules() {
  const { data } = await sb.from('formules').select('code, nom, prix_mois, mois_offerts, actif, ordre').order('ordre');
  return data || [];
}

export function afficherBoutiques(conteneur, { id, params, majCompteurs }) {
  const s = { filtre: params.get('filtre') || 'toutes', recherche: params.get('q') || '', offset: 0, total: 0, lignes: [], jeton: 0 };
  const pageFiche = Boolean(id) && estMobile();

  if (pageFiche) {
    conteneur.innerHTML = `<a class="lien-retour" href="#/boutiques">← Boutiques</a><section class="adm-carte adm-fiche" data-zone="fiche"></section>`;
    monterFiche(conteneur.querySelector('[data-zone="fiche"]'), id, { majCompteurs, recharger: () => {} });
    return;
  }

  conteneur.innerHTML = `
    <header class="adm-entete">
      <div class="adm-titres"><h1>Boutiques <span class="discret" data-ref="total"></span></h1></div>
      <div class="adm-actions">
        <button type="button" class="btn btn-secondaire" data-action="exporter">${icone('telecharger', 18, 2)} Exporter (Excel)</button>
        <button type="button" class="btn btn-primaire" data-action="creer">${icone('plus', 18, 2.4)} Créer une boutique pour un client</button>
      </div>
    </header>
    <div class="adm-filtres">
      <label class="recherche-entete"><span class="sr-only">Rechercher</span>${icone('recherche', 18, 2)}
        <input type="search" id="recherche-boutiques" placeholder="Nom, téléphone, ville…" value="${esc(s.recherche)}" autocomplete="off"></label>
      <div class="adm-puces" role="group" aria-label="Filtres" data-zone="filtres"></div>
    </div>
    <div class="adm-maitre-detail">
      <section class="adm-carte adm-liste-boutiques" aria-label="Liste des boutiques">
        <div data-zone="liste">${squelette(6)}</div>
        <div class="adm-pagination" data-zone="pages"></div>
      </section>
      <section class="adm-carte adm-fiche seul-ordi" aria-label="Fiche boutique" data-zone="fiche">
        <p class="vide-admin">Choisissez une boutique pour voir sa fiche.</p>
      </section>
    </div>`;
  const zone = (n) => conteneur.querySelector(`[data-zone="${n}"]`);

  function renderFiltres(compteurs = {}) {
    zone('filtres').innerHTML = FILTRES.map(([code, libelle]) => `
      <button type="button" class="adm-puce ${code === s.filtre ? 'actif' : ''}" data-filtre="${code}" aria-pressed="${code === s.filtre}">${esc(libelle)} <span>${compteurs[code] ?? ''}</span></button>`).join('');
  }

  function renderListe() {
    zone('liste').innerHTML = tableau([
      ['Boutique', (b) => `<span class="adm-cellule-nom"><strong>${esc(b.nom)}</strong><span class="discret">${esc([TYPES[b.type_activite] || b.type_activite, b.ville].filter(Boolean).join(' · '))}</span></span>`],
      ['Licence', (b) => badgeLicence(b)],
      ['Fin', (b) => `<span class="gras ${couleurFin(b)}">${esc(finTexte(b))}</span>`],
      ['Ventes 30 j', (b) => nombre(champ(b, 'ventes_30j', 'nb_ventes_30j') || 0), { droite: true }],
      ['Activité', (b) => {
        const d = champ(b, 'derniere_activite', 'derniere_vente');
        const vieux = d && (Date.now() - new Date(d)) / 864e5 > 7;
        return `<span class="${vieux || !d ? 'texte-danger' : 'discret'}">${esc(ilYa(d))}</span>`;
      }, { droite: true }]
    ], s.lignes, {
      classe: 'cliquable',
      vide: s.recherche ? 'Aucune boutique ne correspond.' : 'Aucune boutique dans ce filtre.',
      attributsLigne: (b) => `data-boutique="${esc(b.id)}" tabindex="0" class="${b.id === id ? 'selectionnee' : ''}"`
    });
    const pages = Math.ceil(s.total / PAGE);
    const page = Math.floor(s.offset / PAGE) + 1;
    zone('pages').innerHTML = pages > 1 ? `
      <button type="button" class="btn btn-secondaire btn-petit" data-page="-1" ${page <= 1 ? 'disabled' : ''}>‹ Précédentes</button>
      <span class="discret">Page ${page} / ${pages}</span>
      <button type="button" class="btn btn-secondaire btn-petit" data-page="1" ${page >= pages ? 'disabled' : ''}>Suivantes ›</button>` : '';
  }

  async function charger() {
    const jeton = ++s.jeton;
    zone('liste').innerHTML = squelette(6);
    try {
      const r = premiere(await rpc('admin_liste_boutiques', { p_recherche: s.recherche || null, p_filtre: s.filtre, p_limite: PAGE, p_offset: s.offset })) || {};
      if (jeton !== s.jeton || !conteneur.isConnected) return;
      s.lignes = liste(r, 'lignes');
      s.total = Number(r.total) || s.lignes.length;
      conteneur.querySelector('[data-ref="total"]').textContent = nombre(champ(r.compteurs, 'toutes') ?? s.total);
      renderFiltres(r.compteurs || {});
      renderListe();
    } catch (err) {
      zone('liste').innerHTML = blocErreur(err);
    }
  }

  const ouvrir = (idB) => {
    if (estMobile()) { location.hash = `#/boutiques/${encodeURIComponent(idB)}`; return; }
    history.replaceState(null, '', `#/boutiques/${encodeURIComponent(idB)}`);
    id = idB;
    conteneur.querySelectorAll('[data-boutique]').forEach((tr) => tr.classList.toggle('selectionnee', tr.dataset.boutique === idB));
    monterFiche(zone('fiche'), idB, { majCompteurs, recharger: charger });
  };

  async function exporter(bouton) {
    boutonOccupe(bouton, true, 'Export…');
    try {
      const toutes = [];
      for (let o = 0; o < 20000; o += 500) {
        const r = premiere(await rpc('admin_liste_boutiques', { p_recherche: s.recherche || null, p_filtre: s.filtre, p_limite: 500, p_offset: o })) || {};
        const l = liste(r, 'lignes');
        toutes.push(...l);
        if (l.length < 500) break;
      }
      exporterCsv(`boutiques-youmma-${new Date().toISOString().slice(0, 10)}.csv`, [
        ['Boutique', (b) => b.nom], ['Type', (b) => TYPES[b.type_activite] || b.type_activite || ''], ['Ville', (b) => b.ville || ''],
        ['Propriétaire', (b) => champ(b, 'proprietaire', 'nom_proprietaire') || ''], ['Téléphone', (b) => telLocal(champ(b, 'tel_proprietaire', 'telephone'))],
        ['Formule', (b) => champ(b, 'licence_formule', 'formule') || ''], ['Fin de licence', (b) => finTexte(b)], ['État', (b) => (b.suspendue ? 'suspendue' : champ(b, 'etat_licence', 'etat') || '')],
        ['Ventes 30 j', (b) => champ(b, 'ventes_30j', 'nb_ventes_30j') || 0], ['Crédit SMS', (b) => champ(b, 'solde_sms') ?? ''],
        ['Dernière activité', (b) => (champ(b, 'derniere_activite') ? formatDate(champ(b, 'derniere_activite'), 'complet') : '')],
        ['Créée le', (b) => (b.created_at ? formatDate(b.created_at, 'court') : '')]
      ], toutes);
      toast(`${nombre(toutes.length)} boutique(s) exportée(s).`, 'succes');
    } catch (err) { toast(erreurAdmin(err), 'erreur'); }
    boutonOccupe(bouton, false);
  }

  conteneur.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filtre]');
    if (f) { s.filtre = f.dataset.filtre; s.offset = 0; charger(); return; }
    const p = e.target.closest('[data-page]');
    if (p) { s.offset = Math.max(0, s.offset + Number(p.dataset.page) * PAGE); charger(); return; }
    const tr = e.target.closest('[data-boutique]');
    if (tr) { ouvrir(tr.dataset.boutique); return; }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'exporter') exporter(e.target.closest('button'));
    if (action === 'creer') ouvrirCreation((nouvelle) => { charger(); if (nouvelle) ouvrir(nouvelle); majCompteurs(); });
  });
  conteneur.addEventListener('keydown', (e) => {
    const tr = e.target.closest('[data-boutique]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ouvrir(tr.dataset.boutique); }
  });
  const rechercher = differer(() => { s.offset = 0; charger(); }, 350);
  conteneur.querySelector('#recherche-boutiques').addEventListener('input', (e) => { s.recherche = e.target.value.trim(); rechercher(); });
  renderFiltres();
  charger();
  if (id) monterFiche(zone('fiche'), id, { majCompteurs, recharger: charger });
}

/* =========================================================================
   Créer une boutique pour un client (fonction Edge admin-comptes)
   ========================================================================= */

async function ouvrirCreation(apres) {
  const formules = (await chargerFormules()).filter((f) => f.actif !== false);
  const choix = estSuper() ? formules : formules.filter((f) => f.code === 'essai');
  const { el, fermer } = ouvrirModale({
    titre: 'Créer une boutique pour un client',
    variante: 'large',
    contenu: `
      <form class="form-modale" novalidate>
        <p class="texte-modale">Le compte du propriétaire est créé avec un <strong>mot de passe provisoire</strong> (6 chiffres) à lui transmettre. Il choisira le sien à la première connexion.</p>
        <div class="rangee-champs">
          <div class="champ"><label for="cr-tel">Téléphone du propriétaire</label><input id="cr-tel" name="telephone" class="input" type="tel" inputmode="tel" placeholder="620 00 00 00" required></div>
          <div class="champ"><label for="cr-proprio">Nom du propriétaire</label><input id="cr-proprio" name="nom_proprietaire" class="input" type="text" maxlength="80" required></div>
        </div>
        <div class="rangee-champs">
          <div class="champ"><label for="cr-nom">Nom de la boutique</label><input id="cr-nom" name="nom_boutique" class="input" type="text" maxlength="80" required></div>
          <div class="champ"><label for="cr-type">Activité</label><select id="cr-type" name="type" class="input">${Object.entries(TYPES).map(([c, l]) => `<option value="${c}">${esc(l)}</option>`).join('')}</select></div>
        </div>
        <div class="rangee-champs">
          <div class="champ"><label for="cr-ville">Ville</label><input id="cr-ville" name="ville" class="input" type="text" maxlength="60"></div>
          <div class="champ"><label for="cr-formule">Formule</label><select id="cr-formule" name="formule" class="input">${(choix.length ? choix : [{ code: 'essai', nom: 'Essai' }]).map((f) => `<option value="${esc(f.code)}">${esc(f.nom)}</option>`).join('')}</select>
            ${estSuper() ? '' : '<small class="aide">Agent : création en essai seulement.</small>'}</div>
        </div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Créer le compte et la boutique</button></div>
      </form>`
  });
  const form = el.querySelector('form');
  const zoneErreur = form.querySelector('.erreur-form');
  const erreur = (m) => { zoneErreur.textContent = m; zoneErreur.hidden = !m; };
  form.telephone.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const telephone = normaliserTelephone(form.telephone.value);
    if (!telephone) return erreur('Numéro invalide. Exemple : 620 00 00 00.');
    if (form.nom_proprietaire.value.trim().length < 2) return erreur('Indiquez le nom du propriétaire.');
    if (form.nom_boutique.value.trim().length < 2) return erreur('Indiquez le nom de la boutique.');
    erreur('');
    const bouton = form.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Création…');
    try {
      const r = await appelComptes({
        action: 'creer_boutique', telephone, nom_proprietaire: form.nom_proprietaire.value.trim(), nom_boutique: form.nom_boutique.value.trim(),
        type: form.type.value, ville: form.ville.value.trim(), formule: form.formule.value
      });
      fermer();
      toast(`Boutique « ${form.nom_boutique.value.trim()} » créée.`, 'succes');
      afficherMotDePasse({ titre: 'Compte créé : mot de passe provisoire', telephone, motDePasse: r.mot_de_passe, nom: form.nom_proprietaire.value.trim() });
      apres(r.boutique_id);
    } catch (err) {
      boutonOccupe(bouton, false);
      erreur(erreurAdmin(err));
    }
  });
}

/* =========================================================================
   Fiche boutique
   ========================================================================= */

function monterFiche(cadre, idBoutique, { majCompteurs, recharger }) {
  const s = { onglet: 'resume', fiche: null };
  cadre.dataset.boutique = idBoutique;
  cadre.innerHTML = squelette(6);

  const rafraichir = async (message) => {
    if (message) toast(message, 'succes');
    await charger();
    recharger?.();
    majCompteurs?.();
  };

  async function charger() {
    try {
      s.fiche = premiere(await rpc('admin_fiche_boutique', { p_boutique: idBoutique })) || {};
    } catch (err) { cadre.innerHTML = blocErreur(err); return; }
    if (cadre.dataset.boutique !== idBoutique || !cadre.isConnected) return;
    render();
  }

  const proprietaire = () => liste(s.fiche, 'membres').find((m) => m.role === 'proprietaire') || {};

  function render() {
    const f = s.fiche;
    const b = f.boutique || {};
    const membres = liste(f, 'membres');
    cadre.innerHTML = `
      <div class="adm-fiche-entete">
        <span class="adm-avatar grand">${esc(initiales(b.nom))}</span>
        <div class="adm-fiche-titres">
          <h2>${esc(b.nom || 'Boutique')}</h2>
          <span class="discret">${esc([TYPES[b.type_activite] || b.type_activite, b.ville, b.created_at ? `créée le ${formatDate(b.created_at, 'court')}` : '', `ID ${String(b.id || idBoutique).slice(0, 4)}…${String(b.id || idBoutique).slice(-3)}`].filter(Boolean).join(' · '))}</span>
        </div>
        ${badgeLicence(b)}
      </div>
      ${b.suspendue ? `<p class="adm-alerte rouge">${icone('alerte', 16, 2)} Suspendue${b.motif_suspension ? ` : ${esc(b.motif_suspension)}` : ''}</p>` : ''}
      <div class="adm-onglets" role="tablist">
        ${ONGLETS.map(([code, libelle]) => `<button type="button" role="tab" class="adm-onglet ${code === s.onglet ? 'actif' : ''}" data-onglet="${code}" aria-selected="${code === s.onglet}">${esc(libelle)}${code === 'membres' ? ` (${membres.length})` : ''}</button>`).join('')}
      </div>
      <div class="adm-onglet-contenu" data-zone="onglet">${contenuOnglet()}</div>`;
    brancher();
  }

  function contenuOnglet() {
    const f = s.fiche;
    const b = f.boutique || {};
    const st = f.stats || {};
    const sms = f.sms || {};
    const vit = f.vitrine || {};
    const p = proprietaire();
    if (s.onglet === 'resume') {
      const faits = [
        ['Propriétaire', `${p.nom || '—'} · ${telLocal(p.telephone)}`],
        [`Licence ${champ(b, 'formule_nom', 'licence_formule') || ''}`, b.licence_fin ? `jusqu’au ${formatDate(b.licence_fin, 'court')}` : '—'],
        ['Ventes (30 j)', `${nombre(champ(st, 'ventes_30j', 'nb_ventes_30j') || 0)} · ${gnf(champ(st, 'montant_30j', 'ventes_30j_montant') || 0)}`],
        ['Crédit SMS', `${nombre(champ(sms, 'solde') ?? champ(b, 'solde_sms') ?? 0)} SMS`],
        ['Articles', `${nombre(champ(st, 'articles') || 0)} · ${nombre(champ(st, 'articles_en_ligne') || 0)} en ligne`],
        ['Commandes en ligne', `${nombre(champ(vit, 'commandes') || 0)} · ${nombre(champ(vit, 'livrees') || 0)} livrées`]
      ];
      const modules = b.modules && typeof b.modules === 'object' ? b.modules : {};
      return `
        <div class="adm-faits">${faits.map(([l, v]) => `<div><span>${esc(l)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>
        <div class="adm-groupe-actions">
          <span class="gras">Licence ${etatLicenceTexte(champ(b, 'etat_licence', 'etat') || 'active')}</span>
          <div class="adm-boutons">
            <button type="button" class="btn btn-secondaire" data-action="essai7">+ 7 jours d’essai</button>
            ${estSuper() ? `
              <button type="button" class="btn btn-primaire" data-action="mois1">+ 1 mois</button>
              <button type="button" class="btn btn-secondaire" data-action="an1">+ 1 an</button>
              <button type="button" class="btn btn-secondaire" data-action="date">Date libre</button>
              <button type="button" class="btn btn-secondaire" data-action="formule">Changer de formule</button>
              <button type="button" class="btn btn-secondaire" data-action="modules">Modules</button>` : ''}
          </div>
          ${Object.keys(modules).length ? `<span class="discret">Modules : ${esc(MODULES.filter(([c]) => modules[c]).map(([, l]) => l).join(', ') || 'aucun')}</span>` : ''}
          <span class="gras">Compte et support</span>
          <div class="adm-boutons">
            <button type="button" class="btn btn-secondaire" data-action="sms">+ SMS</button>
            ${p.user_id ? '<button type="button" class="btn btn-secondaire" data-action="mdp-proprio">Nouveau mot de passe propriétaire</button>' : ''}
            ${p.telephone ? `<a class="btn btn-whatsapp" href="${esc(lienWa(p.telephone, `Bonjour ${p.nom || ''}, ici l’équipe YOUMMA Business au sujet de votre boutique « ${b.nom} ».`))}" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} WhatsApp</a>` : ''}
            ${vit.slug ? `<a class="btn btn-secondaire" href="${esc(urlVitrine(vit.slug))}" target="_blank" rel="noopener">Voir la boutique en ligne</a>` : ''}
            ${estSuper() ? `<button type="button" class="btn ${b.suspendue ? 'btn-secondaire' : 'btn-refuser'}" data-action="suspendre">${b.suspendue ? 'Réactiver' : 'Suspendre'}</button>` : ''}
          </div>
        </div>
        <div class="champ">
          <label for="note-interne" class="gras">Note interne (visible par l’équipe YOUMMA uniquement)</label>
          <textarea id="note-interne" class="input" rows="3" maxlength="2000">${esc(b.note_interne || '')}</textarea>
          <span class="discret" data-ref="etat-note"></span>
        </div>
        ${blocHistorique(liste(f, 'historique').slice(0, 6))}`;
    }
    if (s.onglet === 'membres') {
      const membres = liste(f, 'membres');
      return tableau([
        ['Membre', (m) => `<span class="adm-cellule-nom"><strong>${esc(m.nom || '—')}</strong><span class="discret">${esc(telLocal(m.telephone))}</span></span>`],
        ['Rôle', (m) => esc(ROLES[m.role] || m.role || '')],
        ['Dernière connexion', (m) => esc(ilYa(champ(m, 'derniere_connexion', 'last_sign_in_at')))],
        ['État', (m) => [m.actif === false ? '<span class="pastille-admin gris">Désactivé</span>' : '', m.bloque ? '<span class="pastille-admin rouge">Bloqué</span>' : '', m.mdp_temporaire ? '<span class="pastille-admin orange">Mot de passe provisoire</span>' : ''].join(' ') || '<span class="pastille-admin vert">Actif</span>'],
        ['', (m) => m.user_id ? `<span class="adm-boutons-ligne">
            <button type="button" class="btn btn-secondaire btn-petit" data-mdp="${esc(m.user_id)}">Nouveau mot de passe</button>
            ${estSuper() ? `<button type="button" class="btn btn-petit ${m.bloque ? 'btn-secondaire' : 'btn-refuser'}" data-bloquer="${esc(m.user_id)}" data-etat="${m.bloque ? 'bloque' : ''}">${m.bloque ? 'Débloquer' : 'Bloquer'}</button>` : ''}</span>` : '']
      ], membres, { vide: 'Aucun membre.' });
    }
    if (s.onglet === 'licence') {
      const paiements = liste(f, 'paiements');
      return `
        <div class="adm-boutons"><button type="button" class="btn btn-primaire" data-action="paiement">${icone('plus', 18, 2.4)} Enregistrer un paiement</button></div>
        ${tableau([
          ['Date', (p) => esc(formatDate(p.created_at, 'court'))],
          ['Objet', (p) => esc(objetPaiement(p))],
          ['Mode', (p) => esc(MODES_PAIEMENT_YOUMMA[p.mode] || p.mode || '')],
          ['Montant', (p) => `<strong>${gnf(p.montant)}</strong>`, { droite: true }],
          ['Statut', (p) => statutPaiement(p.statut)]
        ], paiements, { vide: 'Aucun paiement enregistré.' })}`;
    }
    if (s.onglet === 'sms') {
      const recharges = liste(sms, 'recharges');
      return `
        <div class="adm-faits">
          <div><span>Crédit SMS</span><strong>${nombre(champ(sms, 'solde') ?? 0)} SMS</strong></div>
          <div><span>Envoyés ce mois</span><strong>${nombre(champ(sms, 'envoyes_mois', 'mois') || 0)}</strong></div>
          <div><span>Échecs ce mois</span><strong>${nombre(champ(sms, 'echecs_mois') || 0)}</strong></div>
        </div>
        <div class="adm-boutons"><button type="button" class="btn btn-primaire" data-action="sms">+ SMS</button></div>
        <h3 class="adm-sous-titre">Recharges</h3>
        ${tableau([
          ['Date', (r) => esc(formatDate(r.created_at, 'court'))],
          ['SMS', (r) => nombre(champ(r, 'nb_sms', 'nb')), { droite: true }],
          ['Montant', (r) => gnf(r.montant), { droite: true }],
          ['Référence', (r) => esc(r.reference || '—')]
        ], recharges, { vide: 'Aucune recharge.' })}`;
    }
    if (s.onglet === 'vitrine') {
      if (!vit.slug) return '<p class="vide-admin">Boutique en ligne pas encore configurée.</p>';
      return `
        <div class="adm-faits">
          <div><span>Adresse</span><strong>…/b/${esc(vit.slug)}</strong></div>
          <div><span>État</span><strong>${vit.actif ? 'Activée' : 'Fermée'}</strong></div>
          <div><span>Visites (mois)</span><strong>${nombre(champ(vit, 'visites') || 0)}</strong></div>
          <div><span>Commandes</span><strong>${nombre(champ(vit, 'commandes') || 0)} · ${nombre(champ(vit, 'livrees') || 0)} livrées</strong></div>
        </div>
        <div class="adm-boutons">
          <a class="btn btn-secondaire" href="${esc(urlVitrine(vit.slug))}" target="_blank" rel="noopener">Ouvrir la boutique en ligne</a>
          ${estSuper() ? `<button type="button" class="btn ${vit.actif ? 'btn-refuser' : 'btn-primaire'}" data-action="vitrine">${vit.actif ? 'Couper la boutique en ligne' : 'Réactiver la boutique en ligne'}</button>` : ''}
        </div>`;
    }
    // Activité
    const support = liste(f, 'support');
    return `
      ${blocHistorique(liste(f, 'historique'))}
      <h3 class="adm-sous-titre">Demandes d’aide</h3>
      ${support.length ? `<ul class="adm-liste-simple">${support.map((d) => `<li><a href="#/support?demande=${encodeURIComponent(d.id)}"><strong>${esc(d.sujet || 'Demande')}</strong> <span class="discret">${esc(formatDate(d.created_at, 'court'))}</span> ${statutAide(d.statut)}</a></li>`).join('')}</ul>` : '<p class="vide-admin">Aucune demande d’aide.</p>'}`;
  }

  function brancher() {
    cadre.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => { s.onglet = b.dataset.onglet; render(); }));
    const note = cadre.querySelector('#note-interne');
    if (note) {
      const etatNote = cadre.querySelector('[data-ref="etat-note"]');
      const enregistrer = differer(async () => {
        etatNote.textContent = 'Enregistrement…';
        try {
          await rpc('admin_note', { p_boutique: idBoutique, p_note: note.value.trim() || null });
          s.fiche.boutique.note_interne = note.value;
          etatNote.textContent = 'Note enregistrée.';
        } catch (err) { etatNote.textContent = erreurAdmin(err); }
      }, 1000);
      note.addEventListener('input', () => { etatNote.textContent = '…'; enregistrer(); });
    }
  }

  async function licence(mode, valeur, { date = null, formule = null, message }) {
    try {
      const fin = premiere(await rpc('admin_licence', { p_boutique: idBoutique, p_mode: mode, p_valeur: valeur, p_date: date, p_formule: formule }));
      const finTexteNouvelle = typeof fin === 'string' ? fin : champ(fin, 'licence_fin', 'fin', 'nouvelle_fin');
      rafraichir(`${message}${finTexteNouvelle ? ` Fin : ${formatDate(finTexteNouvelle, 'court')}.` : ''}`);
    } catch (err) { toast(erreurAdmin(err), 'erreur'); }
  }

  // onclick (et non addEventListener) : la fiche réutilise le même cadre quand on change de boutique.
  cadre.onclick = async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    const b = s.fiche?.boutique || {};
    if (action === 'essai7' && await confirmer(`Prolonger « ${b.nom} » de 7 jours ?`, { titre: 'Prolonger l’essai', libelleOk: '+ 7 jours' })) licence('jours', 7, { message: 'Licence prolongée de 7 jours.' });
    if (action === 'mois1' && await confirmer(`Prolonger la licence de « ${b.nom} » d’1 mois ?`, { titre: 'Prolonger', libelleOk: '+ 1 mois' })) licence('mois', 1, { message: 'Licence prolongée d’1 mois.' });
    if (action === 'an1' && await confirmer(`Prolonger la licence de « ${b.nom} » d’1 an ?`, { titre: 'Prolonger', libelleOk: '+ 1 an' })) licence('mois', 12, { message: 'Licence prolongée d’1 an.' });
    if (action === 'date') ouvrirDateLibre(b, (date) => licence('date', null, { date, message: 'Date de fin modifiée.' }));
    if (action === 'formule') ouvrirChangerFormule(b, (formule, mois) => licence('mois', mois, { formule, message: 'Formule changée.' }));
    if (action === 'modules') ouvrirModules(b, async (modules) => {
      try { await rpc('admin_modules', { p_boutique: idBoutique, p_modules: modules }); rafraichir('Modules enregistrés.'); } catch (err) { toast(erreurAdmin(err), 'erreur'); }
    });
    if (action === 'suspendre') ouvrirSuspension(b, async (suspendre, motif) => {
      try { await rpc('admin_suspendre', { p_boutique: idBoutique, p_suspendre: suspendre, p_motif: motif }); rafraichir(suspendre ? 'Boutique suspendue.' : 'Boutique réactivée.'); } catch (err) { toast(erreurAdmin(err), 'erreur'); }
    });
    if (action === 'sms') ouvrirAjoutSms(b, () => rafraichir());
    if (action === 'mdp-proprio') nouveauMotDePasse({ ...proprietaire() }, confirmer);
    if (action === 'paiement') ouvrirEnregistrerPaiement({ id: idBoutique, nom: b.nom, licence_formule: b.licence_formule }, () => rafraichir());
    if (action === 'vitrine') {
      const actif = !s.fiche.vitrine?.actif;
      if (!(await confirmer(actif ? `Réactiver la boutique en ligne de « ${b.nom} » ?` : `Couper la boutique en ligne de « ${b.nom} » ? Ses clients verront « Boutique fermée temporairement ».`,
        { titre: 'Boutique en ligne', libelleOk: actif ? 'Réactiver' : 'Couper', danger: !actif }))) return;
      try { await rpc('admin_vitrine_actif', { p_boutique: idBoutique, p_actif: actif }); rafraichir(actif ? 'Boutique en ligne réactivée.' : 'Boutique en ligne coupée.'); } catch (err) { toast(erreurAdmin(err), 'erreur'); }
    }
    const mdp = e.target.closest('[data-mdp]');
    if (mdp) nouveauMotDePasse(liste(s.fiche, 'membres').find((m) => m.user_id === mdp.dataset.mdp) || { user_id: mdp.dataset.mdp }, confirmer);
    const bloquer = e.target.closest('[data-bloquer]');
    if (bloquer) {
      const debloquer = bloquer.dataset.etat === 'bloque';
      const m = liste(s.fiche, 'membres').find((x) => x.user_id === bloquer.dataset.bloquer) || {};
      if (!(await confirmer(debloquer ? `Débloquer le compte de ${m.nom || 'ce membre'} ?` : `Bloquer le compte de ${m.nom || 'ce membre'} ? Il ne pourra plus se connecter.`,
        { titre: debloquer ? 'Débloquer' : 'Bloquer le compte', libelleOk: debloquer ? 'Débloquer' : 'Bloquer', danger: !debloquer }))) return;
      try { await appelComptes({ action: debloquer ? 'debloquer' : 'bloquer', user_id: bloquer.dataset.bloquer }); rafraichir(debloquer ? 'Compte débloqué.' : 'Compte bloqué.'); } catch (err) { toast(erreurAdmin(err), 'erreur'); }
    }
  };
  charger();
}

/* ------------------------------------------------------------ Petits éléments partagés */

export function objetPaiement(p) {
  if (p.objet === 'sms') return `Pack ${nombre(champ(p, 'nb_sms') || 0)} SMS`;
  const mois = Number(champ(p, 'duree_mois')) || 0;
  return `${champ(p, 'formule_nom', 'formule') || 'Licence'} ${mois === 12 ? '1 an' : `${mois} mois`}`;
}
export function statutPaiement(statut) {
  const s = { a_valider: ['À valider', 'orange'], en_attente: ['À valider', 'orange'], valide: ['Validé', 'vert'], refuse: ['Refusé', 'rouge'] }[statut] || [statut || '—', 'gris'];
  return `<span class="pastille-admin ${s[1]}">${esc(s[0])}</span>`;
}
export function statutAide(statut) {
  const s = { ouverte: ['Ouverte', 'rouge'], en_cours: ['En cours', 'orange'], resolue: ['Résolue', 'vert'] }[statut] || [statut || '—', 'gris'];
  return `<span class="pastille-admin ${s[1]}">${esc(s[0])}</span>`;
}
function blocHistorique(historique) {
  return `
    <h3 class="adm-sous-titre">Historique</h3>
    ${historique.length ? `<ul class="adm-journal">${historique.map((h) => `
      <li><span class="discret">${esc(formatDate(h.created_at, 'complet'))}</span><span>${esc(libelleAction(h.action))}${detailsAction(h.details) ? ` · ${esc(detailsAction(h.details))}` : ''}</span><span class="discret">${esc(champ(h, 'par', 'admin_nom', 'auteur') || '')}</span></li>`).join('')}</ul>` : '<p class="vide-admin">Aucune action enregistrée.</p>'}`;
}

function ouvrirDateLibre(b, valider) {
  const { el, fermer } = ouvrirModale({
    titre: 'Date de fin de licence',
    contenu: `
      <form class="form-modale" novalidate>
        <p class="texte-modale">Licence actuelle : jusqu’au <strong>${b.licence_fin ? esc(formatDate(b.licence_fin, 'court')) : '—'}</strong>.</p>
        <div class="champ"><label for="date-libre">Nouvelle date de fin</label><input id="date-libre" class="input" type="date" required value="${esc(String(b.licence_fin || '').slice(0, 10))}"></div>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`
  });
  el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = el.querySelector('#date-libre').value;
    if (!d) return;
    fermer();
    valider(d);
  });
}

async function ouvrirChangerFormule(b, valider) {
  const formules = (await chargerFormules()).filter((f) => f.actif !== false);
  const { el, fermer } = ouvrirModale({
    titre: 'Changer de formule',
    contenu: `
      <form class="form-modale" novalidate>
        <div class="champ"><label for="chg-formule">Formule</label><select id="chg-formule" class="input">${formules.map((f) => `<option value="${esc(f.code)}" ${f.code === b.licence_formule ? 'selected' : ''}>${esc(f.nom)}${Number(f.prix_mois) ? ` · ${gnf(f.prix_mois)} / mois` : ''}</option>`).join('')}</select></div>
        <div class="champ"><label for="chg-mois">Prolonger en même temps de</label><select id="chg-mois" class="input"><option value="0">Ne pas prolonger</option><option value="1">1 mois</option><option value="3">3 mois</option><option value="6">6 mois</option><option value="12">1 an</option></select></div>
        <p class="aide">Pour un paiement reçu, préférez « Enregistrer un paiement » (reçu SMS et encaissement).</p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Changer</button></div>
      </form>`
  });
  el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    fermer();
    valider(el.querySelector('#chg-formule').value, Number(el.querySelector('#chg-mois').value));
  });
}

function ouvrirModules(b, valider) {
  const actuels = b.modules && typeof b.modules === 'object' ? b.modules : {};
  const { el, fermer } = ouvrirModale({
    titre: 'Modules de la boutique',
    contenu: `
      <form class="form-modale" novalidate>
        ${MODULES.map(([c, l]) => `<label class="case-option"><input type="checkbox" name="${c}" ${actuels[c] !== false ? 'checked' : ''}> ${esc(l)}</label>`).join('')}
        <p class="aide">Enregistré pour la boutique. L’appli n’applique pas encore ces modules : tout reste visible pour l’instant.</p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`
  });
  el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const modules = Object.fromEntries(MODULES.map(([c]) => [c, el.querySelector(`[name="${c}"]`).checked]));
    fermer();
    valider(modules);
  });
}

function ouvrirSuspension(b, valider) {
  if (b.suspendue) {
    confirmer(`Réactiver « ${b.nom} » ? La boutique pourra de nouveau vendre (si sa licence est valide).`, { titre: 'Réactiver la boutique', libelleOk: 'Réactiver' })
      .then((ok) => ok && valider(false, null));
    return;
  }
  const { el, fermer } = ouvrirModale({
    titre: `Suspendre « ${b.nom} »`,
    contenu: `
      <form class="form-modale" novalidate>
        <p class="texte-modale">La boutique passe en lecture seule : plus de ventes ni de modifications. Le motif est affiché au propriétaire.</p>
        <div class="champ"><label for="motif-susp">Motif (obligatoire)</label><input id="motif-susp" class="input" type="text" maxlength="160" placeholder="Ex. impayé depuis 30 jours" required></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-danger">Suspendre</button></div>
      </form>`
  });
  el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const motif = el.querySelector('#motif-susp').value.trim();
    if (!motif) { const z = el.querySelector('.erreur-form'); z.textContent = 'Indiquez le motif.'; z.hidden = false; return; }
    fermer();
    valider(true, motif);
  });
}

/** + SMS : pack ou nombre libre (agent : 1 000 maximum), montant, référence → recharger_sms. */
export function ouvrirAjoutSms(b, apres) {
  const max = estSuper() ? 100000 : 1000;
  const { el, fermer } = ouvrirModale({
    titre: `Ajouter des SMS · ${b.nom}`,
    contenu: `
      <form class="form-modale" novalidate>
        <div class="packs-sms" role="group" aria-label="Pack">
          ${PACKS_SMS.map((p, i) => `<button type="button" class="pack-sms" data-pack="${i}" aria-pressed="${i === 0}"><span class="pack-nb">${formatNombre(p.nb)} SMS</span><span class="pack-prix">${gnf(p.prix)}</span></button>`).join('')}
        </div>
        <div class="rangee-champs">
          <div class="champ"><label for="sms-nb">Nombre de SMS${estSuper() ? ' (négatif = correction)' : ' (1 000 maximum)'}</label><input id="sms-nb" class="input" type="text" inputmode="numeric" value="${PACKS_SMS[0].nb}"></div>
          <div class="champ"><label for="sms-montant">Montant payé (GNF)</label><input id="sms-montant" class="input input-montant" type="text" inputmode="numeric" value="${formatNombre(PACKS_SMS[0].prix)}"></div>
        </div>
        <div class="champ"><label for="sms-ref">Référence (ex. n° de transaction Orange Money)</label><input id="sms-ref" class="input" type="text" maxlength="80"></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Ajouter</button></div>
      </form>`
  });
  const nb = el.querySelector('#sms-nb');
  const montant = el.querySelector('#sms-montant');
  montant.addEventListener('input', () => formaterSaisieMontant(montant));
  el.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pack]');
    if (!p) return;
    const pack = PACKS_SMS[Number(p.dataset.pack)];
    nb.value = pack.nb;
    montant.value = formatNombre(pack.prix);
    el.querySelectorAll('[data-pack]').forEach((x) => x.setAttribute('aria-pressed', String(x === p)));
  });
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = Math.round(Number(String(nb.value).replace(/[^\d-]/g, '')));
    const zoneErreur = el.querySelector('.erreur-form');
    if (!n || (!estSuper() && (n < 1 || n > max))) { zoneErreur.textContent = estSuper() ? 'Nombre de SMS invalide.' : 'Entre 1 et 1 000 SMS (au-delà : super admin).'; zoneErreur.hidden = false; return; }
    const bouton = e.target.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Ajout…');
    try {
      const solde = premiere(await rpc('recharger_sms', { p_boutique: b.id, p_nb: n, p_montant: lireNombre(montant.value) || 0, p_reference: el.querySelector('#sms-ref').value.trim() || null }));
      fermer();
      toast(`${b.nom} : ${n > 0 ? '+' : ''}${formatNombre(n)} SMS · nouveau solde ${formatNombre(Number(champ(solde, 'solde') ?? solde) || 0)} SMS.`, 'succes');
      apres?.();
    } catch (err) { boutonOccupe(bouton, false); zoneErreur.textContent = erreurAdmin(err); zoneErreur.hidden = false; }
  });
}
