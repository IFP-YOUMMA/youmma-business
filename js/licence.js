/**
 * licence.js — « Ma licence » (#/licence) : formule et date de fin, état (grâce, lecture seule,
 * suspension), tableau des formules (table formules, lecture publique) et renouvellement par
 * WhatsApp au support YOUMMA (paiement en ligne bientôt disponible).
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import { chargerEtatLicence, lienSupport } from './plateforme.js';
import { esc, icone, formatGNF, formatDate, formatTelephone, messageErreur } from './utils.js';

const ETATS = {
  active: { libelle: 'Active', classe: 'statut-actif' },
  grace: { libelle: 'Expirée — délai de grâce', classe: 'statut-bientot' },
  lecture_seule: { libelle: 'Lecture seule', classe: 'statut-expire' },
  suspendue: { libelle: 'Suspendue', classe: 'statut-expire' }
};
const DUREES = [1, 3, 6, 12];

export const prixAnnuel = (f) => Number(f.prix_mois || 0) * (12 - Number(f.mois_offerts || 0));

export function afficherLicence(conteneur) {
  const boutique = etat.boutique;
  const s = { formules: [], formule: null, duree: 12 };
  conteneur.innerHTML = `
    <div class="page page-licence">
      <header class="page-titres">
        <a class="lien-retour" href="#/parametres">← Paramètres</a>
        <h1>Ma licence</h1>
        <span>${esc(boutique.nom)}</span>
      </header>
      <section class="carte section-parametres" data-zone="etat"><span class="squelette" style="height:20px;width:50%"></span></section>
      <section class="carte section-parametres">
        <h2>Formules</h2>
        <div class="formules-licence" data-zone="formules"><span class="squelette" style="height:120px"></span></div>
        <p class="discret">Paiement à YOUMMA par Orange Money, MTN MoMo ou en espèces. Paiement en ligne bientôt disponible.</p>
      </section>
      ${peut('parametres_boutique') ? `
        <section class="carte section-parametres" data-zone="renouveler">
          <h2>Renouveler</h2>
          <div class="champ"><span class="etiquette">Durée</span>
            <div class="segments segments-cadre" role="group" aria-label="Durée">
              ${DUREES.map((d) => `<button type="button" class="segment ${d === s.duree ? 'actif' : ''}" data-duree="${d}" aria-pressed="${d === s.duree}">${d === 12 ? '1 an' : `${d} mois`}</button>`).join('')}
            </div></div>
          <p class="total-renouvellement" data-ref="total"></p>
          <a class="btn btn-whatsapp btn-grand" data-ref="whatsapp" target="_blank" rel="noopener">${icone('whatsapp', 20, 2)} Renouveler par WhatsApp</a>
        </section>` : ''}
    </div>`;
  const zone = (n) => conteneur.querySelector(`[data-zone="${n}"]`);

  function renderEtat() {
    const l = etat.licence || {};
    const st = ETATS[l.etat] || ETATS.active;
    const nomFormule = s.formules.find((f) => f.code === l.formule)?.nom || l.formule || boutique.licence_formule || 'Essai';
    zone('etat').innerHTML = `
      <div class="bloc-entete"><h2>Licence ${esc(nomFormule)}</h2><span class="statut-licence ${st.classe}">${esc(st.libelle)}</span></div>
      <div class="infos-licence">
        <div><span class="discret">Fin de la licence</span><strong>${l.fin ? esc(formatDate(l.fin, 'long')) : '—'}</strong></div>
        <div><span class="discret">Jours restants</span><strong>${l.jours_restants ?? '—'}</strong></div>
        ${l.etat === 'grace' && l.fin_grace ? `<div><span class="discret">Lecture seule à partir du</span><strong>${esc(formatDate(l.fin_grace, 'court'))}</strong></div>` : ''}
        ${l.motif_suspension ? `<div><span class="discret">Motif de suspension</span><strong>${esc(l.motif_suspension)}</strong></div>` : ''}
      </div>
      ${['lecture_seule', 'suspendue'].includes(l.etat) ? '<p class="note-licence">Vous pouvez consulter vos données, mais plus vendre ni modifier tant que la licence n’est pas renouvelée.</p>' : ''}`;
  }

  function renderFormules() {
    const payantes = s.formules.filter((f) => Number(f.prix_mois) > 0);
    zone('formules').innerHTML = s.formules.length ? s.formules.map((f) => `
      <button type="button" class="carte-formule ${f.code === s.formule ? 'choisie' : ''}" data-formule="${esc(f.code)}" ${Number(f.prix_mois) > 0 ? '' : 'disabled'} aria-pressed="${f.code === s.formule}">
        <span class="tres-gras">${esc(f.nom)}</span>
        <span class="prix-formule">${Number(f.prix_mois) > 0 ? `${formatGNF(f.prix_mois)} <small>/ mois</small>` : 'Gratuit'}</span>
        ${Number(f.prix_mois) > 0 ? `<span class="discret">1 an : ${formatGNF(prixAnnuel(f))}${Number(f.mois_offerts) ? ` (${f.mois_offerts} mois offerts)` : ''}</span>` : ''}
        ${f.description ? `<span class="discret">${esc(f.description)}</span>` : ''}
        ${f.max_vendeurs ? `<span class="discret">${f.max_vendeurs} vendeur${f.max_vendeurs > 1 ? 's' : ''} maximum</span>` : ''}
      </button>`).join('') : '<p class="discret">Formules indisponibles.</p>';
    if (!s.formule && payantes.length) s.formule = (payantes.find((f) => f.code === etat.licence?.formule) || payantes[0]).code;
    renderTotal();
  }

  function renderTotal() {
    const zoneR = zone('renouveler');
    if (!zoneR) return;
    const f = s.formules.find((x) => x.code === s.formule);
    conteneur.querySelectorAll('[data-formule]').forEach((b) => { b.classList.toggle('choisie', b.dataset.formule === s.formule); b.setAttribute('aria-pressed', String(b.dataset.formule === s.formule)); });
    if (!f) return;
    const montant = s.duree === 12 ? prixAnnuel(f) : Number(f.prix_mois) * s.duree;
    const libDuree = s.duree === 12 ? '1 an' : `${s.duree} mois`;
    conteneur.querySelector('[data-ref="total"]').innerHTML = `${esc(f.nom)} · ${libDuree} : <strong>${formatGNF(montant)}</strong>`;
    const tel = boutique.telephone ? formatTelephone(boutique.telephone) : '';
    conteneur.querySelector('[data-ref="whatsapp"]').href = lienSupport(
      `Bonjour YOUMMA, je souhaite renouveler la licence de la boutique « ${boutique.nom} »${tel ? ` (${tel})` : ''} : formule ${f.nom}, durée ${libDuree}, soit ${formatGNF(montant).replace(/ /g, ' ')}. Merci de m’indiquer comment payer.`
    );
  }

  conteneur.addEventListener('click', (e) => {
    const f = e.target.closest('[data-formule]');
    if (f) { s.formule = f.dataset.formule; renderTotal(); return; }
    const d = e.target.closest('[data-duree]');
    if (d) {
      s.duree = Number(d.dataset.duree);
      conteneur.querySelectorAll('[data-duree]').forEach((b) => { b.classList.toggle('actif', b === d); b.setAttribute('aria-pressed', String(b === d)); });
      renderTotal();
    }
  });

  (async () => {
    const [formules] = await Promise.all([
      sb.from('formules').select('code, nom, prix_mois, mois_offerts, description, max_vendeurs, ordre, actif').eq('actif', true).order('ordre'),
      chargerEtatLicence()
    ]);
    if (!conteneur.isConnected) return;
    if (formules.error) zone('formules').innerHTML = `<p class="bloc-erreur">${esc(messageErreur(formules.error))}</p>`;
    else s.formules = formules.data;
    renderEtat();
    if (!formules.error) renderFormules();
  })();
}
