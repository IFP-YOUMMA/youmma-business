/**
 * direction/accueil.js — #/ : le tableau de bord de direction (étape 20). UN SEUL appel : direction_accueil().
 *
 * De haut en bas : bandeau (bonjour, jour, résumé, recherche, initiale) · quatre KPI tels quels · les portes (rendues
 * génériquement : portes → lignes → cases, couleur et alerte venues du serveur) · décisions et métiers · la chaîne.
 * L'argent des clients en caisse (kpi « caisse ») n'est jamais rapproché de « Gagné ce mois » : carte à part, hachurée,
 * sans la couleur du gain, jamais additionnée.
 */
import { esc, icone, formatNombre, formatDate, capitaliser } from '../utils.js';
import { chargerAccueil, porte, routePorte, montant, valeurCase, classeTon, prenom } from './commun.js';
import { majLiens } from './shell.js';

/** Bouton d'une décision selon son type (tableau de l'étape 20) ; un type inconnu n'a pas de bouton. */
const ACTIONS = {
  licence_fin: (c) => ['Relancer', `#/fiche/${encodeURIComponent(c)}`],
  endormie: (c) => ['Appeler', `#/fiche/${encodeURIComponent(c)}`],
  vendeur_a_payer: (c) => ['Payer', `#/marche-monde?onglet=vendeurs&payer=${encodeURIComponent(c)}`],
  a_peser: () => ['Peser', '#/marche-monde?onglet=colis&filtre=a_peser']
};

/** Sous-titre de l'en-tête : les trois nombres de resume, dans cet ordre (les agences n'y figurent pas). */
const RESUME = [['boutiques', 'boutique', 'boutiques'], ['vendeurs', 'vendeur', 'vendeurs'], ['corridors', 'corridor', 'corridors']];

/** Couleurs des traits de la chaîne, de l'affiche au retrait. */
const TRAITS = ['#F2B33D', '#0F7B5F', '#1F3A5F', '#5B2A8C', '#C2410C', '#0E7490'];

export function afficherAccueilDirection(conteneur) {
  conteneur.innerHTML = '<div class="dir-page"><span class="squelette" style="height:120px"></span><span class="squelette" style="height:320px"></span></div>';
  (async () => {
    let d;
    try {
      d = await chargerAccueil();
    } catch (err) {
      if (conteneur.isConnected) conteneur.innerHTML = `<div class="dir-page"><p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(err?.message || 'Tableau de bord indisponible.')}</p></div>`;
      return;
    }
    if (!conteneur.isConnected) return;
    majLiens('');
    conteneur.innerHTML = `
      <div class="dir-page">
        ${bandeau(d)}
        <section class="dir-kpis" aria-label="Chiffres clés">${(d.kpis || []).map(carteKpi).join('')}</section>
        ${(d.portes || []).length ? `<section class="dir-portes" aria-label="Portes">${d.portes.map(cartePorte).join('')}</section>` : ''}
        <div class="dir-deux">
          ${blocDecisions(d.decisions || [])}
          ${d.metiers ? blocMetiers(d.metiers) : ''}
        </div>
        ${d.chaine ? blocChaine(d.chaine) : ''}
      </div>`;
    conteneur.querySelector('[data-ref="dir-recherche"]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = e.target.q.value.trim();
      if (q) location.hash = `#/chercher?q=${encodeURIComponent(q)}`;
    });
  })();
}

function bandeau(d) {
  const m = d.moi || {};
  const jour = d.jour ? capitaliser(formatDate(`${String(d.jour).slice(0, 10)}T12:00:00Z`, 'long')) : '';
  // Trois nombres, accordés ; une valeur à 0 reste (« 0 vendeur ») ; une clé absente de la réponse n'est pas inventée.
  const r = d.resume || {};
  const resume = RESUME.filter(([cle]) => r[cle] !== undefined && r[cle] !== null)
    .map(([cle, un, plusieurs]) => { const n = Number(r[cle]) || 0; return `${formatNombre(n)} ${n > 1 ? plusieurs : un}`; }).join(' · ');
  return `
    <header class="dir-bandeau">
      <div class="dir-bandeau-textes">
        <h1>Bonjour ${esc(prenom(m.nom))}</h1>
        <span>${esc([jour, resume].filter(Boolean).join(' · '))}</span>
      </div>
      <form class="dir-recherche" data-ref="dir-recherche" role="search">
        ${icone('recherche', 16, 2)}<label class="sr-only" for="dir-q">Rechercher</label>
        <input id="dir-q" name="q" type="search" placeholder="Boutique, vendeur, téléphone…" autocomplete="off">
      </form>
      <span class="dir-initiale" title="${esc(m.nom || '')}">${esc(prenom(m.nom).charAt(0).toUpperCase())}</span>
    </header>`;
}

function carteKpi(k) {
  const valeur = (k.montant === undefined || k.montant === null) && k.nombre !== undefined
    ? formatNombre(Number(k.nombre) || 0) : montant(k.montant, k.devise);
  // « caisse » : l'argent des clients, à part (hachures, pas la couleur du gain).
  return `
    <div class="carte dir-kpi dir-kpi-${esc(k.cle)} ${classeTon(k.ton)}">
      <span class="etiquette-carte">${esc(k.titre)}</span>
      <strong class="dir-kpi-valeur dir-num">${esc(valeur)}</strong>
      ${k.note ? `<small>${esc(k.note)}</small>` : ''}
    </div>`;
}

