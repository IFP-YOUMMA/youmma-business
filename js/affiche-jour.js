/**
 * affiche-jour.js — « Affiche du jour » (étape 15, maquettes AfficheJourV2 et AfficheCalendrier), onglet de
 * #/boutique-en-ligne. Deux vues : Aujourd'hui (écran du matin) et Mois (calendrier, affiche-calendrier.js).
 *
 * Écran du matin : affiche_du_jour → dessin des 3 formats sur le téléphone (affiche.js), bande « Habillage »
 * (vignettes des habillages permis par le thème, modifier_affiche p_style ; « Choisir les 3 articles » pour Sélection), texte et hashtags,
 * quatre boutons de publication (Facebook, Instagram, statut WhatsApp, TikTok), changer d'affiche
 * (autre suggestion, thème, article), publication automatique, dernières publications.
 * Images et vidéo déposées puis enregistrées (enregistrer_images_affiche) dès qu'elles changent.
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import { genererAffiche, versJpeg, genererVideo, videoPossible, FORMATS_AFFICHE, HABILLAGES_AFFICHE, STYLE_DEFAUT_THEME } from './affiche.js';
import {
  RESEAUX, enregistrerImages, publierManuellement, publierAutomatiquement, telechargerImage, nomFichier, iconeReseau, heureLisible
} from './affiche-publier.js';
import { monterCalendrier, bandeauExpiration, TONS, lireReglages } from './affiche-calendrier.js';
import {
  esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, copierTexte, formatNombre, formatDate, dateISO, capitaliser, prixApplique
} from './utils.js';

const premiere = (d) => (Array.isArray(d) ? d[0] : d) || null;
/** Noms des habillages si la table affiche_styles n'est pas lisible. */
export const NOMS_STYLES = { catalogue: 'Catalogue', impact: 'Impact', selection: 'Sélection', photo: 'Photo', message: 'Message' };
const LIBELLES_FORMATS = { '4:5': 'Facebook · Instagram 4:5', '9:16': 'Statut · Story · TikTok 9:16', '1:1': 'Carré 1:1' };

/** Complément de dessin : horaires (boutiques_en_ligne) et vrai chiffre de l'année (ventes). */
async function chargerComplements(boutique) {
  const debutAnnee = `${dateISO().slice(0, 4)}-01-01T00:00:00Z`;
  const [enLigne, ventes] = await Promise.all([
    sb.from('boutiques_en_ligne').select('ouverture, fermeture, jours').eq('boutique_id', boutique.id).maybeSingle(),
    sb.from('ventes').select('id', { count: 'exact', head: true }).eq('boutique_id', boutique.id).eq('statut', 'validee').gte('created_at', debutAnnee)
  ]);
  const h = (x) => (x ? String(x).slice(0, 5).replace(':00', ' h').replace(':', ' h ') : null);
  const r = enLigne.data || {};
  const jours = (Array.isArray(r.jours) && r.jours.length ? r.jours : [1, 2, 3, 4, 5, 6]).map(Number);
  const plage = r.ouverture && r.fermeture ? `${h(r.ouverture)} – ${h(r.fermeture)}` : 'Aux heures d’ouverture';
  const semaine = [1, 2, 3, 4, 5].every((j) => jours.includes(j));
  const horaires = [
    [semaine ? 'Lundi – vendredi' : 'En semaine', semaine ? plage : 'Selon les jours'],
    ['Samedi', jours.includes(6) ? plage : 'Fermé'],
    ['Dimanche', jours.includes(7) || jours.includes(0) ? plage : 'Fermé']
  ];
  const n = Number(ventes.count) || 0;
  const arrondi = n >= 20 ? Math.floor(n / 10) * 10 : n;
  const lieu = boutique.ville ? ` à ${boutique.ville}` : '';
  const phraseMerci = n >= 20 ? `Plus de ${formatNombre(arrondi)} clients servis cette année${lieu}.` : n > 0 ? `${formatNombre(n)} clients servis cette année${lieu}. Merci !` : `Merci de faire confiance à ${boutique.nom}.`;
  return { horaires, phraseMerci };
}

