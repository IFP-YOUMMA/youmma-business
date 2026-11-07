/**
 * direction/boutiques.js — #/boutiques : toutes les boutiques, un seul écran (étape 26). Une logistique est une boutique
 * comme une autre, avec son métier. liste_boutiques(p_pays, p_filtre, p_recherche, p_limite) fait tout le tri ; le
 * serveur ne renvoie que la portée de la personne (un associé n'a que ses boutiques, rien des autres n'arrive ici).
 *
 *  - pays (pastilles et groupes) et métiers viennent de la réponse (par_pays, metier) : aucune liste écrite ici ;
 *  - état : etat.libelle tel quel, coloré par etat.ton ; facturation : facturation.libelle et detail ;
 *  - actions : Ouvrir (entrer, avec l'accès de dépannage si besoin) · Vitrine (seulement si vitrine existe) ou Colis
 *    (logistique) · Fiche. ouverture → « 4 points sur 6 » (vendeur ouvert sur le terrain, pas fini) ;
 *  - #/boutiques/nouvelle : créer une boutique (écran « terrain » existant) ; #/boutiques/<id> (anciens liens) → fiche.
 */
import { sb } from '../supabase.js';
import { esc, icone, formatNombre, differer } from '../utils.js';
import { naviguer } from '../router.js';
import { sortirDeBoutique } from '../state.js';
import { cache, estSuperAdmin } from './commun.js';
import { majLiens } from './shell.js';
import { ouvrirBoutique, afficherTerrainDirection } from './portes.js';
import { nomPays } from './tableau.js';

const FILTRES = [['essai', 'En essai'], ['payantes', 'Payantes'], ['commission', 'En commission'], ['vitrine', 'Vitrine en ligne'], ['endormies', 'Endormies']];
const TONS = { neutre: 'ton-neutre', bien: 'ton-bien', attention: 'ton-attention', alerte: 'ton-alerte' };

async function rpc(nom, params) {
  const { data, error } = await sb.rpc(nom, params);
  if (error) throw error;
  return data;
}
const premiere = (d) => (Array.isArray(d) ? d[0] : d) ?? null;
const initiales = (nom) => String(nom || '?').trim().split(/\s+/).slice(0, 2).map((m) => m[0]).join('').toUpperCase();
/** Texte lisible sur la couleur du métier : foncé sur une couleur claire (jamais de blanc sur de l'or). */
function encre(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#FFFFFF';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#10231E' : '#FFFFFF';
}
const lienVitrine = (slug) => new URL(`b/?s=${encodeURIComponent(slug)}`, location.href.split('#')[0]).href;

