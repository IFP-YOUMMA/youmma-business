/**
 * marche/articles.js — Les articles d'un vendeur dans le marché (étape 21), depuis la vue « Règlements ».
 *
 * Seule écriture directe permise du marché : la table articles_marche (policy est_gerant). Lecture, ajout, modification,
 * « TOP » (mis_en_avant) et suppression. Les prix sont ceux du vendeur, dans sa monnaie ; le prix client en GNF est
 * calculé par la base (marche_public), jamais ici.
 * Photo : l'outil d'image avec détourage OBLIGATOIRE ; s'il échoue, l'article reste sans photo.
 */
import { sb } from '../supabase.js';
import { etat } from '../state.js';
import { esc, icone, toast, ouvrirModale, boutonOccupe, confirmer, formatNombre, lireNombre } from '../utils.js';
import { ouvrirOutilImage } from '../images/outil.js';
import { enregistrerPhotoMarche, supprimerPublics } from '../images/envoi.js';
import { montant, nomDevise, erreurMarche } from './commun.js';

const COLONNES = 'id, boutique_id, fournisseur_id, nom, prix, unite, poids_kg, categorie, photo_url, photo_mini_url, description, mis_en_avant, ordre, created_at';

export function ouvrirArticlesFournisseur(f) {
  let articles = [];
  const { el } = ouvrirModale({
    titre: `Articles de ${f.nom}`,
    variante: 'large',
    contenu: `<div class="mc-articles">
      <p class="texte-modale">Ce que les acheteurs de Conakry voient de ${esc(f.nom)}. Prix dans sa monnaie (${esc(nomDevise(f.devise))}) ; le prix en GNF est calculé par le bureau.</p>
      <div class="mc-articles-outils"><button type="button" class="btn btn-primaire" data-action="nouvel-article">${icone('plus', 16, 2)} Ajouter un article</button></div>
      <div data-zone="liste"><span class="squelette" style="height:160px"></span></div>
    </div>`
  });
  const zone = el.querySelector('[data-zone="liste"]');

  async function charger() {
    const { data, error } = await sb.from('articles_marche').select(COLONNES).eq('fournisseur_id', f.id).order('ordre', { ascending: true, nullsFirst: false }).order('created_at');
    if (!el.isConnected) return;
    if (error) { zone.innerHTML = `<p class="bloc-erreur">${esc(erreurMarche(error))}</p>`; return; }
    articles = data || [];
    rendre();
  }

  function rendre() {
    zone.innerHTML = articles.length ? `<ul class="mc-articles-liste">${articles.map((a) => `
      <li data-article="${esc(a.id)}">
        <span class="mc-article-photo">${a.photo_mini_url || a.photo_url ? `<img src="${esc(a.photo_mini_url || a.photo_url)}" alt="" width="56" height="56" loading="lazy">` : icone('image', 22, 1.7)}</span>
        <span class="mc-article-textes"><strong>${esc(a.nom)}</strong><span>${esc([a.categorie, a.unite, a.poids_kg ? `${formatNombre(a.poids_kg, 2)} kg` : 'poids à renseigner'].filter(Boolean).join(' · '))}</span></span>
        <strong class="mc-num">${esc(montant(a.prix, f.devise))}</strong>
        <span class="mc-article-actions">
          <button type="button" class="btn btn-secondaire btn-petit ${a.mis_en_avant ? 'actif' : ''}" data-top="${esc(a.id)}" aria-pressed="${Boolean(a.mis_en_avant)}">TOP</button>
          <button type="button" class="btn btn-secondaire btn-petit" data-photo="${esc(a.id)}">${icone('photo', 14, 2)} Photo</button>
          <button type="button" class="btn btn-secondaire btn-petit" data-modifier="${esc(a.id)}">Modifier</button>
          <button type="button" class="btn-lien btn-lien-danger" data-supprimer="${esc(a.id)}">Retirer</button>
        </span>
      </li>`).join('')}</ul>` : '<p class="col-vide">Aucun article pour ce vendeur. Ajoutez-en quelques-uns : une boutique vide ne vend rien.</p>';
  }

  function formulaire(a = null) {
    const { el: m, fermer } = ouvrirModale({
      titre: a ? 'Modifier l’article' : 'Nouvel article du marché',
      contenu: `<form class="form-modale" novalidate>
        <div class="champ"><label for="am-nom">Nom</label><input id="am-nom" class="input" maxlength="120" required value="${esc(a?.nom || '')}" placeholder="Bazin riche getzner, 5 yards"></div>
        <div class="rangee-champs">
          <div class="champ"><label for="am-prix">Prix du vendeur (${esc(nomDevise(f.devise))})</label><input id="am-prix" class="input input-montant" inputmode="numeric" required value="${a?.prix ? esc(formatNombre(a.prix)) : ''}"></div>
          <div class="champ"><label for="am-unite">Unité</label><input id="am-unite" class="input" maxlength="30" value="${esc(a?.unite || 'pièce')}"></div>
        </div>
        <div class="rangee-champs">
          <div class="champ"><label for="am-poids">Poids (kg)</label><input id="am-poids" class="input" inputmode="decimal" value="${a?.poids_kg ? esc(String(a.poids_kg).replace('.', ',')) : ''}" placeholder="2,5"><small class="aide">Sert à estimer le transport du client.</small></div>
          <div class="champ"><label for="am-cat">Rayon</label><input id="am-cat" class="input" maxlength="40" value="${esc(a?.categorie || '')}" placeholder="Tissus"></div>
        </div>
        <div class="champ"><label for="am-desc">Description (facultatif)</label><input id="am-desc" class="input" maxlength="300" value="${esc(a?.description || '')}"></div>
        <p class="erreur-form" role="alert" hidden></p>
        <div class="modale-actions"><button type="button" class="btn btn-secondaire" data-fermer>Annuler</button><button type="submit" class="btn btn-primaire">${a ? 'Enregistrer' : 'Ajouter'}</button></div>
      </form>`
    });
    m.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const z = m.querySelector('.erreur-form');
      const nom = m.querySelector('#am-nom').value.trim();
      const prix = lireNombre(m.querySelector('#am-prix').value);
      if (!nom || !(prix > 0)) { z.textContent = 'Le nom et le prix sont obligatoires.'; z.hidden = false; return; }
      const ligne = {
        nom, prix, unite: m.querySelector('#am-unite').value.trim() || null,
        poids_kg: lireNombre(m.querySelector('#am-poids').value) || null,
        categorie: m.querySelector('#am-cat').value.trim() || null, description: m.querySelector('#am-desc').value.trim() || null
      };
      const bouton = m.querySelector('[type=submit]');
      boutonOccupe(bouton, true, 'Enregistrement…');
      const r = a
        ? await sb.from('articles_marche').update(ligne).eq('id', a.id).select(COLONNES).maybeSingle()
        : await sb.from('articles_marche').insert({ ...ligne, boutique_id: etat.boutique.id, fournisseur_id: f.id, mis_en_avant: false, ordre: articles.length + 1 }).select(COLONNES).maybeSingle();
      if (r.error) { boutonOccupe(bouton, false); z.textContent = erreurMarche(r.error); z.hidden = false; return; }
      fermer();
      toast(a ? 'Article modifié.' : 'Article ajouté. Ajoutez maintenant sa photo.', 'succes');
      await charger();
      if (!a && r.data) photo(r.data);
    });
  }

  function photo(a) {
    ouvrirOutilImage({
      usage: 'article',
      detourageObligatoire: true,
      titre: a.photo_url ? 'Changer la photo' : 'Photo de l’article',
      contexte: { nom: a.nom, prix: null },
      enregistrer: async (sorties) => {
        const r = await enregistrerPhotoMarche(a, sorties);
        toast('Photo détourée enregistrée.', 'succes');
        Object.assign(a, { photo_url: r.url, photo_mini_url: r.mini });
        rendre();
      }
    });
  }

  el.addEventListener('click', async (ev) => {
    const cible = (attr) => articles.find((x) => x.id === ev.target.closest(`[data-${attr}]`)?.dataset[attr]);
    if (ev.target.closest('[data-action="nouvel-article"]')) { formulaire(); return; }
    const aPhoto = cible('photo'); if (aPhoto) { photo(aPhoto); return; }
    const aModif = cible('modifier'); if (aModif) { formulaire(aModif); return; }
    const aTop = cible('top');
    if (aTop) {
      const { error } = await sb.from('articles_marche').update({ mis_en_avant: !aTop.mis_en_avant }).eq('id', aTop.id);
      if (error) { toast(erreurMarche(error), 'erreur'); return; }
      aTop.mis_en_avant = !aTop.mis_en_avant; rendre(); return;
    }
    const aSuppr = cible('supprimer');
    if (aSuppr && await confirmer(`Retirer « ${aSuppr.nom} » du marché ?`, { titre: 'Retirer l’article', libelleOk: 'Retirer', danger: true })) {
      const { error } = await sb.from('articles_marche').delete().eq('id', aSuppr.id);
      if (error) { toast(erreurMarche(error), 'erreur'); return; }
      await supprimerPublics(aSuppr.photo_url, aSuppr.photo_mini_url);
      toast('Article retiré du marché.', 'succes');
      charger();
    }
  });
  charger();
}
