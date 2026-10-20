/**
 * variantes.js — Tailles & couleurs (module « variantes », étape 12) : données et panneau de choix.
 *
 * Un modèle garde UNE fiche (produits) ; son stock est compté par case taille × couleur (produit_variantes).
 * taille = '' : taille unique ; couleur = '' : une seule couleur. produits.stock = somme des cases (tenue par la base).
 * Les lignes de vente, d'enlèvement, de devis et de commande en ligne portent variante_id ; le serveur calcule
 * le prix (prix de la case, sinon celui du modèle) et écrit le nom de ligne « Nom — Bleu roi / M ».
 */
import { sb } from './supabase.js';
import { esc, icone, ouvrirModale, formatNombre, toast, messageErreur } from './utils.js';
import { vignetteProduit } from './images/affichage.js';

/** 16 couleurs courantes (palette « + Couleur ») : nom affiché et teinte. */
export const PALETTE_COULEURS = [
  ['Noir', '#111827'], ['Blanc', '#FFFFFF'], ['Gris', '#9CA3AF'], ['Beige', '#D9C9A3'],
  ['Marron', '#7C4A21'], ['Bleu marine', '#1E2A5A'], ['Bleu roi', '#1E40AF'], ['Bleu ciel', '#7DD3FC'],
  ['Vert', '#166534'], ['Vert olive', '#6B7A2E'], ['Jaune', '#FACC15'], ['Orange', '#F97316'],
  ['Rouge', '#DC2626'], ['Bordeaux', '#7F1D1D'], ['Rose', '#F472B6'], ['Violet', '#7C3AED']
];

/** Vrai si l'article est un modèle à tailles / couleurs (sinon : article simple, inchangé). */
export function aVariantes(p) {
  return (Array.isArray(p?.tailles) && p.tailles.length > 0) || (Array.isArray(p?.couleurs) && p.couleurs.length > 0);
}

/** « Bleu roi / M » (même règle que variante_libelle en base) ; « M » ou « Bleu roi » si un seul critère. */
export function libelleVariante(taille, couleur) {
  return [couleur, taille].map((x) => String(x || '').trim()).filter(Boolean).join(' / ');
}

/** Nom de ligne : « Robe bazin brodé — Bleu roi / M ». */
export function nomAvecVariante(nom, libelle) {
  return libelle ? `${nom} — ${libelle}` : nom;
}

/** Couleurs normalisées : [{ nom, hex, photo_url }] (accepte aussi une simple liste de noms). */
export function couleursDe(source) {
  const liste = Array.isArray(source) ? source : [];
  return liste.map((c) => (typeof c === 'string' ? { nom: c, hex: hexPalette(c), photo_url: null }
    : { nom: String(c?.nom || ''), hex: c?.hex || hexPalette(c?.nom), photo_url: c?.photo_url || null })).filter((c) => c.nom);
}

function hexPalette(nom) {
  const n = String(nom || '').trim().toLowerCase();
  return PALETTE_COULEURS.find(([libelle]) => libelle.toLowerCase() === n)?.[1] || '#C9D3CF';
}

