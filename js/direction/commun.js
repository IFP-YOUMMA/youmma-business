/**
 * direction/commun.js — Tableau de bord de direction (étapes 20 et 26) : données partagées et petits outils.
 *
 *  - accueil() (étape 26) : tout l'écran #/ en un seul appel (moi, jour, kpis, boutiques, rapporte, decisions,
 *    administration). Gardé en mémoire pour la barre latérale (nombre de boutiques, pastilles de l'administration) ;
 *  - console_accueil() : chargé seulement en entrant dans une porte, pour les écrans de la console réutilisés
 *    (liste des boutiques, fiche, création, accès), jamais sur #/.
 * Le serveur filtre selon la portée : une porte absente de la réponse n'existe pas, on n'affiche rien pour elle.
 */
import { sb } from '../supabase.js';
import { esc, formatNombre, formatGNF } from '../utils.js';
import { direction as consoleDirection } from '../admin/console/commun.js';
import { etat } from '../state.js';

/** accueil : la dernière réponse d'accueil() ; total : le dernier nombre de boutiques connu (accueil ou liste). */
export const cache = { accueil: null, total: null };

async function appel(nom, params) {
  const { data, error } = await sb.rpc(nom, params);
  if (error) throw error;
  return data;
}

/** accueil() : l'objet de l'écran #/ (un seul aller-retour). */
export async function chargerAccueil() {
  const d = await appel('accueil');
  cache.accueil = (Array.isArray(d) ? d[0] : d) || {};
  if (cache.accueil.boutiques?.total !== undefined) cache.total = cache.accueil.boutiques.total;
  return cache.accueil;
}

/**
 * Le marché est-il en veille ? Clé marche_en_veille de direction_accueil() (déjà en mémoire si l'on vient de #/,
 * sinon un appel). Seul un « false » explicite rallume ce qui mène au marché ; sans réponse, on ne mène nulle part.
 */
export async function marcheEnVeille() {
  if (!cache.accueil) { try { await chargerAccueil(); } catch { return true; } }
  return cache.accueil.marche_en_veille !== false;
}

/** console_accueil() une fois, pour les écrans de la console (espace, fiche, terrain, accès). */
export async function assurerConsole() {
  if (!consoleDirection.accueil) consoleDirection.accueil = await appel('console_accueil');
  return consoleDirection.accueil;
}

/** Portes connues : celles de direction_accueil, sinon les espaces de console_accueil (mêmes codes, couleurs). */
export function portes() {
  if (cache.accueil?.portes) return cache.accueil.portes;
  return (consoleDirection.accueil?.espaces || []).map((e) => ({ ...e, nom: e.nom || e.nom_public }));
}
export const porte = (code) => portes().find((p) => p.code === code) || null;
/** Personne connectée (nom, rôle, portée, peut_gerer_acces). */
export const moi = () => cache.accueil?.moi || consoleDirection.accueil?.moi || etat.entree?.moi || {};
/** Super administrateur : l'administration (outils de la plateforme) n'existe que pour lui. */
export const estSuperAdmin = () => moi().role === 'super_admin';

/**
 * Écran d'une porte selon sa facturation : les licences → #/boutiques, la commission → #/marche-monde.
 * Un espace d'un autre genre (le jour où il existera) ouvre la liste générique de la console.
 */
export function routePorte(p) {
  if (!p) return '';
  if (p.facturation === 'licence') return 'boutiques';
  if (p.facturation === 'commission') return 'marche-monde';
  return `espace/${encodeURIComponent(p.code)}`;
}
export const porteDeRoute = (route) => portes().find((p) => routePorte(p) === route) || null;

/** Montant tel que le serveur l'a donné, dans sa monnaie (GNF par défaut). */
export function montant(n, devise = 'GNF') {
  const v = Number(n) || 0;
  if (!devise || devise === 'GNF') return formatGNF(v);
  return `${formatNombre(v)} ${devise === 'XOF' ? 'FCFA' : esc(devise)}`;
}

/** Valeur d'une case : « argent » = montant GNF ; un nombre est formaté ; un texte reste tel quel. */
export function valeurCase(c) {
  if (c.ton === 'argent') return esc(formatGNF(Number(c.valeur) || 0));
  if (typeof c.valeur === 'number' || /^-?\d+(\.\d+)?$/.test(String(c.valeur ?? ''))) return esc(formatNombre(Number(c.valeur)));
  return esc(c.valeur ?? '—');
}

/** Classe de couleur d'un ton : bien vert, attention ambre, alerte rouge, neutre (et argent) gris foncé. */
export const classeTon = (ton) => ({ bien: 'ton-bien', attention: 'ton-attention', alerte: 'ton-alerte' }[ton] || 'ton-neutre');

export const prenom = (nom) => String(nom || '').trim().split(/\s+/)[0] || '';
