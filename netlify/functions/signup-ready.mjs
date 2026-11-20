import { config, getPool } from '../lib/supabase.mjs';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export function makeSignupReadyHandler(deps = {}) {
  return async request => {
    if (request.method !== 'GET') return json({ error: 'Méthode non autorisée.' }, 405);
    let client;
    try {
      const cfg = (deps.config || config)();
      client = await (deps.pool || getPool(cfg)).connect();
      const result = await client.query(`SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'auth' AND c.relname = 'users' AND t.tgname = 'voomnet_rh_on_signup' AND NOT t.tgisinternal AND t.tgenabled <> 'D') AS ready`);
      if (!result.rows[0]?.ready) throw new Error('Migration absente');
      await client.query("SELECT rh_private.email_for_identifier('')");
      await client.query('SELECT identifier_hash FROM rh_private.login_attempts WHERE false');
      return json({ ready: true });
    } catch { return json({ error: 'Inscription indisponible : la base ou le service RH doit être configuré.' }, 503); }
    finally { client?.release(); }
  };
}
export default makeSignupReadyHandler();
