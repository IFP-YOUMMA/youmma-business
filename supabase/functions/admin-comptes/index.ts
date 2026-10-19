// admin-comptes — Fonction Edge de YOUMMA Business : comptes gérés par l'équipe YOUMMA.
//
// Vérification du JWT ACTIVÉE (déployer SANS --no-verify-jwt). L'appelant doit être connecté
// et faire partie de l'équipe YOUMMA (admin_role_de → 'super_admin' ou 'agent'), sinon 403.
//
// Actions (POST JSON { action, ... }) :
//   creer_boutique   { telephone, nom_proprietaire, nom_boutique, type, ville, formule }
//                    → crée le compte (mot de passe provisoire de 6 chiffres) puis la boutique.
//                      Agent : formule « essai » seulement.            Réponse { boutique_id, mot_de_passe }
//   reinitialiser_mdp { user_id } → nouveau mot de passe provisoire (un agent ne peut pas viser un admin).
//                                                                       Réponse { mot_de_passe }
//   bloquer / debloquer { user_id } → super admin seulement.             Réponse { ok: true }
//
// Le mot de passe n'est jamais journalisé (ni console, ni admin_actions).
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par
// Supabase : AUCUNE valeur secrète n'est écrite dans ce fichier.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ORIGINES = ['https://ifp-youmma.github.io'];
const DOMAINE_TECHNIQUE = 'tel.yoummabusiness.app';
const TYPES = ['materiaux', 'habillement', 'alimentation', 'services', 'general'];

function enTetesCors(req: Request): Record<string, string> {
  const origine = req.headers.get('origin') ?? '';
  // GitHub Pages en production ; localhost pour les essais sur un poste de développement.
  const autorisee = ORIGINES.includes(origine) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origine);
  return {
    'Access-Control-Allow-Origin': autorisee ? origine : ORIGINES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

class ErreurAdmin extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

/** 6 chiffres aléatoires (générateur cryptographique). */
function motDePasseProvisoire(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, '0');
}

/** 6XX XX XX XX, +224…, 00224… → 224XXXXXXXXX, sinon null. */
function normaliserTelephone(saisie: unknown): string | null {
  let c = String(saisie ?? '').trim().replace(/[\s.\-()]/g, '');
  if (c.startsWith('+')) c = c.slice(1);
  else if (c.startsWith('00')) c = c.slice(2);
  if (!/^\d+$/.test(c)) return null;
  if (c.length === 9) c = '224' + c;
  return /^224[36]\d{8}$/.test(c) ? c : null;
}

const texte = (v: unknown, max = 80) => String(v ?? '').trim().slice(0, max);

