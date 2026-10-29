/**
 * colis/comptes.js — Comptes commerçants (étape 18).
 *
 * Un compte = un numéro d'expéditeur permanent (GN-1042) que la cliente donne à ses fournisseurs de Dakar, d'Abidjan
 * ou de Bamako : ils déposent à l'entrepôt en son nom, elle suit tout sur son relevé public (m/<jeton>).
 *  - liste : table comptes_clients (jamais la colonne jeton) ; recherche : chercher_compte (avec ce qui est à l'entrepôt) ;
 *  - lien du relevé : compte_fiche (seule source du lien, demandé au moment de copier ou d'envoyer) ;
 *  - création : creer_compte_client, qui RENVOIE LE COMPTE EXISTANT si le téléphone est déjà connu (même écrit autrement).
 */
import { sb } from '../supabase.js';
import { etat } from '../state.js';
import { esc, icone, toast, ouvrirModale, boutonOccupe, messageErreur, differer, formatNombre, formatDate, copierTexte } from '../utils.js';
import { api, chargerAgences, formatTel, normaliserTel } from './commun.js';

const kg = (n) => `${formatNombre(n, 2).replace(/,00$/, '')} kg`;

/** Message WhatsApp qui envoie à la cliente son numéro et le lien de son relevé. */
export const messageCompte = (f) => `Bonjour ${f.nom}, votre numéro d’expéditeur chez ${etat.boutique.nom} est ${f.code}. Donnez-le à vos fournisseurs : ils déposent à notre entrepôt en votre nom. Suivez vos cartons ici : ${f.lien}`;

/**
 * Création d'un compte (modale). Si la base renvoie un compte déjà connu pour ce téléphone, on le dit clairement.
 * Appelle surCompte(fiche) avec la fiche complète (compte_fiche).
 */
export async function ouvrirCreationCompte({ nom = '', tel = '', surCompte = () => {} } = {}) {
  const agences = await chargerAgences();
  const arrivees = agences.filter((a) => a.devise === 'GNF');
  const { el, fermer } = ouvrirModale({
    titre: 'Créer un compte commerçant',
    contenu: `<form class="form-modale" novalidate>
      <div class="champ"><label for="cc-nom">Nom</label><input id="cc-nom" class="input" maxlength="80" value="${esc(nom)}" required></div>
      <div class="rangee-champs">
        <div class="champ"><label for="cc-tel">Téléphone</label><input id="cc-tel" class="input" type="tel" inputmode="tel" maxlength="20" value="${esc(tel)}" placeholder="622 00 00 04" required></div>
        <div class="champ"><label for="cc-tel2">Second téléphone (facultatif)</label><input id="cc-tel2" class="input" type="tel" inputmode="tel" maxlength="20"></div>
      </div>
      <div class="rangee-champs">
        <div class="champ"><label for="cc-ville">Ville</label><input id="cc-ville" class="input" maxlength="60" placeholder="Conakry"></div>
        <div class="champ"><label for="cc-agence">Bureau de retrait</label><select id="cc-agence" class="input">${(arrivees.length ? arrivees : agences).map((a) => `<option value="${a.id}">${esc(a.nom || a.ville)}</option>`).join('')}</select></div>
      </div>
      <p class="discret">Un SMS part tout de suite avec son numéro d’expéditeur et le lien de son relevé.</p>
      <p class="erreur-form" role="alert" hidden></p>
      <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Créer le compte</button></div>
    </form>`
  });
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const z = el.querySelector('.erreur-form');
    const v = (sel) => el.querySelector(sel).value.trim();
    const telN = normaliserTel(v('#cc-tel'));
    const tel2 = v('#cc-tel2') ? normaliserTel(v('#cc-tel2')) : null;
    if (!v('#cc-nom')) { z.textContent = 'Indiquez le nom.'; z.hidden = false; return; }
    if (!telN) { z.textContent = 'Téléphone : numéro guinéen (6…) ou sénégalais (77…) attendu.'; z.hidden = false; return; }
    if (v('#cc-tel2') && !tel2) { z.textContent = 'Second téléphone invalide.'; z.hidden = false; return; }
    const bouton = el.querySelector('[type=submit]');
    boutonOccupe(bouton, true);
    try {
      const avant = Date.now();
      const r = await api.creerCompte({ nom: v('#cc-nom'), tel: telN, ville: v('#cc-ville') || null, agence: el.querySelector('#cc-agence').value || null, tel2 });
      const fiche = await api.compteFiche(r.id);
      fermer();
      // Compte plus ancien que l'appel : la base a reconnu le téléphone et rendu le compte existant.
      if (new Date(fiche.created_at).getTime() < avant - 60000) {
        ouvrirModale({
          titre: 'Ce téléphone a déjà un compte',
          contenu: `<p class="texte-modale">Ce téléphone a déjà le numéro <strong>${esc(fiche.code)}</strong> (${esc(fiche.nom)}, client depuis ${esc(formatDate(fiche.created_at, 'moisAnnee'))}). Aucun second compte n’a été créé.</p>
            <div class="modale-actions"><button type="button" class="btn btn-primaire" data-fermer>Utiliser ce compte</button></div>`
        });
      } else toast(`Compte ${fiche.code} créé. Le SMS est parti.`, 'succes', 6000);
      surCompte(fiche);
    } catch (err) { boutonOccupe(bouton, false); z.textContent = messageErreur(err); z.hidden = false; }
  });
}

