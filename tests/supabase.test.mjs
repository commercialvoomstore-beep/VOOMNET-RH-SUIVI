import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { makeLoginHandler } from '../netlify/functions/login.mjs';
import { makeSignupReadyHandler } from '../netlify/functions/signup-ready.mjs';

const origin = 'https://rh.example.com';
const id1 = '4bdaeb19-4411-4451-8bc7-97d76f0c1871', id2 = '9bbb48a5-b972-4b2b-aacd-d4fa611a49fa';
async function fixture() {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE rh_backend; CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, deleted_at timestamptz);');
  for (const name of ['001_initial.sql', '002_individual_imports.sql', '004_supabase.sql', '005_supabase_role_serveur.sql']) await db.exec(await readFile(new URL('../database/' + name, import.meta.url), 'utf8'));
  return db;
}
const add = (db, id, email, rhid) => db.query('INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES ($1,$2,$3::jsonb)', [id, email, JSON.stringify({ rh_identifier: rhid })]);

test('Migration : inscription, identifiants uniques, protection RLS et comptes indépendants', async () => {
  const db = await fixture();
  try {
    await add(db, id1, 'one@example.test', '1005');
    await add(db, id2, 'two@example.test', '1006');
    await assert.rejects(add(db, 'cbd275b1-43aa-4169-b54b-0bda58ad1da2', 'other@example.test', '1005'));
    await assert.rejects(add(db, 'bbd275b1-43aa-4169-b54b-0bda58ad1da2', 'other@example.test', 'A'));
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM public.rh_users')).rows[0].n, 2);
    assert.equal((await db.query('SELECT rh_private.email_for_identifier($1) AS email', ['1005'])).rows[0].email, 'one@example.test');
    await db.query('UPDATE auth.users SET raw_user_meta_data = $1 WHERE id = $2', [JSON.stringify({ rh_identifier: '1007' }), id1]);
    assert.equal((await db.query('SELECT rh_private.email_for_identifier($1) AS email', ['1007'])).rows[0].email, null);
    await db.query('UPDATE public.rh_users SET active = false WHERE user_id = $1', [id1]);
    assert.equal((await db.query('SELECT rh_private.email_for_identifier($1) AS email', ['1005'])).rows[0].email, null);
    await db.exec('SET ROLE rh_backend');
    assert.equal((await db.query("SELECT rh_private.email_for_identifier('1006') AS email")).rows[0].email, 'two@example.test');
    await db.query('INSERT INTO public.rh_personal_workspace(user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [id2]);
    assert.equal((await db.query('SELECT * FROM public.rh_personal_workspace WHERE user_id = $1 FOR UPDATE', [id2])).rowCount, 1);
    await db.query('INSERT INTO public.rh_import_employees(user_id, payload) VALUES ($1, $2::jsonb)', [id2, '{}']);
    await db.query("INSERT INTO public.rh_audit(user_id, action, version) VALUES ($1, 'read', 0)", [id2]);
    await assert.rejects(db.query('SELECT * FROM auth.users'));
    await db.exec('RESET ROLE');
    await db.exec('SET ROLE anon');
    await assert.rejects(db.query('SELECT * FROM public.rh_import_absences'));
    await assert.rejects(db.query('SELECT * FROM rh_private.identifiers'));
    await assert.rejects(db.query("SELECT rh_private.email_for_identifier('1006')"));
    await db.exec('RESET ROLE');
    const rls = await db.query("SELECT count(*)::int AS n FROM pg_class WHERE relname IN ('rh_users','rh_workspace','rh_audit','rh_personal_workspace','rh_import_employees','rh_import_absences','rh_import_pointage') AND relrowsecurity");
    assert.equal(rls.rows[0].n, 7);
  } finally { await db.close(); }
});

test('Connexion : correspondance privée, contrôle origine, erreurs neutres et limitation', async () => {
  const db = await fixture();
  try {
    await add(db, id1, 'one@example.test', '1005');
    const bodies = [];
    const fetcher = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return bodies.at(-1).email === 'one@example.test' && bodies.at(-1).password === 'password-test' ? new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', user: { id: id1 } }), { status: 200 }) : new Response('{}', { status: 400 }); };
    await db.exec('SET ROLE rh_backend');
    const pool = { connect: async () => ({ query: (sql, args) => db.query(sql, args), release() {} }) };
    const handler = makeLoginHandler({ config: () => ({ origin }), pool, fetcher });
    const readyHandler = makeSignupReadyHandler({ config: () => ({ origin }), pool });
    const ready = await readyHandler(new Request(origin + '/ready')); assert.equal(ready.status, 200);
    await db.exec('RESET ROLE; ALTER TABLE auth.users DISABLE TRIGGER voomnet_rh_on_signup; SET ROLE rh_backend');
    assert.equal((await readyHandler(new Request(origin + '/ready'))).status, 503);
    await db.exec('RESET ROLE; ALTER TABLE auth.users ENABLE TRIGGER voomnet_rh_on_signup; SET ROLE rh_backend');
    const req = (body, src = origin) => new Request(origin + '/.netlify/functions/login', { method: 'POST', headers: { origin: src, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const ctx = { ip: '192.0.2.1' };
    assert.equal((await handler(req({ identifier: '1005', password: 'password-test' }, 'https://attacker.test'), ctx)).status, 403);
    assert.equal((await handler(req({ identifier: '1005', password: 'password-test' }), {})).status, 503);
    assert.equal((await handler(req({ identifier: 'x', password: 'password-test' }), ctx)).status, 400);
    let response = await handler(req({ identifier: '1005', password: 'password-test' }), ctx);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { access_token: 'access', refresh_token: 'refresh' });
    response = await handler(req({ identifier: '9999', password: 'wrong' }), ctx); assert.equal(response.status, 401); assert.ok(!JSON.stringify(await response.json()).includes('one@example.test'));
    for (let i = 0; i < 9; i++) assert.equal((await handler(req({ identifier: '1005', password: 'wrong' }), ctx)).status, 401);
    assert.equal((await handler(req({ identifier: '1005', password: 'wrong' }), ctx)).status, 429);
    assert.equal(bodies.length, 11);
  } finally { await db.close(); }
});
