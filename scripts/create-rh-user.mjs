#!/usr/bin/env node
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { AUTH_URL, createRhAccount, validateRhUserId, validatePassword } from './admin-auth.mjs';

if (!process.stdin.isTTY || !process.stderr.isTTY) {
  console.error('Un terminal interactif est obligatoire. Ne transmettez pas de mot de passe par argument, fichier ou redirection.');
  process.exit(1);
}
let muted = false;
const terminalOutput = new Writable({ write(chunk, encoding, done) { if (!muted) process.stderr.write(chunk); done(); } });
const rl = readline.createInterface({ input: process.stdin, output: terminalOutput, terminal: true, historySize: 0 });
rl.on('SIGINT', () => rl.close());
async function ask(prompt, secret = false) {
  process.stderr.write(prompt);
  muted = secret;
  try { return await rl.question(''); }
  finally { muted = false; if (secret) process.stderr.write('\n'); }
}
try {
  console.error('Création locale d’un compte RH — aucune écriture automatique dans la base.');
  console.error(`Service Neon Auth : ${AUTH_URL}`);
  console.error('Utilisez un ordinateur de confiance ; ne partagez aucun mot de passe ni cookie.');
  const identifier = validateRhUserId((await ask('Identifiant RH numérique (ex. 1005) : ')).trim());
  const name = (await ask('Nom affiché du compte RH : ')).trim();
  if (!name || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Nom invalide : 1 à 100 caractères requis.');
  const adminEmail = (await ask('Email du compte administrateur Neon Auth : ')).trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(adminEmail) || adminEmail.length > 254) throw new Error('Email administrateur invalide.');
  const adminPassword = await ask('Mot de passe du compte administrateur (masqué) : ', true);
  if (!adminPassword) throw new Error('Mot de passe administrateur vide.');
  const password = validatePassword(await ask('Nouveau mot de passe RH (masqué, 12 caractères minimum) : ', true));
  const confirmation = await ask('Confirmer le nouveau mot de passe RH (masqué) : ', true);
  if (password !== confirmation) throw new Error('Les mots de passe ne correspondent pas. Aucun compte créé.');
  const alias = `${identifier}@rh-identifiant.invalid`;
  const confirmed = (await ask(`Créer ${alias} avec le rôle utilisateur ? Tapez OUI : `)).trim();
  if (confirmed !== 'OUI') throw new Error('Annulé. Aucun compte créé.');
  console.error('Connexion et création en cours…');
  const result = await createRhAccount({ adminEmail, adminPassword, identifier, password, name });
  console.error(`Compte Neon Auth créé : ${result.email}\nIdentifiant interne Neon : ${result.userId}`);
  if (result.signoutFailed) console.error('ATTENTION : déconnexion administrateur non confirmée. Révoquez la session dans la console Neon.');
  console.error('\nPour autoriser ce compte RH, vérifiez son identité dans Neon puis exécutez ce SQL dans la bonne base :\n');
  console.error(result.sql);
  console.error('\nCette commande n’a pas été exécutée automatiquement. Testez la connexion avec des données fictives.');
  console.error('Si Neon exige une vérification par email, cet alias ne peut pas recevoir de message. Consultez le README.');
} catch (error) {
  console.error(`\n${error?.name === 'AbortError' ? 'Opération interrompue.' : error.message || 'Opération impossible.'}`);
  process.exitCode = 1;
} finally { rl.close(); }
