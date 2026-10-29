/**
 * colis/reception.js — Recevoir de la marchandise au nom d'un compte commerçant (étape 18, maquette EntrepotReception),
 * #/recevoir, et peser un carton déjà déposé, au téléphone à côté de la balance (maquette PoidsTaxable), #/peser/<id>.
 *
 * 1. Au nom de qui ? chercher_compte à la frappe (numéro GN-1042, nom ou téléphone), Scanner le numéro montré par le
 *    client, ou Créer un compte (creer_compte_client rend le compte existant si le téléphone est déjà connu).
 * 2. Le carton : contenu, contenu pour la douane, déposé par, poids TOTAL des cartons et dimensions d'UN carton
 *    (la base multiplie le volume par le nombre : saisir le volume total facturerait N fois trop), corridor et mode.
 * 3. Le poids taxable, recalculé à chaque frappe par tarif_colis (clé calcul), fait pour être tourné vers le client.
 * Deux sorties : « Déposer sans peser » (deposer_marchandise : le fournisseur dépose et repart, photo du dépôt seule,
 * colis « a_peser ») et « Enregistrer et prévenir » (recevoir_marchandise : pesée et deux photos tout de suite).
 * Rien n'est encaissé : le transport se paie au retrait. Aucun poids ni prix n'est calculé dans le navigateur.
 */
import { sb } from '../supabase.js';
import { etat } from '../state.js';
import { naviguer } from '../router.js';
import { esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, differer, lireNombre, formatNombre, formatDate, initiales } from '../utils.js';
import { api, chargerAgences, agenceSelon, formatTel, montant, nomDevise, MODES, BASES } from './commun.js';
import { monterPhotos } from './photos.js';
import { ouvrirCreationCompte } from './comptes.js';

const kg = (n) => `${formatNombre(n, 2).replace(/,00$/, '')} kg`;
const prenom = (nom) => String(nom || '').trim().split(/\s+/)[0] || 'le client';

/** Corridors ouverts de la boutique (une ligne de tarifs_colis = un départ + une arrivée + un mode). */
async function chargerCorridors() {
  const { data, error } = await sb.from('tarifs_colis').select('id, nom, agence_depart, agence_arrivee, mode, delai_jours, devise, actif, ordre')
    .eq('boutique_id', etat.boutique.id).eq('actif', true).order('ordre');
  if (error) throw error;
  return data;
}

/* =========================================================================
   Le calcul tourné vers le client (commun à la réception et à la pesée)
   ========================================================================= */

/** Champs poids · L · l · h + nombre de cartons, avec l'avertissement sur les cartons multiples. */
function champsMesure({ poids = '', longueur = '', largeur = '', hauteur = '', nb = 1 } = {}) {
  const champ = (id, libelle, unite, valeur, mode = 'decimal') => `<div class="champ col-mesure"><label for="${id}">${libelle}</label>
    <span class="col-unite"><input id="${id}" class="input col-gros" type="text" inputmode="${mode}" value="${esc(String(valeur ?? ''))}" placeholder="0"><span>${unite}</span></span></div>`;
  return `
    <div class="champ col-nb-cartons"><label for="rc-nb">Nombre de cartons identiques</label><input id="rc-nb" class="input col-gros" type="number" inputmode="numeric" min="1" step="1" value="${esc(String(nb))}"></div>
    <p class="col-attention-cartons" data-ref="avertissement-cartons" role="note">${icone('alerte', 16, 2)} <span><strong data-ref="phrase-cartons">Poids total des cartons · dimensions d’UN carton</strong> : la base multiplie le volume par le nombre de cartons. Ne saisissez jamais le volume total.</span></p>
    <div class="col-mesures">
      ${champ('rc-poids', 'Poids', 'kg', poids)}${champ('rc-long', 'Longueur', 'cm', longueur, 'numeric')}${champ('rc-larg', 'Largeur', 'cm', largeur, 'numeric')}${champ('rc-haut', 'Hauteur', 'cm', hauteur, 'numeric')}
    </div>`;
}

function lireMesure(racine) {
  const v = (id) => lireNombre(racine.querySelector(`#${id}`)?.value || '');
  const nb = Math.max(1, Math.round(Number(racine.querySelector('#rc-nb')?.value) || 1));
  const dims = [v('rc-long'), v('rc-larg'), v('rc-haut')];
  const completes = dims.every((d) => d && d > 0);
  return { poids: v('rc-poids'), nb, longueur: completes ? dims[0] : null, largeur: completes ? dims[1] : null, hauteur: completes ? dims[2] : null, dimsPartielles: !completes && dims.some((d) => d) };
}

