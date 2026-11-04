/**
 * depannage.js — Entrer dans une boutique depuis la direction sans en être membre (accès de dépannage).
 *  - entrer_dans_boutique(p_boutique, p_motif, p_heures) : motif obligatoire (le boutiquier le lira), 1 à 12 h ;
 *  - mes_depannages() : lu à l'entrée dans la boutique (et au rechargement de la page), pas à chaque écran ;
 *  - sortir_de_boutique(p_boutique) : « Sortir » dans le bandeau ambre ;
 *  - depannages_boutique(p_boutique) : « Qui est entré dans ma boutique » (Paramètres, tout membre).
 * Le serveur n'accorde que les droits d'un vendeur : les gestes de gérant (marqués data-gerant) sont éteints,
 * avec leur raison, et aucun appel ne part quand on les touche.
 */
import { sb } from './supabase.js';
import {
  etat, choisirBoutique, chargerBoutiques, sortirDeBoutique, enDepannage,
  ajouterBoutiqueDepannage, oublierDepannage, COLONNES_BOUTIQUE
} from './state.js';
import { esc, icone, toast, ouvrirModale, boutonOccupe, formatDate, FUSEAU } from './utils.js';

export const MESSAGE_DEPANNAGE = 'Accès de dépannage : lecture seule. Demandez au gérant.';
const DUREES = [1, 2, 4, 8, 12];
const DUREE_PAR_DEFAUT = 2;

const premiere = (d) => (Array.isArray(d) ? d[0] : d) ?? null;
async function rpc(nom, params) {
  const { data, error } = await sb.rpc(nom, params);
  if (error) throw error;
  return data;
}
/** Premier champ présent parmi plusieurs noms possibles (réponses dont la forme exacte n'est pas documentée). */
const champ = (o, ...noms) => noms.map((n) => o?.[n]).find((v) => v !== undefined && v !== null && v !== '');
const nomMoi = () => etat.entree?.moi?.nom || etat.session?.user?.user_metadata?.nom || '';

/* ------------------------------------------------------------ Entrer */

/**
 * « Ouvrir la boutique » depuis la direction. Membre de plein droit (connu à la connexion) : on entre, rien n'est
 * ouvert ni enregistré. Sinon : le motif d'abord, puis entrer_dans_boutique. Renvoie vrai si l'on peut entrer.
 */
export async function demanderEntree(b) {
  const membre = etat.boutiques.find((x) => x.boutique.id === b.id && !x.membre?.depannage);
  if (membre) return choisirBoutique(b.id);
  // Revenu par « Retour à la direction » sans « Sortir » : l'accès est encore ouvert, pas de nouveau motif.
  if (etat.depannage?.boutique_id === b.id && new Date(etat.depannage.expire_le).getTime() > Date.now()) return choisirBoutique(b.id);
  const acces = await fenetreMotif(b);
  if (!acces) return false;
  if (acces.deja_membre) {
    // Membre depuis la connexion (invitation acceptée entre-temps) : les boutiques sont relues.
    await chargerBoutiques();
    return choisirBoutique(b.id);
  }
  return ouvrirDepannage(b.id, { ...b, ...(typeof acces.boutique === 'object' ? acces.boutique : {}) });
}

/** Petite fenêtre « Pourquoi entrez-vous dans … ? ». Résout la réponse du serveur, ou null si l'on renonce. */
function fenetreMotif(b) {
  return new Promise((resoudre) => {
    let reponse = null;
    let duree = DUREE_PAR_DEFAUT;
    const { el, fermer } = ouvrirModale({
      titre: `Pourquoi entrez-vous dans ${b.nom || 'cette boutique'} ?`,
      variante: 'depannage',
      onFermer: () => resoudre(reponse),
      contenu: `
        <form class="form-depannage" novalidate>
          <p class="texte-modale">Le boutiquier lira cette phrase.</p>
          <div class="champ"><label for="dp-motif">Motif</label>
            <textarea id="dp-motif" name="motif" class="input" rows="3" maxlength="300" required></textarea></div>
          <div class="champ"><span class="etiquette" id="dp-duree">Durée de l’accès</span>
            <div class="segments" role="group" aria-labelledby="dp-duree">
              ${DUREES.map((h) => `<button type="button" class="segment ${h === duree ? 'actif' : ''}" data-heures="${h}" aria-pressed="${h === duree}">${h} h</button>`).join('')}
            </div></div>
          <p class="erreur-form" role="alert" hidden></p>
          <div class="modale-actions">
            <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
            <button type="submit" class="btn btn-primaire">Entrer</button>
          </div>
        </form>`
    });
    const form = el.querySelector('form');
    const zoneErreur = form.querySelector('.erreur-form');
    form.addEventListener('click', (e) => {
      const s = e.target.closest('[data-heures]');
      if (!s) return;
      duree = Number(s.dataset.heures);
      form.querySelectorAll('[data-heures]').forEach((x) => { const a = x === s; x.classList.toggle('actif', a); x.setAttribute('aria-pressed', String(a)); });
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bouton = form.querySelector('[type=submit]');
      zoneErreur.hidden = true;
      boutonOccupe(bouton, true, 'Ouverture…');
      try {
        reponse = premiere(await rpc('entrer_dans_boutique', { p_boutique: b.id, p_motif: form.motif.value.trim(), p_heures: duree }));
        fermer();
      } catch (err) {
        // MOTIF_REQUIS (moins de dix caractères) et tout autre refus : la fenêtre reste ouverte, message tel quel.
        const brut = String(err?.message || err || '');
        zoneErreur.textContent = brut === 'MOTIF_REQUIS' ? 'Écrivez le motif en une phrase (dix caractères au moins).' : brut;
        zoneErreur.hidden = false;
        boutonOccupe(bouton, false);
        form.motif.focus();
      }
    });
  });
}

