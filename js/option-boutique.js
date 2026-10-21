/**
 * option-boutique.js — La boutique en ligne en option payante (étape 14b, maquette OptionBoutique.dc.html).
 *
 *  - page d'activation (#/boutique-en-ligne quand le module est à l'état « option ») : avantages, prix lu dans
 *    option_infos(p_boutique, p_code) — jamais en dur —, « Activer » ouvre WhatsApp avec un message pré-rempli ;
 *  - bandeaux au-dessus des onglets : « Comprise dans votre formule », « Offerte pendant l'essai », fin proche.
 * Aucun paiement dans l'appli : YOUMMA active l'option après réception (admin_option).
 */
import { sb } from './supabase.js';
import { etat, estGerant } from './state.js';
import { infoModule, formuleModules } from './modules.js';
import { lienSupport } from './plateforme.js';
import { esc, icone, ouvrirModale, formatNombre, formatDate, formatTelephone, dateISO, lienCourtBoutique, prixApplique } from './utils.js';
import { proposerSlug } from './boutique-en-ligne.js';

export const CODE_OPTION = 'boutique_en_ligne';
const NOMS_FORMULES = { essai: 'Essai', essentiel: 'Essentiel', pro: 'Pro', premium: 'Premium' };
const nomFormule = (c) => NOMS_FORMULES[c] || (c ? c.charAt(0).toUpperCase() + c.slice(1) : '');
const premiere = (d) => (Array.isArray(d) ? d[0] : d) || null;

const AVANTAGES = [
  ['stock', 'Vos articles en ligne', 'Photos, prix et disponibilité, mis à jour tout seuls depuis votre stock.'],
  ['whatsapp', 'Commandes par WhatsApp', 'Le client remplit son panier, vous recevez la commande toute prête.'],
  ['camion', 'Retrait ou livraison', 'Vos zones et vos frais de livraison, calculés automatiquement.'],
  ['image', 'Affiche du jour', 'Une affiche prête chaque matin pour Facebook et WhatsApp.'],
  ['qr', 'Lien et QR code', 'À coller sur votre devanture, vos cartes et vos factures.'],
  ['caisse', 'Vos commandes dans la caisse', 'Une commande livrée devient une vente, sans la ressaisir.']
];

/** Jours restants avant une date AAAA-MM-JJ (négatif si passée). */
function joursAvant(date) {
  if (!date) return null;
  return Math.round((new Date(`${String(date).slice(0, 10)}T12:00:00Z`) - new Date(`${dateISO()}T12:00:00Z`)) / 864e5);
}

/** Bandeau au-dessus des onglets de la boutique en ligne (option active), ou ''. */
export function bandeauOptionHTML() {
  const m = infoModule(CODE_OPTION);
  if (!m?.option_payante) return '';
  const formule = formuleModules();
  const prix = Number(m.prix_mois) || 0;
  const j = joursAvant(m.option_fin);
  if (j !== null && j >= 0 && j <= 7) {
    return `<div class="bandeau-option alerte" role="status">${icone('alerte', 17, 2)}
      <span>Votre boutique en ligne se termine le <strong>${esc(formatDate(`${String(m.option_fin).slice(0, 10)}T12:00:00Z`, 'long'))}</strong>. Renouvelez pour la garder ouverte.</span>
      <a class="btn btn-secondaire btn-petit" href="${esc(lienSupport(messageActivation(true)))}" target="_blank" rel="noopener">Renouveler</a></div>`;
  }
  if (formule === 'essai') {
    return `<div class="bandeau-option" role="status">${icone('valide', 17, 2)}
      <span><strong>Offerte pendant l’essai</strong>${prix ? ` — ensuite ${esc(formatNombre(prix))} GNF/mois` : ''}.</span></div>`;
  }
  if ((m.incluse_formules || []).includes(formule)) {
    return `<div class="bandeau-option" role="status">${icone('valide', 17, 2)}
      <span><strong>Comprise dans votre formule ${esc(nomFormule(formule))}</strong>.</span></div>`;
  }
  if (m.option_fin) {
    return `<div class="bandeau-option discret-option" role="status">${icone('valide', 17, 2)}
      <span>Option active jusqu’au ${esc(formatDate(`${String(m.option_fin).slice(0, 10)}T12:00:00Z`, 'court'))}.</span></div>`;
  }
  return '';
}

function messageActivation(renouveler = false) {
  const b = etat.boutique;
  const lieu = [b.ville].filter(Boolean).join(', ');
  return `Bonjour YOUMMA, je veux ${renouveler ? 'renouveler' : 'activer'} la boutique en ligne pour ${b.nom}${lieu ? ` (${lieu})` : ''}.`;
}

/** Lien WhatsApp vers le numéro de l'option (option_infos.whatsapp), sinon le support. */
function lienActivation(whatsapp) {
  const message = messageActivation();
  return whatsapp ? `https://wa.me/${String(whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(message)}` : lienSupport(message);
}