/** La phrase sous les champs suit le nombre : « Poids total des 2 cartons · dimensions d'UN carton ». */
function majPhraseCartons(racine) {
  const nb = Math.max(1, Math.round(Number(racine.querySelector('#rc-nb')?.value) || 1));
  const z = racine.querySelector('[data-ref="phrase-cartons"]');
  if (z) z.textContent = nb > 1 ? `Poids total des ${nb} cartons · dimensions d’UN carton` : 'Poids du carton · ses dimensions';
  racine.querySelector('[data-ref="avertissement-cartons"]')?.classList.toggle('fort', nb > 1);
}

/** Le bloc « Poids taxable » : le chiffre en très gros, le prix, puis le détail en quatre lignes. */
function calculHTML(t, m, { titre = 'Poids taxable' } = {}) {
  if (!t) return `<span class="etiquette-carte">${esc(titre)}</span><p class="discret">Saisissez le poids (et les dimensions) pour voir ce qui sera facturé.</p>`;
  const c = t.calcul;
  const ligne = (g, d, fort = false) => `<div class="col-calcul-ligne ${fort ? 'fort' : ''}"><span>${g}</span><strong>${d}</strong></div>`;
  const dims = m.longueur ? `${formatNombre(m.longueur)} × ${formatNombre(m.largeur)} × ${formatNombre(m.hauteur)}${m.nb > 1 ? ` × ${m.nb} cartons` : ''}` : null;
  return `
    <span class="etiquette-carte">${esc(titre)}</span>
    <div class="col-calcul-tete"><span class="col-calcul-kg"><strong>${esc(formatNombre(c.poids_taxable, 2).replace(/,00$/, ''))}</strong> kg</span>
      <span class="col-calcul-prix"><strong>${formatNombre(t.total)}</strong> ${esc(nomDevise(t.devise))}</span></div>
    <div class="col-calcul-detail">
      ${ligne(m.nb > 1 ? `Sur la balance (${m.nb} cartons)` : 'Sur la balance', esc(kg(c.poids_reel)))}
      ${dims ? ligne(`Volume ${esc(dims)}`, `${formatNombre(c.volume_cm3)} cm³`) : ligne('Volume', '<span class="discret">dimensions non saisies</span>')}
      ${c.poids_volumetrique != null ? ligne(`${formatNombre(c.volume_cm3)} ÷ ${formatNombre(c.diviseur)}`, esc(kg(c.poids_volumetrique))) : ''}
      ${c.base === 'minimum' ? ligne(`Minimum du corridor`, esc(kg(c.minimum_kg))) : ''}
      ${ligne('On facture le plus élevé', esc(kg(c.poids_taxable)), true)}
    </div>
    <p class="col-calcul-base">Facturé sur ${esc(BASES[c.base] || c.base)} <span class="discret">· base : ${esc(c.base)}</span></p>
    ${Number(t.supplements) ? `<p class="discret">dont ${formatNombre(t.supplements)} ${esc(nomDevise(t.devise))} de suppléments · ${formatNombre(t.marchandise)} de transport</p>` : ''}`;
}

/** « Pourquoi 14 kg et pas 4,2 ? » : écrit pour l'employé, fait pour être montré au client. */
function pourquoiHTML(t) {
  if (!t) return '';
  const c = t.calcul;
  const taxable = formatNombre(c.poids_taxable, 2).replace(/,00$/, '');
  const reel = formatNombre(c.poids_reel, 2).replace(/,00$/, '');
  if (c.base === 'volume') {
    return `<strong>Pourquoi ${esc(taxable)} kg et pas ${esc(reel)} ?</strong> Ce carton est léger mais il prend la place de ${esc(taxable)} kg dans le véhicule : tous les transporteurs facturent ainsi. Expliquez-le au client <strong>avant</strong> de lui annoncer le prix : cet écran est fait pour que vous puissiez le lui montrer.`;
  }
  if (c.base === 'minimum') {
    return `<strong>Pourquoi ${esc(taxable)} kg et pas ${esc(reel)} ?</strong> Ce corridor a un minimum de ${esc(taxable)} kg : en dessous, on facture le minimum. Deux petits colis du même client voyagent mieux ensemble.`;
  }
  return `<strong>On facture le poids de la balance (${esc(reel)} kg).</strong> Le carton pèse plus lourd que la place qu’il prend : c’est le poids réel qui compte.`;
}

/* =========================================================================
   #/recevoir
   ========================================================================= */

