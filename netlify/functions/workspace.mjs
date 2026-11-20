import { config, getPool, verifySupabaseToken } from '../lib/supabase.mjs';

const MAX_BYTES = 4 * 1024 * 1024;
const TABLES = Object.freeze({ employees: 'rh_import_employees', absences: 'rh_import_absences', pointage: 'rh_import_pointage' });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const isObject = x => x && typeof x === 'object' && !Array.isArray(x);
function validSource(source) {
  return isObject(source) && typeof source.filename === 'string' && source.filename.length <= 255 && Array.isArray(source.rows) && source.rows.length <= 50000 && source.rows.every(isObject) && isObject(source.stats);
}
const validId = id => typeof id === 'string' && /^[1-9]\d{0,17}$/.test(id);
export function makeHandler(deps = {}) {
  return async request => {
    let cfg;
    try { cfg = (deps.config || config)(); } catch { return json({ error: 'Service non configuré.' }, 503); }
    if (!['GET', 'PUT', 'POST'].includes(request.method)) return json({ error: 'Méthode non autorisée.' }, 405);
    const url = new URL(request.url), action = url.searchParams.get('action') || '', origin = request.headers.get('origin');
    if ((request.method !== 'GET' && origin !== cfg.origin) || (origin && origin !== cfg.origin)) return json({ error: 'Origine non autorisée.' }, 403);
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(request.headers.get('authorization') || '');
    if (!match || match[1].length > 10000) return json({ error: 'Authentification requise.' }, 401);
    let user;
    try { user = await (deps.verify || verifySupabaseToken)(match[1], cfg); } catch (error) { return error.status === 503 ? json({ error: 'Service de connexion indisponible.' }, 503) : json({ error: 'Session invalide ou expirée.' }, 401); }
    let data;
    if (request.method !== 'GET') {
      if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return json({ error: 'JSON requis.' }, 415);
      if (Number(request.headers.get('content-length') || 0) > MAX_BYTES) return json({ error: 'Données trop volumineuses (4 Mo maximum).' }, 413);
      try {
        const text = await request.text();
        if (new TextEncoder().encode(text).length > MAX_BYTES) return json({ error: 'Données trop volumineuses (4 Mo maximum).' }, 413);
        data = JSON.parse(text);
      } catch { return json({ error: 'JSON invalide.' }, 400); }
      if (!isObject(data) || !Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 0) return json({ error: 'Version invalide.' }, 400);
      if (request.method === 'PUT' && (action || !isObject(data.snapshot) || data.snapshot.version !== 1 || !isObject(data.snapshot.contracts) || Object.keys(data.snapshot.contracts).length > 10000 || !isObject(data.snapshot.settings))) return json({ error: 'Fiches invalides.' }, 400);
      if (request.method === 'POST' && (!['import', 'restore', 'remove'].includes(action) || !Object.hasOwn(TABLES, data.kind) || (action === 'import' && !validSource(data.source)) || (action === 'restore' && !validId(data.id)))) return json({ error: 'Import invalide.' }, 400);
    } else if (!['', 'history', 'source'].includes(action)) return json({ error: 'Action inconnue.' }, 400);
    if (request.method === 'GET' && action === 'history' && url.searchParams.has('before') && (!Object.hasOwn(TABLES, url.searchParams.get('kind')) || !validId(url.searchParams.get('before')))) return json({ error: 'Historique invalide.' }, 400);
    if (request.method === 'GET' && action === 'source' && (!Object.hasOwn(TABLES, url.searchParams.get('kind')) || !validId(url.searchParams.get('id')))) return json({ error: 'Import invalide.' }, 400);
    let client;
    try {
      client = await (deps.pool || getPool(cfg)).connect();
      await client.query('BEGIN');
      const authorized = await client.query('SELECT 1 FROM rh_users WHERE user_id = $1 AND active = true', [user]);
      if (!authorized.rowCount) { await client.query('ROLLBACK'); return json({ error: 'Ce compte ne dispose pas des droits RH.' }, 403); }
      await client.query('INSERT INTO rh_personal_workspace(user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [user]);
      const result = await client.query('SELECT version, payload, active_employees::text AS active_employees, active_absences::text AS active_absences, active_pointage::text AS active_pointage FROM rh_personal_workspace WHERE user_id = $1 FOR UPDATE', [user]);
      if (!result.rowCount) throw new Error('Espace non initialisé');
      const row = result.rows[0];
      const audit = async (actionName, version) => client.query('INSERT INTO rh_audit(user_id, action, version) VALUES ($1, $2, $3)', [user, actionName, version]);
      if (request.method === 'GET') {
        if (action === 'source') {
          const kind = url.searchParams.get('kind'), id = url.searchParams.get('id');
          const source = await client.query(`SELECT payload FROM ${TABLES[kind]} WHERE user_id = $1 AND id = $2`, [user, id]);
          if (!source.rowCount) { await client.query('ROLLBACK'); return json({ error: 'Import introuvable.' }, 404); }
          await audit('read', row.version); await client.query('COMMIT'); return json({ source: source.rows[0].payload });
        }
        if (action === 'history') {
          const history = {};
          for (const kind of Object.keys(TABLES)) {
            const before = url.searchParams.get('kind') === kind ? url.searchParams.get('before') : null;
            const entries = await client.query(`SELECT id::text AS id, payload->>'filename' AS filename, created_at FROM ${TABLES[kind]} AS imports WHERE user_id = $1 AND ($2::bigint IS NULL OR imports.id < $2::bigint) ORDER BY imports.id DESC LIMIT 100`, [user, before]);
            history[kind] = entries.rows;
          }
          await audit('read', row.version); await client.query('COMMIT'); return json({ history });
        }
        await audit('read', row.version); await client.query('COMMIT');
        return json({ version: row.version, snapshot: { version: 1, contracts: row.payload?.contracts || {}, settings: row.payload?.settings || {} }, active: { employees: row.active_employees, absences: row.active_absences, pointage: row.active_pointage } });
      }
      if (row.version !== data.expectedVersion) { await client.query('ROLLBACK'); return json({ error: 'Conflit : les données ont changé. Rechargez avant de continuer.' }, 409); }
      if (request.method === 'PUT') {
        await client.query('UPDATE rh_personal_workspace SET version = version + 1, payload = $2::jsonb, updated_at = now() WHERE user_id = $1', [user, JSON.stringify({ contracts: data.snapshot.contracts, settings: data.snapshot.settings })]);
      } else {
        const table = TABLES[data.kind], field = `active_${data.kind}`; let active = null;
        if (action === 'import') {
          const inserted = await client.query(`INSERT INTO ${table}(user_id, payload) VALUES ($1, $2::jsonb) RETURNING id::text AS id`, [user, JSON.stringify(data.source)]);
          active = inserted.rows[0].id;
        } else if (action === 'restore') {
          const found = await client.query(`SELECT id FROM ${table} WHERE user_id = $1 AND id = $2`, [user, data.id]);
          if (!found.rowCount) { await client.query('ROLLBACK'); return json({ error: 'Import introuvable.' }, 404); }
          active = data.id;
        }
        await client.query(`UPDATE rh_personal_workspace SET version = version + 1, ${field} = $2, updated_at = now() WHERE user_id = $1`, [user, active]);
      }
      await audit('write', row.version + 1); await client.query('COMMIT');
      return json({ version: row.version + 1 });
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return json({ error: 'Service de données indisponible. Vérifiez la configuration et le schéma.' }, 503);
    } finally { client?.release(); }
  };
}
export default makeHandler();