export function afficherAfficheJour(conteneur, params = new URLSearchParams()) {
  const boutique = etat.boutique;
  const vue = params.get('vue') === 'mois' ? 'mois' : 'jour';
  const modifier = peut('affiche.modifier');
  conteneur.innerHTML = `
    <div class="page page-aff">
      <div class="aff-barre">
        <nav class="onglets-pastilles" aria-label="Vue">
          <a class="onglet-pastille ${vue === 'jour' ? 'actif' : ''}" href="#/boutique-en-ligne?onglet=affiche" ${vue === 'jour' ? 'aria-current="page"' : ''}>Aujourd’hui</a>
          <a class="onglet-pastille ${vue === 'mois' ? 'actif' : ''}" href="#/boutique-en-ligne?onglet=affiche&vue=mois" ${vue === 'mois' ? 'aria-current="page"' : ''}>${icone('horloge', 15, 2)} Mois</a>
        </nav>
        <span class="aff-date">${esc(capitaliser(formatDate(new Date(), 'long')))}</span>
      </div>
      <div data-zone="bandeau"></div>
      <div data-zone="vue"><div class="squelette" style="height:420px"></div></div>
    </div>`;
  const zoneVue = conteneur.querySelector('[data-zone="vue"]');
  bandeauExpiration(conteneur.querySelector('[data-zone="bandeau"]'));
  if (params.get('reseau') === 'ok') toast('Réseau connecté.', 'succes');
  if (params.get('reseau') === 'erreur') toast('La connexion du réseau n’a pas abouti.', 'erreur', 7000);
  if (vue === 'mois') return monterCalendrier(zoneVue, { modifier });
  return monterJour(zoneVue, { boutique, modifier });
}

/* =========================================================================
   Écran du matin
   ========================================================================= */

