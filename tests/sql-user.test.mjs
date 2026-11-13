import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const script = await readFile(new URL('../database/003_autoriser_utilisateur_rh.sql', import.meta.url), 'utf8');
const withId = id => script.replace("id_neon text := 'ID_INTERNE_NEON_AUTH';", `id_neon text := '${id}';`);

test('SQL : autorisation du compte Neon identifié sans réactivation implicite', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('../database/001_initial.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../database/002_individual_imports.sql', import.meta.url), 'utf8'));
    await db.exec('CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id uuid PRIMARY KEY, email text NOT NULL);');
    const id = '9bbb48a5-b972-4b2b-aacd-d4fa611a49fa';
    const other = '4bdaeb19-4411-4451-8bc7-97d76f0c1871';
    await db.query('INSERT INTO neon_auth."user" VALUES ($1, $2), ($3, $4)', [id, '1005@rh-identifiant.invalid', other, '1006@rh-identifiant.invalid']);
    await assert.rejects(db.exec(script), /Remplacer ID_INTERNE/);
    await assert.rejects(db.exec(withId(other)), /Compte introuvable ou alias incorrect/);
    await assert.rejects(db.exec(withId('11111111-1111-1111-1111-111111111111')), /Compte introuvable/);
    assert.equal((await db.query('SELECT * FROM rh_users')).rows.length, 0);
    await db.exec(withId(id)); await db.exec(withId(id));
    assert.deepEqual((await db.query('SELECT user_id, active FROM rh_users')).rows, [{ user_id: id, active: true }]);
    await db.query('UPDATE rh_users SET active = false WHERE user_id = $1', [id]);
    await assert.rejects(db.exec(withId(id)), /déjà désactivé/);
    assert.equal((await db.query('SELECT active FROM rh_users WHERE user_id = $1', [id])).rows[0].active, false);
    const invalid = withId(id).replace("identifiant_rh text := '1005';", "identifiant_rh text := '10A5';");
    await assert.rejects(db.exec(invalid), /Identifiant RH invalide/);
  } finally { await db.close(); }
});
