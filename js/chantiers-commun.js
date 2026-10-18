/**
 * chantiers-commun.js — Éléments partagés des comptes chantier :
 * affichage du solde, ouverture d'un chantier, versement, compression de la photo du bon.
 *
 * Utilisé par la page Chantiers, la fiche client et la caisse.
 * Toutes les écritures passent par des fonctions serveur (ouvrir_chantier, versement_chantier…).
 */
import { sb } from './supabase.js';
import { etat } from './state.js';
import { naviguer } from './router.js';
import { ouvrirFormulaireClient, COLONNES_CLIENT } from './clients-commun.js';
import { imprimerRecuVersement } from './recu.js';
import {
  esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, differer, initiales, formatGNF,
  formatTelephone, formaterSaisieMontant, texteSolde, classeSolde, MODES_PAIEMENT
} from './utils.js';


export const COLONNES_CHANTIER = 'id, boutique_id, client_id, numero, nom, adresse, statut, solde, cree_par, created_at, cloture_at';
export const MODES_VERSEMENT = ['especes', 'orange_money', 'mtn_momo'];

/* ------------------------------------------------------------ Solde */

/** Badge coloré du solde. */
export function badgeSolde(solde) {
  return `<span class="badge-solde ${classeSolde(solde)}">${esc(texteSolde(solde))}</span>`;
}

/** Chantier ouvert d'un client (ou null). Un seul chantier ouvert par client. */
export async function chargerChantierOuvert(idClient) {
  const { data, error } = await sb.from('chantiers')
    .select(COLONNES_CHANTIER)
    .eq('boutique_id', etat.boutique.id)
    .eq('client_id', idClient)
    .eq('statut', 'ouvert')
    .limit(1);
  if (error) throw error;
  return data[0] || null;
}

/* ------------------------------------------------------------ Boutons de mode de paiement */

function modesHTML(modeChoisi) {
  return `
    <div class="modes-remb" role="group" aria-label="Mode de paiement">
      ${MODES_VERSEMENT.map((code) => `
        <button type="button" class="mode-remb" data-mode-versement="${code}" aria-pressed="${code === modeChoisi}">${esc(MODES_PAIEMENT[code].libelle)}</button>`).join('')}
    </div>`;
}

function brancherModes(racine, surChoix) {
  racine.addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-mode-versement]');
    if (!bouton) return;
    racine.querySelectorAll('[data-mode-versement]').forEach((b) => b.setAttribute('aria-pressed', String(b === bouton)));
    surChoix(bouton.dataset.modeVersement);
  });
}

/* ------------------------------------------------------------ Ouvrir un chantier */

/**
 * Modale « Ouvrir un chantier ». client : client déjà choisi (fiche client) ou null (recherche).
 * Après ouverture : navigation vers le compte du chantier.
 */
