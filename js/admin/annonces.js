/**
 * admin/annonces.js — Annonces aux boutiques (maquette AdminPlateforme.dc.html) : texte, bandeau dans
 * l'appli, SMS aux propriétaires (nombre estimé), cible, date de fin facultative, aperçu du bandeau ;
 * liste des annonces (vues par N boutiques, retirer). Publication réservée au super admin.
 */
import { esc, icone, toast, confirmer, boutonOccupe, formatDate } from '../utils.js';
import { compterSms } from '../sms.js';
import { estSuper, rpc, premiere, champ, liste, erreurAdmin, nombre, tableau, blocErreur, squelette, TYPES } from './commun.js';

const CIBLES = [['toutes', 'Toutes les boutiques'], ['essai', 'En essai'], ['payantes', 'Licences payantes'], ['pro_premium', 'Pro et Premium'],
  ...Object.entries(TYPES).map(([c, l]) => [`type:${c}`, `Activité : ${l}`])];
const libelleCible = (c) => CIBLES.find(([code]) => code === c)?.[1] || c || 'Toutes';
const MAX_TEXTE = 300;

/** Boutiques visées par une cible (pour estimer le nombre de SMS). */
function correspond(b, cible) {
  const formule = String(b.licence_formule || 'essai').toLowerCase();
  if (cible === 'essai') return formule === 'essai';
  if (cible === 'payantes') return formule !== 'essai';
  if (cible === 'pro_premium') return formule === 'pro' || formule === 'premium';
  if (cible.startsWith('type:')) return b.type_activite === cible.slice(5);
  return true;
}

