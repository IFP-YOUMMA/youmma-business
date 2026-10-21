// publier-reseaux — Fonction Edge de YOUMMA Business : publie les affiches du jour sur Facebook, Instagram et TikTok.
//
// Appelée par pg_cron avec l'en-tête x-cron-secret (même secret que envoyer-messages : RPC secret_envoi).
//  1. Vérifie le secret.
//  2. prendre_publications(10) → pour chaque ligne : publication sur le réseau → terminer_publication(id, ok, post_id, url, erreur).
//  3. Répond { publiees, echecs }.
//
// Réseaux :
//  - Facebook  : POST /v21.0/<compte_id>/photos (url, caption, access_token)
//  - Instagram : POST /v21.0/<compte_id>/media (image_url, caption) puis POST /v21.0/<compte_id>/media_publish (creation_id)
//  - TikTok    : Content Posting API, publication de la vidéo (ou de la photo 9:16) à partir de son URL (PULL_FROM_URL)
// Jamais plus de 3 essais par publication. Les jetons ne sont JAMAIS écrits dans les journaux ni dans les erreurs.
//
// Secrets : aucun ici. Les jetons des pages viennent de la base (prendre_publications, clé service_role).
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TIKTOK = 'https://open.tiktokapis.com/v2';
const TAILLE_LOT = 10;
const MAX_ESSAIS = 3;
const DELAI_MS = 20000;

type Publication = {
  id: string;
  reseau: 'facebook' | 'instagram' | 'tiktok' | string;
  compte_id: string;
  jeton: string;
  image_url: string | null;
  video_url?: string | null;
  texte: string | null;
  essais?: number | null;
};
type Resultat = { ok: boolean; post_id?: string | null; url?: string | null; erreur?: string | null };

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } });

function egal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Retire tout jeton d'un message d'erreur avant de l'enregistrer ou de le journaliser. */
function propre(texte: string, jeton = ''): string {
  let t = String(texte || '');
  if (jeton) t = t.split(jeton).join('***');
  return t.replace(/access_token=[^&\s"]+/gi, 'access_token=***').replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer ***').slice(0, 300);
}

async function appel(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; corps: any }> {
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), DELAI_MS);
  try {
    const r = await fetch(url, { ...init, signal: controleur.signal });
    const texte = await r.text();
    let corps: any = null;
    try { corps = JSON.parse(texte); } catch { corps = { brut: texte.slice(0, 300) }; }
    return { ok: r.ok, status: r.status, corps };
  } finally {
    clearTimeout(minuterie);
  }
}

const erreurGraph = (r: { status: number; corps: any }) => `HTTP ${r.status} ${r.corps?.error?.message || r.corps?.brut || ''}`.trim();

async function facebook(p: Publication): Promise<Resultat> {
  if (!p.image_url) return { ok: false, erreur: 'Image manquante' };
  const corps = new URLSearchParams({ url: p.image_url, caption: p.texte || '', access_token: p.jeton });
  const r = await appel(`${GRAPH}/${encodeURIComponent(p.compte_id)}/photos`, { method: 'POST', body: corps });
  if (!r.ok) return { ok: false, erreur: erreurGraph(r) };
  const postId = r.corps?.post_id || r.corps?.id || null;
  return { ok: true, post_id: postId, url: postId ? `https://www.facebook.com/${postId}` : null };
}

async function instagram(p: Publication): Promise<Resultat> {
  if (!p.image_url) return { ok: false, erreur: 'Image manquante' };
  const media = await appel(`${GRAPH}/${encodeURIComponent(p.compte_id)}/media`, {
    method: 'POST', body: new URLSearchParams({ image_url: p.image_url, caption: p.texte || '', access_token: p.jeton }),
  });
  if (!media.ok || !media.corps?.id) return { ok: false, erreur: erreurGraph(media) };
  const pub = await appel(`${GRAPH}/${encodeURIComponent(p.compte_id)}/media_publish`, {
    method: 'POST', body: new URLSearchParams({ creation_id: media.corps.id, access_token: p.jeton }),
  });
  if (!pub.ok || !pub.corps?.id) return { ok: false, erreur: erreurGraph(pub) };
  const lien = await appel(`${GRAPH}/${encodeURIComponent(pub.corps.id)}?fields=permalink&access_token=${encodeURIComponent(p.jeton)}`, { method: 'GET' });
  return { ok: true, post_id: pub.corps.id, url: lien.corps?.permalink || null };
}

