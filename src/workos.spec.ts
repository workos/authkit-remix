import type { WorkOS as WorkOSType } from '@workos-inc/node';
import { env, mockEnvVars } from './test-utils/test-helpers.js';

describe('workos', () => {
  const options = {
    apiHostname: env.WORKOS_API_HOSTNAME,
    https: true,
    port: undefined,
    appInfo: {
      name: 'authkit-remix',
      version: expect.any(String),
    },
  } as const;

  let workos: WorkOSType;
  let WorkOS: typeof WorkOSType;

  beforeEach(() => {
    jest.resetModules();
  });

  it('should initialize WorkOS with correct API key', async () => {
    const envVars = mockEnvVars();
    jest.mock('@workos-inc/node', () => ({ WorkOS: jest.fn() }));
    ({ workos } = await import('./workos.js'));
    ({ WorkOS } = await import('@workos-inc/node'));

    expect(WorkOS).toHaveBeenCalledWith(envVars.WORKOS_API_KEY, expect.objectContaining(options));
    expect(workos).toBeDefined();
  });

  it('sets https when WORKOS_API_HTTPS is set', async () => {
    const envVars = mockEnvVars({ WORKOS_API_HTTPS: 'false' });
    jest.mock('@workos-inc/node', () => ({ WorkOS: jest.fn() }));
    ({ workos } = await import('./workos.js'));
    ({ WorkOS } = await import('@workos-inc/node'));

    expect(WorkOS).toHaveBeenCalledWith(envVars.WORKOS_API_KEY, expect.objectContaining({ ...options, https: false }));
    expect(workos).toBeDefined();
  });

  it('does not set the port when not provided', async () => {
    const envVars = mockEnvVars({ WORKOS_API_PORT: '3000' });
    jest.mock('@workos-inc/node', () => ({ WorkOS: jest.fn() }));
    ({ workos } = await import('./workos.js'));
    ({ WorkOS } = await import('@workos-inc/node'));

    expect(WorkOS).toHaveBeenCalledWith(envVars.WORKOS_API_KEY, expect.objectContaining({ ...options, port: 3000 }));
    expect(workos).toBeDefined();
  });
});