export function afficherListeBoutiques(conteneur, params) {
  sortirDeBoutique();
  const id = params.get('id');
  if (id === 'nouvelle') { afficherTerrainDirection(conteneur, params); return undefined; }
  if (id) { naviguer(`fiche/${encodeURIComponent(id)}`, { remplacer: true }); return undefined; }
  majLiens('boutiques');
  const s = { pays: params.get('pays') || null, filtre: params.get('filtre') || null, recherche: params.get('q') || '', r: null, jeton: 0, associe: undefined };

  conteneur.innerHTML = `
    <div class="dir-page dir-boutiques">
      <header class="dir-page-entete">
        <div class="dir-page-titres"><h1>Les boutiques</h1><span data-ref="sous" class="discret"></span></div>
        <div class="dir-page-actions">
          <label class="dir-recherche">${icone('recherche', 16, 2)}<span class="sr-only">Rechercher une boutique</span>
            <input type="search" data-ref="q" placeholder="Nom, ville, téléphone…" autocomplete="off" value="${esc(s.recherche)}"></label>
          ${estSuperAdmin() ? `<button type="button" class="btn btn-secondaire" data-action="exporter">${icone('telecharger', 16, 2)} Exporter</button>` : ''}
          <a class="btn btn-primaire" href="#/boutiques/nouvelle">${icone('plus', 16, 2.4)} Créer une boutique</a>
        </div>
      </header>
      <div class="cs-puces dir-filtres" role="group" aria-label="Filtres" data-zone="filtres"></div>
      <div data-zone="liste"><span class="squelette" style="height:320px"></span></div>
    </div>`;
  const q = (sel) => conteneur.querySelector(sel);

  function filtres() {
    const r = s.r || {};
    const puce = (attr, valeur, libelle, actif) => `<button type="button" class="cs-puce ${actif ? 'actif' : ''}" ${attr}="${esc(valeur)}" aria-pressed="${actif}">${libelle}</button>`;
    q('[data-zone="filtres"]').innerHTML = [
      puce('data-tout', '1', 'Toutes', !s.pays && !s.filtre),
      ...(r.par_pays || []).map((p) => puce('data-pays', p.pays, `${esc(p.drapeau || '')} ${esc(nomPays(p.pays))} <span>${formatNombre(Number(p.n) || 0)}</span>`, s.pays === p.pays)),
      ...FILTRES.map(([code, libelle]) => puce('data-filtre', code, esc(libelle), s.filtre === code))
    ].join('');
  }

  function sousTitre() {
    const r = s.r || {};
    const pays = (r.par_pays || []).map((p) => `${p.drapeau || ''} ${formatNombre(Number(p.n) || 0)}`.trim()).join(' · ');
    q('[data-ref="sous"]').textContent = `${formatNombre(Number(r.total) || 0)} boutique${Number(r.total) > 1 ? 's' : ''}${pays ? ` · ${pays}` : ''}`;
  }

  function ligne(b) {
    const m = b.metier || {};
    const couleur = m.couleur || '#5B6B66';
    const f = b.facturation;
    const e = b.etat || {};
    const o = b.ouverture;
    return `<li class="dir-boutique">
      <span class="dir-initiales" style="background:${esc(couleur)};color:${encre(couleur)}" aria-hidden="true">${esc(initiales(b.nom))}</span>
      <span class="dir-boutique-textes">
        <a class="dir-boutique-nom" href="#/fiche/${encodeURIComponent(b.id)}">${esc(b.nom)}</a>
        <span class="dir-boutique-sous">${esc(b.ville || '—')}${m.nom ? ` · <span class="dir-metier" style="--metier:${esc(couleur)}">${m.emoji ? `<span aria-hidden="true">${esc(m.emoji)}</span>` : ''}${esc(m.nom)}</span>` : ''}</span>
        <span class="dir-boutique-sous">${f ? `${esc(f.libelle || '')}${f.detail ? ` · <span class="dir-num">${esc(f.detail)}</span>` : ''}` : ''}${o ? ` · <span class="dir-ouverture">${formatNombre(Number(o.faits) || 0)} points sur ${formatNombre(Number(o.total) || 0)}</span>` : ''}</span>
      </span>
      ${e.libelle ? `<span class="dir-etat ${TONS[e.ton] || 'ton-neutre'}">${esc(e.libelle)}</span>` : ''}
      <span class="dir-boutique-actions">
        <button type="button" class="btn btn-primaire btn-petit" data-ouvrir="${esc(b.id)}">Ouvrir</button>
        ${b.logistique ? `<button type="button" class="btn btn-secondaire btn-petit" data-colis="${esc(b.id)}">${icone('colis', 15, 2)} Colis</button>`
          : b.vitrine?.slug ? `<a class="btn btn-secondaire btn-petit" href="${esc(lienVitrine(b.vitrine.slug))}" target="_blank" rel="noopener">Vitrine</a>` : ''}
        <a class="btn btn-secondaire btn-petit" href="#/fiche/${encodeURIComponent(b.id)}">Fiche</a>
      </span>
    </li>`;
  }

  async function nomAssocie() {
    if (s.associe !== undefined) return s.associe;
    s.associe = null;
    try {
      const acces = await rpc('console_acces');
      const a = (Array.isArray(acces) ? acces : []).find((x) => x.role === 'admin_espace' && x.actif !== false);
      s.associe = a ? String(a.nom || '').split(' ')[0] || null : null;
    } catch { /* pas d'accès à la liste : « votre associé » */ }
    return s.associe;
  }

  async function rendre() {
    const r = s.r;
    const boutiques = r.boutiques || [];
    const ordre = (r.par_pays || []).map((p) => p.pays);
    const groupes = new Map();
    boutiques.forEach((b) => { if (!groupes.has(b.pays)) groupes.set(b.pays, []); groupes.get(b.pays).push(b); });
    const codes = [...groupes.keys()].sort((a, b) => (ordre.indexOf(a) + 1 || 99) - (ordre.indexOf(b) + 1 || 99));
    const commun = boutiques.some((b) => b.commun);
    const associe = commun && estSuperAdmin() ? await nomAssocie() : null;
    q('[data-zone="liste"]').innerHTML = boutiques.length ? codes.map((code) => {
      const liste = groupes.get(code);
      const drapeau = liste[0]?.drapeau || (r.par_pays || []).find((p) => p.pays === code)?.drapeau || '';
      return `<section class="carte dir-groupe-pays">
        <h2 class="dir-groupe-titre">${esc(drapeau)} ${esc(nomPays(code))} · ${formatNombre(liste.length)} boutique${liste.length > 1 ? 's' : ''}${liste.some((b) => b.commun) ? ` · avec ${esc(associe || 'votre associé')}` : ''}</h2>
        <ul class="dir-liste-boutiques">${liste.map(ligne).join('')}</ul>
      </section>`;
    }).join('') : `<p class="col-vide">${s.recherche || s.filtre || s.pays ? 'Aucune boutique ne correspond.' : 'Aucune boutique pour l’instant.'}</p>`;
  }

  async function charger() {
    const jeton = ++s.jeton;
    try {
      const r = premiere(await rpc('liste_boutiques', { p_pays: s.pays, p_filtre: s.filtre, p_recherche: s.recherche || null, p_limite: 500 }));
      if (jeton !== s.jeton || !conteneur.isConnected) return;
      s.r = r || { boutiques: [] };
      if (!s.pays && !s.filtre && !s.recherche) { cache.total = s.r.total; majLiens('boutiques'); }
      filtres();
      sousTitre();
      await rendre();
    } catch (err) {
      // FILTRE_INVALIDE et tout autre refus : le message du serveur, tel quel.
      if (jeton !== s.jeton || !conteneur.isConnected) return;
      filtres();
      q('[data-zone="liste"]').innerHTML = '<p class="bloc-erreur"></p>';
      q('[data-zone="liste"] .bloc-erreur').textContent = String(err?.message || err);
    }
  }

  conteneur.addEventListener('click', async (ev) => {
    const t = ev.target;
    if (t.closest('[data-tout]')) { Object.assign(s, { pays: null, filtre: null }); charger(); return; }
    const p = t.closest('[data-pays]');
    if (p) { s.pays = s.pays === p.dataset.pays ? null : p.dataset.pays; charger(); return; }
    const f = t.closest('[data-filtre]');
    if (f) { s.filtre = s.filtre === f.dataset.filtre ? null : f.dataset.filtre; charger(); return; }
    const o = t.closest('[data-ouvrir]');
    if (o) { const b = s.r.boutiques.find((x) => x.id === o.dataset.ouvrir); if (b) ouvrirBoutique(b); return; }
    const c = t.closest('[data-colis]');
    if (c) { const b = s.r.boutiques.find((x) => x.id === c.dataset.colis); if (b) ouvrirBoutique(b, 'colis'); return; }
    if (t.closest('[data-action="exporter"]')) {
      const { exporterCsv } = await import('../admin/commun.js');
      exporterCsv(`boutiques-youmma-${new Date().toISOString().slice(0, 10)}.csv`, [
        ['Boutique', (b) => b.nom], ['Ville', (b) => b.ville || ''], ['Pays', (b) => b.pays || ''], ['Métier', (b) => b.metier?.nom || ''],
        ['Facturation', (b) => [b.facturation?.libelle, b.facturation?.detail].filter(Boolean).join(' · ')], ['État', (b) => b.etat?.libelle || ''],
        ['Vitrine', (b) => (b.vitrine?.slug ? lienVitrine(b.vitrine.slug) : '')]
      ], s.r?.boutiques || []);
    }
  });
  q('[data-ref="q"]').addEventListener('input', differer((ev) => { s.recherche = ev.target.value.trim(); charger(); }, 300));

  charger();
  return undefined;
}
