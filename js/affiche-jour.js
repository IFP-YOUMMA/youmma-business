/**
 * affiche-jour.js — Écran « Affiche du jour » (maquettes AfficheJour.dc.html et AffichesPro.dc.html), #/affiche.
 *
 * Le serveur choisit l'article chaque matin à 6 h (affiche_du_jour) ; le gérant peut changer le modèle,
 * l'article, les 2 articles de plus de « Sélection », la phrase, la couleur et la photo (avec « Retirer
 * le fond »). L'image est dessinée dans le navigateur (affiche.js) en 3 formats ; le texte de
 * publication est copié avant le partage (Facebook ou statut WhatsApp) ou le téléchargement.
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import {
  genererAffiche, versImage, nomFichierAffiche, extensionAffiche, familleArticle, lireCouleurAffiche, ecrireCouleurAffiche,
  FORMATS_AFFICHE, LIBELLES_MODELES_AFFICHE, COULEURS_AFFICHE
} from './affiche.js';
import { choisirImage, changerPhotoArticle } from './images.js';
import { ouvrirDetourage, detourageDisponible } from './detourage.js';
import {
  esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, differer, copierTexte, formatNombre, formatDate,
  formatTelephone, capitaliser, dateISO, decalerDate, promoActive, prixApplique, lienBoutique, lienCourtBoutique,
  iconeUnite, TYPES_ACTIVITE
} from './utils.js';

const MAX_PHRASE = 80;
const premiere = (r) => (Array.isArray(r) ? r[0] : r) || null;
const telLocal = (t) => (t ? formatTelephone(t).replace(/^\+224\s*/, '') : null);

/* =========================================================================
   Données
   ========================================================================= */

/**
 * Affiche du jour (ou d'un jour passé) + tout ce qu'il faut pour la dessiner :
 * réglages de la boutique en ligne (lien, WhatsApp), zones de livraison, et pour chaque article
 * (principal + autres) : prix de gros, catégorie, fin de promo, « sur commande ».
 */
export async function chargerAfficheDuJour(jour = null) {
  const idB = etat.boutique.id;
  const [afficheRes, enLigne, zones] = await Promise.all([
    sb.rpc('affiche_du_jour', jour ? { p_boutique: idB, p_jour: jour } : { p_boutique: idB }),
    sb.from('boutiques_en_ligne').select('slug, actif, whatsapp').eq('boutique_id', idB).maybeSingle(),
    sb.from('zones_livraison').select('nom, ordre').eq('boutique_id', idB).eq('actif', true).order('ordre')
  ]);
  if (afficheRes.error) throw afficheRes.error;
  const affiche = premiere(afficheRes.data);
  const contexte = { affiche, enLigne: enLigne.data || null, zones: (zones.data || []).map((z) => z.nom), infos: new Map() };
  await completerInfos(contexte, [affiche?.produit?.id, ...(affiche?.autres || []).map((a) => a.id)]);
  return contexte;
}

/** Lit dans produits (et categories) ce que la RPC ne renvoie pas. */
async function completerInfos(contexte, ids) {
  const manquants = [...new Set(ids.filter(Boolean))].filter((id) => !contexte.infos.has(id));
  if (!manquants.length) return;
  const { data } = await sb.from('produits').select('id, prix_gros, promo_fin, prix_promo, prix_detail, sur_commande, categorie_id').in('id', manquants);
  const cats = [...new Set((data || []).map((p) => p.categorie_id).filter(Boolean))];
  const { data: categories } = cats.length ? await sb.from('categories').select('id, nom').in('id', cats) : { data: [] };
  (data || []).forEach((p) => contexte.infos.set(p.id, {
    prix_gros: p.prix_gros,
    promo_fin: promoActive(p) ? p.promo_fin : null,
    sur_commande: p.sur_commande,
    categorie: (categories || []).find((c) => c.id === p.categorie_id)?.nom || null
  }));
}

