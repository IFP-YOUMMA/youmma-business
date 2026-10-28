/**
 * affiche-calendrier.js — Le mois de publications (étape 15, maquette AfficheCalendrier.dc.html).
 *
 *  - ordinateur : grille du mois (mon_plan ; generer_plan si le mois n'est pas encore préparé), une couleur par
 *    thème, aujourd'hui entouré, dimanches « Repos », pastille quand la journée est publiée ; clic sur un jour →
 *    thème / habillage / article / retirer (changer_jour_plan) ; un jour passé n'est pas modifiable ;
 *  - téléphone : les 7 prochains jours ;
 *  - « Changer le rythme » : jours, heure, réseaux, ton, signature (modifier_publication) ;
 *  - colonne de droite : Mes réseaux (mes_reseaux, connecter / déconnecter), chiffres du mois, publication
 *    automatique, « Ce qui marche, et quand ».
 */
import { sb } from './supabase.js';
import { etat } from './state.js';
import { RESEAUX, connecterReseau, deconnecterReseau, iconeReseau, heureLisible } from './affiche-publier.js';
import { esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, formatNombre, formatDate, formatTelephone, dateISO, capitaliser, prixApplique } from './utils.js';

const premiere = (d) => (Array.isArray(d) ? d[0] : d) || null;
/** Libellés courts des thèmes dans le calendrier (le nom complet vient de affiche_themes). */
export const COURTS_THEMES = { produit: 'Article', promo: 'Promo', lundi: 'Bon lundi', vendredi: 'Vendredi', fete: 'Fête', arrivage: 'Arrivage', horaires: 'Horaires', merci: 'Merci', saison: 'Saison' };
/** Tons du texte (réglage « ton » de modifier_publication). */
export const TONS = [['simple', 'Simple'], ['chaleureux', 'Chaleureux'], ['dynamique', 'Dynamique']];
const JOURS_SEMAINE = [[1, 'Lun'], [2, 'Mar'], [3, 'Mer'], [4, 'Jeu'], [5, 'Ven'], [6, 'Sam'], [7, 'Dim']];
const ENTETES = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Réglages de publication (obtenir_publication) : { jours, auto, heure_auto, reseaux, ton, signature }. */
export async function lireReglages() {
  const { data, error } = await sb.rpc('obtenir_publication', { p_boutique: etat.boutique.id });
  return error ? {} : (premiere(data) || {});
}

/** Bandeau « Reconnectez votre page Facebook avant le … » (réseau qui expire dans moins de 7 jours). */
export async function bandeauExpiration(zone) {
  const { data } = await sb.rpc('mes_reseaux', { p_boutique: etat.boutique.id });
  const r = (premiere(data)?.reseaux || []).find((x) => x.expire_bientot);
  if (!r || !zone.isConnected) return;
  const quoi = r.reseau === 'facebook' ? 'votre page Facebook' : r.reseau === 'instagram' ? 'votre compte Instagram' : `votre compte ${RESEAUX[r.reseau]?.nom || r.reseau}`;
  zone.innerHTML = `<div class="bandeau-option alerte" role="status">${icone('alerte', 17, 2)}
    <span>Reconnectez ${esc(quoi)} avant le <strong>${esc(formatDate(r.expire_le, 'long'))}</strong>, sinon la publication automatique s’arrêtera.</span>
    <button type="button" class="btn btn-secondaire btn-petit" data-reconnecter="${esc(r.reseau)}">Reconnecter</button></div>`;
  zone.querySelector('[data-reconnecter]').addEventListener('click', () => connecterReseau(r.reseau));
}

