/**
 * admin/console/fiche.js — Fiche d'une boutique (étape 19, maquettes DirectionFiche et BoutiqueLiee), #/fiche/<id>.
 *
 * console_fiche_boutique(id). Même écran pour les deux espaces ; le premier bloc dépend de la facturation de l'espace
 * de la boutique (clé espace de la réponse) :
 *  - commission → « Ce qu'elle vous rapporte » (clé commission) et « Dans le marché » (relier / délier sa boutique,
 *    lier_boutique_fournisseur). La clé licence n'est jamais lue pour un vendeur du marché ;
 *  - licence → « Sa licence » : encaisser, offrir un mois, prolonger, suspendre (fonctions du panneau existant).
 * Puis, pour les deux : comment elle se sert de l'application (usage), ses colis, son journal.
 * Aucun montant n'est calculé ici : tout est lu tel que la base le renvoie.
 */
import { esc, icone, formatNombre, formatGNF, formatDate, confirmer, toast, ouvrirModale, boutonOccupe } from '../../utils.js';
import { rpc, initiales, telLocal, lienWa, ilYa } from '../commun.js';
import { ouvrirEnregistrerPaiement } from '../licences.js';
import { chargerModes } from '../../modes-paiement.js';
import { ouvrirSuspension, ouvrirDateLibre } from '../boutiques.js';
import { espace, estSuperAdmin, montantDevise, erreurConsole, dernierUsage, finDans, SEUIL_AFFICHES, chargerFormulesConsole } from './commun.js';

const ligne = (libelle, valeur, ton = '') => `<div class="cs-ligne-fiche"><span>${esc(libelle)}</span><strong class="${ton}">${valeur}</strong></div>`;

/** Barre « 26 / 30 » : la largeur montre la part, les nombres viennent tels quels de la base. */
function barre(libelle, n, sur, ton) {
  const largeur = sur > 0 ? Math.min(100, Math.round((Number(n) || 0) / sur * 100)) : 0;
  return `<div class="cs-barre-ligne"><div class="cs-barre-tete"><span>${esc(libelle)}</span><strong class="${ton}">${formatNombre(n)}${sur ? ` / ${formatNombre(sur)}` : ''}</strong></div>
    <span class="cs-barre ${ton}"><span style="width:${largeur}%"></span></span></div>`;
}

function blocCommission(f, c) {
  const m = (n) => esc(montantDevise(n, c.devise));
  return `<section class="carte cs-bloc">
    <div class="cs-bloc-tete"><h2>Ce qu’elle vous rapporte</h2><span class="pastille-admin vert">Commission ${formatNombre(c.taux, 2)} %</span></div>
    ${ligne('Facturation', 'À la commission, jamais d’abonnement')}
    ${ligne('Vitrine et affiche', c.vitrine_comprise ? 'Comprises, sans date de fin' : 'Pas encore ouvertes', c.vitrine_comprise ? 'vert' : 'rouge')}
    ${ligne('Commandes, 30 jours', formatNombre(c.commandes_30j))}
    ${ligne('Ses prix affichés vendus, 30 jours', m(c.ventes_30j))}
    ${ligne('Votre commission, 30 jours', m(c.votre_part_30j), 'vert')}
    <div class="cs-ligne-fiche cs-ligne-total"><span>À lui verser</span><strong>${m(c.a_lui_verser)}</strong></div>
    <p class="cs-note">Elle ne vous doit rien et sa vitrine n’expire pas : si elle ne vend pas, vous ne gagnez rien. Votre seul levier est de la faire publier.</p>
    <div class="cs-actions-bloc">
      <button type="button" class="btn btn-primaire" data-action="payer" ${c.fournisseur_id ? '' : 'disabled title="Ouvrez d’abord sa vitrine : elle crée sa fiche du marché"'}>La payer</button>
      <button type="button" class="btn btn-secondaire" data-action="commission">Changer sa commission</button>
      ${c.vitrine_comprise ? '' : '<button type="button" class="btn btn-secondaire" data-action="ouvrir-vendeur">Ouvrir vitrine et affiche</button>'}
      <button type="button" class="btn btn-secondaire cs-btn-danger" data-action="suspendre">${f.suspendue ? 'Réactiver' : 'Suspendre'}</button>
    </div>
  </section>`;
}

