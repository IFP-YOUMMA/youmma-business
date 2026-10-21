/**
 * messages.js — Centre de messages (maquette Messages.dc.html), gérant / propriétaire.
 *
 *  - #/messages ou #/messages/automatiques : alertes et messages automatiques + éditeur + aperçu
 *  - #/messages/campagnes                  : campagnes clients (liste, détail, annulation)
 *  - #/messages/fournisseurs               : fournisseurs et bons de commande (fournisseurs.js)
 *  - #/messages/historique                 : tous les SMS de la file (statuts, erreurs)
 *  - #/messages/campagne                   : nouvelle campagne (campagne.js)
 *
 * Aucun SMS n'est envoyé d'ici : les RPC mettent les messages en file d'attente,
 * la fonction Edge envoyer-messages les envoie chaque minute.
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import { monterFournisseurs } from './fournisseurs.js';
import { aModule, moduleVisible } from './modules.js';
import { afficherNouvelleCampagne, LIBELLES_CIBLES } from './campagne.js';
import {
  chargerSoldeSms, ouvrirRecharge, majCreditSmsAffiche, texteCompteur, compterSms, SMS_MAX_CARACTERES
} from './sms.js';
import {
  esc, icone, toast, confirmer, ouvrirModale, boutonOccupe, messageErreur, differer, formatGNF, formatNombre,
  formatDate, formatTelephone, normaliserTelephone, formaterSaisieMontant, lireNombre, dateISO, decalerDate,
  bornesPeriode, chargerParLots
} from './utils.js';

const ONGLETS = [['automatiques', 'Automatiques'], ['campagnes', 'Campagnes'], ['fournisseurs', 'Fournisseurs'], ['historique', 'Historique']];
/** Messages envoyés par YOUMMA à la boutique (plateforme = true) : ne consomment pas le crédit SMS. */
const LIBELLES_PLATEFORME = { relance_option: 'Fin de la boutique en ligne', relance_licence: 'Fin de licence', recu_paiement: 'Paiement reçu' };
const MAX_DESTINATAIRES_PATRON = 3;
const TAILLE_PAGE = 50;
const DELAI_APERCU_MS = 400;
const estMobile = () => window.matchMedia('(max-width: 899.98px)').matches;

/* ------------------------------------------------------------ Modèles : libellés, variables, réglages */

const VARIABLES_COMMUNES = ['{boutique}', '{tel_boutique}'];

/** Description de chaque modèle (cle en base). reglages : champs de params modifiables. */
const MODELES = {
  rapport_soir: { libelle: 'Rapport du soir', variables: ['{date}', '{ventes}', '{nb_ventes}', '{encaisse}', '{especes}', '{credits_jour}', '{depenses}', '{stock_bas}'],
    reglages: ['heure'], resume: (p) => `Chaque jour à ${p.heure || '19:00'} · ventes, encaissé, espèces attendues, crédits, dépenses` },
  vente_annulee: { libelle: 'Vente annulée', variables: ['{numero}', '{montant}', '{par}', '{heure}'],
    resume: () => 'Immédiatement · numéro, montant, qui a annulé' },
  grosse_remise: { libelle: 'Grosse remise', variables: ['{numero}', '{remise}', '{pourcent}', '{par}'], reglages: ['seuil_pct', 'seuil_montant'],
    resume: (p) => `Si remise supérieure à ${p.seuil_pct ?? 10} % ou ${formatGNF(p.seuil_montant ?? 50000)}` },
  sous_prix_achat: { libelle: 'Vente sous le prix d’achat', variables: ['{numero}', '{article}', '{prix}', '{prix_achat}', '{par}'],
    resume: () => 'Immédiatement · article, prix vendu, prix d’achat' },
  stock_bas: { libelle: 'Stock bas', variables: ['{articles}'], reglages: ['heure'],
    resume: (p) => `Une fois par jour à ${p.heure || '08:00'} · articles sous le seuil` },
  recu_vente: { libelle: 'Reçu de vente', variables: ['{prenom}', '{numero}', '{montant}', '{mode}', '{reste}'],
    resume: () => 'Quand la case « reçu par SMS » est cochée à la caisse' },
  rappel_echeance: { libelle: 'Rappel avant échéance', variables: ['{prenom}', '{montant}', '{echeance}'], reglages: ['heure', 'jours_avant'],
    resume: (p) => `${p.jours_avant ?? 2} jour${(p.jours_avant ?? 2) > 1 ? 's' : ''} avant la date de paiement prévue, à ${p.heure || '09:00'}` },
  relance_retard: { libelle: 'Relance des retards', variables: ['{prenom}', '{montant}', '{echeance}'], reglages: ['heure', 'intervalle_jours', 'max'],
    resume: (p) => `Après l’échéance, tous les ${p.intervalle_jours ?? 7} jours (${p.max ?? 3} fois max.), à ${p.heure || '09:00'}` },
  recu_remboursement: { libelle: 'Reçu de remboursement', variables: ['{prenom}', '{montant}', '{reste}'],
    resume: () => 'Après chaque remboursement encaissé' },
  situation_chantier: { libelle: 'Situation chantier', variables: ['{prenom}', '{chantier}', '{operation}', '{montant}', '{solde}'],
    resume: () => 'Après chaque enlèvement ou versement' },
  commande_web: { libelle: 'Nouvelle commande en ligne', variables: ['{numero}', '{client}', '{telephone}', '{total}', '{reception}'],
    resume: () => 'Dès qu’un client commande sur votre boutique en ligne' },
  commande_confirmee: { libelle: 'Commande en ligne confirmée', variables: ['{prenom}', '{numero}', '{total}', '{reception}'],
    resume: () => 'Quand vous confirmez une commande en ligne' },
  bon_commande: { libelle: 'Bon de commande', variables: ['{fournisseur}', '{numero}', '{lignes}'],
    resume: () => 'À la création d’un bon, si « Envoyer aussi par SMS » est coché' },
  relance_livraison: { libelle: 'Relance livraison', variables: ['{fournisseur}', '{numero}', '{date}'], reglages: ['heure', 'jours'],
    resume: (p) => `Si la commande n’est pas reçue après ${p.jours ?? 3} jours, à ${p.heure || '09:00'}` }
};

