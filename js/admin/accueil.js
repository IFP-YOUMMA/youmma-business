/**
 * admin/accueil.js — Vue d'ensemble (maquette AdminAccueil.dc.html) : 6 chiffres, revenus 6 mois
 * (licences / SMS en barres empilées), à traiter, dernières inscriptions, santé du système.
 */
import { esc, capitaliser, formatDate, formatMillions } from '../utils.js';
import { rpc, premiere, champ, liste, gnf, nombre, ilYa, telLocal, badgeLicence, blocErreur, squelette, TYPES, avatarBoutique } from './commun.js';
import { lireStockage, taille } from './stockage.js';

const PLAN_BASE = 500 * 1024 * 1024;   // 500 Mo (plan gratuit Supabase)
const PLAN_STOCKAGE = 1024 * 1024 * 1024; // 1 Go

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const tailleTexte = (o) => (o >= 1024 ** 3 ? `${(o / 1024 ** 3).toFixed(1).replace('.', ',')} Go` : `${Math.round(o / 1024 ** 2)} Mo`);
const pastille = (p, seuil = 70) => (p >= Math.max(90, seuil) ? 'rouge' : p >= seuil ? 'orange' : 'vert');

function graphique(mois) {
  if (!mois.length) return '<p class="vide-admin">Pas encore de revenus.</p>';
  const L = 600; const H = 220; const bas = 190; const haut = 24;
  const max = Math.max(1, ...mois.map((m) => (Number(m.licences) || 0) + (Number(m.sms) || 0)));
  const pas = L / mois.length;
  const largeur = Math.min(54, pas * 0.55);
  const echelle = (v) => ((bas - haut) * v) / max;
  return `
    <svg class="adm-graphique" viewBox="0 0 ${L} ${H}" role="img" aria-label="Revenus des 6 derniers mois : licences et packs SMS">
      <line x1="0" y1="${bas}" x2="${L}" y2="${bas}" stroke="#E2E8E5"/>
      ${mois.map((m, i) => {
        const lic = Number(m.licences) || 0;
        const sms = Number(m.sms) || 0;
        const x = i * pas + (pas - largeur) / 2;
        const hl = echelle(lic);
        const hs = echelle(sms);
        const libelle = capitaliser(new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' }).format(new Date(`${String(m.mois).slice(0, 7)}-15T12:00:00Z`)));
        return `
          <g><title>${esc(libelle)} : licences ${gnf(lic)}, SMS ${gnf(sms)}</title>
            <rect x="${x}" y="${bas - hl}" width="${largeur}" height="${hl}" fill="#0F7B5F"/>
            <rect x="${x}" y="${bas - hl - hs}" width="${largeur}" height="${hs}" rx="${hs ? 6 : 0}" fill="#F2B33D"/>
            ${hs ? `<rect x="${x}" y="${bas - hl - Math.min(hs, 6)}" width="${largeur}" height="${Math.min(hs, 6)}" fill="#F2B33D"/>` : ''}
            <text x="${x + largeur / 2}" y="${bas - hl - hs - 8}" text-anchor="middle" font-size="12" font-weight="800" fill="#10231D">${esc(formatMillions(lic + sms))}</text>
            <text x="${x + largeur / 2}" y="${bas + 22}" text-anchor="middle" font-size="13" font-weight="700" fill="#55665F">${esc(libelle)}</text>
          </g>`;
      }).join('')}
    </svg>`;
}

