/**
 * boutique-onglets.js — « Boutique en ligne » en cinq onglets (étape 14, maquette BoutiqueOnglets.dc.html) :
 * Commandes · Articles en ligne · Affiche du jour · Livraison & zones · Réglages.
 *
 *  - #/boutique-en-ligne?onglet=<code> ; #/boutique-en-ligne/<id> : une commande (en page sur téléphone) ;
 *  - chaque onglet affiche l'écran existant tel quel (commandes.js, boutique-en-ligne.js, affiche-jour.js),
 *    son en-tête masqué au profit de l'en-tête commun ;
 *  - colonne de droite (onglet Commandes) : affiche du jour (Publier / Changer) + « Cette semaine »
 *    (stats_boutique_en_ligne sur 7 jours).
 * L'affiche du jour dépend de la boutique en ligne : la base renvoie son module inactif sinon → onglet masqué.
 * Étape 14b : option payante non payée (état « option ») → page d'activation à la place des onglets.
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import { aModule, enOption } from './modules.js';
import { afficherActivationOption, bandeauOptionHTML, CODE_OPTION } from './option-boutique.js';
import { esc, icone, formatNombre, formatGNF, dateISO, lienBoutique, lienCourtBoutique } from './utils.js';
import { afficherCommandes } from './commandes.js';
import { afficherBoutiqueEnLigne } from './boutique-en-ligne.js';
import { afficherAfficheJour } from './affiche-jour.js';

const estMobile = () => window.matchMedia('(max-width: 899.98px)').matches;
const premiere = (d) => (Array.isArray(d) ? d[0] : d) || null;

function ongletsDisponibles() {
  const gerer = peut('boutique_en_ligne.gerer');
  return [
    ['commandes', 'Commandes', peut('commandes.voir')],
    ['articles', 'Articles en ligne', gerer],
    ['affiche', 'Affiche du jour', aModule('affiche') && peut('affiche.partager')],
    ['zones', 'Livraison & zones', gerer],
    ['reglages', 'Réglages', gerer]
  ].filter(([, , ok]) => ok);
}

export function afficherBoutiqueOnglets(conteneur, params) {
  if (enOption(CODE_OPTION)) return afficherActivationOption(conteneur);
  const idCommande = params.get('id');
  // Téléphone : la commande s'ouvre en page entière (comme avant).
  if (idCommande && estMobile()) return afficherCommandes(conteneur, params);

  const boutique = etat.boutique;
  const onglets = ongletsDisponibles();
  const demande = idCommande ? 'commandes' : params.get('onglet');
  const onglet = onglets.find(([code]) => code === demande)?.[0] || onglets[0]?.[0] || 'commandes';
  const avecCote = onglet === 'commandes';

  conteneur.innerHTML = `
    <div class="page page-boutique-onglets">
      <header class="bo-entete">
        <div class="bo-titres">
          <h1>Boutique en ligne</h1>
          <span class="bo-sous" data-zone="sous-titre">${esc(boutique.nom)}</span>
        </div>
        <span class="bo-etat" data-zone="etat" hidden></span>
        <a class="btn btn-secondaire bo-vitrine" data-zone="vitrine" href="#/boutique-en-ligne?onglet=reglages" hidden>${icone('enLigne', 16, 2)} Voir ma vitrine</a>
      </header>
      ${bandeauOptionHTML()}
      <nav class="onglets-pastilles bo-onglets" aria-label="Boutique en ligne">
        ${onglets.map(([code, libelle]) => `<a class="onglet-pastille ${code === onglet ? 'actif' : ''}" href="#/boutique-en-ligne?onglet=${code}" ${code === onglet ? 'aria-current="page"' : ''}>${esc(libelle)}${code === 'commandes' ? '<span class="pastille-compte" data-zone="compte-commandes" hidden></span>' : ''}</a>`).join('')}
      </nav>
      <div class="bo-corps ${avecCote ? 'avec-cote' : ''}">
        <div class="bo-principal bo-onglet-${onglet}" data-zone="contenu"></div>
        ${avecCote ? '<aside class="bo-cote" data-zone="cote"></aside>' : ''}
      </div>
    </div>`;
  const zone = (nom) => conteneur.querySelector(`[data-zone="${nom}"]`);
  const contenu = zone('contenu');

  // Écran de l'onglet (écrans existants, inchangés).
  let nettoyer;
  if (onglet === 'commandes') nettoyer = afficherCommandes(contenu, params);
  else if (onglet === 'affiche') nettoyer = afficherAfficheJour(contenu);
  else {
    nettoyer = afficherBoutiqueEnLigne(contenu);
    contenu.dataset.section = onglet;
  }

  /* ---------------- En-tête : adresse de la vitrine, visites de la semaine, état */

  async function chargerEntete() {
    const debut = dateISO(-6);
    const [enLigne, stats] = await Promise.all([
      sb.from('boutiques_en_ligne').select('slug, actif').eq('boutique_id', boutique.id).maybeSingle(),
      sb.rpc('stats_boutique_en_ligne', { p_boutique: boutique.id, p_debut: debut, p_fin: dateISO() })
    ]);
    if (!conteneur.isConnected) return;
    const reglages = enLigne.data || null;
    const st = stats.error ? null : premiere(stats.data) || {};
    const morceaux = [];
    if (reglages?.slug) morceaux.push(`<span class="bo-adresse">${esc(lienCourtBoutique(reglages.slug))}</span>`);
    if (st) morceaux.push(`${formatNombre(st.visites || 0)} visite${Number(st.visites) > 1 ? 's' : ''} cette semaine`);
    zone('sous-titre').innerHTML = morceaux.length ? morceaux.join(' · ') : esc(boutique.nom);
    if (reglages) {
      const etatZone = zone('etat');
      etatZone.hidden = false;
      etatZone.className = `bo-etat ${reglages.actif ? 'ouverte' : 'fermee'}`;
      etatZone.textContent = reglages.actif ? 'Ouverte' : 'Fermée';
    }
    if (reglages?.slug) {
      const vitrine = zone('vitrine');
      vitrine.hidden = false;
      vitrine.href = lienBoutique(reglages.slug);
      vitrine.target = '_blank';
      vitrine.rel = 'noopener';
    }
    if (st && Number(st.a_traiter)) {
      const compte = zone('compte-commandes');
      if (compte) { compte.hidden = false; compte.textContent = String(st.a_traiter); }
    }
    if (avecCote) renderCote(st);
  }

  /* ---------------- Colonne de droite (onglet Commandes) */

  async function renderCote(st) {
    const cote = zone('cote');
    if (!cote) return;
    const plusVu = st && (st.article_plus_vu || st.plus_vu || st.produit_plus_vu);
    const nomPlusVu = typeof plusVu === 'object' && plusVu ? plusVu.nom : plusVu;
    const ligne = (libelle, valeur) => `<div class="bo-stat"><span>${esc(libelle)}</span><strong>${valeur}</strong></div>`;
    cote.innerHTML = `
      <section class="carte bo-affiche" data-zone="cote-affiche" hidden></section>
      ${st ? `<section class="carte bo-semaine">
        <h2>Cette semaine</h2>
        ${ligne('Visites', formatNombre(st.visites || 0))}
        ${ligne('Commandes', formatNombre(st.commandes || 0))}
        ${ligne('Chiffre d’affaires', formatNombre(st.montant_livre || 0))}
        ${nomPlusVu ? ligne('Article le plus vu', esc(nomPlusVu)) : ''}
      </section>` : ''}`;
    if (!aModule('affiche') || !peut('affiche.partager')) return;
    const { data, error } = await sb.rpc('affiche_du_jour', { p_boutique: boutique.id });
    const z = cote.querySelector('[data-zone="cote-affiche"]');
    const a = premiere(data);
    if (error || !z?.isConnected || !a?.produit) return;
    const p = a.produit;
    const prix = Number(p.prix ?? p.prix_promo ?? p.prix_detail) || 0;
    z.hidden = false;
    z.innerHTML = `
      <span class="bo-affiche-vignette" aria-hidden="true"><span>${prix ? esc(formatNombre(prix)) : ''}</span></span>
      <div class="bo-affiche-textes">
        <span class="etiquette-carte">Affiche du jour</span>
        <strong>${esc([p.nom, prix ? formatGNF(prix) : ''].filter(Boolean).join(' · '))}</strong>
        <span class="discret">Prête pour WhatsApp et Facebook.</span>
        <div class="bo-affiche-boutons">
          <a class="btn btn-whatsapp btn-petit" href="#/boutique-en-ligne?onglet=affiche">Publier</a>
          <a class="btn btn-secondaire btn-petit" href="#/boutique-en-ligne?onglet=affiche">Changer</a>
        </div>
      </div>`;
  }

  chargerEntete();
  return typeof nettoyer === 'function' ? nettoyer : undefined;
}
