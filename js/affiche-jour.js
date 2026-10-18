/**
 * affiche-jour.js — Écran « Affiche du jour » (maquette AfficheJour.dc.html), #/affiche.
 *
 * Le serveur choisit l'article chaque matin à 6 h (affiche_du_jour) ; le gérant peut changer le modèle,
 * l'article, la phrase, ou demander une autre suggestion. L'image est dessinée dans le navigateur
 * (affiche.js) puis partagée sur le statut WhatsApp (navigator.share) ou téléchargée.
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import { genererAffiche, versPng, nomFichierAffiche, LIBELLES_MODELES_AFFICHE } from './affiche.js';
import { changerPhotoArticle, choisirImage } from './images.js';
import {
  esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, differer, formatNombre, formatDate, formatTelephone, capitaliser,
  dateISO, decalerDate, promoActive, prixApplique, lienBoutique, lienCourtBoutique, iconeUnite
} from './utils.js';

const MAX_PHRASE = 80;
const premiere = (r) => (Array.isArray(r) ? r[0] : r) || null;

/** Affiche du jour (ou d'un jour passé) + réglages de la boutique en ligne (lien, WhatsApp). */
export async function chargerAfficheDuJour(jour = null) {
  const [affiche, enLigne] = await Promise.all([
    sb.rpc('affiche_du_jour', jour ? { p_boutique: etat.boutique.id, p_jour: jour } : { p_boutique: etat.boutique.id }),
    sb.from('boutiques_en_ligne').select('slug, actif, whatsapp').eq('boutique_id', etat.boutique.id).maybeSingle()
  ]);
  if (affiche.error) throw affiche.error;
  return { affiche: premiere(affiche.data), enLigne: enLigne.data || null };
}

