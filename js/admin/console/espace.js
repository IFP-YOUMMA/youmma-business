/**
 * admin/console/espace.js — La liste d'un espace (étape 19), #/espace/<code>.
 *
 * L'écran dépend de la facturation de l'espace renvoyée par console_accueil(), jamais de son code :
 *  - commission (maquette DirectionVendeurs) : les vendeurs, leur commission, ce qu'ils rapportent, et surtout leurs
 *    affiches sur 30 jours (rouge sous 10 : un vendeur qui ne publie plus cesse de vendre) ;
 *  - licence (maquette DirectionLicences) : les boutiques qui paient, avec « dernier usage » en colonne principale
 *    (endormie au-delà de 21 jours, décidé par la base) et, dans l'en-tête, « … ne voit pas cette page ».
 * Un code absent de console_accueil() renvoie à l'accueil sans aucun appel : console_boutiques n'est jamais tenté sur
 * un espace interdit. Les filtres « actives », « endormies »… sont ceux de la base ; le filtre par ville se fait ici.
 */
import { esc, icone, formatNombre, formatGNF, differer } from '../../utils.js';
import { rpc, tableau, chargerActivites, telLocal } from '../commun.js';
import {
  espace, peutGererAcces, estSuperAdmin, entete, kpi, montantEspace, montantDevise, erreurConsole, dernierUsage, etatAffiches,
  SEUIL_AFFICHES, chargerFormulesConsole, finDans, drapeau
} from './commun.js';

const FILTRES = {
  commission: [['', 'Tous'], ['actives', 'Actifs'], ['endormies', 'N’ouvrent plus']],
  licence: [['', 'Toutes'], ['a_relancer', 'À relancer'], ['actives', 'Actives'], ['expirees', 'Expirées'], ['endormies', 'N’ouvrent plus'], ['suspendues', 'Suspendues']]
};

const pastille = (texte, ton) => `<span class="pastille-admin ${ton}">${esc(texte)}</span>`;

function etatLicence(b) {
  if (b.suspendue) return pastille('Suspendue', 'gris');
  if (Number(b.jours_restants) < 0) return pastille('Expirée', 'rouge');
  if (b.endormie) return pastille('N’ouvre plus', 'rouge');
  if (Number(b.jours_restants) <= 15) return pastille('Finit bientôt', 'rouge');
  return pastille('Active', 'vert');
}