export function afficherReception(conteneur, params) {
  const s = { agences: [], corridors: [], compte: null, paire: null, mode: null, tarif: null, jeton: 0, recherche: '', trouves: [], supplements: new Set(), enCours: false };
  let photos = null;
  conteneur.innerHTML = `<div class="page page-reception"><div class="squelette" style="height:420px"></div></div>`;
  const ref = (n) => conteneur.querySelector(`[data-ref="${n}"]`);

  const paires = () => [...new Map(s.corridors.map((c) => [`${c.agence_depart}|${c.agence_arrivee}`, c])).values()];
  const modesDe = (paire) => s.corridors.filter((c) => `${c.agence_depart}|${c.agence_arrivee}` === paire);
  const villeDe = (id) => s.agences.find((a) => a.id === id)?.ville || '';

  function render() {
    const dep = s.agences.find((a) => a.id === s.paire?.split('|')[0]);
    conteneur.innerHTML = `
      <div class="page page-reception">
        <header class="col-entete">
          <div class="col-entete-titres"><h1>Recevoir de la marchandise</h1><span class="discret">Entrepôt de ${esc(dep?.nom || dep?.ville || '')} · ${esc(formatDate(new Date(), 'long'))}</span></div>
        </header>
        <div class="col-reception-grille">
          <div class="col-reception-gauche">
            <section class="carte col-bloc">
              <h2>1. Au nom de qui ?</h2>
              <div class="col-qui">
                <div class="champ"><label for="rc-qui">Numéro d’expéditeur, nom ou téléphone</label>
                  <input id="rc-qui" class="input col-gros" autocomplete="off" placeholder="GN-1042" value="${esc(s.recherche)}"></div>
                <button type="button" class="btn btn-primaire col-scanner" data-action="scanner" ${'BarcodeDetector' in window ? '' : 'disabled title="Ce navigateur ne sait pas lire les QR codes : tapez le numéro."'}>${icone('qr', 17, 2)} Scanner</button>
              </div>
              <div data-zone="compte"></div>
              <p class="discret">Le fournisseur dépose au nom du client : il n’a pas besoin d’être là. Il reçoit un SMS dès que le carton est enregistré, avec la photo.</p>
            </section>
            <section class="carte col-bloc">
              <h2>2. Le carton</h2>
              <div class="rangee-champs">
                <div class="champ"><label for="rc-contenu">Contenu</label><input id="rc-contenu" class="input" maxlength="200" placeholder="Ex. Mèches et perruques"></div>
                <div class="champ"><label for="rc-recu-de">Déposé par</label><input id="rc-recu-de" class="input" maxlength="80" placeholder="Ex. Fatou Ndiaye — Marché HLM"></div>
              </div>
              <div class="champ"><label for="rc-douane">Contenu pour la douane (facultatif)</label><input id="rc-douane" class="input" maxlength="200" placeholder="Repris du contenu"></div>
              ${champsMesure()}
              <div class="rangee-champs">
                <div class="champ"><label for="rc-paire">Corridor</label><select id="rc-paire" class="input">${paires().map((c) => `<option value="${c.agence_depart}|${c.agence_arrivee}" ${`${c.agence_depart}|${c.agence_arrivee}` === s.paire ? 'selected' : ''}>${esc(villeDe(c.agence_depart))} → ${esc(villeDe(c.agence_arrivee))}</option>`).join('')}</select></div>
                <div class="champ"><label for="rc-mode">Mode</label><select id="rc-mode" class="input" data-ref="modes"></select></div>
              </div>
              <div class="col-supplements" data-ref="supplements"></div>
              <div class="champ"><label for="rc-valeur">Valeur déclarée (facultatif)</label><input id="rc-valeur" class="input" inputmode="numeric" placeholder="0"></div>
            </section>
          </div>
          <div class="col-reception-droite">
            <section class="carte col-calcul" data-ref="calcul" aria-live="polite">${calculHTML(null)}</section>
            <section class="carte col-bloc"><div class="col-photos" data-zone="photos"></div>
              <p class="discret">La photo de la bascule part sur le lien de suivi du client. La photo du contenu reste au bureau.</p></section>
            <p class="erreur-form" role="alert" hidden></p>
            <button type="button" class="btn btn-primaire btn-grand btn-bloc" data-action="recevoir" disabled>${icone('valide', 18, 2.4)} <span data-ref="libelle-recevoir">Enregistrer et prévenir le client</span></button>
            <button type="button" class="btn btn-secondaire btn-bloc" data-action="deposer" disabled>Déposer sans peser</button>
            <p class="discret" data-ref="manque"></p>
            <p class="col-note-encaissement"><strong>Rien n’est encaissé maintenant.</strong> Le transport sera payé par <span data-ref="client-nom">le client</span> au retrait, ou d’avance s’il le demande. Ce carton rejoint son compte et attend qu’il dise « faire partir ».</p>
          </div>
        </div>
      </div>`;
    photos = monterPhotos(conteneur.querySelector('[data-zone="photos"]'), { surChangement: () => majBoutons() });
    renderModes();
    renderCompte();
    majPhraseCartons(conteneur);
  }

  function renderModes() {
    const liste = modesDe(s.paire);
    if (!liste.some((c) => c.mode === s.mode)) s.mode = liste[0]?.mode || null;
    ref('modes').innerHTML = liste.map((c) => `<option value="${c.mode}" ${c.mode === s.mode ? 'selected' : ''}>${esc(MODES[c.mode]?.libelle || c.mode)} · ${c.delai_jours ?? '?'} jours</option>`).join('');
  }

  function renderCompte() {
    const z = conteneur.querySelector('[data-zone="compte"]');
    if (s.compte) {
      const f = s.compte;
      z.innerHTML = `<div class="col-compte-choisi">
        <span class="col-avatar">${esc(initiales(f.nom))}</span>
        <span class="col-compte-textes"><strong>${esc(f.nom)} · ${esc(f.code)}</strong><span>${esc([f.ville, formatTel(f.telephone, { indicatif: true }), `client depuis ${formatDate(f.created_at, 'moisAnnee')}`].filter(Boolean).join(' · '))}</span></span>
        <span class="col-compte-stock"><strong>${f.resume.entrepot ? `${formatNombre(f.resume.entrepot)} carton${f.resume.entrepot > 1 ? 's' : ''} déjà à l’entrepôt` : 'Rien à l’entrepôt'}</strong>${f.resume.entrepot ? `<span>${esc(kg(f.resume.kg_entrepot))} taxables en attente</span>` : ''}</span>
        <button type="button" class="btn-lien" data-action="changer-compte">Changer</button></div>`;
      ref('client-nom').textContent = prenom(f.nom);
      ref('libelle-recevoir').textContent = `Enregistrer et prévenir ${prenom(f.nom)}`;
    } else if (s.recherche.length >= 2) {
      z.innerHTML = s.trouves.length ? `<ul class="col-comptes-trouves">${s.trouves.map((c) => `<li><button type="button" class="col-compte-trouve" data-choisir-compte="${esc(c.id)}">
          <span class="col-compte-code">${esc(c.code)}</span><span class="col-compte-textes"><strong>${esc(c.nom)}</strong><span>${esc([c.ville, formatTel(c.telephone)].filter(Boolean).join(' · '))}</span></span>
          <span class="discret">${c.entrepot ? `${formatNombre(c.entrepot)} à l’entrepôt` : ''}</span></button></li>`).join('')}</ul>`
        : `<div class="col-compte-absent"><span>Aucun compte ne correspond à « ${esc(s.recherche)} ».</span><button type="button" class="btn btn-secondaire btn-petit" data-action="creer-compte">+ Créer un compte</button></div>`;
    } else z.innerHTML = '';
  }

  function majBoutons() {
    const m = lireMesure(conteneur);
    const manque = [];
    if (!s.compte) manque.push('le compte du client');
    if (!conteneur.querySelector('#rc-contenu').value.trim()) manque.push('le contenu');
    const peutDeposer = manque.length === 0 && photos?.pret(['contenu']);
    if (!m.poids) manque.push('le poids');
    if (m.dimsPartielles) manque.push('les trois dimensions (ou aucune)');
    if (!s.tarif) manque.push('un tarif pour ce corridor');
    if (!photos?.pret()) manque.push('les deux photos');
    if (!s.enCours) {
      conteneur.querySelector('[data-action="recevoir"]').disabled = manque.length > 0;
      conteneur.querySelector('[data-action="deposer"]').disabled = !peutDeposer;
    }
    ref('manque').textContent = manque.length ? `Pour enregistrer avec la pesée, il manque ${manque.join(', ').replace(/, ([^,]*)$/, ' et $1')}. Pour déposer sans peser : le compte, le contenu et la photo du contenu suffisent.` : '';
  }

  const recalculer = differer(async () => {
    const m = lireMesure(conteneur);
    const jeton = ++s.jeton;
    if (!m.poids || m.poids <= 0 || !s.mode || m.dimsPartielles) { s.tarif = null; ref('calcul').innerHTML = calculHTML(null); renderSupplements(null); majBoutons(); return; }
    ref('calcul').classList.add('calcul');
    const [depart, arrivee] = s.paire.split('|');
    let t = null;
    try { t = await api.tarif({ depart, arrivee, mode: s.mode, poids: m.poids, supplements: [...s.supplements], longueur: m.longueur, largeur: m.largeur, hauteur: m.hauteur, nb: m.nb }); } catch (err) {
      if (jeton !== s.jeton) return;
      s.tarif = null;
      ref('calcul').innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`;
      ref('calcul').classList.remove('calcul'); majBoutons(); return;
    }
    if (jeton !== s.jeton) return;
    s.tarif = t;
    ref('calcul').classList.remove('calcul');
    ref('calcul').innerHTML = calculHTML(t, m);
    renderSupplements(t);
    majBoutons();
  }, 300);

  function renderSupplements(t) {
    const z = ref('supplements');
    const possibles = t?.supplements_possibles || [];
    if (z.dataset.signature === JSON.stringify(possibles)) return;
    z.dataset.signature = JSON.stringify(possibles);
    z.innerHTML = possibles.length ? `<span class="etiquette">Suppléments</span><div class="col-puces">${possibles.map((p) => `<label class="col-supplement"><input type="checkbox" value="${esc(p.nom)}" ${s.supplements.has(p.nom) ? 'checked' : ''}><span>${esc(p.nom)} <strong>+${formatNombre(p.montant)} ${esc(nomDevise(t.devise))}</strong></span></label>`).join('')}</div>` : '';
  }

  const chercher = differer(async () => {
    const jeton = ++s.jeton;
    if (s.recherche.length < 2) { s.trouves = []; renderCompte(); return; }
    try {
      const r = await api.chercherCompte(s.recherche);
      if (jeton !== s.jeton) return;
      s.trouves = r;
      // Numéro d'expéditeur exact : le compte est choisi tout de suite.
      const exact = r.find((c) => c.code.toUpperCase() === s.recherche.toUpperCase());
      if (exact) choisirCompte(exact.id); else renderCompte();
    } catch (err) { if (jeton === s.jeton) conteneur.querySelector('[data-zone="compte"]').innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`; }
  }, 300);

  async function choisirCompte(id) {
    try {
      s.compte = await api.compteFiche(id);
      s.recherche = s.compte.code;
      conteneur.querySelector('#rc-qui').value = s.compte.code;
      renderCompte(); majBoutons();
    } catch (err) { toast(messageErreur(err), 'erreur'); }
  }

  /** Scanner : le client montre son numéro (QR de son relevé, qui contient le texte « GN-1042 »). */
  async function scanner() {
    let flux;
    try { flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch { toast('Caméra inaccessible ou refusée.', 'erreur'); return; }
    const detecteur = new window.BarcodeDetector({ formats: ['qr_code'] });
    let actif = true;
    const { el, fermer } = ouvrirModale({
      titre: 'Scanner le numéro du client',
      contenu: '<video class="col-video" autoplay playsinline muted></video><p class="discret">Le client ouvre son relevé et montre le QR de son numéro.</p><div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button></div>',
      onFermer: () => { actif = false; flux.getTracks().forEach((p) => p.stop()); }
    });
    const video = el.querySelector('video');
    video.srcObject = flux;
    const boucle = async () => {
      if (!actif) return;
      try {
        const codes = await detecteur.detect(video);
        const texte = codes.map((c) => c.rawValue).find((v) => /^[A-Z]{2}-\d+$/i.test(String(v).trim()));
        if (texte) { fermer(); s.recherche = texte.trim().toUpperCase(); conteneur.querySelector('#rc-qui').value = s.recherche; chercher(); return; }
      } catch { /* image pas encore prête */ }
      setTimeout(boucle, 300);
    };
    video.addEventListener('loadeddata', boucle, { once: true });
  }

  function erreur(t) { const z = conteneur.querySelector('.erreur-form'); z.textContent = t; z.hidden = !t; }

  async function enregistrer(bouton, avecPesee) {
    const m = lireMesure(conteneur);
    const v = (id) => conteneur.querySelector(`#${id}`).value.trim();
    const [depart] = s.paire.split('|');
    erreur('');
    s.enCours = true;
    boutonOccupe(bouton, true, 'Enregistrement…');
    let fichiers = null;
    try {
      fichiers = await photos.envoyer(avecPesee ? ['bascule', 'contenu'] : ['contenu']);
      let r;
      if (avecPesee) {
        r = await api.recevoir({
          compte: s.compte.id, depart, mode: s.mode, contenu: v('rc-contenu'), contenuDouane: v('rc-douane') || v('rc-contenu'), nb: m.nb,
          poids: m.poids, longueur: m.longueur, largeur: m.largeur, hauteur: m.hauteur, valeur: lireNombre(v('rc-valeur')),
          supplements: [...s.supplements], photoBascule: fichiers.bascule, photoContenu: fichiers.contenu, recuDe: v('rc-recu-de')
        });
      } else {
        r = await api.deposer({ compte: s.compte.id, depart, contenu: v('rc-contenu'), photoDepot: fichiers.contenu, nb: m.nb, recuDe: v('rc-recu-de') });
        try { sessionStorage.setItem(`yb_colis_${r.id}`, JSON.stringify({ lien: r.lien_suivi })); } catch { /* facultatif */ }
      }
      photos.arreter();
      const nom = prenom(s.compte.nom);
      if (avecPesee) { toast(`${r.numero} enregistré. Le SMS est parti à ${nom}.`, 'succes', 6000); naviguer(`colis/${encodeURIComponent(r.id)}/etiquette`); return; }
      ouvrirModale({
        titre: `Carton ${r.numero} déposé`,
        contenu: `<p class="texte-modale">Le carton est sur le compte <strong>${esc(r.compte)}</strong>, au statut « à peser ». ${esc(nom)} le voit déjà sur son relevé. Pesez-le dès que possible : sans pesée, il ne peut pas partir.</p>
          <div class="modale-actions"><a class="btn btn-secondaire" href="#/recevoir" data-fermer>Recevoir un autre carton</a><a class="btn btn-primaire" href="#/peser/${encodeURIComponent(r.id)}" data-fermer>Peser maintenant</a></div>`
      });
      afficherReception(conteneur, new URLSearchParams());
    } catch (err) {
      if (fichiers?.envoyes?.length) await photos.nettoyer(fichiers.envoyes);
      s.enCours = false;
      boutonOccupe(bouton, false);
      erreur(messageErreur(err));
      majBoutons();
    }
  }

  function brancher() {
    conteneur.addEventListener('input', (e) => {
      if (e.target.id === 'rc-qui') { s.recherche = e.target.value.trim(); if (s.compte && s.recherche !== s.compte.code) { s.compte = null; } chercher(); }
      if (['rc-poids', 'rc-long', 'rc-larg', 'rc-haut', 'rc-nb'].includes(e.target.id)) { majPhraseCartons(conteneur); recalculer(); }
      if (e.target.id === 'rc-contenu') conteneur.querySelector('#rc-douane').placeholder = e.target.value || 'Repris du contenu';
      majBoutons();
    });
    conteneur.addEventListener('change', (e) => {
      if (e.target.id === 'rc-paire') { s.paire = e.target.value; renderModes(); recalculer(); }
      if (e.target.id === 'rc-mode') { s.mode = e.target.value; recalculer(); }
      if (e.target.closest('[data-ref="supplements"]')) { if (e.target.checked) s.supplements.add(e.target.value); else s.supplements.delete(e.target.value); recalculer(); }
    });
    conteneur.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      const choix = e.target.closest('[data-choisir-compte]');
      if (choix) choisirCompte(choix.dataset.choisirCompte);
      if (a === 'changer-compte') { s.compte = null; s.recherche = ''; conteneur.querySelector('#rc-qui').value = ''; conteneur.querySelector('#rc-qui').focus(); renderCompte(); majBoutons(); }
      if (a === 'creer-compte') {
        const chiffres = /^[\d\s+]+$/.test(s.recherche);
        ouvrirCreationCompte({ nom: chiffres ? '' : s.recherche, tel: chiffres ? s.recherche : '', surCompte: (f) => choisirCompte(f.id) });
      }
      if (a === 'scanner') scanner();
      if (a === 'recevoir') enregistrer(e.target.closest('button'), true);
      if (a === 'deposer') enregistrer(e.target.closest('button'), false);
    });
  }

  (async () => {
    try {
      [s.agences, s.corridors] = await Promise.all([chargerAgences(), chargerCorridors()]);
      if (!conteneur.isConnected) return;
      if (!s.corridors.length) {
        conteneur.innerHTML = '<div class="page"><div class="carte col-vide"><p><strong>Aucun corridor ouvert.</strong> Ouvrez-en un (départ, arrivée, mode) avant de recevoir de la marchandise.</p><a class="btn btn-primaire" href="#/parametres">Ouvrir un corridor</a></div></div>';
        return;
      }
      s.paire = `${s.corridors[0].agence_depart}|${s.corridors[0].agence_arrivee}`;
      render();
      brancher();
      if (params?.get('compte')) choisirCompte(params.get('compte'));
      conteneur.querySelector('#rc-qui').focus({ preventScroll: true });
    } catch (err) {
      conteneur.innerHTML = `<div class="page"><p class="bloc-erreur">${esc(messageErreur(err))}</p></div>`;
    }
  })();
}

