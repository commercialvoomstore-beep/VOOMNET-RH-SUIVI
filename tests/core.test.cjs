const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.XLSX = require('@e965/xlsx');
global.Papa = require('papaparse');
require('../src/core.js');
const C = global.VoomnetCore;
const TODAY = '2026-11-12';
const settings = () => C.defaultSettings(TODAY);
const fixture = () => Object.fromEntries(Object.entries({ employees: 'LISTES-EMPLOYEES.csv', absences: 'LISTES-PERMISSIONS.csv', pointage: 'LISTES-POINTAGES.csv' }).map(([kind, file]) => [kind, C.parseCSV(fs.readFileSync(path.join(__dirname, '../data', file)), file, kind)]));
const csv = (headers, rows) => new TextEncoder().encode(Papa.unparse([headers, ...rows], { delimiter: ';', newline: '\r\n' })).buffer;
const absenceRow = (mat, start, request, extra = {}) => { const row = { 'Code suivi unique': 'SHARED', 'Matricule 3CX': mat, Demandeur: 'Collaborateur Test', "Type d'absence": 'Permission', 'Motif détaillé': 'Motif privé été', 'Date de début': start, 'Date de fin': start, 'Durée (jours ouvrés)': '1', Justifiée: 'FAUX', 'Statut RH': 'En attente', 'Date de demande': request, 'Remarque administrative RH': '', ...extra }; return C.ABSENCE_HEADERS.map(h => row[h]); };
const pointRow = (mat, day, status = 'Présent', late = '', minutes = '') => [day, mat, 'Collaborateur Test', 'Voomnet Technology', status, status === 'Absent' ? '' : '08:00:00', minutes ? '17:00:00' : '', late, minutes];
const parseAbs = rows => C.parseCSV(csv(C.ABSENCE_HEADERS, rows), 'Absence.csv', 'absences');
const parsePoint = rows => C.parseCSV(csv(C.POINTAGE_HEADERS, rows), 'Pointage.csv', 'pointage');

