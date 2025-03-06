import type { configure as ConfigureType, getConfig as getConfigType } from './config';
import { AuthKitConfig } from './interfaces';

describe('config', () => {
  let configure: typeof ConfigureType;
  let getConfig: typeof getConfigType;

  beforeEach(() => {
    jest.resetModules();
    ({ configure, getConfig } = require('./config.js'));
  });

  it('reads values from process.env with no configure call', () => {
    expect(getConfig('clientId')).toBe(process.env.WORKOS_CLIENT_ID);
    expect(getConfig('apiKey')).toBe(process.env.WORKOS_API_KEY);
  });

  it('reads values from the provided config', () => {
    configure({
      clientId: 'client_1234567890',
      apiKey: 'sk_test_1234567890',
    });

    expect(getConfig('clientId')).toBe('client_1234567890');
    expect(getConfig('apiKey')).toBe('sk_test_1234567890');
  });

  it('reads env variables from the provided config', () => {
    configure(
      {},
      {
        WORKOS_CLIENT_ID: 'client_123456789',
        WORKOS_API_KEY: 'sk_test_123456789',
      },
    );

    expect(getConfig('clientId')).toBe('client_123456789');
    expect(getConfig('apiKey')).toBe('sk_test_123456789');
  });

  it('reads values from the provided config', () => {
    configure({
      clientId: 'client_1234567890',
    });

    expect(getConfig('clientId')).toBe('client_1234567890');
    expect(getConfig('apiKey')).toBe(process.env.WORKOS_API_KEY);
  });

  it('reads values from the provided source', () => {
    configure((key) => {
      if (key === 'WORKOS_CLIENT_ID') {
        return 'client_1234567890';
      } else if (key === 'WORKOS_API_KEY') {
        return 'sk_test_1234567890';
      }

      return undefined;
    });

    expect(getConfig('clientId')).toBe('client_1234567890');
    expect(getConfig('apiKey')).toBe('sk_test_1234567890');
  });

  it('reads from provided config, falling back to provided source', () => {
    configure(
      {
        clientId: 'client_1234567890',
      },
      (key) => {
        if (key === 'WORKOS_API_KEY') {
          return 'sk_test_1234567890';
        }
      },
    );

    expect(getConfig('clientId')).toBe('client_1234567890');
    expect(getConfig('apiKey')).toBe('sk_test_1234567890');
  });

  it('reads from defaults when no values are provided', () => {
    configure((_key) => undefined);

    expect(getConfig('apiHttps')).toBe(true);
    expect(getConfig('apiHostname')).toBe('api.workos.com');
  });

  it('returns undefined for unknown values', () => {
    expect(getConfig('unknown' as keyof AuthKitConfig)).toBeUndefined();
  });

  it('converts strings to appropriate types', () => {
    configure((key) => {
      switch (key) {
        case 'WORKOS_API_PORT':
          return '3000';
        case 'WORKOS_COOKIE_MAX_AGE':
          return '3600';
        case 'WORKOS_API_HTTPS':
          return 'true';
        default:
          return undefined;
      }
    });
    expect(typeof getConfig('apiPort')).toBe('number');
    expect(typeof getConfig('cookieMaxAge')).toBe('number');
    expect(typeof getConfig('apiHttps')).toBe('boolean');
  });

  it('throws an error if cookiePassword is too short', () => {
    expect(() => {
      configure({ cookiePassword: 'short' });
    }).toThrow('cookiePassword must be at least 32 characters long');
  });

  it('throws an error if required values are missing', () => {
    expect(() => {
      configure((_key) => undefined);
      getConfig('apiKey');
    }).toThrow();
  });
});
