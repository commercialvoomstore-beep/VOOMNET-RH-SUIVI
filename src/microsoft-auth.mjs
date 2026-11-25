// Construction locale d'une autorité Microsoft connue ; aucun hôte fourni par l'utilisateur.
export const isMicrosoftId = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
export function microsoftAuthority(accountType, tenantId) {
  if (accountType === 'personal') return 'https://login.microsoftonline.com/consumers';
  if (accountType === 'work' && isMicrosoftId(tenantId)) return 'https://login.microsoftonline.com/' + tenantId.toLowerCase();
  throw new Error('Renseignez un identifiant d’annuaire Microsoft valide pour votre compte professionnel.');
}
export function microsoftConnectionKey(clientId, accountType, tenantId) {
  if (!isMicrosoftId(clientId)) throw new Error('Renseignez un identifiant d’application Microsoft valide.');
  return clientId.toLowerCase() + '|' + microsoftAuthority(accountType, tenantId);
}