test('données fictives : 18 personnes, 85 pointages et 5 demandes', () => {
  const sources = fixture(), rows = C.evaluateAll(sources, {}, settings(), TODAY), s = C.aggregate(rows, settings());
  assert.equal(sources.employees.rows.length, 18); assert.equal(sources.pointage.rows.length, 85); assert.equal(sources.absences.rows.length, 5);
  assert.deepEqual([s.active, s.technology, s.formation, s.otherService, s.eligible, s.ineligible, s.budget, s.due, s.urgent, s.declared, s.rawAbsentDays], [18, 15, 2, 1, 8, 10, 400000, 3, 1, 5, 13]);
  assert.equal(rows.find(r => r.mat === '9001').score, null);
  assert.equal(rows.find(r => r.mat === '10002').type, '');
  assert.equal(rows.find(r => r.mat === '9002').end, null);
});
test('fenêtres : trois mois calendaires, trimestre civil, glissants et années bissextiles', () => {
  assert.deepEqual(C.periodPreset('calendar3', TODAY), { start: '2026-09-01', end: '2026-11-30' });
  assert.deepEqual(C.periodPreset('quarter', TODAY), { start: '2026-10-01', end: '2026-12-31' });
  assert.deepEqual(C.periodPreset('rolling', TODAY), { start: '2026-08-13', end: TODAY });
  assert.deepEqual(C.periodPreset('calendar3', '2024-02-29'), { start: '2023-12-01', end: '2024-02-29' });
  assert.deepEqual(C.periodPreset('quarter', '2024-01-01'), { start: '2024-01-01', end: '2024-03-31' });
  assert.equal(C.shiftMonths('2024-03-31', -1), '2024-02-29');
});
test('dates français jour/mois, ISO, séries Excel et dates impossibles', () => {
  assert.equal(C.parseDate('30/09/2026'), '2026-09-30'); assert.equal(C.parseDate('13.01.2026'), '2026-01-13'); assert.equal(C.parseDate('2026-11-12'), '2026-11-12');
  assert.equal(C.parseDate('31/02/2026'), null); assert.equal(C.parseDate('29/02/2026'), null); assert.equal(C.parseDate('29/02/2024'), '2024-02-29');
  assert.equal(C.parseDate(46338), '2026-11-12'); assert.equal(C.parseDate('indeterminé'), null); assert.equal(C.isIndefinite('indéterminée'), true);
  assert.equal(C.diffDays('2026-11-12', '2026-11-02'), 10);
});
test('matricules joints sans fusion de noms ; casse et accents normalisés pour la recherche', () => {
  assert.equal(C.matricule(' 9012.0 '), '9012'); assert.equal(C.matricule('0012'), '0012'); assert.notEqual(C.matricule('0012'), C.matricule('12'));
  assert.equal(C.displayName('LÉA DUPONT'), 'Léa Dupont'); assert.equal(C.fold('Élodie TEST'), 'elodie test');
  assert.equal(C.matricule('__proto__'), ''); assert.equal(C.normalizeService('VOOMNET FORMATION'), 'Voomnet Formation');
});
test('prime : début OU demande dans la fenêtre, même justifiée ou approuvée', () => {
  const s = { ...settings(), end: TODAY };
  const sources = { absences: parseAbs([absenceRow('1000', '13/11/2026', '12/11/2026'), absenceRow('9001', '01/09/2026', '01/12/2026'), absenceRow('9002', '01/08/2026', '01/12/2026', { 'Date de fin': '05/09/2026', Justifiée: 'VRAI', 'Statut RH': 'Approuvée' })]) };
  const rows = C.evaluateAll(sources, {}, s, TODAY);
  assert.equal(rows.find(r => r.mat === '1000').eligible, false); assert.equal(rows.find(r => r.mat === '9001').eligible, false); assert.equal(rows.find(r => r.mat === '9002').eligible, true);
  assert.equal(C.inRange(s.start, s), true); assert.equal(C.inRange(s.end, s), true); assert.equal(C.inRange('2026-08-31', s), false);
});
test('contrôle croisé : optionnel, jours distincts, aucune absence déduite d’un statut vide', () => {
  const sources = { pointage: parsePoint([pointRow('1000', '02/11/2026', 'Absent'), pointRow('1000', '03/11/2026', ' absent '), pointRow('9001', '02/11/2026', ''), pointRow('9002', '02/11/2026', 'Présent', '0', '')]) };
  let rows = C.evaluateAll(sources, {}, { ...settings(), crossCheck: false }, TODAY);
  assert.equal(rows.find(r => r.mat === '1000').eligible, true); assert.equal(rows.find(r => r.mat === '1000').absentDays, 2);
  rows = C.evaluateAll(sources, {}, settings(), TODAY);
  assert.equal(rows.find(r => r.mat === '1000').eligible, false); assert.equal(rows.find(r => r.mat === '9001').eligible, true); assert.equal(rows.find(r => r.mat === '9002').avgMinutes, null);
});
test('UTF-8, BOM, Windows-1252, accents, guillemets et séparateur point-virgule', () => {
  const text = '\uFEFF' + Papa.unparse([C.ABSENCE_HEADERS, absenceRow('1000', '01/09/2026', '01/09/2026', { 'Motif détaillé': 'Rendez-vous médical été; "urgence"\nSuite' })], { delimiter: ';' });
  for (const encoding of ['utf8', 'latin1']) {
    const buffer = encoding === 'utf8' ? new TextEncoder().encode(text).buffer : Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text.slice(1), 'latin1')]);
    const result = C.parseCSV(buffer, 'Absence.csv', 'absences');
    assert.equal(result.rows[0].reason, 'Rendez-vous médical été; "urgence"\nSuite');
    assert.match(result.stats.encoding, encoding === 'utf8' ? /UTF-8/ : /Windows-1252/);
  }
  const comma = Papa.unparse([C.POINTAGE_HEADERS, pointRow('1000', '02/11/2026')], { delimiter: ',' });
  assert.equal(C.parseCSV(new TextEncoder().encode(comma).buffer, 'pointage.csv').kind, 'pointage');
});
test('imports invalides rejetés sans normalisation silencieuse', () => {
  assert.throws(() => C.parseCSV(new TextEncoder().encode('Date;Matricule\n02/11/2026;1000').buffer, 'bad.csv', 'pointage'), /Colonnes manquantes/);
  assert.throws(() => C.parseCSV(new TextEncoder().encode('').buffer, 'empty.csv'), /vide/);
  assert.throws(() => C.parseCSV(new TextEncoder().encode(C.POINTAGE_HEADERS.join(';') + '\n"unterminated').buffer, 'bad.csv', 'pointage'), /guillemets/);
  assert.throws(() => C.normalizeTable([C.ABSENCE_HEADERS], 'absences'), /Aucune ligne/);
  assert.throws(() => C.prepareImport(new Uint8Array(C.MAX_FILE_BYTES + 1), 'big.csv'), /10 Mo/);
  assert.throws(() => C.normalizeTable([C.POINTAGE_HEADERS, ...Array.from({ length: C.MAX_ROWS + 1 }, () => pointRow('1000', '02/11/2026'))], 'pointage'), /Limite dépassée/);
});
test('codes de suivi partagés conservés, doublons exacts et conflits de pointage tracés', () => {
  const sources = fixture(); assert.equal(sources.absences.rows.length, 5); assert.ok(sources.absences.issues.some(i => /partagé/.test(i.message)));
  const duplicate = absenceRow('1000', '01/09/2026', '01/09/2026');
  assert.equal(parseAbs([duplicate, duplicate]).rows.length, 1);
  assert.equal(parseAbs([duplicate, absenceRow('9001', '01/09/2026', '01/09/2026')]).rows.length, 2);
  const p = parsePoint([pointRow('1000', '02/11/2026', 'Présent', '0', '500'), pointRow('1000', '02/11/2026', 'Présent', '0', '500'), pointRow('1000', '02/11/2026', 'Absent')]);
  assert.equal(p.rows.length, 1); assert.equal(p.rows[0].status, 'Absent'); assert.equal(p.stats.duplicates, 2); assert.ok(p.issues.some(i => /conflit/.test(i.message)));
});
test('durées vides ou invalides ne deviennent pas des zéros ; lignes sans date rejetées', () => {
  const p = parsePoint([pointRow('1000', '02/11/2026', 'Présent', '', ''), pointRow('1000', '03/11/2026', 'Présent', '-2', '-5'), pointRow('1000', '04/11/2026', 'Journée terminée', '3', '600'), pointRow('1000', 'date invalide', 'Présent', '0', '500'), ['', '9001', 'Sans matricule', '', 'Présent']]);
  assert.equal(p.rows.length, 3); assert.equal(p.stats.rejected, 2); assert.equal(p.rows[0].minutes, null); assert.equal(p.rows[1].minutes, null); assert.equal(p.rows[1].late, null);
  const r = C.evaluateAll({ pointage: p }, {}, settings(), TODAY)[0]; assert.equal(r.avgMinutes, 600); assert.equal(r.lateMinutes, 3); assert.equal(r.insufficient, true);
});
test('contrats : seuils 15/30, dépassement, CDI et dates manquantes', () => {
  const sources = fixture();
  for (const [end, level, days] of [['2026-11-27', 'urgent', 15], ['2026-11-28', 'warning', 16], ['2026-12-12', 'warning', 30], ['2026-12-13', 'ok', 31], ['2026-11-11', 'expired', -1]]) {
    const r = C.evaluateAll(sources, { 9009: { end } }, settings(), TODAY).find(r => r.mat === '9009'); assert.equal(r.contractLevel, level); assert.equal(r.days, days);
  }
  const cdi = C.evaluateAll(sources, {}, settings(), TODAY).find(r => r.mat === '9002'); assert.equal(cdi.contractLevel, 'indeterminate'); assert.equal(cdi.contractAlert, false);
  const missing = C.evaluateAll(sources, {}, settings(), TODAY).find(r => r.mat === '9001'); assert.equal(missing.contractLevel, 'missing'); assert.equal(missing.contractAlert, false);
});
test('fiches : remplacement explicite, valeurs vides, types inconnus et validation stricte', () => {
  const sources = fixture(), contracts = { 9009: { type: 'CDD', end: '2026-12-01', email: 'test@example.com', active: false }, 10002: { type: 'CDI', end: null } };
  const rows = C.evaluateAll(sources, contracts, settings(), TODAY); assert.equal(rows.find(r => r.mat === '9009').type, 'CDD'); assert.equal(rows.find(r => r.mat === '10002').type, 'CDI');
  assert.equal(C.aggregate(rows, settings()).active, 17); assert.equal(rows.find(r => r.mat === '9009').primeStatus, 'Hors périmètre');
  assert.equal(C.normalizeProfile({ type: 'Consultante' }).type, ''); assert.throws(() => C.normalizeProfile({ type: 'Consultante' }, true), /Type/);
  assert.throws(() => C.normalizeProfile({ start: '2026-12-01', end: '2026-11-01' }, true), /précède/); assert.throws(() => C.normalizeProfile({ email: 'bad' }, true), /Email/);
  assert.equal(C.normalizeProfile({ end: '' }).end, null);
});
test('score transparent, motifs non scorés, données partielles et moyenne des seules durées positives', () => {
  const declarations = [{ reason: 'motif A' }, { reason: 'motif B' }];
  const records = [{ date: '2026-11-02', status: 'Absent', minutes: null, late: null }, { date: '2026-11-03', status: 'Présent', minutes: null, late: 10 }, { date: '2026-11-04', status: 'Journée terminée', minutes: 0, late: 0 }, { date: '2026-11-05', status: 'Journée terminée', minutes: 600, late: 0 }];
  const a = C.attendanceMetrics(records, declarations); assert.equal(a.avgMinutes, 600); assert.equal(a.lateMinutes, 10); assert.equal(a.score, 80); assert.equal(a.insufficient, true); assert.equal(a.recommendation, 'Sous réserve d’entretien');
  assert.equal(C.attendanceMetrics(records, [{ reason: 'motif C' }, { reason: 'autre' }]).score, a.score);
  const b = C.attendanceMetrics(Array.from({ length: 6 }, (_, i) => ({ date: `2026-11-0${i + 1}`, status: 'Absent', minutes: null, late: null })), []); assert.equal(b.score, 65); assert.equal(b.recommendation, 'Sous réserve d’entretien');
  assert.equal(C.attendanceMetrics([], []).score, null);
  assert.equal(C.attendanceMetrics(Array.from({ length: 4 }, (_, i) => ({ date: `2026-11-0${i + 1}`, status: 'Présent', minutes: 600, late: 0 })), []).recommendation, 'Renouvellement favorable');
});
test('emails : variables, mailto encodé, copie RH, confidentialité et HTML échappé', () => {
  const s = { ...settings(), rhEmail: 'rh@example.com' }, row = C.evaluateAll(fixture(), { 9009: { email: 'test+rh@example.com' } }, s, TODAY).find(r => r.mat === '9009');
  const email = C.emailFor(row, s); assert.ok(!email.subject.includes('{Nom}')); assert.ok(!email.body.includes('{Statut_Prime}')); assert.ok(email.body.includes('J-12')); assert.ok(!email.body.includes('gynecologique'));
  const href = C.mailtoHref(email); assert.ok(href.startsWith('mailto:test%2Brh@example.com?')); assert.ok(href.includes('cc=rh%40example.com')); assert.ok(href.includes('%0D%0A'));
  assert.equal(C.renderTemplate('{Inconnu} {Nom}', row, s), '{Inconnu} ' + row.name); assert.deepEqual(C.unknownVariables('{Nope} {Nom}'), ['Nope']);
  assert.equal(C.campaignPayload({ ...email, body: '<script>alert(1)</script>' }, row, s).html, '&lt;script&gt;alert(1)&lt;/script&gt;');
});
test('paramètres bornés et URL de relais HTTPS sans identifiants', () => {
  const s = C.sanitizeSettings({ amount: -5, alertThreshold: 999, provider: 'bad', start: '2026-12-01', end: '2026-01-01' }, TODAY); assert.equal(s.amount, 0); assert.equal(s.alertThreshold, 30); assert.equal(s.provider, 'emailjs'); assert.equal(s.start, '2026-09-01');
  assert.equal(C.safeHTTPS('http://example.com'), ''); assert.equal(C.safeHTTPS('javascript:alert(1)'), ''); assert.equal(C.safeHTTPS('https://user:secret@example.com'), ''); assert.equal(C.safeHTTPS('https://example.com/hook'), 'https://example.com/hook');
});
test('sauvegarde JSON versionnée, validation et clés prototype sans pollution', () => {
  const text = '{"version":1,"contracts":{"9009":{"type":"CDD","end":"2026-12-01"},"__proto__":{"active":false}}}';
  assert.throws(() => C.parseProfileExport(text), /Matricule invalide/);
  const parsed = C.parseProfileExport(JSON.stringify({ version: 1, contracts: { 9009: { end: '2026-12-01' } } })); assert.equal(parsed.contracts['9009'].end, '2026-12-01'); assert.equal(Object.getPrototypeOf(parsed.contracts), null);
  assert.throws(() => C.parseProfileExport('{"version":2,"contracts":{}}'), /version 1/); assert.throws(() => C.parseProfileExport('{"version":1,"contracts":{"9009":{"end":"bad"}}}'), /Date/);
});
test('exports : protection des formules CSV et rapport numérique', () => {
  for (const value of ['=1+1', '+cmd', '-cmd', '@SUM(1)', '\tformula']) assert.equal(C.safeCSVCell(value), "'" + value);
  assert.equal(C.safeCSVCell(-12), -12); assert.equal(C.safeCSVCell(0), 0); assert.equal(C.safeCSVCell(null), '');
  const report = C.reportRows(C.evaluateAll(fixture(), {}, settings(), TODAY), settings(), TODAY); assert.equal(report.length, 18); assert.equal(report.reduce((n, r) => n + r['Montant prime (FCFA)'], 0), 400000);
});
test('Excel XLSX et XLS : accents, dates et en-têtes reconnus', () => {
  for (const bookType of ['xlsx', 'biff8']) {
    const wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet([C.ABSENCE_HEADERS, absenceRow('1000', '01/09/2026', '01/09/2026', { 'Motif détaillé': 'Accents été çà où' })]); XLSX.utils.book_append_sheet(wb, ws, 'Absences');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType }); const result = C.prepareImport(buffer, 'absence.' + (bookType === 'xlsx' ? 'xlsx' : 'xls'), 'absences'); assert.equal(result.rows[0].reason, 'Accents été çà où'); assert.equal(result.rows[0].start, '2026-09-01');
  }
});
test('détection par en-têtes et indexation équivalente au filtrage naïf', () => {
  assert.equal(C.detectKind(C.EMPLOYEE_HEADERS), 'employees'); assert.equal(C.detectKind(C.POINTAGE_HEADERS), 'pointage'); assert.equal(C.detectKind(C.ABSENCE_HEADERS), 'absences');
  const sources = fixture(), s = settings(), indexed = C.evaluateAll(sources, {}, s, TODAY), naive = C.buildUniverse(sources, {}).map(r => C.evaluateEmployee(r, sources, s, TODAY)); assert.deepEqual(indexed, naive);
});