export function ouvrirFormulaireChantier({ client = null } = {}) {
  const boutique = etat.boutique;
  const s = { client, mode: 'especes', avance: null, chantierExistant: null };
  const { el, fermer } = ouvrirModale({
    titre: 'Ouvrir un chantier',
    variante: 'large',
    contenu: `
      <form class="form-modale form-chantier" novalidate>
        <div class="champ">
          <span class="etiquette">Client</span>
          <div data-zone="client"></div>
        </div>
        <div class="rangee-champs">
          <div class="champ">
            <label for="ch-nom">Nom du chantier</label>
            <input id="ch-nom" name="nom" class="input" type="text" maxlength="80" required placeholder="Ex. Villa Kagbélen">
          </div>
          <div class="champ">
            <label for="ch-adresse">Adresse / quartier (facultatif)</label>
            <input id="ch-adresse" name="adresse" class="input" type="text" maxlength="120" placeholder="Ex. Kagbélen, près du marché">
          </div>
        </div>
        <fieldset class="champ cadre-avance">
          <legend class="etiquette">Avance à l’ouverture (facultatif)</legend>
          <input id="ch-avance" class="input input-montant" type="text" inputmode="numeric" autocomplete="off" placeholder="0" aria-label="Montant de l’avance en GNF">
          <div data-zone="avance-details" hidden>
            ${modesHTML(s.mode)}
            <div class="champ">
              <label for="ch-verse-par">Versé par</label>
              <input id="ch-verse-par" name="verse_par" class="input" type="text" maxlength="80" placeholder="Ex. M. Bah (patron)">
            </div>
          </div>
        </fieldset>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
          <button type="submit" class="btn btn-primaire">Ouvrir le chantier</button>
        </div>
      </form>`
  });
  const formulaire = el.querySelector('form');
  const zoneClient = el.querySelector('[data-zone="client"]');
  const zoneErreur = formulaire.querySelector('.erreur-form');
  const erreur = (m) => { zoneErreur.textContent = m; zoneErreur.hidden = !m; };

  /* -- Choix du client -- */
  function renderClient() {
    if (s.client) {
      zoneClient.innerHTML = `
        <div class="client-bouton client-choisi">
          <span class="avatar">${esc(initiales(s.client.nom))}</span>
          <span class="client-textes">
            <span class="gras">${esc(s.client.nom)}</span>
            <span class="discret">${esc(s.client.telephone ? formatTelephone(s.client.telephone) : 'Sans téléphone')}</span>
          </span>
          ${client ? '' : '<button type="button" class="btn-lien" data-action="changer-client">Changer</button>'}
        </div>
        <div data-zone="existant"></div>`;
      verifierChantierExistant();
      return;
    }
    zoneClient.innerHTML = `
      <label class="sr-only" for="ch-recherche-client">Rechercher un client</label>
      <input id="ch-recherche-client" class="input" type="search" placeholder="Nom ou téléphone du client" autocomplete="off">
      <div class="liste-clients" data-zone="resultats"></div>
      <button type="button" class="btn btn-secondaire btn-bloc" data-action="nouveau-client">${icone('plus', 18, 2.2)} Nouveau client</button>`;
    const champ = zoneClient.querySelector('#ch-recherche-client');
    champ.addEventListener('input', differer(() => rechercher(champ.value), 250));
    rechercher('');
    champ.focus();
  }

  let resultats = [];
  async function rechercher(texte) {
    const zone = zoneClient.querySelector('[data-zone="resultats"]');
    let requete = sb.from('clients').select(COLONNES_CLIENT).eq('boutique_id', boutique.id).order('nom').limit(8);
    const q = texte.replace(/[,()*%\\]/g, ' ').trim();
    if (q) {
      const chiffres = q.replace(/\D/g, '');
      requete = requete.or(`nom.ilike.%${q}%${chiffres.length >= 3 ? `,telephone.ilike.%${chiffres}%` : ''}`);
    }
    const { data, error } = await requete;
    if (!zone?.isConnected) return;
    if (error) { zone.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(error))}</p>`; return; }
    resultats = data;
    zone.innerHTML = data.length ? data.map((c) => `
      <button type="button" class="item-client" data-client="${esc(c.id)}">
        <span class="avatar">${esc(initiales(c.nom))}</span>
        <span class="client-textes"><span class="gras">${esc(c.nom)}</span><span class="discret">${esc(c.telephone ? formatTelephone(c.telephone) : 'Sans téléphone')}</span></span>
      </button>`).join('') : `<p class="discret">${q ? `Aucun client trouvé pour « ${esc(texte)} ».` : 'Aucun client pour l’instant.'}</p>`;
  }

  async function verifierChantierExistant() {
    const zone = zoneClient.querySelector('[data-zone="existant"]');
    s.chantierExistant = null;
    try {
      s.chantierExistant = await chargerChantierOuvert(s.client.id);
    } catch (err) {
      zone.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`;
      return;
    }
    if (!zone.isConnected) return;
    zone.innerHTML = s.chantierExistant ? `
      <p class="note-alerte">${icone('alerte', 16, 2)}
        <span>Ce client a déjà un chantier ouvert : <strong>${esc(s.chantierExistant.nom)}</strong> (${esc(texteSolde(s.chantierExistant.solde))}).
        <a href="#/chantiers/${encodeURIComponent(s.chantierExistant.id)}">Ouvrir ce compte</a></span>
      </p>` : '';
  }

  el.addEventListener('click', (e) => {
    const choix = e.target.closest('[data-client]');
    if (choix) {
      s.client = resultats.find((c) => c.id === choix.dataset.client);
      renderClient();
      formulaire.nom.focus();
    }
    if (e.target.closest('[data-action="changer-client"]')) { s.client = null; renderClient(); }
    if (e.target.closest('[data-action="nouveau-client"]')) {
      ouvrirFormulaireClient({ onEnregistre: (c) => { s.client = c; renderClient(); } });
    }
    if (e.target.closest('a[href^="#/"]')) fermer();
  });

  /* -- Avance -- */
  el.querySelector('#ch-avance').addEventListener('input', (e) => {
    s.avance = formaterSaisieMontant(e.target);
    el.querySelector('[data-zone="avance-details"]').hidden = !(s.avance > 0);
  });
  brancherModes(el.querySelector('[data-zone="avance-details"]'), (mode) => { s.mode = mode; });

  formulaire.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nom = formulaire.nom.value.trim();
    if (!s.client) return erreur('Choisissez le client du chantier.');
    if (s.chantierExistant) return erreur('Ce client a déjà un chantier ouvert.');
    if (nom.length < 2) return erreur('Indiquez le nom du chantier.');
    erreur('');
    const bouton = formulaire.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Ouverture…');
    const avance = s.avance > 0 ? s.avance : 0;
    const { data, error } = await sb.rpc('ouvrir_chantier', {
      p_boutique: boutique.id,
      p_client: s.client.id,
      p_nom: nom,
      p_adresse: formulaire.adresse.value.trim() || null,
      p_avance: avance,
      p_mode: avance ? s.mode : null,
      p_verse_par: avance ? (formulaire.verse_par.value.trim() || null) : null
    });
    boutonOccupe(bouton, false);
    if (error) { erreur(messageErreur(error)); return; }
    const chantier = (Array.isArray(data) ? data[0] : data) || {};
    fermer();
    toast(`Chantier ${chantier.numero || ''} ouvert pour ${s.client.nom}.`, 'succes');
    naviguer(`chantiers/${chantier.id}`);
  });

  renderClient();
}

