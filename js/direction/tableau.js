/**
 * direction/tableau.js — #/ : un seul tableau de bord (étape 26). UN SEUL appel : accueil().
 *
 * De haut en bas : bonjour et jour · quatre cases (kpis, montant + devise ou nombre, ton) · « Vos boutiques » (total,
 * pays, métiers en pastilles : tout vient de boutiques.par_pays / par_metier, aucun métier ni pays écrit ici) ·
 * « Ce qui rapporte » (trois barres proportionnelles au plus grand montant) · décisions · administration (tuiles et
 * pastilles d'accueil().administration, super administrateur seulement). Plus aucune carte de service.
 */
import { esc, icone, formatNombre, formatDate, capitaliser } from '../utils.js';
import { chargerAccueil, montant, classeTon, prenom, estSuperAdmin } from './commun.js';
import { majLiens } from './shell.js';
import { OUTILS, pastillesHTML } from './administration.js';

/** Bouton d'une décision selon son type ; un type inconnu n'a pas de bouton. */
const ACTIONS = {
  licence_fin: (c) => ['Relancer', `#/fiche/${encodeURIComponent(c)}`],
  endormie: (c) => ['Appeler', `#/fiche/${encodeURIComponent(c)}`],
  vendeur_a_payer: (c) => ['Payer', `#/marche-monde?onglet=vendeurs&payer=${encodeURIComponent(c)}`],
  a_peser: () => ['Peser', '#/marche-monde?onglet=colis&filtre=a_peser']
};

/** Nom d'un pays dans la langue de l'appli, depuis son code (pas de liste de pays écrite ici). */
export const nomPays = (code) => { try { return new Intl.DisplayNames(['fr'], { type: 'region' }).of(code) || code; } catch { return code; } };

export function afficherTableau(conteneur) {
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
      <div class="dir-page dir-tableau">
        ${bandeau(d)}
        <section class="dir-kpis" aria-label="Chiffres clés">${(d.kpis || []).map(carteKpi).join('')}</section>
        ${d.boutiques ? bandeBoutiques(d.boutiques) : ''}
        <div class="dir-deux">
          ${d.rapporte ? blocRapporte(d.rapporte) : ''}
          ${blocDecisions(d.decisions || [])}
        </div>
        ${d.administration && estSuperAdmin() ? blocAdministration() : ''}
      </div>`;
    conteneur.querySelector('[data-ref="dir-recherche"]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = e.target.q.value.trim();
      if (q) location.hash = `#/boutiques?q=${encodeURIComponent(q)}`;
    });
  })();
}

function bandeau(d) {
  const m = d.moi || {};
  const jour = d.jour ? capitaliser(formatDate(`${String(d.jour).slice(0, 10)}T12:00:00Z`, 'long')) : '';
  return `
    <header class="dir-bandeau">
      <div class="dir-bandeau-textes"><h1>Bonjour ${esc(prenom(m.nom))}</h1><span>${esc(jour)}</span></div>
      <form class="dir-recherche" data-ref="dir-recherche" role="search">
        ${icone('recherche', 16, 2)}<label class="sr-only" for="dir-q">Rechercher une boutique</label>
        <input id="dir-q" name="q" type="search" placeholder="Boutique, ville, téléphone…" autocomplete="off">
      </form>
      <span class="dir-initiale" title="${esc(m.nom || '')}">${esc(prenom(m.nom).charAt(0).toUpperCase())}</span>
    </header>`;
}

function carteKpi(k) {
  const valeur = k.montant !== undefined && k.montant !== null ? montant(k.montant, k.devise) : formatNombre(Number(k.nombre) || 0);
  return `
    <div class="carte dir-kpi dir-kpi-${esc(k.cle)} ${classeTon(k.ton)}">
      <span class="etiquette-carte">${esc(k.titre)}</span>
      <strong class="dir-kpi-valeur dir-num">${esc(valeur)}</strong>
      ${k.note ? `<small>${esc(k.note)}</small>` : ''}
    </div>`;
}

