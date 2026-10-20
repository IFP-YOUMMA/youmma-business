/**
 * page.js — Page d'impression document.html : facture / reçu / bon de livraison d'une vente, facture
 * proforma d'un devis, ou impression d'essai des réglages (filigrane « EXEMPLE », sans numéro).
 * Adresse : document.html?b=<boutique>&type=<facture|recu|bon_livraison|proforma>&vente=<id>|proforma=<id>[&essai=1]
 */
import { configurationValide } from '../supabase.js';
import { etat, chargerSession, chargerBoutiques, choisirBoutique, peut } from '../state.js';
import { esc, icone, toast, messageErreur, formatGNF, normaliserTelephone } from '../utils.js';
import { rendreDocument, LIBELLES_DOCUMENTS, lienVerification, donneesExemple } from './rendu.js';
import { chargerModules, aModule } from '../modules.js';
import { chargerBonLivraison } from '../livraisons.js';
import {
  chargerReglages, normaliserReglages, typeVente, emettreDocument, documentExistant, imagesSignature, chargerVente, chargerProforma
} from './donnees.js';

const racine = document.getElementById('doc-app');
const params = new URLSearchParams(location.search);
const s = { type: params.get('type') || 'facture', avecPrix: false, donnees: null, reglages: null, documents: new Map(), signatures: null, transport: null };

/** Colonnes de « livraisons » lues ici (jamais la colonne jeton). La signature est lue si la colonne existe. */
/**
 * Livraison (module « livraisons ») liée à la vente. La ligne est seulement repérée ici (id, sans la colonne jeton) ;
 * tout le reste — véhicule, chauffeur, reçu par, heure, signature, photo du bon — vient de bon_livraison.
 */
async function chargerTransport(idVente) {
  if (!aModule('livraisons') || !idVente) return null;
  const { sb } = await import('../supabase.js');
  const { data } = await sb.from('livraisons').select('id, statut, created_at').eq('boutique_id', etat.boutique.id).eq('vente_id', idVente)
    .neq('statut', 'annulee').order('created_at', { ascending: false }).limit(1);
  if (!data?.[0]) return null;
  return chargerBonLivraison(data[0].id);
}

function retour() {
  let cible = '#/tableau-de-bord';
  try { cible = sessionStorage.getItem('yb_document_retour') || cible; } catch { /* défaut */ }
  location.href = `./${cible}`;
}

function erreur(message, { connexion = false } = {}) {
  racine.innerHTML = `
    <div class="barre-doc"><button type="button" class="btn btn-secondaire barre-doc-retour" data-action="retour">${icone('retour', 18, 2)} Retour</button></div>
    <div class="doc-erreur"><p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(message)}</p>
      ${connexion ? '<a class="btn btn-primaire" href="./#/connexion">Se connecter</a>' : ''}</div>`;
  racine.querySelector('[data-action="retour"]').addEventListener('click', retour);
}

async function demarrer() {
  if (!configurationValide) return erreur('Configuration manquante.');
  try {
    await chargerSession();
    if (!etat.session) return erreur('Connectez-vous pour afficher ce document.', { connexion: true });
    await chargerBoutiques();
    if (!choisirBoutique(params.get('b') || etat.boutique?.id)) return erreur('Cette boutique n’est pas dans votre compte.');
    if (!peut('documents.imprimer')) return erreur('Vous n’avez pas accès aux documents de cette boutique.');
    const essai = params.get('essai') === '1';
    await chargerModules(etat.boutique.id, { annoncer: false });
    if (s.type === 'bon_livraison' && !aModule('bons_livraison') && !aModule('livraisons')) s.type = 'facture';
    s.reglages = essai ? lireBrouillon() : await chargerReglages(etat.boutique.id);
    s.signatures = await imagesSignature(s.reglages);
    if (params.get('proforma')) {
      s.type = 'proforma';
      s.donnees = await chargerProforma(params.get('proforma'));
    } else if (params.get('vente')) {
      s.donnees = await chargerVente(params.get('vente'));
      s.transport = await chargerTransport(params.get('vente')).catch(() => null);
      if (!['facture', 'recu', 'bon_livraison'].includes(s.type)) s.type = typeVente(s.reglages);
    } else {
      // Essai : dernière vente réelle de la boutique, sinon un exemple.
      s.donnees = await derniereVente() || donneesExemple(etat.boutique);
      if (!['facture', 'recu', 'bon_livraison', 'proforma'].includes(s.type)) s.type = typeVente(s.reglages);
    }
    await preparerDocument();
    render();
  } catch (err) {
    erreur(messageErreur(err));
  }
}

