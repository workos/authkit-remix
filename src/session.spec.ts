import { LoaderFunctionArgs, Session as ReactRouterSession, redirect } from '@remix-run/node';
import { AuthenticationResponse } from '@workos-inc/node';
import * as ironSession from 'iron-session';
import * as jose from 'jose';
import {
  configureSessionStorage as configureSessionStorageMock,
  getSessionStorage as getSessionStorageMock,
} from './sessionStorage.js';
import { Session } from './interfaces.js';
import { authkitLoader, encryptSession, refreshSession, terminateSession } from './session.js';
import { assertIsResponse } from './test-utils/test-helpers.js';
import { getWorkOS } from './workos.js';
import { getConfig } from './config.js';

jest.mock('./sessionStorage.js', () => ({
  configureSessionStorage: jest.fn(),
  getSessionStorage: jest.fn(),
}));

// Mock dependencies
const fakeWorkosInstance = {
  userManagement: {
    getAuthorizationUrl: jest.fn().mockResolvedValue('https://auth.workos.com/oauth/authorize'),
    getLogoutUrl: jest.fn(({ sessionId }) => `https://auth.workos.com/logout/${sessionId}`),
    getJwksUrl: jest.fn((clientId: string) => `https://auth.workos.com/oauth/jwks/${clientId}`),
    authenticateWithRefreshToken: jest.fn(),
  },
};

jest.mock('./workos.js', () => ({
  getWorkOS: jest.fn(() => fakeWorkosInstance),
}));

const workos = getWorkOS();
const unsealData = jest.mocked(ironSession.unsealData);
const sealData = jest.mocked(ironSession.sealData);
const getLogoutUrl = jest.mocked(workos.userManagement.getLogoutUrl);
const authenticateWithRefreshToken = jest.mocked(workos.userManagement.authenticateWithRefreshToken);
const getSessionStorage = jest.mocked(getSessionStorageMock);
const configureSessionStorage = jest.mocked(configureSessionStorageMock);
const jwtVerify = jest.mocked(jose.jwtVerify);

function getHeaderValue(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) {
    return null;
  }

  if (headers instanceof Headers) {
    return headers.get(name);
  }

  if (Array.isArray(headers)) {
    const pair = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return pair?.[1] ?? null;
  }

  return headers[name] ?? null;
}

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
  decodeJwt: jest.fn(() => ({
    sid: 'test-session-id',
  })),
}));

jest.mock('iron-session', () => ({
  unsealData: jest.fn(),
  sealData: jest.fn(),
}));

