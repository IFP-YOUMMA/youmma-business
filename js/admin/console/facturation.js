/**
 * admin/console/facturation.js — Étape 24, abonnement ou commission, côté direction.
 *
 *  - « Comment cette boutique paie YOUMMA » (fiche et création) : réglage actuel lu par commission_du_mois (mode, taux,
 *    plafond) ; deux cartes, Abonnement ou Commission ; en commission, taux en ligne, taux comptoir et plafond
 *    (interrupteur pour l'enlever) → definir_facturation. Les bornes (0 à 50, plafond) sont celles du serveur.
 *    Simulation : simuler_commission(boutique, mois dernier, taux SAISIS, plafond) à chaque changement d'un champ,
 *    sans rien enregistrer ;
 *  - « Les boutiques en commission » (porte violette) : boutiques_en_commission(p_espace), étiquette tirée de
 *    etat.code (pays à côté de la ville s'il n'est pas GN) ; détail (commission_du_mois) et « Marquer payé » →
 *    regler_commission(etat.releve, …), moyens de la ligne (déjà filtrés par le pays de la boutique) ; « Envoyer les relevés » → envoyer_releves(p_espace, p_mois), SMS par la file,
 *    repli WhatsApp pour les boutiques sans téléphone.
 * Noms des champs : ceux de commission-commun.js, et eux seuls.
 */
import { esc, icone, formatNombre, toast, ouvrirModale, boutonOccupe, confirmer, copierTexte, differer } from '../../utils.js';
import { rpc, tableau } from '../commun.js';
import { premiere, exiger, montant, taux, nomMois, moisISO, detailHTML, pastilleEtat, erreurFacturation } from '../../commission-commun.js';

const RAISON_PLAFOND = 'Le plafond est le prix de l’abonnement : une boutique qui sait qu’elle ne paiera jamais plus qu’en abonnement n’a aucune raison de cacher ses ventes au comptoir.';

/* ------------------------------------------------------------ 1 — Comment cette boutique paie YOUMMA */

export const blocFacturationHTML = () => '<section class="carte cs-bloc cs-facturation" data-zone="facturation"><span class="squelette" style="height:180px"></span></section>';

/**
 * zone : la section posée par blocFacturationHTML(). b : { id, nom, prixAbonnement, formuleNom }.
 * apres() : appelé après un enregistrement réussi.
 */
