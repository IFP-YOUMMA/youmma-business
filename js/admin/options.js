/**
 * admin/options.js — Options payantes (étape 14c), dans Plateforme › Paramètres :
 *  - tarif de la boutique en ligne : lu dans admin_options_catalogue(), écrit par
 *    admin_option_tarif(p_option, p_prix, p_incluse, p_mois_offerts) qui renvoie le catalogue à jour ;
 *    formules proposées depuis la table « formules » ;
 *  - quatre listes (admin_options_boutiques) : Actives · Fin < 15 j · Expirées · À prévenir,
 *    avec appel et WhatsApp ; « Offrir 1 mois à toutes » sur « À prévenir » (super admin).
 * Les relances J-7 / J-2 partent toutes seules (relances_options, planifiée par la base).
 */
import { sb } from '../supabase.js';
import { esc, icone, toast, confirmer, boutonOccupe, lireNombre, formatNombre, formatDate } from '../utils.js';
import { estSuper, rpc, premiere, liste, erreurAdmin, telLocal, lienWa, gnf, nombre, blocErreur, squelette } from './commun.js';

const CODE_OPTION = 'boutique_en_ligne';
const LISTES = [['actives', 'Actives'], ['bientot', 'Fin < 15 jours'], ['expirees', 'Expirées'], ['a_prevenir', 'À prévenir']];
const ETATS = { payante: ['Payante', 'vert'], incluse: ['Comprise', 'vert'], essai: ['Essai', 'orange'], sans: ['Sans option', 'gris'] };

const tableauCatalogue = (r) => (Array.isArray(r) ? r : liste(premiere(r), 'options'));
const dateCourte = (d) => (d ? formatDate(`${String(d).slice(0, 10)}T12:00:00Z`, 'court') : '');

