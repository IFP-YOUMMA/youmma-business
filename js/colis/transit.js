/**
 * colis/transit.js — « Aujourd'hui » de l'activité logistique (étape 18, maquette LogiAccueil), #/transit.
 *
 * Quatre chiffres (tableau_colis + tableau_corridors) : marchandise dans les entrepôts (avec les kg taxables), en route,
 * à retirer (les colis qui dorment en rouge), encaissé aujourd'hui (une ligne par monnaie, jamais additionnées).
 * Les corridors (tableau_corridors) : une carte par ligne de tarif, avec la barre de remplissage du prochain départ
 * (kg_attente sur capacite, rouge sous 40 % : un camion à moitié vide, c'est de l'argent perdu).
 * À faire aujourd'hui : cartons à peser, départ de demain trop vide, colis qui dorment. Les taux du jour (rouge > 7 jours).
 * Aucun poids ni prix n'est calculé ici : seule la proportion de la barre l'est, pour la dessiner.
 */
import { esc, icone, messageErreur, formatNombre, formatDate } from '../utils.js';
import { api, nomDevise, MODES } from './commun.js';

const SEUIL_REMPLISSAGE = 40;
const kgTexte = (n) => formatNombre(n, 2).replace(/,00$/, '');

/** « aujourd'hui », « demain », sinon le jour (« jeudi ») : date ISO « 2026-10-29 » du prochain départ. */
function jourDepart(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  const auj = new Date(); auj.setHours(12, 0, 0, 0);
  const ecart = Math.round((d - auj) / 864e5);
  if (ecart <= 0) return 'aujourd’hui';
  if (ecart === 1) return 'demain';
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(d);
}
const pourcent = (c) => (c.capacite ? Math.min(100, Math.round((Number(c.kg_attente) / Number(c.capacite)) * 100)) : null);

