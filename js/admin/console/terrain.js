/**
 * admin/console/terrain.js — Créer un vendeur sur le terrain (étape 19, maquette TerrainVendeur), #/terrain?espace=.
 *
 * L'écran de la tournée, sur téléphone, à une main. console_creer_boutique(p_nom, p_activite, p_ville, p_telephone,
 * p_proprietaire, p_espace, p_commission, p_mois_offerts) dans un des espaces de console_accueil() :
 *  - commission : la commission est obligatoire, c'est la base qui la réclame (COMMISSION_REQUISE) ; puis
 *    ouvrir_vendeur(boutique) lui donne la vitrine et l'affiche, sans date de fin ;
 *  - licence : mois offerts au lieu de la commission.
 * Ensuite : son lien et son QR (js/qr.js), « Lui envoyer » sur WhatsApp, « Imprimer le QR », et les quatre choses à
 * faire avant de quitter sa boutique. Le lien vient du slug lu dans console_fiche_boutique, jamais fabriqué ici.
 */
import { esc, icone, boutonOccupe, toast, formatDate } from '../../utils.js';
import { svgQr } from '../../qr.js';
import { rpc, chargerActivites, lienWa, urlVitrine } from '../commun.js';
import { espaces, espace, erreurConsole, telInternational } from './commun.js';

