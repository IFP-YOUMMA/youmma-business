#!/usr/bin/env node
/**
 * outils/generer-apercus.mjs — Étape 27 : chaque vitrine a son propre aperçu au partage.
 *
 * WhatsApp, Facebook et Google ne lisent pas le JavaScript : ils prennent le HTML tel qu'il est servi. On écrit donc
 * une vraie page par vitrine active, b/<slug>/index.html, copie de b/index.html avec ses propres balises (titre,
 * description, og:, twitter:, canonical). js/vitrine.js lit déjà le slug dans le chemin : rien ne change dans la vitrine.
 *
 *  - données : apercus_vitrines(), fonction publique, appelée avec l'URL et la clé publique déjà présentes dans
 *    js/config.js (aucune autre clé, aucun secret) ; titre et phrase pris tels quels, rien n'est inventé ici ;
 *  - les chemins relatifs « ../ » deviennent « ../../ » (la page descend d'un niveau) ;
 *  - une vitrine qui n'est plus renvoyée perd son dossier (seulement les dossiers écrits par ce script, reconnus à leur
 *    marque) ; un fichier n'est écrit que s'il a changé.
 * Usage : node outils/generer-apercus.mjs   (sans dépendance, Node 18 ou plus).
 */
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIER_B = path.join(RACINE, 'b');
const BASE_PUBLIQUE = 'https://ifp-youmma.github.io/youmma-business';
const MARQUE = '<!-- Page générée par outils/generer-apercus.mjs : ne pas modifier à la main. -->';
const SLUG = /^[a-z0-9-]{3,40}$/;

/** URL et clé publique, lues dans js/config.js (la même clé que l'appli : publique par construction). */
async function lireConfig() {
  const texte = await readFile(path.join(RACINE, 'js', 'config.js'), 'utf8');
  const url = texte.match(/SUPABASE_URL\s*=\s*'([^']+)'/)?.[1];
  const cle = texte.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)?.[1];
  if (!url || !cle) throw new Error('js/config.js : SUPABASE_URL ou SUPABASE_ANON_KEY introuvable.');
  return { url, cle };
}

