/**
 * admin/licences.js — Licences & paiements (maquette AdminLicences.dc.html) : formules, paiements à
 * valider, licences à renouveler (7 jours, relances SMS / WhatsApp), encaissements (période, export CSV),
 * « Enregistrer un paiement » (montant calculé : prix × mois, 12 mois = prix × (12 − mois offerts)).
 */
import { sb } from '../supabase.js';
import { esc, icone, toast, confirmer, ouvrirModale, boutonOccupe, differer, formatDate, formatNombre, lireNombre, formaterSaisieMontant, bornesPeriode } from '../utils.js';
import { PACKS_SMS } from '../sms.js';
import {
  estSuper, rpc, premiere, champ, liste, erreurAdmin, gnf, nombre, ilYa, telLocal, lienWa, exporterCsv, tableau, blocErreur, squelette, MODES_PAIEMENT_YOUMMA
} from './commun.js';

const DUREES = [1, 3, 6, 12];
const PERIODES = [['mois', 'Ce mois'], ['moisDernier', 'Mois dernier'], ['7j', '7 jours'], ['annee', 'Cette année']];
export const prixLicence = (f, mois) => (mois === 12 ? Number(f.prix_mois || 0) * (12 - Number(f.mois_offerts || 0)) : Number(f.prix_mois || 0) * mois);

function objet(p) {
  if (p.objet === 'sms') return `Pack ${nombre(champ(p, 'nb_sms') || 0)} SMS`;
  if (p.objet === 'option') { const n = Number(champ(p, 'duree_mois', 'mois')) || 0; const nom = champ(p, 'option_nom', 'option'); return `Option ${!nom || nom === 'boutique_en_ligne' ? 'boutique en ligne' : nom}${n ? ` · ${n === 12 ? '1 an' : `${n} mois`}` : ''}`; }
  const mois = Number(champ(p, 'duree_mois')) || 0;
  return `${champ(p, 'formule_nom', 'formule') || 'Licence'} ${mois === 12 ? '1 an' : `${mois} mois`}`;
}

async function chargerFormules() {
  try {
    const r = premiere(await rpc('admin_parametres')) || {};
    const f = liste(r, 'formules');
    if (f.length) return f;
  } catch { /* lecture publique en repli */ }
  const { data } = await sb.from('formules').select('code, nom, prix_mois, mois_offerts, description, max_vendeurs, ordre, actif').order('ordre');
  return data || [];
}

