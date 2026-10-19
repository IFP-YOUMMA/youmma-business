/**
 * admin/utilisateurs.js — Utilisateurs de toutes les boutiques : recherche (nom, téléphone, boutique),
 * rôle, dernière connexion, état ; nouveau mot de passe provisoire, bloquer / débloquer (super admin),
 * ouvrir la fiche de la boutique.
 */
import { esc, icone, toast, confirmer, differer } from '../utils.js';
import { estSuper, rpc, champ, liste, appelComptes, erreurAdmin, ilYa, telLocal, nouveauMotDePasse, tableau, blocErreur, squelette } from './commun.js';

const ROLES = { proprietaire: 'Propriétaire', gerant: 'Gérant', vendeur: 'Vendeur' };

export function afficherUtilisateurs(conteneur, { params }) {
  const s = { recherche: params.get('q') || '', lignes: [], jeton: 0 };
  conteneur.innerHTML = `
    <header class="adm-entete"><div class="adm-titres"><h1>Utilisateurs</h1><span class="discret">Membres de toutes les boutiques</span></div></header>
    <div class="adm-filtres">
      <label class="recherche-entete"><span class="sr-only">Rechercher</span>${icone('recherche', 18, 2)}
        <input type="search" id="recherche-utilisateurs" placeholder="Nom, téléphone ou boutique" value="${esc(s.recherche)}" autocomplete="off"></label>
    </div>
    <section class="adm-carte" data-zone="liste">${squelette(6)}</section>`;
  const zone = conteneur.querySelector('[data-zone="liste"]');

  function render() {
    zone.innerHTML = tableau([
      ['Utilisateur', (u) => `<span class="adm-cellule-nom"><strong>${esc(u.nom || '—')}</strong><span class="discret">${esc(telLocal(u.telephone))}</span></span>`],
      ['Rôle', (u) => esc(ROLES[u.role] || u.role || '')],
      ['Boutique', (u) => (champ(u, 'boutique_id') ? `<a href="#/boutiques/${encodeURIComponent(u.boutique_id)}">${esc(champ(u, 'boutique_nom', 'boutique') || 'Boutique')}</a>` : '—')],
      ['Dernière connexion', (u) => esc(ilYa(champ(u, 'derniere_connexion', 'last_sign_in_at')))],
      ['État', (u) => [u.bloque ? '<span class="pastille-admin rouge">Bloqué</span>' : '', u.mdp_temporaire ? '<span class="pastille-admin orange">Mot de passe provisoire</span>' : '', u.actif === false ? '<span class="pastille-admin gris">Désactivé</span>' : ''].join(' ') || '<span class="pastille-admin vert">Actif</span>'],
      ['', (u) => `<span class="adm-boutons-ligne">
        <button type="button" class="btn btn-secondaire btn-petit" data-mdp="${esc(u.user_id)}">Nouveau mot de passe</button>
        ${estSuper() ? `<button type="button" class="btn btn-petit ${u.bloque ? 'btn-secondaire' : 'btn-refuser'}" data-bloquer="${esc(u.user_id)}" data-etat="${u.bloque ? 'bloque' : ''}">${u.bloque ? 'Débloquer' : 'Bloquer'}</button>` : ''}</span>`]
    ], s.lignes, { vide: s.recherche ? 'Aucun utilisateur ne correspond.' : 'Aucun utilisateur.' });
  }

  async function charger() {
    const jeton = ++s.jeton;
    try {
      const r = await rpc('admin_utilisateurs', { p_recherche: s.recherche || null, p_limite: 200 });
      if (jeton !== s.jeton || !conteneur.isConnected) return;
      s.lignes = liste(r, 'lignes');
      render();
    } catch (err) { zone.innerHTML = blocErreur(err); }
  }

  conteneur.addEventListener('click', async (e) => {
    const mdp = e.target.closest('[data-mdp]');
    if (mdp) { nouveauMotDePasse(s.lignes.find((u) => u.user_id === mdp.dataset.mdp) || { user_id: mdp.dataset.mdp }, confirmer); return; }
    const b = e.target.closest('[data-bloquer]');
    if (!b) return;
    const u = s.lignes.find((x) => x.user_id === b.dataset.bloquer) || {};
    const debloquer = b.dataset.etat === 'bloque';
    if (!(await confirmer(debloquer ? `Débloquer le compte de ${u.nom || 'cet utilisateur'} ?` : `Bloquer le compte de ${u.nom || 'cet utilisateur'} ? Il ne pourra plus se connecter.`,
      { titre: debloquer ? 'Débloquer le compte' : 'Bloquer le compte', libelleOk: debloquer ? 'Débloquer' : 'Bloquer', danger: !debloquer }))) return;
    try { await appelComptes({ action: debloquer ? 'debloquer' : 'bloquer', user_id: u.user_id }); toast(debloquer ? 'Compte débloqué.' : 'Compte bloqué.', 'succes'); charger(); }
    catch (err) { toast(erreurAdmin(err), 'erreur'); }
  });
  const rechercher = differer(charger, 350);
  conteneur.querySelector('#recherche-utilisateurs').addEventListener('input', (e) => { s.recherche = e.target.value.trim(); rechercher(); });
  charger();
}
