/**
 * reglages.js — Paramètres → Documents (#/documents, gérant et propriétaire), maquette RecuReglages.
 *  1. Modèle (Classique, Moderne, Sobre) et couleurs ; 2. en-tête de la boutique (logo, nom affiché, RCCM, NIF…) ;
 *  3. contenu (titre, numérotation, format par défaut, 10 options, coupon, TVA, validité des devis, conditions) ;
 *  4. cachet et signature (bucket privé « documents »).
 * Aperçu A4 en direct (300 ms après chaque changement) avec la dernière vente réelle, onglet « Ticket 80 mm ».
 */
import { sb } from '../supabase.js';
import { etat } from '../state.js';
import { esc, icone, toast, boutonOccupe, messageErreur, confirmer, differer, initiales, formatTelephone } from '../utils.js';
import { modifierLogo } from '../images/actions.js';
import { ouvrirOutilImage } from '../images/outil.js';
import { envoyerImageDocument, supprimerImageDocument } from '../images/envoi.js';
import { htmlRecuVente } from '../recu.js';
import { rendreDocument, donneesExemple, contraste } from './rendu.js';
import { chargerReglages, oublierReglages, normaliserReglages, typeVente, chargerVente, imagesSignature, ouvrirDocument } from './donnees.js';

const COULEURS = ['#1F3A5F', '#0F7B5F', '#A51C1C', '#5B2A8C', '#7A4A00', '#111111'];
const ACCENTS = ['#C8102E', '#F2B33D', '#EF6C00', '#1F3A5F', '#0F7B5F', '#111111'];
const MODELES = [
  { code: 'classique', libelle: 'Classique' },
  { code: 'moderne', libelle: 'Moderne' },
  { code: 'sobre', libelle: 'Sobre (N&B)' }
];
const OPTIONS = [
  ['lettres', 'Montant en lettres', ''],
  ['prix_unitaire', 'Prix unitaire et unité', ''],
  ['client_detail', 'Bloc client détaillé', 'téléphone, infos si connus'],
  ['chantier', 'Chantier / livraison', ''],
  ['paiement', 'Infos de paiement', 'mode, crédit, solde du client'],
  ['signatures', 'Zones de signature', ''],
  ['qr', 'QR code de vérification', 'le client vérifie le document en ligne'],
  ['statut', 'Mention « Payée / À crédit »', ''],
  ['coupon', 'Coupon de fidélité', 'texte libre (ex. code promo)'],
  ['tva', 'Mention TVA', 'si vous êtes assujetti (prix TTC)']
];
const CHAMPS_TEXTE = ['nom_affiche', 'slogan', 'adresse', 'telephones', 'rccm', 'nif', 'email', 'paiement_mobile', 'coupon_texte', 'conditions'];
const PREFIXE = /^[A-Z0-9]{1,8}$/;

