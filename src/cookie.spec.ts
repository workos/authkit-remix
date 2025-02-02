import { createCookie, createMemorySessionStorage } from '@remix-run/node';
import { SessionStorageManager, errors } from './cookie.js';

describe('cookie', () => {
  let storage: SessionStorageManager;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('./env-variables.js', () => ({
      WORKOS_REDIRECT_URI: 'https://example.com',
      WORKOS_COOKIE_MAX_AGE: undefined,
      WORKOW_COOKIE_PASSWORD: 'a really long password that fits the minimum length requirements',
    }));
    storage = new SessionStorageManager();
  });

  describe('singleton configuration', () => {
    it('configures and returns session storage', () => {
      // call once
      const { cookieName, getSession, commitSession, destroySession } = storage.configure();
      expect(cookieName).toBe('wos-session');
      expect(getSession).toBeDefined();
      expect(commitSession).toBeDefined();
      expect(destroySession).toBeDefined();
    });

    it('should throw an error if configure is called more than once', () => {
      // call once
      storage.configure();

      expect(() => {
        storage.configure();
      }).toThrow();
    });

    it('configures a passed in storafe option', () => {
      const redirectUrl = new URL('https://example.com/');
      const isSecureProtocol = redirectUrl.protocol === 'https:';
      const cookie = createCookie('wos-session', {
        path: '/',
        httpOnly: true,
        secure: isSecureProtocol,
        sameSite: 'lax',
        // Defaults to 400 days, the maximum allowed by Chrome
        // It's fine to have a long cookie expiry date as the access/refresh tokens
        // act as the actual time-limited aspects of the session.
        maxAge: process.env.WORKOS_COOKIE_MAX_AGE
          ? parseInt(process.env.WORKOS_COOKIE_MAX_AGE, 10)
          : 60 * 60 * 24 * 400,
        secrets: [process.env.WORKOS_COOKIE_PASSWORD ?? 'bDzFqSBOkTtDkC+wG9qeIQ4dvCZeiV2g'],
      });

      const { cookieName, getSession, commitSession, destroySession } = storage.configure({
        storage: createMemorySessionStorage({ cookie }),
        cookie,
      });
      expect(cookieName).toBe('wos-session');
      expect(getSession).toBeDefined();
      expect(commitSession).toBeDefined();
      expect(destroySession).toBeDefined();
    });

    it('throws an error if getSessionStorage is called before configure', async () => {
      await expect(async () => {
        await storage.getSessionStorage();
      }).rejects.toThrow(errors.configureSessionStorage);
    });
  });

  describe('storageManager', () => {
    beforeEach(() => {
      storage.configure();
    });

    it('should create a cookie session storage with undefined MAX_AGE', async () => {
      const { cookieName, getSession, commitSession, destroySession } = await storage.getSessionStorage();
      expect(cookieName).toBe('wos-session');
      expect(getSession).toBeDefined();
      expect(commitSession).toBeDefined();
      expect(destroySession).toBeDefined();
    });

    it('should create a cookie session storage with defined MAX_AGE', async () => {
      jest.mock('./env-variables.js', () => ({
        WORKOS_REDIRECT_URI: 'https://example.com',
        WORKOS_COOKIE_MAX_AGE: 3600,
        WORKOW_COOKIE_PASSWORD: 'a really long password that fits the minimum length requirements',
      }));
      const { cookieName, getSession, commitSession, destroySession } = await storage.getSessionStorage();
      expect(cookieName).toBe('wos-session');
      expect(getSession).toBeDefined();
      expect(commitSession).toBeDefined();
      expect(destroySession).toBeDefined();
    });
  });

  describe('singleton', () => {
    let configureSessionStorage: () => ReturnType<SessionStorageManager['configure']> & { cookieName: string };
    let getSessionStorage: () => ReturnType<SessionStorageManager['getSessionStorage'] & { cookieName: string }>;

    beforeEach(async () => {
      jest.resetModules();
      ({ configureSessionStorage, getSessionStorage } = await import('./cookie.js'));
    });

    it('configures and returns session storage', () => {
      // call once
      const { cookieName, getSession, commitSession, destroySession } = configureSessionStorage();
      expect(cookieName).toBe('wos-session');
      expect(getSession).toBeDefined();
      expect(commitSession).toBeDefined();
      expect(destroySession).toBeDefined();
    });

    it('should create a cookie session storage with undefined MAX_AGE', async () => {
      configureSessionStorage();

      const { cookieName, getSession, commitSession, destroySession } = await getSessionStorage();
      expect(cookieName).toBe('wos-session');
      expect(getSession).toBeDefined();
      expect(commitSession).toBeDefined();
      expect(destroySession).toBeDefined();
    });
  });
});