/**
 * Accès ouvert : mes_depannages() dit jusqu'à quand (lu ici, à l'entrée, une fois), la boutique est lue avec les
 * droits du dépannage, puis devient la boutique active avec un membre fictif « vendeur ».
 */
async function ouvrirDepannage(id, connue = {}) {
  const liste = await rpc('mes_depannages').catch(() => []);
  const acces = (Array.isArray(liste) ? liste : [liste]).find((a) => champ(a, 'boutique_id', 'boutique') === id || a?.boutique?.id === id);
  if (!acces) return false;
  const { data } = await sb.from('boutiques').select(COLONNES_BOUTIQUE).eq('id', id).maybeSingle();
  const boutique = { ...connue, ...(data || {}), id, nom: data?.nom || connue.nom || champ(acces, 'boutique_nom', 'nom') || 'Boutique' };
  ajouterBoutiqueDepannage(boutique, { id: acces.id, expire_le: champ(acces, 'expire_le', 'fin', 'expire'), droits: acces.droits ?? null }, nomMoi());
  return choisirBoutique(id);
}

/** Rechargement de la page pendant un dépannage : la boutique ouverte n'est pas parmi les boutiques du membre. */
export async function reprendreDepannage(id) {
  if (!id || etat.boutiques.some((x) => x.boutique.id === id)) return;
  try {
    if (!(await ouvrirDepannage(id))) sortirDeBoutique();
  } catch {
    sortirDeBoutique();
  }
}

/* ------------------------------------------------------------ Sortir */

let minuterie = null;

/** « Sortir » : ferme l'accès avant l'heure et revient au tableau de bord. Fin d'accès atteinte : sans appel. */
export async function sortirDuDepannage({ appeler = true } = {}) {
  const id = etat.depannage?.boutique_id;
  clearTimeout(minuterie);
  if (appeler && id) {
    try { await rpc('sortir_de_boutique', { p_boutique: id }); } catch (err) { toast(String(err?.message || err), 'erreur', 6000); return; }
  }
  oublierDepannage();
  sortirDeBoutique();
  document.querySelector('.shell')?.remove();
  document.body.classList.remove('depannage');
  const { naviguer } = await import('./router.js');
  naviguer('', { remplacer: true });
}

/* ------------------------------------------------------------ Bandeau et gestes éteints */

/** « 23 h 59 », précédé de « demain » si la fin tombe le lendemain (heure de Conakry, comme le reste de l'appli). */
function heureFin(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const jour = (x) => new Intl.DateTimeFormat('fr-CA', { timeZone: FUSEAU }).format(x);
  const heure = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit' }).format(d).replace(':', ' h ');
  return `${jour(d) === jour(new Date()) ? '' : 'demain '}à ${heure.replace(/^0(\d)/, '$1')}`;
}

export function bandeauDepannageHTML() {
  if (!enDepannage()) return '';
  const fin = heureFin(etat.depannage.expire_le);
  return `<div class="bandeau-depannage" role="status">
    ${icone('outil', 18, 2)}
    <span><strong>Vous dépannez ${esc(etat.boutique.nom)}</strong>${fin ? ` · se ferme ${esc(fin)}` : ''}</span>
    <button type="button" class="btn-bandeau-depannage" data-sortir-depannage>Sortir</button>
  </div>`;
}