function lireBrouillon() {
  try { return normaliserReglages(JSON.parse(sessionStorage.getItem('yb_document_essai') || '{}')); } catch { return normaliserReglages({}); }
}

async function derniereVente() {
  try {
    const { sb } = await import('../supabase.js');
    const { data } = await sb.from('ventes').select('id').eq('boutique_id', etat.boutique.id).neq('statut', 'annulee').order('created_at', { ascending: false }).limit(1);
    return data?.[0] ? await chargerVente(data[0].id) : null;
  } catch { return null; }
}

/** Numéro du document : émis (ou retrouvé) ; vente annulée → document existant seulement ; essai → aucun. */
async function preparerDocument() {
  if (s.documents.has(s.type)) return;
  let doc = null;
  if (params.get('essai') === '1') doc = null;
  else if (s.type === 'proforma') doc = await emettreDocument('proforma', { proforma: s.donnees.proforma.id });
  else if (s.donnees.vente.statut === 'annulee') doc = await documentExistant(s.type, s.donnees.vente.id);
  else doc = await emettreDocument(s.type, { vente: s.donnees.vente.id });
  s.documents.set(s.type, doc);
}

function render() {
  const d = s.donnees;
  const doc = s.documents.get(s.type);
  const essai = params.get('essai') === '1';
  const venteDoc = s.type !== 'proforma';
  const typePrincipal = typeVente(s.reglages);
  const total = d.vente?.total ?? d.proforma?.total ?? 0;
  racine.innerHTML = `
    <div class="barre-doc">
      <button type="button" class="btn btn-secondaire barre-doc-retour" data-action="retour">${icone('retour', 18, 2)} Retour</button>
      <div class="barre-doc-titre"><strong>${esc(LIBELLES_DOCUMENTS[s.type])}${doc?.numero ? ' ' + esc(doc.numero) : ''}</strong>
        <span>${essai ? 'Impression d’essai · aucun numéro émis' : d.vente?.statut === 'annulee' ? 'Vente annulée' : formatGNF(total)}</span></div>
      <div class="barre-doc-actions">
        ${venteDoc && !essai ? `<div class="segments" role="group" aria-label="Type de document">
          <button type="button" class="segment ${s.type === typePrincipal ? 'actif' : ''}" data-type="${typePrincipal}">${typePrincipal === 'recu' ? 'Reçu A4' : 'Facture A4'}</button>
          ${aModule('bons_livraison') || aModule('livraisons') ? `<button type="button" class="segment ${s.type === 'bon_livraison' ? 'actif' : ''}" data-type="bon_livraison">Bon de livraison</button>` : ''}</div>` : ''}
        ${s.type === 'bon_livraison' ? `<label class="doc-option"><input type="checkbox" data-action="prix" ${s.avecPrix ? 'checked' : ''}> Avec les prix</label>` : ''}
        ${s.type === 'bon_livraison' && s.transport?.photoUrl ? `<a class="btn btn-secondaire" href="${esc(s.transport.photoUrl)}" target="_blank" rel="noopener">${icone('photo', 18, 2)} Voir la photo du bon</a>` : ''}
        <button type="button" class="btn btn-primaire" data-action="imprimer">${icone('imprimante', 18, 2)} Imprimer / PDF</button>
        ${!essai && doc?.code ? `<button type="button" class="btn btn-whatsapp" data-action="whatsapp">${icone('whatsapp', 18, 2)} WhatsApp</button>` : ''}
      </div>
    </div>
    ${!essai && doc?.code ? `<p class="doc-rappel">${icone('document', 16, 2)} Pour envoyer le document : « Imprimer / PDF » → « Enregistrer en PDF », puis joignez le PDF au message WhatsApp.</p>` : ''}
    ${!essai && !doc && d.vente?.statut === 'annulee' ? `<p class="doc-rappel">${icone('alerte', 16, 2)} Vente annulée : aucun nouveau numéro n’est attribué.</p>` : ''}
    <div class="doc-cadre"><div class="doc-echelle">${rendreDocument({
      type: s.type, reglages: s.reglages, boutique: etat.boutique, document: doc,
      vente: d.vente, proforma: d.proforma, lignes: d.lignes, client: d.client, chantier: d.chantier, recuperePar: d.recuperePar,
      livraison: d.livraison, vendeur: d.vendeur, cachetUrl: s.signatures?.cachetUrl, signatureUrl: s.signatures?.signatureUrl,
      transport: s.type === 'bon_livraison' ? s.transport : null,
      essai, avecPrix: s.avecPrix
    })}</div></div>`;
  document.title = `${LIBELLES_DOCUMENTS[s.type]}${doc?.numero ? ' ' + doc.numero : ''} · ${etat.boutique.nom}`;
  racine.querySelectorAll('.ybd img').forEach((i) => i.addEventListener('load', ajuster, { once: true }));
  ajuster();
}

