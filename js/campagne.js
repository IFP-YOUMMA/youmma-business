/**
 * campagne.js — Nouvelle campagne SMS (maquette Campagne.dc.html), #/messages/campagne.
 *
 * Les comptes par cible et le coût viennent de apercu_campagne (calcul serveur, mêmes
 * exclusions que l'envoi : stop_promo et téléphones invalides). L'envoi met les SMS en
 * file via creer_campagne ; la fonction Edge les envoie (maintenant ou à l'heure prévue).
 */
import { sb } from './supabase.js';
import { etat, peut } from './state.js';
import { naviguer } from './router.js';
import { chargerSoldeSms, ouvrirRecharge, majCreditSmsAffiche, texteCompteur, compterSms, texteSms, SMS_MAX_CARACTERES } from './sms.js';
import {
  esc, icone, toast, confirmer, boutonOccupe, messageErreur, differer, formatNombre, formatDate,
  formatTelephone, chargerParLots, copierTexte, dateISO
} from './utils.js';

export const LIBELLES_CIBLES = {
  tous: 'Tous les clients',
  gros_acheteurs: 'Gros acheteurs',
  chantier: 'Entrepreneurs avec un chantier',
  inactifs: 'Clients inactifs',
  credit: 'Clients qui me doivent',
  manuel: 'Choix à la main'
};

const CIBLES = [
  ['tous', 'Tous les clients avec un téléphone', 'Hors clients « Ne pas envoyer de promotions »'],
  ['gros_acheteurs', 'Gros acheteurs', 'Plus de 5 000 000 GNF d’achats sur 3 mois'],
  ['chantier', 'Entrepreneurs avec un chantier', 'Chantier ouvert ou clôturé'],
  ['inactifs', 'Clients inactifs', 'Aucun achat depuis 30 jours'],
  ['credit', 'Clients qui me doivent', 'Solde de crédit à payer'],
  ['manuel', 'Choisir à la main', 'Cochez les clients dans la liste']
];

/** Modèles prêts : textes sans accents, < 160 caractères avec un nom de boutique moyen. */
const MODELES_CAMPAGNE = [
  { code: 'arrivage', libelle: 'Arrivage', desc: 'Nouveau stock disponible',
    texte: (b) => `Bonjour {prenom}, nouvel arrivage chez ${b} ! Passez vite, stock limite.${tel(b)}` },
  { code: 'promo', libelle: 'Promotion', desc: 'Prix réduit pour quelques jours',
    texte: (b) => `Bonjour {prenom}, promotion chez ${b} jusqu'a samedi : prix reduits sur plusieurs articles. Venez en profiter !${tel(b)}` },
  { code: 'gros', libelle: 'Prix de gros', desc: 'Offre aux entrepreneurs',
    texte: (b) => `Bonjour {prenom}, ${b} vous fait un prix de gros pour vos chantiers. Appelez-nous pour votre devis.${tel(b)}` },
  { code: 'merci', libelle: 'Remerciement', desc: 'Merci pour votre fidélité',
    texte: (b) => `Bonjour {prenom}, toute l'equipe de ${b} vous remercie pour votre fidelite. A tres bientot !` },
  { code: 'fermeture', libelle: 'Fermeture / horaires', desc: 'Fête, inventaire, nouveaux horaires',
    texte: (b) => `Bonjour {prenom}, ${b} sera ferme le ... pour ... Reouverture le ... Merci de votre comprehension.` },
  { code: 'libre', libelle: 'Message libre', desc: 'Écrire votre propre texte', texte: () => '' }
];
function tel() {
  const t = etat.boutique?.telephone;
  return t ? ` Tel ${formatTelephone(t).replace(/^\+224\s*/, '')}` : '';
}

/** Texte pour WhatsApp : {prenom} retiré proprement (« Bonjour {prenom}, » → « Bonjour, »), accents conservés. */
export function texteWhatsAppCampagne(texte) {
  return texte
    .replace(/\s*\{prenom\}\s*([,!.]?)/gi, '$1')
    .replace(/\{nom\}/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*[,!.]\s*/, '')
    .trim();
}

/** Texte d'un modèle prêt pour la boutique : sans accents (comme le SMS reçu). */
const texteModele = (m) => texteSms(m.texte(etat.boutique.nom));

