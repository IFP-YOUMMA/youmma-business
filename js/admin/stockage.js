/**
 * admin/stockage.js — Plateforme → Stockage : jauges des fichiers (Storage) et de la base avec le seuil d'alerte,
 * détail par boutique (fichiers, Mo, photos / quota de la formule), fichiers orphelins et « Nettoyer maintenant »
 * (fonction Edge nettoyer-images, appelée avec le jeton du super admin).
 */
import { sb } from '../supabase.js';
import { esc, toast, confirmer, boutonOccupe, formatNombre } from '../utils.js';
import { estSuper, rpc, premiere, liste, erreurAdmin, tableau, blocErreur, squelette, exporterCsv } from './commun.js';

export const mo = (o) => `${formatNombre((Number(o) || 0) / 1048576, 1)} Mo`;
export const taille = (o) => ((Number(o) || 0) >= 1024 ** 3 ? `${formatNombre(o / 1024 ** 3, 2)} Go` : mo(o));

/** Lit admin_stockage et normalise les pourcentages (calculés si absents). */
export async function lireStockage() {
  const d = premiere(await rpc('admin_stockage')) || {};
  const pct = (v, l) => (l ? Math.round((Number(v) / Number(l)) * 1000) / 10 : 0);
  return {
    ...d,
    stockage_pourcent: d.stockage_pourcent ?? pct(d.stockage_octets, d.stockage_limite),
    base_pourcent: d.base_pourcent ?? pct(d.base_octets, d.base_limite),
    alerte_pourcent: Number(d.alerte_pourcent) || 80
  };
}

export function jauge(libelle, valeur, limite, pourcent, alerte) {
  const p = Math.max(0, Math.min(100, Number(pourcent) || 0));
  const niveau = p >= 95 ? 'rouge' : p >= alerte ? 'orange' : 'vert';
  return `
    <div class="adm-jauge">
      <div class="adm-jauge-haut"><span class="gras">${esc(libelle)}</span><span class="discret">${esc(taille(valeur))} / ${esc(taille(limite))} · <strong class="adm-jauge-pct ${niveau}">${formatNombre(p, 1)} %</strong></span></div>
      <div class="adm-jauge-barre" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}" aria-label="${esc(libelle)}">
        <span class="${niveau}" style="width:${p}%"></span><i class="adm-jauge-seuil" style="left:${alerte}%" title="Seuil d’alerte ${alerte} %"></i>
      </div>
    </div>`;
}

