/**
 * mes-modules.js — Paramètres › Mes modules (#/modules, gérant et propriétaire), maquette MesModules.
 *  - carte de l'activité + « Changer d'activité » (propriétaire) ;
 *  - sections Vente / Votre activité / Communication : une carte par module de niveau 2 (recommandé) ou 1 (proposé),
 *    interrupteur → choisir_module ; formule trop basse, bientôt, bloqué par YOUMMA ;
 *  - « Autres modules (n) » : niveau 0, activables quand même ;
 *  - aperçu « Votre menu » mis à jour en direct ;
 *  - étape 14b : les options payantes (boutique en ligne) ont leur propre section « Options » : prix, date de fin,
 *    interrupteur désactivé et bouton « Activer » (page d'activation).
 */
import { sb } from './supabase.js';
import { etat, estProprietaire } from './state.js';
import { esc, icone, toast, boutonOccupe, messageErreur, ouvrirModale, formatNombre, formatDate } from './utils.js';
import { chargerModules, appliquerModules, donneesModules, activite } from './modules.js';
import { entreesMenu } from './layout.js';

const GROUPES = [['vente', 'Vente'], ['activite', 'Votre activité'], ['communication', 'Communication']];
const NOMS_FORMULES = { essai: 'Essai', essentiel: 'Essentiel', pro: 'Pro', premium: 'Premium' };
const nomFormule = (code) => NOMS_FORMULES[code] || (code ? code.charAt(0).toUpperCase() + code.slice(1) : '');