export function afficherEspace(conteneur, { id }) {
  const e = espace(id);
  if (!e) { location.replace('#/accueil'); return; }
  const vendeurs = e.facturation === 'commission';
  const s = { tous: [], lignes: [], filtre: '', ville: '', recherche: '', activites: {}, formules: {}, associe: null };

  conteneur.innerHTML = `
    <div class="cs-page cs-page-espace">
      ${entete({
        titre: vendeurs ? 'Les vendeurs' : 'Les licences',
        sous: `${formatNombre(e.boutiques)} ${vendeurs ? 'vendeurs' : 'boutiques'} · ${e.nom_public} · ${vendeurs ? 'payés à la commission' : 'qui paient l’application'}`,
        couleur: e.couleur,
        badges: e.commun ? '<span class="cs-badge-entete">Affaire commune</span>' : '<span class="cs-badge-entete" data-ref="invisible" hidden></span>',
        actions: `${!vendeurs && estSuperAdmin() ? `<a class="cs-btn-entete" href="#/licences">${icone('caisse', 16, 2)} Paiements à valider</a>` : ''}
          <a class="cs-btn-entete" href="#/terrain?espace=${encodeURIComponent(e.code)}">${icone('plus', 16, 2)} ${vendeurs ? 'Nouveau vendeur' : 'Nouvelle boutique'}</a>`
      })}
      <div class="cs-kpis" data-zone="kpis"><span class="squelette" style="height:96px"></span></div>
      <section class="carte cs-liste">
        <div class="cs-liste-outils">
          <div class="cs-puces" role="group" aria-label="Filtres" data-zone="puces"></div>
          <label class="cs-recherche">${icone('recherche', 16, 2)}<span class="sr-only">Rechercher</span><input type="search" data-ref="recherche" placeholder="Nom, ville, téléphone…" autocomplete="off"></label>
        </div>
        <div data-zone="tableau"><span class="squelette" style="height:240px;margin:16px"></span></div>
      </section>
      <div class="cs-encarts">
        ${vendeurs ? `
          <section class="carte cs-encart"><h2>La colonne « Affiches » prédit tout le reste</h2>
            <p>Un vendeur qui ne publie plus cesse de vendre, puis s’en va en disant que ça ne marche pas. <strong>Ce n’est pas sa marchandise qui fait la différence, c’est sa présence.</strong> Sous ${SEUIL_AFFICHES} affiches sur 30 jours, appelez-le.</p></section>
          <section class="carte cs-encart cs-encart-jaune"><h2>Ils ne paient rien, et c’est voulu</h2>
            <p>Aucun abonnement, aucune licence, aucune date de fin : ils gagnent quand vous gagnez. Votre part est retenue avant de les payer.</p></section>`
        : `
          <section class="carte cs-encart"><h2>« Dernier usage » décide du renouvellement</h2>
            <p>Une boutique qui paie encore mais n’ouvre plus l’application depuis trois semaines a déjà arrêté, sans le savoir. Appelez maintenant : le mois de l’échéance, il n’y aura plus rien à sauver.</p></section>
          <section class="carte cs-encart cs-encart-teinte" data-ref="encart-associe" hidden></section>`}
      </div>
    </div>`;

  const q = (sel) => conteneur.querySelector(sel);

  function puces() {
    const villes = {};
    s.tous.forEach((b) => { if (b.ville) villes[b.ville] = (villes[b.ville] || 0) + 1; });
    q('[data-zone="puces"]').innerHTML = [
      ...FILTRES[e.facturation].map(([code, libelle]) => `<button type="button" class="cs-puce ${s.filtre === code && !s.ville ? 'actif' : ''}" data-filtre="${code}" aria-pressed="${s.filtre === code && !s.ville}">${esc(libelle)}${code ? '' : ` <span>${formatNombre(s.tous.length)}</span>`}</button>`),
      ...(vendeurs ? Object.entries(villes).sort((a, b) => b[1] - a[1]).map(([v, n]) => `<button type="button" class="cs-puce ${s.ville === v ? 'actif' : ''}" data-ville="${esc(v)}" aria-pressed="${s.ville === v}">${esc(v)} <span>${formatNombre(n)}</span></button>`) : [])
    ].join('');
  }

  function kpis() {
    const endormies = s.tous.filter((b) => b.endormie).length;
    if (vendeurs) {
      const muets = s.tous.filter((b) => Number(b.affiches_30j) < SEUIL_AFFICHES).length;
      // « À leur verser » : total des montants de la base, seulement s'ils sont tous dans la même monnaie
      // (on n'additionne jamais deux monnaies).
      const dus = s.tous.filter((b) => Number(b.a_lui_verser) > 0);
      const devises = [...new Set(dus.map((b) => b.devise))];
      const aVerser = devises.length === 1
        ? kpi('À leur verser', esc(montantDevise(dus.reduce((t, b) => t + Number(b.a_lui_verser), 0), devises[0])), `${formatNombre(dus.length)} vendeur${dus.length > 1 ? 's' : ''}`, 'rouge')
        : kpi('À leur verser', dus.length ? `${formatNombre(dus.length)} <small>vendeurs</small>` : '0', dus.length ? 'plusieurs monnaies : voir la colonne' : 'rien en attente');
      q('[data-zone="kpis"]').innerHTML = [
        kpi('Commission, 30 derniers jours', esc(montantEspace(e, e.recette_30j)), 'votre part, calculée par la base', 'vert'),
        aVerser,
        kpi('N’ouvrent plus l’application', formatNombre(endormies), endormies ? 'depuis plus de 21 jours' : 'tous l’ouvrent', endormies ? 'rouge' : ''),
        kpi('Ne publient plus', `${formatNombre(muets)} <small>vendeur${muets > 1 ? 's' : ''}</small>`, `moins de ${SEUIL_AFFICHES} affiches sur 30 jours`, muets ? 'rouge' : 'vert')
      ].join('');
      return;
    }
    const bientot = s.tous.filter((b) => Number(b.jours_restants) >= 0 && Number(b.jours_restants) <= 15 && !b.suspendue);
    q('[data-zone="kpis"]').innerHTML = [
      kpi('Licences encaissées, 30 jours', esc(montantEspace(e, e.recette_30j)), `${formatNombre(e.payantes)} boutique${e.payantes > 1 ? 's' : ''} payante${e.payantes > 1 ? 's' : ''}`, 'vert'),
      kpi('Se terminent sous 15 jours', `${formatNombre(bientot.length)} <small>licence${bientot.length > 1 ? 's' : ''}</small>`, bientot.length ? esc(bientot.slice(0, 2).map((b) => b.nom).join(', ')) : 'aucune', bientot.length ? 'rouge' : ''),
      kpi('N’ouvrent plus l’application', `${formatNombre(endormies)} <small>boutique${endormies > 1 ? 's' : ''}</small>`, endormies ? 'elles paient encore' : 'toutes l’ouvrent', endormies ? 'rouge' : ''),
      kpi('À relancer', formatNombre(e.a_relancer), 'selon la base', e.a_relancer ? 'rouge' : '')
    ].join('');
  }

  const nomActivite = (code) => s.activites[code] || code || '—';

  function rendreTableau() {
    const lignes = s.ville ? s.lignes.filter((b) => b.ville === s.ville) : s.lignes;
    const ouvrir = (b) => `data-fiche="${esc(b.id)}" tabindex="0" class="cs-ligne-cliquable"`;
    const nom = (b) => `<a class="cs-nom-ligne" href="#/fiche/${encodeURIComponent(b.id)}">${esc(b.nom)}</a><span class="cs-sous-ligne">${esc(nomActivite(b.type_activite))}</span>`;
    const usage = (b) => `<span class="cs-usage ${b.endormie ? 'rouge' : ''}">${esc(dernierUsage(b.derniere_activite))}</span>`;
    const ville = (b) => `${drapeau(b.drapeau)} ${esc(b.ville || '—')}`;
    // Montants d'un vendeur dans sa monnaie (devise de la ligne), tels que la base les renvoie.
    const m = (n, b) => esc(montantDevise(n, b.devise));
    const colonnes = vendeurs ? [
      ['Vendeur', (b) => `<a class="cs-nom-ligne" href="#/fiche/${encodeURIComponent(b.id)}">${esc(b.nom)}</a><span class="cs-sous-ligne">${esc(b.specialite || b.activite_nom || nomActivite(b.type_activite))}</span>`],
      ['Ville', ville],
      ['Com.', (b) => `<strong class="vert">${b.commission === null || b.commission === undefined ? '—' : `${formatNombre(b.commission, 2)} %`}</strong>`],
      ['Art.', (b) => `${formatNombre(b.articles)}${Number(b.articles_sans_photo) ? ` <small class="rouge" title="sans photo">· ${formatNombre(b.articles_sans_photo)} sans photo</small>` : ''}`],
      ['Cmd.', (b) => formatNombre(b.commandes_30j)],
      ['Ventes, 30 j', (b) => m(b.ventes_30j, b), { droite: true }],
      ['Votre part', (b) => `<strong class="vert">${m(b.votre_part_30j ?? b.commission_30j, b)}</strong>`, { droite: true }],
      ['À lui verser', (b) => `<strong>${m(b.a_lui_verser, b)}</strong>`, { droite: true }],
      ['Affiches, 30 j', (b) => `<strong class="${Number(b.affiches_30j) < SEUIL_AFFICHES ? 'rouge' : 'vert'}">${formatNombre(b.affiches_30j)}/30</strong>`],
      ['Dernier usage', usage],
      ['État', (b) => (b.suspendue ? pastille('Suspendu', 'gris') : pastille(...etatAffiches(b.affiches_30j)))]
    ] : [
      ['Boutique', (b) => `<a class="cs-nom-ligne" href="#/fiche/${encodeURIComponent(b.id)}">${esc(b.nom)}</a><span class="cs-sous-ligne">${esc([b.proprietaire, telLocal(b.telephone)].filter(Boolean).join(' · '))}</span>`],
      ['Ville', ville],
      ['Activité', (b) => esc(b.activite_nom || nomActivite(b.type_activite))],
      ['Formule', (b) => pastille(s.formules[b.licence_formule]?.nom || b.licence_formule || '—', 'violet')],
      ['Par mois', (b) => { const p = b.prix_mois ?? s.formules[b.licence_formule]?.prix_mois; return p === null || p === undefined ? '—' : esc(formatGNF(p)); }, { droite: true }],
      ['Finit dans', (b) => `<strong class="${Number(b.jours_restants) <= 15 ? 'rouge' : 'vert'}">${esc(finDans(b.jours_restants))}</strong>`],
      ['Dernier usage', usage],
      ['État', etatLicence]
    ];
    q('[data-zone="tableau"]').innerHTML = tableau(colonnes, lignes, {
      classe: 'cs-tableau', attributsLigne: ouvrir,
      vide: s.recherche || s.filtre || s.ville ? 'Aucune boutique ne correspond.' : (vendeurs ? 'Aucun vendeur pour l’instant.' : 'Aucune boutique pour l’instant.')
    });
  }

  async function charger() {
    try {
      s.lignes = (await rpc('console_boutiques', { p_espace: e.code, p_filtre: s.filtre || null, p_recherche: s.recherche || null, p_limite: 500 })) || [];
      if (!conteneur.isConnected) return;
      if (!s.filtre && !s.recherche) { s.tous = s.lignes; kpis(); }
      puces();
      rendreTableau();
    } catch (err) {
      q('[data-zone="tableau"]').innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(erreurConsole(err))}</p>`;
    }
  }

  (async () => {
    const [activites, formules, acces] = await Promise.all([
      chargerActivites().catch(() => []),
      vendeurs ? {} : chargerFormulesConsole().catch(() => ({})),
      !vendeurs && peutGererAcces() ? rpc('console_acces').catch(() => []) : []
    ]);
    s.activites = Object.fromEntries((activites || []).map((a) => [a.code, a.nom]));
    s.formules = formules || {};
    // Licences : on dit en clair qui ne voit pas la page (l'associé d'un espace commun), pour le jour où l'écran est partagé.
    const associe = (acces || []).find((a) => a.role === 'admin_espace' && a.actif !== false);
    const prenomAssocie = associe ? String(associe.nom || '').split(' ')[0] : '';
    if (!vendeurs) {
      const badge = q('[data-ref="invisible"]');
      badge.innerHTML = `${icone('oeil', 14, 2)} ${esc(prenomAssocie || 'Votre associé')} ne voit pas cette page`;
      badge.hidden = false;
      const encart = q('[data-ref="encart-associe"]');
      encart.innerHTML = `<h2>Cette page n’existe pas pour ${esc(prenomAssocie || 'votre associé')}</h2><p>Ni la porte sur l’accueil, ni ces montants, ni ces boutiques dans la recherche : sa console ne reçoit que les espaces communs.</p>`;
      encart.hidden = false;
    }
    await charger();
  })();

  conteneur.addEventListener('click', (ev) => {
    const puce = ev.target.closest('.cs-puce');
    if (puce) {
      if (puce.dataset.ville !== undefined) { s.ville = s.ville === puce.dataset.ville ? '' : puce.dataset.ville; puces(); rendreTableau(); return; }
      s.ville = '';
      s.filtre = puce.dataset.filtre || '';
      charger();
      return;
    }
    const ligne = ev.target.closest('tr[data-fiche]');
    if (ligne && !ev.target.closest('a')) location.hash = `#/fiche/${encodeURIComponent(ligne.dataset.fiche)}`;
  });
  conteneur.addEventListener('keydown', (ev) => {
    const ligne = ev.target.closest?.('tr[data-fiche]');
    if (ligne && ev.key === 'Enter') location.hash = `#/fiche/${encodeURIComponent(ligne.dataset.fiche)}`;
  });
  q('[data-ref="recherche"]').addEventListener('input', differer((ev) => { s.recherche = ev.target.value.trim(); charger(); }, 300));
}