async function apercusVitrines({ url, cle }) {
  const r = await fetch(`${url}/rest/v1/rpc/apercus_vitrines`, {
    method: 'POST',
    headers: { apikey: cle, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}'
  });
  if (!r.ok) throw new Error(`apercus_vitrines a répondu ${r.status} : ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  // Une réponse qui n'est pas un tableau n'est pas une liste de vitrines : on s'arrête sans rien supprimer.
  if (!Array.isArray(data)) throw new Error('apercus_vitrines : la réponse n’est pas un tableau.');
  return data;
}

/** Contenu d'attribut HTML : un nom peut contenir une apostrophe, un guillemet, une esperluette. */
const attr = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const texteHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Page d'une vitrine à partir de b/index.html : balises d'aperçu de la boutique, canonical, chemins ../ → ../../.
 * Balises remplacées : <title>, description, og:*, twitter:* ; les autres lignes restent identiques.
 */
function pageVitrine(modele, v) {
  const adresse = `${BASE_PUBLIQUE}/b/${v.slug}/`;
  const imageYoumma = modele.match(/<meta property="og:image" content="([^"]+)">/)?.[1];
  const image = v.image || imageYoumma;
  const balises = [
    `<meta name="description" content="${attr(v.phrase)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${attr(v.titre)}">`,
    `<meta property="og:description" content="${attr(v.phrase)}">`,
    `<meta property="og:url" content="${attr(adresse)}">`,
    ...(image ? [`<meta property="og:image" content="${attr(image)}">`] : []),
    // Dimensions connues seulement pour l'image YOUMMA (1200 × 630) ; celles d'une couverture ne sont pas fournies.
    ...(!v.image && imageYoumma ? ['<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">'] : []),
    `<meta property="og:image:alt" content="${attr(v.nom || v.titre)}">`,
    '<meta property="og:locale" content="fr_FR">',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${attr(v.titre)}">`,
    `<meta name="twitter:description" content="${attr(v.phrase)}">`,
    ...(image ? [`<meta name="twitter:image" content="${attr(image)}">`] : []),
    `<link rel="canonical" href="${attr(adresse)}">`
  ].map((l) => `  ${l}`).join('\n');
  // Les anciennes balises d'aperçu disparaissent ; les nouvelles prennent la place de la première.
  const lignes = modele.split(/\r?\n/);
  const apercu = /^\s*<meta (?:name="description"|property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\s*$/;
  const premiere = lignes.findIndex((l) => apercu.test(l));
  if (premiere < 0) throw new Error('b/index.html : aucune balise d’aperçu trouvée (description, og:).');
  const gardees = lignes.filter((l, i) => i === premiere || !apercu.test(l));
  gardees[premiere] = balises;
  let html = gardees.join('\n')
    .replace(/<title>[^<]*<\/title>/, `<title>${texteHtml(v.titre)}</title>`)
    // La page descend d'un niveau : ../css, ../js, ../img → ../../…
    .replace(/((?:href|src)=")\.\.\//g, '$1../../');
  html = html.replace(/<html([^>]*)>/, `<html$1>\n${MARQUE}`);
  return html;
}

async function lireSiExiste(fichier) {
  try { return await readFile(fichier, 'utf8'); } catch { return null; }
}

async function main() {
  const config = await lireConfig();
  const modele = await readFile(path.join(DOSSIER_B, 'index.html'), 'utf8');
  const vitrines = (await apercusVitrines(config)).filter((v) => {
    const ok = v && SLUG.test(String(v.slug || '')) && v.titre && v.phrase;
    if (!ok) console.warn(`Ignorée (slug, titre ou phrase invalide) : ${JSON.stringify(v?.slug)}`);
    return ok;
  });
  const bilan = { creees: 0, majs: 0, supprimees: 0, inchangees: 0 };
  const actives = new Set();

  for (const v of vitrines) {
    actives.add(v.slug);
    const dossier = path.join(DOSSIER_B, v.slug);
    const fichier = path.join(dossier, 'index.html');
    const html = pageVitrine(modele, v);
    const avant = await lireSiExiste(fichier);
    // Comparaison sans les fins de ligne : Git peut les convertir à l'extraction (Windows).
    if (avant !== null && avant.replace(/\r\n/g, '\n') === html) { bilan.inchangees++; continue; }
    if (avant !== null && !avant.includes(MARQUE)) { console.warn(`b/${v.slug}/index.html existe et n’a pas été écrit par ce script : laissé tel quel.`); continue; }
    await mkdir(dossier, { recursive: true });
    await writeFile(fichier, html, 'utf8');
    if (avant === null) bilan.creees++; else bilan.majs++;
    console.log(`${avant === null ? 'créée' : 'mise à jour'} : b/${v.slug}/`);
  }

  // Vitrines désactivées : leur page ne doit pas promettre une boutique ouverte. Seuls nos dossiers sont supprimés.
  for (const entree of await readdir(DOSSIER_B, { withFileTypes: true })) {
    if (!entree.isDirectory() || actives.has(entree.name)) continue;
    const fichier = path.join(DOSSIER_B, entree.name, 'index.html');
    if (!existsSync(fichier) || !(await lireSiExiste(fichier))?.includes(MARQUE)) continue;
    await rm(path.join(DOSSIER_B, entree.name), { recursive: true, force: true });
    bilan.supprimees++;
    console.log(`supprimée : b/${entree.name}/`);
  }

  console.log(`Aperçus : ${bilan.creees} créée(s), ${bilan.majs} mise(s) à jour, ${bilan.supprimees} supprimée(s), ${bilan.inchangees} inchangée(s).`);
  // Pour l'action GitHub : le message du commit reprend ces nombres.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `creees=${bilan.creees}\nmajs=${bilan.majs}\nsupprimees=${bilan.supprimees}\nchangements=${bilan.creees + bilan.majs + bilan.supprimees}\n`);
  }
}

main().catch((err) => { console.error(`Échec : ${err.message}`); process.exit(1); });
