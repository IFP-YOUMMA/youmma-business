/**
 * outil.js — L'outil unique d'ajout d'image de l'appli (maquette Uploader) : panneau du bas sur téléphone,
 * fenêtre centrée sur ordinateur. 4 étapes : Choisir → Recadrer → Nettoyer → Enregistrer.
 *
 * ouvrirOutilImage({ usage, source, contexte, enregistrer }) :
 *   usage : clé de PREREGLAGES (logo, cachet, signature, article, couverture, paiement, partenaire, bon) ;
 *   source : File/Blob ou URL d'une image existante (« Recadrer ») — sinon l'étape « Choisir » ;
 *   contexte : { nom, prix, unite, couleur } pour l'aperçu à l'endroit d'usage ;
 *   enregistrer(sorties) : async, reçoit { grande: { blob, type, extension, largeur, hauteur }, mini? } ;
 *     une erreur levée est affichée dans la fenêtre (rien n'est perdu).
 * Rien n'est envoyé tant que l'on n'a pas cliqué sur le bouton final ; fermer = annuler.
 */
import { esc, icone, ouvrirModale, boutonOccupe, messageErreur, formatNombre } from '../utils.js';
import { PREREGLAGES, FORMES } from './prereglages.js';
import { chargerCanvas, pivoter, recadrer, retirerFond, redimensionner, encoder, canvas as nouveauCanvas } from './traitement.js';
import { detourer, detourageDisponible, messageDetourage } from '../detourage.js';

const ETAPES = ['Choisir', 'Recadrer', 'Nettoyer', 'Enregistrer'];

