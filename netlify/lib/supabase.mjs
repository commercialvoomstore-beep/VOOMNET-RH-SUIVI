import pg from 'pg';

export const SUPABASE_URL = 'https://hibhvszfgldgxzcxhmou.supabase.co';
// La clé publishable est publique et ne confère aucun droit privilégié.
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable__l9N851qkB3FG9kHItbPiQ_tpfTB7QY';
let pool;
export function config() {
  const { DATABASE_URL, RH_ALLOWED_ORIGIN } = process.env;
  if (!DATABASE_URL || !RH_ALLOWED_ORIGIN) throw new Error('Configuration serveur incomplète');
  const origin = new URL(RH_ALLOWED_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== RH_ALLOWED_ORIGIN) throw new Error('Origine invalide');
  return { DATABASE_URL, origin: origin.origin };
}
export function getPool(cfg) {
  if (!pool) pool = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000, ssl: { rejectUnauthorized: true } });
  return pool;
}
export async function verifySupabaseToken(token, fetcher = fetch) {
  let response;
  try { response = await fetcher(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
  catch { const error = new Error('Authentification indisponible'); error.status = 503; throw error; }
  if (!response.ok) { const error = new Error('Session invalide'); error.status = response.status >= 500 || response.status === 429 ? 503 : 401; throw error; }
  const user = await response.json();
  if (typeof user.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) throw new Error('Identité invalide');
  return user.id;
}