export function afficherAccueil(conteneur) {
  conteneur.innerHTML = `
    <header class="adm-entete">
      <div class="adm-titres">
        <span class="discret">${esc(capitaliser(formatDate(new Date(), 'long')))}</span>
        <h1>Vue d’ensemble</h1>
        <span class="discret">Toutes les boutiques YOUMMA Business</span>
      </div>
    </header>
    <div class="adm-kpis" data-zone="kpis">${'<div class="adm-kpi">' + squelette(2) + '</div>'.repeat(1)}</div>
    <div class="adm-rangee">
      <section class="adm-carte adm-large">
        <div class="adm-carte-entete"><h2>Revenus YOUMMA · 6 derniers mois</h2>
          <span class="adm-legende"><i style="background:#0F7B5F"></i> Licences <i style="background:#F2B33D"></i> Packs SMS</span></div>
        <div data-zone="graphique">${squelette(4)}</div>
      </section>
      <section class="adm-carte adm-etroite"><h2>À traiter</h2><div data-zone="traiter">${squelette(4)}</div></section>
    </div>
    <div class="adm-rangee">
      <section class="adm-carte adm-large">
        <div class="adm-carte-entete"><h2>Dernières inscriptions</h2><a href="#/boutiques" class="gras">Toutes les boutiques</a></div>
        <div data-zone="dernieres">${squelette(4)}</div>
      </section>
      <section class="adm-carte adm-etroite"><h2>Santé du système</h2><div data-zone="sante">${squelette(4)}</div></section>
    </div>`;
  const zone = (n) => conteneur.querySelector(`[data-zone="${n}"]`);

  // Stockage et base (limites et seuil réglables) : lus en parallèle des statistiques.
  const infosStockage = lireStockage().catch(() => null);
  (async () => {
    let s;
    try { s = premiere(await rpc('admin_stats')) || {}; } catch (err) { zone('kpis').innerHTML = blocErreur(err); return; }
    if (!conteneur.isConnected) return;
    const revenus = Number(champ(s, 'revenus_mois')) || 0;
    const precedent = Number(champ(s, 'revenus_mois_precedent', 'revenus_mois_prec')) || 0;
    const evolution = precedent ? Math.round(((revenus - precedent) / precedent) * 100) : null;
    const sms = Number(champ(s, 'sms_mois', 'sms_envoyes_mois')) || 0;
    const echecs = Number(champ(s, 'sms_echecs_mois')) || 0;
    const kpis = [
      ['Boutiques actives', nombre(champ(s, 'boutiques_actives')), `+${nombre(champ(s, 'nouvelles_mois', 'inscriptions_mois') || 0)} ce mois`, '', 'vert'],
      ['En essai gratuit', nombre(champ(s, 'essais', 'boutiques_essai')), `${nombre(champ(s, 'essais_fin_semaine') || 0)} finissent cette semaine`, '', 'orange'],
      ['Revenus du mois', nombre(revenus), `GNF${evolution === null ? '' : ` · ${evolution >= 0 ? '+' : ''}${evolution} % vs mois préc.`}`, 'vert', evolution !== null && evolution < 0 ? 'rouge' : 'vert'],
      ['Licences à renouveler', nombre(champ(s, 'a_renouveler_7j', 'renouveler_7j')), 'dans les 7 jours', 'orange', 'orange'],
      ['Ventes enregistrées (mois)', nombre(champ(s, 'ventes_mois')), `${formatMillions(champ(s, 'ventes_mois_montant', 'montant_ventes_mois') || 0)} GNF traités`, '', ''],
      ['SMS envoyés (mois)', nombre(sms), `${sms ? (Math.round((echecs / sms) * 1000) / 10).toString().replace('.', ',') : 0} % d’échecs`, '', '']
    ];
    zone('kpis').innerHTML = kpis.map(([l, v, sous, encre, encreSous]) => `
      <div class="adm-kpi"><span class="adm-kpi-libelle">${esc(l)}</span><span class="adm-kpi-valeur ${encre}">${esc(v)}</span><span class="adm-kpi-sous ${encreSous}">${esc(sous)}</span></div>`).join('');

    zone('graphique').innerHTML = graphique(liste(s.revenus_6_mois));

    const t = s.a_traiter || {};
    const lignes = [
      [t.paiements_a_valider, 'Paiements à valider', 'Licence à prolonger ou SMS à ajouter', 'marque', '#/licences'],
      [champ(s, 'a_renouveler_7j', 'renouveler_7j'), 'Licences qui expirent sous 7 jours', 'Relancer par SMS en un clic', 'orange', '#/licences'],
      [t.support_ouvertes, 'Demandes d’aide ouvertes', t.support_24h ? `Dont ${t.support_24h} depuis plus de 24 h` : 'À traiter dans Support', 'rouge', '#/support'],
      [t.inactives_7j, 'Boutiques inactives depuis 7 jours', 'Aucune vente enregistrée', 'gris', '#/boutiques?filtre=inactives'],
      [t.sans_credit_sms, 'Boutiques sans crédit SMS', 'Alertes et reçus bloqués', 'orange', '#/sms'],
      [t.sms_echecs_jour, 'SMS en échec aujourd’hui', 'Voir la file et les échecs', 'gris', '#/sms?statut=echec']
    ];
    // Stockage ou base au-delà du seuil d'alerte : passer au plan Pro de Supabase.
    const st = await infosStockage;
    const maxPct = st ? Math.max(Number(st.stockage_pourcent) || 0, Number(st.base_pourcent) || 0) : 0;
    if (st && maxPct >= st.alerte_pourcent) {
      const quoi = Number(st.stockage_pourcent) >= Number(st.base_pourcent) ? 'Stockage' : 'Base de données';
      lignes.unshift([`${Math.round(maxPct)} %`, `${quoi} à ${Math.round(maxPct)} % — passer au plan Pro de Supabase`, 'Ou nettoyer les fichiers inutiles (Stockage)', 'rouge', '#/stockage']);
    }
    zone('traiter').innerHTML = lignes.map(([n, l, sous, couleur, href]) => `
      <a class="adm-traiter" href="${href}">
        <span class="adm-traiter-n ${couleur}">${typeof n === 'string' ? esc(n) : nombre(n || 0)}</span>
        <span class="adm-traiter-textes"><span class="gras">${esc(l)}</span><span class="discret">${esc(sous)}</span></span>
        <span aria-hidden="true">›</span>
      </a>`).join('');

    const dernieres = liste(s.dernieres);
    zone('dernieres').innerHTML = dernieres.length ? dernieres.map((b) => `
      <a class="adm-ligne-boutique" href="#/boutiques/${encodeURIComponent(b.id)}">
        ${avatarBoutique(b)}
        <span class="adm-ligne-textes"><span class="gras">${esc(b.nom)}</span>
          <span class="discret">${esc([TYPES[b.type_activite] || b.type_activite, b.ville, telLocal(champ(b, 'telephone', 'tel_proprietaire'))].filter(Boolean).join(' · '))}</span></span>
        <span class="discret adm-quand">${esc(ilYa(b.created_at))}</span>
        ${badgeLicence(b)}
      </a>`).join('') : '<p class="vide-admin">Aucune inscription récente.</p>';

    const sa = s.sante || {};
    const base = Number(champ(sa, 'taille_base_octets')) || 0;
    const stockage = Number(champ(sa, 'stockage_octets')) || 0;
    const dernierSms = champ(sa, 'dernier_sms_envoye');
    const attente = Number(champ(sa, 'sms_en_attente')) || 0;
    const ancienSms = dernierSms ? (Date.now() - new Date(dernierSms)) / 60000 : null;
    const sante = [
      st ? ['Base de données', `${taille(st.base_octets)} / ${taille(st.base_limite)} · ${Math.round(st.base_pourcent)} %`, pastille(Math.round(st.base_pourcent), st.alerte_pourcent)]
        : ['Base de données', `${champ(sa, 'taille_base') || tailleTexte(base)} / 500 Mo · ${pct(base, PLAN_BASE)} %`, pastille(pct(base, PLAN_BASE))],
      ['Envoi SMS (Nimba)', sa.sms_actif === false ? 'Envoi coupé (Paramètres SMS)' : `${dernierSms ? `dernier envoi ${ilYa(dernierSms)}` : 'aucun envoi'} · ${nombre(attente)} en file`,
        sa.sms_actif === false ? 'rouge' : (attente > 50 && ancienSms > 10 ? 'rouge' : attente > 0 && ancienSms > 5 ? 'orange' : 'vert')],
      ['Tâches planifiées', attente > 0 && ancienSms > 5 ? 'Messages en retard : vérifier la tâche chaque minute' : 'Messages chaque minute · affiches 6 h · relances 10 h', attente > 0 && ancienSms > 5 ? 'orange' : 'vert'],
      st ? ['Stockage des fichiers', `${taille(st.stockage_octets)} / ${taille(st.stockage_limite)} · ${Math.round(st.stockage_pourcent)} % · ${Number(st.orphelins?.nb) || 0} orphelin(s)`, pastille(Math.round(st.stockage_pourcent), st.alerte_pourcent), '#/stockage']
        : ['Stockage photos', `${tailleTexte(stockage)} / 1 Go · ${pct(stockage, PLAN_STOCKAGE)} %`, pastille(pct(stockage, PLAN_STOCKAGE))],
      ['Maintenance', sa.maintenance ? 'Activée : les boutiques sont bloquées' : 'Désactivée', sa.maintenance ? 'rouge' : 'vert']
    ];
    zone('sante').innerHTML = sante.map(([l, v, c, lien]) => `
      <${lien ? `a href="${lien}"` : 'div'} class="adm-sante"><span class="adm-point ${c}" aria-hidden="true"></span><span class="gras">${esc(l)}</span><span class="discret">${esc(v)}</span></${lien ? 'a' : 'div'}>`).join('');
  })();
}
