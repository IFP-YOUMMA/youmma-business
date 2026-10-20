/**
 * alertes-commandes.js — Nombre de commandes en ligne « nouvelle » (badge du menu), relu toutes les
 * 60 secondes tant que l'appli est ouverte. Quand il augmente : toast « Nouvelle commande en ligne C-00xx »
 * et petit son (désactivable dans Paramètres, préférence locale à l'appareil).
 *
 * Évènement émis : window « yb:commandes » { detail: { nouvelles } } (l'écran Commandes se rafraîchit).
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import { aModule } from './modules.js';
import { toast, lireStockage, ecrireStockage } from './utils.js';

const INTERVALLE_MS = 60000;
const CLE_SON = 'yb_son_commandes';

let minuteur = null;
let boutiqueSuivie = null;
let dernierNombre = null;

export const sonCommandesActif = () => lireStockage(CLE_SON) !== false;
export const reglerSonCommandes = (actif) => ecrireStockage(CLE_SON, Boolean(actif));

/** Bip court (deux notes) avec Web Audio ; silencieux si le navigateur le refuse. */
export function jouerSonCommande() {
  try {
    const Contexte = window.AudioContext || window.webkitAudioContext;
    // Le navigateur bloque le son tant que l'utilisateur n'a pas touché la page.
    if (!Contexte || navigator.userActivation?.hasBeenActive === false) return;
    const ctx = new Contexte();
    [[880, 0], [1320, 0.16]].forEach(([frequence, decalage]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequence;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + decalage);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + decalage + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + decalage + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + decalage);
      osc.stop(ctx.currentTime + decalage + 0.15);
    });
    setTimeout(() => ctx.close?.(), 600);
  } catch { /* pas de son */ }
}

function afficherBadge(n) {
  document.querySelectorAll('[data-ref="badge-commandes"]').forEach((el) => {
    el.textContent = n > 0 ? String(n) : '';
    el.setAttribute('aria-label', `${n} nouvelle${n > 1 ? 's' : ''} commande${n > 1 ? 's' : ''}`);
  });
}

/** Relit le nombre de nouvelles commandes (et prévient si une commande vient d'arriver). */
export async function verifierCommandes() {
  const boutique = etat.boutique;
  // Module « Boutique en ligne » masqué : rien à surveiller.
  if (!boutique || !peut('commandes.voir') || !aModule('boutique_en_ligne')) return null;
  const { count, error } = await sb.from('commandes_web').select('id', { count: 'exact', head: true })
    .eq('boutique_id', boutique.id).eq('statut', 'nouvelle');
  if (error || boutique !== etat.boutique) return null;
  const n = count || 0;
  afficherBadge(n);
  if (dernierNombre !== null && n > dernierNombre) {
    const { data } = await sb.from('commandes_web').select('id, numero').eq('boutique_id', boutique.id).eq('statut', 'nouvelle')
      .order('created_at', { ascending: false }).limit(1);
    const derniere = data?.[0];
    toast(`Nouvelle commande en ligne ${derniere?.numero || ''}`.trim(), 'succes', 8000,
      derniere ? { href: `#/commandes/${encodeURIComponent(derniere.id)}`, libelle: 'Voir' } : null);
    if (sonCommandesActif()) jouerSonCommande();
  }
  dernierNombre = n;
  window.dispatchEvent(new CustomEvent('yb:commandes', { detail: { nouvelles: n } }));
  return n;
}

/** Démarre (ou redémarre après un changement de boutique) la surveillance. */
export function demarrerSurveillanceCommandes() {
  if (boutiqueSuivie !== etat.boutique?.id) { dernierNombre = null; boutiqueSuivie = etat.boutique?.id || null; }
  clearInterval(minuteur);
  verifierCommandes();
  minuteur = setInterval(() => {
    if (!document.querySelector('.shell')) { clearInterval(minuteur); minuteur = null; return; }
    if (document.visibilityState === 'visible') verifierCommandes();
  }, INTERVALLE_MS);
}