/** Données attendues par genererAffiche. */
export function donneesAffiche(affiche, enLigne) {
  const b = etat.boutique;
  const slug = enLigne?.slug;
  const whatsapp = enLigne?.whatsapp || b.telephone;
  return {
    boutique: { nom: b.nom, ville: b.ville, logo_url: b.logo_url },
    produit: affiche?.produit || {},
    modele: affiche?.modele || 'jour',
    phrase: affiche?.phrase || '',
    jour: affiche?.jour || dateISO(),
    lien: slug ? lienBoutique(slug) : null,
    lienCourt: slug ? lienCourtBoutique(slug).replace(/^.*?\/b\//, '…/b/') : null,
    whatsapp: whatsapp ? formatTelephone(whatsapp).replace(/^\+224\s*/, '') : null
  };
}

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

function marcheASuivre() {
  ouvrirModale({
    titre: 'Image téléchargée',
    contenu: `
      <p class="texte-modale">Votre téléphone ne permet pas le partage direct : l’affiche a été enregistrée dans vos téléchargements.</p>
      <ol class="etapes-statut">
        <li>Ouvrez <strong>WhatsApp</strong>.</li>
        <li>Allez dans <strong>Actualités</strong> (ou « Statut »).</li>
        <li>Touchez <strong>Mon statut</strong> (l’icône appareil photo ou crayon).</li>
        <li>Choisissez l’image de l’affiche dans votre galerie, puis envoyez.</li>
      </ol>
      <div class="modale-actions"><button type="button" class="btn btn-primaire" data-fermer>Compris</button></div>`
  });
}

/**
 * Publie l'affiche : partage de fichier (le boutiquier choisit WhatsApp → Mon statut) si possible,
 * sinon téléchargement + marche à suivre.
 */
export async function publierAffiche(donnees, format = 'statut') {
  const canvas = await genererAffiche(donnees, format);
  const blob = await versPng(canvas);
  const nom = nomFichierAffiche(donnees.boutique.nom, donnees.jour, format);
  const fichier = typeof File === 'function' ? new File([blob], nom, { type: 'image/png' }) : null;
  if (fichier && navigator.canShare?.({ files: [fichier] })) {
    try {
      await navigator.share({ files: [fichier], text: donnees.lien ? `Commandez en ligne : ${donnees.lien}` : donnees.boutique.nom });
      return 'partage';
    } catch (err) {
      if (err?.name === 'AbortError') return 'annule';
      console.warn('[YOUMMA] Partage impossible, téléchargement :', err);
    }
  }
  telecharger(blob, nom);
  marcheASuivre();
  return 'telechargement';
}

export async function telechargerAffiche(donnees, format = 'statut') {
  const blob = await versPng(await genererAffiche(donnees, format));
  telecharger(blob, nomFichierAffiche(donnees.boutique.nom, donnees.jour, format));
}

/* =========================================================================
   Écran
   ========================================================================= */

export function afficherAfficheJour(conteneur) {
  const boutique = etat.boutique;
  const modifier = peut('affiche.modifier');
  const s = { affiche: null, enLigne: null, format: 'statut', produits: null, jeton: 0, urlApercu: null, brouillon: null };

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
          <section class="carte affiche-apercu-bloc">
            <div class="affiche-apercu" data-zone="apercu"><span class="squelette affiche-squelette"></span></div>
            <div class="affiche-pourquoi">
              <span class="discret gras">Pourquoi ce produit ?</span>
              <span data-ref="raison">…</span>
              <span class="affiche-en-ligne" data-ref="en-ligne" hidden>${icone('valide', 16, 2.4)} Déjà affichée sur votre boutique en ligne</span>
            </div>
          </section>
          ${peut('affiche.partager') ? `
            <button type="button" class="btn btn-whatsapp btn-grand btn-bloc" data-action="publier">${icone('whatsapp', 20, 2)} Publier sur mon statut WhatsApp</button>
            <div class="affiche-boutons">
              <button type="button" class="btn btn-secondaire" data-action="telecharger">${icone('telecharger', 18, 2)} Télécharger</button>
              <button type="button" class="btn btn-secondaire" data-action="format">${icone('image', 18, 2)} <span data-ref="libelle-format">Format carré</span></button>
            </div>` : ''}
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
                <button type="button" class="choix-produit-affiche" data-action="changer-produit"><span data-ref="nom-produit">…</span><span class="lien-changer">Changer</span></button></div>
              <div class="champ"><label for="phrase-affiche">Phrase sous le prix</label>
                <input id="phrase-affiche" class="input" type="text" maxlength="${MAX_PHRASE}" placeholder="Ex. Jusqu’à samedi · livraison possible">
                <span class="discret compteur-phrase" data-ref="compteur-phrase"></span></div>
              <button type="button" class="btn-ajout-pointille" data-action="photo">${icone('photo', 18, 2)} <span data-ref="libelle-photo">Ajouter une photo du produit</span></button>
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
  const afficheCourante = () => ({ ...s.affiche, ...(s.brouillon || {}), produit: { ...(s.affiche?.produit || {}), ...(s.brouillon?.produit || {}) } });

  async function majApercu() {
    const jeton = ++s.jeton;
    const donnees = donneesAffiche(afficheCourante(), s.enLigne);
    let canvas;
    try { canvas = await genererAffiche(donnees, s.format); } catch (err) { console.error(err); return; }
    if (jeton !== s.jeton || !conteneur.isConnected) return;
    const blob = await versPng(canvas).catch(() => null);
    if (!blob || jeton !== s.jeton) return;
    if (s.urlApercu) URL.revokeObjectURL(s.urlApercu);
    s.urlApercu = URL.createObjectURL(blob);
    q('[data-zone="apercu"]').innerHTML = `<img class="affiche-image ${s.format}" src="${s.urlApercu}" alt="${esc(`Affiche : ${donnees.produit.nom || ''}, ${formatNombre(donnees.produit.prix)} GNF`)}" width="${canvas.width}" height="${canvas.height}">`;
  }

  const majApercuDiffere = differer(majApercu, 300);

  function renderInfos() {
    const a = afficheCourante();
    ref('raison').textContent = a.raison || (a.auto === false ? 'Choisi par vous.' : 'Choisi automatiquement ce matin.');
    ref('en-ligne').hidden = !s.enLigne?.actif;
    ref('sous-titre').textContent = `${capitaliser(formatDate(new Date(), 'long'))} · ${a.auto === false ? 'modifiée par vous' : 'prête depuis 6 h 00'}`;
    if (!modifier) return;
    conteneur.querySelectorAll('[data-modele]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modele === a.modele)));
    ref('nom-produit').textContent = a.produit?.nom || 'Choisir un article';
    const phrase = q('#phrase-affiche');
    if (document.activeElement !== phrase) phrase.value = a.phrase || '';
    ref('compteur-phrase').textContent = `${phrase.value.length} / ${MAX_PHRASE}`;
    ref('libelle-photo').textContent = a.produit?.photo_url ? 'Changer la photo du produit' : 'Ajouter une photo du produit';
    q('[data-action="enregistrer"]').disabled = !s.brouillon;
  }

  async function charger() {
    try {
      const r = await chargerAfficheDuJour();
      if (!conteneur.isConnected) return;
      s.affiche = r.affiche;
      s.enLigne = r.enLigne;
    } catch (err) {
      q('[data-zone="apercu"]').innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p>`;
      return;
    }
    if (!s.affiche?.produit) {
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
      try { await telechargerAffiche({ ...donneesAffiche(r, s.enLigne), jour: tuile.dataset.jour }, s.format); toast('Affiche téléchargée.', 'succes'); }
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
    const { data, error } = await sb.from('produits').select('id, nom, unite, photo_url, prix_detail, prix_gros, prix_promo, promo_fin, stock, sur_commande')
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

  async function choisirProduit() {
    let produits;
    try { produits = await chargerProduits(); } catch (err) { toast(messageErreur(err), 'erreur'); return; }
    const { el, fermer } = ouvrirModale({
      titre: 'Choisir le produit de l’affiche',
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
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-produit]');
      if (!b) return;
      const p = produits.find((x) => x.id === b.dataset.produit);
      fermer();
      const pa = versProduitAffiche(p);
      brouillon({ produit: { ...pa, ...{ photo_url: p.photo_url || null } }, produit_id: p.id, modele: s.brouillon?.modele || (pa.prix_barre ? 'promo' : afficheCourante().modele) });
    });
  }

  async function ajouterPhoto(bouton) {
    const a = afficheCourante();
    if (!a.produit?.id) { toast('Choisissez d’abord le produit.', 'erreur'); return; }
    const fichier = await choisirImage();
    if (!fichier) return;
    boutonOccupe(bouton, true, 'Envoi de la photo…');
    try {
      const { url, taille } = await changerPhotoArticle({ id: a.produit.id, photo_url: a.produit.photo_url }, fichier);
      if (s.affiche?.produit?.id === a.produit.id) s.affiche.produit.photo_url = url;
      if (s.brouillon?.produit) s.brouillon.produit.photo_url = url;
      const p = s.produits?.find((x) => x.id === a.produit.id);
      if (p) p.photo_url = url;
      toast(`Photo ajoutée (${Math.round(taille / 1024)} Ko).`, 'succes');
      renderInfos();
      majApercu();
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
    const { error } = await sb.rpc('modifier_affiche', { p_boutique: boutique.id, p_produit: a.produit.id, p_modele: a.modele, p_phrase: (a.phrase || '').trim() || null });
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
    if (nouvelle?.produit) { s.affiche = nouvelle; renderInfos(); majApercu(); toast(`Nouvelle suggestion : ${nouvelle.produit.nom}.`, 'succes'); }
    else charger();
  }

  /* ---------- Évènements */

  conteneur.addEventListener('click', async (e) => {
    const modele = e.target.closest('[data-modele]');
    if (modele) { brouillon({ modele: modele.dataset.modele }); return; }
    const action = e.target.closest('[data-action]')?.dataset.action;
    const bouton = e.target.closest('button');
    if (!action) return;
    if (action === 'format') {
      s.format = s.format === 'statut' ? 'carre' : 'statut';
      ref('libelle-format').textContent = s.format === 'statut' ? 'Format carré' : 'Format statut';
      majApercu();
    }
    if (action === 'publier' || action === 'telecharger') {
      if (!afficheCourante().produit?.id) { toast('Pas encore d’affiche à publier.', 'erreur'); return; }
      boutonOccupe(bouton, true, action === 'publier' ? 'Préparation…' : 'Téléchargement…');
      try {
        if (action === 'publier') {
          const r = await publierAffiche(donneesAffiche(afficheCourante(), s.enLigne), s.format);
          if (r === 'partage') toast('Affiche partagée.', 'succes');
        } else {
          await telechargerAffiche(donneesAffiche(afficheCourante(), s.enLigne), s.format);
          toast('Affiche téléchargée.', 'succes');
        }
      } catch (err) { toast(messageErreur(err), 'erreur'); }
      boutonOccupe(bouton, false);
    }
    if (action === 'changer-produit') choisirProduit();
    if (action === 'photo') ajouterPhoto(bouton);
    if (action === 'enregistrer') enregistrer(bouton);
    if (action === 'suggestion') autreSuggestion(bouton);
  });
  conteneur.addEventListener('input', (e) => {
    if (e.target.id === 'phrase-affiche') { brouillon({ phrase: e.target.value.slice(0, MAX_PHRASE) }); }
  });

  charger();
  return () => { if (s.urlApercu) URL.revokeObjectURL(s.urlApercu); };
}