export function monterOptions(zone, { params } = {}) {
  const lecture = !estSuper();
  const s = { liste: LISTES.some(([c]) => c === params?.get('options')) ? params.get('options') : 'actives', jeton: 0 };
  zone.innerHTML = `
    <div data-zone="tarif">${squelette(3)}</div>
    <div class="adm-options-listes">
      <h2>Boutiques et option boutique en ligne</h2>
      <div class="adm-onglets" role="tablist" aria-label="Listes">
        ${LISTES.map(([c, l]) => `<button type="button" role="tab" class="adm-onglet ${c === s.liste ? 'actif' : ''}" data-liste="${c}" aria-selected="${c === s.liste}">${esc(l)}</button>`).join('')}
      </div>
      <div data-zone="liste">${squelette(4)}</div>
    </div>`;
  const sous = (n) => zone.querySelector(`[data-zone="${n}"]`);

  /* ---------------- Tarif */

  function renderTarif(o, formules) {
    const z = sous('tarif');
    if (!o) { z.innerHTML = '<p class="vide-admin">Option « boutique en ligne » introuvable dans le catalogue.</p>'; return; }
    const incluses = o.incluse_formules || [];
    z.innerHTML = `
      <form class="form-modale" novalidate>
        <h2>Option ${esc(String(o.nom || 'boutique en ligne').toLowerCase())}</h2>
        <div class="adm-faits">
          <div><span>Boutiques qui paient</span><strong>${nombre(o.nb_payantes)}</strong></div>
          <div><span>Comprises / en essai</span><strong>${nombre(o.nb_incluses)} / ${nombre(o.nb_essai)}</strong></div>
          <div><span>Recette mensuelle</span><strong>${gnf(o.revenu_mois)}</strong></div>
          <div><span>Encaissé sur 30 jours</span><strong>${gnf(o.encaisse_30j)}</strong></div>
          <div><span>À relancer (&lt; 15 j)</span><strong class="${Number(o.a_relancer) ? 'texte-alerte' : ''}">${nombre(o.a_relancer)}</strong></div>
        </div>
        <p class="discret">Prix affiché aux boutiques sur la page d’activation. Les formules cochées l’incluent sans supplément (l’essai l’offre toujours). Relance automatique par SMS à J-7 et J-2 de la fin.</p>
        <div class="rangee-champs">
          <div class="champ"><label for="opt-prix">Prix par mois (GNF)</label>
            <input id="opt-prix" class="input" type="text" inputmode="numeric" value="${Number(o.prix_mois) ? formatNombre(o.prix_mois) : ''}" ${lecture ? 'readonly' : ''}></div>
          <div class="champ"><label for="opt-offerts">Mois offerts sur un an</label>
            <input id="opt-offerts" class="input" type="number" min="0" max="11" step="1" value="${Number(o.mois_offerts) || 0}" ${lecture ? 'readonly' : ''}></div>
        </div>
        <fieldset class="adm-formules-option"><legend class="etiquette">Comprise dans les formules</legend>
          ${formules.filter((f) => f.code !== 'essai').map((f) => `<label class="case-option"><input type="checkbox" name="incluse" value="${esc(f.code)}" ${incluses.includes(f.code) ? 'checked' : ''} ${lecture ? 'disabled' : ''}> ${esc(f.nom || f.code)}</label>`).join('') || '<span class="discret">Aucune formule.</span>'}
        </fieldset>
        <p class="erreur-form" role="alert" hidden></p>
        ${lecture ? '<p class="aide">Lecture seule : seul le super admin change le tarif.</p>' : '<div class="adm-boutons"><button type="submit" class="btn btn-primaire">Enregistrer le tarif de l’option</button></div>'}
      </form>`;
    if (lecture) return;
    const form = z.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const zErr = form.querySelector('.erreur-form');
      const erreur = (m) => { zErr.textContent = m; zErr.hidden = !m; };
      const prix = lireNombre(form.querySelector('#opt-prix').value);
      if (prix === null || prix < 0) return erreur('Prix invalide.');
      const offerts = Number(form.querySelector('#opt-offerts').value);
      if (!Number.isInteger(offerts) || offerts < 0 || offerts > 11) return erreur('Mois offerts : entre 0 et 11.');
      const incluse = [...form.querySelectorAll('[name="incluse"]:checked')].map((c) => c.value);
      erreur('');
      const bouton = form.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      try {
        // La fonction renvoie le catalogue à jour : on redessine sans recharger.
        const cat = tableauCatalogue(await rpc('admin_option_tarif', { p_option: CODE_OPTION, p_prix: Math.round(prix), p_incluse: incluse, p_mois_offerts: offerts }));
        toast('Tarif de l’option enregistré.', 'succes');
        renderTarif(cat.find((x) => x.code === CODE_OPTION) || null, formules);
      } catch (err) { boutonOccupe(bouton, false); erreur(erreurAdmin(err)); }
    });
  }

  async function chargerTarif() {
    try {
      const [cat, formules] = await Promise.all([
        rpc('admin_options_catalogue'),
        sb.from('formules').select('code, nom, ordre, actif').order('ordre')
      ]);
      if (!zone.isConnected) return;
      renderTarif(tableauCatalogue(cat).find((x) => x.code === CODE_OPTION) || null, (formules.data || []).filter((f) => f.actif !== false));
    } catch (err) { sous('tarif').innerHTML = blocErreur(err); }
  }

  /* ---------------- Listes */

  function ligne(b) {
    const [libEtat, couleur] = ETATS[b.etat] || [b.etat || '—', 'gris'];
    const tel = b.telephone;
    const texteWa = s.liste === 'a_prevenir'
      ? `Bonjour, ici YOUMMA Business : la boutique en ligne de « ${b.nom} » devient une option. Pour la garder ouverte, répondez à ce message.`
      : `Bonjour, ici YOUMMA Business, au sujet de la boutique en ligne de « ${b.nom} ».`;
    return `
      <div class="adm-option-boutique">
        <a class="adm-ligne-textes" href="#/boutiques/${encodeURIComponent(b.id)}"><strong>${esc(b.nom)}</strong>
          <span class="discret">${esc([b.ville, b.licence_formule, b.slug ? `/b/${b.slug}` : ''].filter(Boolean).join(' · '))}</span></a>
        <span class="pastille-admin ${couleur}">${esc(libEtat)}</span>
        <span class="adm-option-fin">${b.fin ? `fin le <strong>${esc(dateCourte(b.fin))}</strong>` : '<span class="discret">sans date de fin</span>'}</span>
        <span class="adm-boutons-ligne">
          ${tel ? `<a class="btn btn-secondaire btn-petit" href="tel:+${esc(String(tel).replace(/\D/g, ''))}" aria-label="Appeler ${esc(b.nom)}">${icone('telephone', 16, 2)} ${esc(telLocal(tel))}</a>
          <a class="btn btn-whatsapp btn-petit" href="${esc(lienWa(tel, texteWa))}" target="_blank" rel="noopener" aria-label="WhatsApp ${esc(b.nom)}">${icone('whatsapp', 16, 2)}</a>` : '<span class="discret">pas de téléphone</span>'}
        </span>
      </div>`;
  }

  async function chargerListe() {
    const jeton = ++s.jeton;
    sous('liste').innerHTML = squelette(4);
    let lignes;
    try { lignes = liste(await rpc('admin_options_boutiques', { p_option: CODE_OPTION, p_filtre: s.liste }), 'lignes', 'boutiques'); } catch (err) { if (jeton === s.jeton) sous('liste').innerHTML = blocErreur(err); return; }
    if (jeton !== s.jeton || !zone.isConnected) return;
    s.lignes = lignes;
    const offrir = s.liste === 'a_prevenir' && estSuper() && lignes.length;
    sous('liste').innerHTML = `
      ${s.liste === 'a_prevenir' ? '<p class="aide">Boutiques qui utilisent leur vitrine sans payer l’option : elles vont la perdre. Prévenez-les, ou offrez-leur un mois.</p>' : ''}
      ${offrir ? `<div class="adm-boutons"><button type="button" class="btn btn-secondaire" data-action="offrir-tous">Offrir 1 mois à toutes (${nombre(lignes.length)})</button></div><div data-zone="resultat-offre"></div>` : ''}
      ${lignes.length ? lignes.map(ligne).join('') : '<p class="vide-admin">Aucune boutique dans cette liste.</p>'}`;
  }

  /** « Offrir 1 mois à toutes » : admin_option pour chaque boutique, une par une, résultat affiché. */
  async function offrirATous(bouton) {
    const lignes = s.lignes || [];
    if (!lignes.length) return;
    if (!(await confirmer(`Offrir 1 mois de boutique en ligne à ${lignes.length} boutique${lignes.length > 1 ? 's' : ''} ? Chaque geste est enregistré dans le journal (montant 0, « Geste commercial »).`,
      { titre: 'Offrir 1 mois à toutes', libelleOk: 'Offrir 1 mois' }))) return;
    boutonOccupe(bouton, true, 'En cours…');
    const zr = sous('resultat-offre');
    const resultats = [];
    const afficher = () => {
      const ok = resultats.filter((r) => r.ok).length;
      zr.innerHTML = `<div class="adm-resultat-offre"><strong>${ok} / ${lignes.length} boutique${lignes.length > 1 ? 's' : ''} prolongée${ok > 1 ? 's' : ''}</strong>
        <ul>${resultats.map((r) => `<li class="${r.ok ? 'texte-succes' : 'texte-danger'}">${esc(r.nom)} : ${r.ok ? `jusqu’au ${esc(dateCourte(r.fin))}` : esc(r.erreur)}</li>`).join('')}</ul></div>`;
    };
    for (const b of lignes) {
      try {
        const fin = premiere(await rpc('admin_option', { p_boutique: b.id, p_option: CODE_OPTION, p_mois: 1, p_montant: 0, p_reference: 'Geste commercial', p_mode: 'offert' }));
        resultats.push({ nom: b.nom, ok: true, fin: typeof fin === 'object' && fin ? (fin.fin || fin.option_fin) : fin });
      } catch (err) { resultats.push({ nom: b.nom, ok: false, erreur: erreurAdmin(err) }); }
      afficher();
    }
    boutonOccupe(bouton, false);
    bouton.disabled = true;
    toast(`${resultats.filter((r) => r.ok).length} boutique(s) prolongée(s) d’un mois.`, 'succes');
    chargerTarif();
  }

  zone.addEventListener('click', (e) => {
    const onglet = e.target.closest('[data-liste]');
    if (onglet) {
      s.liste = onglet.dataset.liste;
      zone.querySelectorAll('[data-liste]').forEach((b) => { b.classList.toggle('actif', b === onglet); b.setAttribute('aria-selected', String(b === onglet)); });
      chargerListe();
    }
    const offrir = e.target.closest('[data-action="offrir-tous"]');
    if (offrir) offrirATous(offrir);
  });
  chargerTarif();
  chargerListe();
}