const GROUPES = [
  { code: 'patron', titre: 'Pour le patron', sous: 'Gardez l’œil sur la boutique, même à distance', icone: 'vendeurs', teinte: '#E3F2EC', encre: '#0A5E48',
    cles: ['rapport_soir', 'commande_web', 'vente_annulee', 'grosse_remise', 'sous_prix_achat', 'stock_bas'], recoit: 'le patron' },
  { code: 'clients', titre: 'Pour les clients', sous: 'Récupérez vos crédits sans y penser', icone: 'client', teinte: '#E8F5EA', encre: '#1B6E2A',
    cles: ['recu_vente', 'commande_confirmee', 'rappel_echeance', 'relance_retard', 'recu_remboursement', 'situation_chantier'], recoit: 'le client' },
  { code: 'fournisseurs', titre: 'Pour les fournisseurs', sous: 'Commandez sans appeler', icone: 'camion', teinte: '#FFF1D6', encre: '#7A4A00',
    cles: ['bon_commande', 'relance_livraison'], recoit: 'le fournisseur' }
];
const groupeDe = (cle) => GROUPES.find((g) => g.cles.includes(cle));
/** Modèles qui n'ont de sens qu'avec un module (masqués sinon). */
const MODULE_DU_MODELE = {
  commande_web: 'boutique_en_ligne', commande_confirmee: 'boutique_en_ligne',
  rappel_echeance: 'credits', relance_retard: 'credits', recu_remboursement: 'credits',
  situation_chantier: 'chantiers', bon_commande: 'fournisseurs', relance_livraison: 'fournisseurs'
};
const modeleVisible = (cle) => !MODULE_DU_MODELE[cle] || moduleVisible(MODULE_DU_MODELE[cle]);
const ongletsVisibles = () => ONGLETS.filter(([code]) => code !== 'fournisseurs' || aModule('fournisseurs'));

/** Champs de réglage : libellé, type de saisie. */
const REGLAGES = {
  heure: { libelle: 'Heure d’envoi', type: 'heure' },
  seuil_pct: { libelle: 'Remise supérieure à (%)', type: 'nombre', suffixe: '%' },
  seuil_montant: { libelle: 'ou supérieure à (GNF)', type: 'montant' },
  jours_avant: { libelle: 'Jours avant l’échéance', type: 'nombre' },
  intervalle_jours: { libelle: 'Relancer tous les (jours)', type: 'nombre' },
  max: { libelle: 'Nombre maximum de relances', type: 'nombre' },
  jours: { libelle: 'Relancer après (jours sans livraison)', type: 'nombre' }
};

const STATUTS_MESSAGE = {
  en_attente: { libelle: 'En attente', classe: 'attente' },
  envoi: { libelle: 'Envoi…', classe: 'attente' },
  envoye: { libelle: 'Envoyé', classe: 'envoye' },
  echec: { libelle: 'Échec', classe: 'echec' },
  annule: { libelle: 'Annulé', classe: 'annule' }
};
const STATUTS_CAMPAGNE = { programmee: 'Programmée', envoyee: 'Envoyée', annulee: 'Annulée' };

function badgeStatut(statut, erreur) {
  const st = STATUTS_MESSAGE[statut] || { libelle: statut, classe: 'attente' };
  return `<span class="badge-message ${st.classe}" ${erreur ? `title="${esc(erreur)}"` : ''}>${esc(st.libelle)}${erreur ? ' ⓘ' : ''}</span>`;
}

/* =========================================================================
   Page
   ========================================================================= */

