/**
 * prereglages.js — Table de configuration de l'outil d'image : un préréglage par usage.
 *  recadrages : formes proposées (la première est celle par défaut) ;
 *  fond : 'non' (étape « Nettoyer » sautée) | 'propose' (interrupteur éteint) | 'active' (allumé) ;
 *  ia : propose aussi le détourage automatique (photos d'articles) ;
 *  sorties : fichiers produits ({ cle, cote | largeur+hauteur, qualite, tailleMax, transparent }) ;
 *  apercu : rendu « à l'endroit d'usage » à l'étape Enregistrer.
 */
export const PREREGLAGES = {
  logo: {
    titre: 'Logo de la boutique', bouton: 'Enregistrer le logo', recadrages: ['carre', 'rond'], fond: 'propose',
    sorties: [{ cle: 'grande', cote: 512, carre: true, qualite: 0.9, tailleMax: 120 * 1024, transparent: true }],
    apercu: 'facture', aide: 'Idéal pour un logo photographié sur papier blanc'
  },
  cachet: {
    titre: 'Cachet de la boutique', bouton: 'Enregistrer le cachet', recadrages: ['libre', 'carre', 'rond'], fond: 'active',
    sorties: [{ cle: 'grande', cote: 800, qualite: 0.92, tailleMax: 300 * 1024, transparent: true, png: true }],
    apercu: 'signature', aide: 'Tamponnez une feuille blanche puis photographiez-la bien à plat'
  },
  signature: {
    titre: 'Signature', bouton: 'Enregistrer la signature', recadrages: ['libre'], fond: 'active', dessin: true,
    sorties: [{ cle: 'grande', cote: 800, qualite: 0.92, tailleMax: 300 * 1024, transparent: true, png: true }],
    apercu: 'signature', aide: 'Signez au doigt, ou photographiez votre signature sur une feuille blanche'
  },
  article: {
    titre: 'Photo de l’article', bouton: 'Enregistrer la photo', recadrages: ['carre', 'libre'], fond: 'propose', ia: true,
    sorties: [
      { cle: 'grande', cote: 1080, qualite: 0.8, tailleMax: 150 * 1024 },
      { cle: 'mini', cote: 300, qualite: 0.7, tailleMax: 30 * 1024 }
    ],
    apercu: 'carte', aide: 'Fond blanc uni : retirez-le pour un rendu « catalogue »'
  },
  couverture: {
    titre: 'Photo de couverture', bouton: 'Enregistrer la couverture', recadrages: ['16:9'], fond: 'non',
    sorties: [
      { cle: 'grande', largeur: 1600, hauteur: 900, qualite: 0.75, tailleMax: 150 * 1024 },
      { cle: 'mini', largeur: 800, hauteur: 450, qualite: 0.7, tailleMax: 50 * 1024 }
    ],
    apercu: 'couverture', aide: 'Devanture ou rayons, de jour, en largeur'
  },
  paiement: {
    titre: 'Logo officiel', bouton: 'Enregistrer le logo', recadrages: ['libre', 'carre'], fond: 'propose',
    sorties: [{ cle: 'grande', cote: 300, qualite: 0.9, tailleMax: 60 * 1024, transparent: true }],
    apercu: 'pied', aide: 'Logo du kit marchand fourni par l’opérateur'
  },
  partenaire: {
    titre: 'Logo partenaire', bouton: 'Enregistrer le logo', recadrages: ['libre', 'carre'], fond: 'propose',
    sorties: [{ cle: 'grande', cote: 300, qualite: 0.9, tailleMax: 60 * 1024, transparent: true }],
    apercu: 'pied', aide: 'Marque distribuée, label ou certification'
  },
  bon: {
    titre: 'Photo du bon signé', bouton: 'Utiliser cette photo', recadrages: ['libre'], fond: 'non',
    sorties: [{ cle: 'grande', cote: 1600, qualite: 0.7, tailleMax: 400 * 1024, jpeg: true }],
    apercu: 'photo', aide: 'Bon d’enlèvement signé, bien lisible'
  }
};

export const FORMES = {
  carre: { libelle: 'Carré', rapport: 1 },
  rond: { libelle: 'Rond', rapport: 1, rond: true },
  libre: { libelle: 'Libre', rapport: null },
  '16:9': { libelle: '16:9', rapport: 16 / 9 }
};
