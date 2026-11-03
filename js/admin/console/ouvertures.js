/**
 * admin/console/ouvertures.js — Les six points d'ouverture d'un vendeur (étape 21), onglet « Ouvertures » de #/terrain.
 *
 *  - terrain_ouvertures(p_espace, p_limite) : un vendeur par ligne, les inachevés d'abord, « faits » sur 6 ;
 *  - ouverture_vendeur(p_boutique) : les six points. Cinq sont CONSTATÉS dans les données (constate: true) et
 *    s'affichent en lecture seule avec leur chiffre : personne ne peut déclarer une affiche publiée si aucune ne l'est ;
 *  - un seul se déclare (constate: false) : l'installation sur le téléphone du vendeur, que l'associé a vue de ses
 *    yeux → declarer_installation(p_boutique, p_installee, p_appareil, p_note).
 * Un vendeur complet passe en vert et descend en bas de liste.
 */
import { esc, icone, toast, boutonOccupe, formatNombre } from '../../utils.js';
import { rpc } from '../commun.js';
import { erreurConsole } from './commun.js';

const APPAREILS = [['android', 'Android'], ['iphone', 'iPhone'], ['autre', 'Autre']];
const idBoutique = (v) => v.boutique_id || v.boutique || v.id;
const total = (v) => Number(v.total ?? v.sur ?? 6) || 6;
const complet = (v) => Number(v.faits) >= total(v);
const titrePoint = (p) => p.titre || p.libelle || p.nom || p.code || '';
const faitPoint = (p) => Boolean(p.fait ?? p.ok ?? p.coche ?? p.installee);
/** Le chiffre constaté (« 3 articles sur 5 », « 0 affiche publiée ») : tel que la base le donne. */
function detailPoint(p) {
  if (p.detail || p.texte || p.constat) return p.detail || p.texte || p.constat;
  if (p.valeur !== undefined && p.valeur !== null) return p.cible !== undefined && p.cible !== null ? `${formatNombre(p.valeur)} sur ${formatNombre(p.cible)}` : formatNombre(p.valeur);
  return '';
}