Deno.serve(async (req: Request) => {
  const cors = enTetesCors(req);
  const json = (corps: unknown, status = 200) =>
    new Response(JSON.stringify(corps), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ erreur: 'METHODE_INTERDITE' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // 1. Appelant : JWT → utilisateur → rôle dans l'équipe YOUMMA.
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) throw new ErreurAdmin('NON_CONNECTE', 401);
    const { data: lu, error: erreurUtilisateur } = await service.auth.getUser(jwt);
    if (erreurUtilisateur || !lu?.user) throw new ErreurAdmin('NON_CONNECTE', 401);
    const appelant = lu.user;
    const { data: role, error: erreurRole } = await service.rpc('admin_role_de', { p_user: appelant.id });
    if (erreurRole) throw new ErreurAdmin('ERREUR_SERVEUR', 500);
    if (role !== 'super_admin' && role !== 'agent') throw new ErreurAdmin('ACCES_REFUSE', 403);
    const superAdmin = role === 'super_admin';

    const corps = await req.json().catch(() => ({}));
    const action = String(corps?.action ?? '');

    // 2a. Créer une boutique pour un client.
    if (action === 'creer_boutique') {
      const telephone = normaliserTelephone(corps.telephone);
      if (!telephone) throw new ErreurAdmin('TELEPHONE_INVALIDE');
      const nomProprietaire = texte(corps.nom_proprietaire);
      const nomBoutique = texte(corps.nom_boutique);
      if (nomProprietaire.length < 2 || nomBoutique.length < 2) throw new ErreurAdmin('NOM_REQUIS');
      const type = TYPES.includes(corps.type) ? corps.type : 'general';
      const formule = texte(corps.formule || 'essai', 30).toLowerCase();
      if (!superAdmin && formule !== 'essai') throw new ErreurAdmin('ACCES_REFUSE', 403);

      const motDePasse = motDePasseProvisoire();
      const { data: cree, error: erreurCreation } = await service.auth.admin.createUser({
        email: `${telephone}@${DOMAINE_TECHNIQUE}`,
        password: motDePasse,
        email_confirm: true,
        user_metadata: { nom: nomProprietaire, telephone },
      });
      if (erreurCreation || !cree?.user) {
        const deja = /already|exists|registered/i.test(erreurCreation?.message ?? '') || (erreurCreation as { status?: number })?.status === 422;
        throw new ErreurAdmin(deja ? 'COMPTE_EXISTE' : 'CREATION_IMPOSSIBLE', deja ? 409 : 500);
      }
      const { data: boutique, error: erreurBoutique } = await service.rpc('admin_creer_boutique_pour', {
        p_admin: appelant.id,
        p_user: cree.user.id,
        p_nom: nomBoutique,
        p_type: type,
        p_ville: texte(corps.ville, 60) || null,
        p_telephone: telephone,
        p_nom_proprietaire: nomProprietaire,
        p_formule: formule,
      });
      if (erreurBoutique) {
        // Pas de compte orphelin : on retire le compte créé si la boutique n'a pas pu l'être.
        await service.auth.admin.deleteUser(cree.user.id).catch(() => null);
        throw new ErreurAdmin(String(erreurBoutique.message || 'CREATION_IMPOSSIBLE').match(/[A-Z_]{6,}/)?.[0] ?? 'CREATION_IMPOSSIBLE');
      }
      const boutiqueId = typeof boutique === 'string' ? boutique : (boutique?.boutique_id ?? boutique?.id ?? null);
      return json({ boutique_id: boutiqueId, user_id: cree.user.id, telephone, mot_de_passe: motDePasse });
    }

    // 2b. Nouveau mot de passe provisoire.
    if (action === 'reinitialiser_mdp') {
      const cible = String(corps.user_id ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(cible)) throw new ErreurAdmin('COMPTE_INTROUVABLE', 404);
      const { data: roleCible } = await service.rpc('admin_role_de', { p_user: cible });
      if (!superAdmin && (roleCible === 'super_admin' || roleCible === 'agent')) throw new ErreurAdmin('ACCES_REFUSE', 403);
      const motDePasse = motDePasseProvisoire();
      const { error } = await service.auth.admin.updateUserById(cible, { password: motDePasse });
      if (error) throw new ErreurAdmin(/not.?found/i.test(error.message) ? 'COMPTE_INTROUVABLE' : 'ERREUR_SERVEUR', /not.?found/i.test(error.message) ? 404 : 500);
      const { error: erreurJournal } = await service.rpc('admin_mdp_reinitialise', { p_admin: appelant.id, p_user: cible });
      if (erreurJournal) throw new ErreurAdmin('ERREUR_SERVEUR', 500);
      return json({ mot_de_passe: motDePasse });
    }

    // 2c. Bloquer / débloquer un compte (super admin).
    if (action === 'bloquer' || action === 'debloquer') {
      if (!superAdmin) throw new ErreurAdmin('ACCES_REFUSE', 403);
      const cible = String(corps.user_id ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(cible)) throw new ErreurAdmin('COMPTE_INTROUVABLE', 404);
      if (cible === appelant.id) throw new ErreurAdmin('PAS_SOI_MEME');
      const { error } = await service.auth.admin.updateUserById(cible, { ban_duration: action === 'bloquer' ? '876000h' : 'none' });
      if (error) throw new ErreurAdmin('COMPTE_INTROUVABLE', 404);
      await service.rpc('admin_journal_externe', {
        p_admin: appelant.id,
        p_action: action === 'bloquer' ? 'utilisateur_bloque' : 'utilisateur_debloque',
        p_boutique: null,
        p_details: { user_id: cible },
      });
      return json({ ok: true });
    }

    throw new ErreurAdmin('ACTION_INCONNUE');
  } catch (err) {
    if (err instanceof ErreurAdmin) return json({ erreur: err.code }, err.status);
    console.error('[admin-comptes]', (err as Error)?.message ?? err);
    return json({ erreur: 'ERREUR_SERVEUR' }, 500);
  }
});
