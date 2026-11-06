/**
 * admin/console/facturation.js — Étape 24, abonnement ou commission, côté direction.
 *
 *  - « Comment cette boutique paie YOUMMA » (fiche et création) : deux cartes, Abonnement ou Commission ; en commission,
 *    taux en ligne, taux comptoir et plafond (interrupteur pour l'enlever) → definir_facturation. Les bornes (0 à 50,
 *    plafond) sont celles du serveur : aucun contrôle inventé ici, son message s'affiche tel quel, traduit.
 *    Simulation : commission_du_mois(boutique, mois dernier), aux taux ENREGISTRÉS (le navigateur ne calcule rien) ;
 *  - « Les boutiques en commission » (porte violette) : boutiques_en_commission(p_espace), étiquette tirée de
 *    etat.code, détail d'une ligne et « Marquer payé » → regler_commission (modes : modes_de_paiement('licence', pays)).
 */
import { esc, icone, formatNombre, toast, ouvrirModale, boutonOccupe } from '../../utils.js';
import { rpc, tableau, lienWa } from '../commun.js';
import { chargerModes } from '../../modes-paiement.js';
import { drapeau } from './commun.js';
import {
  premiere, lire, lireDecompte, montant, taux, nomMois, moisISO, sansVente, pastilleEtat, erreurFacturation, dateCourte
} from '../../commission-commun.js';

const RAISON_PLAFOND = 'Le plafond est le prix de l’abonnement : une boutique qui sait qu’elle ne paiera jamais plus qu’en abonnement n’a aucune raison de cacher ses ventes au comptoir.';
const liste = (d, ...cles) => (Array.isArray(d) ? d : cles.map((c) => d?.[c]).find(Array.isArray) || []);

/** Réglage actuel d'une boutique : clé facturation de la fiche si elle existe, sinon sa ligne de boutiques_en_commission. */
async function reglageActuel({ id, fiche, espace }) {
  const f = fiche?.facturation;
  if (f && typeof f === 'object' && f.mode) return f;
  try {
    const r = await rpc('boutiques_en_commission', { p_espace: espace });
    const ligne = liste(premiere(r) && !Array.isArray(r) ? premiere(r) : r, 'lignes', 'boutiques').find((b) => (b.id || b.boutique_id) === id);
    return ligne ? { mode: 'commission', ...ligne } : { mode: 'abonnement' };
  } catch {
    return { mode: 'abonnement' };
  }
}

/* ------------------------------------------------------------ 1 — Comment cette boutique paie YOUMMA */

export const blocFacturationHTML = () => '<section class="carte cs-bloc cs-facturation" data-zone="facturation"><span class="squelette" style="height:180px"></span></section>';

/**
 * zone : la section posée par blocFacturationHTML(). b : { id, nom, espace (code), prixAbonnement, formuleNom, fiche }.
 * apres(message) : appelé après un enregistrement réussi.
 */
