/**
 * identite.js — Paramètres → Logo & images (#/identite, gérant et propriétaire), maquettes Identite et Couverture.
 *  - logo principal (aperçu, infos, couleurs détectées → documents, versions blanche et ronde) ;
 *  - où apparaît le logo (logo_usages) ; moyens de paiement (Orange Money, MTN MoMo, Espèces) avec le logo
 *    officiel importé par la boutique ; logos partenaires (6 max) ;
 *  - photo de couverture de la vitrine (ou couverture par défaut de l'activité) ;
 *  - toutes les images de la boutique (compteurs, espace utilisé) et « Générer les miniatures manquantes ».
 */
import { sb } from './supabase.js';
import { etat } from './state.js';
import { esc, icone, toast, boutonOccupe, messageErreur, confirmer, formatNombre, initiales, differer } from './utils.js';
import { chargerReglages, oublierReglages } from './documents/donnees.js';
import { ouvrirOutilImage } from './images/outil.js';
import { modifierLogo } from './images/actions.js';
import {
  retirerLogo, enregistrerCouverture, retirerCouverture, envoyerLogoAnnexe, supprimerPublics, quotaPhotos, listerDossier, enregistrerMiniature
} from './images/envoi.js';
import { chargerCanvas, couleursDominantes, aDeLaTransparence, redimensionner, encoder } from './images/traitement.js';
import { couvertureDefaut, LIBELLES_ACTIVITE } from './images/couverture.js';

const USAGES = [
  ['factures', 'Factures & reçus A4', 'En-tête'],
  ['ticket', 'Ticket 80 mm', 'Noir et blanc automatique'],
  ['vitrine', 'Boutique en ligne', 'Carte sous la couverture'],
  ['affiches', 'Affiches du jour', 'Haut de l’affiche'],
  ['devis', 'Devis & bons de livraison', 'Même en-tête que les factures'],
  ['apercu', 'Messages WhatsApp', 'Aperçu des liens partagés']
];
const ko = (o) => `${formatNombre(Math.max(1, Math.round((Number(o) || 0) / 1024)))} Ko`;
const mo = (o) => `${formatNombre((Number(o) || 0) / 1048576, 1)} Mo`;

