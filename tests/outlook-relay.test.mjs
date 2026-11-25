import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler } from '../netlify/functions/outlook-send.mjs';
const origin = 'https://rh.example.test';
const payload = { microsoftToken: 'ms.token.sig', to: 'person@example.test', cc: 'rh@example.test', subject: 'Contrat', text: 'Bonjour' };
const req = (data = payload, headers = {}) => new Request(origin + '/.netlify/functions/outlook-send', { method: 'POST', headers: { origin, authorization: 'Bearer supa.token.sig', 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) });
function mock({ userStatus = 200, accessStatus = 200, graphStatus = 202, graphError = false } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'owner' }), { status: userStatus });
    if (url.includes('/rest/v1/rpc/')) return new Response('{}', { status: accessStatus });
    if (graphError) throw new Error('timeout');
    return new Response(null, { status: graphStatus });
  };
  return { calls, handler: makeHandler({ origin, fetcher }) };
}
test('authentifie l’espace, limite les données transmises et envoie au nom du compte Microsoft', async () => {
  const { handler, calls } = mock();
  const res = await handler(req()); assert.equal(res.status, 202); assert.equal((await res.json()).accepted, true);
  assert.equal(calls.length, 3); assert.match(calls[0].options.headers.Authorization, /^Bearer supa/);
  assert.equal(calls[2].url, 'https://graph.microsoft.com/v1.0/me/sendMail');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer ms.token.sig');
  const graph = JSON.parse(calls[2].options.body); assert.equal(graph.message.subject, 'Contrat');
  assert.equal(graph.message.body.contentType, 'HTML'); assert.match(graph.message.body.content, /Bonjour/); assert.match(graph.message.body.content, /Suivi de votre contrat/);
  assert.match(graph.message.body.content, /src="cid:voomnet-logo"/); assert.equal(graph.message.attachments.length, 1); assert.equal(graph.message.attachments[0]['@odata.type'], '#microsoft.graph.fileAttachment'); assert.equal(graph.message.attachments[0].contentId, 'voomnet-logo'); assert.equal(graph.message.attachments[0].isInline, true); assert.equal(graph.message.attachments[0].contentType, 'image/png'); assert.deepEqual(Buffer.from(graph.message.attachments[0].contentBytes, 'base64').subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.deepEqual(graph.message.toRecipients, [{ emailAddress: { address: 'person@example.test' } }]); assert.deepEqual(graph.message.ccRecipients, [{ emailAddress: { address: 'rh@example.test' } }]); assert.equal(graph.saveToSentItems, true);
});
test('refuse les origines, sessions, droits et messages invalides sans appeler Graph', async () => {
  let m = mock(); assert.equal((await m.handler(req(payload, { origin: 'https://bad.test' }))).status, 403); assert.equal(m.calls.length, 0);
  m = mock(); assert.equal((await m.handler(req(payload, { authorization: '' }))).status, 401); assert.equal(m.calls.length, 0);
  m = mock(); assert.equal((await m.handler(req({ ...payload, subject: 'x\r\nBcc: bad@test.com' }))).status, 400); assert.equal(m.calls.length, 0);
  m = mock(); assert.equal((await m.handler(req({ ...payload, text: 'x'.repeat(40000) }))).status, 400); assert.equal(m.calls.length, 0);
  m = mock({ userStatus: 401 }); assert.equal((await m.handler(req())).status, 401); assert.equal(m.calls.length, 1);
  m = mock({ accessStatus: 403 }); assert.equal((await m.handler(req())).status, 403); assert.equal(m.calls.length, 2);
  assert.equal((await makeHandler({ origin: undefined })(req())).status, 503);
});
test('les erreurs Microsoft ou réseau ne prétendent pas confirmer une remise', async () => {
  let m = mock({ graphStatus: 401 }); assert.equal((await m.handler(req())).status, 401);
  m = mock({ graphStatus: 429 }); assert.equal((await m.handler(req())).status, 429);
  m = mock({ graphStatus: 500 }); let uncertain = await m.handler(req()); assert.equal(uncertain.status, 504); assert.match((await uncertain.json()).error, /Résultat inconnu/);
  m = mock({ graphError: true }); const response = await m.handler(req()); assert.equal(response.status, 504); assert.match((await response.json()).error, /Résultat inconnu/);
});

test('le relais produit du HTML sûr et choisit le bon type sans accepter de HTML brut', async () => {
  const { handler, calls } = mock();
  const response = await handler(req({ ...payload, kind: 'prime', text: 'Bonjour <img src=x onerror=alert(1)> & Zoé' })); assert.equal(response.status, 202);
  const html = JSON.parse(calls[2].options.body).message.body.content;
  assert.match(html, /Votre prime trimestrielle/); assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; Zoé')); assert.equal((html.match(/<img\b/gi) || []).length, 1);
  const denied = mock(); assert.equal((await denied.handler(req({ ...payload, kind: 'autre' }))).status, 400); assert.equal(denied.calls.length, 0);
});
