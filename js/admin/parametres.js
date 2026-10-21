/**
 * admin/parametres.js — Paramètres de la plateforme (super admin ; lecture seule pour un agent) :
 * durée d'essai, SMS offerts, WhatsApp du support, relances avant expiration, délai de grâce,
 * nom d'expéditeur SMS, mode maintenance + message (confirmation, en rouge) ;
 * étapes 14b-14c : option « boutique en ligne » (tarif, listes de boutiques) → admin/options.js.
 */
import { esc, toast, confirmer, boutonOccupe, normaliserTelephone } from '../utils.js';
import { estSuper, rpc, premiere, erreurAdmin, telLocal, blocErreur, squelette } from './commun.js';
import { monterOptions } from './options.js';

const CHAMPS = [
  ['essai_jours', 'Durée de l’essai (jours)', 'nombre'],
  ['sms_offerts', 'SMS offerts à l’inscription', 'nombre'],
  ['support_whatsapp', 'WhatsApp du support', 'tel'],
  ['relances_jours', 'Relances avant expiration (jours, ex. 7, 3, 1)', 'liste'],
  ['grace_jours', 'Délai de grâce après expiration (jours)', 'nombre'],
  ['expediteur_sms', 'Nom d’expéditeur SMS (11 caractères max.)', 'texte'],
  // Stockage : limites du plan Supabase et seuil d'alerte (Stockage, Vue d'ensemble).
  ['stockage_limite_octets', 'Limite des fichiers (Go)', 'go'],
  ['base_limite_octets', 'Limite de la base de données (Mo)', 'mo'],
  ['alerte_pourcent', 'Seuil d’alerte du stockage (%)', 'pct']
];
const UNITES = { go: 1024 ** 3, mo: 1024 ** 2 };

function valeurAffichee(cle, v) {
  if (v === null || v === undefined) return '';
  if (cle === 'support_whatsapp') return telLocal(v);
  if (cle === 'stockage_limite_octets') return String(Math.round((Number(v) / UNITES.go) * 10) / 10);
  if (cle === 'base_limite_octets') return String(Math.round(Number(v) / UNITES.mo));
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

export function afficherParametres(conteneur, { majCompteurs, params }) {
  const lecture = !estSuper();
  conteneur.innerHTML = `
    <header class="adm-entete"><div class="adm-titres"><h1>Paramètres de la plateforme</h1>
      <span class="discret">${lecture ? 'Lecture seule : réservé au super admin.' : 'S’appliquent à toutes les boutiques.'}</span></div></header>
    <section class="adm-carte" data-zone="parametres">${squelette(6)}</section>
    <section class="adm-carte" data-zone="option">${squelette(2)}</section>`;
  const zone = conteneur.querySelector('[data-zone="parametres"]');
  const zoneOption = conteneur.querySelector('[data-zone="option"]');

  monterOptions(zoneOption, { params });

  async function charger() {
    let p;
    try { p = (premiere(await rpc('admin_parametres')) || {}).parametres || {}; } catch (err) { zone.innerHTML = blocErreur(err); return; }
    if (!conteneur.isConnected) return;
    zone.innerHTML = `
      <form class="form-modale" novalidate>
        <div class="adm-grille-parametres">
          ${CHAMPS.map(([cle, libelle, type]) => `
            <div class="champ"><label for="par-${cle}">${esc(libelle)}</label>
              <input id="par-${cle}" name="${cle}" class="input" type="${['nombre', 'go', 'mo', 'pct'].includes(type) ? 'number' : type === 'tel' ? 'tel' : 'text'}" ${type === 'nombre' || type === 'mo' ? 'min="0" step="1"' : type === 'go' ? 'min="0.1" step="0.1"' : type === 'pct' ? 'min="10" max="99" step="1"' : ''} ${cle === 'expediteur_sms' ? 'maxlength="11"' : ''} value="${esc(valeurAffichee(cle, p[cle]))}" ${lecture ? 'readonly' : ''}></div>`).join('')}
        </div>
        <div class="adm-maintenance ${p.maintenance ? 'active' : ''}">
          <label class="case-option"><input type="checkbox" name="maintenance" ${p.maintenance ? 'checked' : ''} ${lecture ? 'disabled' : ''}> <strong>Mode maintenance</strong> (les boutiques voient un écran de maintenance ; l’équipe YOUMMA peut continuer)</label>
          <div class="champ"><label for="par-message">Message affiché aux boutiques</label>
            <textarea id="par-message" name="maintenance_message" class="input" rows="2" maxlength="300" ${lecture ? 'readonly' : ''}>${esc(p.maintenance_message || '')}</textarea></div>
        </div>
        <p class="erreur-form" role="alert" hidden></p>
        ${lecture ? '' : '<div class="adm-boutons"><button type="submit" class="btn btn-primaire">Enregistrer les paramètres</button></div>'}
      </form>`;
    if (lecture) return;
    const form = zone.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const z = form.querySelector('.erreur-form');
      const erreur = (m) => { z.textContent = m; z.hidden = !m; };
      const valeurs = {};
      for (const [cle, libelle, type] of CHAMPS) {
        const brut = form[cle].value.trim();
        if (type === 'go' || type === 'mo') {
          const n = Number(brut.replace(',', '.'));
          if (!(n > 0)) return erreur(`${libelle} : nombre positif attendu.`);
          valeurs[cle] = Math.round(n * UNITES[type]);
        } else if (type === 'pct') {
          const n = Number(brut);
          if (!Number.isInteger(n) || n < 10 || n > 99) return erreur(`${libelle} : entre 10 et 99.`);
          valeurs[cle] = n;
        } else if (type === 'nombre') {
          const n = Number(brut);
          if (!Number.isInteger(n) || n < 0) return erreur(`${libelle} : nombre entier attendu.`);
          valeurs[cle] = n;
        } else if (type === 'tel') {
          const t = normaliserTelephone(brut);
          if (!t) return erreur('WhatsApp du support : numéro invalide.');
          valeurs[cle] = t;
        } else if (type === 'liste') {
          const l = brut.split(/[,;\s]+/).filter(Boolean).map(Number);
          if (!l.length || l.some((n) => !Number.isInteger(n) || n < 0)) return erreur('Relances : des nombres de jours séparés par des virgules (ex. 7, 3, 1).');
          valeurs[cle] = l;
        } else {
          if (!brut) return erreur(`${libelle} : obligatoire.`);
          valeurs[cle] = brut;
        }
      }
      valeurs.maintenance = form.maintenance.checked;
      valeurs.maintenance_message = form.maintenance_message.value.trim() || null;
      if (valeurs.maintenance !== Boolean(p.maintenance)) {
        const ok = await confirmer(valeurs.maintenance
          ? 'Activer le mode maintenance ? TOUTES les boutiques verront l’écran de maintenance et ne pourront plus travailler jusqu’à la désactivation.'
          : 'Désactiver le mode maintenance ? Les boutiques retrouvent l’appli.', { titre: 'Mode maintenance', libelleOk: valeurs.maintenance ? 'Activer la maintenance' : 'Désactiver', danger: valeurs.maintenance });
        if (!ok) return;
      }
      erreur('');
      const bouton = form.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      try { await rpc('admin_modifier_parametres', { p_valeurs: valeurs }); toast('Paramètres enregistrés.', 'succes'); majCompteurs?.(); charger(); }
      catch (err) { boutonOccupe(bouton, false); erreur(erreurAdmin(err)); }
    });
    form.maintenance.addEventListener('change', () => form.querySelector('.adm-maintenance').classList.toggle('active', form.maintenance.checked));
  }
  charger();
}
