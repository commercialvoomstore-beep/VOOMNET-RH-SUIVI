import { createAuthClient } from '@neon/neon-js/auth';
import { BetterAuthVanillaAdapter } from '@neon/neon-js/auth/vanilla';

// Cette URL est publique ; elle ne contient ni mot de passe ni clé de base de données.
const auth = createAuthClient('https://ep-orange-unit-b7693tds.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth', {
  adapter: BetterAuthVanillaAdapter({ fetchOptions: { credentials: 'include' } })
});
const workspace = window.VoomnetWorkspace;
let currentUser = null, version = null, pending = false;
const header = document.querySelector('.topbar > div:last-child');
const button = document.createElement('button');
button.className = 'btn btn-sm'; button.textContent = 'Espace RH en ligne';
header.prepend(button);
const dialog = document.createElement('dialog');
dialog.setAttribute('aria-labelledby', 'cloud-title');
dialog.style.cssText = 'width:min(95vw,540px);border:0;border-radius:16px;padding:24px;color:#0f172a;box-shadow:0 20px 60px #0005';
document.body.append(dialog);
function render(message = '') {
  dialog.innerHTML = `<h2 id="cloud-title" style="font-size:20px;font-weight:700;margin-bottom:12px">Espace RH partagé</h2>
  <p style="font-size:13px;line-height:1.5;margin-bottom:14px">Les données partagées sont chargées et enregistrées uniquement à votre demande. Les imports restent dans ce navigateur jusqu’à leur sauvegarde en ligne. Un compte Neon Auth et une autorisation RH sont nécessaires.</p>
  <p id="cloud-message" role="status" style="font-size:13px;line-height:1.5;color:#9a3412;white-space:pre-wrap;margin-bottom:12px"></p>
  <div id="cloud-content"></div><button class="btn" id="cloud-close" style="margin-top:16px">Fermer</button>`;
  dialog.querySelector('#cloud-message').textContent = message;
  const area = dialog.querySelector('#cloud-content');
  if (!currentUser) {
    area.innerHTML = `<form id="cloud-login" style="display:grid;gap:10px"><label>Adresse e-mail<input class="field" name="email" type="email" autocomplete="username" required></label><label>Mot de passe<input class="field" name="password" type="password" autocomplete="current-password" required></label><button class="btn btn-primary" type="submit">Se connecter</button></form><p style="font-size:12px;margin-top:10px">Le compte doit être créé dans Neon Auth et autorisé par l’administrateur. Aucun mot de passe n’est envoyé à notre API.</p>`;
    area.querySelector('form').onsubmit = signIn;
  } else {
    const info = document.createElement('p'); info.style.cssText = 'font-size:13px;margin-bottom:10px;overflow-wrap:anywhere';
    info.textContent = `Compte : ${currentUser.email || ''} · Identifiant utilisateur : ${currentUser.id}. Version chargée : ${version === null ? 'aucune' : version}.`;
    area.append(info);
    const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    for (const [label, fn, primary] of [['Charger depuis la base', load, false], ['Sauvegarder dans la base', save, true], ['Se déconnecter', signOut, false]]) {
      const el = document.createElement('button'); el.className = primary ? 'btn btn-primary' : 'btn'; el.textContent = label; el.disabled = pending; el.onclick = fn; actions.append(el);
    }
    area.append(actions);
  }
  dialog.querySelector('#cloud-close').onclick = () => dialog.close();
}
async function session() {
  const { data, error } = await auth.getSession();
  if (error || !data?.user || !data?.session?.token) throw new Error('Session expirée ou indisponible. Reconnectez-vous.');
  currentUser = data.user;
  return data.session.token;
}
async function request(method, body) {
  const token = await session();
  const response = await fetch('/.netlify/functions/workspace', { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit' });
  let data; try { data = await response.json(); } catch { throw new Error('Réponse du service invalide. Vérifiez le déploiement Netlify.'); }
  if (!response.ok) throw new Error(data.error || 'Service indisponible.');
  return data;
}
async function perform(fn) {
  if (pending) return; pending = true; render('Opération en cours…');
  try { await fn(); } catch (error) { render(error.message || 'Opération impossible.'); }
  finally { pending = false; for (const el of dialog.querySelectorAll('button')) el.disabled = false; }
}
async function signIn(event) {
  event.preventDefault(); const data = new FormData(event.currentTarget); const email = String(data.get('email') || '').trim(); const password = String(data.get('password') || '');
  event.currentTarget.querySelector('[name="password"]').value = '';
  await perform(async () => {
    const result = await auth.signIn.email({ email, password });
    if (result.error) throw new Error('Connexion impossible. Vérifiez vos identifiants et la configuration Neon Auth.');
    await session(); version = null;
    render('Compte connecté. Chargez la base avant toute sauvegarde. Si le compte n’est pas autorisé, communiquez son identifiant à l’administrateur RH.');
  });
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
    const snapshot = workspace.snapshot();
    const data = await request('PUT', { expectedVersion: version, snapshot });
    version = data.version;
    render('Données enregistrées dans la base partagée.');
  });
}
async function signOut() {
  if (!workspace.canSync()) return render('Terminez l’import, l’envoi ou la fenêtre en cours avant de vous déconnecter.');
  if (!confirm('Déconnexion : les données de cet espace seront retirées de ce navigateur. Les modifications non sauvegardées seront perdues. Continuer ?')) return;
  await perform(async () => {
    const result = await auth.signOut();
    if (result.error) throw new Error('Déconnexion distante impossible. Réessayez avant de quitter.');
    workspace.clear(); currentUser = null; version = null; render('Déconnecté.');
  });
}
button.onclick = async () => { render(); if (!dialog.open) dialog.showModal(); };