export async function monterFacturation(zone, b, { apres = null } = {}) {
  if (!zone) return;
  let actuel;
  try { actuel = premiere(await rpc('commission_du_mois', { p_boutique: b.id, p_mois: moisISO() })); } catch (err) {
    if (zone.isConnected) zone.innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(erreurFacturation(err))}</p>`;
    return;
  }
  if (!zone.isConnected) return;
  const src = 'commission_du_mois';
  const commissionActuelle = exiger(actuel, 'mode', src) === 'commission';
  const s = { mode: commissionActuelle ? 'commission' : 'abonnement', enLigne: '', comptoir: '', plafond: b.prixAbonnement || '', avecPlafond: true, jeton: 0 };
  if (commissionActuelle) {
    const plafond = exiger(actuel, 'plafond', src);
    Object.assign(s, { enLigne: exiger(actuel, 'taux_en_ligne', src) ?? '', comptoir: exiger(actuel, 'taux_comptoir', src) ?? '', plafond: plafond ?? (b.prixAbonnement || ''), avecPlafond: plafond !== null });
  }
  let enregistre = s.mode;
  const prix = b.prixAbonnement ? montant(b.prixAbonnement) : null;

  function rendre() {
    const c = s.mode === 'commission';
    zone.innerHTML = `
      <div class="cs-bloc-tete"><h2>Comment cette boutique paie YOUMMA</h2><span class="pastille-admin ${enregistre === 'commission' ? 'violet' : 'gris'}">${enregistre === 'commission' ? 'Commission' : 'Abonnement'}</span></div>
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
            <div class="champ"><label for="cf-ligne">Taux en ligne (%)</label><input id="cf-ligne" class="input num" inputmode="decimal" value="${esc(s.enLigne)}" placeholder="ex. 5"></div>
            <div class="champ"><label for="cf-comptoir">Taux comptoir (%)</label><input id="cf-comptoir" class="input num" inputmode="decimal" value="${esc(s.comptoir)}" placeholder="ex. 2"></div>
            <div class="champ cf-plafond"><div class="cf-plafond-tete"><label for="cf-plafond">Plafond (GNF par mois)</label>
              <button type="button" class="interrupteur" role="switch" aria-checked="${s.avecPlafond}" data-action="plafond" aria-label="Plafond"><span></span></button></div>
              <input id="cf-plafond" class="input num" inputmode="numeric" value="${esc(s.avecPlafond ? s.plafond : '')}" ${s.avecPlafond ? '' : 'disabled'} placeholder="${s.avecPlafond ? '' : 'Sans plafond'}"></div>
          </div>
          <p class="cs-note">${esc(RAISON_PLAFOND)}</p>
          <div class="cf-simulation" data-ref="simulation" aria-live="polite"></div>` : ''}
        <p class="erreur-form" role="alert" hidden></p>
        <div class="cs-actions-bloc"><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`;
    if (c) simuler();
  }

  const nombreSaisi = (t) => (t === '' || t === undefined || t === null ? null : Number(String(t).replace(/\s/g, '').replace(',', '.')));
  function lireChamps() {
    const v = (sel) => zone.querySelector(sel)?.value.trim();
    if (zone.querySelector('#cf-ligne')) { s.enLigne = v('#cf-ligne'); s.comptoir = v('#cf-comptoir'); if (s.avecPlafond) s.plafond = v('#cf-plafond'); }
  }

  /** Ce qu'elle aurait payé le mois dernier AUX TAUX SAISIS : simuler_commission, rien n'est enregistré. */
  async function simuler() {
    const z = zone.querySelector('[data-ref="simulation"]');
    if (!z) return;
    const jeton = ++s.jeton;
    const tl = nombreSaisi(s.enLigne);
    const tc = nombreSaisi(s.comptoir);
    if (tl === null || tc === null) { z.innerHTML = '<p class="cf-sim-vide">Saisissez les deux taux pour voir ce qu’elle aurait payé le mois dernier.</p>'; return; }
    z.innerHTML = '<span class="squelette" style="height:48px"></span>';
    let r;
    try {
      r = premiere(await rpc('simuler_commission', { p_boutique: b.id, p_mois: moisISO(-1), p_taux_en_ligne: tl, p_taux_comptoir: tc, p_plafond: s.avecPlafond ? nombreSaisi(s.plafond) : null }));
    } catch (err) {
      if (jeton === s.jeton && z.isConnected) z.innerHTML = `<p class="cf-sim-erreur">${esc(erreurFacturation(err))}</p>`;
      return;
    }
    if (jeton !== s.jeton || !z.isConnected) return;
    const src = 'simuler_commission';
    const mois = nomMois(exiger(r, 'mois', src));
    if (exiger(r, 'aucune_vente', src) === true) { z.innerHTML = `<p class="cf-sim-vide">Aucune vente enregistrée en ${esc(mois)}.</p>`; return; }
    const pct = exiger(r, 'part_du_chiffre', src);
    z.innerHTML = `<span class="etiquette">Simulation sur ${esc(mois)}</span>
      <p class="cf-sim">Elle aurait payé <strong class="num" data-ref="sim-du">${esc(montant(exiger(r, 'du', src)))}</strong>${pct === null || pct === undefined ? '' : `, soit <strong class="num">${formatNombre(Number(pct), 1)} %</strong>`} de ses <span class="num">${esc(montant(exiger(r, 'ventes_total', src)))}</span> de ventes.</p>
      ${exiger(r, 'plafond_atteint', src) === true ? `<p class="cs-note">Le plafond mord : <span class="num">${esc(montant(exiger(r, 'brut', src)))}</span> sans plafond, <strong class="num">${esc(montant(exiger(r, 'economise', src)))}</strong> économisés.</p>` : ''}
      ${detailHTML(r.lignes, src)}`;
  }
  const simulerBientot = differer(() => { lireChamps(); simuler(); }, 350);

  zone.addEventListener('click', (ev) => {
    const carte = ev.target.closest('[data-mode]');
    if (carte) { lireChamps(); s.mode = carte.dataset.mode; rendre(); return; }
    if (ev.target.closest('[data-action="plafond"]')) { lireChamps(); s.avecPlafond = !s.avecPlafond; rendre(); }
  });
  zone.addEventListener('input', (ev) => { if (ev.target.matches('#cf-ligne, #cf-comptoir, #cf-plafond')) simulerBientot(); });

  zone.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    lireChamps();
    const z = zone.querySelector('.erreur-form');
    const bouton = zone.querySelector('[type=submit]');
    z.hidden = true;
    const c = s.mode === 'commission';
    // Interrupteur allumé mais champ vide : on ne l'enverrait pas comme « sans plafond » à l'insu de la direction.
    if (c && s.avecPlafond && nombreSaisi(s.plafond) === null) { z.textContent = 'Indiquez le plafond, ou retirez-le avec l’interrupteur.'; z.hidden = false; return; }
    boutonOccupe(bouton, true, 'Enregistrement…');
    try {
      // Abonnement : taux et plafond partent vides, la base les efface. Commission : les valeurs saisies, telles quelles.
      await rpc('definir_facturation', {
        p_boutique: b.id, p_mode: s.mode,
        p_taux_en_ligne: c ? nombreSaisi(s.enLigne) : null,
        p_taux_comptoir: c ? nombreSaisi(s.comptoir) : null,
        p_plafond: c && s.avecPlafond ? nombreSaisi(s.plafond) : null
      });
      enregistre = s.mode;
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

export async function afficherCommissions(zone, e) {
  zone.innerHTML = '<span class="squelette" style="height:240px;margin:16px"></span>';
  let r;
  try { r = premiere(await rpc('boutiques_en_commission', { p_espace: e.code })); } catch (err) {
    zone.innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(erreurFacturation(err))}</p>`;
    return;
  }
  if (!zone.isConnected) return;
  const src = 'boutiques_en_commission';
  const boutiques = exiger(r, 'boutiques', src) || [];
  const mois = exiger(r, 'mois', src);
  const b = (x, nom) => exiger(x, nom, `${src}.boutiques`);

  zone.innerHTML = `
    ${tableau([
      ['Boutique', (x) => { const pays = b(x, 'pays'); return `<a class="cs-nom-ligne" href="#/fiche/${encodeURIComponent(b(x, 'id'))}">${esc(b(x, 'nom') ?? '—')}</a><span class="cs-sous-ligne">${esc([b(x, 'ville') || '—', pays && pays !== 'GN' ? pays : null].filter(Boolean).join(' · '))}</span>`; }],
      ['En ligne', (x) => `<span class="num">${esc(taux(b(x, 'taux_en_ligne')))}</span>`, { droite: true }],
      ['Comptoir', (x) => `<span class="num">${esc(taux(b(x, 'taux_comptoir')))}</span>`, { droite: true }],
      [`Dû · ${nomMois(mois)}`, (x) => `<strong class="num">${esc(montant(b(x, 'du')))}</strong>`, { droite: true }],
      ['État', (x) => pastilleEtat(b(x, 'etat'), b(x, 'plafond_atteint') === true)]
    ], boutiques, { classe: 'cs-tableau cf-tableau', vide: 'Aucune boutique ne paie à la commission pour l’instant.', attributsLigne: (x) => `data-commission="${esc(x.id)}" tabindex="0" class="cs-ligne-cliquable"` })}
    ${boutiques.length ? `<div class="cf-pied">
      <div><span class="etiquette">Total à encaisser</span><strong class="num cf-total">${esc(montant(exiger(r, 'a_encaisser', src)))}</strong></div>
      <button type="button" class="btn btn-primaire" data-action="envoyer-releves">${icone('sms', 18, 2)} Envoyer les relevés</button>
    </div>` : ''}
    ${ESCALADE}`;

  const relire = () => afficherCommissions(zone, e);
  const ouvrir = (id) => { const x = boutiques.find((y) => y.id === id); if (x) ouvrirDetail(x, mois, relire); };
  zone.onclick = (ev) => {
    if (ev.target.closest('[data-action="envoyer-releves"]')) { envoyerReleves(e, mois, boutiques.length, ev.target.closest('button')); return; }
    const tr = ev.target.closest('tr[data-commission]');
    if (tr && !ev.target.closest('a')) ouvrir(tr.dataset.commission);
  };
  zone.onkeydown = (ev) => { const tr = ev.target.closest?.('tr[data-commission]'); if (tr && ev.key === 'Enter') ouvrir(tr.dataset.commission); };
}

/** Détail d'une ligne : décompte du mois (commission_du_mois) et « Marquer payé » (relevé : etat.releve). */
async function ouvrirDetail(x, mois, relire) {
  const releve = x.etat?.releve || null;
  const { el, fermer } = ouvrirModale({
    titre: x.nom,
    contenu: `<div class="cf-detail"><div data-ref="decompte"><span class="squelette" style="height:120px"></span></div>
      <div class="ligne-etat">${pastilleEtat(x.etat, x.plafond_atteint === true)}${x.etat?.libelle ? ` <span class="discret">${esc(x.etat.libelle)}</span>` : ''}</div>
      <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Fermer</button>
        <button type="button" class="btn btn-primaire" data-action="payer" ${releve ? '' : 'disabled title="Aucun relevé à régler pour cette boutique"'}>Marquer payé</button></div></div>`
  });
  el.querySelector('[data-action="payer"]').addEventListener('click', () => { fermer(); ouvrirReglement(x, releve, relire); });
  const z = el.querySelector('[data-ref="decompte"]');
  try {
    const d = premiere(await rpc('commission_du_mois', { p_boutique: x.id, p_mois: mois }));
    if (!z?.isConnected) return;
    const src = 'commission_du_mois';
    z.innerHTML = `<p class="cf-sim">${esc(nomMois(exiger(d, 'mois', src)))} : <strong class="num">${esc(montant(exiger(d, 'du', src)))}</strong> sur <span class="num">${esc(montant(exiger(d, 'ventes_total', src)))}</span> de ventes${exiger(d, 'plafond_atteint', src) === true ? ` · plafond atteint (${esc(montant(exiger(d, 'economise', src)))} économisés)` : ''}.</p>
      ${detailHTML(d.lignes, src)}`;
  } catch (err) {
    if (z) z.innerHTML = `<p class="bloc-erreur">${esc(erreurFacturation(err))}</p>`;
  }
}

/** « Marquer payé » : regler_commission(p_releve = etat.releve, p_mode, p_reference), moyens de la ligne (pays de la boutique). */
async function ouvrirReglement(x, releve, relire) {
  const modes = exiger(x, 'moyens', 'boutiques_en_commission.boutiques') || [];
  if (!modes.length) { toast(`Aucun moyen de paiement prévu pour cette boutique (${x.pays || 'pays inconnu'}).`, 'erreur'); return; }
  const { el, fermer } = ouvrirModale({
    titre: `Commission réglée par « ${x.nom} »`,
    contenu: `<form class="form-modale" novalidate>
      ${x.etat?.du !== undefined ? `<p class="texte-modale">Relevé ${x.etat.mois ? esc(nomMois(x.etat.mois)) : ''}, selon la base : <strong class="num">${esc(montant(x.etat.du))}</strong>.</p>` : ''}
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
      await rpc('regler_commission', { p_releve: releve, p_mode: el.querySelector('#cf-mode').value, p_reference: el.querySelector('#cf-ref').value.trim() || null });
      fermer();
      toast(`Relevé de « ${x.nom} » marqué payé.`, 'succes');
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
 * « Envoyer les relevés » : envoyer_releves(p_espace, p_mois) met les SMS en file. Après l'appel : combien sont partis,
 * et à part les boutiques sans téléphone (sms: false), avec leur texte à copier pour WhatsApp.
 */
async function envoyerReleves(e, mois, nb, bouton) {
  if (!(await confirmer(`Envoyer le relevé ${nomMois(mois)} aux ${formatNombre(nb)} boutique${nb > 1 ? 's' : ''} en commission ? Les SMS partent tout de suite.`, { titre: 'Envoyer les relevés', libelleOk: 'Envoyer' }))) return;
  boutonOccupe(bouton, true, 'Envoi…');
  let r;
  try { r = premiere(await rpc('envoyer_releves', { p_espace: e.code, p_mois: mois })); } catch (err) {
    boutonOccupe(bouton, false);
    toast(erreurFacturation(err), 'erreur', 7000);
    return;
  }
  boutonOccupe(bouton, false);
  const src = 'envoyer_releves';
  const partis = Number(exiger(r, 'sms_en_file', src)) || 0;
  const releves = exiger(r, 'releves', src) || [];
  const sansTel = releves.filter((x) => exiger(x, 'sms', `${src}.releves`) === false);
  const { el } = ouvrirModale({
    titre: `Relevés ${nomMois(exiger(r, 'mois', src))}`,
    contenu: `<p class="texte-modale" data-ref="partis"><strong>${formatNombre(partis)} SMS ${partis > 1 ? 'sont partis' : 'est parti'}</strong> par la file d’envoi.</p>
      ${sansTel.length ? `<h3 class="cf-sans-tel-titre">Sans téléphone : ${formatNombre(Number(exiger(r, 'sans_telephone', src)) || sansTel.length)} — à envoyer par WhatsApp</h3>
        <ul class="cf-envois">${sansTel.map((x, i) => `<li class="cf-envoi-manuel">
          <span><strong>${esc(exiger(x, 'boutique', `${src}.releves`) ?? '—')}</strong><small class="num">${esc(montant(exiger(x, 'du', `${src}.releves`)))}</small></span>
          <textarea class="input cf-texte-releve" rows="3" readonly data-texte="${i}">${esc(exiger(x, 'texte', `${src}.releves`) ?? '')}</textarea>
          <button type="button" class="btn btn-secondaire btn-petit" data-copier="${i}">${icone('copier', 15, 2)} Copier le texte</button></li>`).join('')}</ul>` : '<p class="discret">Toutes les boutiques avaient un téléphone.</p>'}
      <div class="modale-actions"><button type="button" class="btn btn-primaire" data-fermer>Fermer</button></div>`
  });
  el.addEventListener('click', async (ev) => {
    const c = ev.target.closest('[data-copier]');
    if (!c) return;
    const ok = await copierTexte(sansTel[Number(c.dataset.copier)].texte);
    toast(ok ? 'Texte copié : collez-le dans WhatsApp.' : 'Copie impossible : sélectionnez le texte à la main.', ok ? 'succes' : 'erreur');
  });
}
