/**
 * proformas.js — Devis / factures proforma (#/proformas, tous les rôles).
 *  - #/proformas            : liste (numéro, date, client, objet, total, validité, statut), filtres, recherche ;
 *  - #/proformas/nouveau    : éditeur (client existant ou libre, objet, lignes du stock ou libres, prix négocié,
 *                             remise, validité, note) → enregistrer_proforma ;
 *  - #/proformas/<id>       : aperçu A4 et actions (imprimer, WhatsApp, statut, modifier, dupliquer,
 *                             transformer en vente → caisse pré-remplie, puis statut « converti »).
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import { naviguer } from './router.js';
import {
  esc, icone, toast, boutonOccupe, messageErreur, confirmer, formatGNF, formatNombre, formatDate, formatTelephone,
  normaliserTelephone, lireNombre, uniteDivisible, prixApplique, differer, chargerParLots, formatNumeroVente
} from './utils.js';
import { rendreDocument, lienVerification } from './documents/rendu.js';
import { vignetteProduit } from './images/affichage.js';
import { chargerReglages, chargerProforma, imagesSignature, ouvrirDocument } from './documents/donnees.js';

export const STATUTS_DEVIS = {
  brouillon: { libelle: 'Brouillon', classe: 'gris' },
  envoye: { libelle: 'Envoyé', classe: 'bleu' },
  accepte: { libelle: 'Accepté', classe: 'vert' },
  refuse: { libelle: 'Refusé', classe: 'rouge' },
  converti: { libelle: 'Transformé en vente', classe: 'nuit' }
};
const CLE_DUPLICATION = 'yb_devis_duplique';

const finValidite = (pf) => new Date(new Date(pf.created_at).getTime() + Number(pf.validite_jours || 0) * 86400000);
function texteValidite(pf) {
  if (!['brouillon', 'envoye'].includes(pf.statut)) return '';
  const j = Math.ceil((finValidite(pf) - Date.now()) / 86400000);
  if (j < 0) return 'expiré';
  return j === 0 ? 'expire aujourd’hui' : `expire dans ${j} j`;
}
const pastilleStatut = (statut) => `<span class="pastille-devis ${STATUTS_DEVIS[statut]?.classe || 'gris'}">${esc(STATUTS_DEVIS[statut]?.libelle || statut)}</span>`;

export function afficherProformas(conteneur, params) {
  const id = params.get('id');
  if (!id) return afficherListe(conteneur, params);
  if (id === 'nouveau') return afficherEditeur(conteneur, null);
  if (params.get('vue') === 'modifier') return afficherEditeur(conteneur, id);
  return afficherDetail(conteneur, id);
}

/* ============================================================ Liste */

