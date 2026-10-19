/**
 * boutique-en-ligne.js — Ma boutique en ligne (maquette BoutiqueReglages.dc.html), gérant / propriétaire.
 *
 *  - activation, adresse (slug vérifié en direct), partage du lien, affiche QR imprimable (A4 / A5) ;
 *  - présentation : WhatsApp, horaires, message d'accueil, bandeau ;
 *  - retrait et zones de livraison (écriture directe dans zones_livraison) ;
 *  - articles visibles en ligne (produits.en_ligne) ;
 *  - chiffres du mois (stats_boutique_en_ligne).
 */
import { sb } from './supabase.js';
import { etat } from './state.js';
import { svgQr } from './qr.js';
import { vignetteProduit } from './images/affichage.js';
import {
  esc, icone, toast, confirmer, ouvrirModale, boutonOccupe, messageErreur, differer, copierTexte, formatNombre, formatGNF,
  formatTelephone, normaliserTelephone, formaterSaisieMontant, lireNombre, dateISO, promoActive, prixApplique,
  lienBoutique, lienCourtBoutique, logoSymbole, imagesPretes
} from './utils.js';

const JOURS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mer'], [4, 'Jeu'], [5, 'Ven'], [6, 'Sam'], [7, 'Dim']];
const FILTRES = [['tous', 'Tous'], ['en_ligne', 'En ligne'], ['masques', 'Masqués'], ['sans_photo', 'Sans photo']];

