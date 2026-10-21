/**
 * aide.js — « Aide » (#/aide, tous les rôles) : écrire à l'équipe YOUMMA, suivre ses demandes
 * (fil des messages, réponse), ou passer par WhatsApp. Badge dans le menu quand YOUMMA a répondu
 * depuis la dernière ouverture (date mémorisée sur l'appareil).
 */
import { sb } from './supabase.js';
import { etat } from './state.js';
import { lienSupport } from './plateforme.js';
import { esc, icone, toast, boutonOccupe, messageErreur, formatDate, lireStockage, ecrireStockage } from './utils.js';

const SUJETS = ['Question sur l’appli', 'Problème technique', 'Licence et paiement', 'SMS et messages', 'Boutique en ligne', 'Autre'];
const STATUTS = { ouverte: 'Ouverte', en_cours: 'En cours', resolue: 'Résolue' };
const cleVu = () => `yb_aide_vu_${etat.boutique?.id}`;

/** Normalise une demande quelle que soit la forme exacte renvoyée par la RPC. */
function normaliser(d) {
  const messages = (d.messages || d.fil || []).map((m) => ({
    texte: m.texte ?? m.message ?? '',
    youmma: m.auteur === 'youmma' || m.de === 'youmma' || m.youmma === true || m.par_youmma === true,
    nom: m.nom || m.auteur_nom || '',
    date: m.created_at || m.date
  })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { id: d.id, sujet: d.sujet || 'Demande', statut: d.statut || 'ouverte', date: d.created_at, messages };
}

export async function chargerDemandes() {
  const { data, error } = await sb.rpc('mes_demandes_aide', { p_boutique: etat.boutique.id });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(normaliser);
}

/** Date du dernier message de YOUMMA (toutes demandes). */
const derniereReponse = (demandes) => demandes.flatMap((d) => d.messages.filter((m) => m.youmma).map((m) => String(m.date || ''))).sort().at(-1) || '';

/** Badge « Aide » du menu : une réponse de YOUMMA plus récente que la dernière ouverture. */
export async function majBadgeAide() {
  if (!etat.boutique) return;
  try {
    const demandes = await chargerDemandes();
    const nouveau = derniereReponse(demandes) > (lireStockage(cleVu(), '') || '');
    document.querySelectorAll('[data-ref="badge-aide"]').forEach((b) => { b.textContent = nouveau ? '1' : ''; b.setAttribute('aria-label', nouveau ? 'Nouvelle réponse de YOUMMA' : ''); });
  } catch { /* pas de badge */ }
}

export function afficherAide(conteneur) {
  const s = { demandes: [], ouverte: null };
  conteneur.innerHTML = `
    <div class="page page-aide">
      <header class="page-entete">
        <div class="page-titres">
          <a class="lien-retour seul-ordi" href="#/aujourdhui">← Aujourd’hui</a>
          <h1>Aide</h1>
          <span>Une question, un souci ? L’équipe YOUMMA vous répond ici ou sur WhatsApp.</span>
        </div>
        <a class="btn btn-whatsapp" href="${esc(lienSupport(`Bonjour YOUMMA, je suis ${etat.membre?.nom || ''} de la boutique ${etat.boutique.nom}.`))}" target="_blank" rel="noopener">${icone('whatsapp', 18, 2)} WhatsApp du support</a>
      </header>
      <div class="clients-corps" data-lecture-ok>
        <section class="carte section-parametres aide-formulaire">
          <h2>Nouvelle demande</h2>
          <form class="form-modale" novalidate>
            <div class="champ"><label for="aide-sujet">Sujet</label>
              <select id="aide-sujet" name="sujet" class="input">${SUJETS.map((x) => `<option>${esc(x)}</option>`).join('')}</select></div>
            <div class="champ"><label for="aide-message">Votre message</label>
              <textarea id="aide-message" name="message" class="input" rows="5" maxlength="1000" placeholder="Expliquez ce qui se passe : écran, article, message d’erreur…"></textarea></div>
            <p class="erreur-form" role="alert" hidden></p>
            <div class="actions-droite"><button type="submit" class="btn btn-primaire">Envoyer à YOUMMA</button></div>
          </form>
        </section>
        <section class="carte section-parametres aide-liste">
          <h2>Mes demandes</h2>
          <div data-zone="demandes"><p class="discret">Chargement…</p></div>
        </section>
      </div>
    </div>`;
  const zone = conteneur.querySelector('[data-zone="demandes"]');
  const form = conteneur.querySelector('form');

  function render() {
    if (!s.demandes.length) { zone.innerHTML = '<p class="discret">Aucune demande pour l’instant.</p>'; return; }
    zone.innerHTML = `<ul class="liste-demandes">${s.demandes.map((d) => {
      const dernier = d.messages.at(-1);
      const ouverte = s.ouverte === d.id;
      return `
        <li class="demande-aide ${ouverte ? 'ouverte' : ''}">
          <button type="button" class="demande-entete" data-demande="${esc(d.id)}" aria-expanded="${ouverte}">
            <span class="demande-textes"><span class="gras">${esc(d.sujet)}</span>
              <span class="discret">${esc(formatDate(d.date, 'complet'))}${dernier?.youmma ? ' · <strong class="texte-succes">YOUMMA a répondu</strong>' : ''}</span></span>
            <span class="badge-statut-aide ${esc(d.statut)}">${esc(STATUTS[d.statut] || d.statut)}</span>
          </button>
          ${ouverte ? `
            <div class="fil-aide">
              ${d.messages.map((m) => `
                <div class="bulle-aide ${m.youmma ? 'youmma' : 'moi'}">
                  <span class="bulle-auteur">${m.youmma ? 'YOUMMA' : esc(m.nom || 'Vous')} · ${esc(formatDate(m.date, 'complet'))}</span>
                  <span class="bulle-texte">${esc(m.texte)}</span>
                </div>`).join('')}
              ${d.statut !== 'resolue' ? `
                <form class="repondre-aide" data-repondre="${esc(d.id)}" novalidate>
                  <label class="sr-only" for="rep-${esc(d.id)}">Répondre</label>
                  <textarea id="rep-${esc(d.id)}" class="input" rows="2" maxlength="1000" placeholder="Répondre…"></textarea>
                  <button type="submit" class="btn btn-secondaire">Envoyer</button>
                </form>` : '<p class="discret">Demande résolue. Écrivez une nouvelle demande si besoin.</p>'}
            </div>` : ''}
        </li>`;
    }).join('')}</ul>`;
  }

  async function charger() {
    try {
      s.demandes = await chargerDemandes();
    } catch (err) {
      zone.innerHTML = `<p class="bloc-erreur">${esc(messageErreur(err))}</p>`;
      return;
    }
    if (!conteneur.isConnected) return;
    const derniere = derniereReponse(s.demandes);
    if (derniere) ecrireStockage(cleVu(), derniere);
    majBadgeAide();
    render();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = form.message.value.trim();
    const zoneErreur = form.querySelector('.erreur-form');
    if (message.length < 5) { zoneErreur.textContent = 'Écrivez votre message (quelques mots au moins).'; zoneErreur.hidden = false; return; }
    zoneErreur.hidden = true;
    const bouton = form.querySelector('[type=submit]');
    boutonOccupe(bouton, true, 'Envoi…');
    const { error } = await sb.rpc('demander_aide', { p_boutique: etat.boutique.id, p_sujet: form.sujet.value, p_message: message });
    boutonOccupe(bouton, false);
    if (error) { zoneErreur.textContent = messageErreur(error); zoneErreur.hidden = false; return; }
    form.reset();
    toast('Demande envoyée : l’équipe YOUMMA vous répond au plus vite.', 'succes');
    charger();
  });

  zone.addEventListener('click', (e) => {
    const b = e.target.closest('[data-demande]');
    if (!b) return;
    s.ouverte = s.ouverte === b.dataset.demande ? null : b.dataset.demande;
    render();
  });
  zone.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-repondre]');
    if (!f) return;
    e.preventDefault();
    const texte = f.querySelector('textarea').value.trim();
    if (!texte) return;
    const bouton = f.querySelector('button');
    boutonOccupe(bouton, true, '…');
    const { error } = await sb.rpc('repondre_aide', { p_demande: f.dataset.repondre, p_message: texte });
    boutonOccupe(bouton, false);
    if (error) { toast(messageErreur(error), 'erreur'); return; }
    toast('Message envoyé.', 'succes');
    charger();
  });
  charger();
}