function afficherListe(conteneur, params) {
  const boutique = etat.boutique;
  const s = { devis: [], numeros: new Map(), filtre: params.get('statut') || 'tous', recherche: '' };
  conteneur.innerHTML = `
    <div class="page page-devis">
      <header class="page-entete">
        <div class="page-titres"><h1>Devis</h1><span class="discret">Factures proforma : prix proposés au client avant la vente</span></div>
        <div class="entete-actions"><a class="btn btn-primaire" href="#/proformas/nouveau">${icone('plus', 18, 2.4)} Nouveau devis</a></div>
      </header>
      <div class="barre-filtres">
        <div class="champ-recherche">${icone('recherche', 18, 2)}<input type="search" class="input" placeholder="Client, objet, numéro…" aria-label="Rechercher un devis" data-ref="recherche"></div>
        <div class="segments segments-defilants" role="group" aria-label="Statut">
          ${[['tous', 'Tous'], ...Object.entries(STATUTS_DEVIS).map(([k, v]) => [k, v.libelle])].map(([k, l]) => `<button type="button" class="segment ${s.filtre === k ? 'actif' : ''}" data-filtre="${k}">${esc(l)}</button>`).join('')}
        </div>
      </div>
      <div data-zone="liste"><div class="squelette" style="height:220px"></div></div>
    </div>`;
  const zone = conteneur.querySelector('[data-zone="liste"]');

  async function charger() {
    try {
      const devis = await chargerParLots((d, f) => sb.from('proformas')
        .select('id, client_id, client_nom, client_tel, objet, total, validite_jours, statut, vente_id, created_at')
        .eq('boutique_id', boutique.id).order('created_at', { ascending: false }).range(d, f));
      s.devis = devis;
      const ids = devis.map((d) => d.id);
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = await sb.from('documents_emis').select('proforma_id, numero').eq('type', 'proforma').in('proforma_id', ids.slice(i, i + 100));
        (data || []).forEach((x) => s.numeros.set(x.proforma_id, x.numero));
      }
      const idsClients = [...new Set(devis.map((d) => d.client_id).filter(Boolean))];
      if (idsClients.length) {
        const { data } = await sb.from('clients').select('id, nom').in('id', idsClients);
        const noms = new Map((data || []).map((c) => [c.id, c.nom]));
        devis.forEach((d) => { if (d.client_id && !d.client_nom) d.client_nom = noms.get(d.client_id); });
      }
    } catch (err) {
      zone.innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p>`;
      return;
    }
    if (conteneur.isConnected) render();
  }

  function render() {
    const r = s.recherche.toLowerCase();
    const liste = s.devis.filter((d) => (s.filtre === 'tous' || d.statut === s.filtre)
      && (!r || [d.client_nom, d.objet, s.numeros.get(d.id), d.client_tel].some((x) => String(x || '').toLowerCase().includes(r))));
    if (!s.devis.length) {
      zone.innerHTML = `<div class="carte etat-vide"><span class="etat-vide-icone">${icone('document', 32, 1.6)}</span>
        <p class="gras">Aucun devis pour l’instant</p><p class="discret">Préparez un devis pour un client : il le reçoit en PDF par WhatsApp et le transforme en vente quand il accepte.</p>
        <a class="btn btn-primaire" href="#/proformas/nouveau">Créer un devis</a></div>`;
      return;
    }
    zone.innerHTML = liste.length ? `
      <div class="carte liste-devis">
        <table class="tableau-devis">
          <thead><tr><th>Numéro</th><th>Date</th><th>Client</th><th>Objet</th><th class="droite">Total</th><th>Validité</th><th>Statut</th></tr></thead>
          <tbody>${liste.map((d) => {
            const v = texteValidite(d);
            return `<tr data-ouvrir="${esc(d.id)}" tabindex="0">
              <td class="gras" data-label="Numéro">${esc(s.numeros.get(d.id) || 'Brouillon')}</td>
              <td data-label="Date">${esc(formatDate(d.created_at, 'court'))}</td>
              <td data-label="Client">${esc(d.client_nom || '—')}</td>
              <td data-label="Objet" class="discret">${esc(d.objet || '—')}</td>
              <td data-label="Total" class="droite gras">${formatGNF(d.total)}</td>
              <td data-label="Validité" class="${v === 'expiré' ? 'texte-danger' : 'discret'}">${esc(v || '—')}</td>
              <td data-label="Statut">${pastilleStatut(d.statut)}</td></tr>`;
          }).join('')}</tbody>
        </table>
      </div>` : '<p class="carte vide-liste">Aucun devis ne correspond.</p>';
  }

  conteneur.addEventListener('click', (e) => {
    const filtre = e.target.closest('[data-filtre]');
    if (filtre) {
      s.filtre = filtre.dataset.filtre;
      conteneur.querySelectorAll('[data-filtre]').forEach((b) => b.classList.toggle('actif', b === filtre));
      render(); return;
    }
    const ligne = e.target.closest('[data-ouvrir]');
    if (ligne) naviguer(`proformas/${encodeURIComponent(ligne.dataset.ouvrir)}`);
  });
  conteneur.addEventListener('keydown', (e) => {
    const ligne = e.target.closest('[data-ouvrir]');
    if (ligne && e.key === 'Enter') naviguer(`proformas/${encodeURIComponent(ligne.dataset.ouvrir)}`);
  });
  conteneur.querySelector('[data-ref="recherche"]').addEventListener('input', differer((e) => { s.recherche = e.target.value.trim(); render(); }, 200));
  charger();
}

/* ============================================================ Détail (aperçu A4 + actions) */

function afficherDetail(conteneur, id) {
  const boutique = etat.boutique;
  const s = { d: null, doc: null, reglages: null, signatures: null, vente: null };
  conteneur.innerHTML = `<div class="page page-devis-detail"><div class="squelette" style="height:420px"></div></div>`;

  async function charger() {
    try {
      const [d, reglages, docs] = await Promise.all([
        chargerProforma(id),
        chargerReglages(boutique.id),
        sb.from('documents_emis').select('numero, code, created_at').eq('type', 'proforma').eq('proforma_id', id).limit(1)
      ]);
      s.d = d; s.reglages = reglages; s.doc = docs.data?.[0] || null;
      s.signatures = await imagesSignature(reglages);
      if (d.proforma.vente_id) {
        const { data } = await sb.from('ventes').select('id, numero').eq('id', d.proforma.vente_id).maybeSingle();
        s.vente = data;
      }
    } catch (err) {
      conteneur.innerHTML = `<div class="page"><p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p><a class="btn btn-secondaire" href="#/proformas">Retour aux devis</a></div>`;
      return;
    }
    if (conteneur.isConnected) render();
  }

  function render() {
    const pf = s.d.proforma;
    const modifiable = ['brouillon', 'envoye'].includes(pf.statut);
    const v = texteValidite(pf);
    const statutPossible = peut('devis.statut');
    conteneur.innerHTML = `
      <div class="page page-devis-detail">
        <header class="page-entete">
          <div class="page-titres">
            <a class="lien-retour" href="#/proformas">← Devis</a>
            <h1>${esc(s.doc?.numero || 'Devis')} ${pastilleStatut(pf.statut)}</h1>
            <span class="discret">${esc(s.d.client?.nom || 'Client')} · ${formatGNF(pf.total)} · ${esc(formatDate(pf.created_at, 'court'))}${v ? ` · <span class="${v === 'expiré' ? 'texte-danger' : ''}">${esc(v)}</span>` : ''}</span>
            ${s.vente ? `<a class="lien-vente-devis" href="#/ventes/${encodeURIComponent(s.vente.id)}">${icone('ventes', 16, 2)} Vente ${esc(formatNumeroVente(s.vente.numero))}</a>` : ''}
          </div>
        </header>
        <div class="devis-detail">
          <div class="devis-actions carte">
            <button type="button" class="btn btn-primaire btn-bloc" data-action="imprimer">${icone('imprimante', 18, 2)} Imprimer / PDF</button>
            ${s.doc?.code ? `<button type="button" class="btn btn-whatsapp btn-bloc" data-action="whatsapp">${icone('whatsapp', 18, 2)} Envoyer par WhatsApp</button>` : ''}
            ${pf.statut !== 'converti' && pf.statut !== 'refuse' ? `<button type="button" class="btn btn-succes btn-bloc" data-action="convertir">${icone('caisse', 18, 2)} Transformer en vente</button>` : ''}
            ${statutPossible && modifiable ? `<div class="devis-statuts">
              ${pf.statut === 'brouillon' ? '<button type="button" class="btn btn-secondaire" data-statut="envoye">Marquer envoyé</button>' : ''}
              <button type="button" class="btn btn-secondaire" data-statut="accepte">Accepté</button>
              <button type="button" class="btn btn-secondaire btn-discret-danger" data-statut="refuse">Refusé</button></div>` : ''}
            ${modifiable ? `<a class="btn btn-secondaire btn-bloc" href="#/proformas/${encodeURIComponent(pf.id)}/modifier">${icone('crayon', 18, 2)} Modifier</a>`
              : '<p class="discret">Ce devis a été accepté, refusé ou transformé en vente : il n’est plus modifiable.</p>'}
            <button type="button" class="btn btn-secondaire btn-bloc" data-action="dupliquer">${icone('copier', 18, 2)} Dupliquer</button>
          </div>
          <div class="apercu-doc apercu-devis"><div class="apercu-a4">${rendreDocument({
            type: 'proforma', reglages: s.reglages, boutique, document: s.doc, proforma: pf, lignes: s.d.lignes,
            client: s.d.client, vendeur: s.d.vendeur, cachetUrl: s.signatures?.cachetUrl, signatureUrl: s.signatures?.signatureUrl
          })}</div></div>
        </div>
      </div>`;
    ajuster();
    conteneur.querySelectorAll('.apercu-a4 img').forEach((i) => i.addEventListener('load', ajuster, { once: true }));
  }

  function ajuster() {
    const cadre = conteneur.querySelector('.apercu-a4');
    const doc = cadre?.querySelector('.ybd');
    if (!doc) return;
    const echelle = Math.min(1, cadre.parentElement.clientWidth / 794);
    doc.style.transform = `scale(${echelle})`;
    cadre.style.height = `${doc.offsetHeight * echelle}px`;
  }

  conteneur.addEventListener('click', async (e) => {
    if (!s.d) return;
    const pf = s.d.proforma;
    if (e.target.closest('[data-action="imprimer"]')) { ouvrirDocument({ type: 'proforma', proforma: pf.id }); return; }
    if (e.target.closest('[data-action="whatsapp"]')) {
      const nom = s.reglages.nom_affiche || boutique.nom;
      const texte = `${nom}\nDevis ${s.doc.numero}${pf.objet ? ` — ${pf.objet}` : ''}\nTotal : ${formatGNF(pf.total)} · valable jusqu’au ${formatDate(finValidite(pf), 'court')}\nVérifiez ce devis : ${lienVerification(s.doc.code)}`;
      const tel = normaliserTelephone(s.d.client?.telephone || '');
      window.open(`https://wa.me/${tel || ''}?text=${encodeURIComponent(texte)}`, '_blank', 'noopener');
      toast('Joignez le PDF du devis (Imprimer / PDF → Enregistrer en PDF).', 'info', 6000);
      if (pf.statut === 'brouillon' && peut('devis.statut')) changerStatut('envoye', { silencieux: true });
      return;
    }
    const statut = e.target.closest('[data-statut]');
    if (statut) { changerStatut(statut.dataset.statut, { bouton: statut }); return; }
    if (e.target.closest('[data-action="dupliquer"]')) {
      try { sessionStorage.setItem(CLE_DUPLICATION, JSON.stringify({ ...pf, client: s.d.client })); } catch { /* sans copie */ }
      naviguer('proformas/nouveau?copie=1');
      return;
    }
    if (e.target.closest('[data-action="convertir"]')) convertir();
  });

  async function changerStatut(statut, { bouton = null, silencieux = false } = {}) {
    if (statut === 'refuse' && !(await confirmer('Marquer ce devis comme refusé par le client ?', { libelleOk: 'Refusé', danger: true }))) return;
    if (bouton) boutonOccupe(bouton, true, '…');
    const { error } = await sb.rpc('statut_proforma', { p_proforma: id, p_statut: statut, p_vente: null });
    if (error) { if (bouton) boutonOccupe(bouton, false); toast(messageErreur(error), 'erreur'); return; }
    if (!silencieux) toast(`Devis : ${STATUTS_DEVIS[statut].libelle.toLowerCase()}.`, 'succes');
    charger();
  }

  /** La caisse relit le devis en base : fonctionne depuis n'importe quel appareil et pour tous les rôles. */
  function convertir() {
    naviguer(`caisse?devis=${encodeURIComponent(s.d.proforma.id)}`);
  }

  window.addEventListener('resize', ajuster);
  charger();
  return () => window.removeEventListener('resize', ajuster);
}

