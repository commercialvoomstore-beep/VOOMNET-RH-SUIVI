import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { makeHandler, verifyWithKeySet } from '../netlify/functions/workspace.mjs';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';

const origin = 'https://rh.example.com';
const source = (filename, mat = '1005') => ({ filename, rows: [{ mat, name: 'Fictif' }], stats: { accepted: 1, encoding: 'UTF-8' } });
async function fixture() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('../database/001_initial.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../database/002_individual_imports.sql', import.meta.url), 'utf8'));
  // La migration est additive et peut être relancée.
  await db.exec(await readFile(new URL('../database/002_individual_imports.sql', import.meta.url), 'utf8'));
  await db.query("INSERT INTO rh_users(user_id) VALUES ('user-a'), ('user-b')");
  const handler = makeHandler({ config: () => ({ origin }), verify: async t => { if (!['user-a', 'user-b', 'user-c'].includes(t)) throw Error(); return t; }, pool: { connect: async () => ({ query: (sql, params) => db.query(sql, params), release() {} }) } });
  return { db, handler };
}
function req(method = 'GET', { token = 'user-a', body, query = '', sourceOrigin, type = 'application/json' } = {}) {
  const headers = { authorization: `Bearer ${token}` };
  if (sourceOrigin !== undefined) headers.origin = sourceOrigin;
  if (body !== undefined) headers['content-type'] = type;
  return new Request(`${origin}/.netlify/functions/workspace${query}`, { method, headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
const post = (action, body, token = 'user-a') => req('POST', { token, sourceOrigin: origin, query: `?action=${action}`, body });

test('PostgreSQL : imports privés, historiques, restauration et conflit', async () => {
  const { db, handler } = await fixture();
  try {
    assert.equal((await handler(req('GET', { token: 'bad' }))).status, 401);
    assert.equal((await handler(req('GET', { token: 'user-c' }))).status, 403);
    let r = await handler(req()); assert.deepEqual(await r.json(), { version: 0, snapshot: { version: 1, contracts: {}, settings: {} }, active: { employees: null, absences: null, pointage: null } });
    r = await handler(post('import', { expectedVersion: 0, kind: 'employees', source: source('premier.csv') })); assert.equal(r.status, 200); assert.equal((await r.json()).version, 1);
    r = await handler(post('import', { expectedVersion: 1, kind: 'employees', source: source('second.csv') })); assert.equal((await r.json()).version, 2);
    r = await handler(post('import', { expectedVersion: 2, kind: 'absences', source: source('absence.csv') })); assert.equal((await r.json()).version, 3);
    assert.equal((await handler(post('import', { expectedVersion: 0, kind: 'pointage', source: source('ancien.csv') }))).status, 409);
    const state = await (await handler(req())).json(); assert.equal(state.version, 3);
    const history = (await (await handler(req('GET', { query: '?action=history' }))).json()).history;
    assert.deepEqual(history.employees.map(x => x.filename), ['second.csv', 'premier.csv']); assert.equal(history.absences.length, 1); assert.equal(history.pointage.length, 0);
    const firstId = history.employees[1].id;
    assert.equal((await handler(req('GET', { token: 'user-b', query: `?action=source&kind=employees&id=${firstId}` }))).status, 404);
    assert.equal((await handler(post('restore', { expectedVersion: 0, kind: 'employees', id: firstId }, 'user-b'))).status, 404);
    const bHistory = (await (await handler(req('GET', { token: 'user-b', query: '?action=history' }))).json()).history;
    assert.equal(bHistory.employees.length, 0);
    r = await handler(post('restore', { expectedVersion: 3, kind: 'employees', id: firstId })); assert.equal((await r.json()).version, 4);
    assert.equal((await (await handler(req())).json()).active.employees, firstId);
    const got = await (await handler(req('GET', { query: `?action=source&kind=employees&id=${firstId}` }))).json(); assert.equal(got.source.filename, 'premier.csv');
    r = await handler(post('remove', { expectedVersion: 4, kind: 'employees' })); assert.equal((await r.json()).version, 5);
    assert.equal((await (await handler(req())).json()).active.employees, null);
    assert.equal((await (await handler(req('GET', { query: '?action=history' }))).json()).history.employees.length, 2);
    const snapshot = { version: 1, contracts: { '1005': { type: 'CDD' } }, settings: { amount: 50000 } };
    r = await handler(req('PUT', { sourceOrigin: origin, body: { expectedVersion: 5, snapshot } })); assert.equal((await r.json()).version, 6);
    assert.deepEqual((await (await handler(req())).json()).snapshot, snapshot);
    assert.equal((await (await handler(req('GET', { token: 'user-b' }))).json()).snapshot.contracts['1005'], undefined);
    assert.ok((await db.query('SELECT 1 FROM rh_audit WHERE user_id = $1', ['user-a'])).rowCount > 0);
  } finally { await db.close(); }
});

test('Historique paginé : les anciennes versions restent accessibles et privées', async () => {
  const { db, handler } = await fixture();
  try {
    await db.query("INSERT INTO rh_import_employees(user_id, payload) SELECT 'user-a', jsonb_build_object('filename', 'version-' || n) FROM generate_series(1, 103) AS n");
    const first = (await (await handler(req('GET', { query: '?action=history' }))).json()).history.employees;
    assert.equal(first.length, 100); assert.equal(first[0].filename, 'version-103');
    const next = (await (await handler(req('GET', { query: `?action=history&kind=employees&before=${first[99].id}` }))).json()).history.employees;
    assert.deepEqual(next.map(x => x.filename), ['version-3', 'version-2', 'version-1']);
    assert.equal((await (await handler(req('GET', { token: 'user-b', query: `?action=history&kind=employees&before=${first[99].id}` }))).json()).history.employees.length, 0);
    assert.equal((await handler(req('GET', { query: '?action=history&kind=employees&before=invalid' }))).status, 400);
  } finally { await db.close(); }
});

test('API : méthode, origine, format, type et limite vérifiés', async () => {
  const { db, handler } = await fixture();
  try {
    assert.equal((await makeHandler({ config: () => { throw Error(); } })(req())).status, 503);
    assert.equal((await handler(req('GET', { sourceOrigin: 'https://attacker.example' }))).status, 403);
    assert.equal((await handler(req('POST', { query: '?action=import', body: { expectedVersion: 0, kind: 'employees', source: source('a') } }))).status, 403);
    assert.equal((await handler(req('POST', { query: '?action=import', sourceOrigin: origin, type: 'text/plain', body: '{}' }))).status, 415);
    assert.equal((await handler(post('import', { expectedVersion: 0, kind: 'rh_users;DROP TABLE', source: source('a') }))).status, 400);
    assert.equal((await handler(post('import', { expectedVersion: 0, kind: 'pointage', source: { rows: null } }))).status, 400);
    assert.equal((await handler(req('POST', { query: '?action=import', sourceOrigin: origin, body: ' '.repeat(4 * 1024 * 1024 + 1) }))).status, 413);
    assert.equal((await db.query('SELECT 1 FROM rh_users')).rowCount, 2);
  } finally { await db.close(); }
});

test('JWT : signature, émetteur, audience et échéance vérifiés', async () => {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA');
  const key = await exportJWK(publicKey); key.kid = 'test-key'; key.alg = 'EdDSA';
  const keys = createLocalJWKSet({ keys: [key] }), authOrigin = 'https://auth.example.com', cfg = { auth: { origin: authOrigin } };
  const sign = async ({ iss = authOrigin, aud = authOrigin, exp = '5m' } = {}) => new SignJWT({}).setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' }).setIssuer(iss).setAudience(aud).setSubject('user-a').setIssuedAt().setExpirationTime(exp).sign(privateKey);
  assert.equal(await verifyWithKeySet(await sign(), cfg, keys), 'user-a');
  await assert.rejects(verifyWithKeySet(await sign({ aud: 'https://other.example' }), cfg, keys));
  await assert.rejects(verifyWithKeySet(await sign({ iss: 'https://other.example' }), cfg, keys));
  await assert.rejects(verifyWithKeySet(await sign({ exp: '1 second ago' }), cfg, keys));
  const { privateKey: other } = await generateKeyPair('EdDSA');
  const forged = await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' }).setIssuer(authOrigin).setAudience(authOrigin).setSubject('user-a').setExpirationTime('5m').sign(other);
  await assert.rejects(verifyWithKeySet(forged, cfg, keys));
});