/* ------------------------------------------------------------ Versement */

/**
 * Modale « Versement » sur un chantier. apres(nouveauSolde) est appelé en cas de succès,
 * puis le reçu de versement peut être imprimé.
 */
export function ouvrirVersement(chantier, client, apres) {
  const s = { montant: null, mode: 'especes' };
  const ancienSolde = Number(chantier.solde) || 0;
  const { el, fermer } = ouvrirModale({
    titre: 'Versement',
    contenu: `
      <form class="form-modale" novalidate>
        <p class="texte-modale">${esc(chantier.nom)} · actuellement <strong class="${classeSolde(ancienSolde)}">${esc(texteSolde(ancienSolde))}</strong></p>
        <div class="champ">
          <label for="vers-montant">Montant reçu (GNF)</label>
          <input id="vers-montant" class="input input-montant" type="text" inputmode="numeric" autocomplete="off" placeholder="0">
        </div>
        ${modesHTML(s.mode)}
        <div class="rangee-champs">
          <div class="champ"><label for="vers-par">Versé par</label><input id="vers-par" name="verse_par" class="input" type="text" maxlength="80" placeholder="Ex. M. Bah (patron)"></div>
          <div class="champ"><label for="vers-note">Note (facultatif)</label><input id="vers-note" name="note" class="input" type="text" maxlength="160"></div>
        </div>
        <div class="ligne-apercu"><span class="discret">Nouveau solde après versement</span><span class="gras" data-ref="apercu">${esc(texteSolde(ancienSolde))}</span></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
          <button type="submit" class="btn btn-succes">Enregistrer le versement</button>
        </div>
      </form>`
  });
  const formulaire = el.querySelector('form');
  const zoneErreur = formulaire.querySelector('.erreur-form');
  const apercu = el.querySelector('[data-ref="apercu"]');
  el.querySelector('#vers-montant').addEventListener('input', (e) => {
    s.montant = formaterSaisieMontant(e.target);
    const nouveau = ancienSolde + (s.montant || 0);
    apercu.textContent = texteSolde(nouveau);
    apercu.className = `gras ${classeSolde(nouveau)}`;
  });
  brancherModes(formulaire, (mode) => { s.mode = mode; });

  formulaire.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!(s.montant > 0)) { zoneErreur.textContent = 'Indiquez le montant reçu.'; zoneErreur.hidden = false; return; }
    zoneErreur.hidden = true;
    const bouton = formulaire.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Enregistrement…');
    const versePar = formulaire.verse_par.value.trim() || null;
    const { data, error } = await sb.rpc('versement_chantier', {
      p_chantier: chantier.id,
      p_montant: s.montant,
      p_mode: s.mode,
      p_verse_par: versePar,
      p_note: formulaire.note.value.trim() || null
    });
    boutonOccupe(bouton, false);
    if (error) { zoneErreur.textContent = messageErreur(error); zoneErreur.hidden = false; return; }
    const retour = Number(Array.isArray(data) ? data[0] : data);
    const nouveauSolde = Number.isFinite(retour) ? retour : ancienSolde + s.montant;
    fermer();
    toast(`Versement de ${formatGNF(s.montant)} enregistré.`, 'succes');
    apres?.(nouveauSolde);
    proposerRecuVersement({
      date: new Date().toISOString(),
      chantier,
      client: client?.nom || '',
      montant: s.montant,
      mode: s.mode,
      versePar,
      ancienSolde,
      nouveauSolde,
      encaissePar: etat.membre?.nom || '—'
    });
  });
}