/* =========================================================================
   #/peser/<id> — pesée d'un carton déposé, au téléphone, à côté de la balance
   ========================================================================= */

export function afficherPesee(conteneur, id) {
  const s = { c: null, agences: [], corridors: [], depart: null, arrivee: null, mode: null, tarif: null, jeton: 0, supplements: new Set(), enCours: false };
  let photos = null;
  conteneur.innerHTML = `<div class="page page-pesee"><div class="squelette" style="height:420px"></div></div>`;
  const ref = (n) => conteneur.querySelector(`[data-ref="${n}"]`);

  function render() {
    const c = s.c;
    const modes = s.corridors.filter((x) => x.agence_depart === s.depart?.id && x.agence_arrivee === s.arrivee?.id);
    if (!modes.some((x) => x.mode === s.mode)) s.mode = modes[0]?.mode || null;
    conteneur.innerHTML = `
      <div class="page page-pesee">
        <header class="col-pesee-entete">
          <a href="#/colis?filtre=a_peser" class="btn-icone" aria-label="Retour aux cartons à peser">${icone('retour', 20, 2)}</a>
          <span class="col-pesee-titres"><strong>Peser le carton</strong><span>${esc(c.numero)} · ${esc(c.expediteur.nom)} · ${esc(c.depart.ville)}</span></span>
        </header>
        <section class="carte col-bloc"><div class="col-photos" data-zone="photos"></div></section>
        <section class="carte col-bloc">
          <span class="etiquette-carte">Le carton</span>
          <p class="col-pesee-contenu"><strong>${esc(c.contenu)}</strong>${c.parcours[0]?.note ? `<span class="discret">${esc(c.parcours[0].note)}</span>` : ''}</p>
          ${champsMesure({ nb: c.nb_colis || 1 })}
          <button type="button" class="btn btn-secondaire btn-bloc col-mesurer" disabled title="La mesure par l’appareil photo n’est pas encore fiable sur les téléphones : mesurez au mètre.">${icone('photo', 17, 2)} Mesurer avec l’appareil photo · bientôt</button>
          <div class="rangee-champs">
            <div class="champ"><label for="rc-mode">Mode</label><select id="rc-mode" class="input">${modes.map((x) => `<option value="${x.mode}" ${x.mode === s.mode ? 'selected' : ''}>${esc(MODES[x.mode]?.libelle || x.mode)} · ${x.delai_jours ?? '?'} jours</option>`).join('')}</select></div>
            <div class="champ"><label for="rc-valeur">Valeur déclarée (facultatif)</label><input id="rc-valeur" class="input" inputmode="numeric" placeholder="0"></div>
          </div>
          <div class="champ"><label for="rc-douane">Contenu pour la douane (facultatif)</label><input id="rc-douane" class="input" maxlength="200" placeholder="${esc(c.contenu)}"></div>
          <div class="col-supplements" data-ref="supplements"></div>
        </section>
        <section class="carte col-calcul" data-ref="calcul" aria-live="polite">${calculHTML(null, null, { titre: 'Ce qui sera facturé' })}</section>
        <p class="col-pourquoi" data-ref="pourquoi" hidden></p>
        <p class="erreur-form" role="alert" hidden></p>
        <button type="button" class="btn btn-primaire btn-grand btn-bloc" data-action="peser" disabled>${icone('valide', 18, 2.4)} Enregistrer et prévenir ${esc(prenom(c.expediteur.nom))}</button>
        <p class="discret" data-ref="manque"></p>
      </div>`;
    photos = monterPhotos(conteneur.querySelector('[data-zone="photos"]'), { demandees: ['bascule'], surChangement: () => majBouton() });
    majPhraseCartons(conteneur);
  }

  function majBouton() {
    const m = lireMesure(conteneur);
    const manque = [];
    if (!m.poids) manque.push('le poids');
    if (m.dimsPartielles) manque.push('les trois dimensions (ou aucune)');
    if (!s.tarif) manque.push('le calcul du prix');
    if (!photos?.pret()) manque.push('la photo de la bascule');
    if (!s.enCours) conteneur.querySelector('[data-action="peser"]').disabled = manque.length > 0;
    ref('manque').textContent = manque.length ? `Il manque ${manque.join(', ').replace(/, ([^,]*)$/, ' et $1')}.` : '';
  }

  const recalculer = differer(async () => {
    const m = lireMesure(conteneur);
    const jeton = ++s.jeton;
    if (!m.poids || m.poids <= 0 || !s.mode || m.dimsPartielles) { s.tarif = null; ref('calcul').innerHTML = calculHTML(null, null, { titre: 'Ce qui sera facturé' }); ref('pourquoi').hidden = true; majBouton(); return; }
    let t = null;
    try { t = await api.tarif({ depart: s.depart.id, arrivee: s.arrivee.id, mode: s.mode, poids: m.poids, supplements: [...s.supplements], longueur: m.longueur, largeur: m.largeur, hauteur: m.hauteur, nb: m.nb }); } catch (err) {
      if (jeton === s.jeton) { s.tarif = null; ref('calcul').innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`; majBouton(); }
      return;
    }
    if (jeton !== s.jeton) return;
    s.tarif = t;
    ref('calcul').innerHTML = calculHTML(t, m, { titre: 'Ce qui sera facturé' }) + `<p class="col-calcul-corridor">${esc(t.nom)} · ${formatNombre(t.prix_kg)} ${esc(nomDevise(t.devise))}/kg</p>`;
    ref('pourquoi').innerHTML = pourquoiHTML(t);
    ref('pourquoi').hidden = false;
    const z = ref('supplements');
    if (z.dataset.signature !== JSON.stringify(t.supplements_possibles)) {
      z.dataset.signature = JSON.stringify(t.supplements_possibles);
      z.innerHTML = t.supplements_possibles.length ? `<span class="etiquette">Suppléments</span><div class="col-puces">${t.supplements_possibles.map((p) => `<label class="col-supplement"><input type="checkbox" value="${esc(p.nom)}" ${s.supplements.has(p.nom) ? 'checked' : ''}><span>${esc(p.nom)} <strong>+${formatNombre(p.montant)}</strong></span></label>`).join('')}</div>` : '';
    }
    majBouton();
  }, 300);

  async function peser(bouton) {
    const m = lireMesure(conteneur);
    const z = conteneur.querySelector('.erreur-form');
    z.hidden = true;
    s.enCours = true;
    boutonOccupe(bouton, true, 'Enregistrement…');
    let fichiers = null;
    try {
      fichiers = await photos.envoyer(['bascule']);
      const r = await api.peser(id, {
        mode: s.mode, poids: m.poids, longueur: m.longueur, largeur: m.largeur, hauteur: m.hauteur, nb: m.nb, photoBascule: fichiers.bascule,
        supplements: [...s.supplements], valeur: lireNombre(conteneur.querySelector('#rc-valeur').value), contenuDouane: conteneur.querySelector('#rc-douane').value.trim() || null
      });
      photos.arreter();
      toast(`${r.numero} pesé : ${kg(r.calcul.poids_taxable)} taxables, ${montant(r.tarif.total, r.tarif.devise)}. Le SMS est parti à ${prenom(s.c.expediteur.nom)}.`, 'succes', 7000);
      naviguer(`colis/${encodeURIComponent(r.id)}/etiquette`);
    } catch (err) {
      if (fichiers?.envoyes?.length) await photos.nettoyer(fichiers.envoyes);
      s.enCours = false;
      boutonOccupe(bouton, false);
      z.textContent = messageErreur(err); z.hidden = false;
      majBouton();
    }
  }

  (async () => {
    try {
      const [c, agences, corridors] = await Promise.all([api.fiche(id), chargerAgences(), chargerCorridors()]);
      if (!conteneur.isConnected) return;
      if (c.statut !== 'a_peser') {
        conteneur.innerHTML = `<div class="page"><div class="carte col-vide"><p><strong>${esc(c.numero)} est déjà pesé.</strong></p><a class="btn btn-primaire" href="#/colis/${encodeURIComponent(id)}">Voir le colis</a></div></div>`;
        return;
      }
      Object.assign(s, { c, agences, corridors, depart: agenceSelon(agences, c.depart), arrivee: agenceSelon(agences, c.arrivee) });
      // Un carton déposé n'a pas encore d'arrivée choisie ailleurs que dans son compte : sinon, premier corridor depuis ce départ.
      if (!s.arrivee?.id) s.arrivee = agences.find((a) => a.id === corridors.find((x) => x.agence_depart === s.depart?.id)?.agence_arrivee) || null;
      render();
      conteneur.addEventListener('input', (e) => {
        if (['rc-poids', 'rc-long', 'rc-larg', 'rc-haut', 'rc-nb'].includes(e.target.id)) { majPhraseCartons(conteneur); recalculer(); }
        majBouton();
      });
      conteneur.addEventListener('change', (e) => {
        if (e.target.id === 'rc-mode') { s.mode = e.target.value; recalculer(); }
        if (e.target.closest('[data-ref="supplements"]')) { if (e.target.checked) s.supplements.add(e.target.value); else s.supplements.delete(e.target.value); recalculer(); }
      });
      conteneur.addEventListener('click', (e) => { if (e.target.closest('[data-action="peser"]')) peser(e.target.closest('button')); });
      majBouton();
    } catch (err) {
      conteneur.innerHTML = `<div class="page"><p class="bloc-erreur">${esc(messageErreur(err))}</p><a class="btn btn-secondaire" href="#/colis?filtre=a_peser">Retour</a></div>`;
    }
  })();
}