describe('session', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMockSession = (overrides?: Record<string, any>): ReactRouterSession =>
    ({
      has: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      unset: jest.fn(),
      flash: jest.fn(),
      id: 'test-session-id',
      data: {},
      ...overrides,
    }) satisfies ReactRouterSession;

  const createMockRequest = (cookie = 'test-cookie', url = 'http://example.com./some-path') =>
    new Request(url, {
      headers: new Headers({
        Cookie: cookie,
      }),
    });

  let getSession: jest.Mock;
  let destroySession: jest.Mock;
  let commitSession: jest.Mock;

  beforeEach(async () => {
    getSession = jest.fn();
    destroySession = jest.fn().mockResolvedValue('destroyed-session-cookie');
    commitSession = jest.fn();

    getSessionStorage.mockResolvedValue({
      cookieName: 'wos-cookie',
      getSession,
      destroySession,
      commitSession,
    });

    configureSessionStorage.mockResolvedValue({
      cookieName: 'wos-cookie',
      getSession,
      destroySession,
      commitSession,
    });
  });

  describe('encryptSession', () => {
    it('should encrypt session data with correct parameters', async () => {
      const mockSession = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        user: {
          object: 'user',
          id: 'test-user',
          email: 'test@example.com',
          emailVerified: true,
          profilePictureUrl: 'https://example.com/avatar.jpg',
          firstName: 'Test',
          lastName: 'User',
          externalId: null,
          createdAt: '2021-01-01T00:00:00Z',
          updatedAt: '2021-01-01T00:00:00Z',
          lastSignInAt: '2021-01-01T00:00:00Z',
        },
        impersonator: undefined,
        headers: {},
      } satisfies Session;

      sealData.mockResolvedValueOnce('encrypted-data');

      const result = await encryptSession(mockSession);

      expect(result).toBe('encrypted-data');
      expect(sealData).toHaveBeenCalledWith(mockSession, {
        password: getConfig('cookiePassword'),
        ttl: 0,
      });
      expect(sealData).toHaveBeenCalledTimes(1);
    });
  });

  describe('terminateSession', () => {
    const createMockRequest = (cookie = 'test-cookie', url = 'http://example.com./some-path') =>
      new Request(url, {
        headers: new Headers({
          Cookie: cookie,
        }),
      });

    it('should redirect to root when session token has no sessionId', async () => {
      const mockSession = createMockSession({
        has: jest.fn().mockReturnValue(true),
        get: jest.fn().mockReturnValue('encrypted-jwt'),
      });

      getSession.mockResolvedValueOnce(mockSession);

      // Mock session data with a token that will decode to no sessionId
      const mockSessionData = {
        accessToken: 'token.without.sessionid',
        refreshToken: 'refresh-token',
        user: { id: 'user-id' },
        impersonator: null,
      };
      unsealData.mockResolvedValueOnce(mockSessionData);

      // Mock decodeJwt to return no sessionId
      (jose.decodeJwt as jest.Mock).mockReturnValueOnce({});

      const response = await terminateSession(createMockRequest());

      expect(response instanceof Response).toBe(true);
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/');
      expect(response.headers.get('Set-Cookie')).toBe('destroyed-session-cookie');
      expect(destroySession).toHaveBeenCalledWith(mockSession);
      expect(getLogoutUrl).not.toHaveBeenCalled();
    });

    it('Should redirect to the provided returnTo if no session exists', async () => {
      const mockSession = createMockSession({
        has: jest.fn().mockReturnValue(true),
        get: jest.fn().mockReturnValue('encrypted-jwt'),
      });

      getSession.mockResolvedValueOnce(mockSession);

      // Mock session data with a token that will decode to no sessionId
      const mockSessionData = {
        accessToken: 'token.without.sessionid',
        refreshToken: 'refresh-token',
        user: { id: 'user-id' },
        impersonator: null,
      };
      unsealData.mockResolvedValueOnce(mockSessionData);

      // Mock decodeJwt to return no sessionId
      (jose.decodeJwt as jest.Mock).mockReturnValueOnce({});

      const response = await terminateSession(createMockRequest(), { returnTo: '/login' });

      expect(response instanceof Response).toBe(true);
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/login');
      expect(response.headers.get('Set-Cookie')).toBe('destroyed-session-cookie');
      expect(destroySession).toHaveBeenCalledWith(mockSession);
      expect(getLogoutUrl).not.toHaveBeenCalled();
    });

    it('should redirect to WorkOS logout URL when valid session exists', async () => {
      // Setup a session with jwt
      const mockSession = createMockSession({
        has: jest.fn().mockReturnValue(true),
        get: jest.fn().mockReturnValue('encrypted-jwt'),
      });

      getSession.mockResolvedValueOnce(mockSession);

      // Mock the unsealed session data
      const mockSessionData = {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOiJ0ZXN0LXNlc3Npb24taWQifQ.signature',
        refreshToken: 'refresh-token',
        user: { id: 'user-id' },
        impersonator: null,
      };
      unsealData.mockResolvedValueOnce(mockSessionData);

      // Execute
      const response = await terminateSession(createMockRequest());

      // Assert response is instance of Response
      expect(response instanceof Response).toBe(true);
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('https://auth.workos.com/logout/test-session-id');
      expect(response.headers.get('Set-Cookie')).toBe('destroyed-session-cookie');
      expect(destroySession).toHaveBeenCalledWith(mockSession);
      expect(getLogoutUrl).toHaveBeenCalledWith({
        sessionId: 'test-session-id',
      });
      expect(mockSession.has).toHaveBeenCalledWith('jwt');
      expect(mockSession.get).toHaveBeenCalledWith('jwt');
    });
  });
  describe('authkitLoader', () => {
    const createLoaderArgs = (request: Request): LoaderFunctionArgs => ({
      request,
      params: {},
      context: {},
    });

    describe('unauthenticated flows', () => {
      beforeEach(() => {
        // Setup session without JWT
        const mockSession = createMockSession({
          has: jest.fn().mockReturnValue(false),
          get: jest.fn(),
        });
        getSession.mockResolvedValue(mockSession);
        unsealData.mockResolvedValue(null);
      });

      it('should return unauthorized data when no session exists', async () => {
        const { data } = await authkitLoader(createLoaderArgs(createMockRequest()));

        expect(data).toEqual({
          user: null,
          impersonator: null,
          organizationId: null,
          permissions: null,
          entitlements: null,
          role: null,
          sessionId: null,
        });
      });

      it('should redirect to login when ensureSignedIn is true', async () => {
        try {
          await authkitLoader(createLoaderArgs(createMockRequest()), { ensureSignedIn: true });
          fail('Expected redirect response to be thrown');
        } catch (response: unknown) {
          assertIsResponse(response);
          expect(response.status).toBe(302);
          expect(response.headers.get('Location')).toMatch(/^https:\/\/auth\.workos\.com\/oauth/);
          expect(response.headers.get('Set-Cookie')).toBe('destroyed-session-cookie');
        }
      });

      it('should pass through loader redirects when returned', async () => {
        const redirectResponse = redirect('/dashboard', {
          headers: { 'X-Redirect-Reason': 'test' },
        });
        const customLoader = jest.fn().mockReturnValue(redirectResponse);

        try {
          await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);
        } catch (response: unknown) {
          assertIsResponse(response);
          expect(response.status).toBe(302);
          expect(response.headers.get('Location')).toEqual('/dashboard');
          expect(response.headers.get('X-Redirect-Reason')).toEqual('test');
        }
      });
    });

    describe('authenticated flows', () => {
      const mockSessionData = {
        accessToken: 'valid.jwt.token',
        refreshToken: 'refresh.token',
        user: {
          id: 'user-1',
          email: 'test@example.com',
        },
        impersonator: null,
      };

      beforeEach(() => {
        const mockSession = createMockSession({
          has: jest.fn().mockReturnValue(true),
          get: jest.fn().mockReturnValue('encrypted-jwt'),
          set: jest.fn(),
        });
        getSession.mockResolvedValue(mockSession);
        unsealData.mockResolvedValue({
          ...mockSessionData,
          headers: {
            'Set-Cookie': 'session-cookie',
          },
        });
        jwtVerify.mockResolvedValue({
          payload: {},
          protectedHeader: {},
          key: new TextEncoder().encode('test-key'),
        } as jose.JWTVerifyResult & jose.ResolvedKey<jose.KeyLike>);
        (jose.decodeJwt as jest.Mock).mockReturnValue({
          sid: 'test-session-id',
          org_id: 'org-123',
          role: 'admin',
          permissions: ['read', 'write'],
          entitlements: ['premium'],
        });
      });

      it('should pass through non-JSON responses with just the cookie added', async () => {
        // Set up a custom loader that returns HTML
        const htmlContent = '<html><body><h1>Hello World!</h1></body></html>';
        const customLoader = jest.fn().mockReturnValue(
          new Response(htmlContent, {
            headers: {
              'Content-Type': 'text/html',
              'X-Custom-Header': 'test-value',
            },
          }),
        );

        // Call authkitLoader with the HTML-returning loader
        const result = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);

        // Verify we got back a Response, not a DataWithResponseInit
        assertIsResponse(result);

        // Check that the response body wasn't modified
        const resultText = await result.clone().text();
        expect(resultText).toBe(htmlContent);

        // Check that original headers were preserved
        expect(result.headers.get('Content-Type')).toBe('text/html');
        expect(result.headers.get('X-Custom-Header')).toBe('test-value');

        // Check that session cookie was added
        expect(result.headers.get('Set-Cookie')).toBe('session-cookie');

        // Verify that the JSON parsing method was not called
        const jsonSpy = jest.spyOn(Response.prototype, 'json');
        expect(jsonSpy).not.toHaveBeenCalled();
        jsonSpy.mockRestore();
      });

      it('should return authorized data with session claims', async () => {
        const { data } = await authkitLoader(createLoaderArgs(createMockRequest()));

        expect(data).toEqual({
          user: mockSessionData.user,
          impersonator: null,
          organizationId: 'org-123',
          permissions: ['read', 'write'],
          entitlements: ['premium'],
          role: 'admin',
          sessionId: 'test-session-id',
        });
      });

      it('should handle custom loader data', async () => {
        const customLoader = jest.fn().mockReturnValue({
          customData: 'test-value',
          metadata: { key: 'value' },
        });

        const { data } = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);

        expect(data).toEqual(
          expect.objectContaining({
            customData: 'test-value',
            metadata: { key: 'value' },
            user: mockSessionData.user,
            sessionId: 'test-session-id',
          }),
        );
      });

      it('should merge plain objects with auth data', async () => {
        // Create a custom object with a property that would be overwritten by auth
        const customLoader = jest.fn().mockReturnValue({
          customData: 'test-value',
          // This would be overwritten if using spread operator incorrectly
          user: {
            id: 'custom-user-id',
            customProperty: 'should-be-preserved',
          },
        });

        const { data } = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);

        // The auth user should take precedence, but using Object.assign preserves the correct behavior
        expect(data.user).toEqual(mockSessionData.user);
        expect(data.customData).toBe('test-value');
      });

      it('should set session headers for plain object responses', async () => {
        const customLoader = jest.fn().mockReturnValue({
          customData: 'test-value',
        });

        const { data, init } = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);

        // Check that session headers were properly included
        expect(getHeaderValue(init?.headers, 'Set-Cookie')).toBe('session-cookie');

        // Check that the data was merged correctly
        expect(data.customData).toBe('test-value');
        expect(data.user).toEqual(mockSessionData.user);
      });

      it('should handle custom loader response with headers', async () => {
        const customLoader = jest.fn().mockReturnValue(
          new Response(JSON.stringify({ customData: 'test-value' }), {
            headers: {
              'Custom-Header': 'test-header',
              'Content-Type': 'application/json',
            },
          }),
        );

        const { data, init } = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);

        expect(getHeaderValue(init?.headers, 'Custom-Header')).toBe('test-header');
        expect(getHeaderValue(init?.headers, 'Content-Type')).toBe('application/json');

        expect(data).toEqual(
          expect.objectContaining({
            customData: 'test-value',
            user: mockSessionData.user,
          }),
        );
      });

      it('passes through the response when JSON parsing fails', async () => {
        // Test invalid JSON handling without accessing the body
        // Create a spied version of the native response.json method that will throw
        const jsonError = new Error('Invalid JSON');
        const jsonSpy = jest.spyOn(Response.prototype, 'json').mockRejectedValue(jsonError);

        // Create a response with the right content type but that will throw on json()
        const mockResponse = new Response('', {
          headers: {
            'Content-Type': 'application/json',
            'Custom-Header': 'test-header',
          },
        });

        const customLoader = jest.fn().mockReturnValue(mockResponse);

        // Get the result
        const result = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);

        // Verify we get a response back (not a DataWithResponseInit)
        assertIsResponse(result);

        // Verify headers
        expect(result.headers.get('Custom-Header')).toBe('test-header');
        expect(result.headers.get('Content-Type')).toBe('application/json');
        expect(result.headers.get('Set-Cookie')).toBe('session-cookie');

        // Clean up the spy
        jsonSpy.mockRestore();
      });

      it('should properly merge object headers from DataWithResponseInit', async () => {
        // Mock the data() function by creating an object that matches DataWithResponseInit structure
        const dataResponse = {
          type: 'DataWithResponseInit',
          data: { customData: 'test-value' },
          init: {
            headers: {
              'Custom-Header': 'test-header',
              'X-Custom-Meta': 'meta-value',
            },
          },
        };

        const customLoader = jest.fn().mockReturnValue(dataResponse);

        const { data, init } = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);

        // Check that both original headers and session headers were merged
        expect(getHeaderValue(init?.headers, 'Custom-Header')).toBe('test-header');
        expect(getHeaderValue(init?.headers, 'X-Custom-Meta')).toBe('meta-value');
        expect(getHeaderValue(init?.headers, 'Set-Cookie')).toBe('session-cookie');

        // Check that the data was properly merged
        expect(data).toEqual(
          expect.objectContaining({
            customData: 'test-value',
            user: mockSessionData.user,
          }),
        );
      });

      it('should merge Headers instance from DataWithResponseInit', async () => {
        // Create Headers instance
        const headerInstance = new Headers();
        headerInstance.append('Custom-Header', 'test-header');
        headerInstance.append('X-Custom-Meta', 'meta-value');

        // Mock the data() function with Headers instance
        const dataResponse = {
          type: 'DataWithResponseInit',
          data: { customData: 'test-value' },
          init: {
            headers: headerInstance,
          },
        };

        const customLoader = jest.fn().mockReturnValue(dataResponse);

        const { data, init } = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);

        // Check that both original headers and session headers were merged
        expect(getHeaderValue(init?.headers, 'Custom-Header')).toBe('test-header');
        expect(getHeaderValue(init?.headers, 'X-Custom-Meta')).toBe('meta-value');
        expect(getHeaderValue(init?.headers, 'Set-Cookie')).toBe('session-cookie');

        // Check that the data was properly merged
        expect(data).toEqual(
          expect.objectContaining({
            customData: 'test-value',
            user: mockSessionData.user,
          }),
        );
      });

      it('handles array-valued headers in DataWithResponseInit', async () => {
        // Mock the data() function with headers containing array values
        const dataResponse = {
          type: 'DataWithResponseInit',
          data: { customData: 'test-value' },
          init: {
            headers: {
              'X-Multiple-Values': ['value1', 'value2'],
              'Custom-Header': 'single-value',
            },
          },
        };

        const customLoader = jest.fn().mockReturnValue(dataResponse);

        const { data, init } = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);

        // We can't directly test for multiple header values since getHeaderValue only returns one
        // But we can check that headers were set properly
        expect(getHeaderValue(init?.headers, 'Custom-Header')).toBe('single-value');
        expect(getHeaderValue(init?.headers, 'Set-Cookie')).toBe('session-cookie');

        // For multiple values, check if at least one value got through
        // The Headers API appends multiple values for the same header
        expect(getHeaderValue(init?.headers, 'X-Multiple-Values')).not.toBeNull();

        // Check that the data was properly merged
        expect(data).toEqual(
          expect.objectContaining({
            customData: 'test-value',
            user: mockSessionData.user,
          }),
        );
      });

      it('preserves status and statusText from DataWithResponseInit', async () => {
        // Mock the data() function with status and statusText
        const dataResponse = {
          type: 'DataWithResponseInit',
          data: { customData: 'test-value' },
          init: {
            headers: {
              'Custom-Header': 'test-header',
            },
            status: 201,
            statusText: 'Created',
          },
        };

        const customLoader = jest.fn().mockReturnValue(dataResponse);

        const { data, init } = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);

        // Check that status and statusText were preserved
        expect(init?.status).toBe(201);
        expect(init?.statusText).toBe('Created');

        // Check that headers were still merged
        expect(getHeaderValue(init?.headers, 'Custom-Header')).toBe('test-header');
        expect(getHeaderValue(init?.headers, 'Set-Cookie')).toBe('session-cookie');

        // Check that the data was properly merged
        expect(data).toEqual(
          expect.objectContaining({
            customData: 'test-value',
            user: mockSessionData.user,
          }),
        );
      });

      it('should pass through loader redirects', async () => {
        const redirectResponse = redirect('/dashboard', {
          headers: { 'X-Redirect-Reason': 'test' },
        });
        const customLoader = jest.fn().mockImplementation(() => {
          throw redirectResponse;
        });

        try {
          await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);
          fail('Expected redirect response to be thrown');
        } catch (response: unknown) {
          assertIsResponse(response);
          expect(response.status).toBe(302);
          expect(response.headers.get('Location')).toBe('/dashboard');
          expect(response.headers.get('X-Redirect-Reason')).toBe('test');
        }
      });

      it('should provide getAccessToken function to custom loader', async () => {
        const customLoader = jest.fn().mockImplementation(({ getAccessToken }) => {
          const token = getAccessToken();
          return { retrievedToken: token };
        });

        const { data } = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);

        // Verify the loader was called with getAccessToken function
        expect(customLoader).toHaveBeenCalledWith(
          expect.objectContaining({
            auth: expect.objectContaining({
              user: mockSessionData.user,
            }),
            getAccessToken: expect.any(Function),
          }),
        );

        // Verify the token was retrieved correctly
        expect(data).toEqual(
          expect.objectContaining({
            retrievedToken: mockSessionData.accessToken,
            user: mockSessionData.user,
          }),
        );
      });

      it('should return null from getAccessToken for unauthenticated users', async () => {
        // Mock no session
        unsealData.mockResolvedValue(null);

        const customLoader = jest.fn().mockImplementation(({ getAccessToken }) => {
          const token = getAccessToken();
          return { retrievedToken: token };
        });

        const { data } = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);

        // Verify getAccessToken returned null
        expect(data).toEqual(
          expect.objectContaining({
            retrievedToken: null,
            user: null,
          }),
        );
      });
    });

    describe('session refresh', () => {
      beforeEach(() => {
        // Setup session with expired token
        const mockSession = createMockSession({
          has: jest.fn().mockReturnValue(true),
          get: jest.fn().mockReturnValue('encrypted-jwt'),
          set: jest.fn(),
        });
        getSession.mockResolvedValue(mockSession);

        const expiredSessionData = {
          accessToken: 'expired.token',
          refreshToken: 'refresh.token',
          user: { id: 'user-1' },
          impersonator: null,
        };
        unsealData.mockResolvedValue(expiredSessionData);
        sealData.mockResolvedValue('new-encrypted-jwt');
        commitSession.mockResolvedValue('new-session-cookie');

        // Token verification fails
        jwtVerify.mockRejectedValue(new Error('Token expired'));

        // But refresh succeeds
        authenticateWithRefreshToken.mockResolvedValue({
          accessToken: 'new.valid.token',
          refreshToken: 'new.refresh.token',
        } as AuthenticationResponse);

        // Mock different JWT decoding results for expired vs new token
        (jose.decodeJwt as jest.Mock).mockImplementation((token: string) => {
          if (token === 'expired.token') {
            return {
              sid: 'test-session-id',
              org_id: 'org-123',
              role: null,
              permissions: [],
              entitlements: [],
            };
          }
          if (token === 'new.valid.token') {
            return {
              sid: 'new-session-id',
              org_id: 'org-123',
              role: 'user',
              permissions: ['read'],
              entitlements: ['basic'],
            };
          }
          return {}; // fallback
        });
      });

      it('should refresh session when access token is invalid', async () => {
        const { data, init } = await authkitLoader(createLoaderArgs(createMockRequest()));

        // Verify the refresh token flow was triggered
        expect(authenticateWithRefreshToken).toHaveBeenCalledWith({
          clientId: expect.any(String),
          refreshToken: 'refresh.token',
          organizationId: 'org-123',
        });

        // Verify the response contains the new token data
        expect(data).toEqual(
          expect.objectContaining({
            sessionId: 'new-session-id',
            organizationId: 'org-123',
            role: 'user',
            permissions: ['read'],
            entitlements: ['basic'],
          }),
        );

        // Verify cookie was set
        expect(getHeaderValue(init?.headers, 'Set-Cookie')).toBe('new-session-cookie');
      });

      it('calls onSessionRefreshSuccess when provided', async () => {
        const onSessionRefreshSuccess = jest.fn();
        await authkitLoader(createLoaderArgs(createMockRequest()), {
          onSessionRefreshSuccess,
        });

        expect(onSessionRefreshSuccess).toHaveBeenCalled();
      });

      it('should redirect to root when refresh fails', async () => {
        authenticateWithRefreshToken.mockRejectedValue(new Error('Refresh token invalid'));

        try {
          await authkitLoader(createLoaderArgs(createMockRequest()));
          fail('Expected redirect response to be thrown');
        } catch (response: unknown) {
          assertIsResponse(response);
          expect(response.status).toBe(302);
          expect(response.headers.get('Location')).toBe('/');
          expect(response.headers.get('Set-Cookie')).toBe('destroyed-session-cookie');
        }
      });

      it('calls onSessionRefreshError when provided and refresh fails', async () => {
        authenticateWithRefreshToken.mockRejectedValue(new Error('Refresh token invalid'));
        const onSessionRefreshError = jest.fn().mockReturnValue(redirect('/error'));

        await authkitLoader(createLoaderArgs(createMockRequest()), {
          onSessionRefreshError,
        });

        expect(onSessionRefreshError).toHaveBeenCalled();
      });

      it('allows redirect from onSessionRefreshError callback', async () => {
        authenticateWithRefreshToken.mockRejectedValue(new Error('Refresh token invalid'));

        try {
          await authkitLoader(createLoaderArgs(createMockRequest()), {
            onSessionRefreshError: () => {
              throw redirect('/');
            },
          });
          fail('Expected redirect response to be thrown');
        } catch (response: unknown) {
          assertIsResponse(response);
          expect(response.status).toBe(302);
          expect(response.headers.get('Location')).toBe('/');
        }
      });
    });
  });

  describe('refreshSession', () => {
    const createMockRequest = (cookie = 'test-cookie', url = 'http://example.com./some-path') =>
      new Request(url, {
        headers: new Headers({
          Cookie: cookie,
        }),
      });

    let getSession: jest.Mock;
    let destroySession: jest.Mock;
    let commitSession: jest.Mock;
    let mockSession: ReactRouterSession;

    beforeEach(() => {
      getSession = jest.fn();
      destroySession = jest.fn().mockResolvedValue('destroyed-session-cookie');
      commitSession = jest.fn().mockResolvedValue('new-session-cookie');

      mockSession = createMockSession({
        has: jest.fn().mockReturnValue(true),
        get: jest.fn().mockReturnValue('encrypted-jwt'),
        set: jest.fn(),
      });

      getSessionStorage.mockResolvedValue({
        cookieName: 'wos-cookie',
        getSession,
        destroySession,
        commitSession,
      });

      getSession.mockResolvedValue(mockSession);

      const validSessionData = {
        accessToken: 'valid.token',
        refreshToken: 'refresh.token',
        user: {
          id: 'user-1',
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          object: 'user',
        },
        impersonator: null,
      };
      unsealData.mockResolvedValue(validSessionData);
      sealData.mockResolvedValue('new-encrypted-jwt');

      authenticateWithRefreshToken.mockResolvedValue({
        accessToken: 'new.valid.token',
        refreshToken: 'new.refresh.token',
      } as AuthenticationResponse);

      // Mock JWT decoding
      (jose.decodeJwt as jest.Mock).mockReturnValue({
        sid: 'new-session-id',
        org_id: 'org-123',
        role: 'user',
        permissions: ['read'],
        entitlements: ['basic'],
      });
    });

    it('should refresh the session successfully', async () => {
      const refreshedSession = await refreshSession(createMockRequest());

      expect(getSessionStorage).toHaveBeenCalled();
      expect(authenticateWithRefreshToken).toHaveBeenCalledWith({
        clientId: expect.any(String),
        refreshToken: 'refresh.token',
        organizationId: undefined,
      });

      expect(mockSession.set).toHaveBeenCalledWith('jwt', 'new-encrypted-jwt');
      expect(commitSession).toHaveBeenCalledWith(mockSession);

      expect(refreshedSession).toEqual({
        user: expect.objectContaining({ id: 'user-1' }),
        sessionId: 'new-session-id',
        accessToken: 'new.valid.token',
        organizationId: 'org-123',
        role: 'user',
        permissions: ['read'],
        entitlements: ['basic'],
        impersonator: null,
        sealedSession: 'encrypted-jwt',
        headers: {
          'Set-Cookie': 'new-session-cookie',
        },
      });
    });

    it('should refresh the session with organizationId', async () => {
      await refreshSession(createMockRequest(), { organizationId: 'org-456' });

      expect(authenticateWithRefreshToken).toHaveBeenCalledWith({
        clientId: expect.any(String),
        refreshToken: 'refresh.token',
        organizationId: 'org-456',
      });
    });

    it('should redirect to sign-in when no session exists', async () => {
      // Mock no session found
      unsealData.mockResolvedValue(null);

      try {
        await refreshSession(createMockRequest());
        fail('Expected redirect response to be thrown');
      } catch (response: unknown) {
        assertIsResponse(response);
        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toMatch(/^https:\/\/auth\.workos\.com\/oauth/);
      }
    });

    it('should throw error when refresh fails', async () => {
      // Mock refresh token failure
      authenticateWithRefreshToken.mockRejectedValue(new Error('Invalid refresh token'));

      await expect(refreshSession(createMockRequest())).rejects.toThrow(
        'Failed to refresh session: Invalid refresh token',
      );
    });
  });
});