function monterJour(zone, { boutique, modifier }) {
  const s = {
    a: null, format: '4:5', fichiers: {}, urls: {}, video: null, reseaux: [], reglages: null, complements: null,
    jeton: 0, enCours: new Set(), produits: null, themes: null, styles: null, vignettes: new Map()
  };
  const jour = dateISO();

  /* ---------------- Chargement */

  async function charger({ apresModification = false } = {}) {
    const jeton = ++s.jeton;
    const [res, reseaux, reglages, complements] = await Promise.all([
      sb.rpc('affiche_du_jour', { p_boutique: boutique.id, p_jour: jour }),
      s.reseaux.length ? Promise.resolve(null) : sb.rpc('mes_reseaux', { p_boutique: boutique.id }),
      s.reglages ? Promise.resolve(null) : lireReglages(),
      s.complements ? Promise.resolve(s.complements) : chargerComplements(boutique).catch(() => ({}))
    ]);
    if (jeton !== s.jeton || !zone.isConnected) return;
    if (reseaux && !reseaux.error) s.reseaux = premiere(reseaux.data)?.reseaux || [];
    if (reglages) s.reglages = reglages;
    s.complements = complements;
    if (res.error) {
      zone.innerHTML = `<div class="carte aff-vide">${icone('alerte', 22, 2)}<p>${esc(messageErreur(res.error))}</p></div>`;
      return;
    }
    s.a = premiere(res.data);
    if (!s.a || !s.a.theme) { renderVide(); return; }
    render();
    await dessiner();
    const images = s.a.images || {};
    if (apresModification || !images['4:5'] || !images['9:16'] || !images['1:1']) envoyerImages();
    chargerDernieres();
  }

  /** Les 3 formats dessinés sur le téléphone, prêts à partager (le partage doit suivre le toucher sans attente). */
  async function dessiner() {
    const donnees = { ...s.a, ...(s.complements || {}) };
    for (const format of Object.keys(FORMATS_AFFICHE)) {
      const canvas = await genererAffiche(donnees, format);
      const { blob } = await versJpeg(canvas);
      if (!zone.isConnected) return;
      if (s.urls[format]) URL.revokeObjectURL(s.urls[format]);
      s.urls[format] = URL.createObjectURL(blob);
      s.fichiers[format] = { blob, nom: nomFichier(s.a, format), canvas };
      if (format === s.format) montrerApercu();
    }
    zone.querySelectorAll('[data-publier]').forEach((b) => { b.disabled = false; });
  }

  async function envoyerImages() {
    try {
      s.a.images = await enregistrerImages(s.a, s.fichiers);
    } catch (err) {
      console.warn('[YOUMMA] Images non enregistrées :', err?.message || err);
      return;
    }
    // Vidéo TikTok : seulement si le navigateur sait faire ; jamais bloquante.
    if (videoPossible() && s.fichiers['9:16']?.canvas) {
      s.video = await genererVideo(s.fichiers['9:16'].canvas);
      if (s.video && zone.isConnected) {
        try { s.a.images = await enregistrerImages(s.a, {}, s.video).then((v) => ({ ...s.a.images, ...v })); } catch { /* vidéo facultative */ }
        majSousTitre('tiktok');
      }
    }
  }

  /* ---------------- Rendu */

  function renderVide() {
    zone.innerHTML = `
      <div class="carte aff-vide">
        ${icone('image', 26, 1.8)}
        <p><strong>Pas d’affiche prévue aujourd’hui.</strong> C’est un jour de repos dans votre rythme de publication.</p>
        <div class="aff-vide-actions">
          ${modifier ? '<button type="button" class="btn btn-primaire" data-action="suggestion">Préparer une affiche</button>' : ''}
          <a class="btn btn-secondaire" href="#/boutique-en-ligne?onglet=affiche&vue=mois">Voir le mois</a>
        </div>
      </div>`;
  }

  const compte = (reseau) => s.reseaux.find((r) => r.reseau === reseau) || null;
  const connecte = (reseau) => Boolean(compte(reseau)?.actif) && RESEAUX[reseau].auto;
  function sousTitre(reseau) {
    const c = compte(reseau);
    if (reseau === 'facebook') return c?.actif ? `${c.nom || 'Ma page'} · connectée` : 'Image et texte prêts · Connecter ma page';
    if (reseau === 'instagram') return c?.actif ? `${c.nom || 'Mon compte'} · compte pro` : 'Image et texte prêts · Connecter mon compte pro';
    if (reseau === 'whatsapp') return 'Format 9:16 · prêt';
    return s.video ? 'Petite vidéo de 5 s créée toute seule' : videoPossible() ? 'Petite vidéo de 5 s créée toute seule' : 'Image 9:16 (publication photo)';
  }
  const majSousTitre = (reseau) => { const el = zone.querySelector(`[data-sous="${reseau}"]`); if (el) el.textContent = sousTitre(reseau); };

  function texteHTML() {
    const tags = (s.a.hashtags || []).map((h) => `<span class="aff-hashtag">${esc(h)}</span>`).join(' ');
    return `${esc(s.a.texte || '')}${tags ? `\n\n${tags}` : ''}`;
  }
  const texteComplet = () => s.a.complet || [s.a.texte, (s.a.hashtags || []).join(' ')].filter(Boolean).join('\n\n');

  function render() {
    const a = s.a;
    const reglages = s.reglages || {};
    const autoPossible = s.reseaux.some((r) => r.actif && RESEAUX[r.reseau]?.auto);
    const reseauxAuto = (reglages.reseaux || []).map((r) => RESEAUX[r]?.nom).filter(Boolean);
    zone.innerHTML = `
      <div class="aff-jour">
        <div class="aff-gauche">
          <div class="aff-formats" role="group" aria-label="Format">
            ${Object.keys(FORMATS_AFFICHE).map((f) => `<button type="button" class="aff-format ${f === s.format ? 'actif' : ''}" data-format="${f}" aria-pressed="${f === s.format}">${esc(LIBELLES_FORMATS[f])}</button>`).join('')}
          </div>
          <div class="aff-apercu" data-zone="apercu" style="aspect-ratio:${FORMATS_AFFICHE[s.format].largeur} / ${FORMATS_AFFICHE[s.format].hauteur}"><span class="squelette"></span></div>
          <div class="aff-habillages" data-zone="habillages" aria-label="Habillage"></div>
          ${a.style === 'selection' && modifier ? '<button type="button" class="btn-lien aff-lien-selection" data-action="selection">Choisir les 3 articles</button>' : ''}
          <p class="aff-raison">${esc([a.theme_nom, a.raison].filter(Boolean).join(' · '))}${a.fete?.approximatif ? ' · date de la fête à confirmer' : ''}</p>
          ${modifier ? `<div class="aff-changer">
            <button type="button" class="btn btn-secondaire btn-petit" data-action="suggestion">${icone('retour', 15, 2)} Autre suggestion</button>
            <button type="button" class="btn btn-secondaire btn-petit" data-action="theme">Changer de thème</button>
            <button type="button" class="btn btn-secondaire btn-petit" data-action="article">Choisir un autre article</button>
          </div>` : ''}
        </div>
        <div class="aff-droite">
          <section class="carte aff-texte">
            <div class="aff-carte-entete"><h2>Le texte de la publication</h2>${modifier ? '<button type="button" class="btn-lien" data-action="modifier">Modifier</button>' : ''}</div>
            <div class="aff-texte-corps" data-zone="texte">${texteHTML()}</div>
            <div class="aff-texte-actions">
              <button type="button" class="btn btn-secondaire btn-petit" data-action="copier">${icone('copier', 15, 2)} Copier</button>
              ${modifier ? '<button type="button" class="btn btn-secondaire btn-petit" data-action="autre-texte">Autre texte</button>' : ''}
              ${modifier ? '<button type="button" class="btn btn-secondaire btn-petit" data-action="hashtags">+ Hashtags</button>' : ''}
            </div>
          </section>
          <div class="aff-publier">
            ${['facebook', 'instagram', 'whatsapp', 'tiktok'].map((r) => `
              <button type="button" class="aff-bouton-reseau ${r}" data-publier="${r}" disabled>
                <span class="aff-reseau-icone">${iconeReseau(r, 20)}</span>
                <span class="aff-reseau-textes"><strong>${esc({ facebook: 'Publier sur ma page Facebook', instagram: 'Publier sur Instagram', whatsapp: 'Mettre en statut WhatsApp', tiktok: 'Publier sur TikTok' }[r])}</strong>
                  <span data-sous="${r}">${esc(sousTitre(r))}</span></span>
                <span class="aff-reseau-etat" data-etat="${r}">${icone('chevronDroite', 18, 2.4)}</span>
              </button>`).join('')}
            <button type="button" class="aff-bouton-reseau telecharger" data-action="telecharger">
              <span class="aff-reseau-icone">${icone('telecharger', 20, 2)}</span>
              <span class="aff-reseau-textes"><strong>Télécharger l’image</strong><span>Pour publier ailleurs</span></span>
              <span class="aff-reseau-etat">${icone('chevronDroite', 18, 2.4)}</span>
            </button>
            <a class="aff-lien-reseaux" href="#/boutique-en-ligne?onglet=affiche&vue=mois">Publier en un seul clic : connecter mes réseaux ›</a>
          </div>
          <section class="carte aff-auto ${autoPossible ? '' : 'grise'}">
            <div class="aff-auto-textes"><strong>Publier tout seul chaque matin</strong>
              <span>${autoPossible ? `À ${esc(heureLisible(reglages.heure_auto))} sur ${esc(reseauxAuto.join(', ') || 'vos réseaux connectés')}.` : 'Connectez d’abord Facebook, Instagram ou TikTok.'}</span></div>
            <input type="checkbox" class="bascule-doc" role="switch" data-action="auto" ${reglages.auto && autoPossible ? 'checked' : ''} ${autoPossible && modifier ? '' : 'disabled'} aria-label="Publier tout seul chaque matin">
          </section>
          <section class="carte aff-dernieres">
            <h2>Vos dernières publications</h2>
            <div data-zone="dernieres"><span class="squelette" style="height:60px"></span></div>
          </section>
        </div>
      </div>`;
    if (s.urls[s.format]) { montrerApercu(); zone.querySelectorAll('[data-publier]').forEach((b) => { b.disabled = false; }); }
    renderHabillages();
  }

  /** Habillages permis par le thème (styles_possibles), en vignettes du vrai dessin (62 px de large). */
  async function renderHabillages() {
    const z = zone.querySelector('[data-zone="habillages"]');
    if (!z) return;
    const permis = (s.a.styles_possibles && s.a.styles_possibles.length ? s.a.styles_possibles : [s.a.style || STYLE_DEFAUT_THEME[s.a.theme]])
      .filter((c) => HABILLAGES_AFFICHE.includes(c));
    if (permis.length < 2) { z.hidden = true; return; }
    const styles = await chargerStyles();
    const nom = (c) => styles.find((x) => x.code === c)?.nom || NOMS_STYLES[c] || c;
    const courant = s.a.style || STYLE_DEFAUT_THEME[s.a.theme];
    z.hidden = false;
    z.innerHTML = `<span class="aff-habillages-titre">Habillage</span><div class="aff-habillages-liste">${permis.map((c) => `
      <button type="button" class="aff-habillage ${c === courant ? 'actif' : ''}" data-style="${esc(c)}" aria-pressed="${c === courant}" ${modifier ? '' : 'disabled'}>
        <span class="aff-vignette" data-vignette="${esc(c)}"><span class="squelette"></span></span><span>${esc(nom(c))}</span>
      </button>`).join('')}</div>`;
    const cle = (c) => `${s.a.id}|${s.a.theme}|${s.a.produit?.id || ''}|${(s.a.autres || []).map((x) => x.id).join(',')}|${c}|${s.a.titre}`;
    for (const c of permis) {
      if (!s.vignettes.has(cle(c))) {
        const grand = await genererAffiche({ ...s.a, ...(s.complements || {}), style: c }, '4:5');
        const petit = document.createElement('canvas');
        petit.width = 124; petit.height = 155;
        petit.getContext('2d').drawImage(grand, 0, 0, 124, 155);
        s.vignettes.set(cle(c), petit.toDataURL('image/jpeg', 0.8));
      }
      const v = z.querySelector(`[data-vignette="${c}"]`);
      if (!v) return;
      v.innerHTML = `<img src="${s.vignettes.get(cle(c))}" alt="">`;
    }
  }

  async function chargerStyles() {
    if (!s.styles) {
      const { data } = await sb.from('affiche_styles').select('*');
      s.styles = data || [];
    }
    return s.styles;
  }

  /** Sélection : l'article du jour + 2 autres (modifier_affiche p_autres). */
  async function choisirSelection() {
    const produits = await chargerProduits();
    const principal = s.a.produit?.id;
    const choisis = new Set((s.a.autres || []).map((x) => x.id));
    const { el, fermer } = ouvrirModale({
      titre: 'Choisir les 3 articles',
      contenu: `<p class="texte-modale">L’article du jour <strong>${esc(s.a.produit?.nom || '')}</strong>, plus deux autres :</p>
        <ul class="aff-liste-articles">${produits.filter((p) => p.id !== principal).map((p) => `<li><label class="aff-article">
          <input type="checkbox" value="${esc(p.id)}" ${choisis.has(p.id) ? 'checked' : ''}>
          ${p.photo_mini_url ? `<img src="${esc(p.photo_mini_url)}" alt="" loading="lazy">` : ''}
          <span><strong>${esc(p.nom)}</strong><span class="discret">${formatNombre(prixApplique(p))} GNF</span></span></label></li>`).join('')}</ul>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="button" class="btn btn-primaire" data-action="valider-selection">Enregistrer</button></div>`
    });
    const cases = () => [...el.querySelectorAll('input[type=checkbox]')];
    el.addEventListener('change', () => {
      const n = cases().filter((c) => c.checked).length;
      cases().forEach((c) => { if (!c.checked) c.disabled = n >= 2; });
    });
    el.dispatchEvent(new Event('change'));
    el.querySelector('[data-action="valider-selection"]').addEventListener('click', async (e) => {
      const ids = cases().filter((c) => c.checked).map((c) => c.value);
      if (ids.length !== 2) { const z = el.querySelector('.erreur-form'); z.textContent = 'Choisissez deux articles.'; z.hidden = false; return; }
      const ok = await enregistrerChangement({ autres: ids, titre: s.a.titre, texte: s.a.texte, hashtags: s.a.hashtags }, e.currentTarget);
      if (ok) fermer();
    });
  }

  function montrerApercu() {
    const z = zone.querySelector('[data-zone="apercu"]');
    if (!z || !s.urls[s.format]) return;
    z.style.aspectRatio = `${FORMATS_AFFICHE[s.format].largeur} / ${FORMATS_AFFICHE[s.format].hauteur}`;
    z.innerHTML = `<img src="${s.urls[s.format]}" alt="Affiche du jour, format ${esc(s.format)}">`;
  }

  /* ---------------- Dernières publications (jours publiés du mois, puis du mois précédent) */

  async function chargerDernieres() {
    const z = zone.querySelector('[data-zone="dernieres"]');
    if (!z) return;
    const mois = (d) => `${d.slice(0, 7)}-01`;
    const precedent = (() => { const d = new Date(`${jour.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
    const plans = await Promise.all([mois(jour), precedent].map((m) => sb.rpc('mon_plan', { p_boutique: boutique.id, p_mois: m }).then((r) => premiere(r.data)?.jours || []).catch(() => [])));
    const publies = plans.flat().filter((j) => j.publiee && String(j.jour).slice(0, 10) <= jour).sort((x, y) => String(y.jour).localeCompare(String(x.jour))).slice(0, 3);
    if (!z.isConnected) return;
    if (!publies.length) { z.innerHTML = '<p class="discret">Aucune publication pour l’instant. La première, c’est aujourd’hui !</p>'; return; }
    const details = await Promise.all(publies.map((j) => sb.rpc('affiche_du_jour', { p_boutique: boutique.id, p_jour: String(j.jour).slice(0, 10) }).then((r) => premiere(r.data)).catch(() => null)));
    if (!z.isConnected) return;
    z.innerHTML = details.filter(Boolean).map((d) => {
      const pubs = (d.publications || []).filter((p) => p.statut === 'publiee' || p.statut === 'manuelle' || !p.statut);
      const vues = pubs.reduce((t, p) => t + (Number(p.vues) || 0), 0);
      const reseaux = [...new Set(pubs.map((p) => RESEAUX[p.reseau]?.nom || p.reseau))].join(' + ');
      const mini = d.images?.['1:1'] || d.images?.['4:5'];
      return `
        <div class="aff-derniere">
          ${mini ? `<img src="${esc(mini)}" alt="" loading="lazy">` : `<span class="aff-derniere-vide">${icone('image', 18, 1.8)}</span>`}
          <span class="aff-derniere-textes"><strong>${esc(d.theme_nom || d.titre || 'Affiche')}</strong>
            <span>${esc(capitaliser(formatDate(`${String(d.jour).slice(0, 10)}T12:00:00Z`, 'jourCourt')))} ${esc(formatDate(`${String(d.jour).slice(0, 10)}T12:00:00Z`, 'jourMois'))}${reseaux ? ` · ${esc(reseaux)}` : ''}</span></span>
          ${vues ? `<span class="aff-vues">${formatNombre(vues)} vues</span>` : ''}
        </div>`;
    }).join('') || '<p class="discret">Aucune publication pour l’instant.</p>';
  }

  /* ---------------- Publication */

  async function publier(reseau, bouton) {
    if (s.enCours.has(reseau)) return;
    const format = RESEAUX[reseau].format;
    const fichierImage = s.fichiers[format];
    if (!fichierImage) { toast('L’affiche se prépare encore…', 'info'); return; }
    const texte = texteComplet();
    const etatEl = zone.querySelector(`[data-etat="${reseau}"]`);
    // Chemin B : réseau connecté → un seul clic.
    if (connecte(reseau)) {
      s.enCours.add(reseau);
      bouton.classList.add('occupe');
      etatEl.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
      zone.querySelector(`[data-sous="${reseau}"]`).textContent = 'Publication en cours…';
      const imageUrl = reseau === 'tiktok' ? (s.a.images?.video || s.a.images?.['9:16']) : s.a.images?.[format];
      const r = await publierAutomatiquement({ affiche: s.a, reseau, imageUrl, texte });
      s.enCours.delete(reseau);
      bouton.classList.remove('occupe');
      if (!zone.isConnected) return;
      const sous = zone.querySelector(`[data-sous="${reseau}"]`);
      if (r.statut === 'publiee') {
        etatEl.innerHTML = icone('valide', 18, 2.6);
        sous.innerHTML = r.url ? `Publiée · <a href="${esc(r.url)}" target="_blank" rel="noopener">voir la publication</a>` : 'Publiée';
        toast(`Publiée sur ${RESEAUX[reseau].nom}.`, 'succes');
      } else if (r.statut === 'erreur') {
        etatEl.innerHTML = icone('alerte', 18, 2.4);
        sous.textContent = r.erreur;
        toast(r.erreur, 'erreur', 7000);
      } else {
        etatEl.innerHTML = icone('horloge', 18, 2.2);
        sous.textContent = 'Toujours en cours — le résultat s’affichera dans vos publications.';
      }
      return;
    }
    // Chemin A : en trois secondes.
    const fichier = reseau === 'tiktok' && s.video ? { blob: s.video, nom: nomFichier(s.a, '9:16', 'mp4') } : fichierImage;
    const r = await publierManuellement({ affiche: s.a, reseau, format: reseau === 'tiktok' && s.video ? 'video' : format, fichier, texte, compte: compte(reseau) });
    if (r !== 'annule' && zone.isConnected) {
      etatEl.innerHTML = icone('valide', 18, 2.6);
      chargerDernieres();
    }
  }

  /* ---------------- Changer d'affiche */

  async function enregistrerChangement({ theme = s.a.theme, produit = s.a.produit?.id || null, style = s.a.style || null, autres = (s.a.autres || []).map((x) => x.id), titre, texte, hashtags }, bouton) {
    if (bouton) boutonOccupe(bouton, true);
    try {
      let t = { titre, texte, hashtags };
      if (titre === undefined) {
        const { data, error } = await sb.rpc('texte_affiche', { p_boutique: boutique.id, p_theme: theme, p_produit: produit, p_jour: jour });
        if (error) throw error;
        t = premiere(data) || {};
      }
      const { error } = await sb.rpc('modifier_affiche', {
        p_boutique: boutique.id, p_jour: jour, p_theme: theme, p_produit: produit, p_style: style, p_autres: autres && autres.length ? autres : null,
        p_titre: t.titre ?? null, p_texte: t.texte ?? null, p_hashtags: t.hashtags ?? null
      });
      if (error) throw error;
      await charger({ apresModification: true });
      return true;
    } catch (err) {
      if (bouton) boutonOccupe(bouton, false);
      toast(messageErreur(err), 'erreur', 6000);
      return false;
    }
  }

  async function chargerThemes() {
    if (!s.themes) {
      const { data } = await sb.from('affiche_themes').select('*');
      s.themes = (data || []).sort((x, y) => (x.ordre ?? 0) - (y.ordre ?? 0));
    }
    return s.themes;
  }
  async function chargerProduits() {
    if (!s.produits) {
      const { data } = await sb.from('produits').select('id, nom, unite, prix_detail, prix_gros, prix_promo, promo_fin, photo_mini_url, stock, sur_commande')
        .eq('boutique_id', boutique.id).eq('actif', true).order('nom');
      s.produits = data || [];
    }
    return s.produits;
  }

  /** Liste d'articles avec recherche ; renvoie l'id choisi (ou null). */
  async function choisirArticle(titre = 'Choisir un article') {
    const produits = await chargerProduits();
    return new Promise((resoudre) => {
      let choisi = null;
      const { el, fermer } = ouvrirModale({
        titre,
        contenu: `
          <label class="recherche-entete recherche-large">${icone('recherche', 18, 2)}<span class="sr-only">Rechercher</span><input type="search" data-ref="q" placeholder="Nom de l’article…" autocomplete="off"></label>
          <ul class="aff-liste-articles" data-ref="liste"></ul>`,
        onFermer: () => resoudre(choisi)
      });
      const liste = el.querySelector('[data-ref="liste"]');
      const rendre = (q = '') => {
        const f = produits.filter((p) => p.nom.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
        liste.innerHTML = f.map((p) => `<li><button type="button" class="aff-article" data-id="${esc(p.id)}">
          ${p.photo_mini_url ? `<img src="${esc(p.photo_mini_url)}" alt="" loading="lazy">` : `<span class="aff-derniere-vide">${icone('stock', 16, 1.8)}</span>`}
          <span><strong>${esc(p.nom)}</strong><span class="discret">${formatNombre(prixApplique(p))} GNF${p.unite ? ` / ${esc(p.unite)}` : ''}</span></span></button></li>`).join('') || '<li class="discret">Aucun article.</li>';
      };
      rendre();
      el.querySelector('[data-ref="q"]').addEventListener('input', (e) => rendre(e.target.value));
      liste.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) { choisi = b.dataset.id; fermer(); } });
    });
  }

  async function changerTheme() {
    const [themes, styles] = await Promise.all([chargerThemes(), chargerStyles()]);
    const nomStyle = (c) => styles.find((x) => x.code === c)?.nom || NOMS_STYLES[c] || c;
    const { el, fermer } = ouvrirModale({
      titre: 'Changer de thème',
      contenu: `<div class="aff-themes">${themes.map((t) => `
        <button type="button" class="aff-theme ${t.code === s.a.theme ? 'actif' : ''}" data-theme="${esc(t.code)}">
          <span class="aff-theme-pastille theme-${esc(t.code)}"></span>
          <span><strong>${esc(t.nom)}</strong><span class="discret">${esc(t.description || '')}</span>
            <span class="aff-theme-style">Habillage : ${esc(nomStyle(t.style_defaut || STYLE_DEFAUT_THEME[t.code]))}</span></span>
        </button>`).join('')}</div>`
    });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-theme]');
      if (!b) return;
      const t = themes.find((x) => x.code === b.dataset.theme);
      fermer();
      let produit = t.besoin === 'produit' ? (s.a.produit?.id || null) : null;
      if (t.besoin === 'produit' && !produit) produit = await choisirArticle(`Article pour « ${t.nom} »`);
      if (t.besoin === 'produit' && !produit) return;
      enregistrerChangement({ theme: t.code, produit, style: t.style_defaut || STYLE_DEFAUT_THEME[t.code] || null, autres: [] });
    });
  }

  function modifierTexte() {
    const a = s.a;
    const { el, fermer } = ouvrirModale({
      titre: 'Modifier le texte',
      variante: 'large',
      contenu: `<form class="form-modale" novalidate>
        <div class="champ"><label for="aff-titre">Titre sur l’affiche</label><input id="aff-titre" class="input" maxlength="80" value="${esc(a.titre || '')}"></div>
        <div class="champ"><label for="aff-texte">Texte de la publication</label><textarea id="aff-texte" class="input" rows="9" maxlength="2000">${esc(a.texte || '')}</textarea></div>
        <div class="champ"><label for="aff-tags">Hashtags (séparés par des espaces)</label><input id="aff-tags" class="input" value="${esc((a.hashtags || []).join(' '))}"></div>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`
    });
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok = await enregistrerChangement({
        titre: el.querySelector('#aff-titre').value.trim() || a.titre,
        texte: el.querySelector('#aff-texte').value.trim(),
        hashtags: normaliserTags(el.querySelector('#aff-tags').value)
      }, el.querySelector('[type=submit]'));
      if (ok) fermer();
    });
  }

  const normaliserTags = (brut) => [...new Set(String(brut || '').split(/[\s,;]+/).filter(Boolean).map((t) => `#${t.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((t) => t.length > 2))].slice(0, 20);

  function ajouterHashtags() {
    const { el, fermer } = ouvrirModale({
      titre: 'Ajouter des hashtags',
      contenu: `<form class="form-modale" novalidate>
        <div class="champ"><label for="aff-nouveaux">Hashtags</label><input id="aff-nouveaux" class="input" placeholder="#Kagbelen #Livraison" autocomplete="off"></div>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Ajouter</button></div>
      </form>`
    });
    el.querySelector('#aff-nouveaux').focus();
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nouveaux = normaliserTags(el.querySelector('#aff-nouveaux').value);
      if (!nouveaux.length) { fermer(); return; }
      const ok = await enregistrerChangement({ titre: s.a.titre, texte: s.a.texte, hashtags: normaliserTags([...(s.a.hashtags || []), ...nouveaux].join(' ')) }, el.querySelector('[type=submit]'));
      if (ok) fermer();
    });
  }

  /** « Autre texte » : ton suivant (réglage de publication), puis texte régénéré par texte_affiche. */
  async function autreTexte(bouton) {
    const r = s.reglages || {};
    const tons = TONS.map(([c]) => c);
    const suivant = tons[(tons.indexOf(r.ton) + 1) % tons.length] || tons[0];
    boutonOccupe(bouton, true);
    const { error } = await sb.rpc('modifier_publication', {
      p_boutique: boutique.id, p_jours: r.jours ?? null, p_auto: r.auto ?? false, p_heure_auto: r.heure_auto ?? null,
      p_reseaux: r.reseaux ?? [], p_ton: suivant, p_signature: r.signature ?? null
    });
    if (error) { boutonOccupe(bouton, false); toast(messageErreur(error), 'erreur'); return; }
    s.reglages = { ...r, ton: suivant };
    const ok = await enregistrerChangement({});
    if (ok) toast(`Nouveau texte (ton « ${TONS.find(([c]) => c === suivant)?.[1] || suivant} »).`, 'succes');
  }

  async function basculerAuto(entree) {
    const r = s.reglages || {};
    entree.disabled = true;
    const reseaux = (r.reseaux && r.reseaux.length ? r.reseaux : s.reseaux.filter((x) => x.actif && RESEAUX[x.reseau]?.auto).map((x) => x.reseau));
    const { error } = await sb.rpc('modifier_publication', {
      p_boutique: boutique.id, p_jours: r.jours ?? null, p_auto: entree.checked, p_heure_auto: r.heure_auto ?? '08:00',
      p_reseaux: reseaux, p_ton: r.ton ?? null, p_signature: r.signature ?? null
    });
    entree.disabled = false;
    if (error) { entree.checked = !entree.checked; toast(messageErreur(error), 'erreur'); return; }
    s.reglages = { ...r, auto: entree.checked, reseaux };
    toast(entree.checked ? 'Publication automatique activée.' : 'Publication automatique arrêtée.', 'succes');
  }

  /* ---------------- Évènements */

  zone.addEventListener('click', async (e) => {
    const format = e.target.closest('[data-format]');
    if (format) {
      s.format = format.dataset.format;
      zone.querySelectorAll('[data-format]').forEach((b) => { b.classList.toggle('actif', b === format); b.setAttribute('aria-pressed', String(b === format)); });
      montrerApercu();
      return;
    }
    const habillage = e.target.closest('[data-style]');
    if (habillage && !habillage.disabled && habillage.dataset.style !== (s.a.style || STYLE_DEFAUT_THEME[s.a.theme])) {
      zone.querySelectorAll('[data-style]').forEach((b) => { b.classList.toggle('actif', b === habillage); b.setAttribute('aria-pressed', String(b === habillage)); });
      enregistrerChangement({ style: habillage.dataset.style, titre: s.a.titre, texte: s.a.texte, hashtags: s.a.hashtags });
      return;
    }
    const pub = e.target.closest('[data-publier]');
    if (pub && !pub.disabled) { publier(pub.dataset.publier, pub); return; }
    const action = e.target.closest('[data-action]');
    if (!action) return;
    const a = action.dataset.action;
    if (a === 'copier') { toast(await copierTexte(texteComplet()) ? 'Texte copié.' : 'Copie impossible : sélectionnez le texte à la main.', 'succes'); return; }
    if (a === 'telecharger') { if (s.fichiers[s.format]) telechargerImage(s.fichiers[s.format]); return; }
    if (a === 'suggestion') {
      boutonOccupe(action, true);
      const { error } = await sb.rpc('nouvelle_suggestion_affiche', { p_boutique: boutique.id, p_jour: jour });
      if (error) { boutonOccupe(action, false); toast(messageErreur(error), 'erreur'); return; }
      charger({ apresModification: true });
      return;
    }
    if (a === 'theme') { changerTheme(); return; }
    if (a === 'selection') { choisirSelection(); return; }
    if (a === 'article') { const id = await choisirArticle(); if (id) enregistrerChangement({ produit: id, theme: ['produit', 'promo', 'arrivage', 'saison'].includes(s.a.theme) ? s.a.theme : 'produit' }); return; }
    if (a === 'modifier') { modifierTexte(); return; }
    if (a === 'hashtags') { ajouterHashtags(); return; }
    if (a === 'autre-texte') autreTexte(action);
  });
  zone.addEventListener('change', (e) => { if (e.target.matches('[data-action="auto"]')) basculerAuto(e.target); });

  charger();
  return () => { Object.values(s.urls).forEach((u) => URL.revokeObjectURL(u)); };
}