/** Données attendues par genererAffiche. contexte : résultat de chargerAfficheDuJour (ou { enLigne }). */
export function donneesAffiche(affiche, contexte = {}) {
  const ctx = contexte?.slug !== undefined ? { enLigne: contexte } : (contexte || {});
  const b = etat.boutique;
  const slug = ctx.enLigne?.slug;
  const infos = (id) => ctx.infos?.get?.(id) || {};
  const p = affiche?.produit || {};
  const ip = infos(p.id);
  return {
    boutique: { nom: b.nom, ville: b.ville, commune: b.commune, type: TYPES_ACTIVITE[b.type_activite] || '', type_activite: b.type_activite, logo_url: b.logo_url },
    produit: { ...p, prix_gros: ip.prix_gros ?? p.prix_gros, categorie: ip.categorie ?? p.categorie, promo_fin: ip.promo_fin ?? p.promo_fin, dispo: ip.sur_commande ? 'sur_commande' : p.dispo },
    autres: (affiche?.autres || []).slice(0, 2),
    modele: affiche?.modele || 'jour',
    phrase: affiche?.phrase || '',
    raison: affiche?.raison || '',
    jour: affiche?.jour || dateISO(),
    couleur: affiche?.couleur || lireCouleurAffiche(b.id),
    zones: ctx.zones || [],
    lien: slug ? lienBoutique(slug) : null,
    lienCourt: slug ? lienCourtBoutique(slug) : null,
    whatsapp: telLocal(ctx.enLigne?.whatsapp || b.telephone)
  };
}

/* =========================================================================
   Texte de publication
   ========================================================================= */

const HASHTAGS_TYPE = {
  materiaux: ['#Construction', '#MatériauxDeConstruction', '#BTP'],
  habillement: ['#Mode', '#Pagne', '#Wax'],
  alimentation: ['#Alimentation', '#Épicerie', '#Courses'],
  services: ['#Services', '#Pro'],
  general: ['#Boutique', '#BonPlan']
};
const HASHTAGS_FAMILLE = {
  sac: '#Ciment', tole: '#Toiture', barre: '#FerÀBéton', seau: '#Peinture', carreau: '#Carrelage', bois: '#Bois',
  tuyau: '#Plomberie', cable: '#Électricité', vetement: '#Mode', chaussure: '#Chaussures', carton: '#Alimentation'
};
const hashtag = (texte) => `#${String(texte || '').replace(/[^\p{L}\p{N}]+/gu, '')}`;

/**
 * Texte prêt à coller sous l'image (Facebook, statut WhatsApp) : 4 à 6 lignes, émojis sobres,
 * prix, fin de promo, livraison, lien de la boutique, WhatsApp, puis 4 à 6 hashtags sans doublon.
 * options : { lien, whatsapp }.
 */
export function texteDePublication(affiche, boutique, zones = [], options = {}) {
  const p = affiche?.produit || {};
  const nomB = boutique?.nom || 'notre boutique';
  const prix = (x) => `${formatNombre(x).replace(/ /g, ' ')} GNF`;
  const unite = p.unite ? ` / ${p.unite}` : '';
  const lignes = [];
  if (affiche?.modele === 'promo') {
    lignes.push(`🔥 PROMO chez ${nomB} : ${p.nom} à ${prix(p.prix)}${unite}${p.prix_barre ? ` au lieu de ${prix(p.prix_barre)}` : ''} !`);
    if (p.promo_fin) lignes.push(`⏳ Jusqu’au ${formatDate(`${String(p.promo_fin).slice(0, 10)}T12:00:00Z`, 'long').replace(/ \d{4}$/, '')} seulement.`);
  } else if (affiche?.modele === 'arrivage') {
    lignes.push(`🆕 Nouvel arrivage chez ${nomB} !`);
    [p, ...(affiche.autres || [])].slice(0, 3).forEach((a) => lignes.push(`• ${a.nom} : ${prix(a.prix)}${a.unite ? ` / ${a.unite}` : ''}`));
  } else {
    lignes.push(`⭐ Le choix du jour chez ${nomB} : ${p.nom}`);
    lignes.push(`👉 ${prix(p.prix)}${unite}${p.prix_barre ? ` au lieu de ${prix(p.prix_barre)}` : ''}`);
  }
  if (affiche?.phrase) lignes.push(affiche.phrase);
  lignes.push(zones.length ? `🚚 Livraison : ${zones.join(', ')} · paiement à la livraison` : '🚚 Retrait en boutique · paiement au retrait');
  if (options.lien) lignes.push(`🛒 Commandez en ligne : ${options.lien}`);
  if (options.whatsapp) lignes.push(`📲 WhatsApp : ${options.whatsapp}`);

  const tags = [];
  const ajouter = (t) => { if (t && t.length > 2 && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t); };
  if (boutique?.ville) ajouter(hashtag(boutique.ville));
  if (boutique?.commune) ajouter(hashtag(boutique.commune));
  // Hashtag de famille : seulement s'il colle au métier (un sac de riz n'est pas du #Ciment).
  const famille = familleArticle(p);
  if (famille !== 'sac' || /ciment/i.test(p.nom || '')) ajouter(HASHTAGS_FAMILLE[famille]);
  (HASHTAGS_TYPE[boutique?.type_activite] || HASHTAGS_TYPE.general).forEach(ajouter);
  if (affiche?.modele === 'promo') ajouter('#Promo');
  if (affiche?.modele === 'arrivage') ajouter('#Nouveauté');
  ajouter('#Guinée');
  ajouter('#Conakry');
  return `${lignes.join('\n')}\n\n${tags.slice(0, 6).join(' ')}`;
}

