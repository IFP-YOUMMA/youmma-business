/**
 * marche/bureau.js — #/marche, le bureau de Conakry (étape 21, maquette MarcheBureau). Un seul module, deux entrées :
 * la route #/marche de la boutique logistique et l'onglet « Marché » de la porte verte de la direction.
 *
 *  - quatre compteurs (tableau_marche) ; onglets = filtres de commandes_marche_liste ; recherche ;
 *  - une commande ouverte (commande_marche par son jeton) : ses lignes, « Payer le fournisseur » par ligne
 *    (payer_ligne_marche), « Expédier » quand tout est réglé, encaisser le versement, litige, reçu A5 ;
 *  - « Expédier » recompose l'écran de pesée existant (champs, poids taxable, deux photos) et appelle
 *    expedier_commande_marche : la photo du contenu part dans le seau privé « bons », comme pour tout colis.
 * Les montants sont ceux de la base, chacun dans sa monnaie ; la commission n'est affichée que si la base la renvoie.
 */
import { esc, icone, toast, ouvrirModale, boutonOccupe, formatNombre, formatDate, differer, lireNombre } from '../utils.js';
import { etat } from '../state.js';
import { chargerModes, libelleMode } from '../modes-paiement.js';
import { chargerAgences, agenceSelon, MODES, api as apiColis } from '../colis/commun.js';
import { monterPhotos } from '../colis/photos.js';
import { champsMesure, lireMesure, majPhraseCartons, calculHTML, pourquoiHTML, chargerCorridors } from '../colis/reception.js';
import { api, FILTRES, pastilleStatut, montant, nomDevise, paysDuDrapeau, paysDeLaCaisse, erreurMarche } from './commun.js';
import { afficherReglements } from './reglements.js';
import { imprimerRecuMarche } from './recu.js';

/** Le bureau du marché emprunte les blocs du colis (mesures, photos, calcul) : sa feuille, chargée avec lui (étape 29). */
export const STYLES = ['css/colis.css'];


const quand = (iso) => (iso ? `${formatDate(iso, 'court')} · ${formatDate(iso, 'heure')}` : '');

/**
 * adresse(vue, extra) : lien interne de l'écran (« #/marche?vue=reglements » dans la boutique,
 * « #/marche-monde?onglet=marche&vue=reglements » depuis la porte verte).
 */
export function afficherMarche(conteneur, params = new URLSearchParams(), { adresse = (q) => `#/marche${q ? `?${q}` : ''}` } = {}) {
  const vue = params.get('vue') === 'reglements' ? 'reglements' : 'commandes';
  conteneur.innerHTML = `
    <div class="page mc-page">
      <header class="mc-entete">
        <div class="mc-titres"><h1>Marché — commandes d’achat</h1><span>${esc(etat.boutique?.nom || '')} · le client verse ici, le fournisseur est payé à Dakar</span></div>
        <nav class="onglets-pastilles" aria-label="Marché">
          <a class="onglet-pastille ${vue === 'commandes' ? 'actif' : ''}" href="${adresse('')}" ${vue === 'commandes' ? 'aria-current="page"' : ''}>Commandes</a>
          <a class="onglet-pastille ${vue === 'reglements' ? 'actif' : ''}" href="${adresse('vue=reglements')}" ${vue === 'reglements' ? 'aria-current="page"' : ''}>Règlements</a>
        </nav>
      </header>
      <div data-zone="vue"></div>
    </div>`;
  const zone = conteneur.querySelector('[data-zone="vue"]');
  if (vue === 'reglements') return afficherReglements(zone);
  return monterCommandes(zone);
}

/* =========================================================================
   Commandes
   ========================================================================= */

