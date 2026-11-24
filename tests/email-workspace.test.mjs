import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const a = '4bdaeb19-4411-4451-8bc7-97d76f0c1871', b = '9bbb48a5-b972-4b2b-aacd-d4fa611a49fa';
const migration = await readFile(new URL('../database/006_supabase_email.sql', import.meta.url), 'utf8');
async function fixture(legacy = true) {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE rh_backend; CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, deleted_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;`);
  if (legacy) for (const f of ['001_initial.sql', '002_individual_imports.sql', '004_supabase.sql', '005_supabase_role_serveur.sql']) await db.exec(await readFile(new URL('../database/' + f, import.meta.url), 'utf8'));
  return db;
}
async function asUser(db, id) { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]); await db.exec('SET ROLE authenticated'); }
async function rpc(db, action, options = {}) {
  return (await db.query('SELECT public.voomnet_workspace($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) AS data', [action, options.version ?? null, options.kind ?? null, options.id ?? null, options.source == null ? null : JSON.stringify(options.source), options.snapshot == null ? null : JSON.stringify(options.snapshot), options.before ?? null])).rows[0].data;
}
test('Migration préserve les UUID et imports, retire le trigger, fonctionne à nouveau sans rôle serveur', async () => {
  const db = await fixture();
  try {
    await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,'a@example.test','{\"rh_identifier\":\"1005\"}')", [a]);
    await db.query("INSERT INTO public.rh_personal_workspace(user_id,version,active_employees,payload) VALUES ($1,2,1,'{\"contracts\":{\"old\":true},\"settings\":{}}')", [a]);
    await db.query("INSERT INTO public.rh_import_employees(user_id,payload) VALUES ($1,'{\"filename\":\"old.csv\",\"rows\":[],\"stats\":{}}')", [a]);
    await db.exec(migration); await db.exec(migration);
    await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,'b@example.test','{}')", [b]);
    await asUser(db, a);
    const ws = await rpc(db, 'get'); assert.equal(ws.version, 2); assert.equal(ws.active.employees, '1'); assert.equal(ws.snapshot.contracts.old, true);
    assert.equal((await rpc(db,'source',{kind:'employees',id:'1'})).source.filename, 'old.csv');
    await assert.rejects(db.query('SELECT * FROM public.rh_import_employees'));
    await asUser(db, b); assert.equal((await rpc(db,'get')).version, 0);
    await assert.rejects(rpc(db,'source',{kind:'employees',id:'1'}), /VOOMNET_NOT_FOUND/);
    await assert.rejects(rpc(db,'restore',{kind:'employees',id:'1',version:0}), /VOOMNET_NOT_FOUND/);
    await rpc(db,'import',{kind:'employees',version:0,source:{filename:'b.csv',rows:[{name:'b'}],stats:{}}});
    await assert.rejects(rpc(db,'save',{version:0,snapshot:{version:1,contracts:{},settings:{}}}), /VOOMNET_CONFLICT/);
    const hist = (await rpc(db,'history')).history.employees; assert.equal(hist[0].filename,'b.csv');
    await rpc(db,'remove',{kind:'employees',version:1}); assert.equal((await rpc(db,'get')).active.employees,null);
    await rpc(db,'restore',{kind:'employees',id:hist[0].id,version:2}); assert.equal((await rpc(db,'get')).active.employees,hist[0].id);
    await rpc(db,'save',{version:3,snapshot:{version:1,contracts:{b:'ok'},settings:{}}});
    assert.equal((await rpc(db,'get')).snapshot.contracts.b,'ok');
    await asUser(db,a); assert.equal((await rpc(db,'get')).snapshot.contracts.b,undefined); await asUser(db,b);
    await assert.rejects(rpc(db,'import',{kind:'employees',version:1,source:{filename:'bad',rows:['invalid'],stats:{}}}), /VOOMNET_INVALID/);
    await db.exec('RESET ROLE; SET ROLE anon'); await assert.rejects(rpc(db,'get'));
    await db.exec('RESET ROLE; SET ROLE rh_backend'); await assert.rejects(db.query('SELECT * FROM public.rh_personal_workspace'));
    await db.exec('RESET ROLE'); await db.query('UPDATE public.rh_users SET active=false WHERE user_id=$1',[a]); await asUser(db,a); await assert.rejects(rpc(db,'get'),/VOOMNET_FORBIDDEN/);
  } finally { await db.close(); }
});
test('Installation neuve et refus des sessions anonymes', async () => {
  const db = await fixture(false);
  try {
    await db.exec('DROP ROLE rh_backend'); await db.exec(migration); await asUser(db,a); assert.equal((await rpc(db,'get')).version,0);
    await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claims', $1, false)", ['{"is_anonymous":true}']); await db.exec('SET ROLE authenticated');
    await assert.rejects(rpc(db,'get'), /VOOMNET_UNAUTHORIZED/);
  } finally { await db.close(); }
});