export function afficherMessages(conteneur, params) {
  const vue = params.get('id') || 'automatiques';
  if (vue === 'campagne') { afficherNouvelleCampagne(conteneur); return; }
  const onglet = ongletsVisibles().some(([code]) => code === vue) ? vue : 'automatiques';

  conteneur.innerHTML = `
    <div class="page page-messages">
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour seul-ordi" href="#/aujourdhui">← Aujourd’hui</a>
          <h1>Messages</h1>
          <span>Alertes automatiques, relances et campagnes · SMS et WhatsApp</span>
        </div>
        <div class="carte-credit-sms" data-zone="credit">
          <div class="ccs-textes">
            <span class="ccs-libelle">Crédit SMS</span>
            <span class="ccs-solde"><span class="squelette" style="height:24px;width:90px"></span></span>
            <span class="ccs-estimation" data-ref="estimation"></span>
          </div>
          <button type="button" class="btn btn-licence" data-action="recharger">Recharger</button>
        </div>
      </header>
      <nav class="onglets" role="tablist" aria-label="Sections">
        ${ongletsVisibles().map(([code, libelle]) => `
          <a href="#/messages/${code}" class="onglet-messages ${code === onglet ? 'actif' : ''}" role="tab" aria-selected="${code === onglet}">${esc(libelle)}</a>`).join('')}
      </nav>
      <div data-zone="onglet"></div>
    </div>`;

  const zoneOnglet = conteneur.querySelector('[data-zone="onglet"]');
  conteneur.querySelector('[data-action="recharger"]').addEventListener('click', ouvrirRecharge);
  chargerCredit(conteneur.querySelector('[data-zone="credit"]'));
  if (onglet === 'automatiques') monterAutomatiques(zoneOnglet);
  if (onglet === 'campagnes') monterCampagnes(zoneOnglet);
  if (onglet === 'fournisseurs') monterFournisseurs(zoneOnglet);
  if (onglet === 'historique') monterHistorique(zoneOnglet);
}

/** Carte « Crédit SMS » : solde et estimation au rythme des 7 derniers jours. */
async function chargerCredit(zone) {
  try {
    const debut = `${decalerDate(dateISO(), -6)}T00:00:00Z`;
    const [solde, envoyes] = await Promise.all([
      chargerSoldeSms(),
      chargerParLots((d, f) => sb.from('messages_envoyes').select('nb_sms, plateforme')
        .eq('boutique_id', etat.boutique.id).eq('statut', 'envoye').gte('envoye_at', debut).range(d, f))
    ]);
    if (!zone.isConnected) return;
    zone.querySelector('.ccs-solde').innerHTML = `${formatNombre(solde)} <span>SMS restant${solde > 1 ? 's' : ''}</span>`;
    zone.classList.toggle('bas', solde < 20);
    const parJour = envoyes.filter((m) => !m.plateforme).reduce((t, m) => t + (Number(m.nb_sms) || 0), 0) / 7;
    zone.querySelector('[data-ref="estimation"]').textContent = parJour > 0
      ? `≈ ${formatNombre(Math.floor(solde / parJour))} jour${Math.floor(solde / parJour) > 1 ? 's' : ''} au rythme actuel` : '';
  } catch (err) {
    zone.querySelector('.ccs-solde').textContent = 'Indisponible';
    console.warn('[YOUMMA] Crédit SMS :', err);
  }
}

/* =========================================================================
   Onglet « Automatiques »
   ========================================================================= */