export async function monterFacturation(zone, b, { apres = null } = {}) {
  if (!zone) return;
  const actuel = await reglageActuel({ id: b.id, fiche: b.fiche, espace: b.espace });
  if (!zone.isConnected) return;
  const s = {
    mode: actuel.mode === 'commission' ? 'commission' : 'abonnement',
    enLigne: lire(actuel, 'taux_en_ligne') ?? '',
    comptoir: lire(actuel, 'taux_comptoir') ?? '',
    // Plafond : celui enregistré ; à défaut, le prix de l'abonnement (le principe même du plafond).
    plafond: lire(actuel, 'plafond') ?? (b.prixAbonnement || ''),
    avecPlafond: actuel.mode === 'commission' ? lire(actuel, 'plafond') !== undefined : true
  };
  const prix = b.prixAbonnement ? montant(b.prixAbonnement) : null;

  function rendre() {
    const c = s.mode === 'commission';
    zone.innerHTML = `
      <div class="cs-bloc-tete"><h2>Comment cette boutique paie YOUMMA</h2><span class="pastille-admin ${c ? 'violet' : 'gris'}">${c ? 'Commission' : 'Abonnement'}</span></div>
      <form class="cf-form" novalidate>
        <div class="cf-cartes" role="radiogroup" aria-label="Mode de paiement à YOUMMA">
          <button type="button" class="cf-carte ${c ? '' : 'actif'}" role="radio" aria-checked="${!c}" data-mode="abonnement">
            <strong>Abonnement</strong><span>${prix ? `<span class="num">${esc(prix)}</span> par mois${b.formuleNom ? ` · ${esc(b.formuleNom)}` : ''}` : 'Le prix de sa formule'}</span><small>Un montant fixe, quelles que soient ses ventes.</small>
          </button>
          <button type="button" class="cf-carte ${c ? 'actif' : ''}" role="radio" aria-checked="${c}" data-mode="commission">
            <strong>Commission</strong><span>Une part de ses ventes</span><small>Plus cher sur ce que la vitrine lui apporte, moins cher au comptoir.</small>
          </button>
        </div>
        ${c ? `
          <div class="cf-champs">
            <div class="champ"><label for="cf-ligne">Taux en ligne (%)</label><input id="cf-ligne" class="input num" inputmode="decimal" value="${esc(s.enLigne)}" placeholder="ex. 8"></div>
            <div class="champ"><label for="cf-comptoir">Taux comptoir (%)</label><input id="cf-comptoir" class="input num" inputmode="decimal" value="${esc(s.comptoir)}" placeholder="ex. 3"></div>
            <div class="champ cf-plafond"><div class="cf-plafond-tete"><label for="cf-plafond">Plafond (GNF par mois)</label>
              <button type="button" class="interrupteur" role="switch" aria-checked="${s.avecPlafond}" data-action="plafond" aria-label="Plafond"><span></span></button></div>
              <input id="cf-plafond" class="input num" inputmode="numeric" value="${esc(s.plafond)}" ${s.avecPlafond ? '' : 'disabled'} placeholder="${s.avecPlafond ? '' : 'Sans plafond'}"></div>
          </div>
          <p class="cs-note">${esc(RAISON_PLAFOND)}</p>` : ''}
        <p class="erreur-form" role="alert" hidden></p>
        <div class="cs-actions-bloc"><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>
      <div class="cf-simulation" data-ref="simulation"><span class="squelette" style="height:48px"></span></div>`;
    simuler();
  }

  /** Ce qu'elle aurait payé le mois dernier : commission_du_mois, réponse du serveur telle quelle. */
  async function simuler() {
    const z = zone.querySelector('[data-ref="simulation"]');
    const mois = moisISO(-1);
    let dc = null;
    try { dc = lireDecompte(premiere(await rpc('commission_du_mois', { p_boutique: b.id, p_mois: mois }))); } catch (err) {
      if (z.isConnected) z.innerHTML = `<p class="cs-note">Simulation indisponible : ${esc(erreurFacturation(err))}</p>`;
      return;
    }
    if (!z.isConnected) return;
    const nom = nomMois(dc?.mois || mois);
    if (sansVente(dc)) { z.innerHTML = `<p class="cf-sim-vide">Aucune vente enregistrée en ${esc(nom)} : pas de simulation possible sur ce mois.</p>`; return; }
    z.innerHTML = s.mode === 'commission' || actuel.mode === 'commission'
      ? `<span class="etiquette">Simulation sur ${esc(nom)}, aux taux enregistrés</span>
         <p class="cf-sim">Elle aurait payé <strong class="num">${esc(montant(dc.du, dc.devise))}</strong>${dc.partChiffre !== null ? `, soit <strong class="num">${formatNombre(dc.partChiffre, 1)} %</strong>` : ''} de ses <span class="num">${esc(montant(dc.ventes, dc.devise))}</span> de ventes${dc.plafondAtteint ? ' — plafond atteint' : ''}.</p>
         ${actuel.mode !== 'commission' ? '<p class="cs-note">Enregistrez la commission pour simuler avec les taux saisis.</p>' : ''}`
      : `<span class="etiquette">${esc(nom)}</span><p class="cf-sim">Ventes du mois : <strong class="num">${esc(montant(dc.ventes, dc.devise))}</strong>. Choisissez la commission et enregistrez pour voir ce qu’elle aurait payé.</p>`;
  }

  zone.addEventListener('click', (ev) => {
    const carte = ev.target.closest('[data-mode]');
    if (carte) { lireChamps(); s.mode = carte.dataset.mode; rendre(); return; }
    if (ev.target.closest('[data-action="plafond"]')) { lireChamps(); s.avecPlafond = !s.avecPlafond; rendre(); }
  });
  function lireChamps() {
    const v = (sel) => zone.querySelector(sel)?.value.trim();
    if (zone.querySelector('#cf-ligne')) { s.enLigne = v('#cf-ligne'); s.comptoir = v('#cf-comptoir'); s.plafond = v('#cf-plafond'); }
  }
  const nombreSaisi = (t) => (t === '' || t === undefined ? null : Number(String(t).replace(/\s/g, '').replace(',', '.')));

  zone.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    lireChamps();
    const z = zone.querySelector('.erreur-form');
    const bouton = zone.querySelector('[type=submit]');
    z.hidden = true;
    boutonOccupe(bouton, true, 'Enregistrement…');
    const c = s.mode === 'commission';
    // Interrupteur allumé mais champ vide : on ne l'enverrait pas comme « sans plafond » à l'insu de la direction.
    if (c && s.avecPlafond && nombreSaisi(s.plafond) === null) {
      boutonOccupe(bouton, false);
      z.textContent = 'Indiquez le plafond, ou retirez-le avec l’interrupteur.';
      z.hidden = false;
      return;
    }
    try {
      // Abonnement : taux et plafond partent vides, la base les efface. Commission : les valeurs saisies, telles quelles.
      await rpc('definir_facturation', {
        p_boutique: b.id, p_mode: s.mode,
        p_taux_en_ligne: c ? nombreSaisi(s.enLigne) : null,
        p_taux_comptoir: c ? nombreSaisi(s.comptoir) : null,
        p_plafond: c && s.avecPlafond ? nombreSaisi(s.plafond) : null
      });
      Object.assign(actuel, { mode: s.mode });
      if (!c) Object.assign(s, { enLigne: '', comptoir: '', plafond: b.prixAbonnement || '', avecPlafond: true });
      toast(c ? `« ${b.nom} » paie désormais à la commission.` : `« ${b.nom} » repasse à l’abonnement.`, 'succes');
      rendre();
      apres?.();
    } catch (err) {
      boutonOccupe(bouton, false);
      z.textContent = erreurFacturation(err);
      z.hidden = false;
    }
  });

  rendre();
}