/* =========================================================================
   Partage et téléchargement
   ========================================================================= */

function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const MARCHES = {
  facebook: ['Ouvrez votre <strong>page Facebook</strong>.', 'Touchez <strong>Créer une publication</strong>, puis <strong>Photo</strong>.', 'Choisissez l’image de l’affiche dans votre galerie.', '<strong>Collez le texte</strong> (appui long → Coller), puis publiez.'],
  statut: ['Ouvrez <strong>WhatsApp</strong>.', 'Allez dans <strong>Actualités</strong> (ou « Statut »).', 'Touchez <strong>Mon statut</strong>, puis choisissez l’image de l’affiche.', 'Collez le texte en légende si vous le souhaitez, puis envoyez.']
};

function marcheASuivre(cible) {
  ouvrirModale({
    titre: 'Image téléchargée',
    contenu: `
      <p class="texte-modale">Le partage direct n’est pas possible sur cet appareil : l’affiche est dans vos téléchargements et le texte est copié.</p>
      <ol class="etapes-statut">${(MARCHES[cible] || MARCHES.statut).map((l) => `<li>${l}</li>`).join('')}</ol>
      <div class="modale-actions"><button type="button" class="btn btn-primaire" data-fermer>Compris</button></div>`
  });
}

/** Génère l'image du format demandé : { blob, nom, fichier }. */
async function imageAffiche(donnees, format) {
  const canvas = await genererAffiche(donnees, format);
  const blob = await versImage(canvas, format);
  const nom = nomFichierAffiche(donnees.boutique.nom, donnees.jour, format, extensionAffiche(format));
  const fichier = typeof File === 'function' ? new File([blob], nom, { type: blob.type }) : null;
  return { blob, nom, fichier };
}

/**
 * Publie l'affiche : copie d'abord le texte de publication, puis partage de fichier (le boutiquier
 * choisit Facebook ou WhatsApp) si possible, sinon téléchargement + marche à suivre.
 * cible : 'facebook' | 'statut'. Renvoie 'partage' | 'annule' | 'telechargement'.
 */
export async function publierAffiche(donnees, format = 'facebook', { texte = null, cible = format === 'statut' ? 'statut' : 'facebook' } = {}) {
  const legende = texte ?? texteDePublication(donnees, donnees.boutique, donnees.zones, { lien: donnees.lien, whatsapp: donnees.whatsapp });
  if (await copierTexte(legende)) toast('Texte copié — collez-le dans la publication.', 'succes', 5000);
  const { blob, nom, fichier } = await imageAffiche(donnees, format);
  if (fichier && navigator.canShare?.({ files: [fichier] })) {
    try {
      await navigator.share({ files: [fichier], text: legende });
      return 'partage';
    } catch (err) {
      if (err?.name === 'AbortError') return 'annule';
      console.warn('[YOUMMA] Partage impossible, téléchargement :', err);
    }
  }
  telecharger(blob, nom);
  marcheASuivre(cible);
  return 'telechargement';
}

export async function telechargerAffiche(donnees, format = 'facebook') {
  const { blob, nom } = await imageAffiche(donnees, format);
  telecharger(blob, nom);
}

/* =========================================================================
   Écran
   ========================================================================= */