export function monterOuvertures(zone, espaceCode) {
  let vendeurs = [];
  let ouvert = null;
  zone.innerHTML = '<span class="squelette" style="height:220px"></span>';

  async function charger() {
    try {
      const d = await rpc('terrain_ouvertures', { p_espace: espaceCode, p_limite: 200 });
      vendeurs = Array.isArray(d) ? d : (d?.vendeurs || d?.lignes || []);
      if (!zone.isConnected) return;
      rendre();
    } catch (err) {
      zone.innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(erreurConsole(err))}</p>`;
    }
  }

  function rendre() {
    // Les inachevés d'abord (ordre de la base gardé entre eux), les complets en bas.
    const tries = [...vendeurs.filter((v) => !complet(v)), ...vendeurs.filter(complet)];
    const nbComplets = vendeurs.filter(complet).length;
    zone.innerHTML = `
      <div class="cs-ouv-resume carte"><strong class="mc-num">${formatNombre(nbComplets)} / ${formatNombre(vendeurs.length)}</strong><span>vendeur${vendeurs.length > 1 ? 's' : ''} complet${nbComplets > 1 ? 's' : ''} : les six points d’ouverture faits</span></div>
      ${tries.length ? `<ul class="cs-ouv-liste">${tries.map((v) => `
        <li class="${complet(v) ? 'complet' : ''}" data-vendeur="${esc(idBoutique(v))}">
          <button type="button" class="cs-ouv-ligne" data-ouvrir="${esc(idBoutique(v))}" aria-expanded="${ouvert === idBoutique(v)}">
            <span class="cs-ouv-nom"><strong>${esc(v.nom || '')}</strong><span>${esc([v.drapeau, v.ville].filter(Boolean).join(' '))}</span></span>
            <span class="cs-ouv-compte"><span class="cs-ouv-barre"><span style="width:${Math.round((Math.min(Number(v.faits) || 0, total(v)) / total(v)) * 100)}%"></span></span><strong class="mc-num">${formatNombre(Number(v.faits) || 0)}/${formatNombre(total(v))}</strong></span>
          </button>
          <div class="cs-ouv-points" data-points="${esc(idBoutique(v))}" ${ouvert === idBoutique(v) ? '' : 'hidden'}></div>
        </li>`).join('')}</ul>` : '<p class="col-vide">Aucun vendeur dans cet espace pour l’instant.</p>'}`;
    if (ouvert) chargerPoints(ouvert);
  }

  async function chargerPoints(id) {
    const z = zone.querySelector(`[data-points="${CSS.escape(id)}"]`);
    if (!z) return;
    z.hidden = false;
    z.innerHTML = '<span class="squelette" style="height:140px"></span>';
    try {
      const d = await rpc('ouverture_vendeur', { p_boutique: id });
      const points = Array.isArray(d) ? d : (d?.points || []);
      if (!z.isConnected) return;
      z.innerHTML = `<ol class="cs-points">${points.map((p, i) => (p.constate === false ? pointInstallation(p, i, d) : `
        <li class="${faitPoint(p) ? 'fait' : ''}">
          <span class="cs-point-etat" aria-hidden="true">${faitPoint(p) ? icone('valide', 16, 2.4) : ''}</span>
          <span class="cs-point-textes"><strong>${esc(titrePoint(p))}</strong>${detailPoint(p) ? `<span>${esc(detailPoint(p))}</span>` : ''}</span>
          <span class="cs-point-constate" title="Constaté dans les données : il ne se coche pas">constaté</span>
        </li>`)).join('')}</ol>`;
    } catch (err) {
      z.innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(erreurConsole(err))}</p>`;
    }
  }

  /** Le seul point déclaratif : l'installation, vue de ses yeux par l'associé. */
  function pointInstallation(p, i, d) {
    const inst = d?.installation || {};
    const installee = Boolean(p.installee ?? p.fait ?? inst.installee);
    const appareil = p.appareil || inst.appareil || '';
    const note = p.note || inst.note || '';
    return `
      <li class="cs-point-declare ${installee ? 'fait' : ''}">
        <span class="cs-point-etat" aria-hidden="true">${installee ? icone('valide', 16, 2.4) : ''}</span>
        <form class="cs-point-textes cs-installation" data-installation novalidate>
          <strong>${esc(titrePoint(p) || 'Installée sur son téléphone')}</strong>
          <span>Seul point qui se déclare : cochez-le si vous avez vu l’application installée sur son téléphone.</span>
          <label class="case-option"><input type="checkbox" id="inst-ok-${i}" name="installee" ${installee ? 'checked' : ''}> Je l’ai vue installée</label>
          <div class="rangee-champs">
            <div class="champ"><label for="inst-app-${i}">Appareil</label><select id="inst-app-${i}" name="appareil" class="input"><option value="">Choisir…</option>${APPAREILS.map(([c, l]) => `<option value="${c}" ${c === appareil ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="champ"><label for="inst-note-${i}">Note (facultatif)</label><input id="inst-note-${i}" name="note" class="input" maxlength="200" value="${esc(note)}"></div>
          </div>
          <button type="submit" class="btn btn-primaire btn-petit">Enregistrer</button>
        </form>
      </li>`;
  }

  zone.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ouvrir]');
    if (!b) return;
    const id = b.dataset.ouvrir;
    ouvert = ouvert === id ? null : id;
    zone.querySelectorAll('[data-points]').forEach((z) => { if (z.dataset.points !== ouvert) { z.hidden = true; z.innerHTML = ''; } });
    zone.querySelectorAll('[data-ouvrir]').forEach((x) => x.setAttribute('aria-expanded', String(x.dataset.ouvrir === ouvert)));
    if (ouvert) chargerPoints(ouvert);
  });
  zone.addEventListener('submit', async (ev) => {
    const f = ev.target.closest('[data-installation]');
    if (!f) return;
    ev.preventDefault();
    const id = f.closest('[data-vendeur]').dataset.vendeur;
    if (f.installee.checked && !f.appareil.value) { toast('Choisissez l’appareil sur lequel vous l’avez vue installée.', 'erreur'); return; }
    const bouton = f.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Enregistrement…');
    try {
      await rpc('declarer_installation', { p_boutique: id, p_installee: f.installee.checked, p_appareil: f.appareil.value || null, p_note: f.note.value.trim() || null });
      toast(f.installee.checked ? 'Installation déclarée.' : 'Installation retirée.', 'succes');
      ouvert = id;
      await charger();
    } catch (err) { boutonOccupe(bouton, false); toast(erreurConsole(err), 'erreur'); }
  });
  charger();
}