const moisDe = (jour) => `${String(jour).slice(0, 7)}-01`;
function decalerMois(mois, n) { const d = new Date(`${mois}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }
const jourSemaine = (jour) => { const j = new Date(`${String(jour).slice(0, 10)}T12:00:00Z`).getUTCDay(); return j === 0 ? 7 : j; };
const NOMS_STYLES = { catalogue: 'Catalogue', impact: 'Impact', selection: 'Sélection', photo: 'Photo', message: 'Message' };
const STYLE_DEFAUT = { produit: 'catalogue', promo: 'impact', lundi: 'message', vendredi: 'message', fete: 'message', arrivage: 'photo', horaires: 'message', merci: 'message', saison: 'catalogue' };
const idProduit = (j) => (j.produit && typeof j.produit === 'object' ? j.produit.id : j.produit) || null;
const nomProduit = (j) => (j.produit && typeof j.produit === 'object' ? j.produit.nom : null);

export function monterCalendrier(zone, { modifier }) {
  const boutique = etat.boutique;
  const aujourdhui = dateISO();
  const s = { mois: moisDe(aujourdhui), plan: null, suivant: null, reseaux: null, ceMois: null, reglages: null, themes: [], produits: null, config: {} };

  zone.innerHTML = `
    <div class="aff-calendrier">
      <div class="aff-cal-gauche">
        <header class="aff-cal-entete">
          <div><h2>Votre mois de publications, déjà préparé</h2><span class="discret" data-zone="resume"></span></div>
          <div class="aff-cal-boutons">
            <div class="aff-cal-nav seul-ordi">
              <button type="button" class="btn-icone" data-mois="-1" aria-label="Mois précédent">${icone('retour', 18, 2)}</button>
              <button type="button" class="btn-icone" data-mois="1" aria-label="Mois suivant"><span style="display:inline-flex;transform:scaleX(-1)">${icone('retour', 18, 2)}</span></button>
            </div>
            ${modifier ? '<button type="button" class="btn btn-secondaire" data-action="rythme">Changer le rythme</button>' : ''}
          </div>
        </header>
        <section class="carte aff-cal-grille-carte seul-ordi" data-zone="grille"><span class="squelette" style="height:420px"></span></section>
        <section class="carte aff-cal-semaine seul-mobile" data-zone="semaine"><span class="squelette" style="height:300px"></span></section>
      </div>
      <aside class="aff-cal-droite">
        <section class="carte aff-reseaux" data-zone="reseaux"><span class="squelette" style="height:240px"></span></section>
        <section class="carte aff-marche">
          <h2>Ce qui marche, et quand</h2>
          <ul>
            <li><span class="point whatsapp"></span><span><strong>WhatsApp</strong> — tout de suite, pour tout le monde. L’image part dans le statut en deux touches.</span></li>
            <li><span class="point facebook"></span><span><strong>Facebook</strong> — tout de suite en trois secondes : l’image est enregistrée, le texte copié, Facebook s’ouvre. En un seul clic une fois Meta validé.</span></li>
            <li><span class="point instagram"></span><span><strong>Instagram</strong> — même chose, avec un compte professionnel relié à la page Facebook.</span></li>
            <li><span class="point tiktok"></span><span><strong>TikTok</strong> — l’appli crée une petite vidéo de 5 s à partir de l’affiche. Publication manuelle d’abord, automatique après validation de TikTok.</span></li>
          </ul>
          <p class="discret">À savoir : la publication en un seul clic demande l’accord de Meta et de TikTok (vérification de l’entreprise, validation de l’application). Ça prend plusieurs semaines. En attendant, la version en trois secondes marche pour tout le monde, et l’écran est exactement le même.</p>
        </section>
      </aside>
    </div>`;
  const sous = (n) => zone.querySelector(`[data-zone="${n}"]`);

  /* ---------------- Données */

  async function plan(mois, { preparer = true } = {}) {
    let { data, error } = await sb.rpc('mon_plan', { p_boutique: boutique.id, p_mois: mois });
    if (error) throw error;
    let p = premiere(data) || { jours: [] };
    // Mois à venir pas encore préparé : generer_plan le remplit (sans toucher au passé ni aux jours fixés).
    const futurVide = mois >= moisDe(aujourdhui) && !(p.jours || []).some((j) => j.theme && String(j.jour).slice(0, 10) >= aujourdhui);
    if (preparer && futurVide && modifier) {
      const g = await sb.rpc('generer_plan', { p_boutique: boutique.id, p_mois: mois });
      if (!g.error) {
        ({ data, error } = await sb.rpc('mon_plan', { p_boutique: boutique.id, p_mois: mois }));
        if (!error) p = premiere(data) || p;
      }
    }
    return p;
  }

  async function charger() {
    try {
      const [p, suivant, reseaux, reglages, themes] = await Promise.all([
        plan(s.mois),
        // Téléphone : les 7 prochains jours peuvent déborder sur le mois suivant.
        s.mois === moisDe(aujourdhui) ? plan(decalerMois(s.mois, 1), { preparer: false }).catch(() => null) : Promise.resolve(null),
        sb.rpc('mes_reseaux', { p_boutique: boutique.id }),
        lireReglages(),
        s.themes.length ? Promise.resolve({ data: s.themes }) : sb.from('affiche_themes').select('*')
      ]);
      if (!zone.isConnected) return;
      s.plan = p;
      s.suivant = suivant;
      s.reseaux = premiere(reseaux.data)?.reseaux || [];
      s.ceMois = premiere(reseaux.data)?.ce_mois || null;
      s.reglages = { ...(premiere(reseaux.data)?.reglages || {}), ...reglages };
      s.themes = themes.data || p.themes || [];
      renderGrille();
      renderSemaine();
      renderReseaux();
    } catch (err) {
      sous('grille').innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`;
      sous('semaine').innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`;
    }
  }

  /* ---------------- Rendu */

  const libelle = (j) => (j.theme === 'fete' && j.fete?.nom ? j.fete.nom : COURTS_THEMES[j.theme] || j.theme);

  function renderGrille() {
    const jours = (s.plan.jours || []).slice().sort((a, b) => String(a.jour).localeCompare(String(b.jour)));
    const prevues = jours.filter((j) => j.theme).length;
    const titreMois = capitaliser(formatDate(`${s.mois}T12:00:00Z`, 'moisAnnee'));
    sous('resume').textContent = `${titreMois} · ${prevues} affiche${prevues > 1 ? 's' : ''} prévue${prevues > 1 ? 's' : ''}${modifier ? ' · vous pouvez changer n’importe quel jour à venir' : ''}`;
    const premierJour = jourSemaine(s.mois);
    const nbJours = new Date(Date.UTC(Number(s.mois.slice(0, 4)), Number(s.mois.slice(5, 7)), 0)).getUTCDate();
    const parJour = new Map(jours.map((j) => [String(j.jour).slice(0, 10), j]));
    const cases = [];
    for (let i = 1; i < premierJour; i++) cases.push('<span class="aff-case vide" aria-hidden="true"></span>');
    for (let n = 1; n <= nbJours; n++) {
      const date = `${s.mois.slice(0, 8)}${String(n).padStart(2, '0')}`;
      const j = parJour.get(date) || { jour: date, theme: null };
      const passe = date < aujourdhui;
      const classes = ['aff-case', j.theme ? `theme-${j.theme}` : 'repos', date === aujourdhui ? 'aujourdhui' : '', passe ? 'passe' : ''].filter(Boolean).join(' ');
      cases.push(`<button type="button" class="${classes}" data-jour="${date}" aria-label="${esc(formatDate(`${date}T12:00:00Z`, 'long'))} : ${esc(j.theme ? libelle(j) : 'repos')}${j.publiee ? ', publiée' : ''}">
        <span class="aff-case-num">${n}</span>
        <span class="aff-case-theme">${esc(j.theme ? libelle(j) : 'Repos')}</span>
        ${nomProduit(j) ? `<span class="aff-case-article">${esc(nomProduit(j))}</span>` : ''}
        ${j.publiee ? `<span class="aff-case-publiee" title="Publiée">${icone('valide', 11, 3)}</span>` : ''}
        ${j.fixe ? '<span class="aff-case-fixe" title="Choisi à la main"></span>' : ''}
      </button>`);
    }
    sous('grille').innerHTML = `
      <div class="aff-grille-entetes">${ENTETES.map((e) => `<span>${e}</span>`).join('')}</div>
      <div class="aff-grille">${cases.join('')}</div>
      <div class="aff-legende">${Object.entries(COURTS_THEMES).map(([c, l]) => `<span><span class="aff-theme-pastille theme-${c}"></span>${esc(l)}</span>`).join('')}</div>`;
  }

  function renderSemaine() {
    const tous = [...(s.plan?.jours || []), ...(s.suivant?.jours || [])];
    const parJour = new Map(tous.map((j) => [String(j.jour).slice(0, 10), j]));
    const lignes = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(`${aujourdhui}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      const j = parJour.get(date) || { jour: date, theme: null };
      lignes.push(`<button type="button" class="aff-semaine-jour ${j.theme ? `theme-${j.theme}` : 'repos'}" data-jour="${date}">
        <span class="aff-semaine-date"><strong>${i === 0 ? 'Aujourd’hui' : i === 1 ? 'Demain' : esc(capitaliser(formatDate(`${date}T12:00:00Z`, 'jourCourt')))}</strong><span>${esc(formatDate(`${date}T12:00:00Z`, 'jourMois'))}</span></span>
        <span class="aff-theme-pastille theme-${esc(j.theme || 'repos')}"></span>
        <span class="aff-semaine-textes"><strong>${esc(j.theme ? libelle(j) : 'Repos')}</strong>${nomProduit(j) ? `<span>${esc(nomProduit(j))}</span>` : ''}</span>
        ${j.publiee ? `<span class="aff-case-publiee">${icone('valide', 11, 3)}</span>` : icone('chevronDroite', 16, 2)}
      </button>`);
    }
    sous('semaine').innerHTML = `<h2>Les 7 prochains jours</h2>${lignes.join('')}`;
  }

  async function renderReseaux() {
    s.config = await import('./affiche-publier.js').then((m) => m.reseauxConnectables()).catch(() => ({}));
    if (!zone.isConnected) return;
    const r = (code) => s.reseaux.find((x) => x.reseau === code) || null;
    const ligne = (code) => {
      const c = r(code);
      let etatTxt; let classe; let action = '';
      if (code === 'whatsapp') { etatTxt = 'Manuel'; classe = 'gris'; }
      else if (c?.actif) {
        etatTxt = c.expire_bientot ? 'À reconnecter' : 'Connecté';
        classe = c.expire_bientot ? 'orange' : 'vert';
        action = modifier ? `<button type="button" class="btn-lien" data-deconnecter="${code}">Déconnecter</button>` : '';
      } else {
        etatTxt = c?.erreur ? 'Erreur' : 'À connecter';
        classe = c?.erreur ? 'rouge' : 'orange';
        action = modifier ? `<button type="button" class="btn btn-secondaire btn-petit" data-connecter="${code}">Connecter</button>` : '';
      }
      const sousTxt = code === 'whatsapp' ? `Statut · ${esc(boutique.telephone ? formatTelephone(boutique.telephone).replace(/^\+224\s*/, '') : 'votre téléphone')}` : c?.nom ? esc(c.nom) : code === 'instagram' ? 'Compte professionnel' : code === 'tiktok' ? 'Petite vidéo de 5 s' : 'Votre page';
      return `<div class="aff-reseau">
        <span class="aff-reseau-icone ${code}">${iconeReseau(code, 18)}</span>
        <span class="aff-reseau-textes"><strong>${esc(RESEAUX[code].nom)}</strong><span>${sousTxt}${c?.erreur ? ` · ${esc(c.erreur)}` : ''}</span></span>
        <span class="aff-reseau-droite"><span class="aff-etat-reseau ${classe}">${esc(etatTxt)}</span>${action}</span>
      </div>`;
    };
    const m = s.ceMois || {};
    const meilleure = m.meilleure ? (typeof m.meilleure === 'object' ? `${m.meilleure.titre || m.meilleure.theme_nom || ''}${m.meilleure.vues ? ` · ${formatNombre(m.meilleure.vues)}` : ''}` : String(m.meilleure)) : '—';
    const autoPossible = s.reseaux.some((x) => x.actif && RESEAUX[x.reseau]?.auto);
    const g = s.reglages || {};
    sous('reseaux').innerHTML = `
      <h2>Mes réseaux</h2>
      ${['facebook', 'instagram', 'whatsapp', 'tiktok'].map(ligne).join('')}
      <div class="aff-chiffres">
        <div><span>Publications ce mois</span><strong>${formatNombre(m.publications || 0)}</strong></div>
        <div><span>Vues cumulées</span><strong>${formatNombre(m.vues || 0)}</strong></div>
        <div><span>Meilleure publication</span><strong>${esc(meilleure)}</strong></div>
      </div>
      <div class="aff-auto ${autoPossible ? '' : 'grise'}">
        <div class="aff-auto-textes"><strong>Publication automatique</strong><span>${autoPossible ? `Chaque matin à ${esc(heureLisible(g.heure_auto))}` : 'Connectez d’abord un réseau'}</span></div>
        <input type="checkbox" class="bascule-doc" role="switch" data-action="auto" ${g.auto && autoPossible ? 'checked' : ''} ${autoPossible && modifier ? '' : 'disabled'} aria-label="Publication automatique">
      </div>`;
  }

  /* ---------------- Un jour */

  async function chargerProduits() {
    if (!s.produits) {
      const { data } = await sb.from('produits').select('id, nom, unite, prix_detail, prix_gros, prix_promo, promo_fin').eq('boutique_id', boutique.id).eq('actif', true).order('nom');
      s.produits = data || [];
    }
    return s.produits;
  }

  async function ouvrirJour(date) {
    const tous = [...(s.plan?.jours || []), ...(s.suivant?.jours || [])];
    const j = tous.find((x) => String(x.jour).slice(0, 10) === date) || { jour: date, theme: null };
    const titre = capitaliser(formatDate(`${date}T12:00:00Z`, 'long'));
    if (date < aujourdhui || !modifier) {
      ouvrirModale({
        titre,
        contenu: `<p class="texte-modale">${j.theme ? `<strong>${esc(libelle(j))}</strong>${nomProduit(j) ? ` · ${esc(nomProduit(j))}` : ''}${j.publiee ? ' · publiée' : ''}` : 'Pas d’affiche ce jour-là.'}</p>
          <p class="discret">${date < aujourdhui ? 'Un jour passé ne se modifie plus.' : 'Seul le gérant peut changer le plan.'}</p>
          <div class="modale-actions"><button type="button" class="btn btn-primaire" data-fermer>Fermer</button></div>`
      });
      return;
    }
    const produits = await chargerProduits();
    const themes = s.themes.length ? s.themes : Object.keys(COURTS_THEMES).map((code) => ({ code, nom: COURTS_THEMES[code], besoin: ['produit', 'promo', 'arrivage', 'saison'].includes(code) ? 'produit' : 'aucun' }));
    const { el, fermer } = ouvrirModale({
      titre,
      contenu: `<form class="form-modale" novalidate>
        <div class="champ"><label for="cal-theme">Thème</label>
          <select id="cal-theme" class="input">${themes.map((t) => `<option value="${esc(t.code)}" data-besoin="${esc(t.besoin || 'aucun')}" ${t.code === j.theme ? 'selected' : ''}>${esc(t.nom)}</option>`).join('')}</select></div>
        <div class="champ" data-ref="champ-style"><label for="cal-style">Habillage</label><select id="cal-style" class="input"></select></div>
        <div class="champ" data-ref="champ-article"><label for="cal-article">Article</label>
          <select id="cal-article" class="input"><option value="">Choisi automatiquement</option>${produits.map((p) => `<option value="${esc(p.id)}" ${p.id === idProduit(j) ? 'selected' : ''}>${esc(p.nom)} · ${formatNombre(prixApplique(p))} GNF</option>`).join('')}</select></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions">
          ${j.theme ? '<button type="button" class="btn btn-secondaire" data-action="retirer">Pas d’affiche ce jour</button>' : ''}
          <button type="submit" class="btn btn-primaire">Enregistrer</button>
        </div>
      </form>`
    });
    const form = el.querySelector('form');
    const select = form.querySelector('#cal-theme');
    const nomStyle = (c) => (s.plan?.styles || []).find((x) => x.code === c)?.nom || NOMS_STYLES[c] || c;
    const majArticle = () => {
      form.querySelector('[data-ref="champ-article"]').hidden = select.selectedOptions[0]?.dataset.besoin !== 'produit';
      // Seulement les habillages permis par ce thème (affiche_themes.styles), celui par défaut d'abord choisi.
      const t = themes.find((x) => x.code === select.value) || {};
      const permis = (t.styles && t.styles.length ? t.styles : [t.style_defaut || STYLE_DEFAUT[select.value] || 'message']);
      const actuel = select.value === j.theme && j.style && permis.includes(j.style) ? j.style : (t.style_defaut || STYLE_DEFAUT[select.value] || permis[0]);
      form.querySelector('#cal-style').innerHTML = permis.map((c) => `<option value="${esc(c)}" ${c === actuel ? 'selected' : ''}>${esc(nomStyle(c))}</option>`).join('');
      form.querySelector('[data-ref="champ-style"]').hidden = permis.length < 2;
    };
    majArticle();
    select.addEventListener('change', majArticle);
    const enregistrer = async (theme, produit, bouton, style = null) => {
      boutonOccupe(bouton, true);
      const { error } = await sb.rpc('changer_jour_plan', { p_boutique: boutique.id, p_jour: date, p_theme: theme, p_produit: produit, p_style: style });
      if (error) { boutonOccupe(bouton, false); const z = form.querySelector('.erreur-form'); z.textContent = messageErreur(error); z.hidden = false; return; }
      fermer();
      toast('Jour mis à jour.', 'succes');
      charger();
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const besoin = select.selectedOptions[0]?.dataset.besoin === 'produit';
      enregistrer(select.value, besoin ? (form.querySelector('#cal-article').value || null) : null, form.querySelector('[type=submit]'), form.querySelector('#cal-style').value || null);
    });
    form.querySelector('[data-action="retirer"]')?.addEventListener('click', (e) => enregistrer(null, null, e.currentTarget));
  }

  /* ---------------- Rythme */

  function ouvrirRythme() {
    const g = s.reglages || {};
    const jours = (g.jours && g.jours.length ? g.jours : [1, 2, 3, 4, 5, 6]).map(Number);
    const reseaux = g.reseaux || [];
    const { el, fermer } = ouvrirModale({
      titre: 'Changer le rythme',
      variante: 'large',
      contenu: `<form class="form-modale" novalidate>
        <fieldset class="ben-jours"><legend class="etiquette">Jours de publication</legend>
          ${JOURS_SEMAINE.map(([n, l]) => `<label class="puce-jour"><input type="checkbox" name="jour" value="${n}" ${jours.includes(n) || (n === 7 && jours.includes(0)) ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        </fieldset>
        <div class="rangee-champs">
          <div class="champ"><label for="ry-heure">Heure de publication automatique</label><input id="ry-heure" class="input" type="time" value="${esc(String(g.heure_auto || '08:00').slice(0, 5))}"></div>
          <div class="champ"><label for="ry-ton">Ton du texte</label><select id="ry-ton" class="input">${TONS.map(([c, l]) => `<option value="${c}" ${c === g.ton ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>
        <fieldset class="ben-jours"><legend class="etiquette">Réseaux de la publication automatique</legend>
          ${['facebook', 'instagram', 'tiktok'].map((r) => `<label class="puce-jour"><input type="checkbox" name="reseau" value="${r}" ${reseaux.includes(r) ? 'checked' : ''}><span>${RESEAUX[r].nom}</span></label>`).join('')}
        </fieldset>
        <div class="champ"><label for="ry-signature">Signature (fin de chaque texte, facultatif)</label><input id="ry-signature" class="input" maxlength="120" value="${esc(g.signature || '')}" placeholder="Ex. Diallo Matériaux, le bon prix à Dubréka"></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer le rythme</button></div>
      </form>`
    });
    const form = el.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const z = form.querySelector('.erreur-form');
      const choisis = [...form.querySelectorAll('[name="jour"]:checked')].map((c) => Number(c.value));
      if (!choisis.length) { z.textContent = 'Choisissez au moins un jour.'; z.hidden = false; return; }
      const bouton = form.querySelector('[type=submit]');
      boutonOccupe(bouton, true);
      const valeurs = {
        p_boutique: boutique.id, p_jours: choisis, p_auto: Boolean(g.auto), p_heure_auto: form.querySelector('#ry-heure').value || '08:00',
        p_reseaux: [...form.querySelectorAll('[name="reseau"]:checked')].map((c) => c.value), p_ton: form.querySelector('#ry-ton').value,
        p_signature: form.querySelector('#ry-signature').value.trim() || null
      };
      const { error } = await sb.rpc('modifier_publication', valeurs);
      if (error) { boutonOccupe(bouton, false); z.textContent = messageErreur(error); z.hidden = false; return; }
      // Le plan à venir suit le nouveau rythme (le passé et les jours fixés ne bougent pas).
      await sb.rpc('generer_plan', { p_boutique: boutique.id, p_mois: s.mois });
      fermer();
      toast('Rythme enregistré.', 'succes');
      charger();
    });
  }

  async function basculerAuto(entree) {
    const g = s.reglages || {};
    entree.disabled = true;
    const reseaux = g.reseaux && g.reseaux.length ? g.reseaux : s.reseaux.filter((x) => x.actif && RESEAUX[x.reseau]?.auto).map((x) => x.reseau);
    const { error } = await sb.rpc('modifier_publication', {
      p_boutique: boutique.id, p_jours: g.jours ?? null, p_auto: entree.checked, p_heure_auto: g.heure_auto ?? '08:00', p_reseaux: reseaux, p_ton: g.ton ?? null, p_signature: g.signature ?? null
    });
    entree.disabled = false;
    if (error) { entree.checked = !entree.checked; toast(messageErreur(error), 'erreur'); return; }
    s.reglages = { ...g, auto: entree.checked, reseaux };
    toast(entree.checked ? 'Publication automatique activée.' : 'Publication automatique arrêtée.', 'succes');
  }

  /* ---------------- Évènements */

  zone.addEventListener('click', async (e) => {
    const jour = e.target.closest('[data-jour]');
    if (jour) { ouvrirJour(jour.dataset.jour); return; }
    const nav = e.target.closest('[data-mois]');
    if (nav) { s.mois = decalerMois(s.mois, Number(nav.dataset.mois)); sous('grille').innerHTML = '<span class="squelette" style="height:420px"></span>'; charger(); return; }
    if (e.target.closest('[data-action="rythme"]')) { ouvrirRythme(); return; }
    const c = e.target.closest('[data-connecter]');
    if (c) { connecterReseau(c.dataset.connecter); return; }
    const d = e.target.closest('[data-deconnecter]');
    if (d && await deconnecterReseau(d.dataset.deconnecter)) charger();
  });
  zone.addEventListener('change', (e) => { if (e.target.matches('[data-action="auto"]')) basculerAuto(e.target); });
  charger();
  return undefined;
}
