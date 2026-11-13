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
let version = 0, loggedIn = false, authorized = true, apiAvailable = true, sequence = 0;
let snapshot = { version: 1, contracts: {}, settings: {} }, active = { employees: null, absences: null, pointage: null };
const saved = {}, history = { employees: [], absences: [], pointage: [] };
const authBase = 'https://ep-orange-unit-b7693tds.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth';
const user = { id: 'rh-user-test', email: '1005@rh-identifiant.invalid', name: 'RH Démo', emailVerified: true };
const session = { id: 'session1', userId: user.id, token: 'opaque-session', expiresAt: '2030-01-01T00:00:00.000Z' };
const cors = { 'access-control-allow-origin': 'http://127.0.0.1:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-expose-headers': 'set-auth-jwt', 'set-auth-jwt': 'header.payload.signature' };
await context.route(authBase + '/**', async route => {
  const path = route.request().url().slice(authBase.length);
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (path.startsWith('/sign-in/email')) {
    const body = route.request().postDataJSON(); assert.equal(body.email, '1005@rh-identifiant.invalid');
    if (body.password !== 'test-password') return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"message":"Invalid credentials"}' });
    loggedIn = true; return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ user, session }) });
  }
  if (path.startsWith('/get-session')) return route.fulfill({ status: 200, headers: loggedIn ? cors : { ...cors, 'set-auth-jwt': '' }, contentType: 'application/json', body: JSON.stringify(loggedIn ? { user, session } : null) });
  if (path.startsWith('/sign-out')) { loggedIn = false; return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"success":true}' }); }
  return route.fulfill({ status: 404, headers: cors, body: '{}' });
});
await context.route('**/.netlify/functions/workspace**', async route => {
  const req = route.request(), url = new URL(req.url()), action = url.searchParams.get('action');
  assert.equal(req.headers().authorization, 'Bearer header.payload.signature');
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
  await login('incorrect'); await page.getByText('Connexion impossible.', { exact: false }).waitFor(); assert.equal(await page.locator('#application').isHidden(), true); assert.equal(await page.locator('#login-password').inputValue(), '');
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
  await page.getByRole('button', { name: 'Espace RH en ligne' }).click(); await page.getByText('Se déconnecter').click(); await page.getByText('Vous êtes déconnecté.', { exact: false }).waitFor(); assert.equal(await page.locator('#application').isHidden(), true);
  const mobile = await context.newPage(); await mobile.setViewportSize({ width: 390, height: 844 }); await mobile.goto('http://127.0.0.1:3000'); await mobile.locator('#splash').waitFor({ state: 'detached' });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await mobile.screenshot({ path: '.cache/screenshots/login-mobile.png', fullPage: true, timeout: 30000, animations: 'disabled' });
  console.log('Connexion ID, splash, imports auto, historique, restauration, conflit, révocation et déconnexion simulés : OK ; axe : 0 violation.');
} finally { await browser.close(); }