export function afficherIdentite(conteneur) {
  const boutique = etat.boutique;
  const s = { r: null, couverture: {}, logo: null, compteurs: null, miniaturesManquantes: [], enCours: false };

  conteneur.innerHTML = `
    <div class="page page-identite">
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour" href="#/parametres">← Paramètres</a>
          <h1>Identité de la boutique</h1>
          <span class="discret">Paramètres → Logo &amp; images · un seul logo, utilisé partout automatiquement</span>
        </div>
        <span class="discret" data-zone="etat-sauvegarde" aria-live="polite"></span>
      </header>
      <div data-zone="corps"><div class="squelette" style="height:420px"></div></div>
    </div>`;
  const q = (sel) => conteneur.querySelector(sel);

  async function charger() {
    try {
      const [r, couv] = await Promise.all([
        chargerReglages(boutique.id, { recharger: true }),
        sb.from('boutiques_en_ligne').select('couverture_url, couverture_mini').eq('boutique_id', boutique.id).maybeSingle()
      ]);
      s.r = structuredClone(r);
      s.couverture = couv.data || {};
    } catch (err) {
      q('[data-zone="corps"]').innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(messageErreur(err))}</p>`;
      return;
    }
    if (!conteneur.isConnected) return;
    render();
    analyserLogo();
    compter();
  }

  /* ------------------------------------------------------------ Rendu */

  function render() {
    const r = s.r;
    const b = boutique;
    const logoImg = (taille) => (b.logo_url ? `<img src="${esc(b.logo_url)}" alt="" width="${taille}" height="${taille}" decoding="async">` : `<span class="identite-initiales">${esc(initiales(b.nom))}</span>`);
    const photoCouv = s.couverture.couverture_url || s.couverture.couverture_mini;
    q('[data-zone="corps"]').innerHTML = `
      <div class="identite-rangee">
        <section class="carte identite-section identite-logo"><h2>Logo principal</h2>
          <div class="identite-logo-ligne">
            <div class="damier identite-logo-apercu">${logoImg(120)}</div>
            <div class="identite-logo-infos">
              <span class="gras" data-zone="logo-infos">${b.logo_url ? 'Analyse du logo…' : 'Aucun logo : les initiales sont utilisées.'}</span>
              <span class="discret" data-zone="logo-details"></span>
              <div class="identite-boutons">
                <button type="button" class="btn btn-primaire" data-action="logo">${b.logo_url ? 'Changer le logo' : 'Ajouter un logo'}</button>
                ${b.logo_url ? `<button type="button" class="btn btn-secondaire" data-action="recadrer-logo">Recadrer</button>
                <button type="button" class="btn btn-secondaire btn-texte-danger" data-action="retirer-logo">Retirer</button>` : ''}
              </div>
            </div>
          </div>
          ${b.logo_url ? `<div class="identite-variantes">
            <div class="identite-variante"><span class="variante-blanche">${logoImg(32)}</span><span><strong>Version blanche</strong><br><span class="discret">créée automatiquement pour les fonds foncés</span></span></div>
            <div class="identite-variante"><span class="variante-ronde">${logoImg(44)}</span><span><strong>Version ronde</strong><br><span class="discret">vitrine, WhatsApp, admin</span></span></div>
          </div>` : ''}
        </section>
        <section class="carte identite-section identite-usages"><div class="identite-titre"><h2>Où apparaît votre logo</h2><span class="discret">Décochez un endroit pour le masquer</span></div>
          <div class="grille-usages">${USAGES.map(([cle, titre, aide]) => `
            <label class="carte-usage ${r.logo_usages[cle] ? 'active' : ''}">
              <span class="usage-apercu usage-${cle}">${miniUsage(cle, logoImg)}</span>
              <span class="gras">${titre}</span><span class="discret">${aide}</span>
              <span class="usage-case"><input type="checkbox" data-usage="${cle}" ${r.logo_usages[cle] ? 'checked' : ''}> ${r.logo_usages[cle] ? 'Activé' : 'Masqué'}</span>
            </label>`).join('')}</div>
        </section>
      </div>

      <div class="identite-rangee">
        <section class="carte identite-section identite-couverture"><h2>Photo de couverture de la boutique en ligne</h2>
          <div class="couverture-apercu">
            ${photoCouv ? `<img src="${esc(s.couverture.couverture_mini || s.couverture.couverture_url)}" alt="" width="800" height="450" decoding="async">` : couvertureDefaut(b.type_activite, r.couleur, r.accent)}
            <span class="couverture-degrade"></span>
            <span class="couverture-nom">${esc(b.nom)}</span>
            <span class="couverture-zone-mobile"><span>zone visible sur téléphone</span></span>
            <span class="couverture-boutons">
              <button type="button" class="btn btn-verre" data-action="couverture">${photoCouv ? 'Changer' : 'Ajouter une photo'}</button>
              ${photoCouv ? `<button type="button" class="btn btn-verre" data-action="recadrer-couverture">Recadrer</button>
              <button type="button" class="btn btn-verre btn-texte-danger" data-action="retirer-couverture">Retirer</button>` : ''}
            </span>
          </div>
          <p class="identite-conseils"><strong>Conseils :</strong> photo de la devanture ou de vos rayons, de jour, en largeur. Format 16:9, recadrée et compressée automatiquement (≈ 120 Ko).<br>
            <strong>Lisibilité :</strong> un dégradé sombre est ajouté en bas pour que le nom reste lisible sur toutes les photos.</p>
          <span class="gras">${photoCouv ? 'Sans photo, la boutique affiche' : 'Pas de photo ? La boutique affiche'} une couverture adaptée à son activité, aux couleurs de vos documents :</span>
          <div class="couvertures-modeles">${Object.keys(LIBELLES_ACTIVITE).map((type) => `
            <div class="couverture-modele ${type === (b.type_activite || 'general') ? 'actuelle' : ''}">${couvertureDefaut(type, r.couleur, r.accent, { etiquette: `Modèle ${LIBELLES_ACTIVITE[type]}` })}</div>`).join('')}</div>
        </section>

        <section class="carte identite-section identite-paiements"><h2>Moyens de paiement acceptés</h2>
          ${['om', 'momo'].map((cle) => {
            const p = r.paiements[cle];
            const nom = cle === 'om' ? 'Orange Money' : 'MTN MoMo';
            return `<div class="moyen-paiement">
              <button type="button" class="logo-paiement ${p.logo_url ? 'avec-logo' : ''}" data-action="logo-paiement" data-cle="${cle}" aria-label="${p.logo_url ? `Changer le logo ${nom}` : `Importer le logo officiel ${nom}`}">
                ${p.logo_url ? `<img src="${esc(p.logo_url)}" alt="${nom}" height="40">` : 'Importer le logo officiel'}</button>
              <span class="moyen-textes"><strong>${nom}</strong>
                <input type="tel" inputmode="tel" class="input input-petit" data-numero="${cle}" value="${esc(p.numero || '')}" placeholder="Numéro marchand" aria-label="Numéro ${nom}">
                ${p.logo_url ? `<button type="button" class="btn-lien btn-lien-danger btn-lien-gauche" data-action="retirer-logo-paiement" data-cle="${cle}">Retirer le logo</button>` : ''}</span>
              <input type="checkbox" class="bascule-doc" role="switch" data-paiement="${cle}" ${p.actif ? 'checked' : ''} aria-label="${nom} accepté"></div>`;
          }).join('')}
          <div class="moyen-paiement"><span class="logo-paiement sans">—</span><span class="moyen-textes"><strong>Espèces</strong><span class="discret">À la livraison ou au retrait</span></span>
            <input type="checkbox" class="bascule-doc" role="switch" data-paiement="especes" ${r.paiements.especes.actif ? 'checked' : ''} aria-label="Espèces acceptées"></div>
          <p class="identite-note">Le logo officiel est celui fourni par l’opérateur à ses marchands (kit marchand, autocollant « Paiement accepté ici »). Il s’affiche sur la vitrine et en bas des factures. Sans logo importé, un badge texte s’affiche.</p>
        </section>
      </div>

      <section class="carte identite-section"><div class="identite-titre"><h2>Logos partenaires <span class="discret">(jusqu’à 6)</span></h2><span class="discret">Affichés en petit en bas des factures, devis et de la boutique en ligne</span></div>
        <div class="partenaires-ligne">
          ${r.partenaires.map((x, i) => `<div class="partenaire">
            <span class="partenaire-logo"><img src="${esc(x.logo_url)}" alt="" height="44"></span>
            <input type="text" class="input input-petit" maxlength="40" data-nom-partenaire="${i}" value="${esc(x.nom || '')}" placeholder="Nom" aria-label="Nom du partenaire ${i + 1}">
            <span class="partenaire-actions">
              <button type="button" class="btn-icone btn-icone-clair" data-monter="${i}" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button type="button" class="btn-icone btn-icone-clair" data-descendre="${i}" aria-label="Descendre" ${i === r.partenaires.length - 1 ? 'disabled' : ''}>↓</button>
              <button type="button" class="btn-icone btn-icone-clair btn-icone-danger" data-supprimer-partenaire="${i}" aria-label="Supprimer">${icone('corbeille', 16, 2)}</button>
            </span></div>`).join('')}
          ${r.partenaires.length < 6 ? '<button type="button" class="partenaire-ajouter" data-action="ajouter-partenaire"><span>+</span>Ajouter</button>' : ''}
          <p class="identite-note partenaires-aide">Exemples : les marques que vous distribuez (CIMAF, Ciment de Guinée…), un label ou une certification.</p>
        </div>
      </section>

      <section class="carte identite-section"><h2>Toutes les images de la boutique</h2>
        <div class="grille-compteurs" data-zone="compteurs"><div class="squelette" style="height:96px"></div></div>
        <p class="discret" data-zone="espace">Calcul de l’espace utilisé…</p>
        <div data-zone="miniatures"></div>
      </section>`;
  }

  function miniUsage(cle, logoImg) {
    const l = logoImg(28);
    switch (cle) {
      case 'factures': return `<span class="mu-doc">${l}<span class="mu-lignes"><i></i><i></i><i></i></span></span>`;
      case 'ticket': return `<span class="mu-ticket"><span class="gris">${logoImg(22)}</span><i></i><i></i></span>`;
      case 'vitrine': return `<span class="mu-vitrine"><span class="mu-pastille">${logoImg(24)}</span><i></i></span>`;
      case 'affiches': return `<span class="mu-affiche">${logoImg(18)}<i></i></span>`;
      case 'devis': return `<span class="mu-doc">${l}<b>PROFORMA</b></span>`;
      default: return `<span class="mu-wa">${l}<span class="mu-lignes"><i></i><i></i></span></span>`;
    }
  }

  /* ------------------------------------------------------------ Logo : infos et couleurs */

  async function analyserLogo() {
    if (!boutique.logo_url) return;
    try {
      const reponse = await fetch(boutique.logo_url, { cache: 'force-cache' });
      const blob = await reponse.blob();
      const c = await chargerCanvas(blob);
      const couleurs = couleursDominantes(c);
      const transparent = aDeLaTransparence(c);
      s.logo = { couleurs };
      const nomFichier = decodeURIComponent(boutique.logo_url.split('/').pop().split('?')[0]);
      const infos = q('[data-zone="logo-infos"]');
      const details = q('[data-zone="logo-details"]');
      if (!infos) return;
      infos.textContent = `${nomFichier} · ${c.width} × ${c.height} · ${ko(blob.size)}`;
      details.innerHTML = `${transparent ? 'Fond transparent ✓' : 'Fond opaque (retirez le fond blanc avec « Recadrer » si besoin)'} · ${Math.min(c.width, c.height) >= 240 ? 'net jusqu’à 120 px ✓' : 'petite image : préférez 512 px'}<br>
        ${couleurs.length ? `Couleurs détectées : ${couleurs.map((x) => `<span class="pastille-couleur-mini" style="background:${x}" title="${x}"></span>`).join(' ')}
        → <button type="button" class="btn-lien" data-action="appliquer-couleurs">appliquer aux documents</button>` : ''}`;
    } catch {
      const infos = q('[data-zone="logo-infos"]');
      if (infos) infos.textContent = 'Logo enregistré';
    }
  }

  /* ------------------------------------------------------------ Compteurs et espace */

  async function compter() {
    try {
      const [quota, bons, sansMini, produitsF, documentsF] = await Promise.all([
        quotaPhotos(boutique.id),
        sb.from('chantier_mouvements').select('id', { count: 'exact', head: true }).eq('boutique_id', boutique.id).not('photo_path', 'is', null),
        sb.from('produits').select('id, nom, photo_url, photo_mini_url').eq('boutique_id', boutique.id).not('photo_url', 'is', null).is('photo_mini_url', null).limit(1000),
        listerDossier('produits', boutique.id),
        listerDossier('documents', boutique.id)
      ]);
      const r = s.r;
      const logos = ['om', 'momo'].filter((k) => r.paiements[k].logo_url).length + r.partenaires.length;
      s.miniaturesManquantes = sansMini.data || [];
      const cases = [
        ['LOGO', boutique.logo_url ? '1' : '0', 'Logo principal', 'Factures, vitrine…', '#1F3A5F'],
        ['CACHET', r.cachet_path ? '1' : '0', 'Cachet', 'Documents', '#0F7B5F'],
        ['SIGN.', r.signature_path ? '1' : '0', 'Signature', 'Documents', '#55665F'],
        [quota ? `${formatNombre(quota.utilisees)} / ${formatNombre(quota.max)}` : '—', null, 'Photos d’articles', 'Stock, vitrine, affiches', '#8A6A3A'],
        [String(bons.count ?? '—'), null, 'Bons d’enlèvement', 'Chantiers', '#7A4A00'],
        [String(logos), null, 'Logos partenaires et paiement', 'Bas des documents', '#B4520A']
      ];
      const zone = q('[data-zone="compteurs"]');
      if (!zone) return;
      zone.innerHTML = cases.map(([gros, petit, titre, aide, fond]) => `
        <div class="compteur-image"><span class="compteur-tuile" style="background:${fond}">${esc(gros)}${petit !== null ? `<small>${petit === '1' ? 'présent' : 'absent'}</small>` : ''}</span>
          <span class="gras">${titre}</span><span class="discret">${aide}</span></div>`).join('');
      const octets = produitsF.octets + documentsF.octets;
      q('[data-zone="espace"]').textContent = `Espace utilisé : ${mo(octets)} (${formatNombre(produitsF.fichiers.length + documentsF.fichiers.length)} fichiers, hors bons d’enlèvement) · les images sont compressées automatiquement (photos ≤ 150 Ko, miniatures ≈ 25 Ko).`;
      renderMiniatures();
    } catch (err) {
      const z = q('[data-zone="espace"]');
      if (z) z.textContent = messageErreur(err);
    }
  }

  function renderMiniatures(progres = null) {
    const zone = q('[data-zone="miniatures"]');
    if (!zone) return;
    const n = s.miniaturesManquantes.length;
    if (!n && !progres) { zone.innerHTML = ''; return; }
    zone.innerHTML = progres
      ? `<div class="miniatures-progres"><span>${esc(progres.texte)}</span><div class="barre-progres" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progres.pct}"><span style="width:${progres.pct}%"></span></div></div>`
      : `<div class="miniatures-manquantes"><span>${n} photo${n > 1 ? 's' : ''} d’article sans miniature : les listes chargent la grande photo (plus lent).</span>
          <button type="button" class="btn btn-secondaire" data-action="miniatures">Générer les miniatures manquantes</button></div>`;
  }

  async function genererMiniatures() {
    const liste = [...s.miniaturesManquantes];
    let faites = 0;
    let echecs = 0;
    for (const p of liste) {
      renderMiniatures({ texte: `Miniature ${faites + echecs + 1} / ${liste.length} · ${p.nom}`, pct: Math.round(((faites + echecs) / liste.length) * 100) });
      try {
        const r = await fetch(p.photo_url, { cache: 'no-store' });
        if (!r.ok) throw new Error('Photo introuvable');
        const c = await chargerCanvas(await r.blob());
        const sortie = await encoder(redimensionner(c, { cote: 300 }), { qualite: 0.7, tailleMax: 30 * 1024 });
        await enregistrerMiniature(p, sortie);
        faites++;
      } catch (err) {
        console.warn('[YOUMMA] Miniature impossible :', p.nom, err);
        echecs++;
      }
      if (!conteneur.isConnected) return;
    }
    toast(`${faites} miniature${faites > 1 ? 's' : ''} créée${faites > 1 ? 's' : ''}${echecs ? ` · ${echecs} échec${echecs > 1 ? 's' : ''}` : ''}.`, echecs ? 'info' : 'succes');
    compter();
  }

  /* ------------------------------------------------------------ Sauvegarde des réglages */

  function etatSauvegarde(texte) {
    const z = q('[data-zone="etat-sauvegarde"]');
    if (z) z.textContent = texte;
  }

  async function sauver(valeurs) {
    etatSauvegarde('Enregistrement…');
    const { error } = await sb.from('boutique_documents').update(valeurs).eq('boutique_id', boutique.id);
    if (error) { etatSauvegarde(''); toast(messageErreur(error), 'erreur'); return false; }
    oublierReglages(boutique.id);
    etatSauvegarde('Enregistré ✓');
    return true;
  }
  const sauverPaiementsPlusTard = differer(() => sauver({ paiements: s.r.paiements }), 700);
  const sauverPartenairesPlusTard = differer(() => sauver({ partenaires: s.r.partenaires }), 700);

  /* ------------------------------------------------------------ Événements */

  conteneur.addEventListener('change', async (e) => {
    const t = e.target;
    if (!s.r) return;
    if (t.dataset.usage) {
      s.r.logo_usages = { ...s.r.logo_usages, [t.dataset.usage]: t.checked };
      const carte = t.closest('.carte-usage');
      carte.classList.toggle('active', t.checked);
      carte.querySelector('.usage-case').lastChild.textContent = t.checked ? ' Activé' : ' Masqué';
      await sauver({ logo_usages: s.r.logo_usages });
    }
    if (t.dataset.paiement) {
      s.r.paiements = { ...s.r.paiements, [t.dataset.paiement]: { ...s.r.paiements[t.dataset.paiement], actif: t.checked } };
      sauverPaiementsPlusTard();
    }
  });
  conteneur.addEventListener('input', (e) => {
    const t = e.target;
    if (!s.r) return;
    if (t.dataset.numero) {
      s.r.paiements[t.dataset.numero] = { ...s.r.paiements[t.dataset.numero], numero: t.value.trim() };
      sauverPaiementsPlusTard();
    }
    if (t.dataset.nomPartenaire !== undefined) {
      s.r.partenaires[Number(t.dataset.nomPartenaire)].nom = t.value.trim();
      sauverPartenairesPlusTard();
    }
  });

  conteneur.addEventListener('click', async (e) => {
    if (!s.r) return;
    const action = e.target.closest('[data-action]')?.dataset.action;
    const bouton = e.target.closest('button');
    const monter = e.target.closest('[data-monter]');
    const descendre = e.target.closest('[data-descendre]');
    const suppr = e.target.closest('[data-supprimer-partenaire]');
    if (monter || descendre) {
      const i = Number((monter || descendre).dataset[monter ? 'monter' : 'descendre']);
      const j = monter ? i - 1 : i + 1;
      const liste = [...s.r.partenaires];
      [liste[i], liste[j]] = [liste[j], liste[i]];
      s.r.partenaires = liste;
      render(); compterSansRecharger();
      await sauver({ partenaires: liste });
      return;
    }
    if (suppr) {
      const i = Number(suppr.dataset.supprimerPartenaire);
      const x = s.r.partenaires[i];
      if (!(await confirmer(`Retirer le logo ${x.nom ? `« ${x.nom} »` : 'partenaire'} ?`, { titre: 'Logo partenaire', libelleOk: 'Retirer', danger: true }))) return;
      s.r.partenaires = s.r.partenaires.filter((_, k) => k !== i);
      if (await sauver({ partenaires: s.r.partenaires })) await supprimerPublics(x.logo_url);
      render(); compterSansRecharger();
      return;
    }
    switch (action) {
      case 'logo': modifierLogo({ nom: boutique.nom, apres: () => { render(); analyserLogo(); compterSansRecharger(); } }); break;
      case 'recadrer-logo': modifierLogo({ source: boutique.logo_url, nom: boutique.nom, apres: () => { render(); analyserLogo(); } }); break;
      case 'retirer-logo':
        if (!(await confirmer('Le logo sera retiré des factures, de la vitrine et des affiches (les initiales le remplacent).', { titre: 'Retirer le logo', libelleOk: 'Retirer', danger: true }))) return;
        try { await retirerLogo(); toast('Logo retiré.', 'succes'); render(); compterSansRecharger(); } catch (err) { toast(messageErreur(err), 'erreur'); }
        break;
      case 'appliquer-couleurs': {
        const [c1, c2] = s.logo?.couleurs || [];
        if (!c1) return;
        const valeurs = { couleur: c1, ...(c2 ? { accent: c2 } : {}) };
        if (await sauver(valeurs)) { Object.assign(s.r, valeurs); toast('Couleurs du logo appliquées aux factures et devis.', 'succes'); render(); analyserLogo(); compterSansRecharger(); }
        break;
      }
      case 'couverture':
      case 'recadrer-couverture':
        ouvrirOutilImage({
          usage: 'couverture',
          source: action === 'recadrer-couverture' ? s.couverture.couverture_url : null,
          contexte: { nom: boutique.nom },
          enregistrer: async (sorties) => {
            const r = await enregistrerCouverture(sorties, s.couverture);
            s.couverture = { couverture_url: r.url, couverture_mini: r.mini };
            toast(`Couverture enregistrée (${ko(sorties.grande.blob.size)} + ${ko(sorties.mini.blob.size)} pour les téléphones).`, 'succes');
            render(); analyserLogo(); compterSansRecharger();
          }
        });
        break;
      case 'retirer-couverture':
        if (!(await confirmer('La couverture par défaut de votre activité sera affichée à la place.', { titre: 'Retirer la photo', libelleOk: 'Retirer', danger: true }))) return;
        try { await retirerCouverture(s.couverture); s.couverture = {}; toast('Photo de couverture retirée.', 'succes'); render(); analyserLogo(); compterSansRecharger(); } catch (err) { toast(messageErreur(err), 'erreur'); }
        break;
      case 'logo-paiement': {
        const cle = bouton.dataset.cle;
        ouvrirOutilImage({
          usage: 'paiement',
          titre: `Logo officiel ${cle === 'om' ? 'Orange Money' : 'MTN MoMo'}`,
          enregistrer: async (sorties) => {
            const url = await envoyerLogoAnnexe(`paiement-${cle}`, sorties);
            const ancien = s.r.paiements[cle].logo_url;
            s.r.paiements[cle] = { ...s.r.paiements[cle], logo_url: url, actif: true };
            if (!(await sauver({ paiements: s.r.paiements }))) { await supprimerPublics(url); throw new Error('Enregistrement impossible'); }
            if (ancien) await supprimerPublics(ancien);
            toast('Logo officiel importé.', 'succes');
            render(); analyserLogo(); compterSansRecharger();
          }
        });
        break;
      }
      case 'retirer-logo-paiement': {
        const cle = bouton.dataset.cle;
        const ancien = s.r.paiements[cle].logo_url;
        s.r.paiements[cle] = { ...s.r.paiements[cle], logo_url: null };
        if (await sauver({ paiements: s.r.paiements })) await supprimerPublics(ancien);
        render(); analyserLogo(); compterSansRecharger();
        break;
      }
      case 'ajouter-partenaire':
        ouvrirOutilImage({
          usage: 'partenaire',
          enregistrer: async (sorties) => {
            const url = await envoyerLogoAnnexe('partenaire', sorties);
            s.r.partenaires = [...s.r.partenaires, { nom: '', logo_url: url }].slice(0, 6);
            if (!(await sauver({ partenaires: s.r.partenaires }))) { await supprimerPublics(url); throw new Error('Enregistrement impossible'); }
            toast('Logo ajouté : indiquez son nom.', 'succes');
            render(); analyserLogo(); compterSansRecharger();
            conteneur.querySelector(`[data-nom-partenaire="${s.r.partenaires.length - 1}"]`)?.focus();
          }
        });
        break;
      case 'miniatures':
        if (s.enCours) return;
        s.enCours = true;
        boutonOccupe(bouton, true, 'Préparation…');
        try { await genererMiniatures(); } finally { s.enCours = false; }
        break;
      default:
    }
  });

  /** Après un changement : recompte sans relire les réglages (déjà à jour). */
  function compterSansRecharger() { compter(); }

  charger();
  return () => {};
}