export function afficherTerrain(conteneur, { params }) {
  const choisi = espace(params.get('espace')) || espaces()[0];
  const commission = choisi.facturation === 'commission';
  conteneur.innerHTML = `
    <div class="cs-page cs-terrain" style="--cs-couleur:${esc(choisi.couleur)}">
      <header class="cs-terrain-tete">
        <a class="cs-retour" href="#/accueil" aria-label="Retour">${icone('retour', 20, 2)}</a>
        <div><h1>${commission ? 'Nouveau vendeur' : 'Nouvelle boutique'}</h1><span>${esc(choisi.nom_public)} · tournée du ${esc(formatDate(new Date(), 'court'))}</span></div>
        <span class="cs-badge-entete">3 min</span>
      </header>
      ${espaces().length > 1 ? `<div class="cs-puces cs-terrain-espaces" role="group" aria-label="Espace">${espaces().map((e) => `<a class="cs-puce ${e.code === choisi.code ? 'actif' : ''}" href="#/terrain?espace=${encodeURIComponent(e.code)}" aria-pressed="${e.code === choisi.code}">${esc(e.nom_public)}</a>`).join('')}</div>` : ''}
      <p class="cs-promesse">${commission
        ? 'Ce que vous lui promettez : <strong>sa boutique en ligne et son affiche, sans date de fin</strong>, une affiche de ses articles chaque jour, et des acheteurs de Conakry qui paient d’avance. Elle ne paie rien : vous gagnez quand elle vend.'
        : 'Ce que vous lui promettez : l’application de caisse, sa boutique en ligne et ses affiches. Elle paie une licence après ses mois offerts.'}</p>
      <form class="carte cs-terrain-form" novalidate>
        <div class="champ"><label for="tv-nom">Nom de la boutique</label><input id="tv-nom" class="input" type="text" maxlength="80" required placeholder="Marché HLM — Fatou Ndiaye"></div>
        <div class="rangee-champs">
          <div class="champ"><label for="tv-tel">Téléphone</label><input id="tv-tel" class="input" type="tel" inputmode="tel" required placeholder="${commission ? '+221 77 123 45 67' : '620 00 00 00'}"></div>
          <div class="champ"><label for="tv-ville">Ville</label><input id="tv-ville" class="input" type="text" maxlength="60" required placeholder="${commission ? 'Dakar' : 'Conakry'}"></div>
        </div>
        <div class="champ"><label for="tv-proprio">Nom du ou de la propriétaire</label><input id="tv-proprio" class="input" type="text" maxlength="80" required placeholder="Fatou Ndiaye"></div>
        <div class="champ"><label for="tv-activite">Ce qu’elle vend</label><select id="tv-activite" class="input" required><option value="">Choisir…</option></select></div>
        ${commission ? `
          <div class="rangee-champs">
            <div class="champ"><label for="tv-commission">Commission (obligatoire)</label>
              <div class="cs-champ-unite"><input id="tv-commission" class="input" type="text" inputmode="decimal" placeholder="8"><span>%</span></div></div>
            <div class="champ"><label for="tv-delai">Prépare en</label>
              <div class="cs-champ-unite"><input id="tv-delai" class="input" type="text" inputmode="numeric" value="2"><span>jours</span></div></div>
          </div>
          <small class="aide">La commission est prise sur ce que YOUMMA lui reverse. Elle affiche son prix, elle touche son prix moins la commission ; l’acheteur paie le prix affiché.</small>`
        : `
          <div class="champ"><label for="tv-mois">Mois offerts</label><select id="tv-mois" class="input">
            <option value="0">Aucun</option><option value="1" selected>1 mois</option><option value="2">2 mois</option><option value="3">3 mois</option></select></div>`}
        <p class="erreur-form" role="alert" hidden></p>
        <button type="submit" class="btn btn-primaire btn-bloc btn-grand">${commission ? 'Créer le vendeur' : 'Créer la boutique'}</button>
      </form>
      <div data-zone="pret"></div>
    </div>`;

  const q = (s) => conteneur.querySelector(s);
  chargerActivites().then((a) => {
    q('#tv-activite').insertAdjacentHTML('beforeend', (a || []).map((x) => `<option value="${esc(x.code)}">${esc(x.emoji ? `${x.emoji} ` : '')}${esc(x.nom)}</option>`).join(''));
  }).catch(() => {});

  const erreur = (m) => { const z = q('.erreur-form'); z.textContent = m; z.hidden = !m; };
  q('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erreur('');
    const nom = q('#tv-nom').value.trim();
    const tel = telInternational(q('#tv-tel').value);
    const ville = q('#tv-ville').value.trim();
    const proprietaire = q('#tv-proprio').value.trim();
    const activite = q('#tv-activite').value;
    if (!nom || !ville || !proprietaire || !activite) { erreur('Remplissez le nom, la ville, la propriétaire et ce qu’elle vend.'); return; }
    if (!tel) { erreur('Numéro invalide. Un numéro étranger commence par son indicatif (+221, +225…).'); return; }
    // La commission est envoyée telle que saisie, vide comprise : c'est la base qui refuse un vendeur sans commission.
    const saisie = commission ? q('#tv-commission').value.trim().replace(',', '.') : '';
    const taux = saisie === '' ? null : Number(saisie);
    if (commission && saisie !== '' && !(taux > 0 && taux < 100)) { erreur('Commission invalide : un pourcentage entre 0 et 100.'); return; }
    const delai = commission ? Number(q('#tv-delai').value.trim()) : null;
    if (commission && !(Number.isInteger(delai) && delai >= 0 && delai <= 60)) { erreur('« Prépare en » : un nombre de jours entre 0 et 60.'); return; }
    const bouton = q('[type=submit]');
    boutonOccupe(bouton, true, 'Création…');
    try {
      const r = await rpc('console_creer_boutique', {
        p_nom: nom, p_activite: activite, p_ville: ville, p_telephone: tel, p_proprietaire: proprietaire,
        p_espace: choisi.code, p_commission: commission ? taux : null, p_mois_offerts: commission ? null : Number(q('#tv-mois').value),
        ...(commission ? { p_delai_jours: delai } : {})
      });
      let vendeur = null;
      if (commission) {
        try { vendeur = await rpc('ouvrir_vendeur', { p_boutique: r.id }); } catch (err) { toast(`Vendeur créé, mais vitrine non ouverte : ${erreurConsole(err)}`, 'erreur', 8000); }
      }
      const fiche = await rpc('console_fiche_boutique', { p_boutique: r.id }).catch(() => null);
      boutonOccupe(bouton, false);
      q('form').hidden = true;
      afficherPret({
        id: r.id, nom: r.nom || nom, proprietaire, tel: r.telephone || tel, slug: fiche?.slug || null, commission,
        ouvert: commission ? Boolean(vendeur?.ok) : true, lienVendeur: vendeur?.lien_vendeur || null,
        invitation: r.invitation || null, avertissement: r.avertissement || '', enAttente: Boolean(r.proprietaire_en_attente)
      });
    } catch (err) {
      boutonOccupe(bouton, false);
      erreur(erreurConsole(err));
    }
  });

  function afficherPret(b) {
    const lien = b.slug ? urlVitrine(b.slug) : null;
    const court = b.slug ? new URL(`../b/${encodeURIComponent(b.slug)}`, location.href.split('#')[0]).href.replace(/^https?:\/\//, '') : '';
    const inv = b.invitation;
    // Le message WhatsApp ne reprend que ce que la base a renvoyé : code d'invitation, lien vendeur, adresse publique.
    const message = [
      `Bonjour ${b.proprietaire}, votre boutique « ${b.nom} » est prête.`,
      inv?.code ? `Ouvrez l’application YOUMMA Business avec votre numéro et ce code : ${inv.code}${inv.expire_at ? ` (valable jusqu’au ${formatDate(inv.expire_at, 'court')})` : ''}.` : '',
      b.lienVendeur ? `Votre lien vendeur : ${b.lienVendeur}` : '',
      lien ? `Votre boutique en ligne : ${lien}` : ''
    ].filter(Boolean).join('\n');
    const envoyer = `<a class="btn cs-btn-clair" href="${esc(lienWa(b.tel, message))}" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} Lui envoyer</a>`;
    q('[data-zone="pret"]').innerHTML = `
      <section class="cs-pret">
        <span class="etiquette-carte">${esc(b.nom)} est ${b.commission ? 'créé' : 'créée'}${b.commission ? (b.ouvert ? ' · vitrine et affiche ouvertes, sans date de fin' : '') : ''}</span>
        ${inv?.code ? `<div class="cs-invitation"><span>Son code pour ouvrir l’application</span><strong data-ref="code">${esc(inv.code)}</strong>${inv.expire_at ? `<small>valable jusqu’au ${esc(formatDate(inv.expire_at, 'court'))}</small>` : ''}</div>` : ''}
        ${b.enAttente && b.avertissement ? `<p class="cs-pret-avertissement">${icone('alerte', 16, 2)} ${esc(b.avertissement)}</p>` : ''}
        ${b.lienVendeur ? `<p class="cs-pret-vendeur">Son lien vendeur, <strong>pour lui seul</strong> : <a href="${esc(b.lienVendeur)}" target="_blank" rel="noopener">${esc(b.lienVendeur.replace(/^https?:\/\//, ''))}</a></p>` : ''}
        ${lien ? `
          <div class="cs-pret-qr">
            <div class="cs-qr" data-ref="qr">${svgQr(lien, { couleur: '#0A3D33', titre: `QR de ${b.nom}`, marge: 2 })}</div>
            <div><a class="cs-pret-lien" href="${esc(lien)}" target="_blank" rel="noopener">${esc(court)}</a>
              <p>Elle colle le QR sur sa boutique. Le client scanne, voit tous ses articles, et commande.</p></div>
          </div>
          <div class="cs-pret-actions">
            ${envoyer}
            <button type="button" class="btn cs-btn-clair" data-action="imprimer">${icone('imprimante', 18, 2)} Imprimer le QR</button>
          </div>`
        : `<p>Sa boutique n’a pas encore d’adresse publique : le QR à coller apparaîtra sur sa fiche dès que la base la lui aura donnée.</p>
          <div class="cs-pret-actions">${envoyer}</div>`}
        <a class="cs-pret-fiche" href="#/fiche/${encodeURIComponent(b.id)}">Ouvrir sa fiche ›</a>
      </section>
      <section class="carte cs-photos">${icone('photo', 20, 2)}<p><strong>Photographiez 5 ou 6 articles avec elle, maintenant.</strong> Une boutique vide ne vend rien, et elle n’y reviendra pas seule.</p></section>
      <section class="carte cs-avant-partir">
        <h2>Avant de quitter sa boutique</h2>
        <ol>
          <li><span class="cs-num vert">1</span><span><strong>Installer l’application sur son téléphone</strong><small>Elle doit la voir marcher devant vous, une fois.</small></span></li>
          <li><span class="cs-num or">2</span><span><strong>Publier sa première affiche avec lui, sur son statut WhatsApp</strong><small>C’est le geste qu’il refera seul, ou pas du tout.</small></span></li>
          <li><span class="cs-num">3</span><span><strong>${b.commission ? 'Lui montrer une commande de Conakry' : 'Faire sa première vente en caisse avec elle'}</strong><small>${b.commission ? 'Même une fausse : qu’elle voie à quoi ressemble l’argent qui arrive.' : 'Qu’elle voie le reçu partir sur WhatsApp.'}</small></span></li>
          <li><span class="cs-num">4</span><span><strong>${b.commission ? 'Noter son jour de préparation' : 'Noter le jour de son paiement'}</strong><small>${b.commission ? 'Pour que le bureau sache quand passer prendre les colis.' : 'Pour l’appeler avant la fin de ses mois offerts.'}</small></span></li>
        </ol>
        <a class="btn btn-secondaire btn-bloc" href="#/terrain?espace=${encodeURIComponent(choisi.code)}" data-action="encore">${icone('plus', 18, 2)} ${b.commission ? 'Créer un autre vendeur' : 'Créer une autre boutique'}</a>
      </section>`;
    q('[data-zone="pret"]').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  conteneur.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-action="encore"]')) {
      // Même adresse : pas de hashchange, on remonte l'écran dans un conteneur neuf (sans les écouteurs de celui-ci).
      ev.preventDefault();
      const neuf = conteneur.cloneNode(false);
      conteneur.replaceWith(neuf);
      window.scrollTo(0, 0);
      afficherTerrain(neuf, { params });
      return;
    }
    if (!ev.target.closest('[data-action="imprimer"]')) return;
    // Impression : une copie du QR sous <body>, seule visible à l'impression (même principe que les étiquettes de colis).
    document.querySelector('#zone-qr-terrain')?.remove();
    const zone = document.createElement('div');
    zone.id = 'zone-qr-terrain';
    zone.innerHTML = `${q('[data-ref="qr"]').innerHTML}<strong>${esc(q('.cs-pret .etiquette-carte').textContent.split(' est créé')[0])}</strong><span>${esc(q('.cs-pret-lien').textContent)}</span><em>Scannez pour voir ses articles et commander</em>`;
    document.body.appendChild(zone);
    document.body.classList.add('impression-qr-terrain');
    const fin = () => { document.body.classList.remove('impression-qr-terrain'); zone.remove(); window.removeEventListener('afterprint', fin); };
    window.addEventListener('afterprint', fin);
    window.print();
  });
  return () => { document.body.classList.remove('impression-qr-terrain'); document.querySelector('#zone-qr-terrain')?.remove(); };
}
