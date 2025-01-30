import { LoaderFunctionArgs, Session as RemixSession, redirect } from '@remix-run/node';
import * as ironSession from 'iron-session';
import * as cookie from './cookie.js';
import { WORKOS_COOKIE_PASSWORD } from './env-variables.js';
import { Session } from './interfaces.js';
import { encryptSession, terminateSession, authkitLoader } from './session.js';
import { workos } from './workos.js';
import * as jose from 'jose';
import { AuthenticationResponse } from '@workos-inc/node';
import { assertIsResponse } from './test-utils/test-helpers.js';

const getSession = jest.mocked(cookie.getSession);
const destroySession = jest.mocked(cookie.destroySession);
const unsealData = jest.mocked(ironSession.unsealData);
const sealData = jest.mocked(ironSession.sealData);
const getLogoutUrl = jest.mocked(workos.userManagement.getLogoutUrl);
const authenticateWithRefreshToken = jest.mocked(workos.userManagement.authenticateWithRefreshToken);
const jwtVerify = jest.mocked(jose.jwtVerify);

jest.mock('./cookie', () => ({
  getSession: jest.fn(),
  destroySession: jest.fn().mockResolvedValue('destroyed-session-cookie'),
  commitSession: jest.fn(),
}));

jest.mock('./workos.js', () => ({
  workos: {
    userManagement: {
      getAuthorizationUrl: jest.fn().mockResolvedValue('https://auth.workos.com/oauth/authorize'),
      getLogoutUrl: jest.fn(({ sessionId }) => `https://auth.workos.com/logout/${sessionId}`),
      getJwksUrl: jest.fn((clientId: string) => `https://auth.workos.com/oauth/jwks/${clientId}`),
      authenticateWithRefreshToken: jest.fn(),
    },
  },
}));

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
  const createMockSession = (overrides?: Record<string, any>): RemixSession =>
    ({
      has: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      unset: jest.fn(),
      flash: jest.fn(),
      id: 'test-session-id',
      data: {},
      ...overrides,
    }) satisfies RemixSession;

  const createMockRequest = (cookie = 'test-cookie', url = 'http://example.com./some-path') =>
    new Request(url, {
      headers: new Headers({
        Cookie: cookie,
      }),
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
          createdAt: '2021-01-01T00:00:00Z',
          updatedAt: '2021-01-01T00:00:00Z',
        },
        impersonator: undefined,
        headers: {},
      } satisfies Session;

      sealData.mockResolvedValueOnce('encrypted-data');

      const result = await encryptSession(mockSession);

      expect(result).toBe('encrypted-data');
      expect(sealData).toHaveBeenCalledWith(mockSession, {
        password: WORKOS_COOKIE_PASSWORD,
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

      // Assert response is instance of Remix Response
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
        const response = await authkitLoader(createLoaderArgs(createMockRequest()));
        const data = await response.json();

        expect(data).toEqual({
          user: null,
          accessToken: null,
          impersonator: null,
          organizationId: null,
          permissions: null,
          entitlements: null,
          role: null,
          sessionId: null,
          sealedSession: null,
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

        const response = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('/dashboard');
        expect(response.headers.get('X-Redirect-Reason')).toBe('test');
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

      it('should return authorized data with session claims', async () => {
        const response = await authkitLoader(createLoaderArgs(createMockRequest()));
        const data = await response.json();

        expect(data).toEqual({
          user: mockSessionData.user,
          accessToken: mockSessionData.accessToken,
          impersonator: null,
          organizationId: 'org-123',
          permissions: ['read', 'write'],
          entitlements: ['premium'],
          role: 'admin',
          sessionId: 'test-session-id',
          sealedSession: 'encrypted-jwt',
        });
      });

      it('should handle custom loader data', async () => {
        const customLoader = jest.fn().mockReturnValue({
          customData: 'test-value',
          metadata: { key: 'value' },
        });

        const response = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);
        const data = await response.json();

        expect(data).toEqual(
          expect.objectContaining({
            customData: 'test-value',
            metadata: { key: 'value' },
            user: mockSessionData.user,
            accessToken: mockSessionData.accessToken,
            sessionId: 'test-session-id',
          }),
        );
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

        const response = await authkitLoader(createLoaderArgs(createMockRequest()), customLoader);

        expect(response.headers.get('Custom-Header')).toBe('test-header');
        expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');

        const data = await response.json();
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
        (cookie.commitSession as jest.Mock).mockResolvedValue('new-session-cookie');

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
        const response = await authkitLoader(createLoaderArgs(createMockRequest()));
        const data = await response.json();

        // Verify the refresh token flow was triggered
        expect(authenticateWithRefreshToken).toHaveBeenCalledWith({
          clientId: expect.any(String),
          refreshToken: 'refresh.token',
        });

        // Verify the response contains the new token data
        expect(data).toEqual(
          expect.objectContaining({
            accessToken: 'new.valid.token',
            sessionId: 'new-session-id',
            organizationId: 'org-123',
            role: 'user',
            permissions: ['read'],
            entitlements: ['basic'],
          }),
        );

        // Verify cookie was set
        expect(response.headers.get('Set-Cookie')).toBe('new-session-cookie');
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
    });
  });
});