export function ouvrirOutilImage({ usage, source = null, contexte = {}, enregistrer, titre = null }) {
  const p = PREREGLAGES[usage];
  if (!p) throw new Error(`Usage d’image inconnu : ${usage}`);
  const s = {
    etape: 0, image: null, forme: p.recadrages[0], fond: p.fond === 'active', seuil: 200, ia: null,
    vue: { s: 1, s0: 1, tx: 0, ty: 0, cadre: { x: 0, y: 0, l: 0, h: 0 } },
    coupe: null, propre: null, sorties: null, controle: new AbortController(), dessin: false, traits: false
  };
  const { el, fermer } = ouvrirModale({
    titre: titre || p.titre,
    variante: 'feuille',
    onFermer: () => { s.controle.abort(); window.removeEventListener('resize', surRedimension); },
    contenu: `
      <div class="outil-image" data-usage="${esc(usage)}">
        <ol class="outil-etapes">${ETAPES.map((e, i) => `<li data-etape="${i}"><span></span>${e}</li>`).join('')}</ol>
        <div class="outil-corps" data-zone="corps"></div>
        <p class="erreur-form" role="alert" data-zone="erreur" hidden></p>
        <div class="outil-pied" data-zone="pied"></div>
      </div>`
  });
  const q = (sel) => el.querySelector(sel);
  const corps = q('[data-zone="corps"]');
  const montrerErreur = (m) => { const z = q('[data-zone="erreur"]'); z.textContent = m || ''; z.hidden = !m; };

  /* ------------------------------------------------------------ Navigation */

  function aller(etape) {
    montrerErreur('');
    if (etape === 2 && p.fond === 'non') etape = s.etape < 2 ? 3 : 1;
    s.etape = etape;
    el.querySelectorAll('.outil-etapes li').forEach((li, i) => {
      li.classList.toggle('faite', i < etape || (i === 2 && p.fond === 'non' && etape > 2));
      li.classList.toggle('courante', i === etape);
    });
    if (etape === 0) renderChoisir();
    else if (etape === 1) renderRecadrer();
    else if (etape === 2) renderNettoyer();
    else renderEnregistrer();
  }

  function pied(boutons) {
    q('[data-zone="pied"]').innerHTML = boutons;
  }

  /* ------------------------------------------------------------ 1. Choisir */

  function renderChoisir() {
    corps.innerHTML = `
      <div class="outil-choisir" data-zone="depot">
        <span class="outil-depot-icone">${icone('photo', 34, 1.6)}</span>
        <p class="gras">${esc(p.aide)}</p>
        <p class="discret seul-ordi">Glissez une image ici, ou :</p>
        <div class="outil-choix">
          <label class="btn btn-primaire btn-grand">${icone('photo', 18, 2)} Prendre une photo
            <input type="file" accept="image/*" capture="environment" class="sr-only" data-fichier></label>
          <label class="btn btn-secondaire btn-grand">${icone('image', 18, 2)} Choisir dans la galerie
            <input type="file" accept="image/*" class="sr-only" data-fichier></label>
          ${p.dessin ? `<button type="button" class="btn btn-secondaire btn-grand" data-action="dessiner">${icone('crayon', 18, 2)} Signer au doigt</button>` : ''}
        </div>
        <p class="discret">JPEG, PNG, WebP ou HEIC · la photo est préparée sur cet appareil avant l’envoi.</p>
      </div>`;
    pied('<button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>');
    const depot = q('[data-zone="depot"]');
    depot.addEventListener('dragover', (e) => { e.preventDefault(); depot.classList.add('survol'); });
    depot.addEventListener('dragleave', () => depot.classList.remove('survol'));
    depot.addEventListener('drop', (e) => { e.preventDefault(); depot.classList.remove('survol'); const f = e.dataTransfer?.files?.[0]; if (f) charger(f); });
  }

  async function charger(fichier) {
    corps.innerHTML = '<div class="outil-attente"><span class="spinner"></span> Lecture de la photo…</div>';
    try {
      let blob = fichier;
      if (typeof fichier === 'string') {
        const r = await fetch(fichier, { cache: 'no-store' });
        if (!r.ok) throw Object.assign(new Error('Image introuvable'), { code: 'IMAGE_ILLISIBLE' });
        blob = await r.blob();
      }
      s.image = await chargerCanvas(blob);
      s.coupe = null; s.propre = null; s.ia = null;
      aller(1);
    } catch {
      montrerErreur('Cette image ne peut pas être lue. Choisissez une photo JPEG, PNG ou WebP.');
      renderChoisir();
    }
  }

  /* Signature au doigt : canevas blanc, puis directement le nettoyage (fond retiré). */
  function renderDessin() {
    s.dessin = true; s.traits = false;
    corps.innerHTML = `
      <p class="discret">Signez dans le cadre avec le doigt ou la souris.</p>
      <canvas class="cadre-signature" width="900" height="360" aria-label="Zone de signature"></canvas>`;
    pied(`<button type="button" class="btn btn-secondaire" data-action="effacer">${icone('corbeille', 18, 2)} Effacer</button>
      <button type="button" class="btn btn-primaire" data-action="valider-dessin">Valider</button>`);
    const toile = corps.querySelector('canvas');
    const ctx = toile.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, toile.width, toile.height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = '#10231D';
    let trace = false;
    const point = (e) => { const r = toile.getBoundingClientRect(); return [(e.clientX - r.left) * (toile.width / r.width), (e.clientY - r.top) * (toile.height / r.height)]; };
    toile.addEventListener('pointerdown', (e) => { trace = true; toile.setPointerCapture(e.pointerId); const [x, y] = point(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke(); s.traits = true; e.preventDefault(); });
    toile.addEventListener('pointermove', (e) => { if (!trace) return; const [x, y] = point(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); });
    const fin = () => { trace = false; };
    toile.addEventListener('pointerup', fin);
    toile.addEventListener('pointercancel', fin);
  }

  /* ------------------------------------------------------------ 2. Recadrer */

  function renderRecadrer() {
    const formes = p.recadrages.map((f) => `<button type="button" class="outil-forme" data-forme="${f}" aria-pressed="${s.forme === f}">
      <span class="outil-forme-icone outil-forme-${f.replace(':', '-')}"></span>${FORMES[f].libelle}</button>`).join('');
    corps.innerHTML = `
      <div class="outil-vue" data-zone="vue">
        <canvas data-zone="toile"></canvas>
        <div class="outil-cadre ${FORMES[s.forme].rond ? 'rond' : ''}" data-zone="cadre">
          ${s.forme === 'libre' ? ['hg', 'hd', 'bg', 'bd'].map((c) => `<span class="outil-poignee ${c}" data-poignee="${c}"></span>`).join('') : ''}
        </div>
        ${usage === 'couverture' ? '<div class="outil-zone-mobile" data-zone="mobile"><span>zone visible sur téléphone</span></div>' : ''}
        <span class="outil-astuce">Pincez pour zoomer · glissez pour déplacer</span>
      </div>
      <label class="outil-zoom">${icone('recherche', 16, 2)}<span class="sr-only">Zoom</span>
        <input type="range" min="1" max="4" step="0.01" value="1" data-zone="zoom" aria-label="Zoom"></label>
      <div class="outil-formes">${formes}<button type="button" class="outil-forme" data-action="pivoter"><span class="outil-forme-icone outil-pivoter">↻</span>Pivoter</button></div>`;
    pied(`<button type="button" class="btn btn-secondaire" data-action="retour-choix">Autre photo</button>
      <button type="button" class="btn btn-primaire" data-action="suivant">Suivant</button>`);
    requestAnimationFrame(() => { placer(true); });
    brancherGestes();
  }

  /** Calcule le cadre et l'échelle de base ; initial : image centrée sur le cadre. */
  function placer(initial = false) {
    const vue = q('[data-zone="vue"]');
    if (!vue || !s.image) return;
    const W = vue.clientWidth;
    const H = vue.clientHeight;
    const img = s.image;
    const rapport = FORMES[s.forme].rapport;
    const marge = 18;
    let cadre;
    if (rapport) {
      const l = Math.min(W - 2 * marge, (H - 2 * marge) * rapport);
      cadre = { l, h: l / rapport };
    } else {
      const e = Math.min((W - 2 * marge) / img.width, (H - 2 * marge) / img.height);
      cadre = { l: img.width * e, h: img.height * e };
    }
    cadre.x = (W - cadre.l) / 2;
    cadre.y = (H - cadre.h) / 2;
    const v = s.vue;
    v.cadre = cadre;
    v.s0 = rapport ? Math.max(cadre.l / img.width, cadre.h / img.height) : Math.min(cadre.l / img.width, cadre.h / img.height);
    if (initial) {
      v.s = v.s0;
      v.tx = cadre.x + (cadre.l - img.width * v.s) / 2;
      v.ty = cadre.y + (cadre.h - img.height * v.s) / 2;
      const zoom = q('[data-zone="zoom"]');
      if (zoom) zoom.value = '1';
    }
    contraindre();
    dessiner();
  }

  /** L'image couvre toujours le cadre (pas de bord vide dans le résultat). */
  function contraindre() {
    const v = s.vue;
    const img = s.image;
    v.s = Math.max(v.s, v.s0);
    const c = v.cadre;
    const l = img.width * v.s;
    const h = img.height * v.s;
    v.tx = Math.min(c.x, Math.max(c.x + c.l - l, v.tx));
    v.ty = Math.min(c.y, Math.max(c.y + c.h - h, v.ty));
  }

  function dessiner() {
    const toile = q('[data-zone="toile"]');
    const vue = q('[data-zone="vue"]');
    if (!toile || !vue) return;
    const r = window.devicePixelRatio || 1;
    const W = vue.clientWidth;
    const H = vue.clientHeight;
    if (toile.width !== Math.round(W * r)) { toile.width = Math.round(W * r); toile.height = Math.round(H * r); }
    toile.style.width = `${W}px`; toile.style.height = `${H}px`;
    const ctx = toile.getContext('2d');
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(s.image, s.vue.tx, s.vue.ty, s.image.width * s.vue.s, s.image.height * s.vue.s);
    const c = s.vue.cadre;
    const cadre = q('[data-zone="cadre"]');
    Object.assign(cadre.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.l}px`, height: `${c.h}px` });
    const mobile = q('[data-zone="mobile"]');
    if (mobile) { const l = c.h * (390 / 250); Object.assign(mobile.style, { left: `${c.x + (c.l - l) / 2}px`, top: `${c.y}px`, width: `${l}px`, height: `${c.h}px` }); }
  }

  function zoomer(nouvelle, px, py) {
    const v = s.vue;
    const avant = v.s;
    v.s = Math.min(v.s0 * 6, Math.max(v.s0, nouvelle));
    v.tx = px - (px - v.tx) * (v.s / avant);
    v.ty = py - (py - v.ty) * (v.s / avant);
    contraindre();
    dessiner();
    const zoom = q('[data-zone="zoom"]');
    if (zoom) zoom.value = String(Math.min(4, v.s / v.s0));
  }

  function brancherGestes() {
    const vue = q('[data-zone="vue"]');
    const pointeurs = new Map();
    let pince = null;
    let poignee = null;
    vue.addEventListener('pointerdown', (e) => {
      vue.setPointerCapture(e.pointerId);
      pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      poignee = e.target.closest('[data-poignee]')?.dataset.poignee || null;
      if (pointeurs.size === 2) {
        const [a, b] = [...pointeurs.values()];
        pince = { d: Math.hypot(a.x - b.x, a.y - b.y), s: s.vue.s };
      }
      e.preventDefault();
    });
    vue.addEventListener('pointermove', (e) => {
      const avant = pointeurs.get(e.pointerId);
      if (!avant) return;
      const dx = e.clientX - avant.x;
      const dy = e.clientY - avant.y;
      pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = vue.getBoundingClientRect();
      if (pointeurs.size === 2 && pince) {
        const [a, b] = [...pointeurs.values()];
        zoomer(pince.s * (Math.hypot(a.x - b.x, a.y - b.y) / pince.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        return;
      }
      if (poignee) { redimensionnerCadre(poignee, dx, dy); return; }
      s.vue.tx += dx; s.vue.ty += dy;
      contraindre();
      dessiner();
    });
    const fin = (e) => { pointeurs.delete(e.pointerId); if (pointeurs.size < 2) pince = null; if (!pointeurs.size) poignee = null; };
    vue.addEventListener('pointerup', fin);
    vue.addEventListener('pointercancel', fin);
    vue.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = vue.getBoundingClientRect();
      zoomer(s.vue.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    q('[data-zone="zoom"]').addEventListener('input', (e) => {
      const c = s.vue.cadre;
      zoomer(s.vue.s0 * Number(e.target.value), c.x + c.l / 2, c.y + c.h / 2);
    });
  }

  /** Recadrage libre : chaque coin se déplace, sans sortir de l'image affichée. */
  function redimensionnerCadre(coin, dx, dy) {
    const v = s.vue;
    const c = { ...v.cadre };
    const imgL = s.image.width * v.s;
    const imgH = s.image.height * v.s;
    const min = 40;
    if (coin.includes('g')) { const x = Math.min(c.x + c.l - min, Math.max(v.tx, c.x + dx)); c.l += c.x - x; c.x = x; }
    else c.l = Math.max(min, Math.min(v.tx + imgL - c.x, c.l + dx));
    if (coin.includes('h')) { const y = Math.min(c.y + c.h - min, Math.max(v.ty, c.y + dy)); c.h += c.y - y; c.y = y; }
    else c.h = Math.max(min, Math.min(v.ty + imgH - c.y, c.h + dy));
    v.cadre = c;
    dessiner();
  }

  /** Découpe de l'image de travail selon le cadre. */
  function decouper() {
    const v = s.vue;
    const c = v.cadre;
    return recadrer(s.image, { x: (c.x - v.tx) / v.s, y: (c.y - v.ty) / v.s, l: c.l / v.s, h: c.h / v.s }, { rond: FORMES[s.forme].rond });
  }

  /* ------------------------------------------------------------ 3. Nettoyer */

  function renderNettoyer() {
    const iaPossible = p.ia && detourageDisponible();
    corps.innerHTML = `
      <div class="outil-nettoyer">
        <div class="damier outil-apercu-net" data-zone="net"></div>
        <div class="outil-reglage">
          <label class="option-doc option-seule"><span class="option-textes"><span class="gras">Retirer le fond blanc</span>
            <span class="discret">${esc(p.aide)}</span></span>
            <input type="checkbox" class="bascule-doc" role="switch" data-zone="fond" ${s.fond && !s.ia ? 'checked' : ''}></label>
          <label class="outil-sensibilite" ${s.fond && !s.ia ? '' : 'hidden'} data-zone="reglage-seuil">Sensibilité
            <input type="range" min="110" max="250" step="5" value="${s.seuil}" data-zone="seuil" aria-label="Sensibilité du retrait du fond"></label>
          ${iaPossible ? `<button type="button" class="btn btn-secondaire" data-action="ia">${icone('image', 18, 2)} ${s.ia ? 'Détourage automatique appliqué' : 'Détourer automatiquement (photo sur fond quelconque)'}</button>
            <div class="barre-progres" data-zone="ia-progres" hidden><span></span></div>` : ''}
        </div>
      </div>`;
    pied(`<button type="button" class="btn btn-secondaire" data-action="precedent">Retour</button>
      <button type="button" class="btn btn-primaire" data-action="suivant">Suivant</button>`);
    majNettoyage();
  }

  function majNettoyage() {
    const zone = q('[data-zone="net"]');
    if (!zone) return;
    if (s.ia) s.propre = s.ia;
    else if (s.fond) {
      const libre = s.forme === 'libre';
      s.propre = retirerFond(s.coupe, s.seuil, { rogner: libre }) || null;
    } else s.propre = s.coupe;
    zone.innerHTML = '';
    if (!s.propre) { zone.innerHTML = '<span class="discret">Plus rien de visible : baissez la sensibilité.</span>'; return; }
    const c = s.propre;
    c.classList.add('outil-net');
    zone.append(c);
  }

  async function lancerIa(bouton) {
    const barre = q('[data-zone="ia-progres"]');
    boutonOccupe(bouton, true, 'Détourage…');
    barre.hidden = false;
    try {
      const blob = await new Promise((ok) => s.coupe.toBlob(ok, 'image/png'));
      const r = await detourer(blob, {
        signal: s.controle.signal,
        onProgres: ({ etape, valeur }) => {
          const poids = { modele: [0, 0.6], preparation: [0.6, 0.7], analyse: [0.7, 0.9], finition: [0.9, 1] }[etape] || [0, 1];
          barre.querySelector('span').style.width = `${Math.round((poids[0] + (poids[1] - poids[0]) * (valeur || 0)) * 100)}%`;
        }
      });
      s.ia = await chargerCanvas(r.blob);
      s.fond = false;
      renderNettoyer();
    } catch (err) {
      boutonOccupe(bouton, false);
      barre.hidden = true;
      if (err?.name !== 'AbortError') montrerErreur(messageDetourage(err));
    }
  }

  /* ------------------------------------------------------------ 4. Enregistrer */

  async function renderEnregistrer() {
    corps.innerHTML = '<div class="outil-attente"><span class="spinner"></span> Préparation…</div>';
    pied(`<button type="button" class="btn btn-secondaire" data-action="precedent">Retour</button>
      <button type="button" class="btn btn-primaire btn-grand" data-action="enregistrer" disabled>${esc(p.bouton)}</button>`);
    try {
      s.sorties = await produireSorties();
    } catch (err) {
      montrerErreur(messageErreur(err));
      return;
    }
    if (!el.isConnected) return;
    const g = s.sorties.grande;
    const url = URL.createObjectURL(g.blob);
    s.urlApercu && URL.revokeObjectURL(s.urlApercu);
    s.urlApercu = url;
    const infos = Object.entries(s.sorties).map(([cle, x]) => `${cle === 'mini' ? 'Miniature' : 'Image'} ${x.largeur} × ${x.hauteur} · ${formatNombre(Math.max(1, Math.round(x.blob.size / 1024)))} Ko · ${x.extension.toUpperCase()}${x.transparent ? ' transparent' : ''}`).join('<br>');
    corps.innerHTML = `
      <div class="outil-enregistrer">
        ${apercuUsage(url)}
        <p class="outil-infos" data-zone="infos">${infos}</p>
      </div>`;
    q('[data-action="enregistrer"]').disabled = false;
  }

  /** Fichiers finaux selon le préréglage (grande + miniature éventuelle). */
  async function produireSorties() {
    const src = s.propre || s.coupe;
    const transparent = Boolean(s.ia || (s.fond && p.fond !== 'non') || FORMES[s.forme].rond);
    const sorties = {};
    for (const o of p.sorties) {
      const c = o.largeur ? redimensionner(src, { largeur: o.largeur, hauteur: o.hauteur }) : redimensionner(src, { cote: o.cote, carre: o.carre });
      const r = await encoder(c, { qualite: o.qualite, tailleMax: o.tailleMax, transparent: transparent || o.transparent, forcer: o.png ? 'png' : o.jpeg ? 'jpeg' : null, tailleFixe: Boolean(o.largeur) });
      sorties[o.cle] = { ...r, transparent: transparent && r.type !== 'image/jpeg' };
    }
    return sorties;
  }

  function apercuUsage(url) {
    const nom = esc(contexte.nom || 'Ma boutique');
    const img = `<img src="${url}" alt="">`;
    switch (p.apercu) {
      case 'facture': return `<div class="apercu-usage apercu-facture"><span class="apercu-facture-logo">${img}</span><span class="apercu-facture-lignes"><strong>${nom}</strong><span></span><span></span></span><span class="apercu-facture-titre">FACTURE</span></div>
        <div class="apercu-usage-variantes"><span class="apercu-blanc">${img}</span><span class="apercu-rond">${img}</span></div><p class="discret">Aperçu sur la facture · version blanche et ronde créées automatiquement</p>`;
      case 'signature': return `<div class="apercu-usage apercu-sig"><span>Cachet &amp; signature de la boutique</span>${img}</div><p class="discret">Aperçu dans la zone de signature des documents</p>`;
      case 'carte': return `<div class="apercu-usage apercu-cartes"><div class="apercu-carte-article"><span class="apercu-carte-image">${img}</span><strong>${esc(contexte.nom || 'Article')}</strong><span>${contexte.prix ? `${formatNombre(contexte.prix)} GNF` : ''}</span></div>
        <div class="apercu-ligne-article"><span class="apercu-ligne-image">${img}</span><span><strong>${esc(contexte.nom || 'Article')}</strong><br><span class="discret">Liste (miniature)</span></span></div></div>`;
      case 'couverture': return `<div class="apercu-usage apercu-couverture"><img src="${url}" alt=""><span class="apercu-couverture-degrade"></span><strong>${nom}</strong></div><p class="discret">Aperçu sur la boutique en ligne · un dégradé garde le nom lisible</p>`;
      case 'pied': return `<div class="apercu-usage apercu-pied"><span class="discret">Paiement :</span><span class="apercu-pied-logo">${img}</span><span class="badge-texte-paiement">Espèces</span></div><p class="discret">Aperçu en bas des factures et sur la vitrine (22 px de haut)</p>`;
      default: return `<div class="apercu-usage apercu-photo">${img}</div>`;
    }
  }

  async function finir(bouton) {
    boutonOccupe(bouton, true, 'Enregistrement…');
    try {
      await enregistrer(s.sorties);
      fermer();
    } catch (err) {
      boutonOccupe(bouton, false);
      montrerErreur(messageErreur(err));
    }
  }

  /* ------------------------------------------------------------ Événements */

  el.addEventListener('change', (e) => {
    if (e.target.matches('[data-fichier]')) { const f = e.target.files?.[0]; if (f) charger(f); return; }
    if (e.target.matches('[data-zone="fond"]')) {
      s.fond = e.target.checked;
      s.ia = null;
      q('[data-zone="reglage-seuil"]').hidden = !s.fond;
      majNettoyage();
    }
  });
  el.addEventListener('input', (e) => {
    if (e.target.matches('[data-zone="seuil"]')) { s.seuil = Number(e.target.value); majNettoyage(); }
  });
  el.addEventListener('click', async (e) => {
    const forme = e.target.closest('[data-forme]');
    if (forme) { s.forme = forme.dataset.forme; renderRecadrer(); return; }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const bouton = e.target.closest('button');
    if (action === 'pivoter') { s.image = pivoter(s.image); placer(true); return; }
    if (action === 'retour-choix') { s.dessin = false; aller(0); return; }
    if (action === 'precedent') { aller(s.etape === 3 && p.fond === 'non' ? 1 : s.etape - 1); return; }
    if (action === 'ia') { if (!s.ia) lancerIa(bouton); return; }
    if (action === 'dessiner') { renderDessin(); return; }
    if (action === 'effacer') { renderDessin(); return; }
    if (action === 'valider-dessin') {
      if (!s.traits) { montrerErreur('Signez d’abord dans le cadre.'); return; }
      const toile = corps.querySelector('canvas');
      const copie = nouveauCanvas(toile.width, toile.height);
      copie.getContext('2d').drawImage(toile, 0, 0);
      s.image = copie; s.coupe = copie; s.forme = 'libre'; s.fond = true; s.seuil = 250;
      s.etape = 1;
      aller(2);
      return;
    }
    if (action === 'suivant') {
      if (s.etape === 1) { s.coupe = decouper(); s.ia = null; }
      if (s.etape === 2 && !s.propre) { montrerErreur('Plus rien de visible : baissez la sensibilité ou éteignez « Retirer le fond blanc ».'); return; }
      aller(s.etape + 1);
      return;
    }
    if (action === 'enregistrer') finir(bouton);
  });
  const surRedimension = () => { if (s.etape === 1) placer(false); };
  window.addEventListener('resize', surRedimension);

  if (source) charger(source); else aller(0);
  return { el, fermer };
}