/** Met l'A4 (794 px) à la largeur de l'écran (téléphone) sans changer l'impression. */
function ajuster() {
  const cadre = racine.querySelector('.doc-echelle');
  const doc = cadre?.querySelector('.ybd');
  if (!doc) return;
  const echelle = Math.min(1, (document.documentElement.clientWidth - 32) / 794);
  doc.style.transform = echelle < 1 ? `scale(${echelle})` : '';
  cadre.style.width = `${794 * echelle}px`;
  cadre.style.height = `${doc.offsetHeight * echelle}px`;
}

function texteWhatsApp() {
  const d = s.donnees;
  const doc = s.documents.get(s.type);
  const nom = s.reglages.nom_affiche || etat.boutique.nom;
  const total = d.vente?.total ?? d.proforma?.total ?? 0;
  return `${nom}\n${LIBELLES_DOCUMENTS[s.type]} ${doc.numero}${s.type === 'bon_livraison' ? '' : ` — Total : ${formatGNF(total)}`}\nVérifiez ce document : ${lienVerification(doc.code)}`;
}

racine.addEventListener('click', async (e) => {
  if (e.target.closest('[data-action="retour"]')) { retour(); return; }
  if (e.target.closest('[data-action="imprimer"]')) { window.print(); return; }
  if (e.target.closest('[data-action="whatsapp"]')) {
    const tel = normaliserTelephone(s.donnees.client?.telephone || '');
    window.open(`https://wa.me/${tel || ''}?text=${encodeURIComponent(texteWhatsApp())}`, '_blank', 'noopener');
    toast('Pensez à joindre le PDF enregistré au message.', 'info', 6000);
    return;
  }
  const bouton = e.target.closest('[data-type]');
  if (bouton && bouton.dataset.type !== s.type) {
    s.type = bouton.dataset.type;
    try { await preparerDocument(); render(); } catch (err) { toast(messageErreur(err), 'erreur'); }
  }
});
racine.addEventListener('change', (e) => {
  if (e.target.closest('[data-action="prix"]')) { s.avecPrix = e.target.checked; render(); }
});
window.addEventListener('resize', ajuster);
document.fonts?.ready.then(ajuster);
window.addEventListener('load', ajuster);

demarrer();
