import { createAuthClient } from '@neon/neon-js/auth';
import { BetterAuthVanillaAdapter } from '@neon/neon-js/auth/vanilla';

// URL publique Neon Auth ; aucun secret PostgreSQL ni mot de passe dans ce fichier.
const auth = createAuthClient('https://ep-orange-unit-b7693tds.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth', {
  adapter: BetterAuthVanillaAdapter({ fetchOptions: { credentials: 'include' } })
});
const workspace = window.VoomnetWorkspace;
const loginScreen = document.querySelector('#login-screen');
const application = document.querySelector('#application');
const form = document.querySelector('#login-form');
const loginMessage = document.querySelector('#login-message');
const loginSubmit = form.querySelector('[type="submit"]');
const passwordInput = document.querySelector('#login-password');
const ownerKey = 'voomnet-rh:last-user';
let currentUser = null, version = null, pending = false, loginPending = false;

const header = document.querySelector('.topbar > div:last-child');
const button = document.createElement('button');
button.className = 'btn btn-sm'; button.textContent = 'Espace RH en ligne';
header.prepend(button);
const dialog = document.createElement('dialog');
dialog.setAttribute('aria-labelledby', 'cloud-title');
dialog.style.cssText = 'width:min(95vw,540px);border:0;border-radius:16px;padding:24px;color:#0f172a;box-shadow:0 20px 60px #0005';
application.append(dialog);
function setLoginBusy(busy, message = '') {
  loginPending = busy; loginSubmit.disabled = busy;
  loginSubmit.innerHTML = busy ? 'Vérification en cours…' : 'Se connecter <span aria-hidden="true">→</span>';
  loginMessage.textContent = message;
}
function lock(message = '') {
  if (dialog.open) dialog.close();
  application.hidden = true; loginScreen.hidden = false; currentUser = null; version = null;
  setLoginBusy(false, message); passwordInput.value = ''; passwordInput.type = 'password';
  const toggle = document.querySelector('#login-toggle-password');
  toggle.textContent = 'Afficher'; toggle.setAttribute('aria-label', 'Afficher le mot de passe'); toggle.setAttribute('aria-pressed', 'false');
}
function sameOwner(userId) {
  try {
    const previous = localStorage.getItem(ownerKey);
    if (previous !== userId) workspace.clear();
    localStorage.setItem(ownerKey, userId);
  } catch {
    // Un stockage indisponible ne doit pas exposer un espace local d'un autre compte.
    workspace.clear();
  }
}
async function getSession() {
  const { data, error } = await auth.getSession();
  if (error || !data?.user?.id || !data?.session?.token) return null;
  return { user: data.user, token: data.session.token };
}
async function api(token, method, body) {
  let response;
  try {
    response = await fetch('/.netlify/functions/workspace', { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000) });
  } catch { throw new Error('Le service RH est indisponible. Vérifiez votre connexion ou contactez l’administrateur.'); }
  let data; try { data = await response.json(); } catch { throw new Error('Le service RH est indisponible ou non configuré. Contactez l’administrateur.'); }
  if (!response.ok) { const error = new Error(data.error || 'Service RH indisponible.'); error.status = response.status; throw error; }
  return data;
}
async function authorize(session) {
  if (!session) throw new Error('Votre session a expiré. Veuillez vous connecter.');
  try {
    const data = await api(session.token, 'GET');
    if (!Number.isSafeInteger(data.version) || data.version < 0) throw new Error('Réponse du service RH invalide.');
  } catch (error) {
    if (error.status === 403) throw new Error(`Compte non autorisé. Contactez l’administrateur RH et communiquez cet identifiant : ${session.user.id}`);
    throw error;
  }
  sameOwner(session.user.id);
  currentUser = session.user; version = null;
  loginScreen.hidden = true; application.hidden = false; loginMessage.textContent = '';
  document.querySelector('#main-content').focus({ preventScroll: true });
}
async function request(method, body) {
  const session = await getSession();
  if (!session || session.user.id !== currentUser?.id) {
    lock('Session expirée ou compte modifié. Reconnectez-vous pour continuer.');
    throw new Error('Session expirée.');
  }
  try { return await api(session.token, method, body); }
  catch (error) {
    if (error.status === 401 || error.status === 403) lock('Votre session ou vos droits RH ne sont plus valides. Reconnectez-vous ou contactez l’administrateur.');
    throw error;
  }
}
form.addEventListener('submit', async event => {
  event.preventDefault(); if (loginPending) return;
  const email = form.elements.email.value.trim(), password = passwordInput.value;
  passwordInput.value = ''; setLoginBusy(true);
  try {
    let result;
    try { result = await auth.signIn.email({ email, password }); }
    catch { throw new Error('Connexion impossible. Vérifiez vos identifiants et votre connexion internet.'); }
    if (result.error) throw new Error('Connexion impossible. Vérifiez vos identifiants et votre connexion internet.');
    await authorize(await getSession());
  } catch (error) { lock(error instanceof TypeError ? 'Service de connexion indisponible. Réessayez ou contactez l’administrateur.' : (error.message || 'Connexion impossible. Contactez l’administrateur.')); }
  finally { setLoginBusy(false, loginMessage.textContent); }
});
document.querySelector('#login-toggle-password').addEventListener('click', event => {
  const show = passwordInput.type === 'password'; passwordInput.type = show ? 'text' : 'password';
  event.currentTarget.textContent = show ? 'Masquer' : 'Afficher';
  event.currentTarget.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  event.currentTarget.setAttribute('aria-pressed', String(show));
});
function render(message = '') {
  dialog.innerHTML = `<h2 id="cloud-title" style="font-size:20px;font-weight:700;margin-bottom:12px">Espace RH partagé</h2>
  <p style="font-size:13px;line-height:1.5;margin-bottom:14px">Les données partagées sont chargées et enregistrées uniquement à votre demande. Les imports restent dans ce navigateur jusqu’à leur sauvegarde en ligne.</p>
  <p id="cloud-message" role="status" style="font-size:13px;line-height:1.5;color:#9a3412;white-space:pre-wrap;margin-bottom:12px"></p>
  <div id="cloud-content"></div><button class="btn" id="cloud-close" style="margin-top:16px">Fermer</button>`;
  dialog.querySelector('#cloud-message').textContent = message;
  const area = dialog.querySelector('#cloud-content');
  const info = document.createElement('p'); info.style.cssText = 'font-size:13px;margin-bottom:10px;overflow-wrap:anywhere';
  info.textContent = `Compte : ${currentUser?.email || ''} · Identifiant utilisateur : ${currentUser?.id || ''}. Version chargée : ${version === null ? 'aucune' : version}.`;
  area.append(info);
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  for (const [label, fn, primary] of [['Charger depuis la base', load, false], ['Sauvegarder dans la base', save, true], ['Se déconnecter', signOut, false]]) {
    const el = document.createElement('button'); el.className = primary ? 'btn btn-primary' : 'btn'; el.textContent = label; el.disabled = pending; el.onclick = fn; actions.append(el);
  }
  area.append(actions);
  dialog.querySelector('#cloud-close').onclick = () => dialog.close();
}
async function perform(fn) {
  if (pending) return; pending = true; render('Opération en cours…');
  try { await fn(); } catch (error) { if (currentUser) render(error.message || 'Opération impossible.'); }
  finally { pending = false; for (const el of dialog.querySelectorAll('button')) el.disabled = false; }
}
async function load() {
  if (!workspace.canSync()) return render('Terminez l’import, l’envoi ou la fenêtre en cours avant de charger.');
  if (!confirm('Charger la base remplacera les données présentes dans cet espace du navigateur. Les modifications locales non sauvegardées seront perdues. Continuer ?')) return;
  await perform(async () => {
    const data = await request('GET');
    if (!Number.isSafeInteger(data.version)) throw new Error('Version de base invalide.');
    if (data.snapshot) workspace.load(data.snapshot);
    version = data.version;
    render(data.snapshot ? 'Données partagées chargées.' : 'La base est vide. Vous pouvez importer vos fichiers puis sauvegarder.');
  });
}
async function save() {
  if (!workspace.canSync()) return render('Terminez l’import, l’envoi ou la fenêtre en cours avant de sauvegarder.');
  if (version === null) return render('Chargez d’abord la base pour éviter d’écraser le travail d’un autre utilisateur.');
  if (!confirm('Sauvegarder les données de cet espace dans la base partagée RH ?')) return;
  await perform(async () => {
    const data = await request('PUT', { expectedVersion: version, snapshot: workspace.snapshot() });
    version = data.version; render('Données enregistrées dans la base partagée.');
  });
}
async function signOut() {
  if (!workspace.canSync()) return render('Terminez l’import, l’envoi ou la fenêtre en cours avant de vous déconnecter.');
  if (!confirm('Déconnexion : les données de cet espace seront retirées de ce navigateur. Les modifications non sauvegardées seront perdues. Continuer ?')) return;
  workspace.clear();
  try { localStorage.removeItem(ownerKey); } catch { /* stockage inaccessible */ }
  lock(); setLoginBusy(true, 'Déconnexion en cours…');
  try {
    const result = await auth.signOut();
    if (result.error) throw new Error('Déconnexion distante non confirmée. Fermez le navigateur et contactez l’administrateur.');
    lock('Vous êtes déconnecté.');
  } catch { lock('Déconnexion distante non confirmée. Fermez le navigateur et contactez l’administrateur.'); }
}
button.onclick = () => { render(); if (!dialog.open) dialog.showModal(); };
// Un accès restauré exige à nouveau un contrôle côté serveur ; une panne échoue fermée.
setLoginBusy(true, 'Vérification de votre session…');
Promise.race([
  getSession(),
  new Promise((_, reject) => setTimeout(() => reject(new Error('Service de connexion indisponible. Réessayez.')), 12000))
]).then(async session => { if (session) await authorize(session); else lock(); })
  .catch(error => lock(error instanceof TypeError ? 'Service de connexion indisponible. Réessayez.' : (error.message || 'Service de connexion indisponible. Réessayez.')))
  .finally(() => setLoginBusy(false, loginMessage.textContent));