export function afficherMesModules(conteneur) {
  const boutique = etat.boutique;
  const s = { enCours: new Set() };
  conteneur.innerHTML = `
    <div class="page page-mes-modules">
      <div class="mes-modules" data-zone="corps"><div class="squelette" style="height:420px"></div></div>
    </div>`;
  const q = (sel) => conteneur.querySelector(sel);

  async function charger() {
    await chargerModules(boutique.id);
    if (conteneur.isConnected) render();
  }

  function carte(m) {
    const bloque = m.etat === 'bloque';
    const formule = m.etat === 'formule';
    const bientot = m.etat === 'bientot';
    const actif = m.etat === 'actif';
    // Module qui dépend d'une option (affiche du jour ← boutique en ligne) : verrouillé tant que l'option n'est pas active.
    const parent = m.depend_de ? (donneesModules()?.modules || []).find((x) => x.code === m.depend_de) : null;
    const dependance = Boolean(parent && parent.etat !== 'actif');
    const verrou = bloque || formule || bientot || dependance || s.enCours.has(m.code);
    const badges = [
      m.niveau === 2 ? '<span class="badge-module recommande">recommandé</span>' : '',
      m.groupe === 'activite' ? '<span class="badge-module nouveau">nouveau</span>' : '',
      m.admin === true || m.admin === 'offert' ? '<span class="badge-module offert">offert par YOUMMA</span>' : ''
    ].join('');
    let note = '';
    if (dependance) note = `<span class="pastille-module formule">Fait partie de l’option ${esc(parent.nom || 'Boutique en ligne')}</span>${parent.etat === 'option' ? ' <a class="lien-module" href="#/boutique-en-ligne">Activer</a>' : ''}`;
    else if (formule) note = `<span class="pastille-module formule">Disponible en ${esc(nomFormule(m.formule_min))}</span> <a class="lien-module" href="#/licence">Ma licence</a>`;
    else if (bientot) note = '<span class="pastille-module bientot">Bientôt</span>';
    else if (bloque) note = '<span class="pastille-module bloque">Désactivé par YOUMMA</span>';
    else if (m.en_cours) note = `<span class="note-module">${esc(typeof m.en_cours === 'string' ? m.en_cours : 'Opérations en cours')}</span>`;
    return `
      <div class="carte-module ${actif ? 'active' : ''} ${formule || bientot || dependance ? 'grisee' : ''}" data-module="${esc(m.code)}">
        <div class="carte-module-textes">
          <span class="carte-module-nom">${esc(m.nom)} ${badges}</span>
          <span class="carte-module-desc">${esc(m.description || '')}</span>
          ${note ? `<span class="carte-module-note">${note}</span>` : ''}
        </div>
        <input type="checkbox" class="bascule-doc" role="switch" data-choix="${esc(m.code)}" ${actif ? 'checked' : ''} ${verrou ? 'disabled' : ''}
          aria-label="${esc(m.nom)} : ${actif ? 'activé' : 'désactivé'}">
      </div>`;
  }

  /** Carte d'une option payante : prix, état, date de fin ; on ne la bascule pas ici. */
  function carteOption(m, formule) {
    const actif = m.etat === 'actif';
    const incluse = (m.incluse_formules || []).includes(formule);
    const fin = m.option_fin ? formatDate(`${String(m.option_fin).slice(0, 10)}T12:00:00Z`, 'court') : null;
    let note;
    if (m.etat === 'bloque') note = '<span class="pastille-module bloque">Désactivée par YOUMMA</span>';
    else if (actif && formule === 'essai') note = '<span class="pastille-module offerte">Offerte pendant l’essai</span>';
    else if (actif && incluse) note = '<span class="pastille-module offerte">Comprise dans votre formule</span>';
    else if (actif) note = `<span class="pastille-module offerte">Active${fin ? ` jusqu’au ${esc(fin)}` : ''}</span>`;
    else note = '<span class="pastille-module formule">Pas encore activée</span>';
    const prix = Number(m.prix_mois) ? `${esc(formatNombre(m.prix_mois))} GNF / mois` : '';
    return `
      <div class="carte-module carte-option ${actif ? 'active' : ''}" data-module="${esc(m.code)}">
        <div class="carte-module-textes">
          <span class="carte-module-nom">${esc(m.nom)} <span class="badge-module option">option</span></span>
          <span class="carte-module-desc">${esc(m.description || '')}</span>
          <span class="carte-module-note">${note}${prix ? ` <span class="note-module">${prix}</span>` : ''}</span>
          ${m.etat === 'option' ? '<a class="btn btn-secondaire btn-petit carte-option-bouton" href="#/boutique-en-ligne">Activer</a>' : ''}
        </div>
        <input type="checkbox" class="bascule-doc" role="switch" ${actif ? 'checked' : ''} disabled aria-label="${esc(m.nom)} : ${actif ? 'active' : 'pas activée'} (option payante, activée par YOUMMA)">
      </div>`;
  }

  function render() {
    const d = donneesModules() || {};
    const a = activite() || {};
    const tous = (d.modules || []).filter((m) => m.code);
    const options = tous.filter((m) => m.option_payante);
    const modules = tous.filter((m) => !m.option_payante);
    // Niveau 2 ou 1 : sections ; niveau 0 : « Autres modules » (les modules « bientôt » de niveau 0 ne sont pas montrés).
    const proposes = modules.filter((m) => Number(m.niveau) >= 1);
    const autres = modules.filter((m) => Number(m.niveau) === 0 && m.etat !== 'bientot');
    const sections = GROUPES.map(([g, titre]) => {
      const liste = proposes.filter((m) => (m.groupe || 'vente') === g);
      return liste.length ? `<section class="groupe-modules"><h2>${titre}</h2><div class="grille-modules">${liste.map(carte).join('')}</div></section>` : '';
    }).join('');
    q('[data-zone="corps"]').innerHTML = `
      <div class="mes-modules-gauche">
        <header class="page-titres">
          <a class="lien-retour" href="#/parametres">← Paramètres</a>
          <h1>Mes modules</h1>
          <span class="discret">${esc(boutique.nom)} · ${esc(a.nom || 'Activité')} · Formule ${esc(nomFormule(d.formule))}</span>
        </header>
        <div class="carte-activite">
          <span class="activite-pastille" style="background:${esc(a.couleur || '#0F7B5F')}">${esc(a.emoji || '🏪')}</span>
          <div class="carte-activite-textes"><strong>Activité : ${esc(a.nom || '—')}</strong>
            <span class="discret">Les modules recommandés pour votre activité sont déjà activés.</span></div>
          ${estProprietaire() ? '<button type="button" class="btn btn-secondaire" data-action="changer-activite">Changer d’activité</button>' : ''}
        </div>
        ${options.length ? `<section class="groupe-modules groupe-options"><h2>Options</h2>
          <p class="discret">Services payants en plus de votre formule. YOUMMA les active dès réception du paiement.</p>
          <div class="grille-modules">${options.map((m) => carteOption(m, d.formule)).join('')}</div></section>` : ''}
        ${sections || '<p class="discret">Aucun module proposé.</p>'}
        ${autres.length ? `<details class="autres-modules"><summary>Autres modules (${autres.length}) — rarement utiles pour ${esc((a.nom || 'votre activité').toLowerCase())}</summary>
          <div class="grille-modules">${autres.map(carte).join('')}</div></details>` : ''}
        <p class="rappel-modules">${icone('valide', 16, 2)} Les données d’un module masqué sont conservées. Vous pouvez le réactiver à tout moment.</p>
      </div>
      <aside class="apercu-menu-modules">
        <span class="gras discret">Votre menu</span>
        <div class="apercu-menu">${entreesMenu().map((e, i) => `<span class="apercu-menu-lien ${i === 0 ? 'actif' : ''}">${icone(e.icone, 17, 1.9)}${esc(e.libelle)}</span>`).join('')}</div>
        <span class="discret">Le menu, le tableau de bord, la caisse et les documents se mettent à jour dès que vous changez un module.</span>
      </aside>`;
  }

  async function basculer(entree) {
    const code = entree.dataset.choix;
    const voulu = entree.checked;
    s.enCours.add(code);
    entree.disabled = true;
    const { data, error } = await sb.rpc('choisir_module', { p_boutique: boutique.id, p_code: code, p_actif: voulu });
    s.enCours.delete(code);
    if (error) {
      entree.checked = !voulu;
      entree.disabled = false;
      toast(messageErreur(error), 'erreur', 7000);
      return;
    }
    appliquerModules(boutique.id, data);
    toast('Menu mis à jour.', 'succes');
    if (conteneur.isConnected) render();
  }

  conteneur.addEventListener('change', (e) => {
    const entree = e.target.closest('[data-choix]');
    if (entree) basculer(entree);
  });
  conteneur.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="changer-activite"]')) ouvrirChangementActivite(() => { if (conteneur.isConnected) render(); });
  });
  const surChangement = () => { if (conteneur.isConnected && !s.enCours.size) render(); };
  window.addEventListener('modules:change', surChangement);
  charger();
  return () => window.removeEventListener('modules:change', surChangement);
}

