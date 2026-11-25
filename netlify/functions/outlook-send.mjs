// Le navigateur fournit deux jetons de session éphémères ; rien n'est stocké ici.
const SUPABASE_URL = 'https://hibhvszfgldgxzcxhmou.supabase.co';
const SUPABASE_KEY = 'sb_publishable__l9N851qkB3FG9kHItbPiQ_tpfTB7QY';
const MAX_BYTES = 96 * 1024;
const emailPattern = /^[^\s@<>\x00-\x1f]{1,64}@[^\s@<>\x00-\x1f]{1,189}\.[^\s@<>\x00-\x1f]{2,}$/;
const json = (data, status) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const validEmail = x => typeof x === 'string' && x.length <= 254 && emailPattern.test(x);
async function readBody(request) {
  const reader = request.body?.getReader(); if (!reader) throw new Error('body');
  const chunks = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) { await reader.cancel(); throw new Error('size'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export function makeHandler({ fetcher = fetch, origin = process.env.RH_ALLOWED_ORIGIN } = {}) {
  return async request => {
    if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
    let allowed;
    try { const u = new URL(origin); if (u.origin !== origin || u.protocol !== 'https:') throw new Error(); allowed = u.origin; }
    catch { return json({ error: 'Relais non configuré.' }, 503); }
    if (request.headers.get('origin') !== allowed) return json({ error: 'Origine non autorisée.' }, 403);
    const bearer = /^Bearer ([A-Za-z0-9._-]{1,10000})$/.exec(request.headers.get('authorization') || '');
    if (!bearer) return json({ error: 'Authentification requise.' }, 401);
    if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') || '')) return json({ error: 'JSON requis.' }, 415);
    if (Number(request.headers.get('content-length') || 0) > MAX_BYTES) return json({ error: 'Message trop volumineux.' }, 413);
    let input;
    try { input = await readBody(request); } catch { return json({ error: 'Message invalide ou trop volumineux.' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.microsoftToken !== 'string' || !/^[A-Za-z0-9._-]{1,12000}$/.test(input.microsoftToken) || !validEmail(input.to) || (input.cc && !validEmail(input.cc)) || typeof input.subject !== 'string' || !input.subject.trim() || input.subject.length > 500 || /[\r\n]/.test(input.subject) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 15000) return json({ error: 'Message invalide.' }, 400);
    const supabaseHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${bearer[1]}` };
    try {
      const user = await fetcher(SUPABASE_URL + '/auth/v1/user', { headers: supabaseHeaders, signal: AbortSignal.timeout(10000) });
      if (!user.ok) return json({ error: 'Session RH invalide.' }, user.status === 401 || user.status === 403 ? 401 : 503);
      const auth = await user.json();
      if (!auth?.id || auth.is_anonymous === true) return json({ error: 'Session RH invalide.' }, 401);
      const access = await fetcher(SUPABASE_URL + '/rest/v1/rpc/voomnet_workspace', { method: 'POST', headers: { ...supabaseHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_action: 'get' }), signal: AbortSignal.timeout(10000) });
      if (!access.ok) return json({ error: 'Compte RH non autorisé ou service indisponible.' }, access.status === 401 ? 401 : 403);
    } catch { return json({ error: 'Vérification de la session indisponible.' }, 503); }
    const message = { subject: input.subject, body: { contentType: 'Text', content: input.text }, toRecipients: [{ emailAddress: { address: input.to } }], ccRecipients: input.cc ? [{ emailAddress: { address: input.cc } }] : [] };
    try {
      const response = await fetcher('https://graph.microsoft.com/v1.0/me/sendMail', { method: 'POST', headers: { Authorization: `Bearer ${input.microsoftToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, saveToSentItems: true }), signal: AbortSignal.timeout(12000) });
      if (response.status === 202) return json({ accepted: true }, 202);
      if (response.status === 401 || response.status === 403) return json({ error: 'Connexion Outlook expirée ou autorisation refusée. Reconnectez Outlook.' }, 401);
      if (response.status === 429) return json({ error: 'Limite Microsoft atteinte. Attendez avant de réessayer.' }, 429);
      if (response.status >= 500) return json({ error: 'Résultat inconnu : vérifiez les éléments envoyés Outlook avant de réessayer.' }, 504);
      return json({ error: 'Microsoft a refusé la demande. Vérifiez la configuration avant de réessayer.' }, 502);
    } catch { return json({ error: 'Résultat inconnu : vérifiez les éléments envoyés Outlook avant de réessayer.' }, 504); }
  };
}
export default makeHandler();
