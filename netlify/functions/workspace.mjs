import pg from 'pg';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const MAX_BYTES = 4 * 1024 * 1024;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
let pool, keySet, cachedJwks;
function config() {
  const { DATABASE_URL, NEON_AUTH_BASE_URL, NEON_AUTH_JWKS_URL, RH_ALLOWED_ORIGIN } = process.env;
  if (!DATABASE_URL || !NEON_AUTH_BASE_URL || !NEON_AUTH_JWKS_URL || !RH_ALLOWED_ORIGIN) throw new Error('Configuration serveur incomplète');
  const auth = new URL(NEON_AUTH_BASE_URL), jwks = new URL(NEON_AUTH_JWKS_URL), origin = new URL(RH_ALLOWED_ORIGIN);
  if (auth.protocol !== 'https:' || jwks.href !== auth.href.replace(/\/$/, '') + '/.well-known/jwks.json' || origin.origin !== RH_ALLOWED_ORIGIN) throw new Error('Configuration serveur invalide');
  return { DATABASE_URL, auth, jwks, origin: origin.origin };
}
export async function verifyWithKeySet(token, cfg, keys) {
  const { payload } = await jwtVerify(token, keys, { issuer: cfg.auth.origin, audience: cfg.auth.origin, algorithms: ['EdDSA'] });
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 256 || !payload.exp) throw new Error('Identité invalide');
  return payload.sub;
}
async function verify(token, cfg) {
  if (cachedJwks !== cfg.jwks.href) { keySet = createRemoteJWKSet(cfg.jwks); cachedJwks = cfg.jwks.href; }
  return verifyWithKeySet(token, cfg, keySet);
}
function getPool(cfg) {
  if (!pool) pool = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000, ssl: { rejectUnauthorized: true } });
  return pool;
}
function validSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) return false;
  if (!value.sources || typeof value.sources !== 'object' || Array.isArray(value.sources)) return false;
  if (!value.contracts || typeof value.contracts !== 'object' || Array.isArray(value.contracts)) return false;
  if (!value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings)) return false;
  return Object.keys(value.sources).every(k => ['employees', 'absences', 'pointage'].includes(k) && value.sources[k] && Array.isArray(value.sources[k].rows) && value.sources[k].rows.length <= 50000 && value.sources[k].stats && typeof value.sources[k].stats === 'object') && Object.keys(value.contracts).length <= 10000;
}
export function makeHandler(deps = {}) {
  return async request => {
    let cfg;
    try { cfg = (deps.config || config)(); } catch { return json({ error: 'Service non configuré.' }, 503); }
    if (!['GET', 'PUT'].includes(request.method)) return json({ error: 'Méthode non autorisée.' }, 405);
    const origin = request.headers.get('origin');
    if ((request.method === 'PUT' && origin !== cfg.origin) || (origin && origin !== cfg.origin)) return json({ error: 'Origine non autorisée.' }, 403);
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(request.headers.get('authorization') || '');
    if (!match || match[1].length > 10000) return json({ error: 'Authentification requise.' }, 401);
    let user;
    try { user = await (deps.verify || verify)(match[1], cfg); } catch { return json({ error: 'Session invalide ou expirée.' }, 401); }
    let data;
    if (request.method === 'PUT') {
      if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return json({ error: 'JSON requis.' }, 415);
      const length = Number(request.headers.get('content-length') || 0);
      if (length > MAX_BYTES) return json({ error: 'Données trop volumineuses (4 Mo maximum).' }, 413);
      try {
        const text = await request.text();
        if (new TextEncoder().encode(text).length > MAX_BYTES) return json({ error: 'Données trop volumineuses (4 Mo maximum).' }, 413);
        data = JSON.parse(text);
      } catch { return json({ error: 'JSON invalide.' }, 400); }
      if (!data || !Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 0 || !validSnapshot(data.snapshot)) return json({ error: 'Format de données invalide.' }, 400);
    }
    let client;
    try {
      client = await (deps.pool || getPool(cfg)).connect();
      await client.query('BEGIN');
      const authorized = await client.query('SELECT 1 FROM rh_users WHERE user_id = $1 AND active = true', [user]);
      if (!authorized.rowCount) { await client.query('ROLLBACK'); return json({ error: 'Ce compte ne dispose pas des droits RH.' }, 403); }
      if (request.method === 'GET') {
        const result = await client.query('SELECT version, payload, updated_at FROM rh_workspace WHERE id = 1');
        if (!result.rowCount) throw new Error('Base non initialisée');
        const row = result.rows[0];
        await client.query('INSERT INTO rh_audit(user_id, action, version) VALUES ($1, $2, $3)', [user, 'read', row.version]);
        await client.query('COMMIT');
        return json({ version: row.version, snapshot: row.version === 0 ? null : row.payload, updatedAt: row.updated_at });
      }
      const result = await client.query('UPDATE rh_workspace SET version = version + 1, payload = $1::jsonb, updated_at = now(), updated_by = $2 WHERE id = 1 AND version = $3 RETURNING version, updated_at', [JSON.stringify(data.snapshot), user, data.expectedVersion]);
      if (!result.rowCount) { await client.query('ROLLBACK'); return json({ error: 'Conflit : les données ont changé. Rechargez avant de sauvegarder.' }, 409); }
      const row = result.rows[0];
      await client.query('INSERT INTO rh_audit(user_id, action, version) VALUES ($1, $2, $3)', [user, 'write', row.version]);
      await client.query('COMMIT');
      return json({ version: row.version, updatedAt: row.updated_at });
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return json({ error: 'Service de données indisponible. Vérifiez la configuration et le schéma.' }, 503);
    } finally { client?.release(); }
  };
}
export default makeHandler();
