// connecter-reseau — Fonction Edge de YOUMMA Business : connexion des pages Facebook / comptes Instagram et TikTok (OAuth).
//
// Le jeton d'accès ne passe JAMAIS par le dépôt ni par le navigateur du boutiquier au-delà de l'échange OAuth :
// le réseau renvoie un « code » à CETTE fonction, qui l'échange côté serveur et enregistre le jeton par
// connecter_reseau(...) avec la clé service_role.
//
// Appels :
//  POST { action: 'config' }                          → { facebook, instagram, tiktok } (réseaux connectables)
//  POST { action: 'debut', reseau, boutique, retour } → { url } (adresse d'autorisation) ; JWT de l'utilisateur obligatoire,
//                                                        propriétaire ou gérant de la boutique.
//  GET  ?code=…&state=…  (retour de Meta ou TikTok)   → échange du code, enregistrement, redirection vers l'appli
//                                                        (…&reseau=ok ou …&reseau=erreur).
//
// Secrets (Edge Functions → Secrets) — AUCUNE valeur dans ce fichier :
//   META_APP_ID, META_APP_SECRET          (application Meta : Facebook + Instagram)
//   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET (application TikTok)
//   OAUTH_STATE_SECRET                     (chaîne aléatoire longue : signe le paramètre « state »)
//   APP_ORIGINES (facultatif)              (adresses autorisées pour le retour, séparées par des virgules ;
//                                            défaut : https://ifp-youmma.github.io)
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.
// Déploiement : supabase functions deploy connecter-reseau --no-verify-jwt (le retour de Meta/TikTok n'a pas de JWT ;
// la fonction vérifie elle-même le JWT pour l'action « debut »).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GRAPH = 'https://graph.facebook.com/v21.0';
const SCOPES_META = 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management';
const SCOPES_TIKTOK = 'user.info.basic,video.publish';
const DUREE_STATE_MS = 15 * 60 * 1000;

const env = (k: string) => Deno.env.get(k) ?? '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const redirection = (url: string) => new Response(null, { status: 302, headers: { Location: url } });
const adresseRetour = () => `${env('SUPABASE_URL')}/functions/v1/connecter-reseau`;

const metaPret = () => Boolean(env('META_APP_ID') && env('META_APP_SECRET') && env('OAUTH_STATE_SECRET'));
const tiktokPret = () => Boolean(env('TIKTOK_CLIENT_KEY') && env('TIKTOK_CLIENT_SECRET') && env('OAUTH_STATE_SECRET'));

/* ------------------------------------------------------------ state signé (HMAC-SHA256) */

