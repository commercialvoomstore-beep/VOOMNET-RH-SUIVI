import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium as playwright } from 'playwright';
import sparticuz, { inflate } from '@sparticuz/chromium';
import AxeBuilder from '@axe-core/playwright';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('@e965/xlsx'), Papa = require('papaparse');
const root = resolve(import.meta.dirname, '..'), out = resolve(root, '.cache/screenshots');
mkdirSync(out, { recursive: true });
const al2023 = resolve(root, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br');
if (!existsSync('/tmp/al2023/lib/libnspr4.so') && existsSync(al2023)) await inflate(al2023);
const executablePath = process.env.CHROMIUM_PATH || await sparticuz.executablePath();
const browser = await playwright.launch({ executablePath, headless: true, args: sparticuz.args.filter(arg => !['--single-process', '--disable-web-security', '--allow-running-insecure-content'].includes(arg)), env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp:' + (process.env.LD_LIBRARY_PATH || '') } });
async function mockAuthorized(ctx) {
  const base = 'https://ep-orange-unit-b7693tds.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth';
  const cors = { 'access-control-allow-origin': 'http://127.0.0.1:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-expose-headers': 'set-auth-jwt', 'set-auth-jwt': 'header.payload.signature' };
  await ctx.route(base + '/**', route => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ user: { id: 'browser-test', email: 'rh@example.invalid' }, session: { id: 'session-test', token: 'opaque', userId: 'browser-test', expiresAt: '2030-01-01T00:00:00.000Z' } }) }));
  let version = 0, snapshot = { version: 1, contracts: {}, settings: {} }, active = { employees: null, absences: null, pointage: null }, sequence = 0; const imports = {};
  await ctx.route('**/.netlify/functions/workspace**', async route => {
    const req = route.request(), u = new URL(req.url()), action = u.searchParams.get('action'); let response;
    if (req.method() === 'GET' && action === 'source') response = { source: imports[u.searchParams.get('id')] };
    else if (req.method() === 'GET' && action === 'history') response = { history: { employees: [], absences: [], pointage: [] } };
    else if (req.method() === 'GET') response = { version, snapshot, active };
    else {
      const data = req.postDataJSON();
      if (data.expectedVersion !== version) return route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"Conflit"}' });
      if (action === 'import') { const id = String(++sequence); imports[id] = data.source; active[data.kind] = id; }
      else if (action === 'remove') active[data.kind] = null;
      else if (req.method() === 'PUT') snapshot = data.snapshot;
      response = { version: ++version };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
}
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR', timezoneId: 'Africa/Abidjan', acceptDownloads: true });
await mockAuthorized(context);
const page = await context.newPage(); page.setDefaultTimeout(10000);
const errors = [], initialRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:') && !request.url().startsWith('data:')) initialRequests.push(request.url()); });
const url = process.env.TEST_URL || 'http://127.0.0.1:3000';
const step = name => console.log('✓', name);
const domClick = selector => page.evaluate(s => { const el = document.querySelector(s); if (!el) throw new Error('Élément absent : ' + s); el.click(); }, selector);
const domFill = (selector, value) => page.evaluate(({ s, v }) => { const el = document.querySelector(s); if (!el) throw new Error('Champ absent : ' + s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, { s: selector, v: value });
const domSelect = (selector, value) => page.evaluate(({ s, v }) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, { s: selector, v: value });
const domValue = selector => page.evaluate(s => document.querySelector(s)?.value, selector);
const nav = async destination => { await domClick(`#main-nav [data-page="${destination}"], #tools-nav [data-page="${destination}"]`); };
const kpi = async () => (await page.locator('.kpi-value').allTextContents()).map(s => s.trim());
const waitIdle = async () => { await page.waitForFunction(() => document.querySelector('#busy')?.hidden); };
const upload = async (kind, file) => { await page.locator('#file-' + kind).setInputFiles(file); await waitIdle(); };
const original = kind => resolve(root, 'data/' + ({ absences: 'LISTES-PERMISSIONS.csv', pointage: 'LISTES-POINTAGES.csv', employees: 'LISTES-EMPLOYEES.csv' }[kind]));
const csvBuffer = (headers, rows, latin1 = false) => { const text = Papa.unparse([headers, ...rows], { delimiter: ';', newline: '\r\n' }); return latin1 ? Buffer.from(text, 'latin1') : Buffer.from(text, 'utf8'); };
const headers = kind => Papa.parse(readFileSync(original(kind), 'utf8').trim(), { delimiter: ';' }).data[0];
async function download(action, filename) { const [dl] = await Promise.all([page.waitForEvent('download'), action()]); const path = resolve(out, filename); await dl.saveAs(path); return path; }
async function exportFile(type, filename) { await page.locator('[data-action="toggle-export"]').click(); return download(() => page.locator(`[data-action="export-${type}"]`).click(), filename); }
async function editContract(mat, fields) { await domClick(`[data-action="contract-edit"][data-mat="${mat}"]`); for (const [name, value] of Object.entries(fields)) await domFill(`#contract-form [name="${name}"]`, value); await domClick('button[form="contract-form"]'); await page.waitForFunction(() => !document.querySelector('#modal').open); }
async function confirmSend() { assert.equal(await page.locator('#campaign-send').isDisabled(), true); await page.evaluate(() => { const el = document.querySelector('#campaign-confirm'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }); await domClick('#campaign-send'); await page.waitForTimeout(150); await page.waitForFunction(() => document.querySelector('#campaign-progress') && !document.querySelector('#campaign-progress .spinner')); }
try {
  await page.clock.setFixedTime(new Date('2026-11-12T12:00:00Z'));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#application').waitFor({ state: 'visible' });
  assert.deepEqual(await kpi(), ['18', '8', '3', '5']);
  assert.equal(await page.locator('#period-start').inputValue(), '2026-09-01'); assert.equal(await page.locator('#period-end').inputValue(), '2026-11-30');
  assert.ok(initialRequests.every(url => url.startsWith('https://ep-orange-unit-b7693tds.neonauth.'))); step('Démonstration fictive : 18 collaborateurs, 8 éligibles, 3 échéances ; authentification simulée');
  await page.screenshot({ path: resolve(out, 'desktop-dashboard.png'), fullPage: true, timeout: 30000, animations: 'disabled' });
  await page.locator('#employee-search').fill('démo 9009'); assert.equal(await page.locator('#table-results tbody tr').count(), 1);
  await page.locator('#employee-search').fill('9009'); assert.equal(await page.locator('#table-results tbody tr').count(), 1);
  await page.locator('[data-action="reset-filters"]').click(); await page.locator('#service-filter').selectOption('Voomnet Formation'); assert.equal(await page.locator('#table-results tbody tr').count(), 2);
  await page.locator('[data-action="reset-filters"]').click(); await page.locator('#eligibility-filter').selectOption('ineligible'); await page.locator('#page-size').selectOption('16'); assert.equal(await page.locator('#table-results tbody tr').count(), 10);
  await page.locator('#cross-check').click(); assert.deepEqual(await kpi(), ['18', '13', '3', '5']);
  await page.locator('#cross-check').click(); await page.locator('#prime-amount').fill('75000'); await page.locator('#prime-amount').press('Tab'); assert.match(await page.locator('.kpi').nth(1).innerText(), /600\s?000/);
  await page.locator('#prime-amount').fill('50000'); await page.locator('#prime-amount').press('Tab');
  await page.locator('#period-mode').selectOption('quarter'); assert.equal(await page.locator('#period-end').inputValue(), '2026-12-31');
  await page.locator('#period-mode').selectOption('rolling'); assert.equal(await page.locator('#period-start').inputValue(), '2026-08-13');
  await page.locator('#period-mode').selectOption('calendar3'); step('Recherche accentuée, filtres, pagination, contrôle croisé, montant et périodes');
  await page.locator('[data-action="tab"][data-tab="contracts"]').click();
  assert.equal(await page.locator('[data-contract-end]').first().getAttribute('data-contract-end'), '9009');
  assert.match(await page.locator('#table-results tbody tr').first().innerText(), /J-12/);
  await page.locator('[data-contract-end="9009"]').fill('2026-11-22'); await page.locator('[data-contract-end="9009"]').press('Tab');
  assert.match(await page.locator('#table-results tbody tr').first().innerText(), /J-10/);
  await page.reload({ waitUntil: 'networkidle' }); await page.locator('#application').waitFor({ state: 'visible' }); await page.locator('[data-action="tab"][data-tab="contracts"]').click(); assert.equal(await page.locator('[data-contract-end="9009"]').inputValue(), '2026-11-22');
  await editContract('9009', { email: 'test.joel@example.com', end: '2026-11-24' });
  await domClick('[data-action="contract-edit"][data-mat="9009"]'); await domClick('[data-action="reset-contract"]'); await domClick('[data-action="confirm-accept"]'); await page.waitForTimeout(150); assert.equal(await domValue('[data-contract-end="9009"]'), '2026-11-24');
  await editContract('9009', { email: 'test.joel@example.com' });
  await domClick('#table-results [data-action="email-preview"][data-mat="9009"]'); const preview = await domValue('#preview-body'); assert.ok(preview.includes('J-12')); assert.ok(!preview.includes('{Nom}')); assert.ok(!preview.includes('gynecologique')); await domClick('[data-action="close-modal"]');
  await page.screenshot({ path: resolve(out, 'desktop-contracts.png'), fullPage: true, timeout: 30000, animations: 'disabled' }); step('Contrats éditables, seuils, persistance, rétablissement source et aperçu email confidentiel');
  await nav('imports');
  const absenceHeaders = headers('absences'), row = ['TEST-1', '9010', 'COLLABORATEUR DÉMO 9010', 'Permission', 'Rendez-vous médical été; précision française', '30/09/2026', '30/09/2026', '1', 'FAUX', 'En attente', '12/11/2026', ''];
  await upload('absences', { name: 'Absence.csv', mimeType: 'text/csv', buffer: csvBuffer(absenceHeaders, [row], true) });
  assert.match(await page.locator('[data-drop-kind="absences"]').locator('..').innerText(), /Windows-1252/);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('voomnet-rh:v1')).mode), 'workspace');
  await upload('employees', original('employees')); await upload('pointage', original('pointage'));
  await nav('overview'); assert.deepEqual(await kpi(), ['18', '12', '3', '1']);
  await page.locator('#employee-search').fill('9010'); await page.locator('[data-action="employee-detail"]').first().click(); assert.match(await page.locator('#modal').innerText(), /Rendez-vous médical été/); await domClick('[data-action="close-modal"]');
  await nav('imports'); await upload('pointage', original('employees')); assert.match(await page.locator('#toasts').innerText(), /Colonnes manquantes/); assert.match(await page.locator('[data-drop-kind="pointage"]').innerText(), /LISTES-POINTAGES.csv/);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([absenceHeaders, row]), 'Absences');
  await upload('absences', { name: 'Absence.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) }); assert.match(await page.locator('[data-drop-kind="absences"]').locator('..').innerText(), /Classeur Excel/);
  const xssHeaders = headers('employees'); await upload('employees', { name: 'employes.csv', mimeType: 'text/csv', buffer: csvBuffer(xssHeaders, [['<img src=x onerror="window.__xss=1">', '9999', '', '', '', 'CDD', '01/09/2026', '01/12/2026', '']]) });
  assert.equal(await page.evaluate(() => window.__xss), undefined); assert.equal(await page.locator('#main-content img').count(), 0);
  await upload('employees', original('employees')); await page.screenshot({ path: resolve(out, 'desktop-imports.png'), fullPage: true, timeout: 30000, animations: 'disabled' }); step('Imports CSV Windows-1252, Excel, mauvais fichiers rejetés, accents et protection XSS');
  await editContractViaImport('9009', 'workspace.joel@example.com');
  const profilePath = await download(() => page.locator('[data-action="profile-export"]').click(), 'profiles.json'); const profile = JSON.parse(readFileSync(profilePath, 'utf8')); assert.equal(profile.contracts['9009'].email, 'workspace.joel@example.com');
  await page.locator('[data-action="clear-local"]').click(); await domClick('[data-action="confirm-accept"]'); await page.waitForTimeout(150);
  await page.locator('[data-action="switch-mode"]').click(); await upload('profile', profilePath); await domClick('[data-action="confirm-accept"]'); await page.waitForTimeout(150);
  for (const kind of ['employees', 'absences', 'pointage']) await upload(kind, original(kind));
  await nav('contracts'); assert.match(await page.locator('#table-results').innerText(), /workspace\.joel@example\.com/); step('Sauvegarde JSON, effacement local et restauration par matricule');
  await nav('settings'); await domFill('#rh-email', 'rh@example.com'); await domClick('#rules-form button[type="submit"]');
  await domFill('#emailjs-service', 'service_test'); await domFill('#emailjs-template', 'template_test'); await domFill('#emailjs-public', 'public_test'); await domClick('#provider-form button[type="submit"]');
  const emailRequests = [];
  await page.route('https://api.emailjs.com/**', route => { emailRequests.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'text/plain', body: 'OK' }); });
  await nav('emails'); await domClick('.btn-primary[data-action="campaign-preview"]'); await confirmSend(); assert.equal(emailRequests.length, 3);
  assert.ok(emailRequests.every(p => p.template_params.cc_email === 'rh@example.com' && !p.template_params.message.includes('gynecologique')));
  assert.match(await page.locator('#campaign-progress').innerText(), /Accepté par l’API/);
  await page.route('https://api.emailjs.com/**', route => { emailRequests.push(route.request().postDataJSON()); return route.fulfill({ status: 500, body: 'error' }); });
  await nav('contracts'); await domClick('#table-results [data-action="email-preview"][data-mat="9009"]'); await domClick('[data-action="send-single"]'); await confirmSend(); assert.equal(emailRequests.length, 4); assert.match(await page.locator('#campaign-progress').innerText(), /Échec de la requête/); step('EmailJS simulé par interception : lot confirmé, copie RH, échec HTTP sans renvoi automatique');
  await nav('settings'); await domSelect('#provider-choice', 'webhook'); await domFill('#webhook-url', 'https://relay.example.test/notify'); await domFill('#webhook-token', 'session-secret-do-not-persist'); await domClick('#provider-form button[type="submit"]');
  const webhookRequests = [];
  await page.route('https://relay.example.test/**', route => { webhookRequests.push({ body: route.request().postDataJSON(), authorization: route.request().headers().authorization }); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' }); });
  await nav('contracts'); await domClick('#table-results [data-action="email-preview"][data-mat="9009"]'); await domClick('[data-action="send-single"]'); await confirmSend(); assert.equal(webhookRequests.length, 1); assert.equal(webhookRequests[0].authorization, 'Bearer session-secret-do-not-persist'); assert.equal(webhookRequests[0].body.to.email, 'workspace.joel@example.com');
  const csvPath = await exportFile('csv', 'report.csv'), xlsxPath = await exportFile('xlsx', 'report.xlsx');
  const csvText = readFileSync(csvPath, 'utf8'); assert.equal(csvText.charCodeAt(0), 0xfeff); const parsedCSV = Papa.parse(csvText.slice(1), { header: true, delimiter: ';' }); assert.equal(parsedCSV.data.length, 18);
  const exportedWB = XLSX.read(readFileSync(xlsxPath), { type: 'buffer' }); assert.ok(exportedWB.SheetNames.includes('Décisions RH')); assert.equal(XLSX.utils.sheet_to_json(exportedWB.Sheets['Décisions RH']).length, 18);
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; }); await page.locator('[data-action="toggle-export"]').click(); await page.locator('[data-action="print"]').click(); assert.equal(await page.evaluate(() => window.__printed), 1); assert.match(await page.locator('#print-report').innerText(), /Rapport de décision/);
  const profilePath2 = await download(async () => { await nav('imports'); await page.locator('[data-action="profile-export"]').click(); }, 'profiles-no-secret.json'); assert.ok(!readFileSync(profilePath2, 'utf8').includes('session-secret-do-not-persist'));
  await page.getByRole('button', { name: 'Espace RH en ligne' }).click(); await page.getByText('Sauvegarder fiches et paramètres').click(); await page.getByText('Fiches et paramètres enregistrés.').waitFor(); await page.locator('#cloud-close').click();
  await page.reload({ waitUntil: 'networkidle' }); await page.locator('#application').waitFor({ state: 'visible' }); await nav('settings'); assert.equal(await domValue('#webhook-token'), ''); assert.ok(!(await page.evaluate(() => localStorage.getItem('voomnet-rh:v1'))).includes('session-secret-do-not-persist')); step('Webhook simulé, exports CSV/XLSX/PDF, jeton Bearer jamais persisté');
  assert.deepEqual(errors, []);
  const auditContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR', timezoneId: 'Africa/Abidjan' }); await mockAuthorized(auditContext); const auditPage = await auditContext.newPage(); await auditPage.goto(url, { waitUntil: 'networkidle' }); await auditPage.locator('#application').waitFor({ state: 'visible' }).catch(async e => { console.log('AUDIT LOGIN', await auditPage.locator('#login-message').innerText()); throw e; });
  const violations = [];
  for (const destination of ['overview', 'contracts', 'imports', 'emails', 'settings']) {
    await auditPage.evaluate(destination => document.querySelector(`#main-nav [data-page="${destination}"], #tools-nav [data-page="${destination}"]`).click(), destination);
    const result = await new AxeBuilder({ page: auditPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    violations.push(...result.violations.map(v => ({ page: destination, id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })).slice(0, 12) })));
  }
  writeFileSync(resolve(out, 'accessibility.json'), JSON.stringify(violations, null, 2));
  if (violations.length) console.log('ACCESSIBILITÉ', JSON.stringify(violations, null, 2));
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', timezoneId: 'Africa/Abidjan', isMobile: true, hasTouch: true }); await mockAuthorized(mobileContext); const mobile = await mobileContext.newPage(); await mobile.goto(url, { waitUntil: 'networkidle' }); await mobile.locator('#application').waitFor({ state: 'visible' });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); await mobile.screenshot({ path: resolve(out, 'mobile-dashboard.png'), fullPage: true, timeout: 30000, animations: 'disabled' });
  await mobile.locator('[data-action="open-sidebar"]').click(); await mobile.locator('#main-nav [data-page="contracts"]').click(); await mobile.locator('[data-action="contract-edit"]').first().click(); const box = await mobile.locator('#modal').boundingBox(); assert.ok(box.width <= 390); await mobile.screenshot({ path: resolve(out, 'mobile-contract-modal.png'), timeout: 30000, animations: 'disabled' });
  const offline = await auditContext.newPage(); await offline.goto(pathToFileURL(resolve(root, 'index.html')).href, { waitUntil: 'load' }); assert.equal(await offline.locator('#application').isHidden(), true); assert.equal(await offline.locator('#login-screen').isVisible(), true); step('Responsive mobile, modale adaptée et accès hors ligne refusé');
  assert.equal(violations.length, 0, 'Des violations WCAG AA ont été détectées ; voir .cache/screenshots/accessibility.json');
  console.log('Tous les tests navigateur sont passés.');
} catch (error) { console.error('PAGE ERRORS', errors); console.error('DEBUG', await page.evaluate(() => ({ page: document.querySelector('h1')?.textContent, tab: document.querySelector('.table-tab.active')?.textContent, modal: document.querySelector('#modal')?.open, modalText: document.querySelector('#modal')?.innerText.slice(0, 300), body: document.querySelector('#main-content')?.innerText.slice(0, 500), inputs: [...document.querySelectorAll('#table-results input')].slice(0, 3).map(x => x.outerHTML), count: document.querySelectorAll('[data-contract-end="9009"]').length })).catch(() => null)); await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }).catch(() => {}); throw error; } finally { await browser.close(); }
async function editContractViaImport(mat, email) { await nav('contracts'); await editContract(mat, { email }); await nav('imports'); }
