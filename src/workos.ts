import { WorkOS } from '@workos-inc/node';
import { getEnvVariable, getOptionalEnvVariable } from './env-variables.js';

const VERSION = '0.7.1';

const options = {
  apiHostname: getOptionalEnvVariable('WORKOS_API_HOSTNAME'),
  https: getOptionalEnvVariable('WORKOS_API_HTTPS') ? getEnvVariable('WORKOS_API_HTTPS') === 'true' : true,
  port: getOptionalEnvVariable('WORKOS_API_PORT') ? parseInt(getEnvVariable('WORKOS_API_PORT')) : undefined,
  appInfo: {
    name: 'authkit-remix',
    version: VERSION,
  },
};

// Initialize the WorkOS client
const workos = new WorkOS(getEnvVariable('WORKOS_API_KEY'), options);

export { workos };