/** Teinte claire (blanc, jaune, beige…) : contour pour rester visible. */
function claire(hex) {
  const m = String(hex || '').replace('#', '').match(/^([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return false;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 200;
}

/** Rond de couleur (aria-hidden). */
export function rondCouleur(hex, taille = 16) {
  return `<span class="rond-couleur ${claire(hex) ? 'rond-clair' : ''}" style="--rond:${esc(hex || '#C9D3CF')};width:${taille}px;height:${taille}px" aria-hidden="true"></span>`;
}

/* ------------------------------------------------------------ Données */

const cache = new Map();

function normaliserVariantes(brut) {
  const d = (Array.isArray(brut) ? brut[0] : brut) || {};
  const cases = (Array.isArray(d.cases) ? d.cases : []).map((c) => ({
    id: c.id,
    taille: c.taille || '',
    couleur: c.couleur || '',
    libelle: c.libelle || libelleVariante(c.taille, c.couleur),
    stock: Number(c.stock) || 0,
    prix: c.prix === null || c.prix === undefined ? null : Number(c.prix),
    code_barre: c.code_barre || null
  }));
  return {
    produit_id: d.produit_id,
    nom: d.nom || '',
    tailles: Array.isArray(d.tailles) ? d.tailles : [],
    couleurs: couleursDe(d.couleurs),
    stock: Number(d.stock) || cases.reduce((t, c) => t + c.stock, 0),
    prix: Number(d.prix) || 0,
    sur_commande: Boolean(d.sur_commande),
    cases
  };
}

/** Grille d'un modèle (variantes_produit), gardée en mémoire le temps de la page. */
export async function chargerVariantes(idProduit, { recharger = false } = {}) {
  if (!recharger && cache.has(idProduit)) return cache.get(idProduit);
  const { data, error } = await sb.rpc('variantes_produit', { p_produit: idProduit });
  if (error) throw error;
  const d = normaliserVariantes(data);
  cache.set(idProduit, d);
  return d;
}

/** Installe une grille déjà reçue (réponse d'enregistrer_variantes, par exemple). */
export function memoriserVariantes(brut) {
  const d = normaliserVariantes(brut);
  if (d.produit_id) cache.set(d.produit_id, d);
  return d;
}

/** Après une vente ou un mouvement : les grilles seront relues. */
export function oublierVariantes(idProduit = null) {
  if (idProduit) cache.delete(idProduit);
  else cache.clear();
}

/** Case d'après son code-barres (étiquette scannée), limitée aux articles connus de l'écran. */
export async function chercherVarianteParCode(code, idsProduits = null) {
  const valeur = String(code || '').trim();
  if (!valeur) return null;
  const { data, error } = await sb.from('produit_variantes').select('id, produit_id, taille, couleur, stock, prix, code_barre')
    .eq('code_barre', valeur).eq('actif', true).limit(5);
  if (error || !data?.length) return null;
  const c = data.find((x) => !idsProduits || idsProduits.has(x.produit_id));
  return c ? { ...c, stock: Number(c.stock) || 0, prix: c.prix === null || c.prix === undefined ? null : Number(c.prix), libelle: libelleVariante(c.taille, c.couleur) } : null;
}

/* ------------------------------------------------------------ Panneau de choix (caisse, devis, enlèvement) */

/**
 * Feuille du bas (téléphone) / fenêtre (ordinateur) : 1. Couleur · 2. Taille · 3. Quantité → « Ajouter · Bleu roi / M · 185 000 ».
 * produit : l'article (nom, photo, unite, sur_commande) ; prixModele : prix appliqué hors case ;
 * dejaPris(idCase) : quantité déjà dans le panier (plafond) ; controleStock : false pour un devis.
 * onAjout(cas, quantite) avec cas = { id, taille, couleur, libelle, stock, prix }.
 */
export async function ouvrirChoixVariante({ produit, prixModele, dejaPris = () => 0, controleStock = true, libelleAction = 'Ajouter', onAjout, onFermer = null, choixInitial = null, quantiteInitiale = 1 }) {
  let d;
  try {
    d = await chargerVariantes(produit.id);
  } catch (err) {
    toast(messageErreur(err), 'erreur');
    return;
  }
  const couleurs = d.couleurs.length ? d.couleurs : [{ nom: '', hex: null, photo_url: null }];
  const tailles = d.tailles.length ? d.tailles : [''];
  const avecCouleurs = couleurs.length > 1 || Boolean(couleurs[0].nom);
  const avecTailles = tailles.length > 1 || Boolean(tailles[0]);
  const caseDe = (t, c) => d.cases.find((x) => x.taille === t && x.couleur === c);
  const libre = (cas) => (!cas ? 0 : (controleStock && !produit.sur_commande ? Math.max(0, cas.stock - dejaPris(cas.id)) : Infinity));
  const total = d.cases.reduce((t, c) => t + c.stock, 0);

  const s = { couleur: null, taille: null, quantite: Math.max(1, Math.round(Number(quantiteInitiale) || 1)), ajoute: false };
  // Choix de départ : demandé (ligne de devis), sinon la première couleur qui a du stock ; taille seule → choisie.
  if (choixInitial) { s.couleur = choixInitial.couleur ?? null; s.taille = choixInitial.taille ?? null; }
  if (s.couleur === null) s.couleur = (couleurs.find((c) => tailles.some((t) => libre(caseDe(t, c.nom)) > 0)) || couleurs[0]).nom;
  if (!avecTailles) s.taille = tailles[0];

  const { el, fermer } = ouvrirModale({ titre: produit.nom, variante: 'feuille', contenu: '<div class="cv-variante" data-zone="choix"></div>', onFermer: () => { if (!s.ajoute) onFermer?.(); } });
  const cadre = el.querySelector('[data-zone="choix"]');

  function caseChoisie() { return s.taille === null ? null : caseDe(s.taille, s.couleur); }

  function render() {
    const cas = caseChoisie();
    const dispo = libre(cas);
    if (cas && dispo !== Infinity) s.quantite = Math.max(1, Math.min(s.quantite, dispo || 1));
    const prix = cas?.prix ?? prixModele;
    const couleur = couleurs.find((c) => c.nom === s.couleur);
    const photo = couleur?.photo_url ? { ...produit, photo_url: couleur.photo_url, photo_mini_url: couleur.photo_url } : produit;
    let etape = 0;
    const titreEtape = (texte) => `<span class="cv-etape">${++etape}. ${texte}</span>`;
    cadre.innerHTML = `
      <div class="cv-entete">
        <span class="cv-vignette">${vignetteProduit(photo, 60, icone('stock', 22, 1.8))}</span>
        <span class="cv-titres"><strong>${esc(produit.nom)}</strong>
          <span class="discret">${formatNombre(prixModele)} GNF${produit.sur_commande ? ' · sur commande' : ` · ${formatNombre(total)} en stock`}</span></span>
      </div>
      ${avecCouleurs ? `
        <div class="cv-bloc">
          ${titreEtape('Couleur')}
          <div class="cv-couleurs" role="radiogroup" aria-label="Couleur">
            ${couleurs.map((c) => {
              const stockCouleur = tailles.reduce((t, ta) => t + (caseDe(ta, c.nom)?.stock || 0), 0);
              return `<button type="button" class="pastille-choix ${c.nom === s.couleur ? 'actif' : ''} ${controleStock && !produit.sur_commande && !stockCouleur ? 'vide' : ''}" role="radio" aria-checked="${c.nom === s.couleur}" data-couleur="${esc(c.nom)}">
                ${rondCouleur(c.hex)}${esc(c.nom)}</button>`;
            }).join('')}
          </div>
        </div>` : ''}
      ${avecTailles ? `
        <div class="cv-bloc">
          ${titreEtape(`Taille${avecCouleurs && s.couleur ? ` — ${esc(s.couleur)}` : ''}`)}
          <div class="cv-tailles" role="radiogroup" aria-label="Taille">
            ${tailles.map((t) => {
              const c = caseDe(t, s.couleur);
              const n = libre(c);
              const absente = !c;
              const epuise = !absente && n <= 0;
              const sous = absente ? '—' : n === Infinity ? (c.prix !== null && c.prix !== prixModele ? formatNombre(c.prix) : '&nbsp;') : epuise ? 'épuisé' : n === 1 ? 'dernière' : `${formatNombre(n)} en stock`;
              return `<button type="button" class="taille-choix ${t === s.taille ? 'actif' : ''} ${epuise || absente ? 'epuise' : ''} ${n === 1 ? 'derniere' : ''}" role="radio" aria-checked="${t === s.taille}"
                data-taille="${esc(t)}" ${epuise || absente ? 'disabled' : ''} aria-label="${esc(`${t}${absente ? ' : n’existe pas' : epuise ? ' : épuisé' : n === Infinity ? '' : ` : ${n} en stock`}`)}">
                <span class="taille-valeur">${esc(t)}</span><span class="taille-stock">${sous}</span></button>`;
            }).join('')}
          </div>
        </div>` : ''}
      <div class="cv-quantite">
        ${titreEtape('Quantité')}
        <div class="stepper">
          <button type="button" data-qte="-1" aria-label="Diminuer la quantité" ${s.quantite <= 1 ? 'disabled' : ''}>−</button>
          <strong class="cv-qte" aria-live="polite">${s.quantite}</strong>
          <button type="button" data-qte="1" aria-label="Augmenter la quantité" ${!cas || s.quantite >= dispo ? 'disabled' : ''}>+</button>
        </div>
      </div>
      <button type="button" class="btn btn-primaire btn-grand btn-bloc" data-action="ajouter-variante" ${cas && dispo > 0 ? '' : 'disabled'}>
        ${cas ? esc(`${libelleAction} · ${cas.libelle || produit.nom} · ${formatNombre(prix * s.quantite)}`) : esc(avecTailles ? 'Choisissez la taille' : 'Choisissez la couleur')}
      </button>
      ${controleStock ? '<p class="cv-astuce">Astuce : scannez l’étiquette, la bonne taille et couleur sont choisies seules.</p>' : ''}`;
  }

  cadre.addEventListener('click', (e) => {
    const bc = e.target.closest('[data-couleur]');
    if (bc) {
      s.couleur = bc.dataset.couleur;
      if (avecTailles && s.taille !== null && libre(caseDe(s.taille, s.couleur)) <= 0) s.taille = null;
      render();
      return;
    }
    const bt = e.target.closest('[data-taille]');
    if (bt && !bt.disabled) { s.taille = bt.dataset.taille; render(); return; }
    const bq = e.target.closest('[data-qte]');
    if (bq && !bq.disabled) { s.quantite += Number(bq.dataset.qte); render(); return; }
    if (e.target.closest('[data-action="ajouter-variante"]')) {
      const cas = caseChoisie();
      if (!cas) return;
      s.ajoute = true;
      fermer();
      onAjout({ ...cas, prix: cas.prix }, s.quantite);
    }
  });
  render();
}