export function afficherStockage(conteneur) {
  conteneur.innerHTML = `
    <header class="adm-entete"><div class="adm-titres"><h1>Stockage</h1>
      <span class="discret">Fichiers (photos, logos, documents) et base de données · seuil d’alerte réglable dans Paramètres</span></div></header>
    <section class="adm-carte" data-zone="jauges">${squelette(3)}</section>
    <section class="adm-carte" data-zone="orphelins">${squelette(2)}</section>
    <section class="adm-carte" data-zone="boutiques">${squelette(6)}</section>`;
  const zone = (n) => conteneur.querySelector(`[data-zone="${n}"]`);
  let donnees = null;

  async function charger() {
    try { donnees = await lireStockage(); } catch (err) { zone('jauges').innerHTML = blocErreur(err); zone('orphelins').innerHTML = ''; zone('boutiques').innerHTML = ''; return; }
    if (!conteneur.isConnected) return;
    const d = donnees;
    const alerte = d.alerte_pourcent;
    const depasse = Math.max(d.stockage_pourcent, d.base_pourcent) >= alerte;
    zone('jauges').innerHTML = `<h2>Utilisation</h2>
      ${jauge('Fichiers (Storage)', d.stockage_octets, d.stockage_limite, d.stockage_pourcent, alerte)}
      ${jauge('Base de données', d.base_octets, d.base_limite, d.base_pourcent, alerte)}
      ${depasse ? `<p class="adm-alerte-stockage">Au-delà de ${alerte} % : passer au plan Pro de Supabase (8 Go de base, 100 Go de fichiers) ou nettoyer les fichiers inutiles.</p>` : `<p class="discret">Alerte à ${alerte} % de l’une des deux limites.</p>`}`;
    const o = d.orphelins || {};
    zone('orphelins').innerHTML = `<h2>Fichiers orphelins</h2>
      <div class="adm-orphelins"><span><strong>${formatNombre(Number(o.nb) || 0)}</strong> fichier${Number(o.nb) > 1 ? 's' : ''} · ${esc(mo(o.octets))}
        <span class="discret">— photos remplacées ou supprimées depuis plus de 2 jours (buckets produits et documents ; jamais les bons). Nettoyage automatique chaque dimanche à 3 h 30.</span></span>
        ${estSuper() ? `<button type="button" class="btn btn-secondaire" data-action="nettoyer" ${Number(o.nb) ? '' : 'disabled'}>Nettoyer maintenant</button>` : ''}</div>`;
    const lignes = liste(d.par_boutique).sort((a, b) => Number(b.octets) - Number(a.octets));
    zone('boutiques').innerHTML = `<div class="adm-carte-entete"><h2>Par boutique</h2><button type="button" class="btn btn-secondaire btn-petit" data-action="csv">Exporter CSV</button></div>
      ${lignes.length ? tableau([
        ['Boutique', (b) => `<a href="#/boutiques/${encodeURIComponent(b.id)}"><strong>${esc(b.nom)}</strong></a>`],
        ['Formule', (b) => esc(b.licence_formule || '—')],
        ['Fichiers', (b) => formatNombre(Number(b.fichiers) || 0), { droite: true }],
        ['Espace', (b) => esc(mo(b.octets)), { droite: true }],
        ['Photos / quota', (b) => {
          const pctQ = Number(b.max_photos) ? (Number(b.photos) / Number(b.max_photos)) * 100 : 0;
          return `<span class="${pctQ >= 100 ? 'texte-danger gras' : pctQ >= 80 ? 'texte-alerte gras' : ''}">${formatNombre(Number(b.photos) || 0)} / ${b.max_photos ? formatNombre(b.max_photos) : '—'}</span>`;
        }, { droite: true }]
      ], lignes) : '<p class="vide-admin">Aucun fichier.</p>'}`;
  }

  conteneur.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    const bouton = e.target.closest('button');
    if (action === 'csv' && donnees) {
      exporterCsv(`stockage-boutiques-${new Date().toISOString().slice(0, 10)}.csv`, [
        ['Boutique', 'Formule', 'Fichiers', 'Octets', 'Photos', 'Quota photos'],
        ...liste(donnees.par_boutique).map((b) => [b.nom, b.licence_formule, b.fichiers, b.octets, b.photos, b.max_photos])
      ]);
    }
    if (action === 'nettoyer') {
      if (!(await confirmer('Supprimer maintenant les fichiers orphelins (photos remplacées ou supprimées depuis plus de 2 jours) ? Les bons d’enlèvement ne sont jamais touchés.', { titre: 'Nettoyer le stockage', libelleOk: 'Nettoyer' }))) return;
      boutonOccupe(bouton, true, 'Nettoyage…');
      try {
        const r = await nettoyerImages();
        toast(`${formatNombre(Number(r.supprimes) || 0)} fichier${Number(r.supprimes) > 1 ? 's' : ''} supprimé${Number(r.supprimes) > 1 ? 's' : ''} · ${mo(r.octets)} libérés.`, 'succes', 6000);
        charger();
      } catch (err) {
        boutonOccupe(bouton, false);
        toast(erreurAdmin(err), 'erreur', 6000);
      }
    }
  });
  charger();
}

/** Appelle la fonction Edge nettoyer-images avec le jeton de session (super admin vérifié côté serveur). */
export async function nettoyerImages() {
  const { data, error } = await sb.functions.invoke('nettoyer-images', { body: {} });
  if (error) {
    let code = error.message;
    try { const r = await error.context?.json?.(); if (r?.erreur) code = r.erreur; } catch { /* corps illisible */ }
    throw Object.assign(new Error(code), { code });
  }
  return data || {};
}