function blocMarche(f, c) {
  const u = f.usage || {};
  if (!c.fournisseur_id) {
    return `<section class="carte cs-bloc"><div class="cs-bloc-tete"><h2>Dans le marché</h2><span class="pastille-admin gris">Pas de fiche</span></div>
      <p class="cs-note">Ce vendeur n’a pas encore de fiche dans le marché. « Ouvrir vitrine et affiche » la crée et y relie sa boutique.</p>
      <div class="cs-actions-bloc"><button type="button" class="btn btn-primaire" data-action="ouvrir-vendeur">Ouvrir vitrine et affiche</button></div></section>`;
  }
  return `<section class="carte cs-bloc" data-zone="marche">
    <div class="cs-bloc-tete"><h2>Dans le marché</h2>${c.relie ? '<span class="pastille-admin vert">Reliée</span>' : '<span class="pastille-admin orange">Pas reliée</span>'}</div>
    ${ligne('Commission', `${formatNombre(c.taux, 2)} %`, 'vert')}
    ${ligne('Prépare en', `${formatNombre(c.delai_jours)} jour${Number(c.delai_jours) > 1 ? 's' : ''}`)}
    ${c.fournisseur_slug ? ligne('Fiche du marché', esc(c.fournisseur_slug)) : ''}
    ${c.relie ? `
      <p class="cs-note">Les produits de sa boutique apparaissent dans le marché <strong>sans aucune ressaisie</strong>. Un article en rupture disparaît du marché tout seul${Number(u.articles_rupture) ? ` (${formatNombre(u.articles_rupture)} en ce moment)` : ''}.</p>
      ${Number(u.articles_sans_photo) ? `<p class="cs-alerte-photo">${icone('photo', 16, 2)} <span><strong>${formatNombre(u.articles_sans_photo)} article${u.articles_sans_photo > 1 ? 's' : ''} sans photo</strong> : visibles dans le marché, mais ils ne sortiront jamais en affiche. Une demi-heure de photos vaut des commandes.</span></p>` : ''}
      <div class="cs-actions-bloc"><button type="button" class="btn btn-secondaire" data-action="delier">Délier sa boutique</button></div>`
    : `
      <p class="cs-note">Reliez sa boutique : ses articles entreront dans le marché sans ressaisie, ceux en rupture en sortiront seuls. Un article sans photo reste visible mais ne sortira jamais en affiche.</p>
      <div class="cs-actions-bloc"><button type="button" class="btn btn-primaire" data-action="lier">Relier sa boutique au marché</button></div>`}
  </section>`;
}

function blocLicence(f, l, formules) {
  const nom = formules[l.formule]?.nom || l.formule || '—';
  return `<section class="carte cs-bloc">
    <div class="cs-bloc-tete"><h2>Sa licence</h2><span class="pastille-admin violet">${esc(nom)}</span></div>
    ${ligne('Formule', esc(nom))}
    ${ligne('Fin de la licence', l.fin ? esc(formatDate(l.fin, 'court')) : '—')}
    ${ligne('Finit dans', esc(finDans(l.jours_restants)), Number(l.jours_restants) <= 15 ? 'rouge' : 'vert')}
    ${ligne('Montant mensuel', esc(formatGNF(Number(l.prix_mois) || 0)))}
    ${ligne('Payé au total', esc(formatGNF(Number(l.paye_total) || 0)), 'vert')}
    ${ligne('Dernier paiement', l.dernier_paiement ? esc(formatDate(l.dernier_paiement, 'court')) : '—')}
    <div class="cs-actions-bloc">
      <button type="button" class="btn btn-primaire" data-action="encaisser">Encaisser</button>
      <button type="button" class="btn btn-secondaire" data-action="offrir">Offrir un mois</button>
      <button type="button" class="btn btn-secondaire" data-action="prolonger">Prolonger…</button>
      <button type="button" class="btn btn-secondaire cs-btn-danger" data-action="suspendre">${f.suspendue ? 'Réactiver' : 'Suspendre'}</button>
    </div>
  </section>`;
}

