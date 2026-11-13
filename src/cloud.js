import { createAuthClient } from '@neon/neon-js/auth';
import { BetterAuthVanillaAdapter } from '@neon/neon-js/auth/vanilla';

// Le service Neon Auth gère les mots de passe. L'alias technique n'est pas une boîte mail.
const auth = createAuthClient('https://ep-orange-unit-b7693tds.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth', { adapter: BetterAuthVanillaAdapter({ fetchOptions: { credentials: 'include' } }) });
const workspace = window.VoomnetWorkspace;
const loginScreen = document.querySelector('#login-screen'), application = document.querySelector('#application');
const form = document.querySelector('#login-form'), loginMessage = document.querySelector('#login-message');
const loginSubmit = form.querySelector('[type="submit"]'), passwordInput = document.querySelector('#login-password');
const ownerKey = 'voomnet-rh:last-user', kinds = ['employees', 'absences', 'pointage'];
let currentUser = null, version = null, pending = false, loginPending = false;
const splash = document.querySelector('#splash'); application.inert = true;
setTimeout(() => { splash.classList.add('is-leaving'); loginScreen.inert = false; application.inert = false; setTimeout(() => splash.remove(), 400); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 50 : 1100);
const button = document.createElement('button'); button.className = 'btn btn-sm'; button.textContent = 'Espace RH en ligne';
document.querySelector('.topbar > div:last-child').prepend(button);
const dialog = document.createElement('dialog'); dialog.setAttribute('aria-labelledby', 'cloud-title');
dialog.style.cssText = 'width:min(95vw,600px);max-height:90vh;overflow:auto;border:0;border-radius:16px;padding:24px;color:#0f172a;box-shadow:0 20px 60px #0005'; application.append(dialog);
function setLoginBusy(busy, message = '') {
  loginPending = busy; loginSubmit.disabled = busy;
  loginSubmit.innerHTML = busy ? 'Vérification en cours…' : 'Se connecter <span aria-hidden="true">→</span>';
  loginMessage.textContent = message;
}
function lock(message = '') {
  if (dialog.open) dialog.close();
  application.hidden = true; loginScreen.hidden = false; currentUser = null; version = null;
  setLoginBusy(false, message); passwordInput.value = ''; passwordInput.type = 'password';
  const toggle = document.querySelector('#login-toggle-password'); toggle.textContent = 'Afficher'; toggle.setAttribute('aria-label', 'Afficher le mot de passe'); toggle.setAttribute('aria-pressed', 'false');
}
function sameOwner(userId) {
  try { if (localStorage.getItem(ownerKey) !== userId) workspace.clear(); localStorage.setItem(ownerKey, userId); }
  catch { workspace.clear(); }
}
async function getSession() {
  const { data, error } = await auth.getSession();
  return error || !data?.user?.id || !data?.session?.token ? null : { user: data.user, token: data.session.token };
}
async function api(token, method, body, query = {}) {
  if (body && new TextEncoder().encode(JSON.stringify(body)).length > 4 * 1024 * 1024) throw new Error('Données traitées trop volumineuses : 4 Mo de JSON maximum par envoi. Réduisez le fichier puis réessayez.');
  let response; const url = '/.netlify/functions/workspace' + (Object.keys(query).length ? '?' + new URLSearchParams(query) : '');
  try { response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Le service RH est indisponible. Vérifiez votre connexion ou contactez l’administrateur.'); }
  let data; try { data = await response.json(); } catch { throw new Error('Le service RH est indisponible ou non configuré. Contactez l’administrateur.'); }
  if (!response.ok) { const error = new Error(data.error || 'Service RH indisponible.'); error.status = response.status; throw error; }
  return data;
}
async function fetchWorkspace(token) {
  const data = await api(token, 'GET');
  if (!Number.isSafeInteger(data.version) || data.version < 0 || !data.snapshot || !data.active) throw new Error('Réponse du service RH invalide.');
  const sources = {};
  await Promise.all(kinds.map(async kind => { const id = data.active[kind]; if (id != null) { const item = await api(token, 'GET', null, { action: 'source', kind, id: String(id) }); if (!item.source) throw new Error('Import enregistré invalide.'); sources[kind] = item.source; } }));
  return { version: data.version, snapshot: { ...data.snapshot, sources } };
}
async function authorize(session) {
  if (!session) throw new Error('Votre session a expiré. Veuillez vous connecter.');
  let data;
  try { data = await fetchWorkspace(session.token); }
  catch (error) { if (error.status === 403) throw new Error(`Compte non autorisé. Contactez l’administrateur RH et communiquez cet identifiant : ${session.user.id}`); throw error; }
  sameOwner(session.user.id);
  if (data.version > 0) workspace.load(data.snapshot);
  currentUser = session.user; version = data.version;
  loginScreen.hidden = true; application.hidden = false; loginMessage.textContent = ''; document.querySelector('#main-content').focus({ preventScroll: true });
}
async function request(method, body, query) {
  const session = await getSession();
  if (!session || session.user.id !== currentUser?.id) { lock('Session expirée ou compte modifié. Reconnectez-vous pour continuer.'); throw new Error('Session expirée.'); }
  try { return await api(session.token, method, body, query); }
  catch (error) { if (error.status === 401 || error.status === 403) lock('Votre session ou vos droits RH ne sont plus valides. Reconnectez-vous ou contactez l’administrateur.'); throw error; }
}
async function getFresh() {
  const session = await getSession(); if (!session || session.user.id !== currentUser?.id) { lock('Session expirée. Reconnectez-vous.'); throw new Error('Session expirée.'); }
  try { return await fetchWorkspace(session.token); } catch (error) { if (error.status === 401 || error.status === 403) lock('Vos droits RH ne sont plus valides.'); throw error; }
}
window.VoomnetOnline = {
  async saveImport(kind, source) {
    if (!currentUser || version === null || pending) throw new Error('Espace indisponible. Terminez l’opération en cours.');
    const result = await request('POST', { expectedVersion: version, kind, source }, { action: 'import' }); version = result.version;
  },
  async removeSource(kind) {
    if (!currentUser || version === null || pending) throw new Error('Espace indisponible.');
    const result = await request('POST', { expectedVersion: version, kind }, { action: 'remove' }); version = result.version;
  }
};
form.addEventListener('submit', async event => {
  event.preventDefault(); if (loginPending) return;
  const identifier = form.elements.identifier.value.trim(), password = passwordInput.value;
  passwordInput.value = '';
  if (!/^\d{1,16}$/.test(identifier)) return lock('Saisissez un identifiant RH numérique valide.');
  setLoginBusy(true);
  try {
    let result;
    try { result = await auth.signIn.email({ email: identifier + '@rh-identifiant.invalid', password }); }
    catch { throw new Error('Connexion impossible. Vérifiez vos identifiants et votre connexion internet.'); }
    if (result.error) throw new Error('Connexion impossible. Vérifiez vos identifiants et votre connexion internet.');
    await authorize(await getSession());
  } catch (error) { lock(error instanceof TypeError ? 'Service de connexion indisponible. Réessayez.' : (error.message || 'Connexion impossible. Contactez l’administrateur.')); }
  finally { setLoginBusy(false, loginMessage.textContent); }
});
document.querySelector('#login-toggle-password').addEventListener('click', event => {
  const show = passwordInput.type === 'password'; passwordInput.type = show ? 'text' : 'password'; event.currentTarget.textContent = show ? 'Masquer' : 'Afficher';
  event.currentTarget.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'); event.currentTarget.setAttribute('aria-pressed', String(show));
});
function render(message = '') {
  dialog.innerHTML = `<h2 id="cloud-title" style="font-size:20px;font-weight:700;margin-bottom:12px">Mon espace RH</h2><p style="font-size:13px;line-height:1.5;margin-bottom:14px">Vos imports sont enregistrés automatiquement et restent privés. Les fiches et paramètres doivent être sauvegardés séparément. L’historique conserve les versions précédentes.</p><p id="cloud-message" role="status" style="font-size:13px;line-height:1.5;color:#9a3412;white-space:pre-wrap;margin-bottom:12px"></p><div id="cloud-content"></div><div id="cloud-history"></div><button class="btn" id="cloud-close" style="margin-top:16px">Fermer</button>`;
  dialog.querySelector('#cloud-message').textContent = message;
  const area = dialog.querySelector('#cloud-content'), info = document.createElement('p'); info.style.cssText = 'font-size:13px;margin-bottom:10px;overflow-wrap:anywhere';
  const identifier = (currentUser?.email || '').replace(/@rh-identifiant\.invalid$/, '');
  info.textContent = `Identifiant : ${identifier} · Version : ${version ?? 'indisponible'}.`; area.append(info);
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  for (const [label, fn, primary] of [['Actualiser mon espace', load, false], ['Sauvegarder fiches et paramètres', save, true], ['Historique des imports', history, false], ['Se déconnecter', signOut, false]]) {
    const el = document.createElement('button'); el.className = primary ? 'btn btn-primary' : 'btn'; el.textContent = label; el.disabled = pending; el.onclick = fn; actions.append(el);
  }
  area.append(actions); dialog.querySelector('#cloud-close').onclick = () => dialog.close();
}
async function perform(fn) {
  if (pending) return; pending = true; render('Opération en cours…');
  try { await fn(); } catch (error) { if (currentUser) render(error.message || 'Opération impossible.'); }
  finally { pending = false; for (const el of dialog.querySelectorAll('button')) el.disabled = false; }
}
async function load() {
  if (!workspace.canSync()) return render('Terminez l’import, l’envoi ou la fenêtre en cours avant de charger.');
  if (!confirm('Actualiser remplace les données locales par la dernière version enregistrée. Les modifications de fiches non sauvegardées seront perdues. Continuer ?')) return;
  await perform(async () => { const data = await getFresh(); workspace.load(data.snapshot); version = data.version; render('Espace personnel actualisé.'); });
}
async function save() {
  if (!workspace.canSync()) return render('Terminez l’import, l’envoi ou la fenêtre en cours avant de sauvegarder.');
  if (version === null) return render('Actualisez d’abord votre espace.');
  await perform(async () => {
    const snapshot = workspace.snapshot();
    const result = await request('PUT', { expectedVersion: version, snapshot: { version: 1, contracts: snapshot.contracts, settings: snapshot.settings } });
    version = result.version; render('Fiches et paramètres enregistrés.');
  });
}
async function historyBefore(kind, before) { return showHistory({ kind, before }); }
async function history() { return showHistory(); }
async function showHistory(cursor = {}) {
  await perform(async () => {
    const { history: entries } = await request('GET', null, { action: 'history', ...cursor }); render('Choisissez une version à rétablir dans votre espace.');
    const container = dialog.querySelector('#cloud-history'); container.style.cssText = 'margin-top:16px;display:grid;gap:10px';
    const labels = { employees: 'Collaborateurs', absences: 'Absences', pointage: 'Pointages' };
    for (const kind of kinds) {
      const section = document.createElement('section'), title = document.createElement('strong'); title.textContent = labels[kind]; section.append(title);
      const list = entries?.[kind] || [];
      if (!list.length) { const empty = document.createElement('p'); empty.textContent = 'Aucun import enregistré.'; section.append(empty); }
      for (const entry of list) {
        const item = document.createElement('div'); item.style.cssText = 'display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:7px;font-size:12px';
        const label = document.createElement('span'); const when = new Date(entry.created_at); label.textContent = `${entry.filename || 'Fichier'} · ${Number.isNaN(when.valueOf()) ? '' : when.toLocaleString('fr-FR')}`;
        const restore = document.createElement('button'); restore.className = 'btn btn-sm'; restore.textContent = 'Rétablir'; restore.onclick = () => restoreImport(kind, String(entry.id)); item.append(label, restore); section.append(item);
      }
      if (list.length === 100) { const more = document.createElement('button'); more.className = 'btn btn-sm'; more.textContent = 'Voir les versions précédentes'; more.onclick = () => historyBefore(kind, String(list[list.length - 1].id)); section.append(more); }
      container.append(section);
    }
  });
}
async function restoreImport(kind, id) {
  if (!workspace.canSync()) return render('Terminez l’opération en cours avant de restaurer.');
  if (!confirm('Rétablir cet import ? Les fiches et paramètres locaux non sauvegardés seront remplacés par la dernière version enregistrée.')) return;
  await perform(async () => {
    const result = await request('POST', { expectedVersion: version, kind, id }, { action: 'restore' }); version = result.version;
    try { const data = await getFresh(); workspace.load(data.snapshot); version = data.version; render('Version d’import rétablie.'); }
    catch (error) { version = null; throw error; }
  });
}
async function signOut() {
  if (!workspace.canSync()) return render('Terminez l’import, l’envoi ou la fenêtre en cours avant de vous déconnecter.');
  if (!confirm('Les imports sont conservés en base. Les fiches et paramètres non sauvegardés seront perdus. Se déconnecter ?')) return;
  workspace.clear(); try { localStorage.removeItem(ownerKey); } catch {}
  lock(); setLoginBusy(true, 'Déconnexion en cours…');
  try { const result = await auth.signOut(); if (result.error) throw new Error(); lock('Vous êtes déconnecté.'); }
  catch { lock('Déconnexion distante non confirmée. Fermez le navigateur et contactez l’administrateur.'); }
}
button.onclick = () => { render(); if (!dialog.open) dialog.showModal(); };
setLoginBusy(true, 'Vérification de votre session…');
Promise.race([getSession(), new Promise((_, reject) => setTimeout(() => reject(new Error('Service de connexion indisponible. Réessayez.')), 12000))])
  .then(async session => { if (session) await authorize(session); else lock(); })
  .catch(error => lock(error instanceof TypeError ? 'Service de connexion indisponible. Réessayez.' : (error.message || 'Service de connexion indisponible. Réessayez.')))
  .finally(() => setLoginBusy(false, loginMessage.textContent));