export function afficherAfficheJour(conteneur) {
  const boutique = etat.boutique;
  const modifier = peut('affiche.modifier');
  const s = {
    ctx: null, format: 'facebook', produits: null, jeton: 0, urlApercu: null, brouillon: null,
    couleur: lireCouleurAffiche(boutique.id), texteModifie: false
  };

  conteneur.innerHTML = `
    <div class="page page-affiche">
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour" href="#/tableau-de-bord">← Tableau de bord</a>
          <h1>Affiche du jour</h1>
          <span data-ref="sous-titre">${esc(capitaliser(formatDate(new Date(), 'long')))}</span>
        </div>
      </header>
      <div class="affiche-corps">
        <div class="affiche-principal">
          <div class="segments segments-cadre formats-affiche" role="tablist" aria-label="Format">
            ${Object.entries(FORMATS_AFFICHE).map(([code, f]) => `<button type="button" role="tab" class="segment ${code === s.format ? 'actif' : ''}" data-format="${code}" aria-selected="${code === s.format}">${esc(f.libelle)}</button>`).join('')}
          </div>
          <section class="carte affiche-apercu-bloc">
            <div class="affiche-apercu" data-zone="apercu"><span class="squelette affiche-squelette"></span></div>
            <div class="affiche-pourquoi">
              <span class="discret gras">Pourquoi ce produit ?</span>
              <span data-ref="raison">…</span>
              <span class="affiche-en-ligne" data-ref="en-ligne" hidden>${icone('valide', 16, 2.4)} Déjà affichée sur votre boutique en ligne</span>
            </div>
          </section>
          <section class="carte ben-section texte-publication">
            <div class="bloc-entete"><h2>Texte de la publication</h2>
              <button type="button" class="btn btn-secondaire btn-petit" data-action="copier">${icone('copier', 16, 2)} Copier</button></div>
            <label class="sr-only" for="texte-publication">Texte de la publication</label>
            <textarea id="texte-publication" class="input" rows="8"></textarea>
            <span class="discret">Modifiable. Il est copié automatiquement quand vous partagez : collez-le sous l’image.</span>
          </section>
          ${peut('affiche.partager') ? `
            <div class="affiche-partage">
              <button type="button" class="btn btn-facebook btn-grand" data-action="facebook">${icone('partager', 20, 2)} Partager sur Facebook</button>
              <button type="button" class="btn btn-whatsapp btn-grand" data-action="statut">${icone('whatsapp', 20, 2)} Publier sur mon statut WhatsApp</button>
            </div>
            <button type="button" class="btn btn-secondaire btn-bloc" data-action="telecharger">${icone('telecharger', 18, 2)} <span>Télécharger (<span data-ref="libelle-format">${esc(FORMATS_AFFICHE[s.format].libelle)}</span>)</span></button>` : ''}
        </div>
        <div class="affiche-cote">
          ${modifier ? `
            <section class="carte ben-section" data-zone="modifier">
              <h2>Modifier l’affiche</h2>
              <div class="champ"><span class="etiquette">Modèle</span>
                <div class="choix-modele-affiche" role="group" aria-label="Modèle">
                  ${Object.entries(LIBELLES_MODELES_AFFICHE).map(([code, libelle]) => `<button type="button" class="modele-affiche ${code}" data-modele="${code}" aria-pressed="false">${esc(libelle)}</button>`).join('')}
                </div></div>
              <div class="champ"><span class="etiquette">Produit</span>
                <button type="button" class="choix-produit-affiche" data-action="changer-produit" data-rang="0"><span data-ref="nom-produit">…</span><span class="lien-changer">Changer</span></button></div>
              <div class="champ" data-zone="autres" hidden><span class="etiquette">2 articles de plus (Sélection)</span>
                ${[1, 2].map((r) => `
                  <div class="autre-article">
                    <button type="button" class="choix-produit-affiche" data-action="changer-produit" data-rang="${r}"><span data-ref="autre-${r}">Ajouter un article</span><span class="lien-changer">Choisir</span></button>
                    <button type="button" class="btn-retirer-autre" data-action="retirer-autre" data-rang="${r}" aria-label="Retirer l’article ${r}" hidden>${icone('fermer', 16, 2.4)}</button>
                  </div>`).join('')}
              </div>
              <div class="champ"><label for="phrase-affiche">Phrase</label>
                <input id="phrase-affiche" class="input" type="text" maxlength="${MAX_PHRASE}" placeholder="Ex. Jusqu’à samedi · livraison possible">
                <span class="discret compteur-phrase" data-ref="compteur-phrase"></span></div>
              <div class="champ"><span class="etiquette">Couleur de la boutique</span>
                <div class="couleurs-affiche" role="radiogroup" aria-label="Couleur">
                  ${Object.entries(COULEURS_AFFICHE).map(([code, c]) => `<button type="button" role="radio" class="pastille-couleur" data-couleur="${code}" aria-checked="${code === s.couleur}" title="${esc(c.libelle)}" aria-label="${esc(c.libelle)}" style="--c1:${c.vif[0]};--c2:${c.nuit[1]}"></button>`).join('')}
                </div></div>
              <div class="champ"><span class="etiquette">Photo du produit</span>
                <div class="photo-affiche-actions">
                  <button type="button" class="btn-ajout-pointille" data-action="photo">${icone('photo', 18, 2)} <span data-ref="libelle-photo">Prendre ou choisir une photo</span></button>
                  ${detourageDisponible() ? `<button type="button" class="btn-ajout-pointille" data-action="detourer" hidden>${icone('image', 18, 2)} Retirer le fond</button>` : ''}
                </div></div>
              <p class="erreur-form" role="alert" hidden></p>
              <div class="affiche-actions-modifier">
                <button type="button" class="btn btn-secondaire" data-action="suggestion">Autre suggestion</button>
                <button type="button" class="btn btn-primaire" data-action="enregistrer" disabled>Enregistrer</button>
              </div>
            </section>` : ''}
          <section class="carte ben-section">
            <div class="bloc-entete"><h2>Choix automatique chaque matin</h2><span class="pastille-auto">Activé</span></div>
            <p class="discret">Ordre de priorité : 1. une promo en cours · 2. un arrivage récent · 3. un article qui se vend bien · 4. un article qui dort en stock. Jamais un article épuisé, jamais deux fois dans la semaine.</p>
            <p class="discret">L’affiche est prête chaque matin à 6 h 00${modifier ? ' ; vous pouvez la modifier à tout moment' : ''}.</p>
          </section>
          <section class="affiche-historique">
            <h2>Les jours précédents</h2>
            <div class="affiche-jours" data-zone="historique"></div>
          </section>
        </div>
      </div>
    </div>`;
  const q = (sel) => conteneur.querySelector(sel);
  const ref = (nom) => q(`[data-ref="${nom}"]`);

  /** Affiche affichée = enregistrée + modifications en cours (brouillon). */
  const afficheCourante = () => {
    const a = s.ctx?.affiche || {};
    const b = s.brouillon || {};
    return { ...a, ...b, couleur: s.couleur, produit: { ...(a.produit || {}), ...(b.produit || {}) }, autres: b.autres ?? a.autres ?? [] };
  };
  const donnees = () => donneesAffiche(afficheCourante(), s.ctx);

  async function majApercu() {
    const jeton = ++s.jeton;
    const d = donnees();
    let canvas;
    try { canvas = await genererAffiche(d, s.format); } catch (err) { console.error(err); return; }
    if (jeton !== s.jeton || !conteneur.isConnected) return;
    const blob = await versImage(canvas, s.format).catch(() => null);
    if (!blob || jeton !== s.jeton) return;
    if (s.urlApercu) URL.revokeObjectURL(s.urlApercu);
    s.urlApercu = URL.createObjectURL(blob);
    q('[data-zone="apercu"]').innerHTML = `<img class="affiche-image ${s.format}" src="${s.urlApercu}" alt="${esc(`Affiche : ${d.produit.nom || ''}, ${formatNombre(d.produit.prix)} GNF`)}" width="${canvas.width}" height="${canvas.height}">`;
  }
  const majApercuDiffere = differer(majApercu, 300);

  function majTexte() {
    if (s.texteModifie) return;
    const d = donnees();
    q('#texte-publication').value = texteDePublication(d, d.boutique, d.zones, { lien: d.lien, whatsapp: d.whatsapp });
  }

  function renderInfos() {
    const a = afficheCourante();
    ref('raison').textContent = a.raison || (a.auto === false ? 'Choisi par vous.' : 'Choisi automatiquement ce matin.');
    ref('en-ligne').hidden = !s.ctx?.enLigne?.actif;
    ref('sous-titre').textContent = `${capitaliser(formatDate(new Date(), 'long'))} · ${a.auto === false ? 'modifiée par vous' : 'prête depuis 6 h 00'}`;
    majTexte();
    if (!modifier) return;
    conteneur.querySelectorAll('[data-modele]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modele === a.modele)));
    conteneur.querySelectorAll('[data-couleur]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.couleur === s.couleur)));
    ref('nom-produit').textContent = a.produit?.nom || 'Choisir un article';
    q('[data-zone="autres"]').hidden = a.modele !== 'arrivage';
    [1, 2].forEach((r) => {
      const autre = a.autres[r - 1];
      ref(`autre-${r}`).textContent = autre ? `${autre.nom} · ${formatNombre(autre.prix)} GNF` : 'Ajouter un article';
      q(`[data-action="retirer-autre"][data-rang="${r}"]`).hidden = !autre;
    });
    const phrase = q('#phrase-affiche');
    if (document.activeElement !== phrase) phrase.value = a.phrase || '';
    ref('compteur-phrase').textContent = `${phrase.value.length} / ${MAX_PHRASE}`;
    ref('libelle-photo').textContent = a.produit?.photo_url ? 'Changer la photo' : 'Prendre ou choisir une photo';
    const detourer = q('[data-action="detourer"]');
    if (detourer) detourer.hidden = !a.produit?.photo_url || /\.png(\?|$)/i.test(a.produit.photo_url);
    q('[data-action="enregistrer"]').disabled = !s.brouillon;
  }

  async function charger() {
    try {
      const r = await chargerAfficheDuJour();
      if (!conteneur.isConnected) return;
      s.ctx = r;
    } catch (err) {
      q('[data-zone="apercu"]').innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p>`;
      return;
    }
    if (!s.ctx.affiche?.produit) {
      q('[data-zone="apercu"]').innerHTML = `<div class="fiche-vide"><p>Pas encore d’affiche : ajoutez des articles en stock${modifier ? ' ou choisissez un produit ci-contre' : ''}.</p></div>`;
      ref('raison').textContent = '—';
      if (modifier) renderInfos();
      chargerHistorique();
      return;
    }
    renderInfos();
    majApercu();
    chargerHistorique();
  }

  async function chargerHistorique() {
    const jours = Array.from({ length: 7 }, (_, i) => decalerDate(dateISO(), -(i + 1)));
    const resultats = await Promise.all(jours.map((j) => sb.rpc('affiche_du_jour', { p_boutique: boutique.id, p_jour: j }).then((r) => premiere(r.data)).catch(() => null)));
    if (!conteneur.isConnected) return;
    const zone = q('[data-zone="historique"]');
    const tuiles = resultats.map((a, i) => ({ a, jour: jours[i] })).filter(({ a }) => a?.produit);
    zone.innerHTML = tuiles.length ? tuiles.map(({ a, jour }) => `
      <button type="button" class="tuile-affiche ${esc(a.modele || 'jour')}" data-jour="${esc(jour)}" aria-label="Télécharger l’affiche du ${esc(formatDate(`${jour}T12:00:00Z`, 'long'))}">
        <span class="tuile-jour">${esc(new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${jour}T12:00:00Z`)))}</span>
        <span class="tuile-icone">${a.produit.photo_url ? `<img src="${esc(a.produit.photo_url)}" alt="" loading="lazy">` : icone(iconeUnite(a.produit.unite), 26, 1.6)}</span>
        <span class="tuile-nom">${esc(a.produit.nom)}</span>
      </button>`).join('') : '<p class="discret">Les affiches des 7 derniers jours apparaîtront ici.</p>';
    zone.onclick = async (e) => {
      const tuile = e.target.closest('[data-jour]');
      if (!tuile) return;
      const r = resultats[jours.indexOf(tuile.dataset.jour)];
      tuile.disabled = true;
      try { await telechargerAffiche({ ...donneesAffiche({ ...r, couleur: s.couleur }, s.ctx), jour: tuile.dataset.jour }, s.format); toast('Affiche téléchargée.', 'succes'); }
      catch (err) { toast(messageErreur(err), 'erreur'); }
      tuile.disabled = false;
    };
  }

  /* ---------- Modification (gérant) */

  function brouillon(champs) {
    s.brouillon = { ...(s.brouillon || {}), ...champs, produit: { ...(s.brouillon?.produit || {}), ...(champs.produit || {}) } };
    renderInfos();
    majApercuDiffere();
  }

  async function chargerProduits() {
    if (s.produits) return s.produits;
    const { data, error } = await sb.from('produits').select('id, nom, unite, photo_url, prix_detail, prix_gros, prix_promo, promo_fin, stock, sur_commande, categorie_id')
      .eq('boutique_id', boutique.id).eq('actif', true).order('nom');
    if (error) throw error;
    s.produits = data;
    return data;
  }

  const versProduitAffiche = (p) => ({
    id: p.id, nom: p.nom, unite: p.unite, photo_url: p.photo_url, prix: prixApplique(p),
    prix_barre: promoActive(p) ? Number(p.prix_detail) : null,
    dispo: p.sur_commande ? 'sur_commande' : (Number(p.stock) || 0) > 0 ? 'disponible' : 'epuise'
  });

  async function choisirProduit(rang) {
    let produits;
    try { produits = await chargerProduits(); } catch (err) { toast(messageErreur(err), 'erreur'); return; }
    const { el, fermer } = ouvrirModale({
      titre: rang ? 'Choisir un article de plus' : 'Choisir le produit de l’affiche',
      contenu: `
        <label class="recherche-entete">${icone('recherche', 18, 2)}<span class="sr-only">Rechercher un article</span>
          <input type="search" id="recherche-affiche" placeholder="Nom de l’article" autocomplete="off"></label>
        <div class="liste-clients liste-produits-affiche" data-zone="resultats"></div>`
    });
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const render = (filtre) => {
      const f = norm(filtre);
      const liste = produits.filter((p) => !f || norm(p.nom).includes(f)).slice(0, 60);
      el.querySelector('[data-zone="resultats"]').innerHTML = liste.length ? liste.map((p) => {
        const pa = versProduitAffiche(p);
        return `
          <button type="button" class="item-client" data-produit="${esc(p.id)}" ${pa.dispo === 'epuise' ? 'disabled' : ''}>
            <span class="avatar">${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="">` : icone(iconeUnite(p.unite), 18, 2)}</span>
            <span class="client-textes"><span class="gras">${esc(p.nom)}</span><span class="discret">${formatNombre(pa.prix)} GNF / ${esc(p.unite || 'unité')}${pa.prix_barre ? ' · promo' : ''}${pa.dispo === 'epuise' ? ' · épuisé' : ''}</span></span>
          </button>`;
      }).join('') : '<p class="discret">Aucun article.</p>';
    };
    render('');
    const champ = el.querySelector('#recherche-affiche');
    champ.focus();
    champ.addEventListener('input', () => render(champ.value));
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-produit]');
      if (!b) return;
      const p = produits.find((x) => x.id === b.dataset.produit);
      fermer();
      const pa = versProduitAffiche(p);
      await completerInfos(s.ctx, [p.id]);
      if (rang) {
        const autres = [...afficheCourante().autres];
        autres[rang - 1] = pa;
        brouillon({ autres: autres.filter(Boolean).slice(0, 2) });
      } else {
        brouillon({ produit: { ...pa, photo_url: p.photo_url || null }, produit_id: p.id, modele: s.brouillon?.modele || (pa.prix_barre ? 'promo' : afficheCourante().modele) });
      }
    });
  }

  function photoMiseAJour(url) {
    const a = afficheCourante();
    if (s.ctx?.affiche?.produit?.id === a.produit.id) s.ctx.affiche.produit.photo_url = url;
    if (s.brouillon?.produit) s.brouillon.produit.photo_url = url;
    const p = s.produits?.find((x) => x.id === a.produit.id);
    if (p) p.photo_url = url;
    renderInfos();
    majApercu();
  }

  async function ajouterPhoto(bouton) {
    const a = afficheCourante();
    if (!a.produit?.id) { toast('Choisissez d’abord le produit.', 'erreur'); return; }
    const fichier = await choisirImage();
    if (!fichier) return;
    const produit = { id: a.produit.id, nom: a.produit.nom, photo_url: a.produit.photo_url };
    // Le fond peut être retiré tout de suite (avant / après), sinon la photo est envoyée telle quelle.
    if (detourageDisponible()) { ouvrirDetourage(produit, { fichier, apres: ({ url }) => photoMiseAJour(url) }); return; }
    boutonOccupe(bouton, true, 'Envoi de la photo…');
    try {
      const { url, taille } = await changerPhotoArticle(produit, fichier);
      toast(`Photo ajoutée (${Math.round(taille / 1024)} Ko).`, 'succes');
      photoMiseAJour(url);
    } catch (err) {
      toast(messageErreur(err), 'erreur');
    } finally {
      boutonOccupe(bouton, false);
    }
  }

  async function enregistrer(bouton) {
    const a = afficheCourante();
    const zoneErreur = q('[data-zone="modifier"] .erreur-form');
    if (!a.produit?.id) { zoneErreur.textContent = 'Choisissez le produit.'; zoneErreur.hidden = false; return; }
    zoneErreur.hidden = true;
    boutonOccupe(bouton, true, 'Enregistrement…');
    const autres = a.modele === 'arrivage' ? a.autres.map((x) => x.id).filter((id) => id && id !== a.produit.id).slice(0, 2) : [];
    const { error } = await sb.rpc('modifier_affiche', {
      p_boutique: boutique.id, p_produit: a.produit.id, p_modele: a.modele, p_phrase: (a.phrase || '').trim() || null, p_autres: autres
    });
    boutonOccupe(bouton, false);
    if (error) { zoneErreur.textContent = messageErreur(error); zoneErreur.hidden = false; return; }
    s.brouillon = null;
    toast('Affiche enregistrée : elle est aussi visible sur votre boutique en ligne.', 'succes');
    charger();
  }

  async function autreSuggestion(bouton) {
    boutonOccupe(bouton, true, 'Recherche…');
    const { data, error } = await sb.rpc('nouvelle_suggestion_affiche', { p_boutique: boutique.id });
    boutonOccupe(bouton, false);
    if (error) { toast(messageErreur(error), 'erreur'); return; }
    s.brouillon = null;
    const nouvelle = premiere(data);
    if (nouvelle?.produit) {
      s.ctx.affiche = nouvelle;
      await completerInfos(s.ctx, [nouvelle.produit.id, ...(nouvelle.autres || []).map((x) => x.id)]);
      renderInfos(); majApercu(); toast(`Nouvelle suggestion : ${nouvelle.produit.nom}.`, 'succes');
    } else charger();
  }

  async function partager(cible, bouton) {
    if (!afficheCourante().produit?.id) { toast('Pas encore d’affiche à publier.', 'erreur'); return; }
    const format = cible === 'statut' ? 'statut' : (s.format === 'carre' ? 'carre' : 'facebook');
    boutonOccupe(bouton, true, 'Préparation…');
    try {
      const r = await publierAffiche(donnees(), format, { texte: q('#texte-publication').value, cible });
      if (r === 'partage') toast('Affiche partagée.', 'succes');
    } catch (err) { toast(messageErreur(err), 'erreur'); }
    boutonOccupe(bouton, false);
  }

  /* ---------- Évènements */

  conteneur.addEventListener('click', async (e) => {
    const format = e.target.closest('[data-format]');
    if (format) {
      s.format = format.dataset.format;
      conteneur.querySelectorAll('[data-format]').forEach((b) => { b.classList.toggle('actif', b === format); b.setAttribute('aria-selected', String(b === format)); });
      const libelle = ref('libelle-format');
      if (libelle) libelle.textContent = FORMATS_AFFICHE[s.format].libelle;
      majApercu();
      return;
    }
    const modele = e.target.closest('[data-modele]');
    if (modele) { brouillon({ modele: modele.dataset.modele }); return; }
    const couleur = e.target.closest('[data-couleur]');
    if (couleur) { s.couleur = couleur.dataset.couleur; ecrireCouleurAffiche(boutique.id, s.couleur); renderInfos(); majApercu(); return; }
    const action = e.target.closest('[data-action]')?.dataset.action;
    const bouton = e.target.closest('button');
    if (!action) return;
    if (action === 'facebook' || action === 'statut') partager(action, bouton);
    if (action === 'telecharger') {
      if (!afficheCourante().produit?.id) { toast('Pas encore d’affiche.', 'erreur'); return; }
      boutonOccupe(bouton, true, 'Téléchargement…');
      try { await telechargerAffiche(donnees(), s.format); toast('Affiche téléchargée.', 'succes'); } catch (err) { toast(messageErreur(err), 'erreur'); }
      boutonOccupe(bouton, false);
    }
    if (action === 'copier') {
      const ok = await copierTexte(q('#texte-publication').value);
      toast(ok ? 'Texte copié — collez-le dans la publication.' : 'Copie impossible : sélectionnez le texte à la main.', ok ? 'succes' : 'erreur');
    }
    if (action === 'changer-produit') choisirProduit(Number(bouton.dataset.rang) || 0);
    if (action === 'retirer-autre') {
      const autres = [...afficheCourante().autres];
      autres.splice(Number(bouton.dataset.rang) - 1, 1);
      brouillon({ autres });
    }
    if (action === 'photo') ajouterPhoto(bouton);
    if (action === 'detourer') {
      const a = afficheCourante();
      ouvrirDetourage({ id: a.produit.id, nom: a.produit.nom, photo_url: a.produit.photo_url }, { apres: ({ url }) => photoMiseAJour(url) });
    }
    if (action === 'enregistrer') enregistrer(bouton);
    if (action === 'suggestion') autreSuggestion(bouton);
  });
  conteneur.addEventListener('input', (e) => {
    if (e.target.id === 'phrase-affiche') { brouillon({ phrase: e.target.value.slice(0, MAX_PHRASE) }); }
    if (e.target.id === 'texte-publication') s.texteModifie = true;
  });

  charger();
  return () => { if (s.urlApercu) URL.revokeObjectURL(s.urlApercu); };
}
