import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { AUTH_URL, createRhAccount, validateRhUserId, validatePassword, sqlAuthorization } from '../scripts/admin-auth.mjs';

const input = { adminEmail: 'admin@example.test', adminPassword: 'admin-secret-example', identifier: '1005', password: 'rh-secret-example', name: 'RH Exemple' };
const cookie = '__Secure-neonauth.session_token=opaque.signed%2Fvalue';
function response(status, json = {}, cookies = []) {
  return { ok: status >= 200 && status < 300, status, headers: { getSetCookie: () => cookies }, async json() { return json; } };
}
function fakeFetch(replies) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    if (!reply) throw new Error('appel inattendu');
    return reply;
  };
  return { calls, fetcher };
}
const login = () => response(200, {}, [`${cookie}; Path=/; HttpOnly; Secure`, 'other=irrelevant; Path=/']);
const created = () => response(200, { user: { id: 'neon-user-1005', email: '1005@rh-identifiant.invalid' } });

test('identifiants, mot de passe et SQL sont validés sans injection', () => {
  assert.equal(validateRhUserId('001005'), '001005');
  for (const value of ['-1', '1005x', '', '12345678901234567']) assert.throws(() => validateRhUserId(value));
  for (const value of ['court', 'x'.repeat(129)]) assert.throws(() => validatePassword(value));
  assert.throws(() => sqlAuthorization("user'; DROP TABLE rh_users; --"));
  assert.match(sqlAuthorization('abc-123'), /VALUES \('abc-123', true\)/);
});

test('création réservée au rôle utilisateur, cookie local et déconnexion', async () => {
  const { calls, fetcher } = fakeFetch([login(), created(), response(200)]);
  const result = await createRhAccount(input, fetcher);
  assert.equal(result.userId, 'neon-user-1005'); assert.equal(result.signoutFailed, false);
  assert.match(result.sql, /'neon-user-1005'/);
  assert.deepEqual(calls.map(c => c.url), [AUTH_URL + '/sign-in/email', AUTH_URL + '/admin/create-user', AUTH_URL + '/sign-out']);
  assert.ok(calls.every(c => c.redirect === 'error' && c.method === 'POST'));
  assert.equal(calls[0].headers.Cookie, undefined); assert.equal(calls[1].headers.Cookie, cookie); assert.equal(calls[2].headers.Cookie, cookie);
  assert.deepEqual(JSON.parse(calls[1].body), { email: '1005@rh-identifiant.invalid', password: input.password, name: 'RH Exemple', role: 'user' });
  assert.equal(result.sql.includes(input.password), false);
});

test('refus de connexion et cookie manquant bloquent la création', async () => {
  for (const first of [response(401), response(200, {}, ['other=abc'])]) {
    const { calls, fetcher } = fakeFetch([first]);
    await assert.rejects(createRhAccount(input, fetcher)); assert.equal(calls.length, 1);
  }
});

test('erreur de création ou de déconnexion ne divulgue pas les secrets', async () => {
  for (const [second, third, pattern] of [
    [response(403), response(200), /refusée/],
    [response(409), response(200), /existe déjà/],
    [response(503), response(200), /peut-être été créé/],
    [new Error('mot de passe interne'), new Error('cookie interne'), /Déconnexion non confirmée/],
    [response(200, { user: { id: "id';", email: '1005@rh-identifiant.invalid' } }), response(200), /identifiant Neon inattendu/],
    [response(200, { user: { id: 'user1', email: '1005@rh-identifiant.invalid', role: 'admin' } }), response(200), /rôle inattendu/]
  ]) {
    const { calls, fetcher } = fakeFetch([login(), second, third]);
    await assert.rejects(createRhAccount(input, fetcher), error => {
      assert.match(error.message, pattern);
      for (const secret of [input.password, input.adminPassword, cookie, 'mot de passe interne', 'cookie interne']) assert.ok(!error.message.includes(secret));
      return true;
    });
    assert.equal(calls.length, 3); assert.equal(calls[2].url, AUTH_URL + '/sign-out');
  }
  const { fetcher } = fakeFetch([login(), created(), response(500)]);
  assert.equal((await createRhAccount(input, fetcher)).signoutFailed, true);
});

test('validation préalable et mode non interactif refusé', async () => {
  let calls = 0;
  await assert.rejects(createRhAccount({ ...input, identifier: '1005;DROP' }, async () => { calls++; }));
  assert.equal(calls, 0);
  const cli = spawnSync(process.execPath, ['scripts/create-rh-user.mjs'], { input: 'secrets-interdits\n', encoding: 'utf8' });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /terminal interactif/); assert.ok(!cli.stderr.includes('secrets-interdits'));
});
