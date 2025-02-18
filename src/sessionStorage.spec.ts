import { createCookie, createMemorySessionStorage } from '@remix-run/node';
import { SessionStorageManager, errors } from './sessionStorage.js';

describe('SessionStorageManager', () => {
  let storage: SessionStorageManager;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('./env-variables.js', () => ({
      WORKOS_REDIRECT_URI: 'https://example.com',
      WORKOS_COOKIE_MAX_AGE: undefined,
      WORKOS_COOKIE_PASSWORD: 'a really long password that fits the minimum length requirements',
    }));
    storage = new SessionStorageManager();
  });

  describe('singleton configuration', () => {
    it('configures and returns session storage', async () => {
      // call once
      const { cookieName, getSession, commitSession, destroySession } = await storage.configure();
      expect(cookieName).toBe('wos-session');
      expect(getSession).toBeDefined();
      expect(commitSession).toBeDefined();
      expect(destroySession).toBeDefined();
    });

    it('should use consistent configuration even with race conditions', async () => {
      const manager = new SessionStorageManager();

      // Simulate two concurrent configure calls
      const config1 = { cookieName: 'session1' };
      const config2 = { cookieName: 'session2' };

      // Start both configurations
      const promise1 = manager.configure(config1);
      const promise2 = manager.configure(config2);

      // Wait for both to complete
      const [storage1, storage2] = await Promise.all([promise1, promise2]);

      // They should be the same instance
      expect(storage1.cookieName).toBe(storage2.cookieName);

      // But which configuration won? It's not deterministic!
      // The cookie name could be either 'session1' or 'session2'
      // depending on which call actually created the storage
    });

    it('configures a passed in storage option', async () => {
      const redirectUrl = new URL('https://example.com/');
      const isSecureProtocol = redirectUrl.protocol === 'https:';
      const cookie = createCookie('_cookie', {
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

      const { cookieName, getSession, commitSession, destroySession } = await storage.configure({
        storage: createMemorySessionStorage({ cookie }),
        cookieName: '_cookie',
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
    type CreateCookieSessionStorageType = (typeof import('@remix-run/node'))['createCookieSessionStorage'];
    let createCookieSessionStorage: jest.MockedFunction<CreateCookieSessionStorageType>;

    async function mockWithEnvVariables(variables?: Record<string, string | undefined>) {
      jest.resetModules();

      jest.doMock('./env-variables.js', () => ({
        WORKOS_REDIRECT_URI: 'https://example.com',
        WORKOS_COOKIE_MAX_AGE: '',
        WORKOS_COOKIE_PASSWORD: 'a really long password that fits the minimum length requirements',
        ...variables,
      }));

      // Mock first, before any imports
      jest.doMock('@remix-run/node', () => ({
        ...jest.requireActual('@remix-run/node'),
        createCookieSessionStorage: jest.fn().mockReturnValue({
          getSession: jest.fn(),
          commitSession: jest.fn(),
          destroySession: jest.fn(),
        }),
      }));

      createCookieSessionStorage = (await import('@remix-run/node'))
        .createCookieSessionStorage as jest.MockedFunction<CreateCookieSessionStorageType>;

      const { SessionStorageManager } = await import('./sessionStorage.js');
      storage = new SessionStorageManager();
      storage.configure();
      return storage;
    }

    it('should create a cookie session storage with default MAX_AGE', async () => {
      const storage = await mockWithEnvVariables();
      const { cookieName, getSession, commitSession, destroySession } = await storage.getSessionStorage();
      expect(cookieName).toBe('wos-session');
      expect(getSession).toBeDefined();
      expect(commitSession).toBeDefined();
      expect(destroySession).toBeDefined();
      expect(createCookieSessionStorage).toHaveBeenCalledWith({
        cookie: expect.objectContaining({
          name: 'wos-session',
          maxAge: 34560000, // 400 days
        }),
      });
    });

    it('should create a cookie session storage with defined MAX_AGE', async () => {
      const storage = await mockWithEnvVariables({
        WORKOS_REDIRECT_URI: 'https://example.com',
        WORKOS_COOKIE_MAX_AGE: '3600',
        WORKOS_COOKIE_PASSWORD: 'a really long password that fits the minimum length requirements',
      });
      const { cookieName, getSession, commitSession, destroySession } = await storage.getSessionStorage();
      expect(cookieName).toBe('wos-session');
      expect(getSession).toBeDefined();
      expect(commitSession).toBeDefined();
      expect(destroySession).toBeDefined();
      expect(createCookieSessionStorage).toHaveBeenCalledWith({
        cookie: expect.objectContaining({
          name: 'wos-session',
          maxAge: 3600,
        }),
      });
    });
  });

  describe('singleton', () => {
    let configureSessionStorage: (typeof import('./sessionStorage.js'))['configureSessionStorage'];
    let getSessionStorage: (typeof import('./sessionStorage.js'))['getSessionStorage'];

    beforeEach(async () => {
      jest.resetModules();
      ({ configureSessionStorage, getSessionStorage } = await import('./sessionStorage.js'));
    });

    it('configures and returns session storage', async () => {
      // call once
      const { cookieName, getSession, commitSession, destroySession } = await configureSessionStorage();
      expect(cookieName).toBe('wos-session');
      expect(getSession).toBeDefined();
      expect(commitSession).toBeDefined();
      expect(destroySession).toBeDefined();
    });

    it('should create a cookie session storage with undefined MAX_AGE', async () => {
      await configureSessionStorage();

      const { cookieName, getSession, commitSession, destroySession } = await getSessionStorage();
      expect(cookieName).toBe('wos-session');
      expect(getSession).toBeDefined();
      expect(commitSession).toBeDefined();
      expect(destroySession).toBeDefined();
    });
  });
});