/* ------------------------------------------------------------ 3 — Les boutiques en commission */

const ESCALADE = `
  <section class="carte cs-encart cs-escalade"><h2>Ce qui part sans vous quand une commission n’est pas réglée</h2>
    <ol>
      <li><span class="cs-num">1</span><span><strong>Relancée</strong> · la boutique reçoit un rappel de son relevé.</span></li>
      <li><span class="cs-num">2</span><span><strong>Avertie</strong> · un bandeau « Vous devez … à YOUMMA » apparaît en haut de son application.</span></li>
      <li><span class="cs-num">3</span><span><strong>Vitrine coupée</strong> · à 15 jours d’impayé, sa boutique en ligne passe hors ligne. Elle revient dès le règlement ; sa caisse, son stock et ses rapports continuent de marcher.</span></li>
      <li><span class="cs-num">4</span><span><strong>Blocage possible</strong> · c’est à vous de décider : rien n’est bloqué sans vous.</span></li>
    </ol>
  </section>`;

/** Ligne de la liste → { id, nom, ville, drapeau, enLigne, comptoir, du, devise, plafondAtteint, etat, releve, telephone, pays } */
function lireLigne(l) {
  const e = l.etat && typeof l.etat === 'object' ? l.etat : { code: lire(l, 'etat_code', 'etat'), libelle: lire(l, 'etat_libelle'), jours: lire(l, 'jours') };
  return {
    brut: l, id: l.id || l.boutique_id, nom: lire(l, 'nom', 'boutique_nom') || '—', ville: lire(l, 'ville'), drapeau: lire(l, 'drapeau'),
    enLigne: lire(l, 'taux_en_ligne'), comptoir: lire(l, 'taux_comptoir'), plafond: lire(l, 'plafond'),
    du: Number(lire(l, 'du', 'du_mois', 'commission', 'montant')) || 0, devise: lire(l, 'devise') || 'GNF',
    ventes: lire(l, 'total_ventes', 'ventes', 'chiffre'), plafondAtteint: Boolean(lire(l, 'plafond_atteint')),
    etat: e, releve: lire(l, 'releve_id', 'releve') ?? e?.releve ?? null, telephone: lire(l, 'telephone'), pays: lire(l, 'pays'),
    mois: lire(l, 'mois') || e?.mois, dateLimite: lire(l, 'date_limite')
  };
}

