/**
 * fournisseurs.js — Onglet « Fournisseurs » du centre de messages :
 * liste des fournisseurs (ajout, modification, désactivation), bons de commande
 * (pré-remplis avec le stock bas du fournisseur), suivi « reçue / annulée ».
 *
 * Fournisseurs : écriture directe par le gérant. Bons de commande : RPC
 * creer_commande_fournisseur et statut_commande_fournisseur.
 */
import { sb } from './supabase.js';
import { etat } from './state.js';
import {
  esc, icone, toast, confirmer, ouvrirModale, boutonOccupe, messageErreur, normaliserTelephone, formatTelephone,
  formatDate, formatQuantite, formatNombre, lireNombre, uniteDivisible, copierTexte
} from './utils.js';

const STATUTS_COMMANDE = { envoyee: 'Envoyée', recue: 'Reçue', annulee: 'Annulée' };

function normaliserTexte(texte) {
  return String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Quantité suggérée pour un article en stock bas : 2 × seuil − stock, arrondie, au moins 1. */
function quantiteSuggeree(p) {
  return Math.max(1, Math.round(2 * (Number(p.seuil_alerte) || 0) - (Number(p.stock) || 0)));
}

function estStockBas(p) {
  return !p.sur_commande && Number(p.stock) <= Number(p.seuil_alerte);
}

/** Lien WhatsApp vers le fournisseur (ou sans numéro : choix du contact dans WhatsApp). */
function lienWhatsApp(telephone, texte) {
  const numero = telephone ? normaliserTelephone(telephone) || '' : '';
  return `https://wa.me/${numero}?text=${encodeURIComponent(texte)}`;
}

/** Monte l'onglet Fournisseurs dans `zone`. */
export function monterFournisseurs(zone) {
  const boutique = etat.boutique;
  const s = { fournisseurs: [], produits: [], commandes: [], voirInactifs: false };

  zone.innerHTML = `
    <div class="onglet-fournisseurs">
      <section class="carte section-parametres">
        <div class="bloc-entete">
          <h2>Fournisseurs</h2>
          <div class="actions-chantier">
            <button type="button" class="btn btn-secondaire" data-action="ajouter-fournisseur">${icone('plus', 18, 2.2)} Ajouter un fournisseur</button>
            <button type="button" class="btn btn-primaire" data-action="nouveau-bon">${icone('document', 18, 2)} Nouveau bon de commande</button>
          </div>
        </div>
        <label class="case-option"><input type="checkbox" data-action="voir-inactifs"> Afficher les fournisseurs désactivés</label>
        <ul class="liste-fournisseurs" data-zone="fournisseurs"><li class="discret">Chargement…</li></ul>
      </section>
      <section class="carte section-parametres">
        <h2>Bons de commande</h2>
        <ul class="liste-commandes" data-zone="commandes"><li class="discret">Chargement…</li></ul>
      </section>
    </div>`;
  const sous = (nom) => zone.querySelector(`[data-zone="${nom}"]`);

  /* ---------------- Rendu */

  function renderFournisseurs() {
    const liste = s.fournisseurs.filter((f) => s.voirInactifs || f.actif);
    sous('fournisseurs').innerHTML = liste.length ? liste.map((f) => {
      const nbArticles = s.produits.filter((p) => p.fournisseur_id === f.id).length;
      const nbBas = s.produits.filter((p) => p.fournisseur_id === f.id && estStockBas(p)).length;
      const derniere = s.commandes.find((c) => c.fournisseur_id === f.id);
      return `
        <li class="fournisseur ${f.actif ? '' : 'inactif'}">
          <span class="fournisseur-textes">
            <span class="gras">${esc(f.nom)}${f.actif ? '' : ' <span class="tag-annulee">Désactivé</span>'}</span>
            <span class="discret">${esc(f.telephone ? formatTelephone(f.telephone) : 'Sans téléphone')} · ${nbArticles} article${nbArticles > 1 ? 's' : ''}${nbBas ? ` · <span class="texte-danger">${nbBas} en stock bas</span>` : ''}</span>
            <span class="discret">${derniere ? `Dernière commande : ${esc(derniere.numero)} le ${esc(formatDate(derniere.created_at, 'court'))}` : 'Aucune commande'}</span>
          </span>
          <span class="fournisseur-actions">
            ${f.actif ? `<button type="button" class="btn btn-primaire btn-petit" data-bon="${esc(f.id)}">Bon de commande</button>` : ''}
            <button type="button" class="btn btn-secondaire btn-petit" data-modifier="${esc(f.id)}">Modifier</button>
            <button type="button" class="btn-lien ${f.actif ? 'btn-lien-danger' : ''}" data-activer="${esc(f.id)}">${f.actif ? 'Désactiver' : 'Réactiver'}</button>
          </span>
        </li>`;
    }).join('') : `<li class="etat-vide"><p>Aucun fournisseur. Ajoutez vos fournisseurs pour leur envoyer des bons de commande en un clic.</p></li>`;
  }

  function resumeLignes(lignes) {
    const liste = Array.isArray(lignes) ? lignes : [];
    const textes = liste.map((l) => `${l.nom} ×${formatNombre(l.quantite, 3)}`);
    return textes.slice(0, 3).join(', ') + (textes.length > 3 ? ` +${textes.length - 3}` : '');
  }

  function renderCommandes() {
    const noms = new Map(s.fournisseurs.map((f) => [f.id, f.nom]));
    sous('commandes').innerHTML = s.commandes.length ? s.commandes.map((c) => `
      <li class="commande">
        <span class="commande-textes">
          <span class="gras">${esc(c.numero)} · ${esc(noms.get(c.fournisseur_id) || 'Fournisseur')}</span>
          <span class="discret">${esc(formatDate(c.created_at, 'court'))} · ${esc(resumeLignes(c.lignes))}</span>
          ${c.note ? `<span class="discret">${esc(c.note)}</span>` : ''}
        </span>
        <span class="badge-commande ${c.statut}">${esc(STATUTS_COMMANDE[c.statut] || c.statut)}${c.statut === 'recue' && c.recue_at ? ' le ' + esc(formatDate(c.recue_at, 'jourMois')) : ''}</span>
        ${c.statut === 'envoyee' ? `
          <span class="fournisseur-actions">
            <button type="button" class="btn btn-secondaire btn-petit" data-statut="recue" data-commande="${esc(c.id)}">Marquer reçue</button>
            <button type="button" class="btn-lien btn-lien-danger" data-statut="annulee" data-commande="${esc(c.id)}">Annuler</button>
          </span>` : ''}
      </li>`).join('') : '<li class="etat-vide"><p>Aucun bon de commande pour l’instant.</p></li>';
  }

  /* ---------------- Données */

  async function charger() {
    const [fournisseursRes, produitsRes, commandesRes] = await Promise.all([
      sb.from('fournisseurs').select('id, nom, telephone, notes, actif').eq('boutique_id', boutique.id).order('nom'),
      sb.from('produits').select('id, nom, unite, stock, seuil_alerte, sur_commande, fournisseur_id').eq('boutique_id', boutique.id).eq('actif', true).order('nom'),
      sb.from('commandes_fournisseur').select('id, numero, fournisseur_id, lignes, note, statut, created_at, recue_at')
        .eq('boutique_id', boutique.id).order('created_at', { ascending: false }).limit(50)
    ]);
    const erreur = fournisseursRes.error || produitsRes.error || commandesRes.error;
    if (!zone.isConnected) return;
    if (erreur) {
      sous('fournisseurs').innerHTML = `<li class="bloc-erreur">${esc(messageErreur(erreur))}</li>`;
      sous('commandes').innerHTML = '';
      return;
    }
    s.fournisseurs = fournisseursRes.data;
    s.produits = produitsRes.data;
    s.commandes = commandesRes.data;
    renderFournisseurs();
    renderCommandes();
  }

  /* ---------------- Fournisseur : ajout / modification / activation */

  function ouvrirFormulaire(fournisseur = null) {
    const { el, fermer } = ouvrirModale({
      titre: fournisseur ? 'Modifier le fournisseur' : 'Ajouter un fournisseur',
      contenu: `
        <form class="form-modale" novalidate>
          <div class="champ"><label for="four-nom">Nom</label><input id="four-nom" name="nom" class="input" type="text" maxlength="80" required value="${esc(fournisseur?.nom || '')}" placeholder="Ex. CIMAF Guinée"></div>
          <div class="champ"><label for="four-tel">Téléphone (facultatif)</label><input id="four-tel" name="telephone" class="input" type="tel" inputmode="tel" value="${esc(fournisseur?.telephone ? formatTelephone(fournisseur.telephone) : '')}" placeholder="6XX XX XX XX"></div>
          <div class="champ"><label for="four-notes">Notes (facultatif)</label><textarea id="four-notes" name="notes" class="input" rows="3" maxlength="300">${esc(fournisseur?.notes || '')}</textarea></div>
          <p class="erreur-form" role="alert" hidden></p>
          <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">Enregistrer</button></div>
        </form>`
    });
    const formulaire = el.querySelector('form');
    formulaire.addEventListener('submit', async (e) => {
      e.preventDefault();
      const zoneErreur = formulaire.querySelector('.erreur-form');
      const erreur = (m) => { zoneErreur.textContent = m; zoneErreur.hidden = false; };
      const nom = formulaire.nom.value.trim();
      const saisieTel = formulaire.telephone.value.trim();
      const telephone = saisieTel ? normaliserTelephone(saisieTel) : null;
      if (nom.length < 2) return erreur('Indiquez le nom du fournisseur.');
      if (saisieTel && !telephone) return erreur('Numéro invalide. Exemple : 620 00 00 00.');
      const bouton = formulaire.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      const donnees = { nom, telephone, notes: formulaire.notes.value.trim() || null };
      const requete = fournisseur
        ? sb.from('fournisseurs').update(donnees).eq('id', fournisseur.id)
        : sb.from('fournisseurs').insert({ ...donnees, boutique_id: boutique.id, actif: true });
      const { error } = await requete;
      if (error) { boutonOccupe(bouton, false); erreur(messageErreur(error)); return; }
      fermer();
      toast(fournisseur ? 'Fournisseur mis à jour.' : `Fournisseur « ${nom} » ajouté.`, 'succes');
      charger();
    });
  }

  async function basculerActif(fournisseur) {
    if (fournisseur.actif && !(await confirmer(`« ${fournisseur.nom} » ne sera plus proposé pour les bons de commande. Ses anciennes commandes restent visibles.`, { titre: 'Désactiver le fournisseur', libelleOk: 'Désactiver', danger: true }))) return;
    const { error } = await sb.from('fournisseurs').update({ actif: !fournisseur.actif }).eq('id', fournisseur.id);
    if (error) { toast(messageErreur(error), 'erreur'); return; }
    toast(fournisseur.actif ? 'Fournisseur désactivé.' : 'Fournisseur réactivé.', 'succes');
    charger();
  }

  /* ---------------- Bon de commande */

  function ouvrirBon(idFournisseur = null) {
    const actifs = s.fournisseurs.filter((f) => f.actif);
    if (!actifs.length) { toast('Ajoutez d’abord un fournisseur.', 'info'); ouvrirFormulaire(); return; }
    const etatBon = { fournisseur: actifs.find((f) => f.id === idFournisseur) || null, lignes: new Map(), recherche: '' };
    const { el, fermer } = ouvrirModale({ titre: 'Nouveau bon de commande', variante: 'large', contenu: '<div data-zone="bon"></div>' });
    const cadre = el.querySelector('[data-zone="bon"]');

    /** Pré-remplissage : articles du fournisseur en stock bas, cochés avec la quantité suggérée. */
    function preremplir() {
      etatBon.lignes = new Map();
      s.produits.filter((p) => p.fournisseur_id === etatBon.fournisseur?.id && estStockBas(p))
        .forEach((p) => etatBon.lignes.set(p.id, { coche: true, quantite: quantiteSuggeree(p) }));
    }

    function ligneHTML(p) {
      const l = etatBon.lignes.get(p.id);
      return `
        <li class="ligne-bon ${l?.coche ? 'choisi' : ''}">
          <label class="ligne-bon-choix">
            <input type="checkbox" data-cocher="${esc(p.id)}" ${l?.coche ? 'checked' : ''}>
            <span class="ae-textes"><span class="gras">${esc(p.nom)}</span>
              <span class="discret ${estStockBas(p) ? 'texte-danger' : ''}">stock ${esc(p.sur_commande ? 'sur commande' : formatQuantite(p.stock, p.unite))} · seuil ${esc(formatQuantite(p.seuil_alerte, p.unite))}</span></span>
          </label>
          <label class="sr-only" for="bon-q-${esc(p.id)}">Quantité de ${esc(p.nom)}</label>
          <input id="bon-q-${esc(p.id)}" class="input input-quantite" type="text" inputmode="decimal" data-quantite="${esc(p.id)}" value="${String(l?.quantite ?? quantiteSuggeree(p)).replace('.', ',')}">
          <span class="discret">${esc(p.unite || '')}</span>
        </li>`;
    }

    function render() {
      if (!etatBon.fournisseur) {
        cadre.innerHTML = `
          <p class="texte-modale">Choisissez le fournisseur :</p>
          <div class="liste-clients">
            ${actifs.map((f) => {
              const nbBas = s.produits.filter((p) => p.fournisseur_id === f.id && estStockBas(p)).length;
              return `<button type="button" class="item-client" data-choisir="${esc(f.id)}">
                <span class="avatar">${icone('camion', 18, 2)}</span>
                <span class="client-textes"><span class="gras">${esc(f.nom)}</span><span class="discret">${esc(f.telephone ? formatTelephone(f.telephone) : 'Sans téléphone')}${nbBas ? ` · ${nbBas} article(s) en stock bas` : ''}</span></span>
              </button>`;
            }).join('')}
          </div>`;
        return;
      }
      const f = etatBon.fournisseur;
      const bas = s.produits.filter((p) => p.fournisseur_id === f.id && estStockBas(p));
      const ajoutes = [...etatBon.lignes.keys()].map((id) => s.produits.find((p) => p.id === id)).filter((p) => p && !bas.includes(p));
      const q = normaliserTexte(etatBon.recherche.trim());
      const resultats = q ? s.produits.filter((p) => normaliserTexte(p.nom).includes(q) && !etatBon.lignes.has(p.id)).slice(0, 8) : [];
      const nbCoches = [...etatBon.lignes.values()].filter((l) => l.coche).length;
      cadre.innerHTML = `
        <form class="form-modale" novalidate>
          <div class="client-bouton client-choisi">
            <span class="avatar">${icone('camion', 18, 2)}</span>
            <span class="client-textes"><span class="gras">${esc(f.nom)}</span><span class="discret">${esc(f.telephone ? formatTelephone(f.telephone) : 'Sans téléphone : envoi par WhatsApp sans numéro')}</span></span>
            ${idFournisseur ? '' : '<button type="button" class="btn-lien" data-action="changer">Changer</button>'}
          </div>
          <span class="etiquette">Ses articles en stock bas</span>
          <ul class="liste-bon">${bas.length ? bas.map(ligneHTML).join('') : '<li class="discret">Aucun article de ce fournisseur n’est en stock bas.</li>'}</ul>
          ${ajoutes.length ? `<span class="etiquette">Autres articles</span><ul class="liste-bon">${ajoutes.map(ligneHTML).join('')}</ul>` : ''}
          <label class="recherche-caisse">
            ${icone('recherche', 18, 2)}
            <span class="sr-only">Ajouter un autre article</span>
            <input id="bon-recherche" type="search" placeholder="Ajouter un autre article…" autocomplete="off" value="${esc(etatBon.recherche)}">
          </label>
          ${resultats.length ? `<div class="liste-clients">${resultats.map((p) => `
            <button type="button" class="item-client" data-ajouter-article="${esc(p.id)}"><span class="client-textes"><span class="gras">${esc(p.nom)}</span><span class="discret">stock ${esc(p.sur_commande ? 'sur commande' : formatQuantite(p.stock, p.unite))}</span></span>${icone('plus', 18, 2.2)}</button>`).join('')}</div>` : ''}
          <div class="champ"><label for="bon-note">Note (facultatif)</label><input id="bon-note" class="input" type="text" maxlength="160" placeholder="Ex. Livraison au dépôt de Kagbélen"></div>
          <label class="case-option"><input type="checkbox" id="bon-sms"> <span>Envoyer aussi par SMS <span class="discret">(1 à 3 SMS, débités du crédit)</span></span></label>
          <p class="erreur-form" role="alert" hidden></p>
          <div class="modale-actions">
            <button type="button" class="btn btn-secondaire" data-fermer>Annuler</button>
            <button type="submit" class="btn btn-primaire" ${nbCoches ? '' : 'disabled'}>Créer le bon (${nbCoches} article${nbCoches > 1 ? 's' : ''})</button>
          </div>
        </form>`;
    }

    function resultatHTML(r) {
      const telephone = r.telephone || etatBon.fournisseur.telephone;
      return `
        <div class="confirmation">
          <span class="confirmation-icone">${icone('valide', 32, 2.6)}</span>
          <p class="confirmation-numero">Bon ${esc(r.numero)} · ${esc(etatBon.fournisseur.nom)}</p>
        </div>
        <pre class="texte-bon">${esc(r.texte || '')}</pre>
        <div class="modale-actions">
          <button type="button" class="btn btn-secondaire" data-copier-bon>${icone('copier', 18, 2)} Copier</button>
          <a class="btn btn-whatsapp" href="${esc(lienWhatsApp(telephone, r.texte || ''))}" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} Envoyer par WhatsApp</a>
          <button type="button" class="btn btn-primaire" data-fermer>Terminé</button>
        </div>`;
    }

    async function creer(bouton) {
      const lignes = [...etatBon.lignes.entries()].filter(([, l]) => l.coche && l.quantite > 0).map(([id, l]) => {
        const p = s.produits.find((x) => x.id === id);
        return { produit_id: id, nom: p.nom, quantite: l.quantite, unite: p.unite };
      });
      const zoneErreur = cadre.querySelector('.erreur-form');
      if (!lignes.length) { zoneErreur.textContent = 'Cochez au moins un article.'; zoneErreur.hidden = false; return; }
      boutonOccupe(bouton, true, 'Création du bon…');
      const { data, error } = await sb.rpc('creer_commande_fournisseur', {
        p_boutique: boutique.id,
        p_fournisseur: etatBon.fournisseur.id,
        p_lignes: lignes,
        p_note: cadre.querySelector('#bon-note').value.trim() || null,
        p_envoyer_sms: cadre.querySelector('#bon-sms').checked
      });
      if (error) { boutonOccupe(bouton, false); zoneErreur.textContent = messageErreur(error); zoneErreur.hidden = false; return; }
      const r = (Array.isArray(data) ? data[0] : data) || {};
      toast(`Bon ${r.numero || ''} créé.`, 'succes');
      el.querySelector('.modale-entete h2').textContent = `Bon de commande ${r.numero || ''}`;
      cadre.innerHTML = resultatHTML(r);
      cadre.querySelector('[data-copier-bon]').addEventListener('click', async () => {
        toast(await copierTexte(r.texte || '') ? 'Texte copié.' : 'Copie impossible.', 'info');
      });
      charger();
    }

    cadre.addEventListener('click', (e) => {
      const choisir = e.target.closest('[data-choisir]');
      if (choisir) { etatBon.fournisseur = actifs.find((f) => f.id === choisir.dataset.choisir); preremplir(); render(); return; }
      if (e.target.closest('[data-action="changer"]')) { etatBon.fournisseur = null; render(); return; }
      const ajouter = e.target.closest('[data-ajouter-article]');
      if (ajouter) {
        etatBon.lignes.set(ajouter.dataset.ajouterArticle, { coche: true, quantite: 1 });
        etatBon.recherche = '';
        render();
      }
    });
    cadre.addEventListener('change', (e) => {
      const id = e.target.dataset.cocher || e.target.dataset.quantite;
      if (!id) return;
      const p = s.produits.find((x) => x.id === id);
      const ligne = etatBon.lignes.get(id) || { coche: false, quantite: quantiteSuggeree(p) };
      if (e.target.dataset.cocher) ligne.coche = e.target.checked;
      if (e.target.dataset.quantite) {
        const q = lireNombre(e.target.value);
        ligne.quantite = q > 0 ? (uniteDivisible(p.unite) ? Math.round(q * 1000) / 1000 : Math.max(1, Math.round(q))) : ligne.quantite;
        ligne.coche = true;
      }
      etatBon.lignes.set(id, ligne);
      render();
    });
    cadre.addEventListener('input', (e) => {
      if (e.target.id !== 'bon-recherche') return;
      etatBon.recherche = e.target.value;
      const position = e.target.selectionStart;
      render();
      const champ = cadre.querySelector('#bon-recherche');
      champ.focus();
      champ.setSelectionRange(position, position);
    });
    cadre.addEventListener('submit', (e) => { e.preventDefault(); creer(e.target.querySelector('[type=submit]')); });

    if (etatBon.fournisseur) preremplir();
    render();
  }

  async function changerStatut(idCommande, statut) {
    const commande = s.commandes.find((c) => c.id === idCommande);
    if (!commande) return;
    const messages = {
      recue: `Marquer le bon ${commande.numero} comme reçu ? Le stock n’est pas modifié automatiquement : faites ensuite l’entrée de stock.`,
      annulee: `Annuler le bon ${commande.numero} ?`
    };
    if (!(await confirmer(messages[statut], { titre: statut === 'recue' ? 'Commande reçue' : 'Annuler le bon', libelleOk: statut === 'recue' ? 'Marquer reçue' : 'Annuler le bon', danger: statut === 'annulee' }))) return;
    const { error } = await sb.rpc('statut_commande_fournisseur', { p_commande: idCommande, p_statut: statut });
    if (error) { toast(messageErreur(error), 'erreur'); return; }
    if (statut === 'recue') toast(`Bon ${commande.numero} reçu.`, 'succes', 9000, { libelle: 'Faire l’entrée de stock', href: '#/stock' });
    else toast(`Bon ${commande.numero} annulé.`, 'succes');
    charger();
  }

  /* ---------------- Événements */

  zone.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'ajouter-fournisseur') ouvrirFormulaire();
    if (action === 'nouveau-bon') ouvrirBon();
    const bon = e.target.closest('[data-bon]');
    if (bon) ouvrirBon(bon.dataset.bon);
    const modifier = e.target.closest('[data-modifier]');
    if (modifier) ouvrirFormulaire(s.fournisseurs.find((f) => f.id === modifier.dataset.modifier));
    const activer = e.target.closest('[data-activer]');
    if (activer) basculerActif(s.fournisseurs.find((f) => f.id === activer.dataset.activer));
    const statut = e.target.closest('[data-statut]');
    if (statut) changerStatut(statut.dataset.commande, statut.dataset.statut);
  });
  zone.addEventListener('change', (e) => {
    if (e.target.dataset.action === 'voir-inactifs') { s.voirInactifs = e.target.checked; renderFournisseurs(); }
  });

  charger();
}