async function tiktok(p: Publication): Promise<Resultat> {
  const entetes = { Authorization: `Bearer ${p.jeton}`, 'Content-Type': 'application/json; charset=UTF-8' };
  const titre = (p.texte || '').slice(0, 2000);
  let r;
  if (p.video_url) {
    r = await appel(`${TIKTOK}/post/publish/video/init/`, {
      method: 'POST', headers: entetes,
      body: JSON.stringify({ post_info: { title: titre, privacy_level: 'PUBLIC_TO_EVERYONE', disable_comment: false }, source_info: { source: 'PULL_FROM_URL', video_url: p.video_url } }),
    });
  } else if (p.image_url) {
    r = await appel(`${TIKTOK}/post/publish/content/init/`, {
      method: 'POST', headers: entetes,
      body: JSON.stringify({
        post_info: { title: titre.slice(0, 90), description: titre, privacy_level: 'PUBLIC_TO_EVERYONE', disable_comment: false },
        source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: [p.image_url] },
        post_mode: 'DIRECT_POST', media_type: 'PHOTO',
      }),
    });
  } else return { ok: false, erreur: 'Vidéo ou image manquante' };
  const code = r.corps?.error?.code;
  if (!r.ok || (code && code !== 'ok')) return { ok: false, erreur: `HTTP ${r.status} ${r.corps?.error?.message || code || ''}`.trim() };
  // TikTok publie en différé : l'identifiant de publication sert au suivi ; pas encore d'URL publique.
  return { ok: true, post_id: r.corps?.data?.publish_id || null, url: null };
}

Deno.serve(async (req: Request) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false },
  });

  const { data: secret, error: erreurSecret } = await supabase.rpc('secret_envoi');
  const recu = req.headers.get('x-cron-secret') ?? '';
  if (erreurSecret || !secret || !egal(recu, String(secret))) return json({ erreur: 'Non autorise' }, 401);

  const { data: lot, error } = await supabase.rpc('prendre_publications', { p_limite: TAILLE_LOT });
  if (error) return json({ erreur: error.message }, 500);

  let publiees = 0;
  let echecs = 0;
  for (const p of (lot ?? []) as Publication[]) {
    let res: Resultat;
    if ((p.essais ?? 0) >= MAX_ESSAIS) res = { ok: false, erreur: `Abandon après ${MAX_ESSAIS} essais` };
    else {
      try {
        if (p.reseau === 'facebook') res = await facebook(p);
        else if (p.reseau === 'instagram') res = await instagram(p);
        else if (p.reseau === 'tiktok') res = await tiktok(p);
        else res = { ok: false, erreur: `Reseau inconnu : ${p.reseau}` };
      } catch (e) {
        res = { ok: false, erreur: `Erreur reseau : ${(e as Error)?.message || e}` };
      }
    }
    const erreurPropre = res.ok ? null : propre(res.erreur || 'Echec', p.jeton);
    const { error: erreurFin } = await supabase.rpc('terminer_publication', {
      p_id: p.id, p_ok: res.ok, p_post_id: res.post_id ?? null, p_url: res.url ?? null, p_erreur: erreurPropre,
    });
    if (erreurFin) console.error('[publier-reseaux] terminer_publication', p.id, erreurFin.message);
    if (!res.ok) console.warn('[publier-reseaux] echec', p.id, p.reseau, erreurPropre);
    if (res.ok) publiees++;
    else echecs++;
  }
  return json({ publiees, echecs });
});