export function afficherTransit(conteneur) {
  conteneur.innerHTML = `
    <div class="page page-transit">
      <header class="col-entete">
        <div class="col-entete-titres"><h1>Aujourd’hui</h1><span class="discret" data-ref="sous-titre"></span></div>
        <form class="col-recherche" data-ref="recherche" role="search"><span class="sr-only">Rechercher</span>${icone('recherche', 17, 2)}
          <input type="search" name="q" placeholder="N° de colis, compte, téléphone…" autocomplete="off" enterkeyhint="search"></form>
        <a class="btn btn-primaire col-nouveau" href="#/recevoir">${icone('plus', 16, 2.6)} Recevoir de la marchandise</a>
      </header>
      <section class="col-kpis" data-zone="kpis">${'<div class="carte col-kpi"><span class="squelette" style="height:60px"></span></div>'.repeat(4)}</section>
      <div class="col-carte-entete tr-titre"><h2>Les corridors</h2><a class="btn btn-secondaire btn-petit" href="#/parametres">${icone('plus', 15, 2.4)} Ouvrir un corridor</a></div>
      <section class="tr-corridors" data-zone="corridors"><span class="squelette" style="height:160px"></span></section>
      <div class="tr-bas">
        <section class="carte tr-afaire" data-zone="afaire"><h2>À faire aujourd’hui</h2></section>
        <section class="carte tr-taux" data-zone="taux"><h2>Les taux du jour</h2></section>
      </div>
    </div>`;
  const zone = (n) => conteneur.querySelector(`[data-zone="${n}"]`);

  conteneur.querySelector('[data-ref="recherche"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (q) location.hash = `#/colis?q=${encodeURIComponent(q)}`;
  });

  function renderKpis(t, corridors) {
    const r = t.resume;
    const arrivee = t.agences.find((a) => a.devise === 'GNF') || t.agences[t.agences.length - 1];
    const enRoute = t.envois.filter((e) => e.statut === 'en_route');
    const entrepot = corridors.reduce((x, c) => x + Number(c.en_attente), 0);
    const aPeser = corridors.reduce((x, c) => x + Number(c.a_peser), 0);
    const kgEntrepot = corridors.reduce((x, c) => x + Number(c.kg_attente), 0);
    const villeDe = (devise) => t.agences.find((a) => a.devise === devise)?.ville;
    const kpi = (libelle, valeur, unite, sous, classes = '') => `
      <div class="carte col-kpi"><span class="etiquette-carte">${esc(libelle)}</span>
        <div class="col-kpi-valeur"><strong class="nombre-gros ${classes}">${valeur}</strong><span>${esc(unite)}</span></div>
        <span class="col-kpi-sous ${classes}">${sous}</span></div>`;
    zone('kpis').innerHTML = [
      kpi('Marchandise dans les entrepôts', formatNombre(entrepot + aPeser), 'colis', `${esc(kgTexte(kgEntrepot))} kg taxables${aPeser ? ` · dont ${formatNombre(aPeser)} à peser` : ''}`),
      kpi(`En route vers ${arrivee?.ville || 'l’arrivée'}`, formatNombre(enRoute.length), 'envois', `${formatNombre(r.en_route)} colis`),
      kpi(`À retirer à ${arrivee?.ville || 'l’arrivée'}`, formatNombre(r.a_retirer), 'colis', r.dorment ? `${formatNombre(r.dorment)} dorment depuis plus de 7 j` : 'Aucun colis ne dort', r.dorment ? 'texte-danger' : ''),
      `<div class="carte col-kpi"><span class="etiquette-carte">Encaissé aujourd’hui</span>
        ${t.encaisse_jour.length ? t.encaisse_jour.map((e, i) => `<div class="col-kpi-valeur ${i ? 'second' : ''}"><strong class="${i ? '' : 'nombre-gros'}">${i ? '+ ' : ''}${formatNombre(e.montant)}</strong><span>${esc(nomDevise(e.devise))}${villeDe(e.devise) ? ` à ${esc(villeDe(e.devise))}` : ''}</span></div>`).join('')
          : '<div class="col-kpi-valeur"><strong class="nombre-gros">0</strong></div><span class="col-kpi-sous">Rien encaissé pour l’instant</span>'}</div>`
    ].join('');
  }

  function renderCorridors(corridors) {
    zone('corridors').innerHTML = corridors.length ? corridors.map((c) => {
      const p = pourcent(c);
      const bas = p !== null && p < SEUIL_REMPLISSAGE;
      const jour = jourDepart(c.prochain);
      return `<article class="carte tr-corridor">
        <header class="tr-corridor-tete"><span class="tr-drapeau" title="${esc(c.pays)}">${esc(c.drapeau || c.pays)}</span>
          <span class="tr-corridor-titres"><strong>${esc(c.ville)} → ${esc(c.vers)}</strong><span>${esc(MODES[c.mode]?.libelle || c.mode)} · ${formatNombre(c.delai_jours)} j · ${formatNombre(c.prix_kg)} ${esc(nomDevise(c.devise))}/kg</span></span></header>
        <div class="tr-corridor-chiffres">
          <div><span class="etiquette">En attente</span><strong class="nombre-moyen">${formatNombre(c.en_attente)}</strong> <span class="discret">colis</span></div>
          <div><span class="etiquette">Poids taxable</span><strong class="nombre-moyen">${esc(kgTexte(c.kg_attente))}</strong> <span class="discret">kg</span></div>
        </div>
        ${c.a_peser ? `<a class="tr-a-peser" href="#/colis?filtre=a_peser">${formatNombre(c.a_peser)} carton${c.a_peser > 1 ? 's' : ''} à peser</a>` : ''}
        ${p !== null ? `<div class="tr-remplissage ${bas ? 'bas' : ''}"><div class="tr-remplissage-tete"><span>Remplissage du prochain départ</span><strong>${p} %</strong></div>
          <span class="tr-barre" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span></span></div>` : '<p class="discret">Capacité du véhicule non renseignée (Réglages › Mes corridors).</p>'}
        <footer class="tr-corridor-pied">${jour ? `<span class="tr-depart">Départ ${esc(jour)}</span>` : '<span class="tr-depart">Départ à fixer</span>'}${c.capacite ? `<span class="discret">${esc(kgTexte(c.kg_attente))} kg sur ${esc(kgTexte(c.capacite))} kg</span>` : ''}</footer>
      </article>`;
    }).join('') : '<p class="col-vide carte">Aucun corridor. Ouvrez le premier dans Réglages › Mes corridors.</p>';
  }

  function renderAfaire(t, corridors) {
    const lignes = [];
    const aPeser = corridors.reduce((x, c) => x + Number(c.a_peser), 0);
    if (aPeser) lignes.push(['colis', 'or', `${formatNombre(aPeser)} carton${aPeser > 1 ? 's' : ''} déposé${aPeser > 1 ? 's' : ''}, pas encore pesé${aPeser > 1 ? 's' : ''}`, 'Sans pesée, pas de prix ni de départ possible.', 'Peser', '#/colis?filtre=a_peser']);
    corridors.filter((c) => jourDepart(c.prochain) === 'demain' && pourcent(c) !== null && pourcent(c) < SEUIL_REMPLISSAGE).forEach((c) => {
      lignes.push(['camion', 'or', `Le ${c.mode === 'avion' ? 'vol' : c.mode === 'bateau' ? 'bateau' : 'camion'} de ${c.ville} part demain, il est à ${pourcent(c)} %`, `${kgTexte(c.capacite)} kg de capacité, ${kgTexte(c.kg_attente)} kg prêts à partir.`, 'Appeler les clients', '#/comptes']);
    });
    if (t.resume.dorment) lignes.push(['horloge', 'rouge', `${formatNombre(t.resume.dorment)} colis dorment depuis plus de 7 jours`, 'Relancez les destinataires avant de facturer le gardiennage.', 'Relancer', '#/colis?filtre=a_retirer']);
    zone('afaire').innerHTML = `<h2>À faire aujourd’hui</h2>${lignes.length ? `<ul class="tr-liste">${lignes.map(([ic, ton, titre, sous, action, lien]) => `
      <li><span class="tr-pastille ${ton}">${icone(ic, 17, 2)}</span><span class="tr-liste-textes"><strong>${esc(titre)}</strong><span>${esc(sous)}</span></span><a class="col-lien" href="${lien}">${esc(action)} ›</a></li>`).join('')}</ul>`
      : '<p class="col-vide">Rien d’urgent. Tous les cartons sont pesés et aucun colis ne dort.</p>'}`;
  }

  function renderTaux(t) {
    zone('taux').innerHTML = `<h2>Les taux du jour</h2>${t.taux.length ? `<ul class="tr-taux-liste">${t.taux.map((x) => {
      const jours = Math.floor((Date.now() - new Date(x.maj_le).getTime()) / 864e5);
      return `<li><span>1 ${esc(nomDevise(x.de))}</span><strong>${esc(formatNombre(x.taux, 4))} ${esc(nomDevise(x.vers))}</strong><span class="${jours > 7 ? 'texte-danger' : 'discret'}">${jours > 7 ? `il y a ${jours} jours` : `à jour · ${esc(formatDate(x.maj_le, 'jourMois'))}`}</span></li>`;
    }).join('')}</ul>` : '<p class="col-vide">Aucun taux. Réglez-le dans Réglages.</p>'}
      <p class="discret">Un taux oublié, c’est de l’argent perdu sur chaque colis payé à l’arrivée. <a class="col-lien" href="#/parametres">Changer un taux</a></p>`;
  }

  (async () => {
    try {
      const [t, corridors] = await Promise.all([api.tableau(), api.corridors()]);
      if (!conteneur.isConnected) return;
      conteneur.querySelector('[data-ref="sous-titre"]').textContent = `${corridors.length} corridor${corridors.length > 1 ? 's' : ''} · ${[...new Set(corridors.map((c) => c.vers))].map((v) => `vers ${v}`).join(', ')}`;
      renderKpis(t, corridors); renderCorridors(corridors); renderAfaire(t, corridors); renderTaux(t);
    } catch (err) {
      zone('kpis').innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`;
    }
  })();
}
