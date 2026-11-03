/**
 * marche/reglements.js — Les règlements aux vendeurs (étape 21, maquette MarcheReglements), vue « Règlements » de #/marche.
 *
 * Une ligne par fournisseur, depuis tableau_marche().fournisseurs : ce qu'on lui doit (du), ce qu'on a gagné
 * (commission_gagnee), son taux. « Régler » appelle regler_fournisseur (toutes ses lignes d'un coup) après une
 * confirmation explicite : c'est de l'argent qui part. Modes lus dans modes_de_paiement('fournisseur', pays du vendeur).
 * Les totaux du haut n'additionnent que des montants d'une même monnaie.
 */
import { esc, icone, toast, ouvrirModale, boutonOccupe, formatNombre } from '../utils.js';
import { chargerModes } from '../modes-paiement.js';
import { api, montant, paysDuDrapeau, erreurMarche } from './commun.js';
import { ouvrirArticlesFournisseur } from './articles.js';

/** Somme d'un champ si toutes les lignes ont la même monnaie ; sinon null (on n'additionne jamais deux monnaies). */
function somme(lignes, champ) {
  const devises = [...new Set(lignes.map((l) => l.devise))];
  if (devises.length !== 1) return null;
  return { n: lignes.reduce((t, l) => t + (Number(l[champ]) || 0), 0), devise: devises[0] };
}

export function afficherReglements(zone) {
  zone.innerHTML = '<span class="squelette" style="height:320px"></span>';
  let fournisseurs = [];

  async function charger() {
    try {
      const t = await api.tableau();
      fournisseurs = t?.fournisseurs || [];
      if (!zone.isConnected) return;
      rendre();
    } catch (err) {
      zone.innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(erreurMarche(err))}</p>`;
    }
  }

  function rendre() {
    const aPayer = fournisseurs.filter((f) => Number(f.du) > 0);
    const du = somme(fournisseurs, 'du');
    const gagne = somme(fournisseurs, 'commission_gagnee');
    zone.innerHTML = `
      <section class="mc-kpis">
        <div class="carte mc-kpi"><span class="etiquette-carte">À payer aux fournisseurs</span><strong class="mc-num">${du ? esc(montant(du.n, du.devise)) : '—'}</strong><small>${formatNombre(aPayer.length)} fournisseur${aPayer.length > 1 ? 's' : ''}</small></div>
        <div class="carte mc-kpi"><span class="etiquette-carte">Commission gagnée</span><strong class="mc-num">${gagne ? esc(montant(gagne.n, gagne.devise)) : '—'}</strong><small>retenue sur ce qui est reversé</small></div>
        <div class="carte mc-kpi"><span class="etiquette-carte">Fournisseurs</span><strong class="mc-num">${formatNombre(fournisseurs.length)}</strong><small>dans le marché</small></div>
      </section>
      <section class="carte mc-liste">
        <div class="mc-outils"><h2 class="mc-h2">Le point, fournisseur par fournisseur</h2></div>
        ${fournisseurs.length ? `<div class="mc-tableau-cadre"><table class="mc-tableau">
          <thead><tr><th>Fournisseur</th><th class="droite">Commission</th><th class="droite">Cmdes</th><th class="droite">Notre part</th><th class="droite">À lui verser</th><th>Règlement</th></tr></thead>
          <tbody>${fournisseurs.map((f) => `
            <tr>
              <td><strong>${esc(f.nom)}</strong><span class="mc-sous-ligne">${esc([f.specialite, `${formatNombre(f.articles)} article${Number(f.articles) > 1 ? 's' : ''}`].filter(Boolean).join(' · '))} · ${esc(f.drapeau || '')} ${esc(f.ville || '')}</span></td>
              <td class="droite mc-num">${f.commission === null || f.commission === undefined ? '—' : `${esc(formatNombre(f.commission, 2))} %`}</td>
              <td class="droite mc-num">${formatNombre(f.commandes)}</td>
              <td class="droite mc-num">${esc(montant(f.commission_gagnee, f.devise))}</td>
              <td class="droite mc-num"><strong>${esc(montant(f.du, f.devise))}</strong></td>
              <td class="mc-reglement">${Number(f.du) > 0 ? `<button type="button" class="btn btn-primaire btn-petit" data-regler="${esc(f.id)}">Régler</button>` : '<span class="mc-statut vert">À jour</span>'}<button type="button" class="btn btn-secondaire btn-petit" data-articles="${esc(f.id)}">Articles</button></td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p class="col-vide">Aucun fournisseur dans le marché pour l’instant.</p>'}
      </section>
      <div class="mc-encarts">
        <section class="carte mc-encart"><h3>La commission se règle par fournisseur</h3><p>Chaque vendeur a son taux, fixé quand il entre dans le marché. Le client voit toujours le prix affiché ; la commission est retenue sur ce qu’on reverse au vendeur.</p></section>
        <section class="carte mc-encart"><h3>L’argent des clients n’est pas à vous</h3><p>Ce qui est en caisse appartient aux clients tant que la marchandise n’est pas retirée. Ne le mélangez jamais avec la recette du transport.</p></section>
      </div>`;
  }

  async function regler(f) {
    const modes = await chargerModes('fournisseur', paysDuDrapeau(f.drapeau));
    if (!modes.length) { toast('Impossible de lire les modes de paiement. Vérifiez la connexion.', 'erreur'); return; }
    const { el, fermer } = ouvrirModale({
      titre: `Régler ${f.nom}`,
      contenu: `<form class="form-modale" novalidate>
        <p class="texte-modale">Vous allez verser <strong>${esc(montant(f.du, f.devise))}</strong> à ${esc(f.nom)}, pour toutes ses commandes payées par les clients. Sa commission (${esc(formatNombre(f.commission, 2))} %) est déjà retenue.</p>
        <div class="champ"><label for="rg-mode">Mode</label><select id="rg-mode" class="input">${modes.map((m) => `<option value="${esc(m.code)}">${esc(m.nom)}</option>`).join('')}</select></div>
        <label class="case-option"><input type="checkbox" id="rg-recue" checked> La marchandise de ces commandes est remise au bureau</label>
        <label class="case-option mc-confirmer"><input type="checkbox" id="rg-ok"> Je confirme : cet argent part maintenant.</label>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire" disabled>Enregistrer le règlement</button></div>
      </form>`
    });
    const bouton = el.querySelector('[type=submit]');
    el.querySelector('#rg-ok').addEventListener('change', (e) => { bouton.disabled = !e.target.checked; });
    el.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!el.querySelector('#rg-ok').checked) return;
      boutonOccupe(bouton, true, 'Règlement…');
      try {
        const r = await api.reglerFournisseur(f.id, el.querySelector('#rg-mode').value, el.querySelector('#rg-recue').checked);
        fermer();
        toast(Number(r?.lignes) ? `${montant(r.montant, r.devise)} réglés à ${r.fournisseur || f.nom} (${formatNombre(r.lignes)} commande${Number(r.lignes) > 1 ? 's' : ''}).` : 'Rien à lui verser pour l’instant.', 'succes', 6000);
        charger();
      } catch (err) { boutonOccupe(bouton, false); const z = el.querySelector('.erreur-form'); z.textContent = erreurMarche(err); z.hidden = false; }
    });
  }

  zone.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-regler]');
    if (b) { const f = fournisseurs.find((x) => x.id === b.dataset.regler); if (f) regler(f); }
    const a = ev.target.closest('[data-articles]');
    if (a) { const f = fournisseurs.find((x) => x.id === a.dataset.articles); if (f) ouvrirArticlesFournisseur(f); }
  });
  charger();
}