const b64url = (octets: Uint8Array) => btoa(String.fromCharCode(...octets)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function cle() {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env('OAUTH_STATE_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signer(contenu: Record<string, unknown>): Promise<string> {
  const corps = b64url(new TextEncoder().encode(JSON.stringify(contenu)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await cle(), new TextEncoder().encode(corps)));
  return `${corps}.${b64url(sig)}`;
}
async function verifier(state: string): Promise<Record<string, any> | null> {
  const [corps, sig] = String(state || '').split('.');
  if (!corps || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await cle(), deB64url(sig), new TextEncoder().encode(corps));
  if (!ok) return null;
  const c = JSON.parse(new TextDecoder().decode(deB64url(corps)));
  return Number(c.exp) > Date.now() ? c : null;
}

function retourAutorise(retour: string): boolean {
  const origines = (env('APP_ORIGINES') || 'https://ifp-youmma.github.io').split(',').map((x) => x.trim()).filter(Boolean);
  try { const u = new URL(retour); return origines.some((o) => u.origin === new URL(o).origin); } catch { return false; }
}
const avecResultat = (retour: string, resultat: 'ok' | 'erreur') => `${retour}${retour.includes('?') ? '&' : '?'}reseau=${resultat}`;

/* ------------------------------------------------------------ Enregistrement (clé service_role) */

const service = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

/** Paramètres supposés de connecter_reseau (à ajuster ici seulement si la fonction SQL diffère). */
async function enregistrer(boutique: string, reseau: string, compteId: string, nom: string, jeton: string, expireLe: string | null) {
  const { error } = await service().rpc('connecter_reseau', {
    p_boutique: boutique, p_reseau: reseau, p_compte_id: compteId, p_nom: nom, p_jeton: jeton, p_expire_le: expireLe,
  });
  if (error) throw new Error(`connecter_reseau : ${error.message}`);
}

/* ------------------------------------------------------------ Meta (Facebook + Instagram) */

async function echangeMeta(code: string, state: Record<string, any>) {
  const q = new URLSearchParams({ client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET'), redirect_uri: adresseRetour(), code });
  const court = await (await fetch(`${GRAPH}/oauth/access_token?${q}`)).json();
  if (!court?.access_token) throw new Error('Echange du code refuse par Meta');
  // Jeton utilisateur longue durée → jetons de page sans expiration.
  const ql = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET'), fb_exchange_token: court.access_token });
  const long = await (await fetch(`${GRAPH}/oauth/access_token?${ql}`)).json();
  const jetonUtilisateur = long?.access_token || court.access_token;
  const pages = await (await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(jetonUtilisateur)}`)).json();
  const page = (pages?.data || [])[0];
  if (!page?.access_token) throw new Error('Aucune page Facebook administrée par ce compte');
  // Si plusieurs pages : la première est retenue (le boutiquier n'en a en général qu'une).
  await enregistrer(state.b, 'facebook', page.id, page.name, page.access_token, null);
  const ig = page.instagram_business_account;
  if (ig?.id) await enregistrer(state.b, 'instagram', ig.id, ig.username ? `@${ig.username}` : 'Instagram', page.access_token, null);
}

/* ------------------------------------------------------------ TikTok */

async function echangeTiktok(code: string, state: Record<string, any>) {
  const corps = new URLSearchParams({
    client_key: env('TIKTOK_CLIENT_KEY'), client_secret: env('TIKTOK_CLIENT_SECRET'), code, grant_type: 'authorization_code', redirect_uri: adresseRetour(),
  });
  const r = await (await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: corps })).json();
  if (!r?.access_token) throw new Error('Echange du code refuse par TikTok');
  const info = await (await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username', { headers: { Authorization: `Bearer ${r.access_token}` } })).json();
  const u = info?.data?.user || {};
  const expire = r.expires_in ? new Date(Date.now() + Number(r.expires_in) * 1000).toISOString() : null;
  await enregistrer(state.b, 'tiktok', r.open_id || u.open_id, u.username ? `@${u.username}` : (u.display_name || 'TikTok'), r.access_token, expire);
}

/* ------------------------------------------------------------ Point d'entrée */

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Retour OAuth (GET depuis Meta ou TikTok).
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const state = await verifier(url.searchParams.get('state') || '').catch(() => null);
    if (!state || !retourAutorise(state.ret)) return new Response('Lien expiré ou invalide.', { status: 400 });
    const code = url.searchParams.get('code');
    if (!code) return redirection(avecResultat(state.ret, 'erreur'));
    try {
      if (state.r === 'tiktok') await echangeTiktok(code, state);
      else await echangeMeta(code, state);
      return redirection(avecResultat(state.ret, 'ok'));
    } catch (e) {
      // Message sans jeton (les jetons ne sont jamais concaténés aux erreurs).
      console.error('[connecter-reseau]', state.r, (e as Error)?.message || 'erreur');
      return redirection(avecResultat(state.ret, 'erreur'));
    }
  }

  const corps = await req.json().catch(() => ({}));
  if (corps.action === 'config') return json({ facebook: metaPret(), instagram: metaPret(), tiktok: tiktokPret() });

  if (corps.action === 'debut') {
    const reseau = String(corps.reseau || '');
    if (!['facebook', 'instagram', 'tiktok'].includes(reseau)) return json({ erreur: 'RESEAU_INCONNU' }, 400);
    if (reseau === 'tiktok' ? !tiktokPret() : !metaPret()) return json({ erreur: 'NON_CONFIGURE' }, 400);
    if (!retourAutorise(String(corps.retour || ''))) return json({ erreur: 'RETOUR_INVALIDE' }, 400);
    // L'utilisateur doit être propriétaire ou gérant de la boutique.
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await service().auth.getUser(jwt);
    if (!u?.user) return json({ erreur: 'NON_CONNECTE' }, 401);
    const { data: membre } = await service().from('membres').select('role').eq('boutique_id', corps.boutique).eq('user_id', u.user.id).eq('actif', true).maybeSingle();
    if (!membre || !['proprietaire', 'gerant'].includes(membre.role)) return json({ erreur: 'ACCES_REFUSE' }, 403);
    const state = await signer({ b: corps.boutique, u: u.user.id, r: reseau, ret: corps.retour, exp: Date.now() + DUREE_STATE_MS });
    const url = reseau === 'tiktok'
      ? `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({ client_key: env('TIKTOK_CLIENT_KEY'), scope: SCOPES_TIKTOK, response_type: 'code', redirect_uri: adresseRetour(), state })}`
      : `https://www.facebook.com/v21.0/dialog/oauth?${new URLSearchParams({ client_id: env('META_APP_ID'), redirect_uri: adresseRetour(), scope: SCOPES_META, response_type: 'code', state })}`;
    return json({ url });
  }
  return json({ erreur: 'ACTION_INCONNUE' }, 400);
});
