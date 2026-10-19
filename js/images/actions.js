/**
 * actions.js — Actions courantes branchées sur l'outil d'image : photo d'un article (stock, affiche du jour)
 * et logo de la boutique (Paramètres, Documents, Identité). Le quota de photos de la formule est vérifié
 * par la base (erreur QUOTA_PHOTOS : <max>) : message clair + lien « Ma licence ».
 */
import { toast, messageErreur } from '../utils.js';
import { ouvrirOutilImage } from './outil.js';
import { enregistrerPhotoArticle, enregistrerLogo } from './envoi.js';

/** Vrai si l'erreur vient du quota de photos ; affiche alors le message avec le lien vers la licence. */
export function signalerQuota(err) {
  if (!/QUOTA_PHOTOS/.test(String(err?.message || err || ''))) return false;
  toast(messageErreur(err), 'erreur', 9000, { libelle: 'Ma licence', href: '#/licence' });
  return true;
}

/**
 * Photo d'un article : nouvelle photo (source null) ou retouche de la photo actuelle (source = URL).
 * apres({ url, mini, taille, tailleMini }) quand c'est enregistré.
 */
export function modifierPhotoArticle(produit, { source = null, apres = () => {} } = {}) {
  return ouvrirOutilImage({
    usage: 'article',
    source,
    titre: source ? 'Retoucher la photo' : (produit.photo_url ? 'Changer la photo' : 'Ajouter une photo'),
    contexte: { nom: produit.nom, prix: produit.prix_detail || produit.prix },
    enregistrer: async (sorties) => {
      try {
        const r = await enregistrerPhotoArticle(produit, sorties);
        toast(`Photo enregistrée (${Math.round(r.taille / 1024)} Ko + miniature ${Math.round(r.tailleMini / 1024)} Ko).`, 'succes');
        apres(r);
      } catch (err) {
        signalerQuota(err);
        throw err;
      }
    }
  });
}

/** Logo de la boutique (512 px, transparent si le fond est retiré). */
export function modifierLogo({ source = null, apres = () => {}, nom = '' } = {}) {
  return ouvrirOutilImage({
    usage: 'logo',
    source,
    titre: source ? 'Recadrer le logo' : 'Logo de la boutique',
    contexte: { nom },
    enregistrer: async (sorties) => {
      const r = await enregistrerLogo(sorties);
      toast(`Logo enregistré (${Math.round(sorties.grande.blob.size / 1024)} Ko).`, 'succes');
      apres(r);
    }
  });
}