/** Appelé par la coquille à chaque écran : bandeau, gestes éteints, fin d'accès programmée. */
export function appliquerDepannage(shell) {
  const zone = shell?.querySelector('[data-zone="bandeau-depannage"]');
  const actif = enDepannage();
  if (zone) zone.innerHTML = bandeauDepannageHTML();
  document.body.classList.toggle('depannage', actif);
  if (!actif) { observateur?.disconnect(); observateur = null; return; }
  eteindre();
  if (!observateur) {
    observateur = new MutationObserver(() => eteindre());
    observateur.observe(document.body, { childList: true, subtree: true });
  }
  clearTimeout(minuterie);
  const reste = new Date(etat.depannage.expire_le).getTime() - Date.now();
  if (reste > 0 && reste < 2 ** 31) {
    minuterie = setTimeout(() => { toast('L’accès de dépannage est terminé.', 'info', 6000); sortirDuDepannage({ appeler: false }); }, reste);
  }
}

let observateur = null;
function eteindre() {
  if (!enDepannage()) return;
  document.querySelectorAll('[data-gerant], [data-gerant] button, [data-gerant] a, [data-gerant] input, [data-gerant] select, [data-gerant] textarea').forEach((b) => {
    if (b.dataset.eteint) return;
    b.dataset.eteint = '1';
    b.setAttribute('aria-disabled', 'true');
    if (b.matches('input, select, textarea')) b.disabled = true;
    if (b.tagName === 'A') b.tabIndex = -1;
    b.title = MESSAGE_DEPANNAGE;
  });
}

// Un geste éteint ne part jamais : le clic (ou l'envoi du formulaire) est arrêté avant tout écouteur de l'écran,
// et la raison s'affiche (sur téléphone, l'infobulle ne se voit pas). Les boutons restent cliquables pour cela.
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-sortir-depannage]')) { e.preventDefault(); sortirDuDepannage(); return; }
  if (!enDepannage() || !e.target.closest('[data-eteint], [data-gerant]')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  toast(MESSAGE_DEPANNAGE, 'info', 4000);
}, true);
document.addEventListener('submit', (e) => {
  if (!enDepannage() || !e.target.closest('[data-gerant]')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  toast(MESSAGE_DEPANNAGE, 'info', 4000);
}, true);

/* ------------------------------------------------------------ Qui est entré dans ma boutique */

/** Section de Paramètres, pour tout membre (pas pendant un dépannage : la liste est celle du boutiquier). */
export function sectionQuiEstEntreHTML() {
  if (!etat.boutique || enDepannage()) return '';
  return `<section class="carte section-parametres" data-zone="qui-est-entre">
    <h2>Qui est entré dans ma boutique</h2>
    <p class="discret">Les personnes de la direction qui ont ouvert votre boutique sans en être membres, et pourquoi.</p>
    <div data-ref="liste-depannages"><span class="squelette" style="height:48px"></span></div>
  </section>`;
}

export async function chargerQuiEstEntre(racine) {
  const zone = racine.querySelector('[data-ref="liste-depannages"]');
  if (!zone) return;
  const id = etat.boutique.id;
  let liste;
  try { liste = await rpc('depannages_boutique', { p_boutique: id }); } catch (err) {
    if (zone.isConnected) zone.innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(String(err?.message || err))}</p>`;
    return;
  }
  if (!zone.isConnected || etat.boutique?.id !== id) return;
  const lignes = (Array.isArray(liste) ? liste : liste ? [liste] : [])
    .sort((a, b) => String(champ(b, 'ouvert_le', 'created_at', 'debut', 'entre_le')).localeCompare(String(champ(a, 'ouvert_le', 'created_at', 'debut', 'entre_le'))));
  if (!lignes.length) { zone.innerHTML = '<p class="discret">Personne n’est entré dans votre boutique depuis la direction.</p>'; return; }
  zone.innerHTML = `<ul class="liste-depannages">${lignes.map((d) => {
    const quand = champ(d, 'ouvert_le', 'created_at', 'debut', 'entre_le');
    const ferme = champ(d, 'ferme_le', 'sorti_le', 'fin_le');
    const ouvert = d.ouvert ?? d.actif ?? d.en_cours ?? (!ferme && new Date(champ(d, 'expire_le')).getTime() > Date.now());
    return `<li>
      <div class="ld-haut"><strong>${esc(champ(d, 'nom', 'qui', 'par_nom', 'auteur') || 'Direction')}</strong>
        <span class="ld-etat ${ouvert ? 'ouvert' : ''}">${ouvert ? 'Accès ouvert' : 'Accès fermé'}</span></div>
      <p class="ld-motif">« ${esc(champ(d, 'motif') || '')} »</p>
      <span class="discret">${quand ? esc(formatDate(quand, 'complet')) : ''}${ouvert && champ(d, 'expire_le') ? ` · se ferme ${esc(heureFin(champ(d, 'expire_le')))}` : ''}</span>
    </li>`;
  }).join('')}</ul>`;
}
