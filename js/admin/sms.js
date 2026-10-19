/**
 * admin/sms.js — SMS & messages (maquette AdminPlateforme.dc.html, bloc SMS) : envoi activé / coupé
 * (super admin), chiffres du mois, prix des packs (constante PACKS_SMS de js/sms.js), consommation par
 * boutique, file d'attente et échecs avec « Renvoyer la sélection » (super admin).
 */
import { esc, toast, confirmer, boutonOccupe, formatDate } from '../utils.js';
import { PACKS_SMS } from '../sms.js';
import { estSuper, rpc, premiere, champ, liste, erreurAdmin, gnf, nombre, telLocal, tableau, blocErreur, squelette } from './commun.js';

const STATUTS = [['echec', 'Échecs'], ['en_attente', 'En attente'], ['envoye', 'Envoyés'], ['', 'Tous']];
const LIBELLES = { en_attente: ['En attente', 'gris'], envoi: ['Envoi…', 'gris'], envoye: ['Envoyé', 'vert'], echec: ['Échec', 'rouge'], annule: ['Annulé', 'gris'] };

export function afficherSms(conteneur, { params }) {
  const s = { statut: params.get('statut') ?? 'echec', donnees: null, selection: new Set() };
  conteneur.innerHTML = `
    <header class="adm-entete"><div class="adm-titres"><h1>SMS &amp; messages</h1><span class="discret">Envoi par Nimba · crédit des boutiques · SMS payés par YOUMMA (reçus, relances, annonces)</span></div></header>
    <div class="adm-rangee">
      <section class="adm-carte adm-moitie" data-zone="resume">${squelette(4)}</section>
      <section class="adm-carte adm-moitie">
        <h2>Consommation par boutique (mois)</h2>
        <div data-zone="boutiques">${squelette(4)}</div>
      </section>
    </div>
    <section class="adm-carte">
      <div class="adm-carte-entete">
        <h2>File d’attente et échecs</h2>
        <div class="adm-outils">
          <div class="segments segments-cadre" role="group" aria-label="Statut">${STATUTS.map(([c, l]) => `<button type="button" class="segment ${c === s.statut ? 'actif' : ''}" data-statut="${c}" aria-pressed="${c === s.statut}">${esc(l)}</button>`).join('')}</div>
          ${estSuper() ? '<button type="button" class="btn btn-primaire btn-petit" data-action="renvoyer" disabled>Renvoyer la sélection</button>' : ''}
        </div>
      </div>
      <div data-zone="messages">${squelette(5)}</div>
    </section>`;
  const zone = (n) => conteneur.querySelector(`[data-zone="${n}"]`);

  function render() {
    const d = s.donnees;
    const mois = d.mois || {};
    zone('resume').innerHTML = `
      <div class="adm-carte-entete"><h2>SMS (Nimba)</h2>
        <span class="adm-interrupteur-ligne">${d.sms_actif === false ? 'Envoi coupé' : 'Envoi activé'}
          <button type="button" class="interrupteur" role="switch" aria-checked="${d.sms_actif !== false}" aria-label="Envoi des SMS" data-action="basculer" ${estSuper() ? '' : 'disabled title="Réservé au super admin"'}><span></span></button></span></div>
      <div class="adm-faits trois">
        <div><span>Envoyés (mois)</span><strong>${nombre(champ(mois, 'envoyes'))}</strong></div>
        <div><span>Échecs (mois)</span><strong class="texte-alerte">${nombre(champ(mois, 'echecs'))}</strong></div>
        <div><span>En attente</span><strong>${nombre(champ(d, 'en_attente'))}</strong></div>
        <div><span>Payés par YOUMMA</span><strong>${nombre(champ(mois, 'plateforme'))}</strong></div>
        <div><span>Vendus aux boutiques</span><strong>${nombre(champ(mois, 'vendus'))}</strong></div>
      </div>
      <h3 class="adm-sous-titre">Packs vendus aux boutiques</h3>
      <ul class="adm-liste-simple">${PACKS_SMS.map((p) => `<li><span class="gras">${nombre(p.nb)} SMS</span><strong>${gnf(p.prix)}</strong><span class="discret">${gnf(Math.round(p.prix / p.nb))} / SMS</span></li>`).join('')}</ul>
      <p class="discret">Prix modifiables dans js/sms.js (constante PACKS_SMS).</p>`;
    const conso = liste(d, 'par_boutique');
    zone('boutiques').innerHTML = tableau([
      ['Boutique', (b) => (champ(b, 'boutique_id') ? `<a href="#/boutiques/${encodeURIComponent(b.boutique_id)}"><strong>${esc(champ(b, 'nom', 'boutique_nom'))}</strong></a>` : esc(champ(b, 'nom', 'boutique_nom') || '—'))],
      ['Envoyés', (b) => nombre(champ(b, 'envoyes')), { droite: true }],
      ['Échecs', (b) => nombre(champ(b, 'echecs')), { droite: true }],
      ['Crédit', (b) => `<span class="${Number(champ(b, 'solde')) <= 0 ? 'texte-danger gras' : ''}">${nombre(champ(b, 'solde'))}</span>`, { droite: true }]
    ], conso, { vide: 'Aucun SMS ce mois.' });
    const messages = liste(d, 'messages');
    zone('messages').innerHTML = tableau([
      ...(estSuper() ? [['', (m) => (['echec', 'annule'].includes(m.statut) ? `<input type="checkbox" class="adm-case" data-selection="${esc(m.id)}" aria-label="Sélectionner" ${s.selection.has(m.id) ? 'checked' : ''}>` : '')]] : []),
      ['Date', (m) => esc(formatDate(m.created_at, 'complet'))],
      ['Boutique', (m) => esc(champ(m, 'boutique_nom', 'boutique') || (m.plateforme ? 'YOUMMA' : '—'))],
      ['Destinataire', (m) => esc(telLocal(m.destinataire))],
      ['Texte', (m) => `<span class="adm-texte-court" title="${esc(m.texte)}">${esc(m.texte)}</span>`],
      ['Statut', (m) => { const st = LIBELLES[m.statut] || [m.statut, 'gris']; return `<span class="pastille-admin ${st[1]}" ${m.erreur ? `title="${esc(m.erreur)}"` : ''}>${esc(st[0])}</span>`; }],
      ['Erreur', (m) => `<span class="discret">${esc(m.erreur || '')}</span>`]
    ], messages, { vide: 'Aucun message pour ce filtre.' });
    majBoutonRenvoyer();
  }

  function majBoutonRenvoyer() {
    const b = conteneur.querySelector('[data-action="renvoyer"]');
    if (b) { b.disabled = !s.selection.size; b.textContent = s.selection.size ? `Renvoyer la sélection (${s.selection.size})` : 'Renvoyer la sélection'; }
  }

  async function charger() {
    try {
      s.donnees = premiere(await rpc('admin_sms', { p_statut: s.statut || null, p_limite: 200 })) || {};
      if (!conteneur.isConnected) return;
      s.selection.clear();
      render();
    } catch (err) { zone('resume').innerHTML = blocErreur(err); }
  }

  conteneur.addEventListener('click', async (e) => {
    const st = e.target.closest('[data-statut]');
    if (st) {
      s.statut = st.dataset.statut;
      conteneur.querySelectorAll('[data-statut]').forEach((b) => { b.classList.toggle('actif', b === st); b.setAttribute('aria-pressed', String(b === st)); });
      charger();
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'basculer') {
      const actif = s.donnees.sms_actif === false;
      if (!(await confirmer(actif ? 'Réactiver l’envoi des SMS pour toute la plateforme ?' : 'Couper l’envoi de TOUS les SMS (alertes, reçus, relances, campagnes) ? Les messages restent en file d’attente.',
        { titre: actif ? 'Réactiver les SMS' : 'Couper les SMS', libelleOk: actif ? 'Réactiver' : 'Couper l’envoi', danger: !actif }))) return;
      try { await rpc('admin_modifier_parametres', { p_valeurs: { sms_actif: actif } }); toast(actif ? 'Envoi des SMS réactivé.' : 'Envoi des SMS coupé.', 'succes'); charger(); }
      catch (err) { toast(erreurAdmin(err), 'erreur'); }
    }
    if (action === 'renvoyer') {
      const ids = [...s.selection];
      if (!(await confirmer(`Remettre ${ids.length} SMS en file d’attente ? Le crédit de la boutique sera de nouveau utilisé.`, { titre: 'Renvoyer', libelleOk: 'Renvoyer' }))) return;
      const bouton = e.target.closest('button');
      boutonOccupe(bouton, true, '…');
      try { const n = premiere(await rpc('admin_renvoyer_sms', { p_ids: ids })); toast(`${nombre(Number(champ(n, 'nb') ?? n) || ids.length)} SMS remis en file.`, 'succes'); charger(); }
      catch (err) { boutonOccupe(bouton, false); toast(erreurAdmin(err), 'erreur'); }
    }
  });
  conteneur.addEventListener('change', (e) => {
    const c = e.target.closest('[data-selection]');
    if (!c) return;
    if (c.checked) s.selection.add(c.dataset.selection); else s.selection.delete(c.dataset.selection);
    majBoutonRenvoyer();
  });
  charger();
}
