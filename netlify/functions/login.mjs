import { createHash } from 'node:crypto';
import { config, getPool, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../lib/supabase.mjs';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const hash = value => createHash('sha256').update(value).digest('hex');
export function makeLoginHandler(deps = {}) {
  return async (request, context = {}) => {
    let cfg;
    try { cfg = (deps.config || config)(); } catch { return json({ error: 'Service non configuré.' }, 503); }
    if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
    if (request.headers.get('origin') !== cfg.origin) return json({ error: 'Origine non autorisée.' }, 403);
    if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return json({ error: 'JSON requis.' }, 415);
    if (Number(request.headers.get('content-length') || 0) > 4096) return json({ error: 'Requête invalide.' }, 413);
    let data;
    try { const text = await request.text(); if (new TextEncoder().encode(text).length > 4096) return json({ error: 'Requête invalide.' }, 413); data = JSON.parse(text); }
    catch { return json({ error: 'Requête invalide.' }, 400); }
    if (!data || typeof data.identifier !== 'string' || !/^\d{1,16}$/.test(data.identifier) || typeof data.password !== 'string' || !data.password || data.password.length > 128) return json({ error: 'Identifiant ou mot de passe incorrect.' }, 400);
    // Netlify fournit context.ip ; ne pas faire confiance à un en-tête envoyé par le client.
    if (typeof context.ip !== 'string' || !context.ip || context.ip.length > 64) return json({ error: 'Service indisponible.' }, 503);
    let client, email;
    try {
      client = await (deps.pool || getPool(cfg)).connect();
      const keys = [hash('id:' + data.identifier), hash('ip:' + context.ip)];
      for (let n = 0; n < keys.length; n++) {
        const result = await client.query(`INSERT INTO rh_private.login_attempts (identifier_hash, attempts, window_start) VALUES ($1, 1, now())
          ON CONFLICT (identifier_hash) DO UPDATE SET attempts = CASE WHEN rh_private.login_attempts.window_start < now() - interval '15 minutes' THEN 1 ELSE rh_private.login_attempts.attempts + 1 END,
          window_start = CASE WHEN rh_private.login_attempts.window_start < now() - interval '15 minutes' THEN now() ELSE rh_private.login_attempts.window_start END RETURNING attempts`, [keys[n]]);
        if (result.rows[0].attempts > (n === 0 ? 10 : 50)) return json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' }, 429);
      }
      const result = await client.query('SELECT rh_private.email_for_identifier($1) AS email', [data.identifier]);
      email = result.rows[0]?.email || 'aucun-compte@rh-inexistant.invalid';
      if (Math.random() < 0.01) await client.query("DELETE FROM rh_private.login_attempts WHERE window_start < now() - interval '1 day'");
    } catch { return json({ error: 'Service de connexion indisponible.' }, 503); }
    finally { client?.release(); }
    let response;
    try {
      response = await (deps.fetcher || fetch)(SUPABASE_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: data.password }), redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch { return json({ error: 'Service de connexion indisponible.' }, 503); }
    if (!response.ok) return response.status === 429 ? json({ error: 'Trop de tentatives. Réessayez plus tard.' }, 429) : response.status >= 500 ? json({ error: 'Service de connexion indisponible.' }, 503) : json({ error: 'Identifiant ou mot de passe incorrect.' }, 401);
    try {
      const session = await response.json();
      if (!session.access_token || !session.refresh_token || !session.user?.id || email === 'aucun-compte@rh-inexistant.invalid') return json({ error: 'Connexion impossible.' }, 401);
      return json({ access_token: session.access_token, refresh_token: session.refresh_token });
    } catch { return json({ error: 'Service de connexion indisponible.' }, 503); }
  };
}
export default makeLoginHandler();
