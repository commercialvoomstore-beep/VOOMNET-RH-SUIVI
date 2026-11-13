// Outil local : URL Auth exacte intégrée à l'application, jamais une URL saisie par l'utilisateur.
export const AUTH_URL = 'https://ep-orange-unit-b7693tds.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth';
const COOKIE = '__Secure-neonauth.session_token';

export function validateRhUserId(id) {
  if (typeof id !== 'string' || !/^\d{1,16}$/.test(id)) throw new Error('Identifiant RH invalide : 1 à 16 chiffres requis.');
  return id;
}
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Le nouveau mot de passe doit comporter entre 12 et 128 caractères.');
  return password;
}
export function sqlAuthorization(userId) {
  if (typeof userId !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(userId)) throw new Error('Identifiant Neon inattendu : vérifiez le compte dans la console et autorisez-le manuellement.');
  return `INSERT INTO rh_users (user_id, active) VALUES ('${userId}', true)\nON CONFLICT (user_id) DO UPDATE SET active = true;`;
}
function extractCookie(headers) {
  const cookies = headers.getSetCookie();
  const found = cookies.map(v => v.split(';', 1)[0]).filter(v => v.startsWith(COOKIE + '='));
  if (found.length !== 1 || !/^__Secure-neonauth\.session_token=[A-Za-z0-9%._~+\/-]+={0,2}$/.test(found[0])) return null;
  return found[0];
}
async function send(fetcher, path, body, cookie) {
  return fetcher(AUTH_URL + path, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
}

// Le test peut remplacer fetch ; aucune option CLI ne permet de changer le destinataire des mots de passe.
export async function createRhAccount({ adminEmail, adminPassword, identifier, password, name }, fetcher = fetch) {
  validateRhUserId(identifier); validatePassword(password);
  if (typeof adminEmail !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(adminEmail) || adminEmail.length > 254 || !adminPassword) throw new Error('Compte administrateur invalide.');
  if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Nom invalide.');
  const email = `${identifier}@rh-identifiant.invalid`;
  let session, outcome, signoutFailed = false;
  let login;
  try { login = await send(fetcher, '/sign-in/email', { email: adminEmail, password: adminPassword, rememberMe: false }); }
  catch { throw new Error('Connexion administrateur non confirmée. Vérifiez Neon et votre réseau ; une session a pu être créée, contrôlez et révoquez-la dans Neon si nécessaire.'); }
  if (!login.ok) throw new Error(`Connexion administrateur refusée (HTTP ${login.status}). Vérifiez les accès, les paramètres Neon et une éventuelle vérification supplémentaire.`);
  session = extractCookie(login.headers);
  if (!session) throw new Error('Connexion sans cookie de session reconnu. Vérifiez et révoquez toute session administrateur dans Neon avant de réessayer.');
  try {
    let result;
    try { result = await send(fetcher, '/admin/create-user', { email, password, name: name.trim(), role: 'user' }, session); }
    catch { throw new Error('Création non confirmée : le compte a peut-être été créé. Vérifiez Auth → Users avant toute nouvelle tentative.'); }
    if (!result.ok) {
      if (result.status >= 500) throw new Error(`Création non confirmée (HTTP ${result.status}) : le compte a peut-être été créé. Vérifiez Auth → Users avant toute nouvelle tentative.`);
      throw new Error(`Création refusée (HTTP ${result.status}). Vérifiez le rôle administrateur, les règles Neon et si ce compte existe déjà.`);
    }
    let data;
    try { data = await result.json(); } catch { throw new Error('Réponse de création invalide : le compte a peut-être été créé. Vérifiez Auth → Users avant toute nouvelle tentative.'); }
    const user = data?.user || data?.data?.user;
    if (!user || user.email !== email) throw new Error('Réponse de création inattendue : vérifiez Auth → Users avant toute nouvelle tentative.');
    if (user.role != null && user.role !== 'user') throw new Error('Compte créé avec un rôle inattendu. Ne l’autorisez pas : vérifiez et corrigez son rôle dans Neon.');
    let sql;
    try { sql = sqlAuthorization(user.id); } catch { throw new Error('Compte créé, mais identifiant Neon inattendu. Récupérez-le dans Auth → Users et autorisez-le manuellement.'); }
    outcome = { email, userId: user.id, sql };
  } catch (error) { outcome = error; }
  finally {
    try { const response = await send(fetcher, '/sign-out', {}, session); if (!response.ok) signoutFailed = true; }
    catch { signoutFailed = true; }
    session = null;
  }
  if (outcome instanceof Error) {
    if (signoutFailed) outcome.message += ' Déconnexion non confirmée : révoquez la session dans Neon.';
    throw outcome;
  }
  return { ...outcome, signoutFailed };
}
