import { getEnvVariable } from './env-variables.js';
import { GetAuthURLOptions } from './interfaces.js';
import { workos } from './workos.js';

async function getAuthorizationUrl(options: GetAuthURLOptions = {}) {
  const { returnPathname, screenHint } = options;

  return workos.userManagement.getAuthorizationUrl({
    provider: 'authkit',
    clientId: getEnvVariable('WORKOS_CLIENT_ID'),
    redirectUri: getEnvVariable('WORKOS_REDIRECT_URI'),
    state: returnPathname ? btoa(JSON.stringify({ returnPathname })) : undefined,
    screenHint,
  });
}

export { getAuthorizationUrl };
