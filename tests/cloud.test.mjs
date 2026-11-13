import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler, verifyWithKeySet } from '../netlify/functions/workspace.mjs';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';

const cfg = { origin: 'https://rh.example.com' };
const snapshot = { version: 1, sources: {}, contracts: {}, settings: {} };
function mock({ authorized = true, version = 0, snapshot: initial = null } = {}) {
  let row = { version, payload: initial || {}, updated_at: '2026-01-01' }; const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT 1 FROM rh_users')) return { rowCount: authorized ? 1 : 0 };
      if (sql.startsWith('SELECT version')) return { rowCount: 1, rows: [row] };
      if (sql.startsWith('UPDATE rh_workspace')) {
        if (row.version !== params[2]) return { rowCount: 0, rows: [] };
        row = { version: row.version + 1, payload: JSON.parse(params[0]), updated_at: '2026-01-02' };
        return { rowCount: 1, rows: [row] };
      }
      return { rowCount: 1, rows: [] };
    }, release() { calls.push({ sql: 'release' }); }
  };
  const handler = makeHandler({ config: () => cfg, verify: async t => { if (t !== 'good.jwt.token') throw Error(); return 'user-1'; }, pool: { connect: async () => client } });
  return { handler, calls };
}
function req(method = 'GET', { token = 'good.jwt.token', origin, body, type = 'application/json' } = {}) {
  const headers = { authorization: `Bearer ${token}` };
  if (origin !== undefined) headers.origin = origin;
  if (body !== undefined) headers['content-type'] = type;
  return new Request('https://rh.example.com/.netlify/functions/workspace', { method, headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}

test('configuration et authentification exigées avant accès aux données', async () => {
  assert.equal((await makeHandler({ config: () => { throw Error(); } })(req())).status, 503);
  const { handler, calls } = mock();
  assert.equal((await handler(req('GET', { token: 'bad' }))).status, 401);
  assert.equal((await handler(req('GET', { origin: 'https://attacker.example' }))).status, 403);
  assert.equal(calls.length, 0);
});
test('utilisateur non autorisé rejeté côté serveur', async () => {
  const { handler, calls } = mock({ authorized: false });
  const response = await handler(req()); assert.equal(response.status, 403);
  assert.ok(calls.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!calls.some(c => c.sql.startsWith('SELECT version')));
});
test('lecture, sauvegarde versionnée, journal minimal et conflit', async () => {
  const { handler, calls } = mock();
  const first = await handler(req()); assert.deepEqual(await first.json(), { version: 0, snapshot: null, updatedAt: '2026-01-01' });
  const save = await handler(req('PUT', { origin: cfg.origin, body: { expectedVersion: 0, snapshot } })); assert.equal(save.status, 200);
  assert.equal((await save.json()).version, 1);
  const conflict = await handler(req('PUT', { origin: cfg.origin, body: { expectedVersion: 0, snapshot } })); assert.equal(conflict.status, 409);
  const loaded = await handler(req()); const body = await loaded.json(); assert.equal(body.version, 1); assert.deepEqual(body.snapshot, snapshot);
  assert.equal(calls.filter(c => c.sql.startsWith('INSERT INTO rh_audit')).length, 3);
  assert.ok(calls.some(c => c.sql === 'ROLLBACK'));
});
test('modifications cross-origin et formats invalides refusés', async () => {
  const { handler, calls } = mock();
  assert.equal((await handler(req('PUT', { body: { expectedVersion: 0, snapshot } }))).status, 403);
  assert.equal((await handler(req('PUT', { origin: cfg.origin, body: '{}', type: 'text/plain' }))).status, 415);
  assert.equal((await handler(req('PUT', { origin: cfg.origin, body: '{' }))).status, 400);
  assert.equal((await handler(req('PUT', { origin: cfg.origin, body: { expectedVersion: 0, snapshot: { ...snapshot, sources: { other: {} } } } }))).status, 400);
  assert.equal(calls.length, 0);
});
test('limite de taille de la sauvegarde', async () => {
  const { handler } = mock();
  const response = await handler(req('PUT', { origin: cfg.origin, body: ' '.repeat(4 * 1024 * 1024 + 1) }));
  assert.equal(response.status, 413);
});

test('vérification cryptographique JWT : signature, audience, émetteur et échéance', async () => {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA');
  const publicJwk = await exportJWK(publicKey); publicJwk.kid = 'test-key'; publicJwk.alg = 'EdDSA';
  const keys = createLocalJWKSet({ keys: [publicJwk] });
  const origin = 'https://auth.example.com', config = { auth: { origin } };
  const sign = async ({ iss = origin, aud = origin, exp = '5m', sub = 'user-1' } = {}) => new SignJWT({}).setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' }).setIssuer(iss).setAudience(aud).setSubject(sub).setIssuedAt().setExpirationTime(exp).sign(privateKey);
  assert.equal(await verifyWithKeySet(await sign(), config, keys), 'user-1');
  await assert.rejects(verifyWithKeySet(await sign({ aud: 'https://other.example' }), config, keys));
  await assert.rejects(verifyWithKeySet(await sign({ iss: 'https://other.example' }), config, keys));
  await assert.rejects(verifyWithKeySet(await sign({ exp: '1 second ago' }), config, keys));
  const { privateKey: other } = await generateKeyPair('EdDSA');
  const forged = await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' }).setIssuer(origin).setAudience(origin).setSubject('user-1').setExpirationTime('5m').sign(other);
  await assert.rejects(verifyWithKeySet(forged, config, keys));
});
