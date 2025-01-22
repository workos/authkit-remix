import type { WorkOS as WorkOSType } from '@workos-inc/node';

describe('workos', () => {
  const envVars = {
    WORKOS_API_KEY: 'sk_test_1234567890',
    WORKOS_CLIENT_ID: 'client_1234567890',
    WORKOS_COOKIE_PASSWORD: 'kR620keEzOIzPThfnMEAba8XYgKdQ5vg',
    WORKOS_REDIRECT_URI: 'http://localhost:5173/callback',
    WORKOS_COOKIE_DOMAIN: 'example.com',
    WORKOS_API_HOSTNAME: 'api.workos.com',
  } as const;

  const options = {
    apiHostname: envVars.WORKOS_API_HOSTNAME,
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
    jest.mock('./env-variables.js', () => envVars);
    jest.mock('@workos-inc/node', () => ({ WorkOS: jest.fn() }));
    ({ workos } = await import('./workos.js'));
    ({ WorkOS } = await import('@workos-inc/node'));

    expect(WorkOS).toHaveBeenCalledWith(envVars.WORKOS_API_KEY, expect.objectContaining(options));
    expect(workos).toBeDefined();
  });

  it('sets https when WORKOS_API_HTTPS is set', async () => {
    jest.mock('./env-variables.js', () => ({ ...envVars, WORKOS_API_HTTPS: 'false' }));
    jest.mock('@workos-inc/node', () => ({ WorkOS: jest.fn() }));
    ({ workos } = await import('./workos.js'));
    ({ WorkOS } = await import('@workos-inc/node'));

    expect(WorkOS).toHaveBeenCalledWith(envVars.WORKOS_API_KEY, expect.objectContaining({ ...options, https: false }));
    expect(workos).toBeDefined();
  });

  it('does not set the port when not provided', async () => {
    jest.mock('./env-variables.js', () => ({ ...envVars, WORKOS_API_PORT: '3000' }));
    jest.mock('@workos-inc/node', () => ({ WorkOS: jest.fn() }));
    ({ workos } = await import('./workos.js'));
    ({ WorkOS } = await import('@workos-inc/node'));

    expect(WorkOS).toHaveBeenCalledWith(envVars.WORKOS_API_KEY, expect.objectContaining({ ...options, port: 3000 }));
    expect(workos).toBeDefined();
  });
});
