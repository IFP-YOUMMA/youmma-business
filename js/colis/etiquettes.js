/**
 * colis/etiquettes.js — Les trois étiquettes d'un colis (étape 16, maquettes ColisEtiquette, ColisEtiquette4,
 * ColisEtiquetteA6), #/colis/<id>/etiquette. Un seul écran, trois onglets, une seule feuille de style d'impression.
 *
 *  - A4 « bordereau » : le REÇU DE L'EXPÉDITEUR, avec le montant et une souche détachable ; il ne se colle pas.
 *  - A6 « autocollante » et planche A4 de 4 : le dessin qui se colle sur le carton — SANS AUCUN MONTANT
 *    (une pastille « À PAYER AU RETRAIT » ou « PAYÉ AU DÉPART », le montant se voit par le QR / le suivi).
 * Code-barres : le numéro sans tirets (Code 128, js/codes-barres.js). QR : l'adresse complète du suivi (js/qr.js),
 * correction d'erreur Q et zone calme de 4 modules. Les deux générateurs sont ceux déjà utilisés par l'appli
 * (js/vendor), mis en cache : l'impression marche hors ligne.
 */
import { etat } from '../state.js';
import { esc, icone, messageErreur, formatDate, initiales } from '../utils.js';
import { chargerJsBarcode, svgCode128 } from '../codes-barres.js';
import { svgQr } from '../qr.js';
import {
  api, chargerAgences, agenceSelon, codePays, formatTel, montant, numeroSansTirets, iconeColis, lienSuivi, MODES, MODES_PAIEMENT_COLIS
} from './commun.js';

/** QR des étiquettes : noir sur blanc, niveau Q (rattrape un pli, une trace, une impression pâle), zone calme 4. */
const qrEtiquette = (lien, titre) => svgQr(lien, { titre, niveau: 'Q', marge: 4, couleur: '#000000' });

const ONGLETS = [['a4', 'Bordereau A4'], ['planche', 'Planche de 4'], ['a6', 'Étiquette A6']];

/**
 * Données de l'étiquette à partir de suivi_interne : depart et arrivee sont des objets { nom, ville, drapeau, devise },
 * expediteur et destinataire des objets { nom, tel }. Le jeton vient de suivi_interne, sinon de enregistrer_colis
 * (gardé dans sessionStorage juste après l'enregistrement).
 */
export function donneesEtiquette(c, agences) {
  const local = (() => { try { return JSON.parse(sessionStorage.getItem(`yb_colis_${c.id}`) || 'null'); } catch { return null; } })();
  return {
    id: c.id, numero: c.numero, cree: c.created_at, mode: c.mode, statut: c.statut,
    depart: agenceSelon(agences, c.depart), arrivee: agenceSelon(agences, c.arrivee),
    expNom: c.expediteur.nom, expTel: c.expediteur.tel, destNom: c.destinataire.nom, destTel: c.destinataire.tel,
    contenu: c.contenu, douane: c.contenu_douane || c.contenu,
    poids: Number(c.poids_facture), poidsPese: Number(c.poids), nb: Number(c.nb_colis),
    montant: Number(c.montant), devise: c.devise, duMontant: c.du_montant, duDevise: c.du_devise,
    paye: Boolean(c.paye), payeMode: c.paye_mode,
    vehicule: c.envoi ? [c.envoi.numero, c.envoi.immatriculation].filter(Boolean).join(' · ') : '',
    lien: lienSuivi(local?.lien, c.jeton || local?.jeton)
  };
}

