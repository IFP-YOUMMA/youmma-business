// nettoyer-images — Fonction Edge de YOUMMA Business : supprime les images qui ne servent plus
// (photos remplacées ou supprimées depuis plus de 2 jours) dans les buckets « produits » et « documents ».
//
// Vérification du JWT DÉSACTIVÉE au déploiement (--no-verify-jwt) : la tâche planifiée (chaque dimanche
// à 3 h 30) n'a pas de JWT. La fonction vérifie elle-même l'appelant :
//   - soit l'en-tête x-cron-secret, comparé à la RPC secret_envoi (tâche planifiée) ;
//   - soit le JWT d'un super admin (bouton « Nettoyer maintenant » du panneau d'administration) ;
//   sinon 401 (aucune preuve) ou 403 (connecté mais pas super admin).
//
// Liste : rpc('images_orphelines', { p_limite: 500 }) (service_role). Suppression par lots de 100 avec l'API
// Storage (storage.from(bucket).remove([...])) — jamais de DELETE SQL sur storage.objects, jamais le bucket « bons ».
// Réponse : { supprimes, octets }.
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase : AUCUNE valeur secrète
// n'est écrite dans ce fichier.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ORIGINES = ['https://ifp-youmma.github.io'];
const BUCKETS_AUTORISES = ['produits', 'documents'];
const TAILLE_LOT = 100;
const LIMITE = 500;

function enTetesCors(req: Request): Record<string, string> {
  const origine = req.headers.get('origin') ?? '';
  const autorisee = ORIGINES.includes(origine) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origine);
  return {
    'Access-Control-Allow-Origin': autorisee ? origine : ORIGINES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

/** Comparaison à temps constant (le secret ne fuit pas par la durée de la réponse). */
function egal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

type Orpheline = { bucket?: string; bucket_id?: string; chemin?: string; name?: string; path?: string; octets?: number; taille?: number; size?: number };

Deno.serve(async (req: Request) => {
  const cors = enTetesCors(req);
  const json = (corps: unknown, status = 200) =>
    new Response(JSON.stringify(corps), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ erreur: 'METHODE_INTERDITE' }, 405);

  const service = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Appelant : tâche planifiée (secret) ou super admin (JWT).
  const secretRecu = req.headers.get('x-cron-secret') ?? '';
  let autorise = false;
  if (secretRecu) {
    const { data: secret, error } = await service.rpc('secret_envoi');
    if (error || !secret || !egal(secretRecu, String(secret))) return json({ erreur: 'NON_AUTORISE' }, 401);
    autorise = true;
  } else {
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ erreur: 'NON_AUTORISE' }, 401);
    const { data: lu, error } = await service.auth.getUser(jwt);
    if (error || !lu?.user) return json({ erreur: 'NON_AUTORISE' }, 401);
    const { data: role, error: erreurRole } = await service.rpc('admin_role_de', { p_user: lu.user.id });
    if (erreurRole) return json({ erreur: 'ERREUR_SERVEUR' }, 500);
    if (role !== 'super_admin') return json({ erreur: 'ACCES_REFUSE' }, 403);
    autorise = true;
  }
  if (!autorise) return json({ erreur: 'NON_AUTORISE' }, 401);

  // 2. Fichiers orphelins (déjà filtrés par la base : inutilisés depuis plus de 2 jours).
  const { data, error } = await service.rpc('images_orphelines', { p_limite: LIMITE });
  if (error) return json({ erreur: 'ERREUR_SERVEUR', detail: error.message }, 500);
  const parBucket = new Map<string, { chemin: string; octets: number }[]>();
  for (const o of (data ?? []) as Orpheline[]) {
    const bucket = String(o.bucket ?? o.bucket_id ?? '');
    const chemin = String(o.chemin ?? o.name ?? o.path ?? '');
    if (!BUCKETS_AUTORISES.includes(bucket) || !chemin) continue; // jamais « bons », jamais un autre bucket
    const liste = parBucket.get(bucket) ?? [];
    liste.push({ chemin, octets: Number(o.octets ?? o.taille ?? o.size ?? 0) || 0 });
    parBucket.set(bucket, liste);
  }

  // 3. Suppression par lots de 100 avec l'API Storage.
  let supprimes = 0;
  let octets = 0;
  const echecs: string[] = [];
  for (const [bucket, fichiers] of parBucket) {
    for (let i = 0; i < fichiers.length; i += TAILLE_LOT) {
      const lot = fichiers.slice(i, i + TAILLE_LOT);
      const { data: retires, error: erreurSuppression } = await service.storage.from(bucket).remove(lot.map((f) => f.chemin));
      if (erreurSuppression) { echecs.push(`${bucket} : ${erreurSuppression.message}`); continue; }
      const noms = new Set((retires ?? []).map((r: { name: string }) => r.name));
      // Seuls les fichiers confirmés par l'API Storage sont comptés.
      for (const f of lot) {
        if (noms.has(f.chemin)) { supprimes++; octets += f.octets; }
      }
    }
  }
  console.log(`[nettoyer-images] ${supprimes} fichier(s) supprimé(s), ${octets} octets${echecs.length ? `, ${echecs.length} lot(s) en échec` : ''}`);
  return json({ supprimes, octets, ...(echecs.length ? { echecs } : {}) });
});