/** « Diallo Matériaux » → « diallo-materiaux » (règle serveur : a-z 0-9 -, 3 à 40 caractères). */
export function proposerSlug(nom) {
  return String(nom || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'ma-boutique';
}
const heure = (h) => String(h || '').slice(0, 5);
const premiere = (r) => (Array.isArray(r) ? r[0] : r) || null;

function dispoArticle(p) {
  if (p.sur_commande) return { texte: 'Sur commande', classe: 'texte-alerte' };
  if ((Number(p.stock) || 0) <= 0) return { texte: 'Épuisé', classe: 'texte-danger' };
  return { texte: 'Disponible', classe: 'texte-succes' };
}

export function afficherBoutiqueEnLigne(conteneur) {
  const boutique = etat.boutique;
  const s = { reglages: null, zones: [], produits: [], filtre: 'tous', jetonSlug: 0, slugOk: true, stats: null };

  conteneur.innerHTML = `
    <div class="page page-boutique-en-ligne">
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour" href="#/commandes">← Commandes en ligne</a>
          <h1>Ma boutique en ligne</h1>
          <span>Vos clients commandent depuis leur téléphone, vous recevez la commande ici et sur WhatsApp.</span>
        </div>
      </header>
      <div class="ben-corps">
        <div class="ben-principal" data-zone="principal">
          <section class="carte ben-section"><span class="squelette" style="height:20px;width:50%"></span><span class="squelette" style="height:48px;margin-top:12px"></span></section>
        </div>
        <aside class="ben-cote" data-zone="cote"></aside>
      </div>
    </div>`;
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);
  const q = (sel) => conteneur.querySelector(sel);

  /* ------------------------------------------------------------ Gabarit */

  function render() {
    const r = s.reglages;
    zone('principal').innerHTML = `
      <section class="carte ben-section">
        <div class="ben-activation">
          <div class="ben-activation-textes">
            <h2>Boutique en ligne ${r.actif ? 'activée' : 'fermée'}</h2>
            <span class="discret">${r.actif
              ? 'Désactivez-la pendant un inventaire ou une fermeture : la page affichera « Fermée temporairement ».'
              : 'Activez-la pour que vos clients puissent commander. Vérifiez d’abord l’adresse et le numéro WhatsApp.'}</span>
          </div>
          <button type="button" class="interrupteur interrupteur-grand" role="switch" aria-checked="${Boolean(r.actif)}" data-action="activer" aria-label="Boutique en ligne activée"><span></span></button>
        </div>
        <div class="champ">
          <label for="ben-slug">Adresse de votre boutique</label>
          <div class="champ-slug">
            <span class="slug-prefixe">…/youmma-business/b/</span>
            <input id="ben-slug" type="text" value="${esc(r.slug || '')}" maxlength="40" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="url">
            <span class="slug-etat" data-ref="slug-etat" aria-live="polite"></span>
          </div>
          <button type="button" class="btn-lien btn-lien-gauche" data-action="proposer-slug">Proposer depuis le nom (${esc(proposerSlug(boutique.nom))})</button>
        </div>
        <div class="ben-partage">
          <button type="button" class="btn btn-whatsapp" data-action="partager">${icone('whatsapp', 18, 2)} Partager sur WhatsApp</button>
          <button type="button" class="btn btn-secondaire" data-action="copier">${icone('copier', 18, 2)} Copier le lien</button>
          <a class="btn btn-secondaire" data-ref="ouvrir" href="${esc(lienBoutique(r.slug || ''))}" target="_blank" rel="noopener">${icone('enLigne', 18, 2)} Ouvrir ma boutique</a>
          <button type="button" class="btn btn-secondaire" data-action="imprimer-qr">${icone('qr', 18, 2)} Imprimer l’affiche QR code</button>
        </div>
      </section>

      <section class="carte ben-section">
        <h2>Présentation</h2>
        <div class="rangee-champs">
          <div class="champ"><label for="ben-wa">Numéro WhatsApp qui reçoit les commandes</label>
            <input id="ben-wa" class="input" type="tel" inputmode="tel" placeholder="620 00 00 01" value="${esc(r.whatsapp ? formatTelephone(r.whatsapp).replace(/^\+224\s*/, '') : '')}"></div>
          <div class="champ"><span class="etiquette">Horaires (heure de Conakry)</span>
            <div class="ben-horaires">
              <label class="sr-only" for="ben-ouverture">Ouverture</label><input id="ben-ouverture" class="input" type="time" value="${esc(heure(r.ouverture))}">
              <span aria-hidden="true">–</span>
              <label class="sr-only" for="ben-fermeture">Fermeture</label><input id="ben-fermeture" class="input" type="time" value="${esc(heure(r.fermeture))}">
            </div></div>
        </div>
        <fieldset class="ben-jours">
          <legend class="etiquette">Jours d’ouverture</legend>
          ${JOURS.map(([n, l]) => `<label class="puce-jour"><input type="checkbox" name="jour" value="${n}" ${(r.jours || []).map(Number).includes(n) ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        </fieldset>
        <div class="champ"><label for="ben-message">Message d’accueil</label>
          <textarea id="ben-message" class="input" rows="3" maxlength="300" placeholder="Ex. Ciment, fer, tôles… Commandez ici, on vous rappelle pour confirmer.">${esc(r.message || '')}</textarea></div>
        <div class="champ"><label for="ben-bandeau">Bandeau promo (facultatif)</label>
          <input id="ben-bandeau" class="input" type="text" maxlength="120" placeholder="Ex. Ciment à 82 000 le sac jusqu’à samedi" value="${esc(r.bandeau || '')}"></div>
        <label class="case-option"><input type="checkbox" id="ben-retrait" ${r.retrait ? 'checked' : ''}> Retrait en boutique possible</label>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="ben-enregistrer"><button type="button" class="btn btn-primaire" data-action="enregistrer">Enregistrer</button></div>
      </section>

      <section class="carte ben-section">
        <div class="bloc-entete"><h2>Zones de livraison</h2><span class="discret">Frais ajoutés au total de la commande</span></div>
        <ul class="liste-zones" data-zone="zones"></ul>
        <button type="button" class="btn-ajout-pointille" data-action="ajouter-zone">+ Ajouter une zone</button>
        <label class="case-option"><input type="checkbox" data-action="zones-inactives"> Afficher les zones désactivées</label>
      </section>

      <section class="carte ben-section">
        <div class="bloc-entete">
          <div class="bloc-titres"><h2>Articles en ligne</h2><span class="discret" data-ref="resume-articles"></span></div>
          <div class="ben-tout">
            <button type="button" class="btn btn-secondaire btn-petit" data-action="tout-afficher">Tout afficher</button>
            <button type="button" class="btn btn-secondaire btn-petit" data-action="tout-masquer">Tout masquer</button>
          </div>
        </div>
        <div class="segments segments-cadre" role="group" aria-label="Filtre">
          ${FILTRES.map(([c, l]) => `<button type="button" class="segment ${c === s.filtre ? 'actif' : ''}" data-filtre="${c}" aria-pressed="${c === s.filtre}">${l}</button>`).join('')}
        </div>
        <ul class="liste-articles-en-ligne" data-zone="articles"></ul>
      </section>`;
    renderZones();
    renderArticles();
    renderCote();
    majEtatSlug(r.slug, true);
  }

  function renderCote(stats = s.stats) {
    const r = s.reglages;
    const slug = q('#ben-slug')?.value.trim() || r.slug || '';
    const zonesActives = s.zones.filter((z) => z.actif).map((z) => z.nom);
    zone('cote').innerHTML = `
      <section class="carte-affiche-qr">
        <span class="caq-surtitre">AFFICHE À COLLER EN BOUTIQUE</span>
        <span class="caq-titre">Commandez chez<br>${esc(boutique.nom)}</span>
        <span class="caq-qr">${svgQr(lienBoutique(slug), { titre: `QR code de ${lienBoutique(slug)}` })}</span>
        <span class="caq-texte">Scannez avec l’appareil photo${zonesActives.length ? `<br>Livraison à ${esc(zonesActives.slice(0, 3).join(', '))}` : ''}</span>
        <span class="caq-lien">${esc(lienCourtBoutique(slug))}</span>
      </section>
      <section class="carte ben-section ben-stats">
        <h2>Ce mois-ci</h2>
        <div class="recap-ligne-clair"><span>Visites de la boutique</span><strong data-ref="st-visites">${stats ? formatNombre(stats.visites || 0) : '…'}</strong></div>
        <div class="recap-ligne-clair"><span>Commandes reçues</span><strong data-ref="st-commandes">${stats ? formatNombre(stats.commandes || 0) : '…'}</strong></div>
        <div class="recap-ligne-clair"><span>Livrées et encaissées</span><strong data-ref="st-livrees">${stats ? `${formatNombre(stats.livrees || 0)} · ${formatGNF(stats.montant_livre || 0)}` : '…'}</strong></div>
        ${stats && stats.a_traiter ? `<a class="btn btn-secondaire btn-petit" href="#/commandes">${formatNombre(stats.a_traiter)} commande${stats.a_traiter > 1 ? 's' : ''} à traiter</a>` : ''}
      </section>`;
  }

  function renderZones() {
    const voirInactives = q('[data-action="zones-inactives"]')?.checked;
    const liste = s.zones.filter((z) => z.actif || voirInactives);
    zone('zones').innerHTML = liste.length ? liste.map((z, i) => `
      <li class="ligne-zone ${z.actif ? '' : 'inactive'}">
        <span class="zone-ordre">
          <button type="button" class="btn-icone-petit" data-monter="${esc(z.id)}" aria-label="Monter ${esc(z.nom)}" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="btn-icone-petit" data-descendre="${esc(z.id)}" aria-label="Descendre ${esc(z.nom)}" ${i === liste.length - 1 ? 'disabled' : ''}>▼</button>
        </span>
        <span class="zone-nom gras">${esc(z.nom)}${z.actif ? '' : ' <span class="discret">(désactivée)</span>'}</span>
        <span class="zone-frais gras">${Number(z.frais) ? formatGNF(z.frais) : 'Gratuit'}</span>
        <button type="button" class="btn btn-secondaire btn-petit" data-modifier-zone="${esc(z.id)}">Modifier</button>
        <button type="button" class="btn-lien ${z.actif ? 'btn-lien-danger' : ''}" data-activer-zone="${esc(z.id)}">${z.actif ? 'Désactiver' : 'Réactiver'}</button>
      </li>`).join('') : '<li class="discret">Aucune zone : seuls les retraits en boutique sont possibles.</li>';
  }

  function articlesFiltres() {
    return s.produits.filter((p) => s.filtre === 'tous' || (s.filtre === 'en_ligne' && p.en_ligne !== false)
      || (s.filtre === 'masques' && p.en_ligne === false) || (s.filtre === 'sans_photo' && !p.photo_url));
  }

  function renderArticles() {
    const visibles = s.produits.filter((p) => p.en_ligne !== false).length;
    q('[data-ref="resume-articles"]').textContent = `${visibles} sur ${s.produits.length} visibles · prix de détail affiché · le stock exact n’est jamais montré`;
    const liste = articlesFiltres();
    zone('articles').innerHTML = liste.length ? liste.map((p) => {
      const d = dispoArticle(p);
      const promo = promoActive(p);
      return `
        <li class="ligne-article-en-ligne">
          <span class="vignette-mini">${vignetteProduit(p, 44, icone('image', 18, 1.8))}</span>
          <span class="aol-textes">
            <span class="gras">${esc(p.nom)}</span>
            <span class="discret">${promo ? `<s>${formatNombre(p.prix_detail)}</s> ` : ''}${formatGNF(prixApplique(p))}${promo ? ' <span class="badge-promo">Promo</span>' : ''} · <span class="gras ${d.classe}">${d.texte}</span></span>
          </span>
          ${p.photo_url ? '' : '<span class="badge-sans-photo">Sans photo</span>'}
          <button type="button" class="interrupteur interrupteur-bleu" role="switch" aria-checked="${p.en_ligne !== false}" data-en-ligne="${esc(p.id)}" aria-label="${esc(p.nom)} visible en ligne"><span></span></button>
        </li>`;
    }).join('') : '<li class="discret">Aucun article dans ce filtre.</li>';
  }

  /* ------------------------------------------------------------ Adresse (slug) */

  function majEtatSlug(texte, initial = false) {
    const el = q('[data-ref="slug-etat"]');
    if (!el) return;
    if (initial || texte === s.reglages.slug) { el.textContent = s.reglages.slug ? 'Votre adresse' : ''; el.className = 'slug-etat ok'; s.slugOk = true; return; }
    el.textContent = '…';
    el.className = 'slug-etat';
    verifierSlug(texte);
  }

  const verifierSlug = differer(async (texte) => {
    const jeton = ++s.jetonSlug;
    const el = q('[data-ref="slug-etat"]');
    if (!/^[a-z0-9-]{3,40}$/.test(texte)) { s.slugOk = false; el.textContent = 'Invalide'; el.className = 'slug-etat erreur'; return; }
    const { data, error } = await sb.rpc('verifier_slug', { p_boutique: boutique.id, p_slug: texte });
    if (jeton !== s.jetonSlug || !el.isConnected) return;
    const r = premiere(data) || {};
    if (error) { el.textContent = '?'; el.className = 'slug-etat'; return; }
    s.slugOk = Boolean(r.valide && r.disponible);
    el.textContent = !r.valide ? 'Invalide' : r.disponible ? 'Disponible' : 'Déjà prise';
    el.className = `slug-etat ${s.slugOk ? 'ok' : 'erreur'}`;
  }, 400);

  /* ------------------------------------------------------------ Enregistrement */

  function lireFormulaire() {
    const jours = [...conteneur.querySelectorAll('[name="jour"]:checked')].map((c) => Number(c.value));
    const waSaisi = q('#ben-wa').value.trim();
    return {
      slug: q('#ben-slug').value.trim(),
      whatsapp: waSaisi ? normaliserTelephone(waSaisi) : null,
      whatsappSaisi: waSaisi,
      ouverture: q('#ben-ouverture').value || null,
      fermeture: q('#ben-fermeture').value || null,
      jours,
      message: q('#ben-message').value.trim() || null,
      bandeau: q('#ben-bandeau').value.trim() || null,
      retrait: q('#ben-retrait').checked
    };
  }

  async function enregistrer({ actif = s.reglages.actif, bouton = null, silencieux = false } = {}) {
    const f = lireFormulaire();
    const zoneErreur = q('.ben-section .erreur-form');
    const erreur = (m) => { zoneErreur.textContent = m; zoneErreur.hidden = !m; if (m) zoneErreur.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    if (!/^[a-z0-9-]{3,40}$/.test(f.slug)) { erreur('Adresse : lettres sans accents, chiffres et tirets, 3 à 40 caractères.'); return false; }
    if (!s.slugOk) { erreur('Cette adresse n’est pas disponible : choisissez-en une autre.'); return false; }
    if (f.whatsappSaisi && !f.whatsapp) { erreur('Numéro WhatsApp invalide. Exemple : 620 00 00 01.'); return false; }
    if (actif && !f.whatsapp) { erreur('Indiquez le numéro WhatsApp qui reçoit les commandes avant d’activer la boutique.'); return false; }
    if ((f.ouverture && !f.fermeture) || (!f.ouverture && f.fermeture) || (f.ouverture && f.fermeture && f.ouverture >= f.fermeture)) {
      erreur('Horaires invalides : l’heure de fermeture doit être après l’ouverture.'); return false;
    }
    if (!f.jours.length) { erreur('Cochez au moins un jour d’ouverture.'); return false; }
    if (actif && !f.retrait && !s.zones.some((z) => z.actif)) { erreur('Proposez le retrait en boutique ou au moins une zone de livraison.'); return false; }
    erreur('');
    if (bouton) boutonOccupe(bouton, true, 'Enregistrement…');
    const { error } = await sb.rpc('modifier_boutique_en_ligne', {
      p_boutique: boutique.id, p_actif: actif, p_slug: f.slug, p_whatsapp: f.whatsapp, p_ouverture: f.ouverture, p_fermeture: f.fermeture,
      p_jours: f.jours, p_message: f.message, p_bandeau: f.bandeau, p_retrait: f.retrait
    });
    if (bouton) boutonOccupe(bouton, false);
    if (error) { erreur(messageErreur(error)); return false; }
    Object.assign(s.reglages, { actif, slug: f.slug, whatsapp: f.whatsapp, ouverture: f.ouverture, fermeture: f.fermeture, jours: f.jours, message: f.message, bandeau: f.bandeau, retrait: f.retrait });
    if (!silencieux) toast('Boutique en ligne enregistrée.', 'succes');
    return true;
  }

  async function basculerActivation() {
    const actif = !s.reglages.actif;
    if (await enregistrer({ actif, silencieux: true })) {
      toast(actif ? 'Boutique en ligne activée : partagez le lien à vos clients.' : 'Boutique en ligne fermée temporairement.', 'succes');
      render();
    }
  }

  /* ------------------------------------------------------------ Zones */

  function ouvrirZone(zoneLivraison = null) {
    const { el, fermer } = ouvrirModale({
      titre: zoneLivraison ? 'Modifier la zone' : 'Ajouter une zone de livraison',
      contenu: `
        <form class="form-modale" novalidate>
          <div class="champ"><label for="zone-nom">Nom de la zone</label><input id="zone-nom" name="nom" class="input" type="text" maxlength="60" placeholder="Ex. Kagbélen" value="${esc(zoneLivraison?.nom || '')}" required></div>
          <div class="champ"><label for="zone-frais">Frais de livraison (GNF)</label><input id="zone-frais" name="frais" class="input input-montant" type="text" inputmode="numeric" placeholder="0 = gratuit" value="${zoneLivraison ? formatNombre(zoneLivraison.frais) : ''}"></div>
          <p class="erreur-form" role="alert" hidden></p>
          <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
        </form>`
    });
    const form = el.querySelector('form');
    form.frais.addEventListener('input', () => formaterSaisieMontant(form.frais));
    form.nom.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nom = form.nom.value.trim();
      const frais = lireNombre(form.frais.value) ?? 0;
      const zoneErreur = el.querySelector('.erreur-form');
      if (!nom) { zoneErreur.textContent = 'Indiquez le nom de la zone.'; zoneErreur.hidden = false; return; }
      if (frais < 0) { zoneErreur.textContent = 'Frais invalides.'; zoneErreur.hidden = false; return; }
      const bouton = form.querySelector('[type="submit"]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      const { error } = zoneLivraison
        ? await sb.from('zones_livraison').update({ nom, frais: Math.round(frais) }).eq('id', zoneLivraison.id)
        : await sb.from('zones_livraison').insert({ boutique_id: boutique.id, nom, frais: Math.round(frais), ordre: (Math.max(0, ...s.zones.map((z) => Number(z.ordre) || 0)) + 1), actif: true });
      boutonOccupe(bouton, false);
      if (error) { zoneErreur.textContent = messageErreur(error); zoneErreur.hidden = false; return; }
      fermer();
      toast(zoneLivraison ? 'Zone modifiée.' : `Zone « ${nom} » ajoutée.`, 'succes');
      await chargerZones();
    });
  }

  async function chargerZones() {
    const { data, error } = await sb.from('zones_livraison').select('id, nom, frais, ordre, actif').eq('boutique_id', boutique.id).order('ordre').order('nom');
    if (error) { toast(messageErreur(error), 'erreur'); return; }
    s.zones = data;
    renderZones();
    renderCote();
  }

  async function deplacerZone(id, sens) {
    const liste = s.zones.filter((z) => z.actif || q('[data-action="zones-inactives"]')?.checked);
    const i = liste.findIndex((z) => z.id === id);
    const autre = liste[i + sens];
    if (!autre) return;
    const a = liste[i];
    // Ordres distincts garantis (les anciennes zones peuvent avoir le même ordre).
    const ordreA = Number(a.ordre) || i + 1;
    let ordreB = Number(autre.ordre) || i + 1 + sens;
    if (ordreA === ordreB) ordreB = ordreA + sens;
    const [r1, r2] = await Promise.all([
      sb.from('zones_livraison').update({ ordre: ordreB }).eq('id', a.id),
      sb.from('zones_livraison').update({ ordre: ordreA }).eq('id', autre.id)
    ]);
    if (r1.error || r2.error) { toast(messageErreur(r1.error || r2.error), 'erreur'); return; }
    await chargerZones();
  }

  async function activerZone(id) {
    const z = s.zones.find((x) => x.id === id);
    const { error } = await sb.from('zones_livraison').update({ actif: !z.actif }).eq('id', id);
    if (error) { toast(messageErreur(error), 'erreur'); return; }
    toast(z.actif ? `Zone « ${z.nom} » désactivée.` : `Zone « ${z.nom} » réactivée.`, 'succes');
    await chargerZones();
  }

  /* ------------------------------------------------------------ Articles */

  async function basculerArticle(id) {
    const p = s.produits.find((x) => x.id === id);
    const enLigne = p.en_ligne === false;
    p.en_ligne = enLigne;
    renderArticles();
    const { error } = await sb.from('produits').update({ en_ligne: enLigne }).eq('id', id);
    if (error) { p.en_ligne = !enLigne; renderArticles(); toast(messageErreur(error), 'erreur'); }
  }

  async function toutBasculer(enLigne) {
    const n = s.produits.filter((p) => (p.en_ligne !== false) !== enLigne).length;
    if (!n) { toast(enLigne ? 'Tous les articles sont déjà en ligne.' : 'Tous les articles sont déjà masqués.', 'info'); return; }
    if (!(await confirmer(`${enLigne ? 'Afficher' : 'Masquer'} ${n} article${n > 1 ? 's' : ''} sur votre boutique en ligne ?`,
      { titre: enLigne ? 'Tout afficher' : 'Tout masquer', libelleOk: enLigne ? 'Tout afficher' : 'Tout masquer', danger: !enLigne }))) return;
    const { error } = await sb.from('produits').update({ en_ligne: enLigne }).eq('boutique_id', boutique.id).eq('actif', true);
    if (error) { toast(messageErreur(error), 'erreur'); return; }
    s.produits.forEach((p) => { p.en_ligne = enLigne; });
    renderArticles();
    toast(enLigne ? 'Tous les articles sont visibles en ligne.' : 'Tous les articles sont masqués.', 'succes');
  }

  /* ------------------------------------------------------------ Partage et affiche QR */

  const slugCourant = () => q('#ben-slug').value.trim() || s.reglages.slug;
  function texteInvitation() {
    const zones = s.zones.filter((z) => z.actif).map((z) => z.nom);
    return `Commandez chez ${boutique.nom} directement en ligne : ${lienBoutique(slugCourant())}\n`
      + `${zones.length ? `Livraison : ${zones.join(', ')}. ` : ''}${s.reglages.retrait ? 'Retrait en boutique possible. ' : ''}Paiement à la livraison ou au retrait.`;
  }

  function imprimerQr() {
    const { el, fermer } = ouvrirModale({
      titre: 'Imprimer l’affiche QR code',
      contenu: `
        <p class="texte-modale">Collez-la à la caisse ou sur la vitrine : vos clients scannent le code avec l’appareil photo de leur téléphone.</p>
        <div class="segments segments-cadre" role="group" aria-label="Format">
          <button type="button" class="segment actif" data-format="a4" aria-pressed="true">A4</button>
          <button type="button" class="segment" data-format="a5" aria-pressed="false">A5</button>
        </div>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="button" class="btn btn-primaire" data-action="lancer">${icone('imprimante', 18, 2)} Imprimer</button></div>`
    });
    let format = 'a4';
    el.addEventListener('click', (e) => {
      const f = e.target.closest('[data-format]');
      if (f) { format = f.dataset.format; el.querySelectorAll('[data-format]').forEach((b) => { b.classList.toggle('actif', b === f); b.setAttribute('aria-pressed', String(b === f)); }); }
      if (e.target.closest('[data-action="lancer"]')) { fermer(); lancerImpressionQr(format); }
    });
  }

  async function lancerImpressionQr(format) {
    const slug = slugCourant();
    const zone = document.getElementById('recu');
    zone.className = `affiche-qr-impression format-${format}`;
    zone.innerHTML = `
      <div class="aqi-page">
        <div class="aqi-marque">${logoSymbole(40)}<span>YOUMMA Business</span></div>
        <p class="aqi-nom">${esc(boutique.nom)}</p>
        <p class="aqi-titre">Commandez en ligne</p>
        <p class="aqi-sous">Scannez avec l’appareil photo de votre téléphone</p>
        <div class="aqi-qr">${svgQr(lienBoutique(slug))}</div>
        <p class="aqi-lien">${esc(lienCourtBoutique(slug))}</p>
        ${s.reglages.whatsapp ? `<p class="aqi-wa">WhatsApp ${esc(formatTelephone(s.reglages.whatsapp))}</p>` : ''}
        <p class="aqi-pied">Retrait ou livraison · paiement à la réception</p>
      </div>`;
    document.body.classList.add('impression-affiche-qr');
    const retirer = () => { document.body.classList.remove('impression-affiche-qr'); zone.className = ''; window.removeEventListener('afterprint', retirer); };
    window.addEventListener('afterprint', retirer);
    await imagesPretes(zone);
    window.print();
    setTimeout(retirer, 1500);
  }

  /* ------------------------------------------------------------ Chargement */

  async function chargerStats() {
    const debut = dateISO().slice(0, 8) + '01';
    const { data } = await sb.rpc('stats_boutique_en_ligne', { p_boutique: boutique.id, p_debut: debut, p_fin: dateISO() });
    if (!conteneur.isConnected) return;
    s.stats = premiere(data) || {};
    renderCote();
  }

  async function charger() {
    const [reglages, zones, produits] = await Promise.all([
      sb.rpc('obtenir_boutique_en_ligne', { p_boutique: boutique.id }),
      sb.from('zones_livraison').select('id, nom, frais, ordre, actif').eq('boutique_id', boutique.id).order('ordre').order('nom'),
      sb.from('produits').select('id, nom, unite, prix_detail, prix_gros, prix_promo, promo_fin, stock, sur_commande, en_ligne, photo_url, photo_mini_url')
        .eq('boutique_id', boutique.id).eq('actif', true).order('nom')
    ]);
    if (!conteneur.isConnected) return;
    const erreur = reglages.error || zones.error || produits.error;
    if (erreur) { zone('principal').innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(erreur))}</p>`; return; }
    s.reglages = premiere(reglages.data) || {};
    if (!s.reglages.slug) s.reglages.slug = proposerSlug(boutique.nom);
    if (!Array.isArray(s.reglages.jours) || !s.reglages.jours.length) s.reglages.jours = [1, 2, 3, 4, 5, 6];
    s.zones = zones.data;
    s.produits = produits.data;
    render();
    chargerStats();
  }

  /* ------------------------------------------------------------ Évènements */

  conteneur.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    const bouton = e.target.closest('button');
    if (action === 'activer') { basculerActivation(); return; }
    if (action === 'enregistrer') { enregistrer({ bouton }); return; }
    if (action === 'proposer-slug') { q('#ben-slug').value = proposerSlug(boutique.nom); majEtatSlug(q('#ben-slug').value); return; }
    if (action === 'partager') { window.open(`https://wa.me/?text=${encodeURIComponent(texteInvitation())}`, '_blank', 'noopener'); return; }
    if (action === 'copier') { const ok = await copierTexte(lienBoutique(slugCourant())); toast(ok ? 'Lien copié.' : 'Copie impossible : sélectionnez le lien à la main.', ok ? 'succes' : 'erreur'); return; }
    if (action === 'imprimer-qr') { imprimerQr(); return; }
    if (action === 'ajouter-zone') { ouvrirZone(); return; }
    if (action === 'tout-afficher') { toutBasculer(true); return; }
    if (action === 'tout-masquer') { toutBasculer(false); return; }
    const modifierZone = e.target.closest('[data-modifier-zone]');
    if (modifierZone) { ouvrirZone(s.zones.find((z) => z.id === modifierZone.dataset.modifierZone)); return; }
    const activer = e.target.closest('[data-activer-zone]');
    if (activer) { activerZone(activer.dataset.activerZone); return; }
    const monter = e.target.closest('[data-monter]');
    if (monter) { deplacerZone(monter.dataset.monter, -1); return; }
    const descendre = e.target.closest('[data-descendre]');
    if (descendre) { deplacerZone(descendre.dataset.descendre, 1); return; }
    const article = e.target.closest('[data-en-ligne]');
    if (article) { basculerArticle(article.dataset.enLigne); return; }
    const filtre = e.target.closest('[data-filtre]');
    if (filtre) {
      s.filtre = filtre.dataset.filtre;
      conteneur.querySelectorAll('[data-filtre]').forEach((b) => { b.classList.toggle('actif', b === filtre); b.setAttribute('aria-pressed', String(b === filtre)); });
      renderArticles();
    }
  });
  conteneur.addEventListener('input', (e) => {
    if (e.target.id === 'ben-slug') {
      const propre = e.target.value.toLowerCase().replace(/\s+/g, '-');
      if (propre !== e.target.value) e.target.value = propre;
      majEtatSlug(propre);
      q('[data-ref="ouvrir"]').href = lienBoutique(propre || s.reglages.slug);
      renderCote();
    }
  });
  conteneur.addEventListener('change', (e) => {
    if (e.target.matches('[data-action="zones-inactives"]')) renderZones();
  });
  charger();
}
