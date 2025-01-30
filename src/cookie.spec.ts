import { mockEnvVars } from './test-utils/test-helpers.js';

describe('cookie', () => {
  beforeEach(() => {
    jest.resetModules();
    mockEnvVars({
      WORKOS_REDIRECT_URI: 'https://example.com',
      WORKOS_COOKIE_MAX_AGE: undefined,
      WORKOS_COOKIE_PASSWORD: 'a really long password that fits the minimum length requirements',
    });
  });

  describe('cookie with undefined MAX_AGE', () => {
    it('should create a cookie session storage', async () => {
      const { cookieName, getSession, commitSession, destroySession } = await import('./cookie.js');
      expect(cookieName).toBe('wos-session');
      expect(getSession).toBeDefined();
      expect(commitSession).toBeDefined();
      expect(destroySession).toBeDefined();
    });
  });

  describe('cookie with defined MAX_AGE', () => {
    beforeEach(() => {
      mockEnvVars({
        WORKOS_REDIRECT_URI: 'https://example.com',
        WORKOS_COOKIE_MAX_AGE: '3600',
        WORKOS_COOKIE_PASSWORD: 'a really long password that fits the minimum length requirements',
      });
    });

    it('should create a cookie session storage', async () => {
      const { cookieName, getSession, commitSession, destroySession } = await import('./cookie.js');
      expect(cookieName).toBe('wos-session');
      expect(getSession).toBeDefined();
      expect(commitSession).toBeDefined();
      expect(destroySession).toBeDefined();
    });
  });
});
