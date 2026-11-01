/**
 * module-a-acheter.js — Page d'un module à acheter (étape 18f), ouverte depuis une entrée de menu à cadenas :
 *  - état « formule » : le module vient avec une formule plus haute (formule_min) → ce qu'il apporte, lien vers la licence ;
 *  - état « option » : option payante non payée (prix_mois lu dans mes_modules) → demande d'activation par WhatsApp.
 * La boutique en ligne garde sa propre page d'activation (option-boutique.js). Aucun prix en dur : seulement ce que
 * la base renvoie ; la page Licence montre le prix des formules.
 */
import { etat } from './state.js';
import { infoModule, formuleModules } from './modules.js';
import { lienSupport } from './plateforme.js';
import { esc, icone, formatNombre } from './utils.js';

const NOMS_FORMULES = { essai: 'Essai', essentiel: 'Essentiel', pro: 'Pro', premium: 'Premium' };
const nomFormule = (code) => NOMS_FORMULES[code] || (code ? code.charAt(0).toUpperCase() + code.slice(1) : '');

export function afficherModuleAAcheter(conteneur, code, { icone: ic = 'cadenas', libelle = '' } = {}) {
  const m = infoModule(code) || {};
  const nom = m.nom || libelle || code;
  const option = m.etat === 'option';
  const prix = Number(m.prix_mois) ? `${formatNombre(m.prix_mois)} GNF par mois` : '';
  const message = `Bonjour YOUMMA, je voudrais activer « ${nom} » pour ma boutique ${etat.boutique?.nom || ''}.`;
  conteneur.innerHTML = `
    <div class="page">
      <section class="carte bientot page-achat-module">
        <span class="bientot-icone">${icone(ic, 36, 1.7)}</span>
        <h1>${esc(nom)}</h1>
        ${m.description ? `<p class="bientot-texte">${esc(m.description)}</p>` : ''}
        ${option
    ? `<p class="bientot-statut">${icone('cadenas', 16, 2)} Option à activer${prix ? ` : ${esc(prix)}` : ''}</p>
        <a class="btn btn-whatsapp" href="${esc(lienSupport(message))}" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} Demander l’activation</a>`
    : `<p class="bientot-statut">${icone('cadenas', 16, 2)} Compris à partir de la formule ${esc(nomFormule(m.formule_min) || 'supérieure')}${formuleModules() ? ` · votre formule : ${esc(nomFormule(formuleModules()))}` : ''}</p>
        <a class="btn btn-primaire" href="#/licence">Voir les formules et leurs prix</a>`}
      </section>
    </div>`;
}