export function afficherLicences(conteneur, { majCompteurs }) {
  const s = { periode: 'mois', formules: [], encaissements: [] };
  conteneur.innerHTML = `
    <header class="adm-entete">
      <div class="adm-titres"><h1>Licences &amp; paiements</h1><span class="discret">Formules, encaissements, renouvellements · paiement en ligne (ChapChap Pay) à l’étape suivante</span></div>
      <div class="adm-actions"><button type="button" class="btn btn-primaire" data-action="paiement">${icone('plus', 18, 2.4)} Enregistrer un paiement</button></div>
    </header>
    <section class="adm-formules" data-zone="formules">${squelette(3)}</section>
    <div class="adm-rangee">
      <section class="adm-carte adm-moitie"><h2>Paiements à valider <span class="adm-compteur" data-ref="nb-attente"></span></h2><div data-zone="attente">${squelette(3)}</div>
        <p class="discret">Valider prolonge la licence (ou ajoute les SMS) et envoie un reçu SMS au propriétaire.</p></section>
      <section class="adm-carte adm-moitie">
        <div class="adm-carte-entete"><h2>À renouveler · 7 jours</h2><button type="button" class="btn btn-secondaire btn-petit" data-action="relancer-tout">Relancer tout (SMS)</button></div>
        <div data-zone="renouveler">${squelette(3)}</div></section>
    </div>
    <section class="adm-carte">
      <div class="adm-carte-entete">
        <h2>Encaissements</h2>
        <div class="adm-outils">
          <div class="segments segments-cadre" role="group" aria-label="Période">${PERIODES.map(([c, l]) => `<button type="button" class="segment ${c === s.periode ? 'actif' : ''}" data-periode="${c}" aria-pressed="${c === s.periode}">${esc(l)}</button>`).join('')}</div>
          <button type="button" class="btn btn-secondaire btn-petit" data-action="csv">${icone('telecharger', 16, 2)} CSV</button>
        </div>
      </div>
      <p class="adm-total" data-ref="total"></p>
      <div data-zone="encaissements">${squelette(4)}</div>
    </section>`;
  const zone = (n) => conteneur.querySelector(`[data-zone="${n}"]`);

  async function chargerFormulesCartes() {
    s.formules = await chargerFormules();
    if (!conteneur.isConnected) return;
    zone('formules').innerHTML = s.formules.map((f) => `
      <div class="adm-formule ${f.code === 'pro' ? 'mise-en-avant' : ''} ${f.actif === false ? 'inactive' : ''}">
        <div class="adm-formule-haut"><span class="tres-gras">${esc(f.nom)}</span><span class="discret gras">${nombre(champ(f, 'nb_boutiques') || 0)} boutiques</span></div>
        <span class="adm-formule-prix">${Number(f.prix_mois) ? `${nombre(f.prix_mois)} <small>GNF / mois</small>` : 'Gratuit'}</span>
        <span class="discret">${Number(f.prix_mois) ? `1 an = ${12 - Number(f.mois_offerts || 0)} mois payés (${gnf(prixLicence(f, 12))})` : 'puis choix d’une formule'}</span>
        <span class="adm-formule-desc">${esc(f.description || '')}${f.max_vendeurs ? ` · ${f.max_vendeurs} vendeurs max.` : ''}</span>
        ${estSuper() ? `<button type="button" class="btn btn-secondaire btn-petit" data-modifier-formule="${esc(f.code)}">Modifier</button>` : ''}
      </div>`).join('') || '<p class="vide-admin">Aucune formule.</p>';
  }

  async function chargerAttente() {
    try {
      const r = premiere(await rpc('admin_paiements', { p_statut: 'a_valider', p_debut: null, p_fin: null })) || {};
      const lignes = liste(r, 'lignes');
      conteneur.querySelector('[data-ref="nb-attente"]').textContent = lignes.length || '';
      zone('attente').innerHTML = lignes.length ? lignes.map((p) => `
        <div class="adm-paiement">
          <span class="adm-ligne-textes"><strong>${esc(champ(p, 'boutique_nom', 'boutique') || '—')}</strong>
            <span class="discret">${esc(objet(p))} · ${esc(MODES_PAIEMENT_YOUMMA[p.mode] || p.mode || '')}${p.reference ? ` · réf. ${esc(p.reference)}` : ''} · ${esc(ilYa(p.created_at))}${champ(p, 'par_nom', 'enregistre_par') ? ` · par ${esc(champ(p, 'par_nom', 'enregistre_par'))}` : ''}</span>
            ${p.note ? `<span class="discret">${esc(p.note)}</span>` : ''}</span>
          <strong class="adm-montant">${gnf(p.montant)}</strong>
          ${estSuper() ? `<span class="adm-boutons-ligne"><button type="button" class="btn btn-valider-adm" data-valider="${esc(p.id)}">Valider</button><button type="button" class="btn btn-refuser" data-refuser="${esc(p.id)}">Refuser</button></span>` : '<span class="pastille-admin orange">En attente du super admin</span>'}
        </div>`).join('') : '<p class="vide-admin">Aucun paiement à valider.</p>';
      s.attente = lignes;
    } catch (err) { zone('attente').innerHTML = blocErreur(err); }
  }

  async function chargerRenouvellements() {
    try {
      const brut = await rpc('admin_renouvellements', { p_jours: 7 });
      const l = Array.isArray(brut) ? brut : liste(premiere(brut), 'lignes');
      s.renouveler = l;
      zone('renouveler').innerHTML = l.length ? l.map((r) => {
        const j = Number(champ(r, 'jours_restants'));
        const couleur = j <= 1 ? 'texte-danger' : j <= 5 ? 'texte-alerte' : 'discret';
        const quand = j < 0 ? 'expirée' : j === 0 ? 'aujourd’hui' : j === 1 ? 'demain' : `dans ${j} j`;
        const tel = champ(r, 'tel_proprietaire', 'telephone');
        return `
          <div class="adm-renouvellement">
            <a class="adm-ligne-textes" href="#/boutiques/${encodeURIComponent(champ(r, 'boutique_id', 'id'))}"><strong>${esc(r.nom || champ(r, 'boutique_nom'))}</strong>
              <span class="discret">${esc(champ(r, 'formule_nom', 'formule', 'licence_formule') || '')} · ${esc(telLocal(tel))}</span></a>
            <span class="gras ${couleur}">${esc(quand)}</span>
            <span class="discret adm-relance">${champ(r, 'paiement_en_attente') ? 'paiement reçu' : champ(r, 'derniere_relance') ? `relancée ${esc(ilYa(champ(r, 'derniere_relance')))}` : 'non relancée'}</span>
            <span class="adm-boutons-ligne">
              <button type="button" class="btn btn-secondaire btn-petit" data-relancer="${esc(champ(r, 'boutique_id', 'id'))}">SMS</button>
              ${tel ? `<a class="btn btn-whatsapp btn-petit" href="${esc(lienWa(tel, `Bonjour, ici YOUMMA Business : la licence de votre boutique « ${r.nom || ''} » se termine ${quand}. Pour renouveler, répondez à ce message.`))}" target="_blank" rel="noopener" aria-label="WhatsApp">${icone('whatsapp', 16, 2)}</a>` : ''}
            </span>
          </div>`;
      }).join('') : '<p class="vide-admin">Aucune licence n’expire dans les 7 jours.</p>';
    } catch (err) { zone('renouveler').innerHTML = blocErreur(err); }
  }

  async function chargerEncaissements() {
    const { du, au } = bornesPeriode(s.periode);
    try {
      const r = premiere(await rpc('admin_paiements', { p_statut: 'valide', p_debut: du, p_fin: au })) || {};
      s.encaissements = liste(r, 'lignes');
      const total = Number(champ(r, 'total_valide')) || s.encaissements.reduce((t, p) => t + (Number(p.montant) || 0), 0);
      // Étape 14b : options (boutique en ligne) à part des licences et des SMS.
      const somme = (f) => s.encaissements.filter(f).reduce((t, p) => t + (Number(p.montant) || 0), 0);
      const totalOptions = Number(champ(r, 'total_options')) || somme((p) => p.objet === 'option');
      const totalLicences = Number(champ(r, 'total_licences')) || somme((p) => !['option', 'sms'].includes(p.objet));
      const catalogue = await rpc('admin_options_catalogue').catch(() => null);
      const revenuOptions = (Array.isArray(catalogue) ? catalogue : liste(premiere(catalogue), 'options')).reduce((t, o) => t + (Number(o.revenu_mois) || 0), 0);
      if (!conteneur.isConnected) return;
      conteneur.querySelector('[data-ref="total"]').innerHTML = `Total <strong class="texte-succes">${gnf(total)}</strong> · ${nombre(s.encaissements.length)} paiement(s) · Licences <strong>${gnf(totalLicences)}</strong> · Options <strong>${gnf(totalOptions)}</strong>${catalogue ? ` · <span class="adm-revenu-options">Recette mensuelle des options <strong>${gnf(revenuOptions)}</strong></span>` : ''}`;
      zone('encaissements').innerHTML = tableau([
        ['Date', (p) => esc(formatDate(champ(p, 'valide_at', 'created_at'), 'court'))],
        ['Boutique', (p) => `<strong>${esc(champ(p, 'boutique_nom', 'boutique') || '—')}</strong>`],
        ['Objet', (p) => esc(objet(p))],
        ['Mode', (p) => esc(MODES_PAIEMENT_YOUMMA[p.mode] || p.mode || '')],
        ['Par', (p) => `<span class="discret">${esc(champ(p, 'par_nom', 'enregistre_par') || '')}</span>`],
        ['Montant', (p) => `<strong>${gnf(p.montant)}</strong>`, { droite: true }]
      ], s.encaissements, { vide: 'Aucun encaissement sur la période.' });
    } catch (err) { zone('encaissements').innerHTML = blocErreur(err); }
  }

  const toutRecharger = () => { chargerAttente(); chargerRenouvellements(); chargerEncaissements(); majCompteurs?.(); };

  async function relancer(ids, bouton) {
    if (!ids.length) { toast('Aucune boutique à relancer.', 'info'); return; }
    if (!(await confirmer(`Envoyer un SMS de rappel de licence à ${ids.length} boutique${ids.length > 1 ? 's' : ''} ? (1 relance par jour et par boutique, payée par YOUMMA)`, { titre: 'Relancer par SMS', libelleOk: 'Envoyer' }))) return;
    boutonOccupe(bouton, true, 'Envoi…');
    try {
      const r = premiere(await rpc('admin_relancer_licences', { p_boutiques: ids }));
      const n = Number(champ(r, 'envoyes', 'nb') ?? r) || 0;
      toast(n ? `${n} relance${n > 1 ? 's' : ''} envoyée${n > 1 ? 's' : ''}.` : 'Déjà relancées aujourd’hui.', n ? 'succes' : 'info');
      chargerRenouvellements();
    } catch (err) { toast(erreurAdmin(err), 'erreur'); }
    boutonOccupe(bouton, false);
  }

  conteneur.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    const bouton = e.target.closest('button');
    if (action === 'paiement') ouvrirEnregistrerPaiement(null, toutRecharger);
    if (action === 'relancer-tout') relancer((s.renouveler || []).filter((r) => !champ(r, 'paiement_en_attente')).map((r) => champ(r, 'boutique_id', 'id')), bouton);
    if (action === 'csv') {
      const { du, au } = bornesPeriode(s.periode);
      exporterCsv(`encaissements-youmma-${du}-${au}.csv`, [
        ['Date', (p) => formatDate(champ(p, 'valide_at', 'created_at'), 'court')], ['Boutique', (p) => champ(p, 'boutique_nom', 'boutique') || ''],
        ['Objet', (p) => objet(p)], ['Mode', (p) => MODES_PAIEMENT_YOUMMA[p.mode] || p.mode || ''], ['Référence', (p) => p.reference || ''],
        ['Par', (p) => champ(p, 'par_nom', 'enregistre_par') || ''], ['Montant (GNF)', (p) => Number(p.montant) || 0]
      ], s.encaissements);
    }
    const relancerUn = e.target.closest('[data-relancer]');
    if (relancerUn) relancer([relancerUn.dataset.relancer], relancerUn);
    const periode = e.target.closest('[data-periode]');
    if (periode) {
      s.periode = periode.dataset.periode;
      conteneur.querySelectorAll('[data-periode]').forEach((b) => { b.classList.toggle('actif', b === periode); b.setAttribute('aria-pressed', String(b === periode)); });
      chargerEncaissements();
    }
    const valider = e.target.closest('[data-valider]');
    if (valider) {
      const p = s.attente.find((x) => x.id === valider.dataset.valider);
      if (!(await confirmer(`Valider ${objet(p)} pour « ${champ(p, 'boutique_nom', 'boutique')} » (${gnf(p.montant)}) ? ${p.objet === 'sms' ? 'Les SMS seront ajoutés' : 'La licence sera prolongée'} et un reçu SMS envoyé au propriétaire.`, { titre: 'Valider le paiement', libelleOk: 'Valider' }))) return;
      boutonOccupe(valider, true, '…');
      try { await rpc('admin_valider_paiement', { p_paiement: p.id }); toast('Paiement validé : reçu envoyé au propriétaire.', 'succes'); toutRecharger(); }
      catch (err) { boutonOccupe(valider, false); toast(erreurAdmin(err), 'erreur'); if (/DEJA_TRAITE/.test(err?.message)) toutRecharger(); }
    }
    const refuser = e.target.closest('[data-refuser]');
    if (refuser) ouvrirRefus(s.attente.find((x) => x.id === refuser.dataset.refuser), toutRecharger);
    const modifier = e.target.closest('[data-modifier-formule]');
    if (modifier) ouvrirModifierFormule(s.formules.find((f) => f.code === modifier.dataset.modifierFormule), chargerFormulesCartes);
  });

  chargerFormulesCartes();
  toutRecharger();
}