/** Ville telle que la base l'a normalisée (« Conakry ») ; les capitales du bandeau imprimé viennent du CSS. */
const ville = (a) => String(a?.ville || a?.nom || '');
const bureau = (a) => (a?.nom && a.nom !== a.ville ? a.nom : `Bureau de ${a?.ville || ''}`);
const lienCourt = (l) => String(l || '').replace(/^https?:\/\//, '');
const telAgence = (a) => (a?.telephone ? `${a.ville || a.nom} ${formatTel(a.telephone)}` : '');
const logo = () => (etat.boutique.logo_url ? `<img src="${esc(etat.boutique.logo_url)}" alt="">` : `<span>${esc(initiales(etat.boutique.nom))}</span>`);
const libVehicule = (d) => ({ avion: 'Vol', bateau: 'Navire' }[d.mode] || 'Camion');

/** Bandeau du trajet : pays + ville, flèche, icône du mode, flèche. */
function bandeau(d, grand = false) {
  return `
    <div class="et-trajet ${grand ? 'grand' : ''}">
      <div class="et-bout"><span class="et-code">${esc(codePays(d.depart))}</span><span><strong>${esc(ville(d.depart))}</strong>${grand ? `<small>${esc(d.depart?.nom && d.depart.nom !== d.depart.ville ? d.depart.nom : '')}</small>` : ''}</span></div>
      <div class="et-milieu"><span class="et-fleche">→</span><span class="et-rond">${iconeColis(MODES[d.mode]?.icone || 'colis', grand ? 22 : 15)}</span><span class="et-fleche">→</span>${grand ? `<small>PAR ${esc((MODES[d.mode]?.libelle || '').toUpperCase())}</small>` : ''}</div>
      <div class="et-bout droite"><span><strong>${esc(ville(d.arrivee))}</strong>${grand ? `<small>${esc(bureau(d.arrivee))}</small>` : ''}</span><span class="et-code">${esc(codePays(d.arrivee))}</span></div>
    </div>`;
}

/** L'étiquette qui se colle (A6) — aucun montant dessus. */
export function etiquetteA6(d) {
  const aPayer = !d.paye;
  return `
    <article class="et-a6">
      ${bandeau(d)}
      <div class="et-numero">${esc(d.numero)}</div>
      <div class="et-barres">${svgCode128(numeroSansTirets(d.numero), { hauteur: 46 })}</div>
      <div class="et-destinataire">
        <span class="et-etiquette">DESTINATAIRE</span>
        <strong class="et-dest-nom">${esc(d.destNom)}</strong>
        <span class="et-dest-tel">${esc(formatTel(d.destTel, { indicatif: true }))}</span>
        <span class="et-dest-bureau">${esc(bureau(d.arrivee))} · <strong>${esc(ville(d.arrivee))}</strong></span>
      </div>
      <div class="et-ligne-exp">
        <div><span class="et-etiquette">EXPÉDITEUR</span><strong>${esc(d.expNom)}</strong></div>
        <div class="et-mini"><span class="et-etiquette">POIDS</span><strong>${esc(String(d.poids).replace('.', ','))} kg</strong></div>
        <div class="et-mini"><span class="et-etiquette">COLIS</span><strong>${d.nb > 1 ? `1/${d.nb}` : '1/1'}</strong></div>
        <div class="et-mini"><span class="et-etiquette">MODE</span><strong>${esc(MODES[d.mode]?.libelle || '')}</strong></div>
      </div>
      <div class="et-etat ${aPayer ? 'a-payer' : 'paye'}">
        <span class="et-etat-icone">${aPayer ? '!' : '✓'}</span>
        <span><strong>${aPayer ? 'À PAYER AU RETRAIT' : 'PAYÉ AU DÉPART'}</strong><small>${aPayer ? 'Montant : scannez le QR ou voyez le suivi' : 'Rien à encaisser à la remise'}</small></span>
      </div>
      <div class="et-cadre-infos">
        <div><span class="et-etiquette">CONTENU</span><strong>${esc(d.contenu)}</strong></div>
        <div class="et-infos-bas"><span><span class="et-etiquette">DÉPÔT</span> <strong>${esc(formatDate(d.cree, 'court'))}</strong></span>
          <span><span class="et-etiquette">${libVehicule(d).toUpperCase()}</span> <strong>${esc(d.vehicule || '—')}</strong></span></div>
      </div>
      <div class="et-signature"><span class="et-etiquette">SIGNATURE À LA REMISE</span><span class="et-trait"></span></div>
      <footer class="et-pied">
        <span class="et-qr">${d.lien ? qrEtiquette(d.lien, 'QR du suivi du colis') : ''}</span>
        <span class="et-pied-textes"><strong>${esc(etat.boutique.nom)}</strong>
          <span>${esc(telAgence(d.depart))}</span><span>${esc(telAgence(d.arrivee))}</span>
          <span class="et-suivi">Suivi : ${esc(lienCourt(d.lien))}</span></span>
      </footer>
    </article>`;
}

/** Le bordereau A4 : reçu de l'expéditeur, avec le montant et la souche. */
export function bordereauA4(d, reglages = {}) {
  const aPayer = !d.paye;
  const modePaye = MODES_PAIEMENT_COLIS.find(([c]) => c === d.payeMode)?.[1];
  const du = d.duMontant !== undefined && d.duMontant !== null ? { montant: d.duMontant, devise: d.duDevise || d.arrivee?.devise } : { montant: d.montant, devise: d.devise };
  const bloc = (titre, nom, tel, ligne, pays) => `
    <div class="et-partie"><span class="et-etiquette">${titre}</span><strong>${esc(nom)}</strong><span class="et-gras">${esc(formatTel(tel, { indicatif: true }))}</span>
      <span class="et-discret">${esc(ligne)}</span><span class="et-gras">${esc(pays)}</span></div>`;
  const nomPays = (a) => (codePays(a) === 'SN' ? 'SÉNÉGAL' : codePays(a) === 'GN' ? 'GUINÉE' : String(a?.pays || '').toUpperCase());
  return `
    <article class="et-a4">
      <header class="et-a4-entete">
        <span class="et-logo">${logo()}</span>
        <span class="et-a4-boutique"><strong>${esc(etat.boutique.nom.toUpperCase())}</strong><span>${esc([telAgence(d.depart), telAgence(d.arrivee)].filter(Boolean).join(' · '))}</span></span>
        <span class="et-a4-titre"><span>BORDEREAU — REÇU DE L’EXPÉDITEUR</span><strong>${esc(formatDate(d.cree, 'long').replace(/^\w+ /, ''))} · ${esc(formatDate(d.cree, 'heure').replace(':', ' h '))}</strong></span>
      </header>
      ${bandeau(d, true)}
      <div class="et-a4-codes">
        <div class="et-a4-numero"><span class="et-etiquette">NUMÉRO DU COLIS</span><strong>${esc(d.numero)}</strong>
          <span class="et-barres">${svgCode128(numeroSansTirets(d.numero), { hauteur: 56 })}</span><span class="et-chiffres">${esc(numeroSansTirets(d.numero).split('').join(' '))}</span></div>
        <div class="et-a4-qr"><span class="et-qr">${d.lien ? qrEtiquette(d.lien, 'QR du suivi du colis') : ''}</span><strong>Scannez pour voir tout le colis</strong><span class="et-discret">${esc(lienCourt(d.lien))}</span></div>
      </div>
      <div class="et-a4-parties">
        ${bloc('EXPÉDITEUR', d.expNom, d.expTel, `Déposé au ${bureau(d.depart)}`, `${ville(d.depart)} — ${nomPays(d.depart)}`)}
        ${bloc('DESTINATAIRE', d.destNom, d.destTel, `Retrait au ${bureau(d.arrivee)}`, `${ville(d.arrivee)} — ${nomPays(d.arrivee)}`)}
      </div>
      <div class="et-a4-infos">
        <div><span class="et-etiquette">CONTENU</span><strong>${esc(d.contenu)}</strong></div>
        <div><span class="et-etiquette">POIDS</span><strong>${esc(String(d.poids).replace('.', ','))} kg</strong>${d.poidsPese && d.poidsPese < d.poids ? `<span class="et-discret">${esc(String(d.poidsPese).replace('.', ','))} kg pesés</span>` : ''}</div>
        <div><span class="et-etiquette">COLIS</span><strong>${d.nb > 1 ? `${d.nb} cartons` : '1 / 1'}</strong></div>
        <div><span class="et-etiquette">MODE</span><strong>${esc(MODES[d.mode]?.libelle || '')}</strong></div>
        <div><span class="et-etiquette">ENVOI</span><strong>${esc(d.vehicule || 'à l’envoi')}</strong></div>
      </div>
      <div class="et-a4-bas">
        <div class="et-a4-montant ${aPayer ? 'a-payer' : 'paye'}">
          <span class="et-etat-icone">${aPayer ? '!' : '✓'}</span>
          <span>${aPayer
            ? `<span class="et-etiquette">À PAYER AU RETRAIT</span><strong>${esc(montant(du.montant, du.devise))}</strong>${du.devise !== d.devise ? `<span class="et-discret">soit ${esc(montant(d.montant, d.devise))} au départ</span>` : ''}`
            : `<span class="et-etiquette">PAYÉ AU DÉPART</span><strong>${esc(montant(d.montant, d.devise))}</strong>${modePaye ? `<span class="et-discret">${esc(modePaye)}</span>` : ''}`}</span>
        </div>
        <div class="et-a4-retrait"><span class="et-etiquette">RETRAIT</span><span>Pièce d’identité obligatoire.<br>Conservez ce bordereau.</span><strong>Signature à la remise</strong><span class="et-trait"></span></div>
      </div>
      <p class="et-a4-mentions"><strong>Ce bordereau ne se colle pas sur le colis.</strong> Il est remis à l’expéditeur. ${esc(reglages.conditions || 'La marchandise voyage aux risques de l’expéditeur. Les objets de valeur, l’argent et les produits interdits ne sont pas acceptés.')}<span class="et-logiciel">Logiciel YOUMMA Business</span></p>
      <div class="et-souche">
        <div><span class="et-etiquette">SOUCHE À GARDER AU BUREAU</span><strong class="et-souche-numero">${esc(d.numero)}</strong>
          <span class="et-discret">${esc(d.expNom)} → ${esc(d.destNom)} · ${esc(String(d.poids).replace('.', ','))} kg · ${esc(MODES[d.mode]?.libelle || '')} · ${esc(formatDate(d.cree, 'court'))}</span>
          <strong class="et-souche-montant">${aPayer ? `À payer au retrait : ${esc(montant(du.montant, du.devise))}` : `Payé au départ : ${esc(montant(d.montant, d.devise))}`}</strong></div>
        <span class="et-barres petit">${svgCode128(numeroSansTirets(d.numero), { hauteur: 40 })}</span>
        <span class="et-qr petit">${d.lien ? qrEtiquette(d.lien, 'QR du suivi') : ''}</span>
      </div>
    </article>`;
}

export function afficherEtiquettes(conteneur, id, params) {
  let onglet = ONGLETS.some(([c]) => c === params?.get('format')) ? params.get('format') : 'a4';
  conteneur.innerHTML = `<div class="page page-etiquettes"><div class="squelette" style="height:420px"></div></div>`;
  let d = null;

  function render() {
    conteneur.innerHTML = `
      <div class="page page-etiquettes">
        <header class="et-barre no-print">
          <a class="btn-icone" href="#/colis/${encodeURIComponent(d.id)}" aria-label="Fiche du colis">${icone('retour', 20, 2)}</a>
          <div class="et-barre-titres"><h1>Étiquettes · ${esc(d.numero)}</h1><span class="discret">Le bordereau se donne au client ; l’étiquette se colle sur le carton.</span></div>
          <nav class="onglets-pastilles" aria-label="Format">${ONGLETS.map(([c, l]) => `<button type="button" class="onglet-pastille ${c === onglet ? 'actif' : ''}" data-format="${c}" aria-pressed="${c === onglet}">${l}</button>`).join('')}</nav>
          <button type="button" class="btn btn-primaire" data-action="imprimer">${icone('imprimante', 18, 2)} Imprimer</button>
        </header>
        <div class="et-apercu">
          <div class="col-feuille-a4 et-feuille" data-feuille="a4" ${onglet === 'a4' ? '' : 'hidden'}>${bordereauA4(d)}</div>
          <div class="col-feuille-a4 et-feuille et-planche" data-feuille="planche" ${onglet === 'planche' ? '' : 'hidden'}>${Array.from({ length: 4 }, () => etiquetteA6(d)).join('')}</div>
          <div class="col-feuille-a6 et-feuille" data-feuille="a6" ${onglet === 'a6' ? '' : 'hidden'}>${etiquetteA6(d)}</div>
        </div>
      </div>`;
  }

  conteneur.addEventListener('click', (e) => {
    const f = e.target.closest('[data-format]');
    if (f) {
      onglet = f.dataset.format;
      conteneur.querySelectorAll('[data-format]').forEach((b) => { b.classList.toggle('actif', b === f); b.setAttribute('aria-pressed', String(b === f)); });
      conteneur.querySelectorAll('[data-feuille]').forEach((z) => { z.hidden = z.dataset.feuille !== onglet; });
      history.replaceState(null, '', `#/colis/${encodeURIComponent(d.id)}/etiquette?format=${onglet}`);
    }
    if (e.target.closest('[data-action="imprimer"]')) imprimerColis(conteneur.querySelector(`[data-feuille="${onglet}"]`));
  });

  (async () => {
    try {
      const [r, agences] = await Promise.all([api.fiche(id), chargerAgences(), chargerJsBarcode()]);
      if (!conteneur.isConnected) return;
      d = donneesEtiquette(r, agences);
      render();
    } catch (err) {
      conteneur.innerHTML = `<div class="page"><p class="bloc-erreur">${esc(messageErreur(err))}</p><a class="btn btn-secondaire" href="#/colis">Retour aux colis</a></div>`;
    }
  })();
}

/**
 * Impression d'une feuille (étiquette, planche, bordereau, manifeste, reçu) : copiée dans #zone-colis, directement
 * sous <body> comme #recu et #zone-etiquettes (le reste de la page est masqué à l'impression, voir app.css).
 */
export function imprimerColis(feuille) {
  if (!feuille) return;
  document.getElementById('zone-colis')?.remove();
  const zone = document.createElement('div');
  zone.id = 'zone-colis';
  const copie = feuille.cloneNode(true);
  copie.hidden = false;
  zone.append(copie);
  document.body.append(zone);
  document.body.classList.add('impression-colis');
  const retirer = () => { document.body.classList.remove('impression-colis'); zone.remove(); window.removeEventListener('afterprint', retirer); };
  window.addEventListener('afterprint', retirer);
  window.print();
  setTimeout(() => { if (zone.isConnected && !matchMedia('print').matches) retirer(); }, 60000);
}