const premiereLigne = (r) => (Array.isArray(r) ? r[0] : r) || {};

export function afficherNouvelleCampagne(conteneur) {
  if (!peut('campagnes.envoyer')) { naviguer('messages', { remplacer: true }); return; }
  const boutique = etat.boutique;
  const s = {
    modele: 'arrivage',
    texte: texteModele(MODELES_CAMPAGNE[0]),
    cible: 'tous',
    comptes: {},            // cible → nb_destinataires
    apercu: null,           // apercu_campagne pour la cible choisie
    solde: null,
    quand: 'maintenant',
    clients: null,          // liste pour le choix manuel
    choisis: new Set(),
    jeton: 0
  };

  conteneur.innerHTML = `
    <div class="page page-campagne">
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour" href="#/messages/campagnes">← Messages</a>
          <h1>Nouvelle campagne</h1>
          <span>Prévenez vos clients d’un arrivage, d’une promo, d’une fermeture…</span>
        </div>
      </header>
      <div class="campagne-corps">
        <div class="campagne-principal">
          <section class="carte campagne-bloc">
            <h2>1. Choisir un modèle</h2>
            <div class="grille-modeles-campagne">
              ${MODELES_CAMPAGNE.map((m) => `
                <button type="button" class="carte-modele-campagne" data-modele="${m.code}" aria-pressed="${m.code === s.modele}">
                  <span class="tres-gras">${esc(m.libelle)}</span><span class="discret">${esc(m.desc)}</span>
                </button>`).join('')}
            </div>
          </section>
          <section class="carte campagne-bloc">
            <h2>2. Le message</h2>
            <label for="texte-campagne" class="sr-only">Texte de la campagne</label>
            <textarea id="texte-campagne" class="input" rows="4" maxlength="${SMS_MAX_CARACTERES + 100}">${esc(s.texte)}</textarea>
            <div class="compteur-sms"><span>{prenom} est remplacé par le prénom de chaque client</span><span data-ref="compteur"></span></div>
          </section>
          <section class="carte campagne-bloc">
            <h2>3. À qui ?</h2>
            <div class="cibles-campagne" role="radiogroup" aria-label="Destinataires">
              ${CIBLES.map(([code, libelle, desc]) => `
                <label class="carte-cible">
                  <input type="radio" name="cible" value="${code}" ${code === s.cible ? 'checked' : ''}>
                  <span class="cible-textes"><span class="tres-gras">${esc(libelle)}</span><span class="discret">${esc(desc)}</span></span>
                  <span class="cible-compte" data-compte="${code}">${code === 'manuel' ? '—' : '…'}</span>
                </label>`).join('')}
            </div>
            <div data-zone="manuel" hidden></div>
          </section>
        </div>
        <aside class="campagne-cote">
          <section class="recap-campagne">
            <h2>Récapitulatif</h2>
            <div class="recap-ligne"><span>Destinataires</span><strong data-ref="nb-dest">…</strong></div>
            <div class="recap-ligne"><span>SMS utilisés</span><strong data-ref="nb-sms">…</strong></div>
            <div class="recap-ligne"><span>Crédit restant après</span><strong data-ref="reste">…</strong></div>
            <div class="choix-quand" role="group" aria-label="Quand">
              <button type="button" data-quand="maintenant" aria-pressed="true">Maintenant</button>
              <button type="button" data-quand="programmer" aria-pressed="false">Programmer…</button>
            </div>
            <div class="programmation" data-zone="programmation" hidden>
              <label class="champ-recap"><span>Date</span><input type="date" class="input" id="date-campagne" min="${dateISO()}" value="${dateISO(1)}"></label>
              <label class="champ-recap"><span>Heure (Conakry)</span><input type="time" class="input" id="heure-campagne" value="09:00"></label>
            </div>
            <p class="alerte-credit" data-zone="credit-insuffisant" hidden>
              Crédit SMS insuffisant. <button type="button" class="btn-lien btn-lien-clair" data-action="recharger">Recharger</button>
            </p>
            <p class="erreur-form erreur-recap" role="alert" hidden></p>
            <button type="button" class="btn-envoyer-campagne" data-action="envoyer" disabled>Envoyer</button>
            <span class="note-recap">Un client qui ne veut plus de promotions : cochez “Ne pas envoyer de promotions” sur sa fiche. Les reçus et relances de crédit restent envoyés.</span>
          </section>
          <section class="carte campagne-bloc">
            <h2 class="h2-petit">Gratuit : par WhatsApp</h2>
            <span class="discret">Copiez le message pour votre statut WhatsApp ou envoyez-le un par un à vos clients, sans utiliser de crédit SMS.</span>
            <a class="btn btn-whatsapp" data-ref="lien-wa" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} Partager sur WhatsApp</a>
            <button type="button" class="btn btn-secondaire" data-action="copier">${icone('copier', 18, 2)} Copier le texte</button>
          </section>
        </aside>
      </div>
    </div>`;

  const q = (sel) => conteneur.querySelector(sel);
  const ref = (nom) => q(`[data-ref="${nom}"]`);
  const champTexte = q('#texte-campagne');
  const zoneErreur = q('.erreur-recap');
  const erreur = (m) => { zoneErreur.textContent = m; zoneErreur.hidden = !m; };

  const clientsManuels = () => (s.cible === 'manuel' ? [...s.choisis] : null);

  function majTexteLocal() {
    const { caracteres, nb } = compterSms(s.texte);
    ref('compteur').textContent = `${texteCompteur(s.texte).replace(/ · .*$/, '')} · ${nb} SMS par client`;
    ref('compteur').classList.toggle('texte-danger', caracteres > SMS_MAX_CARACTERES);
    ref('lien-wa').href = `https://wa.me/?text=${encodeURIComponent(texteWhatsAppCampagne(s.texte))}`;
  }

  function majRecap() {
    const a = s.apercu;
    const solde = a?.solde ?? s.solde;
    const nbDest = a ? Number(a.nb_destinataires) || 0 : null;
    const nbSms = a ? Number(a.nb_sms) || 0 : null;
    ref('nb-dest').textContent = nbDest === null ? '…' : `${formatNombre(nbDest)} client${nbDest > 1 ? 's' : ''}`;
    ref('nb-sms').textContent = nbSms === null ? '…' : formatNombre(nbSms);
    ref('reste').textContent = nbSms === null || solde === null ? '…' : `${formatNombre(Math.max(0, solde - nbSms))} SMS`;
    const insuffisant = nbSms !== null && solde !== null && nbSms > solde;
    q('[data-zone="credit-insuffisant"]').hidden = !insuffisant;
    const trop = compterSms(s.texte).caracteres > SMS_MAX_CARACTERES;
    const bouton = q('[data-action="envoyer"]');
    bouton.disabled = !a || insuffisant || !nbDest || !s.texte.trim() || trop;
    bouton.textContent = nbDest ? `Envoyer à ${formatNombre(nbDest)} client${nbDest > 1 ? 's' : ''}` : 'Envoyer';
  }

  async function apercu(cible, clients = null) {
    const { data, error } = await sb.rpc('apercu_campagne', {
      p_boutique: boutique.id, p_cible: cible, p_texte: s.texte.trim() || '.', p_clients: clients
    });
    if (error) throw error;
    return premiereLigne(data);
  }

  /** Comptes de toutes les cibles (à l'ouverture), en parallèle. */
  async function chargerComptes() {
    const codes = CIBLES.map(([c]) => c).filter((c) => c !== 'manuel');
    const resultats = await Promise.allSettled(codes.map((c) => apercu(c)));
    if (!conteneur.isConnected) return;
    resultats.forEach((r, i) => {
      const code = codes[i];
      const cellule = q(`[data-compte="${code}"]`);
      if (r.status === 'fulfilled') {
        s.comptes[code] = Number(r.value.nb_destinataires) || 0;
        cellule.textContent = formatNombre(s.comptes[code]);
        if (code === s.cible) { s.apercu = r.value; s.solde = r.value.solde ?? s.solde; }
      } else cellule.textContent = '—';
    });
    majRecap();
  }

  /** Recalcul du coût pour la cible choisie (texte modifié, cible ou choix manuel changé). */
  const recalculer = differer(async () => {
    const jeton = ++s.jeton;
    if (s.cible === 'manuel' && !s.choisis.size) { s.apercu = { nb_destinataires: 0, nb_sms: 0, solde: s.solde }; majRecap(); return; }
    try {
      const r = await apercu(s.cible, clientsManuels());
      if (jeton !== s.jeton || !conteneur.isConnected) return;
      s.apercu = r;
      s.solde = r.solde ?? s.solde;
      if (s.cible !== 'manuel') { s.comptes[s.cible] = Number(r.nb_destinataires) || 0; q(`[data-compte="${s.cible}"]`).textContent = formatNombre(s.comptes[s.cible]); }
      else q('[data-compte="manuel"]').textContent = formatNombre(Number(r.nb_destinataires) || 0);
      erreur('');
    } catch (err) {
      if (jeton !== s.jeton) return;
      s.apercu = null;
      erreur(messageErreur(err));
    }
    majRecap();
  }, 400);

  /* ---------- Choix manuel des clients */
  async function monterChoixManuel() {
    const zone = q('[data-zone="manuel"]');
    zone.hidden = false;
    if (!s.clients) {
      zone.innerHTML = '<p class="discret">Chargement des clients…</p>';
      try {
        const lignes = await chargerParLots((d, f) => sb.from('clients').select('id, nom, telephone, stop_promo')
          .eq('boutique_id', boutique.id).not('telephone', 'is', null).order('nom').range(d, f));
        s.clients = lignes.filter((c) => c.telephone);
      } catch (err) {
        zone.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`;
        return;
      }
    }
    zone.innerHTML = `
      <div class="choix-manuel">
        <div class="choix-manuel-entete">
          <label class="recherche-entete">${icone("recherche", 18, 2)}<span class="sr-only">Rechercher un client</span>
            <input type="search" id="recherche-manuel" placeholder="Nom ou téléphone"></label>
          <span class="discret" data-ref="nb-choisis"></span>
        </div>
        <ul class="liste-choix-clients" data-ref="liste-manuel"></ul>
      </div>`;
    renderClientsManuels('');
  }

  function renderClientsManuels(filtre) {
    const f = filtre.trim().toLowerCase();
    const chiffres = f.replace(/\D/g, '');
    const liste = s.clients.filter((c) => !f || c.nom.toLowerCase().includes(f) || (chiffres && c.telephone.includes(chiffres)));
    ref('liste-manuel').innerHTML = liste.length ? liste.slice(0, 200).map((c) => `
      <li><label class="choix-client ${c.stop_promo ? 'exclu' : ''}">
        <input type="checkbox" value="${esc(c.id)}" ${s.choisis.has(c.id) ? 'checked' : ''} ${c.stop_promo ? 'disabled' : ''}>
        <span class="gras">${esc(c.nom)}</span>
        <span class="discret">${esc(formatTelephone(c.telephone))}${c.stop_promo ? ' · ne veut pas de promotions' : ''}</span>
      </label></li>`).join('') : '<li class="discret">Aucun client trouvé.</li>';
    ref('nb-choisis').textContent = `${s.choisis.size} choisi${s.choisis.size > 1 ? 's' : ''}`;
  }

  /* ---------- Envoi */
  function dateProgrammee() {
    if (s.quand !== 'programmer') return null;
    const jour = q('#date-campagne').value;
    const heure = q('#heure-campagne').value;
    if (!jour || !heure) return { erreur: 'Choisissez la date et l’heure d’envoi.' };
    // Conakry = UTC+0 toute l'année (pas d'heure d'été).
    const iso = `${jour}T${heure}:00Z`;
    if (new Date(iso).getTime() < Date.now() + 60000) return { erreur: 'Choisissez une date et une heure dans le futur.' };
    return { iso };
  }

  async function envoyer(bouton) {
    const prog = dateProgrammee();
    if (prog?.erreur) { erreur(prog.erreur); return; }
    const a = s.apercu;
    const nbDest = Number(a?.nb_destinataires) || 0;
    const nbSms = Number(a?.nb_sms) || 0;
    const quand = prog ? `le ${formatDate(prog.iso, 'complet')}` : 'maintenant';
    if (!(await confirmer(`Envoyer ce message à ${formatNombre(nbDest)} client${nbDest > 1 ? 's' : ''} ${quand} ? ${formatNombre(nbSms)} SMS seront utilisés.`,
      { titre: 'Envoyer la campagne', libelleOk: 'Envoyer' }))) return;
    erreur('');
    boutonOccupe(bouton, true, 'Envoi…');
    const modele = MODELES_CAMPAGNE.find((m) => m.code === s.modele);
    const { data, error } = await sb.rpc('creer_campagne', {
      p_boutique: boutique.id,
      p_titre: `${modele && modele.code !== 'libre' ? modele.libelle : 'Message'} · ${formatDate(new Date(), 'court')}`,
      p_texte: s.texte.trim(),
      p_cible: s.cible,
      p_clients: clientsManuels(),
      p_programme_at: prog ? prog.iso : null
    });
    boutonOccupe(bouton, false);
    if (error) { erreur(messageErreur(error)); majRecap(); return; }
    const r = premiereLigne(data);
    toast(prog
      ? `Campagne programmée ${quand} : ${formatNombre(r.nb_destinataires)} client(s), ${formatNombre(r.nb_sms)} SMS.`
      : `Campagne en cours d’envoi : ${formatNombre(r.nb_destinataires)} client(s), ${formatNombre(r.nb_sms)} SMS.`, 'succes', 6000);
    majCreditSmsAffiche();
    naviguer('messages/campagnes');
  }

  /* ---------- Évènements */
  conteneur.addEventListener('click', async (e) => {
    const carteModele = e.target.closest('[data-modele]');
    if (carteModele) {
      const m = MODELES_CAMPAGNE.find((x) => x.code === carteModele.dataset.modele);
      if (s.texte.trim() && s.texte !== texteModele(MODELES_CAMPAGNE.find((x) => x.code === s.modele)) && m.code !== s.modele
        && !(await confirmer('Remplacer le texte que vous avez écrit par ce modèle ?', { titre: 'Changer de modèle', libelleOk: 'Remplacer' }))) return;
      s.modele = m.code;
      conteneur.querySelectorAll('[data-modele]').forEach((b) => b.setAttribute('aria-pressed', String(b === carteModele)));
      s.texte = texteModele(m);
      champTexte.value = s.texte;
      champTexte.focus();
      majTexteLocal();
      recalculer();
      return;
    }
    const quand = e.target.closest('[data-quand]');
    if (quand) {
      s.quand = quand.dataset.quand;
      conteneur.querySelectorAll('[data-quand]').forEach((b) => b.setAttribute('aria-pressed', String(b === quand)));
      q('[data-zone="programmation"]').hidden = s.quand !== 'programmer';
      erreur('');
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'recharger') ouvrirRecharge();
    if (action === 'copier') {
      const ok = await copierTexte(texteWhatsAppCampagne(s.texte));
      toast(ok ? 'Texte copié.' : 'Copie impossible : sélectionnez le texte à la main.', ok ? 'succes' : 'erreur');
    }
    if (action === 'envoyer') envoyer(e.target.closest('button'));
  });

  conteneur.addEventListener('change', (e) => {
    if (e.target.name === 'cible') {
      s.cible = e.target.value;
      s.apercu = null;
      majRecap();
      if (s.cible === 'manuel') monterChoixManuel();
      else q('[data-zone="manuel"]').hidden = true;
      recalculer();
    }
    if (e.target.closest('.liste-choix-clients') && e.target.type === 'checkbox') {
      if (e.target.checked) s.choisis.add(e.target.value); else s.choisis.delete(e.target.value);
      ref('nb-choisis').textContent = `${s.choisis.size} choisi${s.choisis.size > 1 ? 's' : ''}`;
      recalculer();
    }
  });

  conteneur.addEventListener('input', (e) => {
    if (e.target === champTexte) { s.texte = champTexte.value; majTexteLocal(); recalculer(); }
    if (e.target.id === 'recherche-manuel') renderClientsManuels(e.target.value);
  });

  majTexteLocal();
  majRecap();
  chargerSoldeSms().then((solde) => { if (s.solde === null) { s.solde = solde; majRecap(); } }).catch(() => {});
  chargerComptes();
}

