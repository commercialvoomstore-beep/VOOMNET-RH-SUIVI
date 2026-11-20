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
let signups = 0, ready = false;
await context.route('**/.netlify/functions/signup-ready', route => route.fulfill({ status: ready ? 200 : 503, contentType: 'application/json', body: ready ? '{"ready":true}' : '{"error":"non configuré"}' }));
await context.route(authBase + '/**', async route => {
  const path = route.request().url().slice(authBase.length);
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (path.startsWith('/signup')) { const body = route.request().postDataJSON(); assert.equal(body.data.rh_identifier, '1005'); assert.equal(body.email, 'rh@example.test'); signups++; return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ...user, identities: [{ id: user.id }] }) }); }
  if (path.startsWith('/user')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(user) });
  if (path.startsWith('/logout')) return route.fulfill({ status: 204, headers: cors });
  return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{}' });
});
await context.route('**/.netlify/functions/login', async route => {
  const body = route.request().postDataJSON(); assert.equal(body.identifier, '1005');
  if (body.password !== 'test-password') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Identifiant ou mot de passe incorrect."}' });
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: jwt, refresh_token: 'refresh' }) });
});
await context.route('**/.netlify/functions/workspace**', async route => {
  const req = route.request(), url = new URL(req.url()), action = url.searchParams.get('action');
  assert.equal(req.headers().authorization, 'Bearer ' + jwt);
  if (!apiAvailable) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Service non configuré."}' });
  if (!authorized) return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Ce compte ne dispose pas des droits RH."}' });
  let output;
  if (req.method() === 'GET' && action === 'source') output = { source: saved[url.searchParams.get('id')] };
  else if (req.method() === 'GET' && action === 'history') output = { history };
  else if (req.method() === 'GET') output = { version, snapshot, active };
  else {
    const body = req.postDataJSON();
    if (body.expectedVersion !== version) return route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"Conflit"}' });
    if (action === 'import') { const id = String(++sequence); saved[id] = body.source; active[body.kind] = id; history[body.kind].unshift({ id, filename: body.source.filename, created_at: new Date().toISOString() }); }
    else if (action === 'restore') active[body.kind] = body.id;
    else if (action === 'remove') active[body.kind] = null;
    else if (req.method() === 'PUT') snapshot = body.snapshot;
    output = { version: ++version };
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(output) });
});
page.on('dialog', d => d.accept());
const login = async password => { await page.locator('#login-id').fill('1005'); await page.locator('#login-password').fill(password); await page.locator('#login-form [type="submit"]').click(); };
try {
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'load' });
  assert.equal(await page.locator('#splash').isVisible(), true); await page.locator('#splash').waitFor({ state: 'detached' });
  await page.waitForFunction(() => !document.querySelector('#login-form [type=submit]').disabled);
  assert.equal(await page.locator('#application').isHidden(), true); assert.equal(await page.locator('#login-screen').isVisible(), true);
  mkdirSync('.cache/screenshots', { recursive: true }); await page.screenshot({ path: '.cache/screenshots/login.png', fullPage: true, timeout: 30000, animations: 'disabled' });
  assert.deepEqual((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(v => v.id), []);
  await page.locator('#auth-switch').click(); assert.deepEqual((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(v => v.id), []); await page.locator('#signup-id').fill('1005'); await page.locator('#signup-email').fill('rh@example.test'); await page.locator('#signup-password').fill('long-password-123'); await page.locator('#signup-confirm').fill('long-password-123'); await page.locator('#signup-form [type=submit]').click(); await page.getByText('Inscription indisponible', { exact: false }).waitFor(); assert.equal(signups, 0); ready = true; await page.locator('#signup-password').fill('long-password-123'); await page.locator('#signup-confirm').fill('long-password-123'); await page.locator('#signup-form [type=submit]').click(); await page.getByText('Si l’inscription est acceptée', { exact: false }).waitFor(); assert.equal(signups, 1); assert.equal(await page.locator('#signup-password').inputValue(), ''); await page.locator('#auth-switch').click();
  await login('incorrect'); await page.getByText('Identifiant ou mot de passe incorrect.', { exact: false }).waitFor(); assert.equal(await page.locator('#application').isHidden(), true); assert.equal(await page.locator('#login-password').inputValue(), '');
  authorized = false; await login('test-password'); await page.getByText('Compte non autorisé.', { exact: false }).waitFor(); assert.equal(await page.locator('#application').isHidden(), true);
  authorized = true; apiAvailable = false; await login('test-password'); await page.getByText('Service non configuré.', { exact: false }).waitFor(); assert.equal(await page.locator('#application').isHidden(), true);
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
  const mobile = await context.newPage(); await mobile.setViewportSize({ width: 390, height: 844 }); await mobile.goto('http://127.0.0.1:3000'); await mobile.locator('#splash').waitFor({ state: 'detached' });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await mobile.screenshot({ path: '.cache/screenshots/login-mobile.png', fullPage: true, timeout: 30000, animations: 'disabled' });
  console.log('Inscription Supabase, connexion ID, splash, imports auto, historique, restauration, conflit, révocation et déconnexion simulés : OK ; axe : 0 violation.');
} finally { await browser.close(); }