/* ------------------------------------------------------------ Changer d'activité (propriétaire) */

/** Lit les activités (table publique, ordre) ; repli sur la liste interne si la table est inaccessible. */
export async function chargerActivites() {
  const { data, error } = await sb.from('activites').select('code, nom, emoji, couleur, ordre').order('ordre');
  if (error || !data?.length) return [];
  return data;
}

/** Matrice niveau par activité et module (colonnes lues avec souplesse). */
async function chargerMatrice() {
  const { data } = await sb.from('modules_activite').select('*');
  const m = new Map();
  for (const l of data || []) {
    const act = l.activite ?? l.activite_code ?? l.code_activite;
    const mod = l.module ?? l.module_code ?? l.code_module;
    if (act && mod) m.set(`${act}|${mod}`, Number(l.niveau) || 0);
  }
  return m;
}

export function ouvrirChangementActivite(apres = () => {}) {
  const boutique = etat.boutique;
  const s = { activites: [], matrice: new Map(), choix: activite()?.code || boutique.type_activite, garder: true };
  const { el, fermer } = ouvrirModale({
    titre: 'Changer d’activité',
    variante: 'large',
    contenu: '<div class="changer-activite" data-zone="corps"><div class="squelette" style="height:220px"></div></div>'
  });
  const corps = el.querySelector('[data-zone="corps"]');

  function resume() {
    const d = donneesModules() || {};
    const actuels = new Set(d.actifs || []);
    const apparaissent = [];
    const disparaissent = [];
    for (const m of d.modules || []) {
      if (['bientot', 'formule', 'bloque', 'option'].includes(m.etat)) continue;
      const niveau = s.matrice.get(`${s.choix}|${m.code}`) ?? 0;
      const choisi = s.garder && (m.choix === true || m.choix === false) ? m.choix : null;
      const offert = m.admin === true || m.admin === 'offert';
      const apres = offert || Boolean(m.en_cours) || (choisi !== null ? choisi : niveau === 2);
      if (apres && !actuels.has(m.code)) apparaissent.push(m.nom);
      if (!apres && actuels.has(m.code)) disparaissent.push(m.nom);
    }
    return { apparaissent, disparaissent };
  }

  function render() {
    const r = resume();
    const nom = s.activites.find((a) => a.code === s.choix)?.nom || s.choix;
    corps.innerHTML = `
      <div class="grille-activites" role="radiogroup" aria-label="Activité">
        ${s.activites.map((a) => `<button type="button" class="tuile-activite" role="radio" aria-checked="${a.code === s.choix}" data-activite="${esc(a.code)}" style="--couleur-activite:${esc(a.couleur || '#0F7B5F')}">
          <span class="tuile-activite-emoji">${esc(a.emoji || '🏪')}</span><span>${esc(a.nom)}</span></button>`).join('')}
      </div>
      <label class="case-option"><input type="checkbox" data-zone="garder" ${s.garder ? 'checked' : ''}> <span><strong>Garder mes choix actuels</strong> <span class="discret">(modules activés ou masqués à la main)</span></span></label>
      <div class="resume-activite">
        ${s.choix === (activite()?.code || boutique.type_activite) ? '<p class="discret">C’est votre activité actuelle.</p>' : `
          <p><strong>${esc(nom)}</strong> — aperçu des changements :</p>
          ${r.apparaissent.length ? `<p class="resume-plus">Apparaîtront : ${r.apparaissent.map(esc).join(', ')}</p>` : ''}
          ${r.disparaissent.length ? `<p class="resume-moins">Disparaîtront du menu : ${r.disparaissent.map(esc).join(', ')} (leurs données sont conservées)</p>` : ''}
          ${!r.apparaissent.length && !r.disparaissent.length ? '<p class="discret">Aucun module ne change ; seules les catégories et le vocabulaire s’adaptent.</p>' : ''}
          <p class="discret">Les catégories de la nouvelle activité seront ajoutées ; aucune ne sera supprimée.</p>`}
      </div>
      <p class="erreur-form" role="alert" hidden></p>
      <div class="modale-actions">
        <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
        <button type="button" class="btn btn-primaire" data-action="confirmer" ${s.choix === (activite()?.code || boutique.type_activite) ? 'disabled' : ''}>Confirmer</button>
      </div>`;
  }

  (async () => {
    const [activites, matrice] = await Promise.all([chargerActivites(), chargerMatrice()]);
    s.activites = activites;
    s.matrice = matrice;
    if (!activites.length) { corps.innerHTML = `<p class="bloc-erreur">${icone('alerte', 18, 2)} Liste des activités indisponible. Réessayez.</p>`; return; }
    render();
  })();

  el.addEventListener('click', async (e) => {
    const tuile = e.target.closest('[data-activite]');
    if (tuile) { s.choix = tuile.dataset.activite; render(); return; }
    const confirmer = e.target.closest('[data-action="confirmer"]');
    if (!confirmer) return;
    boutonOccupe(confirmer, true, 'Changement…');
    const { data, error } = await sb.rpc('changer_activite', { p_boutique: boutique.id, p_type: s.choix, p_garder_choix: s.garder });
    if (error) {
      boutonOccupe(confirmer, false);
      const z = el.querySelector('.erreur-form'); z.textContent = messageErreur(error); z.hidden = false;
      return;
    }
    const nom = s.activites.find((a) => a.code === s.choix)?.nom || s.choix;
    boutique.type_activite = s.choix;
    appliquerModules(boutique.id, data);
    fermer();
    toast(`Activité : ${nom}. Les catégories de ${nom} ont été ajoutées ; aucune n’a été supprimée.`, 'succes', 7000);
    apres();
  });
  el.addEventListener('change', (e) => {
    if (e.target.matches('[data-zone="garder"]')) { s.garder = e.target.checked; render(); }
  });
}
