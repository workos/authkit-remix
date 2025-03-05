import { WorkOS } from '@workos-inc/node';
import { getConfig, getRequiredConfig } from './config.js';
import { lazy } from './utils.js';

const VERSION = '0.7.1';

export const getWorkOS = lazy(() => {
  // Get required API key from config
  const apiKey = getRequiredConfig('apiKey');

  // Get optional settings
  const apiHostname = getConfig('apiHostname');
  const apiHttps = getConfig('apiHttps');
  const apiPort = getConfig('apiPort');

  const options = {
    apiHostname,
    https: apiHttps ?? true,
    port: apiPort,
    appInfo: {
      name: 'authkit-remix',
      version: VERSION,
    },
  };

  // Initialize the WorkOS client with config values
  const workos = new WorkOS(apiKey, options);

  return workos;
});