/* ============================================================ Éditeur */

function afficherEditeur(conteneur, id) {
  const boutique = etat.boutique;
  const s = {
    id, produits: [], client: null, clientLibre: { nom: '', telephone: '', info: '' }, modeClient: 'existant',
    objet: '', lignes: [], remise: 0, validite: 15, note: '', enCours: false, recherche: '', rechercheClient: '', clients: []
  };
  let cle = 0;
  const nouvelleCle = () => ++cle;

  conteneur.innerHTML = `<div class="page page-devis-editeur"><div class="squelette" style="height:420px"></div></div>`;

  async function charger() {
    try {
      const [produits, reglages] = await Promise.all([
        chargerParLots((d, f) => sb.from('produits').select('id, nom, unite, prix_detail, prix_gros, prix_promo, promo_fin, stock, sur_commande, photo_url, photo_mini_url')
          .eq('boutique_id', boutique.id).eq('actif', true).order('nom').range(d, f)),
        chargerReglages(boutique.id)
      ]);
      s.produits = produits;
      s.validite = Number(reglages.validite_proforma) || 15;
      if (id) {
        const d = await chargerProforma(id);
        const pf = d.proforma;
        if (!['brouillon', 'envoye'].includes(pf.statut)) throw new Error('PROFORMA_VERROUILLEE');
        remplir(pf, d.client);
      } else if (new URLSearchParams(location.hash.split('?')[1] || '').get('copie')) {
        try {
          const copie = JSON.parse(sessionStorage.getItem(CLE_DUPLICATION) || 'null');
          sessionStorage.removeItem(CLE_DUPLICATION);
          if (copie) { remplir(copie, copie.client); s.objet = copie.objet ? `${copie.objet} (copie)` : ''; }
        } catch { /* nouveau devis vide */ }
      }
    } catch (err) {
      conteneur.innerHTML = `<div class="page"><p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p><a class="btn btn-secondaire" href="#/proformas">Retour aux devis</a></div>`;
      return;
    }
    if (conteneur.isConnected) render();
  }

  function remplir(pf, client) {
    if (pf.client_id && client) { s.client = { id: pf.client_id, nom: client.nom, telephone: client.telephone }; s.modeClient = 'existant'; }
    else if (pf.client_nom) { s.modeClient = 'libre'; s.clientLibre = { nom: pf.client_nom || '', telephone: pf.client_tel ? formatTelephone(pf.client_tel) : '', info: pf.client_info || '' }; }
    if (pf.client_info && s.client) s.clientLibre.info = pf.client_info;
    s.objet = pf.objet || '';
    s.remise = Number(pf.remise) || 0;
    s.validite = Number(pf.validite_jours) || s.validite;
    s.note = pf.note || '';
    s.lignes = (pf.lignes || []).map((l) => {
      const produit = l.produit_id ? s.produits.find((p) => p.id === l.produit_id) : null;
      return { cle: nouvelleCle(), produit_id: l.produit_id || null, nom: l.nom, unite: l.unite || 'pièce', quantite: Number(l.quantite) || 1, prix: Number(l.prix) || 0, produit };
    });
  }

  const prixActuel = (l) => (l.produit ? prixApplique(l.produit, 'detail') : null);
  function totaux() {
    const sousTotal = s.lignes.reduce((t, l) => t + Math.round((Number(l.prix) || 0) * (Number(l.quantite) || 0)), 0);
    const remise = Math.min(Math.max(0, Math.round(s.remise || 0)), sousTotal);
    return { sousTotal, remise, total: sousTotal - remise };
  }

  function render() {
    conteneur.innerHTML = `
      <div class="page page-devis-editeur">
        <header class="page-entete">
          <div class="page-titres">
            <a class="lien-retour" href="${id ? `#/proformas/${encodeURIComponent(id)}` : '#/proformas'}">← ${id ? 'Devis' : 'Devis'}</a>
            <h1>${id ? 'Modifier le devis' : 'Nouveau devis'}</h1>
          </div>
        </header>
        <div class="devis-editeur">
          <div class="devis-editeur-gauche">
            <section class="carte reglages-section"><h2>Client</h2>
              <div class="segments" role="group" aria-label="Client">
                <button type="button" class="segment ${s.modeClient === 'existant' ? 'actif' : ''}" data-mode-client="existant">Client de la boutique</button>
                <button type="button" class="segment ${s.modeClient === 'libre' ? 'actif' : ''}" data-mode-client="libre">Saisie libre</button>
              </div>
              <div data-zone="client"></div>
            </section>
            <section class="carte reglages-section"><h2>Objet</h2>
              <input type="text" class="input" maxlength="160" data-ref="objet" value="${esc(s.objet)}" placeholder="Ex. Construction villa Kagbélen — gros œuvre" aria-label="Objet du devis">
            </section>
            <section class="carte reglages-section"><h2>Articles</h2>
              <div class="champ-recherche">${icone('recherche', 18, 2)}<input type="search" class="input" data-ref="recherche" placeholder="Rechercher un article du stock…" aria-label="Rechercher un article" autocomplete="off"></div>
              <div class="resultats-devis" data-zone="resultats"></div>
              <div class="lignes-devis" data-zone="lignes"></div>
              <button type="button" class="btn btn-pointille" data-action="ligne-libre">+ Ligne libre (main-d’œuvre, transport…)</button>
            </section>
          </div>
          <aside class="devis-editeur-droite carte">
            <div class="champ"><label for="devis-remise">Remise globale (GNF)</label>
              <input id="devis-remise" class="input" type="text" inputmode="numeric" data-ref="remise" value="${s.remise ? formatNombre(s.remise) : ''}" placeholder="0"></div>
            <div class="champ"><label for="devis-validite">Validité (jours)</label>
              <input id="devis-validite" class="input" type="number" inputmode="numeric" min="1" max="365" data-ref="validite" value="${esc(s.validite)}"></div>
            <div class="champ"><label for="devis-note">Note (sur le devis)</label>
              <textarea id="devis-note" class="input" rows="3" maxlength="500" data-ref="note" placeholder="Ex. Livraison comprise sur Dubréka.">${esc(s.note)}</textarea></div>
            <div class="totaux" data-zone="totaux"></div>
            <p class="erreur-form" data-zone="erreur" hidden></p>
            <button type="button" class="btn btn-primaire btn-grand btn-bloc" data-action="enregistrer">Enregistrer le devis</button>
          </aside>
        </div>
      </div>`;
    renderClient();
    renderLignes();
  }

  const z = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);

  function renderClient() {
    const zone = z('client');
    if (!zone) return;
    if (s.modeClient === 'libre') {
      zone.innerHTML = `<div class="grille-champs">
        <div class="champ"><label for="cl-nom">Nom ou raison sociale</label><input id="cl-nom" class="input" maxlength="100" data-libre="nom" value="${esc(s.clientLibre.nom)}" placeholder="Ex. Entreprise BTP Kaba SARL"></div>
        <div class="champ"><label for="cl-tel">Téléphone</label><input id="cl-tel" class="input" type="tel" inputmode="tel" data-libre="telephone" value="${esc(s.clientLibre.telephone)}" placeholder="620 00 00 00"></div>
        <div class="champ champ-large"><label for="cl-info">Infos (adresse, NIF…)</label><input id="cl-info" class="input" maxlength="200" data-libre="info" value="${esc(s.clientLibre.info)}" placeholder="Ex. Kagbélen, Dubréka · NIF 987654321"></div></div>`;
      return;
    }
    if (s.client) {
      zone.innerHTML = `<div class="client-choisi">
          <span class="client-textes"><span class="gras">${esc(s.client.nom)}</span><span class="discret">${esc(s.client.telephone ? formatTelephone(s.client.telephone) : 'Sans téléphone')}</span></span>
          <button type="button" class="btn-lien" data-action="changer-client">Changer</button></div>
        <div class="champ"><label for="cl-info2">Infos sur le devis (adresse, NIF…)</label><input id="cl-info2" class="input" maxlength="200" data-libre="info" value="${esc(s.clientLibre.info)}"></div>`;
      return;
    }
    zone.innerHTML = `<div class="champ-recherche">${icone('recherche', 18, 2)}<input type="search" class="input" data-ref="recherche-client" placeholder="Nom ou téléphone du client…" aria-label="Rechercher un client" autocomplete="off" value="${esc(s.rechercheClient)}"></div>
      <ul class="resultats-clients" data-zone="clients">${s.clients.map((c) => `<li><button type="button" class="item-client" data-client="${esc(c.id)}"><span class="gras">${esc(c.nom)}</span><span class="discret">${esc(c.telephone ? formatTelephone(c.telephone) : '')}</span></button></li>`).join('')}</ul>`;
  }

  const chercherClients = differer(async (texte) => {
    s.rechercheClient = texte;
    if (!texte) { s.clients = []; renderClient(); focusRechercheClient(); return; }
    const chiffres = texte.replace(/\D/g, '');
    let requete = sb.from('clients').select('id, nom, telephone').eq('boutique_id', boutique.id).order('nom').limit(8);
    requete = chiffres.length >= 3 ? requete.ilike('telephone', `%${chiffres}%`) : requete.ilike('nom', `%${texte}%`);
    const { data } = await requete;
    s.clients = data || [];
    renderClient();
    focusRechercheClient();
  }, 250);
  function focusRechercheClient() {
    const champ = conteneur.querySelector('[data-ref="recherche-client"]');
    if (champ) { champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length); }
  }

  function renderResultats() {
    const zone = z('resultats');
    const r = s.recherche.toLowerCase();
    if (!r) { zone.innerHTML = ''; return; }
    const trouves = s.produits.filter((p) => p.nom.toLowerCase().includes(r)).slice(0, 8);
    zone.innerHTML = trouves.length ? `<ul class="liste-resultats">${trouves.map((p) => `
      <li><button type="button" class="item-client item-produit-devis" data-produit="${esc(p.id)}"><span class="vignette-mini">${vignetteProduit(p, 40, icone('stock', 18, 1.8))}</span><span class="gras">${esc(p.nom)}</span>
        <span class="discret">${formatGNF(prixApplique(p, 'detail'))} / ${esc(p.unite)}${p.sur_commande ? ' · sur commande' : ` · stock ${formatNombre(p.stock, 3)}`}</span></button></li>`).join('')}</ul>`
      : '<p class="discret">Aucun article. Utilisez « Ligne libre » pour un article hors stock.</p>';
  }

  function renderLignes() {
    const zone = z('lignes');
    if (!zone) return;
    zone.innerHTML = s.lignes.length ? s.lignes.map((l) => {
      const actuel = prixActuel(l);
      const negocie = actuel !== null && Math.round(Number(l.prix)) !== Math.round(actuel);
      const pas = uniteDivisible(l.unite) ? '0.001' : '1';
      return `<div class="ligne-devis" data-cle="${l.cle}">
        <div class="ligne-devis-nom">${l.produit_id ? `<span class="gras">${esc(l.nom)}</span>` : `<input type="text" class="input" data-champ-ligne="nom" value="${esc(l.nom)}" placeholder="Désignation (ex. Main-d’œuvre)" maxlength="160" aria-label="Désignation">`}
          ${l.produit_id ? (negocie ? `<span class="tag-negocie">prix négocié · actuel ${formatNombre(actuel)}</span>` : '') : '<span class="tag-libre">ligne libre</span>'}</div>
        <label class="ligne-devis-champ"><span>Qté</span><input type="number" class="input" inputmode="decimal" min="0" step="${pas}" data-champ-ligne="quantite" value="${esc(l.quantite)}"></label>
        ${l.produit_id ? `<span class="ligne-devis-unite">${esc(l.unite)}</span>` : `<label class="ligne-devis-champ"><span>Unité</span><input type="text" class="input" data-champ-ligne="unite" value="${esc(l.unite)}" maxlength="20"></label>`}
        <label class="ligne-devis-champ"><span>Prix (GNF)</span><input type="text" class="input" inputmode="numeric" data-champ-ligne="prix" value="${esc(formatNombre(l.prix))}"></label>
        <span class="ligne-devis-total gras" data-total-ligne>${formatNombre(Math.round(l.prix * l.quantite))}</span>
        <button type="button" class="btn-icone btn-icone-clair btn-icone-danger" data-retirer="${l.cle}" aria-label="Retirer la ligne">${icone('corbeille', 18, 2)}</button>
      </div>`;
    }).join('') : '<p class="discret">Ajoutez des articles du stock ou une ligne libre.</p>';
    renderTotaux();
  }

  function renderTotaux() {
    const { sousTotal, remise, total } = totaux();
    const zone = z('totaux');
    if (!zone) return;
    zone.innerHTML = `
      <div class="totaux-ligne"><span class="discret">Sous-total</span><span class="gras">${formatGNF(sousTotal)}</span></div>
      ${remise ? `<div class="totaux-ligne"><span class="discret">Remise</span><span class="gras">− ${formatGNF(remise)}</span></div>` : ''}
      <div class="totaux-ligne totaux-final"><span>Total du devis</span><span class="total-grand">${formatNombre(total)} <span class="unite-gnf">GNF</span></span></div>`;
  }

  conteneur.addEventListener('click', (e) => {
    const mode = e.target.closest('[data-mode-client]');
    if (mode) {
      s.modeClient = mode.dataset.modeClient;
      conteneur.querySelectorAll('[data-mode-client]').forEach((b) => b.classList.toggle('actif', b === mode));
      renderClient(); return;
    }
    const client = e.target.closest('[data-client]');
    if (client) {
      const c = s.clients.find((x) => x.id === client.dataset.client);
      if (c) { s.client = c; s.clients = []; s.rechercheClient = ''; renderClient(); }
      return;
    }
    if (e.target.closest('[data-action="changer-client"]')) { s.client = null; renderClient(); focusRechercheClient(); return; }
    const produit = e.target.closest('[data-produit]');
    if (produit) {
      const p = s.produits.find((x) => x.id === produit.dataset.produit);
      const existante = s.lignes.find((l) => l.produit_id === p.id);
      if (existante) existante.quantite = Number(existante.quantite) + 1;
      else s.lignes.push({ cle: nouvelleCle(), produit_id: p.id, nom: p.nom, unite: p.unite, quantite: 1, prix: prixApplique(p, 'detail'), produit: p });
      s.recherche = '';
      const champ = conteneur.querySelector('[data-ref="recherche"]');
      champ.value = '';
      renderResultats(); renderLignes();
      champ.focus();
      return;
    }
    if (e.target.closest('[data-action="ligne-libre"]')) {
      s.lignes.push({ cle: nouvelleCle(), produit_id: null, nom: '', unite: 'forfait', quantite: 1, prix: 0, produit: null });
      renderLignes();
      conteneur.querySelector(`[data-cle="${cle}"] [data-champ-ligne="nom"]`)?.focus();
      return;
    }
    const retirer = e.target.closest('[data-retirer]');
    if (retirer) { s.lignes = s.lignes.filter((l) => String(l.cle) !== retirer.dataset.retirer); renderLignes(); return; }
    const enregistrerBtn = e.target.closest('[data-action="enregistrer"]');
    if (enregistrerBtn) enregistrer(enregistrerBtn);
  });

  conteneur.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.ref === 'recherche') { s.recherche = t.value.trim(); renderResultats(); return; }
    if (t.dataset.ref === 'recherche-client') { chercherClients(t.value.trim()); return; }
    if (t.dataset.ref === 'objet') { s.objet = t.value; return; }
    if (t.dataset.ref === 'note') { s.note = t.value; return; }
    if (t.dataset.ref === 'validite') { s.validite = Number(t.value) || 0; return; }
    if (t.dataset.ref === 'remise') { s.remise = lireNombre(t.value) || 0; renderTotaux(); return; }
    if (t.dataset.libre) { s.clientLibre[t.dataset.libre] = t.value; return; }
    const champ = t.dataset.champLigne;
    if (champ) {
      const ligne = s.lignes.find((l) => String(l.cle) === t.closest('[data-cle]').dataset.cle);
      if (champ === 'quantite') ligne.quantite = Number(String(t.value).replace(',', '.')) || 0;
      else if (champ === 'prix') ligne.prix = lireNombre(t.value) || 0;
      else ligne[champ] = t.value;
      const total = t.closest('[data-cle]').querySelector('[data-total-ligne]');
      if (total) total.textContent = formatNombre(Math.round(ligne.prix * ligne.quantite));
      renderTotaux();
    }
  });
  // Le badge « prix négocié » se met à jour quand on quitte le champ (pour ne pas perdre la saisie).
  conteneur.addEventListener('change', (e) => { if (e.target.dataset.champLigne === 'prix') renderLignes(); });

  async function enregistrer(bouton) {
    const erreur = z('erreur');
    const montrer = (m) => { erreur.textContent = m; erreur.hidden = !m; };
    const libre = s.modeClient === 'libre';
    const telLibre = libre && s.clientLibre.telephone.trim() ? normaliserTelephone(s.clientLibre.telephone) : null;
    if (libre && !s.clientLibre.nom.trim()) return montrer('Indiquez le nom du client.');
    if (!libre && !s.client) return montrer('Choisissez un client, ou passez en « Saisie libre ».');
    if (libre && s.clientLibre.telephone.trim() && !telLibre) return montrer('Numéro de téléphone invalide (ex. 620 00 00 00).');
    if (!s.lignes.length) return montrer('Ajoutez au moins un article.');
    if (s.lignes.some((l) => !l.produit_id && !String(l.nom).trim())) return montrer('Donnez une désignation à chaque ligne libre.');
    if (s.lignes.some((l) => !(Number(l.quantite) > 0))) return montrer('Chaque quantité doit être supérieure à 0.');
    if (s.lignes.some((l) => Number(l.prix) < 0)) return montrer('Un prix n’est pas valide.');
    if (!(s.validite >= 1 && s.validite <= 365)) return montrer('Validité : entre 1 et 365 jours.');
    montrer('');
    const lignes = s.lignes.map((l) => {
      if (!l.produit_id) return { nom: String(l.nom).trim(), unite: String(l.unite || 'forfait').trim(), quantite: Number(l.quantite), prix: Math.round(Number(l.prix)) };
      const actuel = prixActuel(l);
      return actuel !== null && Math.round(actuel) === Math.round(Number(l.prix))
        ? { produit_id: l.produit_id, quantite: Number(l.quantite) }
        : { produit_id: l.produit_id, quantite: Number(l.quantite), prix: Math.round(Number(l.prix)) };
    });
    boutonOccupe(bouton, true, 'Enregistrement…');
    const { data, error } = await sb.rpc('enregistrer_proforma', {
      p_boutique: boutique.id, p_id: s.id, p_client: libre ? null : s.client.id,
      p_client_nom: libre ? s.clientLibre.nom.trim() : null, p_client_tel: telLibre,
      p_client_info: s.clientLibre.info.trim() || null, p_objet: s.objet.trim() || null, p_lignes: lignes,
      p_remise: totaux().remise, p_validite: Math.round(s.validite), p_note: s.note.trim() || null
    });
    if (error) { boutonOccupe(bouton, false); montrer(messageErreur(error)); return; }
    const r = (Array.isArray(data) ? data[0] : data) || {};
    toast(`Devis ${r.document?.numero || ''} enregistré · ${formatGNF(r.total)}.`, 'succes');
    naviguer(`proformas/${encodeURIComponent(r.id || s.id)}`, { remplacer: true });
  }

  charger();
}
