import test from 'node:test';
import assert from 'node:assert/strict';
import { isMicrosoftId, microsoftAuthority, microsoftConnectionKey } from '../src/microsoft-auth.mjs';
const client = '4bdaeb19-4411-4451-8bc7-97d76f0c1871', tenant = '9bbb48a5-b972-4b2b-aacd-d4fa611a49fa';
test('comptes personnels et professionnels utilisent une autorité Microsoft adaptée', () => {
  assert.equal(microsoftAuthority('personal', ''), 'https://login.microsoftonline.com/consumers');
  assert.equal(microsoftAuthority('work', tenant), 'https://login.microsoftonline.com/' + tenant);
  assert.notEqual(microsoftConnectionKey(client, 'personal', ''), microsoftConnectionKey(client, 'work', tenant));
  assert.notEqual(microsoftConnectionKey(client, 'work', tenant), microsoftConnectionKey(client, 'work', client));
  assert.equal(microsoftConnectionKey(client.toUpperCase(), 'work', tenant.toUpperCase()), microsoftConnectionKey(client, 'work', tenant));
});
test('refuse les identifiants manquants, mal formés et les autorités arbitraires', () => {
  for (const value of ['', 'organizations', 'https://evil.test', tenant + '/x', '../evil', null]) {
    assert.equal(isMicrosoftId(value), false); assert.throws(() => microsoftAuthority('work', value));
  }
  assert.throws(() => microsoftAuthority('other', tenant));
  assert.throws(() => microsoftConnectionKey('invalid', 'work', tenant));
});