function monterAutomatiques(zone) {
  const boutique = etat.boutique;
  const s = { modeles: [], selection: null };
  zone.innerHTML = `
    <div class="clients-corps">
      <section class="automatiques" aria-label="Messages automatiques" data-zone="groupes">
        ${'<div class="carte"><span class="squelette" style="height:18px;width:40%"></span><span class="squelette" style="height:60px;margin-top:10px"></span></div>'.repeat(3)}
      </section>
      <aside class="editeur-cadre seul-ordi" aria-label="Modifier un message" data-zone="editeur"></aside>
    </div>`;
  const sous = (nom) => zone.querySelector(`[data-zone="${nom}"]`);

  function ligneHTML(m) {
    const meta = MODELES[m.cle];
    const params = m.params || {};
    const groupe = groupeDe(m.cle);
    const nbDest = (m.destinataires || []).length;
    return `
      <div class="ligne-modele ${m.cle === s.selection ? 'selectionnee' : ''}">
        <button type="button" class="lm-textes" data-modifier="${esc(m.cle)}">
          <span class="gras">${esc(meta.libelle)}</span>
          <span class="discret">${esc(meta.resume(params))}</span>
          ${groupe.code === 'patron' ? `<span class="discret">${nbDest ? `${nbDest} numéro${nbDest > 1 ? 's' : ''}` : 'Aucun destinataire : ajoutez un numéro'}</span>` : ''}
        </button>
        <span class="canal-sms">SMS</span>
        <button type="button" class="btn btn-secondaire btn-petit" data-modifier="${esc(m.cle)}" aria-label="Modifier « ${esc(meta.libelle)} »">Modifier</button>
        <button type="button" class="interrupteur" role="switch" aria-checked="${Boolean(m.actif)}" data-basculer="${esc(m.cle)}" aria-label="${m.actif ? 'Désactiver' : 'Activer'} « ${esc(meta.libelle)} »"><span></span></button>
      </div>`;
  }

  function renderGroupes() {
    sous('groupes').innerHTML = GROUPES.map((g) => {
      const modeles = g.cles.filter(modeleVisible).map((cle) => s.modeles.find((m) => m.cle === cle)).filter(Boolean);
      if (!modeles.length) return '';
      return `
        <div class="carte groupe-modeles">
          <div class="groupe-entete">
            <span class="kpi-icone" style="background:${g.teinte};color:${g.encre}">${icone(g.icone, 18, 2)}</span>
            <span class="groupe-titres"><span class="tres-gras">${esc(g.titre)}</span><span class="discret">${esc(g.sous)}</span></span>
          </div>
          ${modeles.map(ligneHTML).join('')}
        </div>`;
    }).join('');
  }

  async function charger(cleAOuvrir = s.selection) {
    const { data, error } = await sb.rpc('lister_modeles', { p_boutique: boutique.id });
    if (!zone.isConnected) return;
    if (error) { sous('groupes').innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(error))}</p>`; return; }
    s.modeles = (data || []).filter((m) => MODELES[m.cle]);
    renderGroupes();
    if (!estMobile()) ouvrirEditeur(cleAOuvrir || 'rapport_soir');
  }

  async function basculer(cle) {
    const m = s.modeles.find((x) => x.cle === cle);
    const actif = !m.actif;
    m.actif = actif;
    renderGroupes();
    const { error } = await sb.rpc('modifier_modele', {
      p_boutique: boutique.id, p_cle: cle, p_actif: actif, p_texte: m.texte, p_destinataires: null, p_params: {}
    });
    if (error) { m.actif = !actif; renderGroupes(); toast(messageErreur(error), 'erreur'); return; }
    toast(`${MODELES[cle].libelle} : ${actif ? 'activé' : 'désactivé'}.`, 'succes');
    if (s.selection === cle && !estMobile()) ouvrirEditeur(cle);
  }

  function ouvrirEditeur(cle) {
    const modele = s.modeles.find((m) => m.cle === cle);
    if (!modele) return;
    s.selection = cle;
    renderGroupes();
    if (estMobile()) {
      const { el, fermer } = ouvrirModale({ titre: MODELES[cle].libelle, variante: 'large', contenu: '<div class="editeur-modale"></div>' });
      monterEditeur(el.querySelector('.editeur-modale'), modele, { apres: (cleMaj) => { fermer(); charger(cleMaj); } });
    } else {
      monterEditeur(sous('editeur'), modele, { apres: (cleMaj) => charger(cleMaj) });
    }
  }

  zone.addEventListener('click', (e) => {
    const bascule = e.target.closest('[data-basculer]');
    if (bascule) { basculer(bascule.dataset.basculer); return; }
    const modifier = e.target.closest('[data-modifier]');
    if (modifier) ouvrirEditeur(modifier.dataset.modifier);
  });
  charger();
}

/**
 * Éditeur d'un modèle : texte + variables + compteur, réglages, destinataires (patron),
 * aperçu téléphone (apercu_modele), Enregistrer, Envoyer un test, Revenir au texte d'origine.
 */
function monterEditeur(cadre, modele, { apres }) {
  const boutique = etat.boutique;
  const meta = MODELES[modele.cle];
  const groupe = groupeDe(modele.cle);
  const s = {
    texte: modele.texte || '',
    params: { ...(modele.params || {}) },
    destinataires: [...(modele.destinataires || [])],
    jetonApercu: 0
  };

  cadre.innerHTML = `
    <section class="carte editeur-modele">
      <div class="bloc-entete">
        <h2>${esc(meta.libelle)}</h2>
        <span class="statut-modele ${modele.actif ? 'actif' : ''}">${modele.actif ? `Activé${s.params.heure ? ' · ' + esc(s.params.heure) : ''}` : 'Désactivé'}</span>
      </div>
      <div class="champ">
        <label for="texte-modele">Texte du message</label>
        <textarea id="texte-modele" class="input" rows="6" maxlength="${SMS_MAX_CARACTERES + 100}">${esc(s.texte)}</textarea>
      </div>
      <div class="puces-variables" role="group" aria-label="Insérer une variable">
        ${[...meta.variables, ...VARIABLES_COMMUNES].map((v) => `<button type="button" class="puce-variable" data-variable="${esc(v)}">${esc(v)}</button>`).join('')}
      </div>
      <div class="compteur-sms"><span>Sans accents (SMS standard)</span><span data-ref="compteur"></span></div>
      ${(meta.reglages || []).length ? `
        <div class="rangee-champs reglages-modele">
          ${meta.reglages.map((cle) => {
            const r = REGLAGES[cle];
            const valeur = s.params[cle];
            if (r.type === 'heure') return `<div class="champ"><label for="reg-${cle}">${esc(r.libelle)}</label><input id="reg-${cle}" class="input" type="time" data-reglage="${cle}" value="${esc(valeur || '')}"></div>`;
            if (r.type === 'montant') return `<div class="champ"><label for="reg-${cle}">${esc(r.libelle)}</label><input id="reg-${cle}" class="input" type="text" inputmode="numeric" data-reglage="${cle}" value="${valeur ? formatNombre(valeur) : ''}"></div>`;
            return `<div class="champ"><label for="reg-${cle}">${esc(r.libelle)}</label><input id="reg-${cle}" class="input" type="number" inputmode="numeric" min="0" step="1" data-reglage="${cle}" value="${esc(valeur ?? '')}"></div>`;
          }).join('')}
        </div>` : ''}
      ${groupe.code === 'patron' ? `
        <div class="champ">
          <span class="etiquette">Destinataires (${MAX_DESTINATAIRES_PATRON} maximum)</span>
          <div class="destinataires" data-zone="destinataires"></div>
        </div>` : ''}
      <p class="erreur-form" role="alert" hidden></p>
      <div class="actions-editeur">
        <button type="button" class="btn btn-secondaire" data-action="test">${icone('sms', 18, 2)} Envoyer un test</button>
        <button type="button" class="btn btn-primaire" data-action="enregistrer">Enregistrer</button>
      </div>
      <button type="button" class="btn-lien btn-lien-gauche" data-action="reinitialiser">Revenir au texte d’origine</button>
    </section>
    <section class="apercu-telephone" aria-label="Aperçu du SMS reçu">
      <span class="apercu-legende">Ce que ${esc(groupe.recoit)} reçoit · expéditeur « YOUMMA BIZ »</span>
      <div class="bulle-sms" data-ref="apercu" aria-live="polite">…</div>
      <span class="apercu-heure">${esc(s.params.heure || formatDate(new Date(), 'heure'))}</span>
    </section>`;
  const ref = (nom) => cadre.querySelector(`[data-ref="${nom}"]`);
  const champTexte = cadre.querySelector('#texte-modele');
  const zoneErreur = cadre.querySelector('.erreur-form');
  const erreur = (m) => { zoneErreur.textContent = m; zoneErreur.hidden = !m; };

  function majCompteur() {
    const { caracteres } = compterSms(s.texte);
    ref('compteur').textContent = texteCompteur(s.texte);
    ref('compteur').classList.toggle('texte-danger', caracteres > SMS_MAX_CARACTERES);
  }

  const majApercu = differer(async () => {
    const jeton = ++s.jetonApercu;
    const { data, error } = await sb.rpc('apercu_modele', { p_boutique: boutique.id, p_cle: modele.cle, p_texte: s.texte });
    if (jeton !== s.jetonApercu || !cadre.isConnected) return;
    const r = (Array.isArray(data) ? data[0] : data) || {};
    ref('apercu').textContent = error ? messageErreur(error) : (r.texte || '');
  }, DELAI_APERCU_MS);

  function renderDestinataires() {
    const zoneDest = cadre.querySelector('[data-zone="destinataires"]');
    if (!zoneDest) return;
    zoneDest.innerHTML = `
      ${s.destinataires.map((n, i) => `
        <span class="puce-destinataire">${esc(formatTelephone(n))}
          <button type="button" class="btn-retirer" data-retirer="${i}" aria-label="Retirer ${esc(formatTelephone(n))}">${icone('fermer', 14, 2.4)}</button></span>`).join('')}
      ${s.destinataires.length < MAX_DESTINATAIRES_PATRON ? `
        <span class="ajout-destinataire">
          <label class="sr-only" for="nouveau-destinataire">Numéro à ajouter</label>
          <input id="nouveau-destinataire" class="input input-petit" type="tel" inputmode="tel" placeholder="6XX XX XX XX">
          <button type="button" class="btn btn-secondaire btn-petit" data-action="ajouter-destinataire">+ Ajouter</button>
        </span>` : ''}`;
  }

  function insererVariable(variable) {
    const debut = champTexte.selectionStart ?? champTexte.value.length;
    const fin = champTexte.selectionEnd ?? debut;
    champTexte.value = champTexte.value.slice(0, debut) + variable + champTexte.value.slice(fin);
    champTexte.focus();
    champTexte.setSelectionRange(debut + variable.length, debut + variable.length);
    s.texte = champTexte.value;
    majCompteur();
    majApercu();
  }

  function lireReglages() {
    const params = {};
    cadre.querySelectorAll('[data-reglage]').forEach((champ) => {
      const cle = champ.dataset.reglage;
      if (REGLAGES[cle].type === 'heure') { if (champ.value) params[cle] = champ.value; }
      else { const n = lireNombre(champ.value); if (n !== null) params[cle] = Math.max(0, Math.round(n)); }
    });
    return params;
  }

  async function enregistrer(bouton) {
    if (!s.texte.trim()) return erreur('Écrivez le texte du message.');
    if (compterSms(s.texte).caracteres > SMS_MAX_CARACTERES) return erreur('Message trop long (3 SMS maximum).');
    erreur('');
    boutonOccupe(bouton, true, 'Enregistrement…');
    const { error } = await sb.rpc('modifier_modele', {
      p_boutique: boutique.id,
      p_cle: modele.cle,
      p_actif: modele.actif,
      p_texte: s.texte,
      p_destinataires: groupe.code === 'patron' ? s.destinataires : null,
      p_params: lireReglages()
    });
    boutonOccupe(bouton, false);
    if (error) { erreur(messageErreur(error)); return; }
    toast(`« ${meta.libelle} » enregistré.`, 'succes');
    apres(modele.cle);
  }

  async function envoyerTest(bouton) {
    if (!s.texte.trim()) return erreur('Écrivez le texte du message.');
    erreur('');
    boutonOccupe(bouton, true, 'Envoi…');
    const { data, error } = await sb.rpc('envoyer_test', { p_boutique: boutique.id, p_cle: modele.cle, p_texte: s.texte });
    boutonOccupe(bouton, false);
    if (error) { erreur(messageErreur(error)); return; }
    const r = (Array.isArray(data) ? data[0] : data) || {};
    toast(`Test envoyé au ${formatTelephone(r.telephone || '')} (${r.nb_sms || 1} SMS) : il arrive dans la minute.`, 'succes', 7000);
    majCreditSmsAffiche();
  }

  async function reinitialiser() {
    if (!(await confirmer('Le texte et les réglages d’origine de ce message seront rétablis.', { titre: 'Revenir au texte d’origine', libelleOk: 'Rétablir' }))) return;
    const { error } = await sb.rpc('reinitialiser_modele', { p_boutique: boutique.id, p_cle: modele.cle });
    if (error) { toast(messageErreur(error), 'erreur'); return; }
    toast('Texte d’origine rétabli.', 'succes');
    apres(modele.cle);
  }

  cadre.onclick = (e) => {
    const variable = e.target.closest('[data-variable]');
    if (variable) { insererVariable(variable.dataset.variable); return; }
    const retirer = e.target.closest('[data-retirer]');
    if (retirer) { s.destinataires.splice(Number(retirer.dataset.retirer), 1); renderDestinataires(); return; }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'ajouter-destinataire') {
      const champ = cadre.querySelector('#nouveau-destinataire');
      const numero = normaliserTelephone(champ.value);
      if (!numero) { erreur('Numéro invalide. Exemple : 620 00 00 00.'); champ.focus(); return; }
      if (s.destinataires.includes(numero)) { erreur('Ce numéro est déjà dans la liste.'); return; }
      erreur('');
      s.destinataires.push(numero);
      renderDestinataires();
    }
    if (action === 'enregistrer') enregistrer(e.target.closest('button'));
    if (action === 'test') envoyerTest(e.target.closest('button'));
    if (action === 'reinitialiser') reinitialiser();
  };
  cadre.oninput = (e) => {
    if (e.target === champTexte) { s.texte = champTexte.value; majCompteur(); majApercu(); }
    if (e.target.dataset.reglage && REGLAGES[e.target.dataset.reglage].type === 'montant') formaterSaisieMontant(e.target);
  };

  renderDestinataires();
  majCompteur();
  majApercu();
}

/* =========================================================================
   Onglet « Campagnes »
   ========================================================================= */

function monterCampagnes(zone) {
  const boutique = etat.boutique;
  const s = { campagnes: [] };
  zone.innerHTML = `
    <section class="carte section-parametres">
      <div class="bloc-entete">
        <h2>Campagnes</h2>
        ${peut('campagnes.envoyer') ? `<a class="btn btn-primaire" href="#/messages/campagne">${icone('plus', 18, 2.4)} Nouvelle campagne</a>` : ''}
      </div>
      <ul class="liste-campagnes" data-zone="liste"><li class="discret">Chargement…</li></ul>
    </section>`;
  const liste = zone.querySelector('[data-zone="liste"]');

  function render() {
    liste.innerHTML = s.campagnes.length ? s.campagnes.map((c) => `
      <li>
        <div class="ligne-campagne">
          <button type="button" class="lc-textes" data-detail="${esc(c.id)}">
            <span class="gras">${esc(c.titre || 'Campagne')}</span>
            <span class="discret">${esc(c.statut === 'programmee' ? 'Prévue le ' : 'Le ')}${esc(formatDate(c.programme_at || c.created_at, 'complet'))} · ${esc(LIBELLES_CIBLES[c.cible] || c.cible)}</span>
            <span class="discret">${formatNombre(c.nb_destinataires)} destinataire${c.nb_destinataires > 1 ? 's' : ''} · ${formatNombre(c.nb_sms)} SMS</span>
          </button>
          <span class="badge-campagne ${c.statut}">${esc(STATUTS_CAMPAGNE[c.statut] || c.statut)}</span>
          ${c.statut === 'programmee' ? `<button type="button" class="btn-lien btn-lien-danger" data-annuler="${esc(c.id)}">Annuler</button>` : ''}
        </div>
      </li>`).join('') : `<li class="etat-vide"><p>Aucune campagne pour l’instant. Prévenez vos clients d’un arrivage ou d’une promo en quelques secondes.</p></li>`;
  }

  async function charger() {
    const { data, error } = await sb.from('campagnes')
      .select('id, titre, texte, cible, nb_destinataires, nb_sms, statut, programme_at, created_at')
      .eq('boutique_id', boutique.id).order('created_at', { ascending: false }).limit(50);
    if (!zone.isConnected) return;
    if (error) { liste.innerHTML = `<li class="bloc-erreur">${esc(messageErreur(error))}</li>`; return; }
    s.campagnes = data;
    render();
  }

  async function annuler(id) {
    const c = s.campagnes.find((x) => x.id === id);
    if (!(await confirmer(`Annuler la campagne « ${c.titre || 'Campagne'} » ? Les SMS pas encore partis sont retirés de la file et votre crédit est conservé.`, { titre: 'Annuler la campagne', libelleOk: 'Annuler la campagne', danger: true }))) return;
    const { data, error } = await sb.rpc('annuler_campagne', { p_campagne: id });
    if (error) { toast(messageErreur(error), 'erreur'); return; }
    const n = Number(Array.isArray(data) ? data[0] : data) || 0;
    toast(`Campagne annulée : ${formatNombre(n)} SMS retiré${n > 1 ? 's' : ''} de la file.`, 'succes');
    majCreditSmsAffiche();
    charger();
  }

  async function detail(id) {
    const c = s.campagnes.find((x) => x.id === id);
    const { el } = ouvrirModale({
      titre: c.titre || 'Campagne',
      variante: 'large',
      contenu: `
        <p class="texte-modale bulle-sms bulle-statique">${esc(c.texte || '')}</p>
        <p class="discret">${esc(LIBELLES_CIBLES[c.cible] || c.cible)} · ${formatNombre(c.nb_destinataires)} destinataire(s) · ${formatNombre(c.nb_sms)} SMS · ${esc(STATUTS_CAMPAGNE[c.statut] || c.statut)}</p>
        <div data-zone="messages-campagne"><p class="discret">Chargement…</p></div>`
    });
    const cadre = el.querySelector('[data-zone="messages-campagne"]');
    const { data, error } = await sb.from('messages_envoyes').select('id, destinataire, nom, nb_sms, statut, erreur, envoye_at, created_at')
      .eq('campagne_id', id).order('created_at', { ascending: true }).limit(500);
    if (!cadre.isConnected) return;
    if (error) { cadre.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(error))}</p>`; return; }
    const compte = (st) => data.filter((m) => m.statut === st).length;
    cadre.innerHTML = `
      <p class="gras">${compte('envoye')} envoyé(s) · ${compte('en_attente') + compte('envoi')} en attente · ${compte('echec')} échec(s) · ${compte('annule')} annulé(s)</p>
      <ul class="historique">${data.map((m) => `
        <li class="historique-ligne">
          <span class="historique-textes"><span class="gras">${esc(m.nom || 'Client')}</span><span class="discret">${esc(formatTelephone(m.destinataire))}${m.envoye_at ? ' · ' + esc(formatDate(m.envoye_at, 'complet')) : ''}</span></span>
          ${badgeStatut(m.statut, m.erreur)}
        </li>`).join('')}</ul>`;
  }

  zone.addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-annuler]');
    if (bouton) { annuler(bouton.dataset.annuler); return; }
    const ligne = e.target.closest('[data-detail]');
    if (ligne) detail(ligne.dataset.detail);
  });
  charger();
}