export function afficherAnnonces(conteneur) {
  const s = { boutiques: null, annonces: [] };
  conteneur.innerHTML = `
    <header class="adm-entete"><div class="adm-titres"><h1>Annonces</h1><span class="discret">Un bandeau dans l’appli des boutiques et, si besoin, un SMS aux propriétaires</span></div></header>
    <div class="adm-rangee">
      <section class="adm-carte adm-moitie">
        <h2>Annonce à toutes les boutiques</h2>
        ${estSuper() ? `
          <form class="form-modale" novalidate data-zone="formulaire">
            <label class="sr-only" for="annonce-texte">Texte de l’annonce</label>
            <textarea id="annonce-texte" class="input" rows="4" maxlength="${MAX_TEXTE}" placeholder="Ex. Nouveau : votre boutique en ligne est disponible ! Ouvrez « Commandes » pour l’activer."></textarea>
            <span class="discret" data-ref="compteur"></span>
            <div class="adm-options-annonce">
              <label class="case-option"><input type="checkbox" name="bandeau" checked> Bandeau dans l’appli</label>
              <label class="case-option"><input type="checkbox" name="sms"> SMS aux propriétaires <span data-ref="nb-sms"></span></label>
              <label class="adm-select-ligne">Cible :
                <select name="cible" class="input input-petit-select">${CIBLES.map(([c, l]) => `<option value="${esc(c)}">${esc(l)}</option>`).join('')}</select></label>
              <label class="adm-select-ligne">Fin (facultatif) : <input type="date" name="fin" class="input input-petit-select"></label>
            </div>
            <div class="adm-apercu-annonce" data-zone="apercu" hidden></div>
            <p class="erreur-form" role="alert" hidden></p>
            <div class="adm-boutons"><button type="submit" class="btn btn-primaire">Publier</button><button type="button" class="btn btn-secondaire" data-action="apercu">Aperçu</button></div>
          </form>` : '<p class="vide-admin">Publication réservée au super admin.</p>'}
      </section>
      <section class="adm-carte adm-moitie"><h2>Annonces publiées</h2><div data-zone="liste">${squelette(4)}</div></section>
    </div>`;
  const q = (sel) => conteneur.querySelector(sel);
  const form = q('[data-zone="formulaire"]');

  async function chargerBoutiques() {
    if (s.boutiques) return s.boutiques;
    const toutes = [];
    for (let o = 0; o < 20000; o += 500) {
      const r = premiere(await rpc('admin_liste_boutiques', { p_recherche: null, p_filtre: 'toutes', p_limite: 500, p_offset: o })) || {};
      const l = liste(r, 'lignes');
      toutes.push(...l);
      if (l.length < 500) break;
    }
    s.boutiques = toutes;
    return toutes;
  }

  async function estimer() {
    if (!form) return;
    const texte = form.querySelector('#annonce-texte').value;
    const { caracteres, nb } = compterSms(texte || ' ');
    q('[data-ref="compteur"]').textContent = `${caracteres} / ${MAX_TEXTE} caractères · ${nb} SMS par propriétaire`;
    try {
      const boutiques = await chargerBoutiques();
      const n = boutiques.filter((b) => correspond(b, form.cible.value)).length;
      q('[data-ref="nb-sms"]').textContent = `(${nombre(n * nb)} SMS · ${nombre(n)} boutique${n > 1 ? 's' : ''})`;
    } catch { q('[data-ref="nb-sms"]').textContent = ''; }
  }

  function apercu() {
    const texte = form.querySelector('#annonce-texte').value.trim();
    const z = q('[data-zone="apercu"]');
    z.hidden = !texte;
    z.innerHTML = texte ? `<span class="discret">Aperçu dans l’appli :</span><div class="bandeau-annonce">${icone('sms', 18, 2)}<span>${esc(texte)}</span><span class="btn-icone" aria-hidden="true">${icone('fermer', 18, 2)}</span></div>` : '';
  }

  async function chargerListe() {
    try {
      s.annonces = liste(await rpc('admin_annonces'), 'lignes');
      if (!conteneur.isConnected) return;
      q('[data-zone="liste"]').innerHTML = tableau([
        ['Annonce', (a) => `<span class="adm-texte-annonce">${esc(a.texte)}</span><span class="discret">${esc(libelleCible(a.cible))}${a.fin ? ` · jusqu’au ${esc(formatDate(a.fin, 'court'))}` : ''}${a.sms ? ` · ${nombre(champ(a, 'sms_envoyes', 'nb_sms') || 0)} SMS` : ''}${a.bandeau === false ? ' · sans bandeau' : ''}</span>`],
        ['Publiée', (a) => esc(formatDate(a.created_at, 'court'))],
        ['Vue par', (a) => `${nombre(champ(a, 'vues', 'nb_vues') || 0)} boutiques`],
        ['', (a) => (a.retiree || a.active === false ? '<span class="pastille-admin gris">Retirée</span>'
          : estSuper() ? `<button type="button" class="btn-lien btn-lien-danger" data-retirer="${esc(a.id)}">Retirer</button>` : '<span class="pastille-admin vert">En ligne</span>')]
      ], s.annonces, { vide: 'Aucune annonce publiée.' });
    } catch (err) { q('[data-zone="liste"]').innerHTML = blocErreur(err); }
  }

  if (form) {
    form.addEventListener('input', (e) => { if (e.target.id === 'annonce-texte') { estimer(); if (!q('[data-zone="apercu"]').hidden) apercu(); } });
    form.addEventListener('change', (e) => { if (e.target.name === 'cible') estimer(); });
    form.querySelector('[data-action="apercu"]').addEventListener('click', apercu);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const texte = form.querySelector('#annonce-texte').value.trim();
      const z = form.querySelector('.erreur-form');
      const erreur = (m) => { z.textContent = m; z.hidden = !m; };
      if (texte.length < 5) return erreur('Écrivez le texte de l’annonce.');
      if (!form.bandeau.checked && !form.sms.checked) return erreur('Choisissez le bandeau, le SMS, ou les deux.');
      erreur('');
      const nbSms = q('[data-ref="nb-sms"]').textContent;
      if (!(await confirmer(`Publier cette annonce (${libelleCible(form.cible.value)})${form.sms.checked ? ` avec un SMS aux propriétaires ${nbSms}` : ''} ?`, { titre: 'Publier l’annonce', libelleOk: 'Publier' }))) return;
      const bouton = form.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Publication…');
      try {
        const r = premiere(await rpc('admin_publier_annonce', { p_texte: texte, p_cible: form.cible.value, p_bandeau: form.bandeau.checked, p_sms: form.sms.checked, p_fin: form.fin.value || null }));
        toast(`Annonce publiée${form.sms.checked ? ` · ${nombre(champ(r, 'sms') || 0)} SMS en file` : ''}.`, 'succes');
        form.reset();
        q('[data-zone="apercu"]').hidden = true;
        estimer();
        chargerListe();
      } catch (err) { erreur(erreurAdmin(err)); }
      boutonOccupe(bouton, false);
    });
    estimer();
  }

  conteneur.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-retirer]');
    if (!b) return;
    if (!(await confirmer('Retirer cette annonce ? Le bandeau disparaît de l’appli des boutiques.', { titre: 'Retirer l’annonce', libelleOk: 'Retirer', danger: true }))) return;
    try { await rpc('admin_retirer_annonce', { p_annonce: b.dataset.retirer }); toast('Annonce retirée.', 'succes'); chargerListe(); }
    catch (err) { toast(erreurAdmin(err), 'erreur'); }
  });
  chargerListe();
}