function blocUsage(f) {
  const u = f.usage || {};
  const affiches = Number(u.affiches_publiees_30) || 0;
  return `<section class="carte cs-bloc">
    <div class="cs-bloc-tete"><h2>Comment elle se sert de l’application</h2><span class="discret">dernier usage : <strong class="${u.endormie ? 'rouge' : ''}">${esc(dernierUsage(u.derniere_activite))}</strong></span></div>
    ${barre('Jours d’ouverture, 30 derniers', u.jours_ouverts_30, 30, Number(u.jours_ouverts_30) >= 15 ? 'vert' : 'orange')}
    ${barre('Affiches publiées', affiches, 30, affiches < SEUIL_AFFICHES ? 'rouge' : 'orange')}
    ${barre('Articles mis en ligne', u.articles_en_ligne, Number(u.articles_total) || 0, 'vert')}
    ${barre('Articles sans photo', u.articles_sans_photo, Number(u.articles_total) || 0, Number(u.articles_sans_photo) ? 'rouge' : 'vert')}
    <div class="cs-mini-chiffres">
      <span><strong>${formatNombre(u.affiches_preparees_30)}</strong> affiches préparées</span>
      <span><strong>${formatNombre(u.ventes_30j)}</strong> ventes, 30 j</span>
      <span><strong>${formatNombre(u.articles_rupture)}</strong> en rupture</span>
      <span><strong>${formatNombre(u.vendeurs)}</strong> vendeur${Number(u.vendeurs) > 1 ? 's' : ''}</span>
    </div>
    ${u.endormie ? '<p class="cs-note rouge">Elle n’ouvre plus l’application depuis plus de 21 jours : appelez-la maintenant.</p>' : ''}
  </section>`;
}

function blocColis(f) {
  const c = f.colis || {};
  return `<section class="carte cs-bloc">
    <div class="cs-bloc-tete"><h2>Ses colis</h2></div>
    ${ligne('Partis, 30 jours', `${formatNombre(c.partis_30j)} colis`)}
    ${ligne('Poids taxable, 30 jours', `${formatNombre(c.poids_30j, 1)} kg`)}
    <p class="cs-note">Une boutique du marché vous rapporte deux fois : la commission, puis le transport.</p>
  </section>`;
}

function blocJournal(f) {
  const j = f.journal || [];
  return `<section class="carte cs-bloc cs-journal">
    <div class="cs-bloc-tete"><h2>Son journal</h2></div>
    ${j.length ? `<ul>${j.map((x) => `<li><span class="cs-point" style="background:${esc(x.couleur || '#9AA8A3')}"></span><span><strong>${esc(x.quoi)}</strong><small>${esc(ilYa(x.le))}</small></span></li>`).join('')}</ul>` : '<p class="col-vide">Rien encore.</p>'}
    <p class="cs-note">Le journal sert à préparer un appel : vous savez ce qu’elle a fait avant de composer son numéro.</p>
  </section>`;
}

/** changer_commission_vendeur(p_boutique, p_commission) : la base garde l'ancien taux pour les commandes déjà passées. */
function ouvrirCommission(f, relire) {
  const { el, fermer } = ouvrirModale({
    titre: `Commission de « ${f.nom} »`,
    contenu: `
      <form class="form-modale" novalidate>
        <p class="texte-modale">Taux actuel : <strong>${formatNombre(f.commission.taux, 2)} %</strong>. Le nouveau taux vaut pour les prochaines commandes.</p>
        <div class="champ"><label for="cm-taux">Nouveau taux</label><div class="cs-champ-unite"><input id="cm-taux" class="input" type="text" inputmode="decimal" value="${esc(String(f.commission.taux))}"><span>%</span></div></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Changer le taux</button></div>
      </form>`
  });
  el.querySelector('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const z = el.querySelector('.erreur-form');
    const taux = Number(el.querySelector('#cm-taux').value.trim().replace(',', '.'));
    if (!(taux > 0 && taux < 100)) { z.textContent = 'Un pourcentage entre 0 et 100.'; z.hidden = false; return; }
    const bouton = el.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Enregistrement…');
    try {
      const r = await rpc('changer_commission_vendeur', { p_boutique: f.id, p_commission: taux });
      fermer();
      relire(`Commission : ${formatNombre(r?.avant, 2)} % → ${formatNombre(r?.apres, 2)} %. ${r?.note || ''}`.trim());
    } catch (err) { boutonOccupe(bouton, false); z.textContent = erreurConsole(err); z.hidden = false; }
  });
}