function monterCommandes(zone) {
  const s = { filtre: null, recherche: '', lignes: [], choisie: null, resume: null };
  zone.innerHTML = `
    <section class="mc-kpis" data-zone="kpis"><span class="squelette" style="height:96px"></span></section>
    <div class="mc-corps">
      <section class="carte mc-liste">
        <div class="mc-outils">
          <nav class="mc-filtres" aria-label="Filtres">${FILTRES.map(([f, l]) => `<button type="button" class="mc-filtre ${f === s.filtre ? 'actif' : ''}" data-filtre="${f ?? ''}" aria-pressed="${f === s.filtre}">${esc(l)}</button>`).join('')}</nav>
          <label class="mc-recherche">${icone('recherche', 16, 2)}<span class="sr-only">Rechercher</span><input type="search" data-ref="recherche" placeholder="Code, client, fournisseur…" autocomplete="off"></label>
        </div>
        <div data-zone="tableau"><span class="squelette" style="height:220px;margin:14px"></span></div>
      </section>
      <aside class="carte mc-fiche" data-zone="fiche" hidden></aside>
    </div>`;
  const z = (n) => zone.querySelector(`[data-zone="${n}"]`);

  async function chargerTableau() {
    try {
      const t = await api.tableau();
      s.resume = t?.resume || {};
      if (!zone.isConnected) return;
      const r = s.resume;
      z('kpis').innerHTML = [
        ['mc-kpi-caisse', 'Argent des clients en caisse', montant(r.en_caisse, r.devise_caisse), 'ne vous appartient pas : à reverser ou à rembourser'],
        ['', 'À payer aux fournisseurs', montant(r.a_payer, r.devise_achat), 'au bureau de Dakar'],
        ['', 'Commission, 30 jours', montant(r.commission_30j, r.devise_achat), 'retenue sur ce qui est reversé'],
        [Number(r.litiges) ? 'mc-kpi-alerte' : '', 'Litiges', formatNombre(Number(r.litiges) || 0), Number(r.litiges) ? 'à traiter' : 'aucun']
      ].map(([classe, l, v, note]) => `<div class="carte mc-kpi ${classe}"><span class="etiquette-carte">${esc(l)}</span><strong class="mc-num">${esc(v)}</strong><small>${esc(note)}</small></div>`).join('');
    } catch (err) {
      z('kpis').innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(erreurMarche(err))}</p>`;
    }
  }

  async function chargerListe() {
    try {
      s.lignes = await api.liste({ filtre: s.filtre, recherche: s.recherche });
      if (!zone.isConnected) return;
      rendreListe();
    } catch (err) {
      z('tableau').innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(erreurMarche(err))}</p>`;
    }
  }

  function rendreListe() {
    if (!s.lignes.length) {
      z('tableau').innerHTML = `<p class="col-vide">${s.filtre || s.recherche ? 'Aucune commande ne correspond.' : 'Aucune commande pour l’instant. Elles arrivent de la page publique du marché.'}</p>`;
      return;
    }
    z('tableau').innerHTML = `
      <div class="mc-tableau-cadre"><table class="mc-tableau">
        <thead><tr><th>Code</th><th>Client</th><th>Fournisseur</th><th class="droite">Marchandise</th><th class="droite">Poids</th><th>État</th><th>Dernier mouvement</th></tr></thead>
        <tbody>${s.lignes.map((l) => `
          <tr data-id="${esc(l.id)}" tabindex="0" class="${s.choisie?.id === l.id ? 'choisie' : ''}">
            <td><strong class="mc-code">${esc(l.code)}</strong></td>
            <td>${esc(l.client_nom || '—')}</td>
            <td class="mc-fournisseurs">${esc(l.fournisseurs || '')}</td>
            <td class="droite mc-num">${esc(montant(l.montant_client, l.devise_client))}</td>
            <td class="droite mc-num">${l.poids_estime ? `${esc(formatNombre(l.poids_estime, 2))} kg` : '—'}</td>
            <td>${pastilleStatut(l.statut)}</td>
            <td class="mc-mouvement">${l.colis ? `Colis ${esc(l.colis)}` : l.verse_le ? `Versée le ${esc(quand(l.verse_le))}` : `Créée le ${esc(quand(l.created_at))}`}</td>
          </tr>`).join('')}</tbody>
      </table></div>`;
  }

  /* ---------------- Fiche d'une commande */

  /** connue : la ligne déjà ouverte, quand la commande a quitté l'onglet courant (versée, payée…). */
  async function ouvrir(id, connue = null) {
    const l = s.lignes.find((x) => x.id === id) || connue;
    if (!l) return;
    s.choisie = l;
    rendreListe();
    const f = z('fiche');
    f.hidden = false;
    f.innerHTML = '<span class="squelette" style="height:260px"></span>';
    if (window.matchMedia('(max-width: 1099.98px)').matches) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Le détail (lignes, jeton) se lit avec commande_marche(jeton). Sans jeton dans la liste, on ne devine rien.
    if (!l.jeton) {
      f.innerHTML = `<div class="mc-fiche-tete"><strong class="mc-code">${esc(l.code)}</strong>${pastilleStatut(l.statut)}</div>
        <p class="dir-arret mc-arret"><strong>Détail indisponible</strong><span>La liste des commandes ne renvoie pas le jeton de cette commande : l’écran ne peut pas lire ses lignes sans lui.</span></p>`;
      return;
    }
    try {
      const c = await api.commande(l.jeton);
      if (!f.isConnected || s.choisie?.id !== id) return;
      if (!c || c.introuvable) { f.innerHTML = '<p class="bloc-erreur">Commande introuvable.</p>'; return; }
      rendreFiche(l, c);
    } catch (err) {
      f.innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(erreurMarche(err))}</p>`;
    }
  }

  function rendreFiche(l, c) {
    const f = z('fiche');
    const versee = Boolean(c.verse_le);
    const lignes = c.lignes || [];
    const toutPaye = lignes.length > 0 && lignes.every((x) => x.paye_le);
    const cle = (k) => Object.prototype.hasOwnProperty.call(c, k) && c[k] !== null && c[k] !== undefined;
    f.innerHTML = `
      <div class="mc-fiche-tete">
        <div><strong class="mc-code">${esc(c.code)}</strong> <span class="mc-client">— ${esc(c.client?.nom || l.client_nom || '')}</span></div>
        ${pastilleStatut(c.statut)}
        <button type="button" class="btn-icone" data-action="fermer-fiche" aria-label="Fermer la fiche">${icone('fermer', 18, 2)}</button>
      </div>
      <p class="mc-sous">${versee ? `Versée le ${esc(quand(c.verse_le))}${c.verse_mode ? ` · ${esc(libelleMode(c.verse_mode))}` : ''}` : `Commandée le ${esc(quand(c.created_at))} · pas encore versée`}</p>
      ${c.motif ? `<p class="mc-motif">${icone('alerte', 15, 2)} ${esc(c.motif)}</p>` : ''}
      <div class="mc-actions">
        ${!versee ? `<button type="button" class="btn btn-primaire" data-action="encaisser" data-gerant>${icone('caisse', 16, 2)} Encaisser ${esc(montant(c.montant_client, c.devise_client))}</button>` : ''}
        ${versee && toutPaye && !c.colis ? `<button type="button" class="btn btn-primaire" data-action="expedier">${icone('camion', 16, 2)} Expédier</button>` : ''}
        ${versee ? `<button type="button" class="btn btn-secondaire" data-action="recu">${icone('imprimante', 16, 2)} Reçu</button>` : ''}
        ${c.statut !== 'litige' ? '<button type="button" class="btn btn-secondaire" data-action="litige">Signaler un litige</button>' : ''}
      </div>
      <ul class="mc-lignes">${lignes.map((x) => `
        <li>
          <div class="mc-ligne-textes">
            <strong>${esc(x.nom)} · ${esc(formatNombre(x.quantite, 2))}</strong>
            <span>${esc(x.drapeau || '')} ${esc(x.fournisseur || '')}</span>
          </div>
          <div class="mc-ligne-montant"><strong class="mc-num">${esc(montant(x.montant, c.devise_achat))}</strong>${x.commission !== null && x.commission !== undefined ? `<small>commission ${esc(formatNombre(x.commission, 2))} %</small>` : ''}</div>
          <div class="mc-ligne-etat">${x.paye_le ? `<span class="mc-statut vert">Payé le ${esc(formatDate(x.paye_le, 'court'))}</span>`
            : versee ? `<button type="button" class="btn btn-secondaire btn-petit" data-payer="${esc(x.id)}">Payer le fournisseur</button>` : '<span class="mc-statut gris">Après le versement</span>'}</div>
        </li>`).join('')}</ul>
      <div class="mc-compte">
        <h3>Le compte de cette commande</h3>
        <div><span>Versé par le client</span><strong class="mc-num">${esc(montant(c.montant_client, c.devise_client))}</strong></div>
        ${c.taux ? `<div class="mc-discret"><span>Taux appliqué</span><span class="mc-num">1 ${esc(nomDevise(c.devise_achat))} = ${esc(formatNombre(c.taux, 2))} ${esc(nomDevise(c.devise_client))}</span></div>` : ''}
        <div><span>Prix des fournisseurs</span><strong class="mc-num">${esc(montant(c.montant_achat, c.devise_achat))}</strong></div>
        ${cle('commission') ? `<div><span>Commission retenue</span><strong class="mc-num">− ${esc(montant(c.commission, c.devise_achat))}</strong></div>` : ''}
        ${cle('a_reverser') ? `<div class="fort"><span>À verser aux fournisseurs</span><strong class="mc-num">${esc(montant(c.a_reverser, c.devise_achat))}</strong></div>` : ''}
        <div class="mc-transport"><span>Transport, payé au retrait</span><strong class="mc-num">${c.colis?.du_montant !== undefined && c.colis?.du_montant !== null ? esc(montant(c.colis.du_montant, c.colis.du_devise)) : `${esc(montant(c.transport_estime, c.devise_achat))} <small>estimé</small>`}</strong></div>
        <p class="mc-note">Le transport n’est pas compris dans le versement : il est estimé à la commande et le montant exact sort de la pesée.</p>
      </div>
      ${c.colis ? `<p class="mc-colis">${icone('colis', 16, 2)} Colis <strong>${esc(c.colis.numero)}</strong>${c.colis.lien ? ` · <a href="${esc(c.colis.lien)}" target="_blank" rel="noopener">suivi public</a>` : ''}</p>` : ''}`;

    f.onclick = async (ev) => {
      const a = ev.target.closest('[data-action]')?.dataset.action;
      const payer = ev.target.closest('[data-payer]')?.dataset.payer;
      if (a === 'fermer-fiche') { s.choisie = null; f.hidden = true; rendreListe(); return; }
      if (a === 'encaisser') ouvrirEncaissement(l, c);
      if (a === 'recu') imprimerRecuMarche(c, { jeton: l.jeton, recuPar: etat.membre?.nom });
      if (a === 'litige') ouvrirLitige(l, c);
      if (a === 'expedier') ouvrirExpedition(l, c);
      if (payer) ouvrirPaiementLigne(l, c, lignes.find((x) => x.id === payer));
    };
  }

  /** Après une action : compteurs, liste et fiche relus. */
  async function relire(id = s.choisie?.id) {
    const avant = s.choisie;
    await Promise.all([chargerTableau(), chargerListe()]);
    // La fiche reste ouverte et relue, même si la commande a changé d'onglet (À verser → Fournisseur à payer…).
    if (id) ouvrir(id, avant?.id === id ? avant : null);
  }

  /* ---------------- Encaisser le versement (le client verse tout au comptoir) */

  async function ouvrirEncaissement(l, c) {
    const modes = await chargerModes('vente', paysDeLaCaisse(c.devise_client));
    if (!modes.length) { toast('Impossible de lire les modes de paiement. Vérifiez la connexion.', 'erreur'); return; }
    const { el, fermer } = ouvrirModale({
      titre: `Encaisser ${c.code}`,
      contenu: `<form class="form-modale" novalidate>
        <p class="texte-modale">${esc(c.client?.nom || '')} verse la marchandise : <strong>${esc(montant(c.montant_client, c.devise_client))}</strong>. Le transport n’est pas compris : il se paie au retrait, après la pesée.</p>
        <div class="rangee-champs">
          <div class="champ"><label for="mc-montant">Montant reçu (${esc(nomDevise(c.devise_client))})</label><input id="mc-montant" class="input input-montant" inputmode="numeric" value="${esc(formatNombre(c.montant_client))}"></div>
          <div class="champ"><label for="mc-mode">Mode</label><select id="mc-mode" class="input">${modes.map((m) => `<option value="${esc(m.code)}">${esc(m.nom)}</option>`).join('')}</select></div>
        </div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer le versement</button></div>
      </form>`
    });
    el.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const bouton = el.querySelector('[type=submit]');
      const zoneErr = el.querySelector('.erreur-form');
      const montantRecu = lireNombre(el.querySelector('#mc-montant').value);
      if (!montantRecu) { zoneErr.textContent = 'Saisissez le montant reçu.'; zoneErr.hidden = false; return; }
      boutonOccupe(bouton, true, 'Enregistrement…');
      try {
        await api.encaisser(c.id || l.id, el.querySelector('#mc-mode').value, montantRecu);
        fermer();
        toast(`Versement de ${c.code} enregistré.`, 'succes');
        await relire(l.id);
        const relue = await api.commande(l.jeton).catch(() => null);
        if (relue && !relue.introuvable && relue.verse_le) imprimerRecuMarche(relue, { jeton: l.jeton, recuPar: etat.membre?.nom });
      } catch (err) { boutonOccupe(bouton, false); zoneErr.textContent = erreurMarche(err); zoneErr.hidden = false; }
    });
  }

  /* ---------------- Payer une ligne au fournisseur */

  async function ouvrirPaiementLigne(l, c, x) {
    if (!x) return;
    const modes = await chargerModes('fournisseur', paysDuDrapeau(x.drapeau));
    if (!modes.length) { toast('Impossible de lire les modes de paiement. Vérifiez la connexion.', 'erreur'); return; }
    const aVerser = x.a_reverser !== null && x.a_reverser !== undefined ? x.a_reverser : null;
    const { el, fermer } = ouvrirModale({
      titre: 'Payer le fournisseur',
      contenu: `<form class="form-modale" novalidate>
        <p class="texte-modale"><strong>${esc(x.fournisseur)}</strong> · ${esc(x.nom)} × ${esc(formatNombre(x.quantite, 2))}<br>
          ${aVerser !== null ? `À lui verser : <strong>${esc(montant(aVerser, c.devise_achat))}</strong> (commission déjà retenue).` : `Prix : <strong>${esc(montant(x.montant, c.devise_achat))}</strong>.`}</p>
        <div class="champ"><label for="mc-mode-l">Mode</label><select id="mc-mode-l" class="input">${modes.map((m) => `<option value="${esc(m.code)}">${esc(m.nom)}</option>`).join('')}</select></div>
        <label class="case-option"><input type="checkbox" id="mc-recue" checked> La marchandise est remise au bureau de ${esc(x.ville || 'Dakar')}</label>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Confirmer le paiement</button></div>
      </form>`
    });
    el.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const bouton = el.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Paiement…');
      try {
        await api.payerLigne(x.id, el.querySelector('#mc-mode-l').value, el.querySelector('#mc-recue').checked);
        fermer();
        toast(`${x.fournisseur} payé pour ${x.nom}.`, 'succes');
        relire(l.id);
      } catch (err) { boutonOccupe(bouton, false); const zz = el.querySelector('.erreur-form'); zz.textContent = erreurMarche(err); zz.hidden = false; }
    });
  }

  /* ---------------- Litige */

  function ouvrirLitige(l, c) {
    const { el, fermer } = ouvrirModale({
      titre: `Litige sur ${c.code}`,
      contenu: `<form class="form-modale" novalidate>
        <div class="champ"><label for="mc-motif">Ce qui ne correspond pas</label><input id="mc-motif" class="input" maxlength="200" placeholder="Ex. Mauvais modèle livré" required></div>
        <label class="case-option"><input type="checkbox" id="mc-annuler"> Annuler la commande (le client est remboursé)</label>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-danger">Enregistrer le litige</button></div>
      </form>`
    });
    el.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const motif = el.querySelector('#mc-motif').value.trim();
      const zz = el.querySelector('.erreur-form');
      if (!motif) { zz.textContent = 'Écrivez ce qui ne correspond pas.'; zz.hidden = false; return; }
      const bouton = el.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      try { await api.litige(c.id || l.id, motif, el.querySelector('#mc-annuler').checked); fermer(); toast('Litige enregistré.', 'succes'); relire(l.id); } catch (err) { boutonOccupe(bouton, false); zz.textContent = erreurMarche(err); zz.hidden = false; }
    });
  }

  /* ---------------- Expédier : l'écran de pesée existant, recomposé */

  async function ouvrirExpedition(l, c) {
    let agences = [];
    let corridors = [];
    try { [agences, corridors] = await Promise.all([chargerAgences(), chargerCorridors()]); } catch (err) { toast(erreurMarche(err), 'erreur'); return; }
    const arrivee = agenceSelon(agences, c.retrait);
    const villeDepart = (c.lignes || [])[0]?.ville;
    const departs = agences.filter((a) => corridors.some((x) => x.agence_depart === a.id && x.agence_arrivee === arrivee?.id));
    if (!arrivee?.id || !departs.length) { toast(`Aucun corridor ouvert vers ${c.retrait?.nom || 'le bureau de retrait'} : ouvrez-le dans Agences.`, 'erreur', 7000); return; }
    const st = { depart: departs.find((a) => a.ville === villeDepart) || departs[0], mode: null, tarif: null, jeton: 0, enCours: false };
    const { el, fermer } = ouvrirModale({
      titre: `Expédier ${c.code}`,
      variante: 'large',
      contenu: `<form class="form-modale mc-expedition" novalidate>
        <p class="texte-modale">${esc(c.client?.nom || '')} · retrait à <strong>${esc(c.retrait?.nom || '')}</strong>. Pesez le carton : le client paiera ce transport au retrait.</p>
        <div class="rangee-champs">
          <div class="champ"><label for="mc-depart">Bureau de départ</label><select id="mc-depart" class="input">${departs.map((a) => `<option value="${esc(a.id)}" ${a.id === st.depart.id ? 'selected' : ''}>${esc(a.drapeau || '')} ${esc(a.ville || a.nom)}</option>`).join('')}</select></div>
          <div class="champ"><label for="rc-mode">Mode</label><select id="rc-mode" class="input" data-ref="modes"></select></div>
        </div>
        <section class="col-bloc"><div class="col-photos" data-zone="photos"></div></section>
        ${champsMesure({ nb: 1 })}
        <section class="carte col-calcul" data-ref="calcul" aria-live="polite">${calculHTML(null, null, { titre: 'Transport à payer au retrait' })}</section>
        <p class="col-pourquoi" data-ref="pourquoi" hidden></p>
        <p class="erreur-form" role="alert" hidden></p>
        <p class="discret" data-ref="manque"></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire" disabled>${icone('camion', 16, 2)} Créer le colis et expédier</button></div>
      </form>`,
      onFermer: () => photos?.arreter()
    });
    const ref = (n) => el.querySelector(`[data-ref="${n}"]`);
    const photos = monterPhotos(el.querySelector('[data-zone="photos"]'), { demandees: ['bascule', 'contenu'], surChangement: () => majBouton() });
    majPhraseCartons(el);

    function rendreModes() {
      const modes = corridors.filter((x) => x.agence_depart === st.depart.id && x.agence_arrivee === arrivee.id);
      if (!modes.some((x) => x.mode === st.mode)) st.mode = (modes.find((x) => x.mode === 'route') || modes[0])?.mode || null;
      ref('modes').innerHTML = modes.map((x) => `<option value="${esc(x.mode)}" ${x.mode === st.mode ? 'selected' : ''}>${esc(MODES[x.mode]?.libelle || x.mode)} · ${esc(x.delai_jours ?? '?')} jour${Number(x.delai_jours) > 1 ? 's' : ''}</option>`).join('');
    }
    function majBouton() {
      const m = lireMesure(el);
      const manque = [];
      if (!m.poids) manque.push('le poids');
      if (m.dimsPartielles) manque.push('les trois dimensions (ou aucune)');
      if (!st.tarif) manque.push('le calcul du transport');
      if (!photos.pret()) manque.push('les deux photos');
      if (!st.enCours) el.querySelector('[type=submit]').disabled = manque.length > 0;
      ref('manque').textContent = manque.length ? `Il manque ${manque.join(', ').replace(/, ([^,]*)$/, ' et $1')}.` : '';
    }
    const recalculer = differer(async () => {
      const m = lireMesure(el);
      const jeton = ++st.jeton;
      if (!m.poids || m.poids <= 0 || !st.mode || m.dimsPartielles) { st.tarif = null; ref('calcul').innerHTML = calculHTML(null, null, { titre: 'Transport à payer au retrait' }); ref('pourquoi').hidden = true; majBouton(); return; }
      try {
        const t = await apiColis.tarif({ depart: st.depart.id, arrivee: arrivee.id, mode: st.mode, poids: m.poids, longueur: m.longueur, largeur: m.largeur, hauteur: m.hauteur, nb: m.nb });
        if (jeton !== st.jeton) return;
        st.tarif = t;
        ref('calcul').innerHTML = calculHTML(t, m, { titre: 'Transport à payer au retrait' });
        ref('pourquoi').innerHTML = pourquoiHTML(t);
        ref('pourquoi').hidden = false;
      } catch (err) { if (jeton === st.jeton) { st.tarif = null; ref('calcul').innerHTML = `<p class="bloc-erreur">${esc(erreurMarche(err))}</p>`; } }
      majBouton();
    }, 300);

    rendreModes();
    el.addEventListener('input', (e) => { if (e.target.closest('.col-mesures, #rc-nb')) { majPhraseCartons(el); recalculer(); } });
    el.addEventListener('change', (e) => {
      if (e.target.id === 'mc-depart') { st.depart = departs.find((a) => a.id === e.target.value); rendreModes(); recalculer(); }
      if (e.target.id === 'rc-mode') { st.mode = e.target.value; recalculer(); }
    });
    el.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const bouton = el.querySelector('[type=submit]');
      const zz = el.querySelector('.erreur-form');
      const m = lireMesure(el);
      st.enCours = true;
      boutonOccupe(bouton, true, 'Expédition…');
      let fichiers = null;
      try {
        fichiers = await photos.envoyer(['bascule', 'contenu']);
        const r = await api.expedier({ commande: c.id || l.id, depart: st.depart.id, mode: st.mode, poids: m.poids, longueur: m.longueur, largeur: m.largeur, hauteur: m.hauteur, nb: m.nb, photoBascule: fichiers.bascule, photoContenu: fichiers.contenu });
        photos.arreter();
        fermer();
        const numero = r?.numero || r?.colis?.numero || r?.colis || '';
        toast(`Colis ${numero} créé : la commande part dans la logistique.`, 'succes', 7000);
        relire(l.id);
      } catch (err) {
        if (fichiers?.envoyes?.length) await photos.nettoyer(fichiers.envoyes);
        st.enCours = false;
        boutonOccupe(bouton, false);
        zz.textContent = erreurMarche(err); zz.hidden = false;
      }
    });
  }

  /* ---------------- Écouteurs */

  zone.addEventListener('click', (ev) => {
    const filtre = ev.target.closest('[data-filtre]');
    if (filtre) {
      s.filtre = filtre.dataset.filtre || null;
      zone.querySelectorAll('[data-filtre]').forEach((b) => { const on = b === filtre; b.classList.toggle('actif', on); b.setAttribute('aria-pressed', String(on)); });
      chargerListe();
      return;
    }
    const tr = ev.target.closest('tr[data-id]');
    if (tr) ouvrir(tr.dataset.id);
  });
  zone.addEventListener('keydown', (ev) => { const tr = ev.target.closest?.('tr[data-id]'); if (tr && ev.key === 'Enter') ouvrir(tr.dataset.id); });
  zone.querySelector('[data-ref="recherche"]').addEventListener('input', differer((ev) => { s.recherche = ev.target.value.trim(); chargerListe(); }, 300));

  chargerTableau();
  chargerListe();
}