/** Page d'activation (à la place des onglets quand l'option n'est pas payée). */
export function afficherActivationOption(conteneur) {
  const boutique = etat.boutique;
  const responsable = estGerant();
  conteneur.innerHTML = `
    <div class="page page-option">
      <header class="option-entete">
        <h1>Boutique en ligne</h1>
        <span>Une option en plus de votre logiciel de gestion. Vous l’activez seulement si vous en voulez une.</span>
      </header>
      <div class="option-corps">
        <section class="carte option-avantages">
          <div class="option-vitrine">
            <span class="option-vitrine-icone">${icone('enLigne', 22, 1.8)}</span>
            <span class="option-vitrine-textes"><span class="etiquette-carte">Votre vitrine sur internet</span>
              <strong data-ref="adresse">${esc(lienCourtBoutique(proposerSlug(boutique.nom)))}</strong></span>
            <span class="option-pas-active">Pas encore activée</span>
          </div>
          <ul class="option-liste">
            ${AVANTAGES.map(([ic, titre, texte]) => `
              <li><span class="option-coche">${icone('valide', 15, 2.6)}</span>
                <span><strong>${esc(titre)}</strong><span>${esc(texte)}</span></span></li>`).join('')}
          </ul>
          <p class="option-sans">Sans cette option, votre logiciel de gestion fonctionne normalement : caisse, stock, clients, crédits, devis, rapports. Vous ne payez la boutique en ligne que si vous la voulez, et vous pouvez l’arrêter quand vous voulez.</p>
        </section>
        <aside class="option-cote">
          <section class="carte option-prix" data-zone="prix"><span class="squelette" style="height:150px"></span></section>
          <section class="carte option-payer" data-zone="payer"></section>
        </aside>
      </div>
    </div>`;
  const zone = (n) => conteneur.querySelector(`[data-zone="${n}"]`);

  function render(info) {
    const prix = Number(info.prix_mois) || 0;
    const offerts = Number(info.mois_offerts) || 0;
    const incluse = (info.incluse_formules || []).map(nomFormule).filter(Boolean);
    zone('prix').innerHTML = `
      <span class="etiquette-carte">Option ${esc(String(info.nom || 'boutique en ligne').toLowerCase())}</span>
      ${prix ? `<div class="option-montant"><strong>${esc(formatNombre(prix))}</strong><span>GNF / mois</span></div>` : ''}
      <span class="option-prix-texte">En plus de votre formule actuelle${info.formule ? ` (${esc(nomFormule(info.formule))})` : ''}.${offerts ? ` ${offerts} mois offerts si vous payez l’année.` : ''}${incluse.length ? ` Comprise dans la formule ${esc(incluse.join(', '))}.` : ''}</span>
      ${responsable
        ? `<a class="btn btn-primaire btn-bloc" href="${esc(lienActivation(info.whatsapp))}" target="_blank" rel="noopener" data-action="activer">Activer ma boutique en ligne</a>`
        : '<p class="option-prix-texte"><strong>Demandez au propriétaire de la boutique</strong> d’activer l’option.</p>'}
      <button type="button" class="btn btn-secondaire btn-bloc" data-action="exemple">Voir un exemple</button>`;
    zone('payer').innerHTML = `
      <strong>Comment payer</strong>
      <span><strong>Orange Money</strong> ou <strong>MTN MoMo</strong>${info.whatsapp ? ` au ${esc(formatTelephone(info.whatsapp).replace(/^\+224\s*/, ''))}` : ''}</span>
      <span>Votre boutique est ouverte dès que YOUMMA confirme le paiement.</span>`;
  }

  /** Aperçu : vos premiers articles tels qu'ils apparaîtraient sur la vitrine. */
  async function exemple() {
    const { data } = await sb.from('produits').select('id, nom, unite, prix_detail, prix_gros, prix_promo, promo_fin, photo_mini_url, photo_url')
      .eq('boutique_id', boutique.id).eq('actif', true).order('nom').limit(6);
    const articles = data || [];
    ouvrirModale({
      titre: 'Votre vitrine, en exemple',
      contenu: `
        <div class="option-exemple">
          <div class="option-exemple-tel">
            <div class="option-exemple-entete"><strong>${esc(boutique.nom)}</strong><span>${esc([boutique.ville].filter(Boolean).join(' · '))} · Commandez sur WhatsApp</span></div>
            <div class="option-exemple-grille">
              ${articles.length ? articles.map((p) => `
                <div class="option-exemple-article">
                  ${p.photo_mini_url || p.photo_url ? `<img src="${esc(p.photo_mini_url || p.photo_url)}" alt="" loading="lazy">` : `<span class="option-exemple-photo">${icone('stock', 22, 1.6)}</span>`}
                  <strong>${esc(p.nom)}</strong><span>${esc(formatNombre(prixApplique(p)))} GNF${p.unite ? ` / ${esc(p.unite)}` : ''}</span>
                  <span class="option-exemple-ajout">Ajouter</span>
                </div>`).join('') : '<p class="discret">Ajoutez des articles dans votre stock : ils apparaîtront ici.</p>'}
            </div>
          </div>
          <p class="discret">Vos clients voient vos articles avec vos prix, remplissent un panier et vous envoient la commande sur WhatsApp. Elle arrive aussi dans l’appli, prête à devenir une vente.</p>
        </div>`
    });
  }

  conteneur.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="exemple"]')) exemple();
  });

  (async () => {
    const [infos, enLigne] = await Promise.all([
      sb.rpc('option_infos', { p_boutique: boutique.id, p_code: CODE_OPTION }),
      sb.from('boutiques_en_ligne').select('slug').eq('boutique_id', boutique.id).maybeSingle()
    ]);
    if (!conteneur.isConnected) return;
    if (enLigne.data?.slug) conteneur.querySelector('[data-ref="adresse"]').textContent = lienCourtBoutique(enLigne.data.slug);
    // Repli sur les données du module si option_infos est indisponible (le prix vient toujours de la base).
    const m = infoModule(CODE_OPTION) || {};
    const info = premiere(infos.data) || { nom: m.nom, prix_mois: m.prix_mois, incluse_formules: m.incluse_formules, formule: formuleModules() };
    render(info);
  })();
}
