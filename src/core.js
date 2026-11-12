/* Voomnet RH — moteur de règles, sans accès au DOM. */
(() => {
  'use strict';
  const G = typeof window !== 'undefined' ? window : globalThis;
  const MAX_ROWS = 50000;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const STORAGE_KEY = 'voomnet-rh:v1';
  const CONTRACT_TYPES = ['CDD', 'CDI', 'Stage', 'Essai'];
  const ABSENCE_HEADERS = ['Code suivi unique', 'Matricule 3CX', 'Demandeur', "Type d'absence", 'Motif détaillé', 'Date de début', 'Date de fin', 'Durée (jours ouvrés)', 'Justifiée', 'Statut RH', 'Date de demande', 'Remarque administrative RH'];
  const POINTAGE_HEADERS = ['Date', 'Matricule', 'Nom', 'Service', 'Statut', 'Arrivée', 'Départ', 'Retard (min)', 'Durée (min)'];
  const EMPLOYEE_HEADERS = ['Utilisateur', 'Numéro 3CX', 'Email', 'Poste', 'Poste occupé', 'Status contrat', 'DEBUT CONTRAT', 'FIN CONTRAT', 'Contact'];
  const LABELS = { absences: 'Absences déclarées', pointage: 'Pointage', employees: 'Référentiel collaborateurs' };
  const SCHEMAS = {
    absences: { id: ['Code suivi unique'], mat: ['Matricule 3CX'], name: ['Demandeur'], type: ["Type d'absence"], reason: ['Motif détaillé'], start: ['Date de début'], end: ['Date de fin'], days: ['Durée (jours ouvrés)'], justified: ['Justifiée'], status: ['Statut RH'], request: ['Date de demande'], note: ['Remarque administrative RH'] },
    pointage: { date: ['Date'], mat: ['Matricule'], name: ['Nom'], service: ['Service'], status: ['Statut'], arrival: ['Arrivée'], departure: ['Départ'], late: ['Retard (min)'], minutes: ['Durée (min)'] },
    employees: { name: ['Utilisateur'], mat: ['Numéro 3CX'], email: ['Email'], role: ['Poste'], position: ['Poste occupé'], contractRaw: ['Status contrat'], start: ['DEBUT CONTRAT'], end: ['FIN CONTRAT'] }
  };
  const DEFAULT_SUBJECT = 'Fin de contrat à anticiper — {Nom} ({Matricule})';
  const DEFAULT_BODY = `Bonjour {Nom},\n\nVotre contrat au sein de {Service} arrive à son échéance le {Date_Fin_Contrat} ({Jours_Restants}). Nous vous invitons à prendre contact avec le service RH afin d’échanger sur la suite de votre collaboration.\n\nVotre bilan d’assiduité sur la période de référence :\n• Absences : {Total_Absences}\n• Cumul des retards : {Retard_Minutes} minutes\n• Durée moyenne de présence renseignée : {Duree_Moyenne}\n• Prime trimestrielle : {Statut_Prime}\n\nMatricule : {Matricule}\nPériode analysée : {Periode}\n\nCe récapitulatif est fourni à titre d’information et ne constitue ni une décision de renouvellement, ni une notification de rupture. Le service RH reste votre interlocuteur pour examiner votre situation.\n\nCordialement,\nLe service RH — Voomnet Technology / Voomnet Formation`;
  const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
  const headerKey = value => fold(value).replace(/[^a-z0-9]/g, '');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  function matricule(value) {
    let s = String(value ?? '').trim();
    if (/^\d+\.0+$/.test(s)) s = s.split('.')[0];
    s = s.toUpperCase();
    return /^[\p{L}\p{N}][\p{L}\p{N}._\/-]{0,63}$/u.test(s) ? s : '';
  }
  function displayName(value) {
    return String(value ?? '').trim().toLocaleLowerCase('fr-FR').replace(/(^|[\s'\-])(\p{L})/gu, (_, sep, letter) => sep + letter.toLocaleUpperCase('fr-FR'));
  }
  function initials(name) { return String(name || '?').split(/[\s-]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase(); }
  function validISO(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    if (y < 1900 || y > 2199 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function parseDate(value) {
    if (value instanceof Date && !isNaN(value)) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 110000 && G.XLSX?.SSF) {
      const d = G.XLSX.SSF.parse_date_code(value);
      if (d) { const iso = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; return validISO(iso) ? iso : null; }
    }
    const s = String(value ?? '').trim();
    let match = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
    let iso;
    if (match) iso = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    else {
      match = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z?)?$/);
      if (match) iso = `${match[1]}-${match[2]}-${match[3]}`;
      else if (/^\d{1,4}(?:[.,]\d+)?$/.test(s) && G.XLSX?.SSF) return parseDate(Number(s.replace(',', '.')));
    }
    return validISO(iso) ? iso : null;
  }
  const isIndefinite = value => ['indetermine', 'indeterminee', 'indeterminé', 'sans echeance', 'non applicable'].includes(fold(value));
  const dayNumber = iso => validISO(iso) ? Date.parse(iso + 'T00:00:00Z') / 86400000 : NaN;
  const diffDays = (later, earlier) => Number.isFinite(dayNumber(later)) && Number.isFinite(dayNumber(earlier)) ? dayNumber(later) - dayNumber(earlier) : null;
  function todayISO(now = new Date()) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
  function shiftMonths(iso, delta, dayOverride) {
    const [y, m] = iso.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1 + delta, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(dayOverride || Number(iso.slice(8)), last));
    return first.toISOString().slice(0, 10);
  }
  function addDaysISO(iso, delta) { return new Date((dayNumber(iso) + delta) * 86400000).toISOString().slice(0, 10); }
  function periodPreset(mode, today = todayISO()) {
    const month = today.slice(0, 7) + '-01';
    if (mode === 'rolling') return { start: shiftMonths(addDaysISO(today, 1), -3), end: today };
    const start = mode === 'quarter' ? shiftMonths(month, -((Number(today.slice(5, 7)) - 1) % 3)) : shiftMonths(month, -2);
    return { start, end: addDaysISO(shiftMonths(start, 3), -1) };
  }
  function formatDate(iso, short = false) {
    if (!validISO(iso)) return 'Non renseignée';
    return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: short ? 'short' : '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));
  }
  const formatMoney = value => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value || 0) + ' FCFA';
  const formatNumber = value => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value || 0);
  const inRange = (date, settings) => Boolean(date && date >= settings.start && date <= settings.end);
  const isAbsent = status => fold(status) === 'absent';
  const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@;,<>()]+@[^\s@;,<>()]+\.[^\s@;,<>()]+$/.test(value);
  function parseNumber(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const s = String(value).trim().replace(/[\s\u202f]/g, '').replace(',', '.');
    if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && n <= 1000000 ? n : null;
  }
  function normalizeService(value) {
    const s = String(value ?? '').trim();
    if (fold(s).includes('formation')) return 'Voomnet Formation';
    if (fold(s).includes('technology')) return 'Voomnet Technology';
    return s || 'Non renseigné';
  }
  function normalizeContractType(value) {
    const found = CONTRACT_TYPES.find(type => fold(type) === fold(value));
    return found || '';
  }
  function columnMap(headers, kind) {
    const keys = headers.map(headerKey), map = {}, missing = [], duplicate = [];
    for (const [field, aliases] of Object.entries(SCHEMAS[kind])) {
      const matches = aliases.map(alias => keys.indexOf(headerKey(alias))).filter(i => i >= 0);
      if (!matches.length) missing.push(aliases[0]);
      else if (matches.length > 1) duplicate.push(aliases[0]);
      else map[field] = matches[0];
    }
    return { map, missing, duplicate, score: Object.keys(map).length };
  }
  function detectKind(headers) {
    const kinds = ['absences', 'pointage', 'employees'];
    const matches = kinds.map(kind => ({ kind, ...columnMap(headers, kind) })).filter(x => !x.missing.length && !x.duplicate.length);
    if (matches.length === 1) return matches[0].kind;
    if (!matches.length) throw new Error('En-têtes non reconnus. Utilisez les colonnes des modèles RH, ou celles des fichiers LISTES transmis. Le premier onglet doit contenir le tableau.');
    throw new Error('En-têtes ambigus : plusieurs types de fichiers possibles.');
  }
  function normalizeTable(matrix, kind, filename = '') {
    if (!Array.isArray(matrix) || !matrix.length) throw new Error('Le fichier est vide.');
    if (matrix.length > MAX_ROWS + 1) throw new Error(`Limite dépassée : ${MAX_ROWS.toLocaleString('fr-FR')} lignes maximum.`);
    if (matrix.some(row => !Array.isArray(row) || row.length > 100)) throw new Error('Structure invalide : 100 colonnes maximum par ligne.');
    const headers = matrix[0].map(v => String(v ?? '').replace(/^\uFEFF/, '').trim());
    const { map, missing, duplicate } = columnMap(headers, kind);
    if (missing.length) throw new Error(`Colonnes manquantes : ${missing.join(', ')}.`);
    if (duplicate.length) throw new Error(`Colonnes en doublon : ${duplicate.join(', ')}.`);
    const issues = []; let issueCount = 0, rejected = 0, duplicates = 0;
    const issue = (line, message, level = 'warning') => { issueCount++; if (issues.length < 150) issues.push({ line, message, level }); };
    const rows = [], seen = new Map();
    const used = new Set(Object.values(map));
    const ignoredColumns = headers.filter((h, i) => h && !used.has(i));
    if (ignoredColumns.length) issue(1, `Colonnes complémentaires ignorées : ${ignoredColumns.join(', ')}.`);
    for (let i = 1; i < matrix.length; i++) {
      const cells = matrix[i], line = i + 1;
      if (!cells.some(v => String(v ?? '').trim())) continue;
      if (cells.some(v => String(v ?? '').length > 20000)) { rejected++; issue(line, 'Cellule trop longue : ligne ignorée (20 000 caractères maximum).', 'error'); continue; }
      const raw = {};
      for (const [field, col] of Object.entries(map)) raw[field] = String(cells[col] ?? '').trim();
      const mat = matricule(raw.mat);
      if (!mat) { rejected++; issue(line, 'Matricule manquant ou invalide : ligne ignorée.', 'error'); continue; }
      let row = { ...raw, mat, line };
      if (kind === 'absences') {
        row.start = parseDate(raw.start); row.end = parseDate(raw.end); row.request = parseDate(raw.request);
        if (!row.start && !row.request) { rejected++; issue(line, 'Aucune date de début ou de demande valide : ligne ignorée.', 'error'); continue; }
        for (const [field, label] of [['start', 'Date de début'], ['end', 'Date de fin'], ['request', 'Date de demande']]) if (raw[field] && !row[field]) issue(line, `${label} invalide ; cette date ne participe pas au filtre.`);
        if (row.start && row.end && row.end < row.start) issue(line, 'Date de fin antérieure à la date de début ; dates conservées pour vérification.');
        row.days = parseNumber(raw.days);
        if (raw.days && row.days === null) issue(line, 'Durée en jours invalide : non renseignée.');
        row.name = raw.name || mat; row.status = raw.status || 'Non renseigné';
        row.justified = /^(vrai|true|oui|1|x)$/i.test(raw.justified) ? true : /^(faux|false|non|0)$/i.test(raw.justified) ? false : null;
        const key = JSON.stringify([mat, row.type, row.reason, row.start, row.end, row.request, row.days, row.justified, row.status, row.note]);
        if (seen.has(key)) { duplicates++; continue; }
        seen.set(key, line);
      } else if (kind === 'pointage') {
        row.date = parseDate(raw.date);
        if (!row.date) { rejected++; issue(line, 'Date de pointage invalide : ligne ignorée.', 'error'); continue; }
        row.name = raw.name || mat; row.service = normalizeService(raw.service); row.status = raw.status || 'Non renseigné';
        for (const field of ['late', 'minutes']) { row[field] = parseNumber(raw[field]); if (raw[field] && row[field] === null) issue(line, `${field === 'late' ? 'Retard' : 'Durée'} invalide : valeur non prise en compte (et non remplacée par zéro).`); }
        for (const field of ['arrival', 'departure']) if (raw[field] && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(raw[field])) { issue(line, `${field === 'arrival' ? 'Arrivée' : 'Départ'} : heure non reconnue.`); row[field] = ''; }
        if (row.arrival && row.departure && row.departure < row.arrival) issue(line, 'Départ antérieur à l’arrivée : vérifier le pointage ; durée fournie conservée.');
        if (!raw.status) issue(line, 'Statut manquant : aucune absence ne sera déduite de cette ligne.');
        const key = mat + '|' + row.date;
        const fingerprint = JSON.stringify([row.status, row.arrival, row.departure, row.late, row.minutes]);
        if (seen.has(key)) {
          duplicates++;
          if (seen.get(key).fingerprint === fingerprint) continue;
          const old = seen.get(key).index;
          issue(line, `Pointage en conflit avec la ligne ${rows[old].line} pour ${mat} le ${formatDate(row.date)} : dernière ligne retenue.`);
          rows[old] = row;
          seen.set(key, { fingerprint, index: old });
          continue;
        }
        seen.set(key, { fingerprint, index: rows.length });
      } else {
        if (!raw.name) { rejected++; issue(line, 'Nom du collaborateur manquant : ligne ignorée.', 'error'); continue; }
        row.name = raw.name; row.type = normalizeContractType(raw.contractRaw);
        if (raw.contractRaw && !row.type) issue(line, `Type « ${raw.contractRaw} » non assimilé à CDD, CDI, Stage ou Essai : à renseigner.`);
        row.start = parseDate(raw.start); row.end = isIndefinite(raw.end) ? null : parseDate(raw.end);
        if (raw.start && !row.start) issue(line, 'Date de début de contrat invalide : non renseignée.');
        if (raw.end && !row.end && !isIndefinite(raw.end)) issue(line, 'Date de fin de contrat invalide : non renseignée.');
        if (row.start && row.end && row.end < row.start) issue(line, 'Fin de contrat antérieure au début : dates à vérifier.');
        if (raw.email && !validEmail(raw.email)) { issue(line, 'Email professionnel invalide : envoi désactivé jusqu’à correction.'); row.email = ''; }
        if (seen.has(mat)) { duplicates++; issue(line, `Matricule ${mat} en doublon dans le référentiel : dernière fiche retenue.`); rows[seen.get(mat)] = row; continue; }
        seen.set(mat, rows.length);
      }
      rows.push(row);
    }
    if (kind === 'absences') {
      const codes = new Map();
      rows.forEach(row => { if (row.id) { if (!codes.has(row.id)) codes.set(row.id, new Set()); codes.get(row.id).add(row.mat); } });
      const shared = [...codes.values()].filter(mats => mats.size > 1).length;
      if (shared) issue(0, `${shared} code(s) de suivi partagé(s) entre collaborateurs. Les demandes restent distinctes ; la jointure utilise le matricule, jamais le code seul.`);
    }
    if (!rows.length) throw new Error(`Aucune ligne exploitable. ${rejected ? rejected + ' ligne(s) rejetée(s).' : 'Vérifiez le contenu du fichier.'}`);
    const dates = rows.map(r => kind === 'pointage' ? r.date : r.start).filter(Boolean).sort();
    return { kind, filename, rows, headers, ignoredColumns, issues, stats: { accepted: rows.length, sourceRows: matrix.length - 1, rejected, duplicates, issueCount, minDate: dates[0] || null, maxDate: dates.at(-1) || null, importedAt: new Date().toISOString() } };
  }
  function decodeBuffer(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 'UTF-8 avec BOM' : 'UTF-8' }; }
    catch { const hasBOM = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf; return { text: new TextDecoder('windows-1252').decode(hasBOM ? bytes.subarray(3) : bytes), encoding: 'Windows-1252 / ISO-8859-1' }; }
  }
  function parseCSV(buffer, filename = '', hint = '') {
    if (!G.Papa) throw new Error('Le moteur CSV n’est pas disponible.');
    const { text, encoding } = decodeBuffer(buffer);
    if (!text.trim()) throw new Error('Le fichier est vide.');
    const candidates = [';', ',', '\t'].map(delimiter => {
      const preview = G.Papa.parse(text.slice(0, 64000), { delimiter, preview: 2, skipEmptyLines: 'greedy' });
      const headers = preview.data[0] || [];
      let score = 0;
      for (const kind of Object.keys(SCHEMAS)) { const cm = columnMap(headers.map(String), kind); if (!cm.missing.length && !cm.duplicate.length) score = 100 + cm.score; }
      return { delimiter, score: score + Math.min(headers.length, 20) };
    }).sort((a, b) => b.score - a.score);
    const parsed = G.Papa.parse(text, { delimiter: candidates[0].delimiter, skipEmptyLines: 'greedy', dynamicTyping: false });
    const fatal = parsed.errors.find(e => e.type === 'Quotes');
    if (fatal) throw new Error(`CSV mal formé (guillemets), ligne ${(fatal.row || 0) + 1}. Aucun changement n’a été appliqué.`);
    const kind = hint && Object.prototype.hasOwnProperty.call(SCHEMAS, hint) ? hint : detectKind(parsed.data[0] || []);
    const result = normalizeTable(parsed.data, kind, filename);
    result.stats.encoding = encoding; result.stats.delimiter = candidates[0].delimiter === '\t' ? 'Tabulation' : candidates[0].delimiter;
    for (const error of parsed.errors.filter(e => e.code !== 'UndetectableDelimiter')) result.issues.push({ line: (error.row || 0) + 1, message: `CSV : ${error.code} — ${error.message}`, level: 'warning' });
    result.stats.issueCount += parsed.errors.filter(e => e.code !== 'UndetectableDelimiter').length;
    return result;
  }
  function parseWorkbook(buffer, filename = '', hint = '') {
    if (!G.XLSX) throw new Error('Le moteur Excel n’est pas disponible.');
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const wb = G.XLSX.read(bytes, { type: 'array', cellDates: false, cellFormula: false, cellHTML: false, cellText: false, dense: true, WTF: false });
    let firstError;
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      if (!sheet?.['!ref']) continue;
      const range = G.XLSX.utils.decode_range(sheet['!ref']);
      if (range.e.r > MAX_ROWS || range.e.c > 99) { firstError ||= new Error(`Onglet « ${name} » trop volumineux : ${MAX_ROWS} lignes et 100 colonnes maximum.`); continue; }
      const matrix = G.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: false });
      if (!matrix.length) continue;
      let kind;
      try { kind = hint && own(SCHEMAS, hint) ? hint : detectKind(matrix[0]); } catch (error) { firstError ||= error; continue; }
      try { const result = normalizeTable(matrix, kind, filename); result.stats.encoding = 'Classeur Excel'; result.stats.sheet = name; result.stats.delimiter = 'Excel'; return result; }
      catch (error) { firstError ||= error; if (hint) throw error; }
    }
    throw firstError || new Error('Aucun onglet contenant un tableau RH reconnu.');
  }
  function prepareImport(buffer, filename, hint = '') {
    const size = buffer?.byteLength ?? buffer?.length ?? 0;
    if (!size) throw new Error('Le fichier est vide.');
    if (size > MAX_FILE_BYTES) throw new Error('Fichier trop volumineux : 10 Mo maximum.');
    return /\.(xlsx|xls)$/i.test(filename) ? parseWorkbook(buffer, filename, hint) : parseCSV(buffer, filename, hint);
  }
  function defaultSettings(today = todayISO()) {
    return { ...periodPreset('calendar3', today), periodMode: 'calendar3', amount: 50000, crossCheck: true, alertThreshold: 30, rhEmail: '', provider: 'emailjs', emailjs: { serviceId: '', templateId: '', publicKey: '' }, webhook: { url: '' }, subject: DEFAULT_SUBJECT, body: DEFAULT_BODY };
  }
  function sanitizeSettings(input, today = todayISO()) {
    const d = defaultSettings(today), s = input && typeof input === 'object' ? input : {};
    const mode = ['calendar3', 'rolling', 'quarter', 'custom'].includes(s.periodMode) ? s.periodMode : d.periodMode;
    const preset = periodPreset(mode === 'custom' ? 'calendar3' : mode, today);
    const start = validISO(s.start) ? s.start : preset.start, end = validISO(s.end) ? s.end : preset.end;
    return { periodMode: mode, start: start <= end ? start : preset.start, end: start <= end ? end : preset.end,
      amount: Number.isFinite(Number(s.amount)) && s.amount !== '' && s.amount != null ? Math.min(1000000000, Math.max(0, Math.round(Number(s.amount)))) : d.amount,
      crossCheck: typeof s.crossCheck === 'boolean' ? s.crossCheck : d.crossCheck,
      alertThreshold: [15, 30, 45, 60].includes(Number(s.alertThreshold)) ? Number(s.alertThreshold) : 30,
      rhEmail: validEmail(s.rhEmail) ? s.rhEmail.trim() : '', provider: ['emailjs', 'webhook'].includes(s.provider) ? s.provider : 'emailjs',
      emailjs: { serviceId: String(s.emailjs?.serviceId || '').slice(0, 200), templateId: String(s.emailjs?.templateId || '').slice(0, 200), publicKey: String(s.emailjs?.publicKey || '').slice(0, 500) },
      webhook: { url: safeHTTPS(s.webhook?.url || '') }, subject: typeof s.subject === 'string' ? s.subject.slice(0, 500) : d.subject, body: typeof s.body === 'string' ? s.body.slice(0, 15000) : d.body };
  }
  function safeHTTPS(value) { try { const u = new URL(String(value).trim()); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; } }
  function normalizeProfile(input, strict = false) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Fiche contractuelle invalide.');
    const result = {};
    if (own(input, 'type')) { result.type = normalizeContractType(input.type); if (input.type && !result.type && strict) throw new Error('Type de contrat invalide.'); }
    for (const field of ['start', 'end']) if (own(input, field)) {
      if (input[field] === '' || input[field] == null || (field === 'end' && isIndefinite(input[field]))) result[field] = null;
      else { const date = parseDate(input[field]); if (!date && strict) throw new Error(`Date de ${field === 'start' ? 'début' : 'fin'} invalide.`); result[field] = date; }
    }
    if (own(input, 'email')) { const email = String(input.email || '').trim(); if (email && !validEmail(email) && strict) throw new Error('Email professionnel invalide.'); result.email = validEmail(email) ? email : ''; }
    if (own(input, 'active')) result.active = input.active !== false;
    if (result.start && result.end && result.end < result.start && strict) throw new Error('La fin de contrat précède son début.');
    return result;
  }
  function parseProfileExport(text) {
    const data = JSON.parse(text);
    if (!data || data.version !== 1 || !data.contracts || typeof data.contracts !== 'object' || Array.isArray(data.contracts)) throw new Error('Format attendu : sauvegarde Voomnet RH version 1.');
    const entries = Object.entries(data.contracts);
    if (entries.length > 10000) throw new Error('10 000 fiches maximum par sauvegarde.');
    const contracts = Object.create(null);
    for (const [key, value] of entries) { const mat = matricule(key); if (!mat) throw new Error('Matricule invalide dans la sauvegarde.'); contracts[mat] = normalizeProfile(value, true); }
    return { version: 1, contracts, settings: data.settings ? sanitizeSettings(data.settings) : null };
  }
  function buildUniverse(sources, contracts = {}) {
    const employees = new Map();
    const ensure = mat => { if (!employees.has(mat)) employees.set(mat, { mat, name: mat, service: 'Non renseigné', email: '', type: '', start: null, end: null, contractRaw: '', position: '', role: '', active: true, hasRoster: false, hasPointage: false }); return employees.get(mat); };
    for (const row of sources.employees?.rows || []) { const e = ensure(row.mat); Object.assign(e, { name: row.name, email: row.email || '', type: row.type || '', start: row.start, end: row.end, contractRaw: row.contractRaw || '', position: row.position || '', role: row.role || '', hasRoster: true }); }
    for (const row of sources.pointage?.rows || []) { const e = ensure(row.mat); if (!e.hasRoster) e.name = row.name; if (e.service === 'Non renseigné') e.service = row.service; e.hasPointage = true; }
    for (const row of sources.absences?.rows || []) { const e = ensure(row.mat); if (!e.hasRoster && !e.hasPointage) e.name = row.name; }
    for (const e of employees.values()) {
      e.name = displayName(e.name);
      if (own(contracts, e.mat)) Object.assign(e, normalizeProfile(contracts[e.mat]));
      if (e.type === 'CDI' && isIndefinite(e.contractRaw) && (!own(contracts, e.mat) || !own(contracts[e.mat], 'end'))) e.end = null;
    }
    return [...employees.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }
  function attendanceMetrics(records, declarations) {
    const absentDates = new Set(records.filter(r => isAbsent(r.status)).map(r => r.date));
    const durations = records.filter(r => !isAbsent(r.status) && r.minutes !== null && r.minutes > 0).map(r => r.minutes);
    const lateMinutes = records.reduce((sum, r) => sum + (r.late || 0), 0);
    const avgMinutes = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    const penalties = { declarations: Math.min(24, declarations.length * 6), absences: Math.min(35, absentDates.size * 7), late: Math.min(24, Math.round(lateMinutes * .08)), duration: durations.length >= 3 && avgMinutes < 480 ? Math.min(12, Math.round((480 - avgMinutes) / 20)) : 0 };
    const score = records.length ? Math.max(0, 100 - Object.values(penalties).reduce((a, b) => a + b, 0)) : null;
    const insufficient = records.length < 3 || durations.length < 3;
    const recommendation = insufficient || (score >= 60 && score < 85) ? 'Sous réserve d’entretien' : score >= 85 ? 'Renouvellement favorable' : 'Non-renouvellement recommandé';
    return { absentDays: absentDates.size, absentDates: [...absentDates].sort(), lateMinutes, avgMinutes, completedDurations: durations.length, recordsCount: records.length, score, insufficient, penalties, recommendation };
  }
  function evaluateEmployee(employee, sources, settings, today = todayISO(), indexed = null) {
    const declarations = (indexed ? indexed.absences.get(employee.mat) || [] : (sources.absences?.rows || []).filter(r => r.mat === employee.mat)).filter(r => inRange(r.start, settings) || inRange(r.request, settings)).sort((a, b) => (b.start || b.request).localeCompare(a.start || a.request));
    const records = (indexed ? indexed.pointage.get(employee.mat) || [] : (sources.pointage?.rows || []).filter(r => r.mat === employee.mat)).filter(r => inRange(r.date, settings)).sort((a, b) => a.date.localeCompare(b.date));
    const metrics = attendanceMetrics(records, declarations);
    const eligible = employee.active && declarations.length === 0 && (!settings.crossCheck || metrics.absentDays === 0);
    const reasons = [];
    if (!employee.active) reasons.push('Hors périmètre actif');
    if (declarations.length) reasons.push(`${declarations.length} demande(s) d’absence sur la période`);
    if (settings.crossCheck && metrics.absentDays) reasons.push(`${metrics.absentDays} jour(s) « Absent » au pointage`);
    const days = employee.type === 'CDI' && !employee.end ? null : diffDays(employee.end, today);
    const contractLevel = days === null ? (employee.type === 'CDI' ? 'indeterminate' : 'missing') : days < 0 ? 'expired' : days <= 15 ? 'urgent' : days <= 30 ? 'warning' : 'ok';
    return { ...employee, declarations, records, ...metrics, eligible, primeReason: reasons.length ? reasons.join(' · ') : 'Aucune absence bloquante sur la période', primeStatus: !employee.active ? 'Hors périmètre' : eligible ? 'Prime disponible' : 'Prime non disponible', days, contractLevel, contractAlert: employee.active && days !== null && days <= settings.alertThreshold };
  }
  function evaluateAll(sources, contracts, settings, today = todayISO()) {
    const indexed = { absences: new Map(), pointage: new Map() };
    for (const kind of ['absences', 'pointage']) for (const row of sources[kind]?.rows || []) { if (!indexed[kind].has(row.mat)) indexed[kind].set(row.mat, []); indexed[kind].get(row.mat).push(row); }
    return buildUniverse(sources, contracts).map(e => evaluateEmployee(e, sources, settings, today, indexed));
  }
  function aggregate(rows, settings) {
    const active = rows.filter(r => r.active), eligible = active.filter(r => r.eligible), due = active.filter(r => r.contractAlert);
    return { total: rows.length, active: active.length, technology: active.filter(r => r.service === 'Voomnet Technology').length, formation: active.filter(r => r.service === 'Voomnet Formation').length, otherService: active.filter(r => !['Voomnet Technology', 'Voomnet Formation'].includes(r.service)).length, eligible: eligible.length, ineligible: active.length - eligible.length, budget: eligible.length * settings.amount, due: due.length, urgent: due.filter(r => r.days <= 15).length, declared: active.reduce((n, r) => n + r.declarations.length, 0), rawAbsentDays: active.reduce((n, r) => n + r.absentDays, 0), missingContracts: active.filter(r => r.contractLevel === 'missing').length, noPointage: active.filter(r => !r.records.length).length };
  }
  const EMAIL_VARIABLES = ['Nom', 'Matricule', 'Service', 'Date_Fin_Contrat', 'Jours_Restants', 'Total_Absences', 'Statut_Prime', 'Retard_Minutes', 'Duree_Moyenne', 'Periode'];
  function emailVariables(row, settings) {
    return { Nom: row.name, Matricule: row.mat, Service: row.service, Date_Fin_Contrat: row.end ? formatDate(row.end) : 'non renseignée', Jours_Restants: row.days === null ? 'échéance non renseignée' : row.days < 0 ?échu_depuis(row.days) : `J-${row.days}`, Total_Absences: `${row.declarations.length} demande(s) déclarée(s) ; ${row.absentDays} jour(s) absent(s) au pointage`, Statut_Prime: row.eligible ? 'Disponible, sous réserve de validation RH' : 'Non disponible', Retard_Minutes: String(row.lateMinutes), Duree_Moyenne: row.avgMinutes === null ? 'non disponible (durées manquantes)' : `${row.avgMinutes} min`, Periode: `${formatDate(settings.start)} au ${formatDate(settings.end)}` };
  }
  function échu_depuis(days) { return `échu depuis ${Math.abs(days)} jour(s)`; }
  function renderTemplate(template, row, settings) { const vars = emailVariables(row, settings); return String(template).replace(/\{([A-Za-z_]+)\}/g, (token, key) => own(vars, key) ? vars[key] : token); }
  function unknownVariables(template) { return [...new Set([...String(template).matchAll(/\{([A-Za-z_]+)\}/g)].map(m => m[1]).filter(v => !EMAIL_VARIABLES.includes(v)))]; }
  function emailFor(row, settings, overrides = {}) {
    const subject = overrides.subject ?? renderTemplate(settings.subject, row, settings), body = overrides.body ?? renderTemplate(settings.body, row, settings);
    return { to: row.email, cc: settings.rhEmail, subject, body, name: row.name, mat: row.mat };
  }
  function mailtoHref(email) {
    const encode = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    return `mailto:${encode(email.to).replace(/%40/g, '@')}?${email.cc ? 'cc=' + encode(email.cc) + '&' : ''}subject=${encode(email.subject)}&body=${encode(email.body.replace(/\r?\n/g, '\r\n'))}`;
  }
  function campaignPayload(email, row, settings) { return { to: { email: email.to, name: row.name }, cc: settings.rhEmail ? [settings.rhEmail] : [], subject: email.subject, text: email.body, html: esc(email.body).replace(/\n/g, '<br>'), employee: { matricule: row.mat, service: row.service, dateFinContrat: row.end, joursRestants: row.days, totalAbsences: row.declarations.length, joursAbsentPointage: row.absentDays, statutPrime: row.primeStatus }, period: { start: settings.start, end: settings.end } }; }
  function safeCSVCell(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return value;
    let s = String(value);
    if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return s;
  }
  function reportRows(rows, settings, today) {
    return rows.map(r => ({ Matricule: r.mat, Collaborateur: r.name, Service: r.service, Actif: r.active ? 'Oui' : 'Non', 'Début période': formatDate(settings.start), 'Fin période': formatDate(settings.end), 'Demandes absence': r.declarations.length, 'Jours absent pointage': r.absentDays, 'Retards (min)': r.lateMinutes, 'Moyenne présence (min)': r.avgMinutes, 'Pointages renseignés': r.recordsCount, 'Durées renseignées': r.completedDurations, 'Motifs absences': r.declarations.map(d => d.type + ' : ' + d.reason).join(' | '), 'Statut RH absences': r.declarations.map(d => d.status).join(' | '), 'Contrôle pointage': settings.crossCheck ? 'Activé' : 'Désactivé', 'Prime': r.primeStatus, 'Motif décision prime': r.primeReason, 'Montant prime (FCFA)': r.eligible ? settings.amount : 0, 'Type contrat': r.type || 'À renseigner', 'Début contrat': r.start ? formatDate(r.start) : '', 'Fin contrat': r.end ? formatDate(r.end) : r.type === 'CDI' ? 'Indéterminée' : '', 'Jours restants': r.days, 'Alerte contrat': r.contractLevel, Email: r.email, 'Score assiduité /100': r.score, 'Données insuffisantes': r.insufficient ? 'Oui' : 'Non', 'Recommandation indicative': r.recommendation, 'Date édition': formatDate(today) }));
  }
  G.VoomnetCore = { MAX_ROWS, MAX_FILE_BYTES, STORAGE_KEY, CONTRACT_TYPES, ABSENCE_HEADERS, POINTAGE_HEADERS, EMPLOYEE_HEADERS, LABELS, SCHEMAS, DEFAULT_SUBJECT, DEFAULT_BODY, EMAIL_VARIABLES, fold, headerKey, esc, own, matricule, displayName, initials, validISO, parseDate, isIndefinite, dayNumber, diffDays, todayISO, shiftMonths, periodPreset, addDaysISO, formatDate, formatMoney, formatNumber, inRange, isAbsent, validEmail, parseNumber, normalizeService, normalizeContractType, columnMap, detectKind, normalizeTable, decodeBuffer, parseCSV, parseWorkbook, prepareImport, defaultSettings, sanitizeSettings, safeHTTPS, normalizeProfile, parseProfileExport, buildUniverse, attendanceMetrics, evaluateEmployee, evaluateAll, aggregate, emailVariables, renderTemplate, unknownVariables, emailFor, mailtoHref, campaignPayload, safeCSVCell, reportRows };
})();