export function afficherReglagesDocuments(conteneur) {
  const boutique = etat.boutique;
  const s = { r: null, initial: '', apercu: 'a4', donnees: null, signatures: { cachetUrl: null, signatureUrl: null } };

  conteneur.innerHTML = `
    <div class="page page-reglages-docs">
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour" href="#/parametres">← Paramètres</a>
          <h1>Personnaliser mes reçus et factures</h1>
          <span class="discret">Paramètres → Documents · l’aperçu se met à jour en direct</span>
        </div>
        <div class="entete-actions">
          <button type="button" class="btn btn-secondaire" data-action="essai" disabled>${icone('imprimante', 18, 2)} Imprimer un essai</button>
          <button type="button" class="btn btn-primaire" data-action="enregistrer" disabled>Enregistrer</button>
        </div>
      </header>
      <div class="reglages-docs" data-zone="corps"><div class="squelette" style="height:420px"></div></div>
    </div>`;
  const q = (sel) => conteneur.querySelector(sel);

  async function charger() {
    try {
      const [reglages, donnees] = await Promise.all([chargerReglages(boutique.id, { recharger: true }), derniereVente()]);
      s.r = structuredClone(reglages);
      s.initial = JSON.stringify(s.r);
      s.donnees = donnees;
      s.signatures = await imagesSignature(s.r);
    } catch (err) {
      q('[data-zone="corps"]').innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p>`;
      return;
    }
    if (!conteneur.isConnected) return;
    render();
  }

  async function derniereVente() {
    try {
      const { data } = await sb.from('ventes').select('id').eq('boutique_id', boutique.id).neq('statut', 'annulee')
        .order('created_at', { ascending: false }).limit(1);
      return data?.[0] ? await chargerVente(data[0].id) : null;
    } catch { return null; }
  }

  /* ------------------------------------------------------------ Formulaire */

  function render() {
    const r = s.r;
    const o = r.options;
    q('[data-zone="corps"]').innerHTML = `
      <div class="reglages-docs-form">
        <section class="carte reglages-section"><h2>1. Modèle et couleurs</h2>
          <div class="cartes-modeles" role="radiogroup" aria-label="Modèle">
            ${MODELES.map((m) => `<button type="button" class="carte-modele-doc" role="radio" aria-checked="${r.modele === m.code}" data-modele="${m.code}">
              ${miniature(m.code)}<span>${m.libelle}</span></button>`).join('')}
          </div>
          ${r.modele === 'sobre' ? '<p class="discret">Modèle Sobre : noir et blanc, sans aplat de couleur (économie d’encre). Les couleurs ne s’appliquent pas.</p>' : ''}
          <div class="ligne-couleurs"><span class="libelle-couleur">Couleur principale</span>
            ${COULEURS.map((c) => pastille('couleur', c, r.couleur)).join('')}
            <label class="code-couleur">ou code <input type="text" class="input" data-couleur-code="couleur" value="${esc(r.couleur)}" maxlength="7" aria-label="Code de la couleur principale"></label>
            <input type="color" data-couleur-choix="couleur" value="${esc(r.couleur)}" aria-label="Choisir la couleur principale">
          </div>
          <div class="ligne-couleurs"><span class="libelle-couleur">Couleur d’accent</span>
            ${ACCENTS.map((c) => pastille('accent', c, r.accent)).join('')}
            <label class="code-couleur">ou code <input type="text" class="input" data-couleur-code="accent" value="${esc(r.accent)}" maxlength="7" aria-label="Code de la couleur d’accent"></label>
            <input type="color" data-couleur-choix="accent" value="${esc(r.accent)}" aria-label="Choisir la couleur d’accent">
          </div>
          <p class="discret" data-zone="contraste">${texteContraste()}</p>
        </section>

        <section class="carte reglages-section"><h2>2. En-tête de la boutique</h2>
          <div class="bloc-logo-doc">
            <span class="logo-boutique">${boutique.logo_url ? `<img src="${esc(boutique.logo_url)}" alt="Logo">` : esc(initiales(boutique.nom))}</span>
            <span class="client-textes"><span class="gras">Logo</span><span class="discret">PNG ou JPG · le même logo que la boutique en ligne</span></span>
            <button type="button" class="btn btn-secondaire btn-petit" data-action="logo">${icone('photo', 16, 2)} ${boutique.logo_url ? 'Changer' : 'Ajouter'}</button>
          </div>
          <div class="grille-champs">
            ${champ('nom_affiche', 'Nom affiché', boutique.nom, 80)}
            ${champ('slogan', 'Activité / slogan', 'Ex. Vente de matériaux · gros & détail', 120)}
            ${champ('adresse', 'Adresse', 'Ex. Marché de Dubréka, face à la station', 160)}
            ${champ('telephones', 'Téléphones', boutique.telephone ? formatTelephone(boutique.telephone) : '620 00 00 00', 120)}
            ${champ('rccm', 'RCCM', 'Ex. GN.TCC.2024.A.01234', 60)}
            ${champ('nif', 'NIF', 'Ex. 123456789', 40)}
            ${champ('email', 'E-mail (facultatif)', 'boutique@exemple.com', 120, 'email')}
            ${champ('paiement_mobile', 'Paiement mobile affiché', 'OM 620 00 00 01 · MoMo 664 12 34 56', 120)}
          </div>
        </section>

        <section class="carte reglages-section"><h2>3. Contenu du document</h2>
          <div class="grille-champs grille-3">
            <div class="champ"><label for="doc-titre">Titre des ventes</label>
              <select id="doc-titre" class="input" data-champ="titre_vente">
                <option value="facture" ${r.titre_vente !== 'recu' ? 'selected' : ''}>Facture</option>
                <option value="recu" ${r.titre_vente === 'recu' ? 'selected' : ''}>Reçu de vente</option>
              </select></div>
            <div class="champ"><span class="etiquette">Format par défaut</span>
              <div class="segments" role="group" aria-label="Format par défaut">
                <button type="button" class="segment ${r.format_defaut !== '80mm' ? 'actif' : ''}" data-format="a4">A4</button>
                <button type="button" class="segment ${r.format_defaut === '80mm' ? 'actif' : ''}" data-format="80mm">Ticket 80 mm</button>
              </div></div>
            <div class="champ"><label for="doc-validite">Validité des devis (jours)</label>
              <input id="doc-validite" class="input" type="number" inputmode="numeric" min="1" max="365" data-champ="validite_proforma" value="${esc(r.validite_proforma)}"></div>
          </div>
          <div class="champ"><span class="etiquette">Numérotation (lettres et chiffres) → ex. ${esc(r.prefixes.facture)}-${new Date().getFullYear()}-0001</span>
            <div class="grille-prefixes">
              ${[['facture', 'Facture'], ['recu', 'Reçu'], ['proforma', 'Devis'], ['bon_livraison', 'Bon de livraison']].map(([k, l]) => `
                <label class="prefixe"><span>${l}</span><input type="text" class="input" data-prefixe="${k}" value="${esc(r.prefixes[k])}" maxlength="8" autocapitalize="characters"></label>`).join('')}
            </div>
            <p class="erreur-form" data-zone="erreur-prefixes" hidden></p>
          </div>
          <div class="grille-options">
            ${OPTIONS.map(([k, l, aide]) => `
              <label class="option-doc"><span class="option-textes"><span class="gras">${l}</span>${aide ? `<span class="discret">${aide}</span>` : ''}</span>
                <input type="checkbox" class="bascule-doc" role="switch" data-option="${k}" ${o[k] ? 'checked' : ''}></label>`).join('')}
          </div>
          <div class="champ" ${o.coupon ? '' : 'hidden'} data-zone="coupon"><label for="doc-coupon">Texte du coupon</label>
            <textarea id="doc-coupon" class="input" rows="2" maxlength="300" data-champ="coupon_texte" placeholder="Ex. Votre prochain achat : −5 % avec le code DIALLO5">${esc(r.coupon_texte || '')}</textarea></div>
          <div class="champ champ-court" ${o.tva ? '' : 'hidden'} data-zone="tva"><label for="doc-tva">Taux de TVA (%)</label>
            <input id="doc-tva" class="input" type="number" inputmode="decimal" min="0" max="50" step="0.5" data-champ="tva_taux" value="${esc(r.tva_taux)}"></div>
          <div class="champ"><label for="doc-conditions">Conditions et message en bas de page</label>
            <textarea id="doc-conditions" class="input" rows="2" maxlength="400" data-champ="conditions" placeholder="Ex. Marchandise vendue ni reprise ni échangée. Merci de votre confiance !">${esc(r.conditions || '')}</textarea></div>
        </section>

        <section class="carte reglages-section"><h2>4. Cachet et signature</h2>
          <div class="cachet-signature">
            ${blocImage('cachet', 'Cachet', 'Photo du tampon, fond retiré automatiquement', s.signatures.cachetUrl, r.cachet_path)}
            ${blocImage('signature', 'Signature', 'Dessinez-la au doigt ou importez une photo', s.signatures.signatureUrl, r.signature_path)}
          </div>
          <label class="option-doc option-seule"><span class="option-textes"><span class="gras">Afficher aussi sur les documents des vendeurs</span>
            <span class="discret">Sinon, le cachet et la signature n’apparaissent que sur les documents imprimés par le gérant ou le propriétaire.</span></span>
            <input type="checkbox" class="bascule-doc" role="switch" data-champ-bool="cachet_vendeurs" ${r.cachet_vendeurs ? 'checked' : ''}></label>
        </section>
      </div>

      <aside class="reglages-docs-apercu">
        <div class="segments" role="group" aria-label="Aperçu">
          <button type="button" class="segment ${s.apercu === 'a4' ? 'actif' : ''}" data-apercu="a4">A4</button>
          <button type="button" class="segment ${s.apercu === 'ticket' ? 'actif' : ''}" data-apercu="ticket">Ticket 80 mm</button>
        </div>
        <div class="apercu-doc" data-zone="apercu"></div>
        <span class="discret">${s.donnees ? 'Aperçu avec votre dernière vente' : 'Aperçu avec un exemple (aucune vente pour l’instant)'} · le numéro et le QR réels sont attribués à l’impression</span>
      </aside>`;
    majApercu();
    majBoutons();
  }

  function miniature(code) {
    if (code === 'moderne') return '<span class="mini-doc"><span style="height:18px;background:#0F7B5F"></span><span style="height:6px;margin:6px 6px 0;background:#F5F7F4"></span><span style="height:6px;margin:3px 6px 0;background:#F5F7F4"></span><span style="height:10px;margin:6px 6px 0 30px;background:#0A3D33"></span></span>';
    if (code === 'sobre') return '<span class="mini-doc"><span style="height:2px;margin:10px 6px 0;background:#111"></span><span style="height:3px;margin:8px 6px 0;background:#ddd"></span><span style="height:3px;margin:3px 6px 0;background:#ddd"></span><span style="height:3px;margin:3px 6px 0;background:#ddd"></span></span>';
    return '<span class="mini-doc"><span style="height:4px;margin:8px 6px 0;background:#1F3A5F"></span><span style="height:10px;margin:6px 6px 0;background:#1F3A5F"></span><span style="height:3px;margin:3px 6px 0;background:#E5E7EB"></span><span style="height:3px;margin:3px 6px 0;background:#E5E7EB"></span></span>';
  }
  function pastille(cible, c, actuelle) {
    return `<button type="button" class="pastille-doc" style="background:${c}" data-${cible}="${c}" aria-pressed="${String(actuelle).toUpperCase() === c}" aria-label="${c}"></button>`;
  }
  function champ(cle, libelle, exemple, max, type = 'text') {
    return `<div class="champ"><label for="doc-${cle}">${libelle}</label><input id="doc-${cle}" class="input" type="${type}" maxlength="${max}" data-champ="${cle}" value="${esc(s.r[cle] || '')}" placeholder="${esc(exemple)}"></div>`;
  }
  function blocImage(cle, titre, aide, url, chemin) {
    return `<div class="bloc-image-doc">
      <span class="damier mini-damier">${url ? `<img src="${esc(url)}" alt="${titre}">` : chemin ? icone('valide', 22, 2) : `<span class="discret">Aucun</span>`}</span>
      <span class="client-textes"><span class="gras">${titre}</span><span class="discret">${aide}</span></span>
      <span class="bloc-image-actions">
        <button type="button" class="btn btn-secondaire btn-petit" data-image="${cle}">${chemin ? 'Remplacer' : 'Ajouter'}</button>
        ${chemin ? `<button type="button" class="btn-lien btn-lien-danger" data-supprimer="${cle}">Supprimer</button>` : ''}
      </span></div>`;
  }
  function texteContraste() {
    if (s.r.modele === 'sobre') return '';
    const blanc = contraste('#FFFFFF', s.r.couleur) >= 4.5;
    return blanc ? 'Texte blanc sur la couleur principale : bien lisible.' : 'Couleur claire : le texte posé dessus sera écrit en foncé pour rester lisible.';
  }

  /* ------------------------------------------------------------ Aperçu */

  const majApercu = differer(() => {
    const zone = q('[data-zone="apercu"]');
    if (!zone) return;
    const d = s.donnees || donneesExemple(boutique);
    if (s.apercu === 'ticket') {
      zone.className = 'apercu-doc apercu-ticket-cadre';
      zone.innerHTML = `<div class="apercu-ticket">${htmlRecuVente({
        numero: d.vente.numero, date: d.vente.created_at, vendeur: d.vendeur || etat.membre?.nom, client: d.client?.nom || null,
        lignes: d.lignes.map((l) => ({ nom_produit: l.nom, unite: l.unite, quantite: l.quantite, prix_unitaire: l.prix, total: l.total })),
        sousTotal: Number(d.vente.sous_total), remise: Number(d.vente.remise), total: Number(d.vente.total), mode: d.vente.mode_paiement,
        montantRecu: null, echeance: d.vente.mode_paiement === 'credit' ? d.vente.echeance : null, fraisLivraison: Number(d.vente.frais_livraison) || 0
      }, { reglages: s.r })}</div>`;
      return;
    }
    zone.className = 'apercu-doc';
    zone.innerHTML = `<div class="apercu-a4">${rendreDocument({
      type: typeVente(s.r), reglages: s.r, boutique: etat.boutique, document: null, apercu: true,
      vente: d.vente, lignes: d.lignes, client: d.client, chantier: d.chantier, recuperePar: d.recuperePar, livraison: d.livraison,
      vendeur: d.vendeur, cachetUrl: s.signatures.cachetUrl, signatureUrl: s.signatures.signatureUrl
    })}</div>`;
    ajusterApercu();
    zone.querySelectorAll('img').forEach((i) => i.addEventListener('load', ajusterApercu, { once: true }));
  }, 300);

  function ajusterApercu() {
    const cadre = q('.apercu-a4');
    const doc = cadre?.querySelector('.ybd');
    if (!doc) return;
    const echelle = Math.min(1, cadre.parentElement.clientWidth / 794);
    doc.style.transform = `scale(${echelle})`;
    cadre.style.height = `${doc.offsetHeight * echelle}px`;
  }

  function modifie() { return JSON.stringify(s.r) !== s.initial; }
  function majBoutons() {
    const ok = !q('[data-zone="erreur-prefixes"]') || q('[data-zone="erreur-prefixes"]').hidden;
    q('[data-action="enregistrer"]').disabled = !modifie() || !ok;
    q('[data-action="essai"]').disabled = !s.r;
  }
  function changement() { majBoutons(); majApercu(); }

  /* ------------------------------------------------------------ Événements */

  conteneur.addEventListener('input', (e) => {
    const t = e.target;
    if (!s.r) return;
    if (t.dataset.champ) {
      s.r[t.dataset.champ] = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value;
      changement();
    } else if (t.dataset.prefixe) {
      t.value = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      s.r.prefixes = { ...s.r.prefixes, [t.dataset.prefixe]: t.value };
      const valeurs = Object.values(s.r.prefixes);
      const erreur = !valeurs.every((p) => PREFIXE.test(p)) ? 'Chaque préfixe : 1 à 8 lettres ou chiffres.'
        : new Set(valeurs).size < valeurs.length ? 'Les préfixes doivent être différents.' : '';
      const zone = q('[data-zone="erreur-prefixes"]');
      zone.textContent = erreur; zone.hidden = !erreur;
      changement();
    } else if (t.dataset.couleurCode) {
      const v = t.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) { s.r[t.dataset.couleurCode] = v.toUpperCase(); majCouleurs(); changement(); }
    } else if (t.dataset.couleurChoix) {
      s.r[t.dataset.couleurChoix] = t.value.toUpperCase(); majCouleurs(); changement();
    }
  });
  conteneur.addEventListener('change', (e) => {
    const t = e.target;
    if (!s.r) return;
    if (t.dataset.champ === 'titre_vente') { s.r.titre_vente = t.value; changement(); }
    if (t.dataset.option) {
      s.r.options = { ...s.r.options, [t.dataset.option]: t.checked };
      if (t.dataset.option === 'coupon') q('[data-zone="coupon"]').hidden = !t.checked;
      if (t.dataset.option === 'tva') q('[data-zone="tva"]').hidden = !t.checked;
      changement();
    }
    if (t.dataset.champBool) { s.r[t.dataset.champBool] = t.checked; changement(); }
  });

  function majCouleurs() {
    ['couleur', 'accent'].forEach((cible) => {
      conteneur.querySelectorAll(`[data-${cible}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[cible] === s.r[cible])));
      const code = q(`[data-couleur-code="${cible}"]`);
      if (code && document.activeElement !== code) code.value = s.r[cible];
      const choix = q(`[data-couleur-choix="${cible}"]`);
      if (choix) choix.value = s.r[cible];
    });
    const z = q('[data-zone="contraste"]');
    if (z) z.textContent = texteContraste();
  }

  conteneur.addEventListener('click', async (e) => {
    if (!s.r) return;
    const modele = e.target.closest('[data-modele]');
    if (modele) { s.r.modele = modele.dataset.modele; render(); return; }
    const couleur = e.target.closest('[data-couleur]');
    if (couleur) { s.r.couleur = couleur.dataset.couleur; majCouleurs(); changement(); return; }
    const accent = e.target.closest('[data-accent]');
    if (accent) { s.r.accent = accent.dataset.accent; majCouleurs(); changement(); return; }
    const format = e.target.closest('[data-format]');
    if (format) {
      s.r.format_defaut = format.dataset.format;
      conteneur.querySelectorAll('[data-format]').forEach((b) => b.classList.toggle('actif', b === format));
      changement(); return;
    }
    const apercu = e.target.closest('[data-apercu]');
    if (apercu) {
      s.apercu = apercu.dataset.apercu;
      conteneur.querySelectorAll('[data-apercu]').forEach((b) => b.classList.toggle('actif', b === apercu));
      majApercu(); return;
    }
    const logo = e.target.closest('[data-action="logo"]');
    if (logo) { modifierLogo({ nom: s.r.nom_affiche || boutique.nom, apres: () => render() }); return; }
    const image = e.target.closest('[data-image]');
    if (image) { preparerImage(image.dataset.image); return; }
    const suppr = e.target.closest('[data-supprimer]');
    if (suppr) { await supprimerImage(suppr.dataset.supprimer); return; }
    if (e.target.closest('[data-action="enregistrer"]')) { await enregistrer(e.target.closest('[data-action="enregistrer"]')); return; }
    if (e.target.closest('[data-action="essai"]')) {
      try { sessionStorage.setItem('yb_document_essai', JSON.stringify(s.r)); } catch { /* essai avec les réglages enregistrés */ }
      ouvrirDocument({ type: typeVente(s.r), essai: true, retour: '#/documents' });
    }
  });

  /** Cachet ou signature : outil d'image (fond blanc retiré, PNG transparent) → bucket privé « documents ». */
  function preparerImage(cle) {
    ouvrirOutilImage({
      usage: cle,
      contexte: { nom: boutique.nom },
      enregistrer: async ({ grande }) => {
        const chemin = await envoyerImageDocument(cle, grande);
        await enregistrerChamps({ [`${cle}_path`]: chemin });
        s.signatures = await imagesSignature({ ...s.r, cachet_vendeurs: true });
        toast(`${cle === 'cachet' ? 'Cachet' : 'Signature'} enregistré${cle === 'cachet' ? '' : 'e'} (${Math.round(grande.blob.size / 1024)} Ko).`, 'succes');
        render();
      }
    });
  }

  async function supprimerImage(cle) {
    const ok = await confirmer(`Supprimer ${cle === 'cachet' ? 'le cachet' : 'la signature'} des documents ?`, { titre: 'Supprimer', libelleOk: 'Supprimer', danger: true });
    if (!ok) return;
    try {
      const chemin = s.r[`${cle}_path`];
      await enregistrerChamps({ [`${cle}_path`]: null });
      await supprimerImageDocument(chemin);
      s.signatures = await imagesSignature({ ...s.r, cachet_vendeurs: true });
      toast('Supprimé.', 'succes');
      render();
    } catch (err) {
      toast(messageErreur(err), 'erreur');
    }
  }

  /** Enregistre quelques colonnes tout de suite (cachet, signature) sans toucher au brouillon. */
  async function enregistrerChamps(valeurs) {
    const { error } = await sb.from('boutique_documents').update(valeurs).eq('boutique_id', boutique.id);
    if (error) throw error;
    Object.assign(s.r, valeurs);
    const initial = JSON.parse(s.initial);
    Object.assign(initial, valeurs);
    s.initial = JSON.stringify(initial);
    oublierReglages(boutique.id);
  }

  async function enregistrer(bouton) {
    const r = s.r;
    const valeurs = {
      modele: r.modele, couleur: r.couleur, accent: r.accent, titre_vente: r.titre_vente, format_defaut: r.format_defaut,
      prefixes: r.prefixes, options: r.options, cachet_vendeurs: Boolean(r.cachet_vendeurs),
      tva_taux: Math.min(50, Math.max(0, Number(r.tva_taux) || 0)),
      validite_proforma: Math.min(365, Math.max(1, Math.round(Number(r.validite_proforma) || 15)))
    };
    CHAMPS_TEXTE.forEach((k) => { valeurs[k] = String(r[k] || '').trim() || null; });
    boutonOccupe(bouton, true, 'Enregistrement…');
    try {
      const { error } = await sb.from('boutique_documents').update(valeurs).eq('boutique_id', boutique.id);
      if (error) throw error;
      oublierReglages(boutique.id);
      s.r = normaliserReglages({ ...s.r, ...valeurs });
      s.initial = JSON.stringify(s.r);
      boutonOccupe(bouton, false);
      toast('Réglages des documents enregistrés.', 'succes');
      majBoutons();
    } catch (err) {
      boutonOccupe(bouton, false);
      toast(messageErreur(err), 'erreur', 6000);
    }
  }

  window.addEventListener('resize', ajusterApercu);
  charger();
  return () => window.removeEventListener('resize', ajusterApercu);
}
