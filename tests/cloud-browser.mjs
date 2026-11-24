import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import sparticuz, { inflate } from '@sparticuz/chromium';
import AxeBuilder from '@axe-core/playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const archive = resolve('node_modules/@sparticuz/chromium/bin/al2023.tar.br');
if (!existsSync('/tmp/al2023/lib/libnspr4.so')) await inflate(archive);
const browser = await chromium.launch({ executablePath: await sparticuz.executablePath(), headless: true, args: sparticuz.args.filter(a => !['--single-process','--disable-web-security','--allow-running-insecure-content'].includes(a)), env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp:' + (process.env.LD_LIBRARY_PATH || '') } });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
const page = await context.newPage();
let version = 0, authorized = true, apiAvailable = true, sequence = 0;
let snapshot = { version: 1, contracts: {}, settings: {} }, active = { employees: null, absences: null, pointage: null };
const saved = {}, history = { employees: [], absences: [], pointage: [] };
const authBase = 'https://hibhvszfgldgxzcxhmou.supabase.co/auth/v1';
const user = { id: '4bdaeb19-4411-4451-8bc7-97d76f0c1871', email: 'rh@example.test', user_metadata: { rh_identifier: '1005' }, aud: 'authenticated', role: 'authenticated' };
const jwt = [Buffer.from('{"alg":"none"}').toString('base64url'), Buffer.from(JSON.stringify({ exp: 1893456000, sub: user.id })).toString('base64url'), 'c2lnbmF0dXJl'].join('.');
const cors = { 'access-control-allow-origin': 'http://127.0.0.1:3000', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
let signups = 0, resetRequests = 0, passwordUpdates = 0;
await context.route(authBase + '/**', async route => {
  const req = route.request(), path = req.url().slice(authBase.length);
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (path.startsWith('/signup')) { const body = req.postDataJSON(); assert.equal(body.email, 'rh@example.test'); assert.ok(!body.data?.rh_identifier); signups++; return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ...user, identities: [{ id: user.id }] }) }); }
  if (path.startsWith('/token')) { const body = req.postDataJSON(); assert.equal(body.email, 'rh@example.test'); if (body.password !== 'test-password') return route.fulfill({ status: 400, headers: cors, contentType: 'application/json', body: '{"error":"invalid_grant"}' }); return route.fulfill({status: 200, headers: cors, contentType:'application/json', body: JSON.stringify({access_token:jwt,refresh_token:'refresh',token_type:'bearer',expires_in:3600,user})}); }
  if (path.startsWith('/recover')) { assert.match(req.url(), /recovery%3D1/); resetRequests++; return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' }); }
  if (path.startsWith('/user') && req.method() === 'PUT') { assert.equal(req.postDataJSON().password, 'new-password-123'); passwordUpdates++; return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(user) }); }
  if (path.startsWith('/user')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(user) });
  if (path.startsWith('/logout')) return route.fulfill({ status: 204, headers: cors });
  return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{}' });
});
await context.route('**/rest/v1/rpc/voomnet_workspace', async route => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  assert.equal(req.headers().authorization, 'Bearer ' + jwt);
  if (!apiAvailable) return route.fulfill({ status: 503, headers: cors, contentType: 'application/json', body: '{"message":"unavailable"}' });
  if (!authorized) return route.fulfill({ status: 400, headers: cors, contentType: 'application/json', body: '{"message":"VOOMNET_FORBIDDEN"}' });
  const body = req.postDataJSON(), action = body.p_action; let output;
  if (action === 'source') output = { source: saved[body.p_id] };
  else if (action === 'history') output = { history };
  else if (action === 'get') output = { version, snapshot, active };
  else {
    if (body.p_expected_version !== version) return route.fulfill({ status: 400, headers: cors, contentType: 'application/json', body: '{"message":"VOOMNET_CONFLICT"}' });
    if (action === 'import') { const id = String(++sequence); saved[id] = body.p_source; active[body.p_kind] = id; history[body.p_kind].unshift({ id, filename: body.p_source.filename, created_at: new Date().toISOString() }); }
    else if (action === 'restore') active[body.p_kind] = body.p_id;
    else if (action === 'remove') active[body.p_kind] = null;
    else if (action === 'save') snapshot = body.p_snapshot;
    output = { version: ++version };
  }
  return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(output) });
});
page.on('dialog', d => d.accept());
const login = async password => { await page.locator('#login-email').fill('rh@example.test'); await page.locator('#login-password').fill(password); await page.locator('#login-form [type="submit"]').click(); };
try {
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'load' });
  assert.equal(await page.locator('#splash').isVisible(), true); await page.locator('#splash').waitFor({ state: 'detached' });
  await page.waitForFunction(() => !document.querySelector('#login-form [type=submit]').disabled);
  assert.equal(await page.locator('#application').isHidden(), true); assert.equal(await page.locator('#login-screen').isVisible(), true);
  mkdirSync('.cache/screenshots', { recursive: true }); await page.screenshot({ path: '.cache/screenshots/login.png', fullPage: true, timeout: 30000, animations: 'disabled' });
  assert.deepEqual((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(v => v.id), []);
  await page.locator('#auth-switch').click(); assert.deepEqual((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(v => v.id), []);
  await page.locator('#signup-email').fill('rh@example.test'); await page.locator('#signup-password').fill('long-password-123'); await page.locator('#signup-confirm').fill('long-password-123'); await page.locator('#signup-form [type=submit]').click(); await page.getByText('Si l’inscription est acceptée', { exact: false }).waitFor(); assert.equal(signups, 1); assert.equal(await page.locator('#signup-password').inputValue(), ''); await page.locator('#auth-switch').click();
  await page.locator('#forgot-switch').click(); await page.locator('#forgot-email').fill('rh@example.test'); await page.locator('#forgot-form [type=submit]').click(); await page.getByText('Si cette adresse est admissible', {exact:false}).waitFor(); assert.equal(resetRequests,1); await page.locator('#forgot-switch').click();
  await login('incorrect'); await page.getByText('Adresse e-mail ou mot de passe incorrect', { exact: false }).waitFor(); assert.equal(await page.locator('#application').isHidden(), true); assert.equal(await page.locator('#login-password').inputValue(), '');
  authorized = false; await login('test-password'); await page.getByText('Compte non autorisé.', { exact: false }).waitFor(); assert.equal(await page.locator('#application').isHidden(), true);
  authorized = true; apiAvailable = false; await login('test-password'); await page.getByText('Service de données indisponible.', { exact: false }).waitFor(); assert.equal(await page.locator('#application').isHidden(), true);
  apiAvailable = true; await login('test-password'); await page.locator('#application').waitFor({ state: 'visible' });
  await page.locator('#main-nav [data-page="imports"]').click();
  const buffer = readFileSync(resolve('data/LISTES-EMPLOYEES.csv'));
  await page.locator('#file-employees').setInputFiles({ name: 'premier.csv', mimeType: 'text/csv', buffer }); await page.waitForFunction(() => document.querySelector('#busy').hidden);
  assert.equal(version, 1); assert.equal(saved[active.employees].rows.length, 18);
  await page.locator('#file-employees').setInputFiles({ name: 'second.csv', mimeType: 'text/csv', buffer }); await page.waitForFunction(() => document.querySelector('#busy').hidden);
  assert.equal(version, 2); assert.equal(history.employees.length, 2);
  await page.getByRole('button', { name: 'Espace RH en ligne' }).click(); await page.getByText('Historique des imports').click(); await page.getByText('premier.csv', { exact: false }).waitFor();
  await page.locator('#cloud-history section').first().locator('button').nth(1).click(); await page.getByText('Version d’import rétablie.').waitFor(); assert.equal(saved[active.employees].filename, 'premier.csv');
  await page.getByText('Sauvegarder fiches et paramètres').click(); await page.getByText('Fiches et paramètres enregistrés.').waitFor();
  version++; await page.getByText('Sauvegarder fiches et paramètres').click(); await page.getByText('Conflit', { exact: false }).waitFor();
  await page.getByText('Actualiser mon espace').click(); await page.getByText('Espace personnel actualisé.').waitFor();
  await page.reload({ waitUntil: 'load' }); await page.locator('#application').waitFor({ state: 'visible' });
  await page.locator('#main-nav [data-page="imports"]').click(); assert.match(await page.locator('[data-drop-kind="employees"]').innerText(), /premier.csv/);
  authorized = false; await page.getByRole('button', { name: 'Espace RH en ligne' }).click(); await page.getByText('Actualiser mon espace').click(); await page.locator('#login-screen').waitFor({ state: 'visible' });
  authorized = true; await login('test-password'); await page.locator('#application').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Déconnexion' }).click(); await page.getByText('Vous êtes déconnecté.', { exact: false }).waitFor(); assert.equal(await page.locator('#application').isHidden(), true);
  await page.goto('http://127.0.0.1:3000/?recovery=1#access_token=' + jwt + '&refresh_token=refresh&token_type=bearer&expires_in=3600&type=recovery');
  await page.locator('#recovery-form').waitFor({state:'visible'}); await page.locator('#recovery-password').fill('new-password-123'); await page.locator('#recovery-confirm').fill('new-password-123'); await page.locator('#recovery-form [type=submit]').click(); await page.getByText('Mot de passe modifié.', {exact:false}).waitFor(); assert.equal(passwordUpdates,1); assert.equal(await page.locator('#application').isHidden(), true);
  await page.goto('http://127.0.0.1:3000/?recovery=1');
  await page.getByText('Lien expiré ou invalide.', {exact:false}).waitFor(); await page.locator('#recovery-back').click(); await page.locator('#login-form').waitFor({state:'visible'});
  const mobile = await context.newPage(); await mobile.setViewportSize({ width: 390, height: 844 }); await mobile.goto('http://127.0.0.1:3000'); await mobile.locator('#splash').waitFor({ state: 'detached' });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await mobile.screenshot({ path: '.cache/screenshots/login-mobile.png', fullPage: true, timeout: 30000, animations: 'disabled' });
  console.log('Inscription Supabase, connexion e-mail, splash, imports auto, historique, restauration, conflit, révocation et déconnexion simulés : OK ; axe : 0 violation.');
} finally { await browser.close(); }