/** « Vos boutiques » : le total en gros, la répartition par pays, les métiers en pastilles de leur couleur. */
function bandeBoutiques(b) {
  const pays = (b.par_pays || []).map((p) => `${p.drapeau || ''} ${nomPays(p.pays)} ${formatNombre(Number(p.n) || 0)}`.trim()).join(' · ');
  return `
    <a class="carte dir-vos-boutiques" href="#/boutiques">
      <span class="dir-vb-tete">
        <span><span class="etiquette-carte">Vos boutiques</span><strong class="dir-vb-total dir-num">${formatNombre(Number(b.total) || 0)}</strong>
          ${pays ? `<span class="dir-vb-pays">${esc(pays)}</span>` : ''}</span>
        ${icone('chevronDroite', 20, 2.2)}
      </span>
      <span class="dir-metiers-pastilles">${(b.par_metier || []).map((m) => `
        <span class="dir-metier" style="--metier:${esc(m.couleur || '#5B6B66')}">${m.emoji ? `<span aria-hidden="true">${esc(m.emoji)}</span>` : ''}${esc(m.nom)} <strong class="dir-num">${formatNombre(Number(m.n) || 0)}</strong></span>`).join('')}</span>
    </a>`;
}

/** « Ce qui rapporte » : barres proportionnelles au plus grand montant ; tout à zéro → la phrase, pas de faux chiffres. */
function blocRapporte(r) {
  const lignes = r.lignes || [];
  const max = Math.max(0, ...lignes.map((l) => Number(l.montant) || 0));
  return `
    <section class="carte dir-bloc dir-metiers">
      <div class="dir-bloc-tete"><h2>Ce qui rapporte</h2>${r.jours ? `<span class="discret">${formatNombre(r.jours)} derniers jours</span>` : ''}</div>
      <ul class="dir-barres">${lignes.map((l) => `<li>
          <span class="dir-barre-tete"><span>${esc(l.nom)}</span><strong class="dir-num">${esc(montant(l.montant))}</strong></span>
          <span class="dir-barre"><span style="width:${max ? Math.round(((Number(l.montant) || 0) / max) * 100) : 0}%;background:${esc(l.couleur || '#0F7B5F')}"></span></span>
        </li>`).join('')}</ul>
      ${max === 0 ? '<p class="dir-rien-entre">Rien n’est encore entré. Le premier chiffre viendra d’une vraie vente.</p>' : ''}
    </section>`;
}

function blocDecisions(liste) {
  return `
    <section class="carte dir-bloc dir-decisions">
      <div class="dir-bloc-tete"><h2>Ce qui demande une décision aujourd’hui</h2></div>
      ${liste.length ? `<ul class="dir-liste-decisions">${liste.map((x) => {
        const action = ACTIONS[x.type]?.(x.cible);
        return `<li class="urgence-${Number(x.urgence) <= 1 ? 'rouge' : 'orange'}">
          <span class="dir-decision-textes"><strong>${esc(x.quoi)}</strong>${x.detail ? `<span>${esc(x.detail)}</span>` : ''}</span>
          ${action && (x.cible || x.type === 'a_peser') ? `<a class="btn btn-secondaire btn-petit" href="${action[1]}">${esc(action[0])}</a>` : ''}
        </li>`;
      }).join('')}</ul>` : '<p class="col-vide">Rien ne bloque aujourd’hui.</p>'}
    </section>`;
}

/** Tuiles de l'administration, chacune avec ses pastilles (support en rouge, SMS en file en ambre). */
function blocAdministration() {
  return `
    <section class="dir-administration" aria-label="Administration">
      <h2 class="dir-titre-section">Administration</h2>
      <div class="dir-tuiles">${OUTILS.map((o) => `
        <a class="carte dir-tuile" href="#/${o.route}">${icone(o.icone, 20, 2)}<span>${esc(o.libelle)}</span><span class="dir-tuile-pastilles">${pastillesHTML(o.pastilles)}</span></a>`).join('')}
      </div>
    </section>`;
}