function ouvrirRefus(p, apres) {
  const { el, fermer } = ouvrirModale({
    titre: 'Refuser le paiement',
    contenu: `
      <form class="form-modale" novalidate>
        <p class="texte-modale">${esc(champ(p, 'boutique_nom', 'boutique') || '')} · ${esc(objet(p))} · ${gnf(p.montant)}</p>
        <div class="champ"><label for="motif-refus">Motif (obligatoire)</label><input id="motif-refus" class="input" type="text" maxlength="160" placeholder="Ex. référence Orange Money introuvable" required></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-danger">Refuser</button></div>
      </form>`
  });
  el.querySelector('#motif-refus').focus();
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const motif = el.querySelector('#motif-refus').value.trim();
    const z = el.querySelector('.erreur-form');
    if (!motif) { z.textContent = 'Indiquez le motif.'; z.hidden = false; return; }
    const bouton = e.target.querySelector('[type=submit]');
    boutonOccupe(bouton, true, '…');
    try { await rpc('admin_refuser_paiement', { p_paiement: p.id, p_motif: motif }); fermer(); toast('Paiement refusé.', 'succes'); apres(); }
    catch (err) { boutonOccupe(bouton, false); z.textContent = erreurAdmin(err); z.hidden = false; }
  });
}

function ouvrirModifierFormule(f, apres) {
  const { el, fermer } = ouvrirModale({
    titre: `Modifier la formule ${f.nom}`,
    contenu: `
      <form class="form-modale" novalidate>
        <div class="rangee-champs">
          <div class="champ"><label for="fm-nom">Nom</label><input id="fm-nom" class="input" type="text" maxlength="40" value="${esc(f.nom)}" required></div>
          <div class="champ"><label for="fm-prix">Prix par mois (GNF)</label><input id="fm-prix" class="input input-montant" type="text" inputmode="numeric" value="${formatNombre(f.prix_mois || 0)}"></div>
        </div>
        <div class="rangee-champs">
          <div class="champ"><label for="fm-offerts">Mois offerts pour 1 an</label><input id="fm-offerts" class="input" type="number" min="0" max="11" step="1" value="${esc(f.mois_offerts ?? 0)}"></div>
          <div class="champ"><label for="fm-vendeurs">Vendeurs maximum (vide = illimité)</label><input id="fm-vendeurs" class="input" type="number" min="0" step="1" value="${esc(f.max_vendeurs ?? '')}"></div>
        </div>
        <div class="champ"><label for="fm-desc">Description</label><textarea id="fm-desc" class="input" rows="2" maxlength="300">${esc(f.description || '')}</textarea></div>
        <label class="case-option"><input type="checkbox" id="fm-actif" ${f.actif === false ? '' : 'checked'}> Formule proposée aux boutiques</label>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`
  });
  const prix = el.querySelector('#fm-prix');
  prix.addEventListener('input', () => formaterSaisieMontant(prix));
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const z = el.querySelector('.erreur-form');
    const bouton = e.target.querySelector('[type=submit]');
    boutonOccupe(bouton, true, '…');
    try {
      await rpc('admin_modifier_formule', {
        p_code: f.code, p_nom: el.querySelector('#fm-nom').value.trim(), p_prix_mois: lireNombre(prix.value) || 0,
        p_mois_offerts: Number(el.querySelector('#fm-offerts').value) || 0, p_description: el.querySelector('#fm-desc').value.trim() || null,
        p_max_vendeurs: el.querySelector('#fm-vendeurs').value === '' ? null : Number(el.querySelector('#fm-vendeurs').value), p_actif: el.querySelector('#fm-actif').checked
      });
      fermer(); toast('Formule enregistrée.', 'succes'); apres();
    } catch (err) { boutonOccupe(bouton, false); z.textContent = erreurAdmin(err); z.hidden = false; }
  });
}

