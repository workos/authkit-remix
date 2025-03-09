import { getConfig } from './config.js';
import { GetAuthURLOptions } from './interfaces.js';
import { getWorkOS } from './workos.js';

async function getAuthorizationUrl(options: GetAuthURLOptions = {}) {
  const { returnPathname, screenHint } = options;

  return getWorkOS().userManagement.getAuthorizationUrl({
    provider: 'authkit',
    clientId: getConfig('clientId'),
    redirectUri: getConfig('redirectUri'),
    state: returnPathname ? btoa(JSON.stringify({ returnPathname })) : undefined,
    screenHint,
  });
}

export { getAuthorizationUrl };