function proposerRecuVersement(recu) {
  const { el, fermer } = ouvrirModale({
    titre: 'Versement enregistré',
    contenu: `
      <div class="confirmation">
        <span class="confirmation-icone">${icone('valide', 32, 2.6)}</span>
        <p class="confirmation-numero">${esc(recu.chantier.nom)} · ${esc(MODES_PAIEMENT[recu.mode].libelle)}</p>
        <p class="confirmation-total">${formatGNF(recu.montant)}</p>
        <div class="confirmation-monnaie"><span>Nouveau solde</span><strong class="${classeSolde(recu.nouveauSolde)}">${esc(texteSolde(recu.nouveauSolde))}</strong></div>
      </div>
      <div class="modale-actions">
        <button type="button" class="btn btn-secondaire btn-grand" data-action="imprimer">${icone('imprimante', 18, 2)} Imprimer le reçu</button>
        <button type="button" class="btn btn-primaire btn-grand" data-fermer>Terminé</button>
      </div>`
  });
  el.querySelector('[data-action="imprimer"]').addEventListener('click', () => { imprimerRecuVersement(recu); fermer(); });
}

/* ------------------------------------------------------------ Photo du bon signé */

const COTE_MAX_PHOTO = 1280;
const TAILLE_MAX_PHOTO = 400 * 1024;
/** Essais successifs [côté le plus long, qualité JPEG] jusqu'à passer sous 400 Ko. */
const ESSAIS_COMPRESSION = [
  [COTE_MAX_PHOTO, 0.7], [COTE_MAX_PHOTO, 0.55], [COTE_MAX_PHOTO, 0.4], [1024, 0.4], [800, 0.4], [640, 0.35]
];

/** Charge une image (avec l'orientation de l'appareil photo si le navigateur la gère). */
async function chargerImage(fichier) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(fichier, { imageOrientation: 'from-image' }); } catch { /* repli ci-dessous */ }
  }
  const url = URL.createObjectURL(fichier);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Dessine l'image réduite (côté le plus long = cote px) et l'encode en JPEG. */
function encoderJpeg(image, cote, qualite) {
  const echelle = Math.min(1, cote / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * echelle);
  canvas.height = Math.round(image.height * echelle);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resoudre, rejeter) => {
    canvas.toBlob((blob) => (blob ? resoudre(blob) : rejeter(new Error('Compression impossible'))), 'image/jpeg', qualite);
  });
}

/**
 * Compresse une photo dans le navigateur : côté le plus long 1280 px, JPEG qualité 0,7.
 * Si le fichier dépasse encore 400 Ko (photo très détaillée), on baisse la qualité puis la taille.
 */
export async function compresserImage(fichier) {
  const image = await chargerImage(fichier);
  try {
    let blob = null;
    for (const [cote, qualite] of ESSAIS_COMPRESSION) {
      blob = await encoderJpeg(image, cote, qualite);
      if (blob.size <= TAILLE_MAX_PHOTO) break;
    }
    return blob;
  } finally {
    image.close?.();
  }
}

/** Envoie la photo compressée dans le bucket privé « bons » et renvoie son chemin. */
export async function envoyerPhotoBon(idChantier, blob) {
  const chemin = `${etat.boutique.id}/${idChantier}/${Date.now()}.jpg`;
  const { error } = await sb.storage.from('bons').upload(chemin, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return chemin;
}

/** Affiche la photo d'un bon en grand (adresse signée temporaire du bucket privé). */
export async function afficherPhotoBon(chemin) {
  const { el } = ouvrirModale({ titre: 'Photo du bon signé', variante: 'large', contenu: '<div class="photo-bon"><p class="discret">Chargement de la photo…</p></div>' });
  const { data, error } = await sb.storage.from('bons').createSignedUrl(chemin, 300);
  const zone = el.querySelector('.photo-bon');
  if (error || !data?.signedUrl) { zone.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(error || 'Photo introuvable'))}</p>`; return; }
  zone.innerHTML = `<img src="${esc(data.signedUrl)}" alt="Bon d’enlèvement signé">`;
}