/* =========================================================================
   Onglet « Historique »
   ========================================================================= */

function monterHistorique(zone) {
  const boutique = etat.boutique;
  const s = { periode: '7j', cle: '', statut: '', messages: [], fin: false, jeton: 0 };
  zone.innerHTML = `
    <section class="carte section-parametres">
      <div class="filtres-ventes">
        <div class="segments segments-cadre" role="group" aria-label="Période">
          ${[['jour', 'Aujourd’hui'], ['7j', '7 jours'], ['mois', 'Ce mois'], ['moisDernier', 'Mois dernier']].map(([code, libelle]) => `
            <button type="button" class="segment ${code === s.periode ? 'actif' : ''}" data-periode="${code}" aria-pressed="${code === s.periode}">${esc(libelle)}</button>`).join('')}
        </div>
        <label class="filtre-select"><span class="sr-only">Type</span>
          <select id="filtre-type"><option value="">Type : tous</option><option value="campagne">Campagnes</option>
            ${Object.entries(MODELES).map(([cle, m]) => `<option value="${cle}">${esc(m.libelle)}</option>`).join('')}</select></label>
        <label class="filtre-select"><span class="sr-only">Statut</span>
          <select id="filtre-statut"><option value="">Statut : tous</option>
            ${Object.entries(STATUTS_MESSAGE).map(([code, st]) => `<option value="${code}">${esc(st.libelle)}</option>`).join('')}</select></label>
      </div>
      <p class="total-sms" data-zone="total"></p>
      <p class="note-plateforme">${icone('sms', 15, 2)} Les messages marqués <span class="badge-youmma">YOUMMA</span> sont envoyés par YOUMMA : fin de licence, et fin de la boutique en ligne (7 jours puis 2 jours avant). Ils ne consomment pas votre crédit SMS.</p>
      <div class="entete-historique-sms seul-ordi" aria-hidden="true"><span>Date</span><span>Type</span><span>Destinataire</span><span>Message</span><span class="droite">SMS</span><span>Statut</span></div>
      <ul class="liste-historique-sms" data-zone="liste"></ul>
      <div class="charger-plus" data-zone="plus"></div>
    </section>`;
  const sous = (nom) => zone.querySelector(`[data-zone="${nom}"]`);

  function filtrer(requete) {
    const { du, au } = bornesPeriode(s.periode);
    let r = requete.eq('boutique_id', boutique.id)
      .gte('created_at', `${du}T00:00:00Z`).lt('created_at', `${decalerDate(au, 1)}T00:00:00Z`);
    if (s.cle === 'campagne') r = r.not('campagne_id', 'is', null);
    else if (s.cle) r = r.eq('cle', s.cle);
    if (s.statut) r = r.eq('statut', s.statut);
    return r;
  }

  function ligneHTML(m) {
    const type = m.plateforme ? (LIBELLES_PLATEFORME[m.cle] || 'Message YOUMMA') : m.campagne_id ? 'Campagne' : (MODELES[m.cle]?.libelle || (m.cle || 'Message'));
    return `
      <li class="ligne-histo-sms ${m.statut === 'annule' ? 'annule' : ''} ${m.plateforme ? 'plateforme' : ''}">
        <span class="lsms-date">${esc(formatDate(m.created_at, 'complet'))}</span>
        <span class="lsms-type">${m.plateforme ? '<span class="badge-youmma">YOUMMA</span> ' : ''}${esc(type)}</span>
        <span class="lsms-dest"><span class="gras">${esc(m.nom || '—')}</span><span class="discret">${esc(formatTelephone(m.destinataire))}</span></span>
        <span class="lsms-texte" title="${esc(m.texte)}">${esc(m.texte)}</span>
        <span class="lsms-nb">${m.plateforme ? '<span class="discret">offert</span>' : formatNombre(m.nb_sms)}</span>
        <span class="lsms-statut">${badgeStatut(m.statut, m.statut === 'echec' ? m.erreur : null)}</span>
      </li>`;
  }

  async function charger(suite = false) {
    const jeton = ++s.jeton;
    if (!suite) { s.messages = []; s.fin = false; sous('liste').innerHTML = '<li class="discret">Chargement…</li>'; }
    const debut = s.messages.length;
    const [res, envoyes] = await Promise.all([
      filtrer(sb.from('messages_envoyes').select('id, cle, campagne_id, destinataire, nom, texte, nb_sms, statut, erreur, programme_at, envoye_at, created_at, plateforme'))
        .order('created_at', { ascending: false }).range(debut, debut + TAILLE_PAGE - 1),
      suite ? Promise.resolve(null) : chargerParLots((d, f) => filtrer(sb.from('messages_envoyes').select('nb_sms, plateforme')).eq('statut', 'envoye').range(d, f)).catch(() => null)
    ]);
    if (jeton !== s.jeton || !zone.isConnected) return;
    if (res.error) { sous('liste').innerHTML = `<li class="bloc-erreur">${esc(messageErreur(res.error))}</li>`; return; }
    s.messages.push(...res.data);
    s.fin = res.data.length < TAILLE_PAGE;
    if (envoyes) {
      // Les messages de YOUMMA ne sont pas décomptés du crédit de la boutique.
      const total = envoyes.filter((m) => !m.plateforme).reduce((t, m) => t + (Number(m.nb_sms) || 0), 0);
      sous('total').innerHTML = `<strong>${formatNombre(total)} SMS envoyé${total > 1 ? 's' : ''}</strong> sur la période`;
    }
    sous('liste').innerHTML = s.messages.length ? s.messages.map(ligneHTML).join('') : '<li class="etat-vide"><p>Aucun message sur cette période.</p></li>';
    sous('plus').innerHTML = s.fin ? '' : '<button type="button" class="btn btn-secondaire" data-action="plus">Charger plus</button>';
  }

  zone.addEventListener('click', (e) => {
    const periode = e.target.closest('[data-periode]');
    if (periode) {
      s.periode = periode.dataset.periode;
      zone.querySelectorAll('[data-periode]').forEach((b) => { b.classList.toggle('actif', b === periode); b.setAttribute('aria-pressed', String(b === periode)); });
      charger();
    }
    if (e.target.closest('[data-action="plus"]')) charger(true);
  });
  zone.querySelector('#filtre-type').addEventListener('change', (e) => { s.cle = e.target.value; charger(); });
  zone.querySelector('#filtre-statut').addEventListener('change', (e) => { s.statut = e.target.value; charger(); });
  charger();
}