/** Panneau « Mes comptes clients » (Réglages, et page #/comptes). */
export function monterComptesClients(zone, { titre = 'Comptes clients' } = {}) {
  const s = { liste: [], recherche: '', jeton: 0, trouves: null };
  zone.innerHTML = `
    <div class="col-carte-entete"><h2>${esc(titre)}</h2><button type="button" class="btn btn-secondaire btn-petit" data-action="creer-compte">+ Créer un compte</button></div>
    <p class="discret">Chaque client a un numéro d’expéditeur permanent. Envoyez-lui le lien de son relevé : il voit ses cartons dès qu’ils arrivent à l’entrepôt.</p>
    <label class="col-recherche"><span class="sr-only">Rechercher un compte</span>${icone('recherche', 17, 2)}
      <input type="search" data-ref="recherche-compte" placeholder="Numéro, nom ou téléphone…" autocomplete="off"></label>
    <div data-zone="liste-comptes"><span class="squelette" style="height:120px"></span></div>`;
  const liste = zone.querySelector('[data-zone="liste-comptes"]');

  function ligne(c, entrepot) {
    return `<li class="col-compte-ligne" data-compte="${esc(c.id)}">
      <span class="col-compte-code">${esc(c.code)}</span>
      <span class="col-compte-textes"><strong>${esc(c.nom)}</strong><span>${esc([c.ville, formatTel(c.telephone, { indicatif: true })].filter(Boolean).join(' · '))}</span>
        ${entrepot ? `<span class="col-compte-stock">${entrepot.entrepot ? `${formatNombre(entrepot.entrepot)} carton${entrepot.entrepot > 1 ? 's' : ''} à l’entrepôt · ${esc(kg(entrepot.kg))} taxables` : 'Rien à l’entrepôt'}</span>` : ''}</span>
      <span class="col-compte-actions">
        <button type="button" class="btn btn-secondaire btn-petit" data-copier-compte="${esc(c.id)}">${icone('copier', 15, 2)} Lien du relevé</button>
        <button type="button" class="btn btn-whatsapp btn-petit" data-whatsapp-compte="${esc(c.id)}">${icone('whatsapp', 15, 2)} Envoyer</button>
      </span></li>`;
  }

  function render() {
    if (s.trouves) {
      liste.innerHTML = s.trouves.length ? `<ul class="col-comptes">${s.trouves.map((c) => ligne(c, c)).join('')}</ul>`
        : `<p class="col-vide">Aucun compte ne correspond à « ${esc(s.recherche)} ».</p>`;
      return;
    }
    liste.innerHTML = s.liste.length ? `<ul class="col-comptes">${s.liste.map((c) => ligne(c, null)).join('')}</ul>`
      : '<p class="col-vide">Aucun compte pour l’instant. Créez-en un à la première réception de marchandise.</p>';
  }

  async function charger() {
    const { data, error } = await sb.from('comptes_clients').select('id, code, nom, telephone, ville, created_at')
      .eq('boutique_id', etat.boutique.id).eq('actif', true).order('created_at', { ascending: false }).limit(200);
    if (!zone.isConnected) return;
    if (error) { liste.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(error))}</p>`; return; }
    s.liste = data;
    render();
  }

  const chercher = differer(async () => {
    const jeton = ++s.jeton;
    if (!s.recherche) { s.trouves = null; render(); return; }
    try {
      const r = await api.chercherCompte(s.recherche);
      if (jeton === s.jeton) { s.trouves = r; render(); }
    } catch (err) { if (jeton === s.jeton) liste.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`; }
  }, 300);

  zone.addEventListener('input', (e) => { if (e.target.dataset.ref === 'recherche-compte') { s.recherche = e.target.value.trim(); chercher(); } });
  zone.addEventListener('click', async (e) => {
    if (e.target.closest('[data-action="creer-compte"]')) ouvrirCreationCompte({ surCompte: () => charger() });
    const copier = e.target.closest('[data-copier-compte]');
    if (copier) {
      try { const f = await api.compteFiche(copier.dataset.copierCompte); toast(await copierTexte(f.lien) ? `Lien du relevé de ${f.code} copié.` : 'Copie impossible.', 'succes'); }
      catch (err) { toast(messageErreur(err), 'erreur'); }
    }
    const wa = e.target.closest('[data-whatsapp-compte]');
    if (wa) {
      // Fenêtre ouverte pendant le clic (sinon bloquée), remplie quand la fiche arrive.
      const fenetre = window.open('', '_blank');
      if (fenetre) fenetre.opener = null;
      try {
        const f = await api.compteFiche(wa.dataset.whatsappCompte);
        const url = `https://wa.me/${String(f.telephone || '').replace(/\D/g, '')}?text=${encodeURIComponent(messageCompte(f))}`;
        if (fenetre) fenetre.location = url; else window.open(url, '_blank', 'noopener');
      } catch (err) { fenetre?.close(); toast(messageErreur(err), 'erreur'); }
    }
  });
  charger();
}

/** Page #/comptes. */
export function afficherComptes(conteneur) {
  conteneur.innerHTML = `<div class="page page-comptes"><header class="page-entete"><div class="page-titres"><h1>Comptes clients</h1><span>Numéros d’expéditeur et relevés des commerçants.</span></div></header>
    <section class="carte col-reglage" data-zone="comptes"></section></div>`;
  monterComptesClients(conteneur.querySelector('[data-zone="comptes"]'), { titre: 'Tous les comptes' });
}