function cartePorte(p) {
  return `
    <a class="carte dir-porte" href="#/${routePorte(p)}" style="--dir-couleur:${esc(p.couleur || '#0A3D33')}" data-porte="${esc(p.code)}">
      <span class="dir-porte-tete">
        <span class="dir-porte-titres"><strong>${esc(p.nom)}</strong>${p.description ? `<span>${esc(p.description)}</span>` : ''}</span>
        ${icone('chevronDroite', 20, 2.2)}
      </span>
      ${(p.lignes || []).map((l) => `
        <span class="dir-porte-ligne">
          ${l.titre ? `<span class="dir-porte-ligne-titre">${esc(l.titre)}</span>` : ''}
          <span class="dir-cases" data-n="${(l.cases || []).length}">${(l.cases || []).map((c) => `
            <span class="dir-case"><strong class="dir-num ${classeTon(c.ton)}">${valeurCase(c)}</strong><span>${esc(c.libelle || '')}</span></span>`).join('')}
          </span>
        </span>`).join('')}
      ${p.alerte ? `<span class="dir-porte-alerte">${icone('alerte', 15, 2)} ${esc(p.alerte)}</span>` : ''}
    </a>`;
}

function blocDecisions(liste) {
  return `
    <section class="carte dir-bloc dir-decisions">
      <div class="dir-bloc-tete"><h2>Ce qui demande une décision aujourd’hui</h2></div>
      ${liste.length ? `<ul class="dir-liste-decisions">${liste.map((x) => {
        const p = porte(x.espace);
        const action = ACTIONS[x.type]?.(x.cible);
        return `<li class="urgence-${Number(x.urgence) <= 1 ? 'rouge' : 'orange'}">
          <span class="dir-decision-textes"><strong>${esc(x.quoi)}</strong>${x.detail ? `<span>${esc(x.detail)}</span>` : ''}</span>
          ${p ? `<span class="dir-etiquette-espace" style="--dir-couleur:${esc(p.couleur)}">${esc(p.nom)}</span>` : ''}
          ${action && (x.cible || x.type === 'a_peser') ? `<a class="btn btn-secondaire btn-petit" href="${action[1]}">${esc(action[0])}</a>` : ''}
        </li>`;
      }).join('')}</ul>` : '<p class="col-vide">Rien ne bloque aujourd’hui.</p>'}
    </section>`;
}

function blocMetiers(m) {
  const lignes = m.lignes || [];
  const max = Math.max(1, ...lignes.map((l) => Number(l.montant) || 0));
  const seul = Number(m.seul) || 0;
  return `
    <section class="carte dir-bloc dir-metiers">
      <div class="dir-bloc-tete"><h2>Ce que chaque métier rapporte</h2>${m.jours ? `<span class="discret">${formatNombre(m.jours)} derniers jours</span>` : ''}</div>
      <ul class="dir-barres">${lignes.map((l) => {
        const p = porte(l.espace);
        return `<li>
          <span class="dir-barre-tete"><span>${esc(l.nom)}</span><strong class="dir-num">${esc(montant(l.montant))}</strong></span>
          <span class="dir-barre"><span style="width:${Math.round(((Number(l.montant) || 0) / max) * 100)}%;background:${esc(p?.couleur || '#0F7B5F')}"></span></span>
          ${l.detail ? `<small>${esc(l.detail)}</small>` : ''}
        </li>`;
      }).join('')}</ul>
      <div class="dir-parts">
        ${m.commun_avec ? `<div><span>À partager avec ${esc(m.commun_avec)}</span><strong class="dir-num">${esc(montant(m.partage))}</strong></div>` : ''}
        ${seul ? `<div><span>Votre part seule</span><strong class="dir-num">${esc(montant(seul))}</strong></div>` : ''}
      </div>
    </section>`;
}

function blocChaine(c) {
  return `
    <section class="carte dir-bloc dir-chaine">
      <div class="dir-bloc-tete"><h2>La chaîne, de l’affiche au retrait</h2>${c.jour ? `<span class="discret">${esc(formatDate(`${String(c.jour).slice(0, 10)}T12:00:00Z`, 'court'))}</span>` : ''}</div>
      <ol class="dir-etapes">${(c.etapes || []).map((e, i) => {
        const vide = !(Number(e.valeur) > 0);
        return `<li class="${vide ? 'vide' : ''}" style="--dir-trait:${vide ? '#C9D3CF' : TRAITS[i % TRAITS.length]}">
          <span class="dir-etape-n">${esc(e.n ?? i + 1)} · ${esc(e.nom)}</span>
          <strong class="dir-num">${esc(formatNombre(Number(e.valeur) || 0))}${e.unite ? ` <small>${esc(e.unite)}</small>` : ''}</strong>
          ${e.quoi ? `<span>${esc(e.quoi)}</span>` : ''}
        </li>`;
      }).join('')}</ol>
    </section>`;
}

