/**
 * codes-barres.js — Code 128 avec JsBarcode 3.11.6 (licence MIT, copié dans js/vendor et mis en cache par sw.js) :
 * le seul générateur de codes-barres du projet (étiquettes des variantes, étiquettes des colis).
 * Le script n'est pas un module : il est chargé une fois, à la demande, et reste disponible hors connexion.
 */
const JSBARCODE = new URL('./vendor/JsBarcode.all.min.js', import.meta.url).href;

let promesse = null;
export function chargerJsBarcode() {
  if (window.JsBarcode) return Promise.resolve(window.JsBarcode);
  if (!promesse) {
    promesse = new Promise((ok, ko) => {
      const script = document.createElement('script');
      script.src = JSBARCODE;
      script.onload = () => (window.JsBarcode ? ok(window.JsBarcode) : ko(new Error('JsBarcode indisponible')));
      script.onerror = () => { promesse = null; ko(new Error('Impossible de charger le générateur de codes-barres : rechargez l’appli une fois avec internet.')); };
      document.head.appendChild(script);
    });
  }
  return promesse;
}

/**
 * Code 128 en SVG (texte HTML), sans chiffres dessous, après chargerJsBarcode(). Modules de 2 unités entières,
 * zone calme de 10 modules, rendu net (crispEdges) ; le SVG s'étire à la largeur que lui donne le CSS.
 */
export function svgCode128(texte, { hauteur = 50, titre = `Code-barres ${texte}` } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  window.JsBarcode(svg, texte, { format: 'CODE128', width: 2, height: hauteur, margin: 20, displayValue: false, background: '#FFFFFF', lineColor: '#000000' });
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.removeAttribute('style');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', titre);
  return svg.outerHTML;
}
