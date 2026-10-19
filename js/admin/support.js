/**
 * admin/support.js — Support : demandes d'aide des boutiques (ouvertes, en cours, résolues), fil des
 * messages, réponse (admin_repondre_aide, visible dans l'appli de la boutique), statut, WhatsApp au
 * demandeur, lien vers la fiche de la boutique.
 */
import { esc, icone, toast, boutonOccupe, formatDate } from '../utils.js';
import { rpc, champ, liste, erreurAdmin, telLocal, lienWa, ilYa, blocErreur, squelette } from './commun.js';
import { statutAide } from './boutiques.js';

const STATUTS = [['ouverte', 'Ouvertes'], ['en_cours', 'En cours'], ['resolue', 'Résolues'], ['', 'Toutes']];

function messages(d) {
  return (d.messages || d.fil || []).map((m) => ({
    texte: m.texte ?? m.message ?? '',
    youmma: m.auteur === 'youmma' || m.de === 'youmma' || m.youmma === true || m.par_youmma === true,
    nom: m.nom || m.auteur_nom || '',
    date: m.created_at || m.date
  })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function afficherSupport(conteneur, { params, majCompteurs }) {
  const s = { statut: params.get('demande') ? '' : 'ouverte', demandes: [], ouverte: params.get('demande') || null };
  conteneur.innerHTML = `
    <header class="adm-entete"><div class="adm-titres"><h1>Support</h1><span class="discret">Demandes d’aide envoyées depuis l’appli (menu « Aide »)</span></div></header>
    <div class="adm-filtres"><div class="adm-puces" role="group" aria-label="Statut" data-zone="filtres"></div></div>
    <section class="adm-carte" data-zone="liste">${squelette(5)}</section>`;
  const zone = (n) => conteneur.querySelector(`[data-zone="${n}"]`);

  function render() {
    zone('filtres').innerHTML = STATUTS.map(([c, l]) => `<button type="button" class="adm-puce ${c === s.statut ? 'actif' : ''}" data-statut="${c}" aria-pressed="${c === s.statut}">${esc(l)}</button>`).join('');
    zone('liste').innerHTML = s.demandes.length ? `<ul class="adm-demandes">${s.demandes.map((d) => {
      const fil = messages(d);
      const ouverte = s.ouverte === d.id;
      const tel = champ(d, 'demandeur_telephone', 'telephone');
      return `
        <li class="adm-demande ${ouverte ? 'ouverte' : ''}">
          <button type="button" class="adm-demande-entete" data-demande="${esc(d.id)}" aria-expanded="${ouverte}">
            <span class="adm-ligne-textes"><strong>${esc(d.sujet || 'Demande')}</strong>
              <span class="discret">${esc(champ(d, 'boutique_nom', 'boutique') || '')} · ${esc(champ(d, 'demandeur_nom', 'nom') || '')} · ${esc(ilYa(champ(d, 'updated_at', 'created_at')))}</span></span>
            ${statutAide(d.statut)}
          </button>
          ${ouverte ? `
            <div class="fil-aide">
              ${fil.map((m) => `<div class="bulle-aide ${m.youmma ? 'youmma' : 'moi'}"><span class="bulle-auteur">${m.youmma ? `YOUMMA${m.nom ? ` · ${esc(m.nom)}` : ''}` : esc(m.nom || 'Boutique')} · ${esc(formatDate(m.date, 'complet'))}</span><span class="bulle-texte">${esc(m.texte)}</span></div>`).join('')}
              <form class="repondre-aide" data-repondre="${esc(d.id)}" novalidate>
                <label class="sr-only" for="rep-${esc(d.id)}">Réponse</label>
                <textarea id="rep-${esc(d.id)}" class="input" rows="3" maxlength="1000" placeholder="Votre réponse (visible dans l’appli de la boutique)"></textarea>
                <button type="submit" class="btn btn-primaire">Répondre</button>
              </form>
              <div class="adm-boutons">
                <label class="adm-select-ligne">Statut : <select class="input input-petit-select" data-statut-demande="${esc(d.id)}">
                  ${[['ouverte', 'Ouverte'], ['en_cours', 'En cours'], ['resolue', 'Résolue']].map(([c, l]) => `<option value="${c}" ${c === d.statut ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                ${tel ? `<a class="btn btn-whatsapp btn-petit" href="${esc(lienWa(tel, `Bonjour, ici l’équipe YOUMMA au sujet de votre demande « ${d.sujet || ''} ».`))}" target="_blank" rel="noopener">${icone('whatsapp', 16, 2)} WhatsApp ${esc(telLocal(tel))}</a>` : ''}
                ${champ(d, 'boutique_id') ? `<a class="btn btn-secondaire btn-petit" href="#/boutiques/${encodeURIComponent(d.boutique_id)}">Fiche boutique</a>` : ''}
              </div>
            </div>` : ''}
        </li>`;
    }).join('')}</ul>` : '<p class="vide-admin">Aucune demande ici.</p>';
  }

  async function charger() {
    try {
      s.demandes = liste(await rpc('admin_support', { p_statut: s.statut || null }), 'lignes')
        .sort((a, b) => String(champ(b, 'updated_at', 'created_at')).localeCompare(String(champ(a, 'updated_at', 'created_at'))));
      if (!conteneur.isConnected) return;
      render();
    } catch (err) { zone('liste').innerHTML = blocErreur(err); }
  }

  conteneur.addEventListener('click', (e) => {
    const st = e.target.closest('[data-statut]');
    if (st) { s.statut = st.dataset.statut; charger(); return; }
    const d = e.target.closest('[data-demande]');
    if (d) { s.ouverte = s.ouverte === d.dataset.demande ? null : d.dataset.demande; render(); }
  });
  conteneur.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-repondre]');
    if (!f) return;
    e.preventDefault();
    const texte = f.querySelector('textarea').value.trim();
    if (!texte) return;
    const bouton = f.querySelector('button');
    boutonOccupe(bouton, true, 'Envoi…');
    try { await rpc('admin_repondre_aide', { p_demande: f.dataset.repondre, p_message: texte }); toast('Réponse envoyée : visible dans l’appli de la boutique.', 'succes'); charger(); majCompteurs?.(); }
    catch (err) { boutonOccupe(bouton, false); toast(erreurAdmin(err), 'erreur'); }
  });
  conteneur.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-statut-demande]');
    if (!sel) return;
    try { await rpc('admin_statut_aide', { p_demande: sel.dataset.statutDemande, p_statut: sel.value }); toast('Statut mis à jour.', 'succes'); charger(); majCompteurs?.(); }
    catch (err) { toast(erreurAdmin(err), 'erreur'); }
  });
  charger();
}