/**
 * regler_fournisseur(p_fournisseur, p_mode) : la base règle ce qui lui est dû et renvoie { montant, devise, lignes }.
 * Modes proposés : modes_de_paiement('fournisseur') ; un mode inconnu est refusé (MODE_INVALIDE).
 */
async function ouvrirReglement(f, relire) {
  const c = f.commission;
  const modes = await chargerModes('fournisseur');
  if (!modes.length) { toast('Impossible de lire les modes de paiement. Vérifiez la connexion.', 'erreur'); return; }
  const { el, fermer } = ouvrirModale({
    titre: `Payer « ${f.nom} »`,
    contenu: `
      <form class="form-modale" novalidate>
        <p class="texte-modale">À lui verser, selon la base : <strong>${esc(montantDevise(c.a_lui_verser, c.devise))}</strong>. Votre commission est déjà retenue.</p>
        <div class="champ"><label for="rg-mode">Mode</label><select id="rg-mode" class="input">${modes.map((m) => `<option value="${esc(m.code)}">${esc(m.nom)}</option>`).join('')}</select></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer le règlement</button></div>
      </form>`
  });
  el.querySelector('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const bouton = el.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Règlement…');
    try {
      const r = await rpc('regler_fournisseur', { p_fournisseur: c.fournisseur_id, p_mode: el.querySelector('#rg-mode').value });
      fermer();
      relire(Number(r?.lignes) ? `${montantDevise(r.montant, r.devise)} réglés à ${r.fournisseur || f.nom} (${formatNombre(r.lignes)} commande${Number(r.lignes) > 1 ? 's' : ''}).` : 'Rien à lui verser pour l’instant.');
    } catch (err) { boutonOccupe(bouton, false); const z = el.querySelector('.erreur-form'); z.textContent = erreurConsole(err); z.hidden = false; }
  });
}

