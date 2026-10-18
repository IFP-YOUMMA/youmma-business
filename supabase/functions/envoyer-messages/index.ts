// envoyer-messages — Fonction Edge de YOUMMA Business : envoie les SMS de la file d'attente via Nimba SMS.
//
// Appelée chaque minute par pg_cron (cron_messages) avec l'en-tête x-cron-secret.
//  1. Vérifie le secret (comparé à la RPC secret_envoi, lue avec la clé service_role).
//  2. Jusqu'à 5 tours : prendre_messages(40) → envoi Nimba → terminer_message(ok / erreur).
//  3. Répond { envoyes, echecs }.
//
// Format Nimba repris de YOUMMA JOBS (supabase/functions/notif-devis) :
// POST https://api.nimbasms.com/v1/messages, Basic base64(SID:TOKEN), { to: ["+224…"], sender_name, message }.
//
// Secrets (Edge Functions → Secrets) : NIMBA_SID, NIMBA_TOKEN, NIMBA_SENDER.
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.
// AUCUNE valeur secrète ne doit être écrite dans ce fichier.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL_NIMBA = 'https://api.nimbasms.com/v1/messages';
const EXPEDITEUR_PAR_DEFAUT = 'YOUMMA JOBS'; // nom d'expéditeur de YOUMMA JOBS (si NIMBA_SENDER est absent)
const MAX_TOURS = 5;
const TAILLE_LOT = 40;
const DELAI_NIMBA_MS = 15000;

type Message = { id: string; destinataire: string; texte: string };

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } });

/** Comparaison en temps constant (évite de deviner le secret caractère par caractère). */
function egal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 224XXXXXXXXX, +224…, 00224… ou 6XX… → +224XXXXXXXXX (format utilisé par YOUMMA JOBS), sinon null. */
function versE164(numero: string): string | null {
  let chiffres = String(numero || '').replace(/[\s.\-()]/g, '');
  if (chiffres.startsWith('+')) chiffres = chiffres.slice(1);
  else if (chiffres.startsWith('00')) chiffres = chiffres.slice(2);
  if (/^\d{9}$/.test(chiffres)) chiffres = '224' + chiffres;
  return /^224\d{9}$/.test(chiffres) ? '+' + chiffres : null;
}

/** Envoie un SMS. Renvoie null si succès (HTTP 2xx), sinon le texte de l'erreur. */
async function envoyerNimba(numero: string, message: string, identifiants: string, expediteur: string): Promise<string | null> {
  const e164 = versE164(numero);
  if (!e164) return `Numero invalide : ${numero}`;
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), DELAI_NIMBA_MS);
  try {
    const reponse = await fetch(URL_NIMBA, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + identifiants,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ to: [e164], sender_name: expediteur, message }),
      signal: controleur.signal,
    });
    if (reponse.ok) return null;
    const corps = await reponse.text().catch(() => '');
    return `HTTP ${reponse.status} ${corps.slice(0, 180)}`.trim();
  } catch (erreur) {
    return `Erreur reseau : ${String((erreur as Error)?.message || erreur).slice(0, 180)}`;
  } finally {
    clearTimeout(minuterie);
  }
}

Deno.serve(async (req: Request) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false },
  });

  // 1. Secret partagé avec pg_cron.
  const { data: secret, error: erreurSecret } = await supabase.rpc('secret_envoi');
  const recu = req.headers.get('x-cron-secret') ?? '';
  if (erreurSecret || !secret || !egal(recu, String(secret))) {
    return json({ erreur: 'Non autorise' }, 401);
  }

  const sid = Deno.env.get('NIMBA_SID');
  const token = Deno.env.get('NIMBA_TOKEN');
  if (!sid || !token) return json({ erreur: 'Secrets NIMBA_SID / NIMBA_TOKEN manquants' }, 500);
  const identifiants = btoa(`${sid}:${token}`);
  const expediteur = Deno.env.get('NIMBA_SENDER') || EXPEDITEUR_PAR_DEFAUT;

  // 2. Vider la file par lots.
  let envoyes = 0;
  let echecs = 0;
  for (let tour = 0; tour < MAX_TOURS; tour++) {
    const { data: lot, error } = await supabase.rpc('prendre_messages', { p_limite: TAILLE_LOT });
    if (error) return json({ envoyes, echecs, erreur: error.message }, 500);
    const messages = (lot ?? []) as Message[];
    if (!messages.length) break;

    for (const m of messages) {
      // Une erreur sur un message n'arrête pas les autres.
      const erreurEnvoi = await envoyerNimba(m.destinataire, m.texte, identifiants, expediteur);
      const { error: erreurFin } = await supabase.rpc('terminer_message', {
        p_id: m.id,
        p_ok: erreurEnvoi === null,
        p_erreur: erreurEnvoi,
      });
      if (erreurFin) console.error('[envoyer-messages] terminer_message', m.id, erreurFin.message);
      if (erreurEnvoi === null) envoyes++;
      else echecs++;
    }
    if (messages.length < TAILLE_LOT) break;
  }

  return json({ envoyes, echecs });
});
