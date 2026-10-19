/**
 * admin/vitrines.js — Boutiques en ligne : adresse, active, visites, commandes, livrées, articles en ligne ;
 * ouvrir ; couper / réactiver une vitrine (super admin, confirmation).
 */
import { esc, toast, confirmer } from '../utils.js';
import { estSuper, rpc, champ, liste, erreurAdmin, nombre, urlVitrine, tableau, blocErreur, squelette } from './commun.js';

export function afficherVitrines(conteneur) {
  const s = { lignes: [] };
  conteneur.innerHTML = `
    <header class="adm-entete"><div class="adm-titres"><h1>Boutiques en ligne</h1><span class="discret">Vitrines publiques des boutiques (…/b/adresse)</span></div></header>
    <section class="adm-carte" data-zone="liste">${squelette(6)}</section>`;
  const zone = conteneur.querySelector('[data-zone="liste"]');

  async function charger() {
    try {
      s.lignes = liste(await rpc('admin_vitrines'), 'lignes');
      if (!conteneur.isConnected) return;
      zone.innerHTML = tableau([
        ['Boutique', (v) => `<a href="#/boutiques/${encodeURIComponent(champ(v, 'boutique_id', 'id'))}"><strong>${esc(champ(v, 'nom', 'boutique_nom'))}</strong></a>`],
        ['Adresse', (v) => (v.slug ? `<a href="${esc(urlVitrine(v.slug))}" target="_blank" rel="noopener">…/b/${esc(v.slug)}</a>` : '—')],
        ['État', (v) => (v.actif ? '<span class="pastille-admin vert">Active</span>' : '<span class="pastille-admin gris">Fermée</span>')],
        ['Visites', (v) => nombre(champ(v, 'visites')), { droite: true }],
        ['Commandes', (v) => nombre(champ(v, 'commandes')), { droite: true }],
        ['Livrées', (v) => nombre(champ(v, 'livrees')), { droite: true }],
        ['Articles en ligne', (v) => nombre(champ(v, 'articles_en_ligne', 'articles')), { droite: true }],
        ['', (v) => (estSuper() ? `<button type="button" class="btn btn-petit ${v.actif ? 'btn-refuser' : 'btn-secondaire'}" data-vitrine="${esc(champ(v, 'boutique_id', 'id'))}" data-actif="${v.actif ? '1' : ''}">${v.actif ? 'Couper' : 'Réactiver'}</button>` : '')]
      ], s.lignes, { vide: 'Aucune boutique en ligne pour l’instant.' });
    } catch (err) { zone.innerHTML = blocErreur(err); }
  }

  conteneur.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-vitrine]');
    if (!b) return;
    const v = s.lignes.find((x) => champ(x, 'boutique_id', 'id') === b.dataset.vitrine) || {};
    const actif = !b.dataset.actif;
    if (!(await confirmer(actif ? `Réactiver la boutique en ligne de « ${champ(v, 'nom', 'boutique_nom')} » ?` : `Couper la boutique en ligne de « ${champ(v, 'nom', 'boutique_nom')} » ? Les visiteurs verront « Boutique fermée temporairement ».`,
      { titre: 'Boutique en ligne', libelleOk: actif ? 'Réactiver' : 'Couper', danger: !actif }))) return;
    try { await rpc('admin_vitrine_actif', { p_boutique: b.dataset.vitrine, p_actif: actif }); toast(actif ? 'Boutique en ligne réactivée.' : 'Boutique en ligne coupée.', 'succes'); charger(); }
    catch (err) { toast(erreurAdmin(err), 'erreur'); }
  });
  charger();
}