/* =========================================================================
   Enregistrer un paiement (aussi depuis la fiche boutique)
   ========================================================================= */

export async function ouvrirEnregistrerPaiement(boutique, apres) {
  const formules = (await chargerFormules()).filter((f) => f.actif !== false && Number(f.prix_mois) > 0);
  const s = { boutique, objet: 'licence', formule: formules.find((f) => f.code === boutique?.licence_formule)?.code || formules[0]?.code, duree: 1, pack: 0, montantModifie: false };
  const { el, fermer } = ouvrirModale({
    titre: 'Enregistrer un paiement',
    variante: 'large',
    contenu: `
      <form class="form-modale" novalidate>
        <div class="champ"><span class="etiquette">Boutique</span>
          <div data-zone="boutique"></div></div>
        <div class="champ"><span class="etiquette">Objet</span>
          <div class="segments segments-cadre" role="group" aria-label="Objet">
            <button type="button" class="segment actif" data-objet="licence" aria-pressed="true">Licence</button>
            <button type="button" class="segment" data-objet="sms" aria-pressed="false">Pack SMS</button>
          </div></div>
        <div data-zone="licence">
          <div class="rangee-champs">
            <div class="champ"><label for="pai-formule">Formule</label><select id="pai-formule" class="input">${formules.map((f) => `<option value="${esc(f.code)}" ${f.code === s.formule ? 'selected' : ''}>${esc(f.nom)} · ${gnf(f.prix_mois)} / mois</option>`).join('')}</select></div>
            <div class="champ"><span class="etiquette">Durée</span>
              <div class="segments segments-cadre" role="group" aria-label="Durée">${DUREES.map((d) => `<button type="button" class="segment ${d === 1 ? 'actif' : ''}" data-duree="${d}" aria-pressed="${d === 1}">${d === 12 ? '12 mois' : `${d} mois`}</button>`).join('')}</div></div>
          </div>
        </div>
        <div data-zone="sms" hidden>
          <div class="packs-sms" role="group" aria-label="Pack">${PACKS_SMS.map((p, i) => `<button type="button" class="pack-sms" data-pack="${i}" aria-pressed="${i === 0}"><span class="pack-nb">${formatNombre(p.nb)} SMS</span><span class="pack-prix">${gnf(p.prix)}</span></button>`).join('')}</div>
          <div class="champ"><label for="pai-nb">Nombre de SMS</label><input id="pai-nb" class="input" type="text" inputmode="numeric" value="${PACKS_SMS[0].nb}"></div>
        </div>
        <div class="rangee-champs">
          <div class="champ"><label for="pai-montant">Montant (GNF)</label><input id="pai-montant" class="input input-montant" type="text" inputmode="numeric"><small class="aide" data-ref="calcul"></small></div>
          <div class="champ"><label for="pai-mode">Mode</label><select id="pai-mode" class="input">${Object.entries(MODES_PAIEMENT_YOUMMA).map(([c, l]) => `<option value="${c}" ${c === 'orange_money' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        </div>
        <div class="rangee-champs">
          <div class="champ"><label for="pai-ref">Référence (n° de transaction)</label><input id="pai-ref" class="input" type="text" maxlength="80"></div>
          <div class="champ"><label for="pai-note">Note</label><input id="pai-note" class="input" type="text" maxlength="200"></div>
        </div>
        ${estSuper() ? '<label class="case-option"><input type="checkbox" id="pai-valider" checked> Valider tout de suite (licence prolongée / SMS ajoutés, reçu SMS envoyé)</label>' : '<p class="aide">Le paiement sera validé par le super admin.</p>'}
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
      </form>`
  });
  const q = (sel) => el.querySelector(sel);
  const montant = q('#pai-montant');

  function renderBoutique() {
    const z = q('[data-zone="boutique"]');
    if (s.boutique) {
      z.innerHTML = `<div class="adm-boutique-choisie"><strong>${esc(s.boutique.nom)}</strong>${boutique ? '' : '<button type="button" class="btn-lien" data-action="changer-boutique">Changer</button>'}</div>`;
      return;
    }
    z.innerHTML = `
      <label class="recherche-entete">${icone('recherche', 18, 2)}<span class="sr-only">Rechercher la boutique</span><input type="search" id="pai-recherche" placeholder="Nom ou téléphone de la boutique" autocomplete="off"></label>
      <div class="adm-resultats" data-zone="resultats"></div>`;
    const champRecherche = q('#pai-recherche');
    champRecherche.focus();
    const chercher = differer(async () => {
      const texte = champRecherche.value.trim();
      const zr = q('[data-zone="resultats"]');
      if (texte.length < 2) { zr.innerHTML = ''; return; }
      try {
        const r = premiere(await rpc('admin_liste_boutiques', { p_recherche: texte, p_filtre: 'toutes', p_limite: 8, p_offset: 0 })) || {};
        zr.innerHTML = liste(r, 'lignes').map((b) => `<button type="button" class="adm-resultat" data-choisir="${esc(b.id)}" data-nom="${esc(b.nom)}" data-formule="${esc(b.licence_formule || '')}"><strong>${esc(b.nom)}</strong><span class="discret">${esc([b.ville, telLocal(champ(b, 'tel_proprietaire', 'telephone'))].filter(Boolean).join(' · '))}</span></button>`).join('') || '<p class="discret">Aucune boutique.</p>';
      } catch (err) { zr.innerHTML = blocErreur(err); }
    }, 300);
    champRecherche.addEventListener('input', chercher);
  }

  function calculer() {
    if (s.montantModifie) return;
    if (s.objet === 'licence') {
      const f = formules.find((x) => x.code === s.formule);
      if (!f) return;
      const m = prixLicence(f, s.duree);
      montant.value = formatNombre(m);
      q('[data-ref="calcul"]').textContent = s.duree === 12 ? `${gnf(f.prix_mois)} × ${12 - Number(f.mois_offerts || 0)} mois (${Number(f.mois_offerts || 0)} offerts)` : `${gnf(f.prix_mois)} × ${s.duree} mois`;
    } else {
      const pack = PACKS_SMS[s.pack];
      if (pack && Number(String(q('#pai-nb').value).replace(/\D/g, '')) === pack.nb) montant.value = formatNombre(pack.prix);
      q('[data-ref="calcul"]').textContent = 'Prix du pack (modifiable)';
    }
  }

  el.addEventListener('click', (e) => {
    const o = e.target.closest('[data-objet]');
    if (o) {
      s.objet = o.dataset.objet; s.montantModifie = false;
      el.querySelectorAll('[data-objet]').forEach((b) => { b.classList.toggle('actif', b === o); b.setAttribute('aria-pressed', String(b === o)); });
      q('[data-zone="licence"]').hidden = s.objet !== 'licence';
      q('[data-zone="sms"]').hidden = s.objet !== 'sms';
      calculer();
    }
    const d = e.target.closest('[data-duree]');
    if (d) { s.duree = Number(d.dataset.duree); s.montantModifie = false; el.querySelectorAll('[data-duree]').forEach((b) => { b.classList.toggle('actif', b === d); b.setAttribute('aria-pressed', String(b === d)); }); calculer(); }
    const p = e.target.closest('[data-pack]');
    if (p) { s.pack = Number(p.dataset.pack); s.montantModifie = false; q('#pai-nb').value = PACKS_SMS[s.pack].nb; el.querySelectorAll('[data-pack]').forEach((b) => b.setAttribute('aria-pressed', String(b === p))); calculer(); }
    const c = e.target.closest('[data-choisir]');
    if (c) { s.boutique = { id: c.dataset.choisir, nom: c.dataset.nom }; if (formules.some((f) => f.code === c.dataset.formule)) { s.formule = c.dataset.formule; q('#pai-formule').value = s.formule; } renderBoutique(); calculer(); }
    if (e.target.closest('[data-action="changer-boutique"]')) { s.boutique = null; renderBoutique(); }
  });
  q('#pai-formule').addEventListener('change', (e) => { s.formule = e.target.value; s.montantModifie = false; calculer(); });
  montant.addEventListener('input', () => { formaterSaisieMontant(montant); s.montantModifie = true; });

  q('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const z = q('.erreur-form');
    const erreur = (m) => { z.textContent = m; z.hidden = !m; };
    if (!s.boutique) return erreur('Choisissez la boutique.');
    const m = lireNombre(montant.value);
    if (m === null || m < 0) return erreur('Montant invalide.');
    const nbSms = Math.round(Number(String(q('#pai-nb').value).replace(/\D/g, '')));
    if (s.objet === 'sms' && !(nbSms > 0)) return erreur('Nombre de SMS invalide.');
    erreur('');
    const bouton = e.target.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Enregistrement…');
    const valider = Boolean(q('#pai-valider')?.checked);
    try {
      await rpc('admin_enregistrer_paiement', {
        p_boutique: s.boutique.id, p_objet: s.objet, p_formule: s.objet === 'licence' ? s.formule : null, p_duree_mois: s.objet === 'licence' ? s.duree : null,
        p_nb_sms: s.objet === 'sms' ? nbSms : null, p_montant: Math.round(m), p_mode: q('#pai-mode').value,
        p_reference: q('#pai-ref').value.trim() || null, p_note: q('#pai-note').value.trim() || null, p_valider: valider
      });
      fermer();
      toast(valider ? 'Paiement enregistré et validé : reçu envoyé au propriétaire.' : 'Paiement enregistré : à valider par le super admin.', 'succes');
      apres?.();
    } catch (err) { boutonOccupe(bouton, false); erreur(erreurAdmin(err)); }
  });
  renderBoutique();
  calculer();
}