/** payer : ouvre tout de suite le règlement du vendeur (décision « Payer » du tableau de bord de direction). */
export function afficherFiche(conteneur, { id, payer = false }) {
  conteneur.innerHTML = '<div class="cs-page"><span class="squelette" style="height:400px"></span></div>';
  let f = null;

  async function charger() {
    try {
      const [fiche, formules] = await Promise.all([rpc('console_fiche_boutique', { p_boutique: id }), chargerFormulesConsole().catch(() => ({}))]);
      f = fiche;
      if (!conteneur.isConnected) return;
      if (!f) { conteneur.innerHTML = '<div class="cs-page"><p class="bloc-erreur">Boutique introuvable.</p></div>'; return; }
      rendre(formules);
      if (payer && f.commission?.fournisseur_id) { payer = false; ouvrirReglement(f, relire); }
    } catch (err) {
      conteneur.innerHTML = `<div class="cs-page"><p class="bloc-erreur">${icone('alerte', 18, 2)} ${esc(erreurConsole(err))}</p><a class="btn btn-secondaire" href="#/accueil">Retour à l’accueil</a></div>`;
    }
  }

  function rendre(formules) {
    const e = f.espace || {};
    const commission = e.facturation === 'commission';
    const retour = espace(e.code) ? `#/espace/${encodeURIComponent(e.code)}` : '#/accueil';
    const sous = [f.ville, f.activite_nom, f.created_at ? `créée le ${formatDate(f.created_at, 'court')}` : '', f.telephone ? telLocal(f.telephone) : '', f.proprietaire].filter(Boolean).join(' · ');
    const tel = String(f.telephone || '').replace(/\D/g, '');
    conteneur.innerHTML = `
      <div class="cs-page">
        <header class="cs-entete" style="--cs-couleur:${esc(e.couleur || '#0A3D33')}">
          <a class="cs-retour" href="${retour}" aria-label="Retour">${icone('retour', 20, 2)}</a>
          <span class="cs-avatar-fiche">${f.logo_url ? `<img src="${esc(f.logo_url)}" alt="" width="44" height="44">` : esc(initiales(f.nom))}</span>
          <div class="cs-entete-titres"><h1>${esc(f.nom)}</h1><span>${esc(sous)}</span></div>
          <div class="cs-entete-actions">
            <span class="cs-badge-entete">${esc(e.nom || '')}</span>
            ${tel ? `<a class="cs-btn-entete" href="${esc(lienWa(tel))}" target="_blank" rel="noopener">${icone('whatsapp', 16, 2)} WhatsApp</a>
            <a class="cs-btn-entete cs-btn-or" href="tel:+${esc(tel)}">${icone('telephone', 16, 2)} Appeler</a>` : ''}
          </div>
        </header>
        ${f.suspendue ? `<p class="cs-bandeau-suspendue">${icone('alerte', 16, 2)} Boutique suspendue${f.motif_suspension ? ` : ${esc(f.motif_suspension)}` : ''}</p>` : ''}
        <div class="cs-fiche-grille">
          <div class="cs-colonne">
            ${commission ? (f.commission ? blocCommission(f, f.commission) : '<section class="carte cs-bloc"><p class="col-vide">Commission non renseignée.</p></section>')
              : (f.licence ? blocLicence(f, f.licence, formules) : '<section class="carte cs-bloc"><p class="col-vide">Licence non renseignée.</p></section>')}
            ${blocUsage(f)}
          </div>
          <div class="cs-colonne">
            ${commission && f.commission ? blocMarche(f, f.commission) : ''}
            ${commission || Number(f.colis?.partis_30j) ? blocColis(f) : ''}
            ${estSuperAdmin() && !commission ? `<a class="cs-lien-outils" href="#/boutiques/${encodeURIComponent(f.id)}">${icone('outil', 16, 2)} Fiche complète dans les outils (modules, SMS, mot de passe)</a>` : ''}
          </div>
          <div class="cs-colonne">${blocJournal(f)}</div>
        </div>
      </div>`;
  }

  const relire = (message) => { if (message) toast(message, 'succes'); charger(); };

  conteneur.addEventListener('click', async (ev) => {
    const action = ev.target.closest('[data-action]')?.dataset.action;
    if (!action || !f) return;
    const b = { id: f.id, nom: f.nom, suspendue: f.suspendue, licence_formule: f.licence?.formule, licence_fin: f.licence?.fin };
    try {
      if (action === 'suspendre') {
        ouvrirSuspension(b, async (suspendre, motif) => {
          try { await rpc('admin_suspendre', { p_boutique: f.id, p_suspendre: suspendre, p_motif: motif }); relire(suspendre ? 'Boutique suspendue.' : 'Boutique réactivée.'); } catch (err) { toast(erreurConsole(err), 'erreur'); }
        });
      }
      if (action === 'encaisser') ouvrirEnregistrerPaiement(b, () => relire());
      if (action === 'offrir' && await confirmer(`Offrir un mois de licence à « ${f.nom} » ?`, { titre: 'Offrir un mois', libelleOk: '+ 1 mois' })) {
        await rpc('admin_licence', { p_boutique: f.id, p_mode: 'mois', p_valeur: 1, p_date: null, p_formule: null });
        relire('Un mois offert.');
      }
      if (action === 'prolonger') {
        ouvrirDateLibre(b, async (date) => {
          try { await rpc('admin_licence', { p_boutique: f.id, p_mode: 'date', p_valeur: null, p_date: date, p_formule: null }); relire('Date de fin modifiée.'); } catch (err) { toast(erreurConsole(err), 'erreur'); }
        });
      }
      if (action === 'ouvrir-vendeur') {
        await rpc('ouvrir_vendeur', { p_boutique: f.id });
        relire('Vitrine et affiche ouvertes, sans date de fin. Sa fiche du marché est reliée.');
      }
      if (action === 'commission') ouvrirCommission(f, relire);
      if (action === 'payer') ouvrirReglement(f, relire);
      if (action === 'lier' || action === 'delier') {
        const lier = action === 'lier';
        if (!lier && !(await confirmer(`Délier la boutique de « ${f.nom} » ? Ses articles sortiront du marché.`, { titre: 'Délier', libelleOk: 'Délier', danger: true }))) return;
        const r = await rpc('lier_boutique_fournisseur', { p_fournisseur: f.commission.fournisseur_id, p_boutique: lier ? f.id : null });
        relire(lier ? `Reliée : ${formatNombre(r?.articles)} article${Number(r?.articles) > 1 ? 's' : ''} dans le marché.` : 'Boutique déliée du marché.');
      }
    } catch (err) {
      toast(erreurConsole(err), 'erreur');
    }
  });

  charger();
}
