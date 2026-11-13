import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import sparticuz, { inflate } from '@sparticuz/chromium';
import AxeBuilder from '@axe-core/playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const archive = resolve('node_modules/@sparticuz/chromium/bin/al2023.tar.br');
if (!existsSync('/tmp/al2023/lib/libnspr4.so')) await inflate(archive);
const browser = await chromium.launch({ executablePath: await sparticuz.executablePath(), headless: true, args: sparticuz.args.filter(a => !['--single-process','--disable-web-security','--allow-running-insecure-content'].includes(a)), env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp:' + (process.env.LD_LIBRARY_PATH || '') } });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
const page = await context.newPage();
let remoteVersion = 0, snapshot = null, loggedIn = false, authorized = true, apiAvailable = true;
const authBase = 'https://ep-orange-unit-b7693tds.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth';
const user = { id: 'rh-user-test', email: 'rh@example.invalid', name: 'RH Démo', emailVerified: true };
const session = { id: 'session1', userId: user.id, token: 'opaque-session', expiresAt: '2030-01-01T00:00:00.000Z' };
const cors = { 'access-control-allow-origin': 'http://127.0.0.1:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-expose-headers': 'set-auth-jwt', 'set-auth-jwt': 'header.payload.signature' };
await context.route(authBase + '/**', async route => {
  const path = route.request().url().slice(authBase.length);
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (path.startsWith('/sign-in/email')) {
    const body = route.request().postDataJSON();
    if (body.password !== 'test-password') return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"message":"Invalid credentials"}' });
    loggedIn = true; return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ user, session }) });
  }
  if (path.startsWith('/get-session')) return route.fulfill({ status: 200, headers: loggedIn ? cors : { ...cors, 'set-auth-jwt': '' }, contentType: 'application/json', body: JSON.stringify(loggedIn ? { user, session } : null) });
  if (path.startsWith('/sign-out')) { loggedIn = false; return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"success":true}' }); }
  return route.fulfill({ status: 404, headers: cors, body: '{}' });
});
await context.route('**/.netlify/functions/workspace', async route => {
  assert.equal(route.request().headers().authorization, 'Bearer header.payload.signature');
  if (!apiAvailable) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Service non configuré."}' });
  if (!authorized) return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Ce compte ne dispose pas des droits RH."}' });
  if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: remoteVersion, snapshot }) });
  const body = route.request().postDataJSON();
  if (body.expectedVersion !== remoteVersion) return route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"Conflit"}' });
  snapshot = body.snapshot; remoteVersion++;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: remoteVersion }) });
});
page.on('dialog', d => d.accept());
const login = async password => {
  await page.locator('#login-email').fill('rh@example.invalid'); await page.locator('#login-password').fill(password);
  await page.locator('#login-form [type="submit"]').click();
};
try {
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('#login-form [type=submit]').disabled);
  assert.equal(await page.locator('#application').isHidden(), true);
  assert.equal(await page.locator('#login-screen').isVisible(), true);
  mkdirSync('.cache/screenshots', { recursive: true });
  await page.screenshot({ path: '.cache/screenshots/login.png', fullPage: true, timeout: 30000, animations: 'disabled' });
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(a11y.violations.map(v => v.id), []);
  await login('incorrect'); await page.getByText('Connexion impossible.', { exact: false }).waitFor();
  assert.equal(await page.locator('#application').isHidden(), true); assert.equal(await page.locator('#login-password').inputValue(), '');
  authorized = false; await login('test-password');
  await page.getByText('Compte non autorisé.', { exact: false }).waitFor();
  assert.equal(await page.locator('#application').isHidden(), true); assert.match(await page.locator('#login-message').innerText(), /rh-user-test/);
  authorized = true; apiAvailable = false; await login('test-password');
  await page.getByText('Service non configuré.', { exact: false }).waitFor(); assert.equal(await page.locator('#application').isHidden(), true);
  apiAvailable = true; await login('test-password'); await page.locator('#application').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#login-screen').isHidden(), true);
  await page.getByText('Espace RH en ligne').click(); await page.getByText('Charger depuis la base').click();
  await page.getByText('La base est vide.', { exact: false }).waitFor(); await page.locator('#cloud-close').click();
  await page.locator('#main-nav [data-page="imports"]').click(); await page.locator('#file-employees').setInputFiles(resolve('data/LISTES-EMPLOYEES.csv'));
  await page.waitForFunction(() => document.querySelector('#busy').hidden);
  await page.getByText('Espace RH en ligne').click(); await page.getByText('Sauvegarder dans la base').click();
  await page.getByText('Données enregistrées', { exact: false }).waitFor(); assert.equal(snapshot.sources.employees.rows.length, 18); assert.equal(remoteVersion, 1);
  remoteVersion++; await page.getByText('Sauvegarder dans la base').click(); await page.getByText('Conflit', { exact: false }).waitFor();
  await page.getByText('Charger depuis la base').click(); await page.getByText('Données partagées chargées.', { exact: false }).waitFor();
  await page.reload({ waitUntil: 'load' }); await page.locator('#application').waitFor({ state: 'visible' });
  authorized = false; await page.getByText('Espace RH en ligne').click(); await page.getByText('Charger depuis la base').click();
  await page.locator('#login-screen').waitFor({ state: 'visible' }); assert.equal(await page.locator('#application').isHidden(), true);
  authorized = true; await login('test-password'); await page.locator('#application').waitFor({ state: 'visible' });
  await page.getByText('Espace RH en ligne').click(); await page.getByText('Se déconnecter').click();
  await page.getByText('Vous êtes déconnecté.', { exact: false }).waitFor(); assert.equal(await page.locator('#application').isHidden(), true);
  const mobile = await context.newPage(); await mobile.setViewportSize({ width: 390, height: 844 }); await mobile.goto('http://127.0.0.1:3000');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.screenshot({ path: '.cache/screenshots/login-mobile.png', fullPage: true, timeout: 30000, animations: 'disabled' });
  console.log('Accès, erreur, refus RH, panne, restauration, révocation, déconnexion et sauvegarde simulés : OK. Axe : 0 violation.');
} finally { await browser.close(); }