export async function afficherCommissions(zone, e) {
  zone.innerHTML = '<span class="squelette" style="height:240px;margin:16px"></span>';
  let r;
  try { r = await rpc('boutiques_en_commission', { p_espace: e.code }); } catch (err) {
    zone.innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(erreurFacturation(err))}</p>`;
    return;
  }
  if (!zone.isConnected) return;
  const obj = !Array.isArray(r) ? premiere(r) : null;
  const lignes = liste(obj || r, 'lignes', 'boutiques').map(lireLigne);
  // Total à encaisser : celui du serveur ; à défaut, la somme des dûs qu'il a donnés, s'ils sont dans une seule monnaie.
  const devises = [...new Set(lignes.filter((l) => l.du > 0).map((l) => l.devise))];
  const totalServeur = lire(obj, 'total_a_encaisser', 'total', 'total_du');
  const total = totalServeur ?? (devises.length <= 1 ? lignes.reduce((t, l) => t + l.du, 0) : null);
  const devise = lire(obj, 'devise') || devises[0] || 'GNF';
  const mois = lire(obj, 'mois') || lignes.find((l) => l.mois)?.mois;

  zone.innerHTML = `
    ${tableau([
      ['Boutique', (l) => `<a class="cs-nom-ligne" href="#/fiche/${encodeURIComponent(l.id)}">${esc(l.nom)}</a><span class="cs-sous-ligne">${drapeau(l.drapeau)} ${esc(l.ville || '—')}</span>`],
      ['En ligne', (l) => `<span class="num">${esc(taux(l.enLigne))}</span>`, { droite: true }],
      ['Comptoir', (l) => `<span class="num">${esc(taux(l.comptoir))}</span>`, { droite: true }],
      [`Dû${mois ? ` · ${nomMois(mois)}` : ' du mois'}`, (l) => `<strong class="num">${esc(montant(l.du, l.devise))}</strong>`, { droite: true }],
      ['État', (l) => pastilleEtat(l.etat, l.plafondAtteint)]
    ], lignes, { classe: 'cs-tableau cf-tableau', vide: 'Aucune boutique ne paie à la commission pour l’instant.', attributsLigne: (l) => `data-commission="${esc(l.id)}" tabindex="0" class="cs-ligne-cliquable"` })}
    ${lignes.length ? `<div class="cf-pied">
      <div><span class="etiquette">Total à encaisser</span><strong class="num cf-total">${total === null ? 'plusieurs monnaies' : esc(montant(total, devise))}</strong></div>
      <button type="button" class="btn btn-primaire" data-action="envoyer-releves" ${lignes.some((l) => l.du > 0) ? '' : 'disabled'}>${icone('whatsapp', 18, 2)} Envoyer les relevés</button>
    </div>` : ''}
    ${ESCALADE}`;

  const ouvrir = (id) => { const l = lignes.find((x) => x.id === id); if (l) ouvrirDetail(l, () => afficherCommissions(zone, e)); };
  zone.onclick = (ev) => {
    if (ev.target.closest('[data-action="envoyer-releves"]')) { envoyerReleves(lignes.filter((l) => l.du > 0), mois); return; }
    const tr = ev.target.closest('tr[data-commission]');
    if (tr && !ev.target.closest('a')) ouvrir(tr.dataset.commission);
  };
  zone.onkeydown = (ev) => { const tr = ev.target.closest?.('tr[data-commission]'); if (tr && ev.key === 'Enter') ouvrir(tr.dataset.commission); };
}

/** Détail d'une ligne : décompte du mois (commission_du_mois) et « Marquer payé ». */
async function ouvrirDetail(l, relire) {
  const { el, fermer } = ouvrirModale({
    titre: l.nom,
    contenu: `<div class="cf-detail"><div data-ref="decompte"><span class="squelette" style="height:120px"></span></div>
      <div class="ligne-etat">${pastilleEtat(l.etat, l.plafondAtteint)}${l.etat?.libelle ? ` <span class="discret">${esc(l.etat.libelle)}</span>` : ''}</div>
      <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Fermer</button>
        <button type="button" class="btn btn-primaire" data-action="payer" ${l.releve ? '' : 'disabled title="Aucun relevé à régler pour cette boutique"'}>Marquer payé</button></div></div>`
  });
  el.querySelector('[data-action="payer"]').addEventListener('click', () => { fermer(); ouvrirReglement(l, relire); });
  try {
    const dc = lireDecompte(premiere(await rpc('commission_du_mois', { p_boutique: l.id, p_mois: moisISO() })));
    const z = el.querySelector('[data-ref="decompte"]');
    if (!z?.isConnected) return;
    z.innerHTML = sansVente(dc) ? `<p class="cf-sim-vide">Aucune vente en ${esc(nomMois(dc?.mois || moisISO()))} pour l’instant.</p>` : `
      <p class="cf-sim">${esc(nomMois(dc.mois || moisISO()))} : <strong class="num">${esc(montant(dc.du, dc.devise))}</strong> sur <span class="num">${esc(montant(dc.ventes, dc.devise))}</span> de ventes${dc.plafondAtteint ? ' · plafond atteint' : ''}.</p>
      ${dc.lignes.length ? `<ul class="fy-detail">${dc.lignes.map((x) => `<li><span class="fy-detail-nom">${esc(x.libelle)}<small>${esc(taux(x.taux))}${x.nb !== null ? ` · ${x.nb} vente${x.nb > 1 ? 's' : ''}` : ''}</small></span><strong class="num">${esc(montant(x.montant, dc.devise))}</strong></li>`).join('')}</ul>` : ''}`;
  } catch (err) {
    const z = el.querySelector('[data-ref="decompte"]');
    if (z) z.innerHTML = `<p class="bloc-erreur">${esc(erreurFacturation(err))}</p>`;
  }
}

/** « Marquer payé » : regler_commission(p_releve, p_mode, p_reference), modes lus dans la base. */
async function ouvrirReglement(l, relire) {
  const modes = await chargerModes('licence', l.pays || null);
  if (!modes.length) { toast('Impossible de lire les modes de paiement. Vérifiez la connexion.', 'erreur'); return; }
  const { el, fermer } = ouvrirModale({
    titre: `Commission réglée par « ${l.nom} »`,
    contenu: `<form class="form-modale" novalidate>
      <p class="texte-modale">Montant du relevé, selon la base : <strong class="num">${esc(montant(l.du, l.devise))}</strong>.</p>
      <div class="champ"><label for="cf-mode">Mode</label><select id="cf-mode" class="input">${modes.map((m) => `<option value="${esc(m.code)}">${esc(m.nom)}</option>`).join('')}</select></div>
      <div class="champ"><label for="cf-ref">Référence (facultatif)</label><input id="cf-ref" class="input" maxlength="80" placeholder="N° de transaction, reçu…"></div>
      <p class="erreur-form" role="alert" hidden></p>
      <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Marquer payé</button></div>
    </form>`
  });
  el.querySelector('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const bouton = el.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Enregistrement…');
    try {
      await rpc('regler_commission', { p_releve: l.releve, p_mode: el.querySelector('#cf-mode').value, p_reference: el.querySelector('#cf-ref').value.trim() || null });
      fermer();
      toast(`Relevé de « ${l.nom} » marqué payé.`, 'succes');
      relire();
    } catch (err) {
      boutonOccupe(bouton, false);
      const z = el.querySelector('.erreur-form');
      z.textContent = erreurFacturation(err);
      z.hidden = false;
    }
  });
}

/**
 * « Envoyer les relevés » : il n'existe pas de fonction serveur pour les envoyer ; chaque relevé part par WhatsApp,
 * avec les montants de la base, depuis le téléphone de la direction.
 */
function envoyerReleves(lignes, mois) {
  const nom = mois ? nomMois(mois) : 'ce mois';
  ouvrirModale({
    titre: 'Envoyer les relevés',
    contenu: `<p class="texte-modale">Un message WhatsApp par boutique, avec le montant de la base. Touchez chaque ligne pour l’envoyer.</p>
      <ul class="cf-envois">${lignes.map((l) => {
        const texte = `Bonjour, voici le relevé YOUMMA de « ${l.nom} » pour ${nom} : ${montant(l.du, l.devise)}${l.dateLimite ? `, à régler avant le ${dateCourte(l.dateLimite)}` : ''}. Le détail, vente par vente, est dans votre application : Paramètres › Ce que je dois à YOUMMA.`;
        return `<li><span><strong>${esc(l.nom)}</strong><small class="num">${esc(montant(l.du, l.devise))}</small></span>
          ${l.telephone ? `<a class="btn btn-whatsapp btn-petit" href="${esc(lienWa(String(l.telephone).replace(/\D/g, ''), texte))}" target="_blank" rel="noopener">${icone('whatsapp', 16, 2)} Envoyer</a>` : '<span class="discret">pas de numéro</span>'}</li>`;
      }).join('')}</ul>
      <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Fermer</button></div>`
  });
}
