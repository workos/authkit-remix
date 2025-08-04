import { User } from '@workos-inc/node';
import { getSignInUrl, getSignUpUrl, signOut, switchToOrganization, withAuth } from './auth.js';
import * as authorizationUrl from './get-authorization-url.js';
import * as session from './session.js';
import * as configModule from './config.js';
import { data, redirect, LoaderFunctionArgs } from '@remix-run/node';
import { assertIsResponse } from './test-utils/test-helpers.js';

const terminateSession = jest.mocked(session.terminateSession);
const refreshSession = jest.mocked(session.refreshSession);
const getSessionFromCookie = jest.mocked(session.getSessionFromCookie);
const getClaimsFromAccessToken = jest.mocked(session.getClaimsFromAccessToken);
const getConfig = jest.mocked(configModule.getConfig);

jest.mock('./session', () => ({
  terminateSession: jest.fn().mockResolvedValue(new Response()),
  refreshSession: jest.fn(),
  getSessionFromCookie: jest.fn(),
  getClaimsFromAccessToken: jest.fn(),
}));

jest.mock('./config', () => ({
  getConfig: jest.fn(),
}));

// Mock redirect and data from react-router
jest.mock('@remix-run/node', () => {
  const originalModule = jest.requireActual('@remix-run/node');
  return {
    ...originalModule,
    redirect: jest.fn().mockImplementation((to, init) => {
      const response = new Response(null, {
        status: 302,
        headers: { Location: to, ...(init?.headers || {}) },
      });
      return response;
    }),
    data: jest.fn().mockImplementation((value, init) => ({
      data: value,
      init,
    })),
  };
});

describe('auth', () => {
  beforeEach(() => {
    jest.spyOn(authorizationUrl, 'getAuthorizationUrl');
  });

  describe('getSignInUrl', () => {
    it('should return a URL', async () => {
      expect(await getSignInUrl('/test')).toMatch(/^https:\/\/api\.workos\.com/);
      expect(authorizationUrl.getAuthorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({ returnPathname: '/test', screenHint: 'sign-in' }),
      );
    });
  });

  describe('getSignUpUrl', () => {
    it('should return a URL', async () => {
      expect(await getSignUpUrl()).toMatch(/^https:\/\/api\.workos\.com/);
      expect(authorizationUrl.getAuthorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({ screenHint: 'sign-up' }),
      );
    });
  });

  describe('signOut', () => {
    it('should return a response', async () => {
      const request = new Request('https://example.com');
      const response = await signOut(request);
      expect(response).toBeInstanceOf(Response);
      expect(terminateSession).toHaveBeenCalledWith(request, undefined);
    });

    it('should return a response with returnTo', async () => {
      const request = new Request('https://example.com');
      const returnTo = '/dashboard';
      const response = await signOut(request, { returnTo });
      expect(response).toBeInstanceOf(Response);
      expect(terminateSession).toHaveBeenCalledWith(request, { returnTo });
    });
  });

  describe('switchToOrganization', () => {
    const request = new Request('https://example.com');
    const organizationId = 'org_123456';

    // Create a mock user that matches the User type
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      emailVerified: true,
      firstName: 'Test',
      lastName: 'User',
      profilePictureUrl: 'https://example.com/avatar.jpg',
      object: 'user',
      createdAt: '2021-01-01T00:00:00Z',
      updatedAt: '2021-01-01T00:00:00Z',
      lastSignInAt: '2021-01-01T00:00:00Z',
      externalId: null,
    } as User;

    // Mock the return type of refreshSession
    const mockAuthResponse = {
      user: mockUser,
      sessionId: 'session-123',
      accessToken: 'new-access-token',
      organizationId: 'org_123456' as string | undefined,
      role: 'admin' as string | undefined,
      permissions: ['read', 'write'] as string[] | undefined,
      entitlements: ['premium'] as string[] | undefined,
      impersonator: null,
      sealedSession: 'sealed-session-data',
      headers: {
        'Set-Cookie': 'new-cookie-value',
      },
    };

    beforeEach(() => {
      refreshSession.mockResolvedValue(mockAuthResponse);
    });

    it('should call refreshSession with the correct params', async () => {
      await switchToOrganization(request, organizationId);

      expect(refreshSession).toHaveBeenCalledWith(request, { organizationId });
    });

    it('should return data with success and auth when no returnTo is provided', async () => {
      const result = await switchToOrganization(request, organizationId);

      expect(data).toHaveBeenCalledWith(
        { success: true, auth: mockAuthResponse },
        {
          headers: {
            'Set-Cookie': 'new-cookie-value',
          },
        },
      );
      expect(result).toEqual({
        data: { success: true, auth: mockAuthResponse },
        init: {
          headers: {
            'Set-Cookie': 'new-cookie-value',
          },
        },
      });
    });

    it('should redirect to returnTo when provided', async () => {
      const returnTo = '/dashboard';
      const result = await switchToOrganization(request, organizationId, { returnTo });

      expect(redirect).toHaveBeenCalledWith(returnTo, {
        headers: {
          'Set-Cookie': 'new-cookie-value',
        },
      });

      assertIsResponse(result);
      expect(result.status).toBe(302);
      expect(result.headers.get('Location')).toBe(returnTo);
      expect(result.headers.get('Set-Cookie')).toBe('new-cookie-value');
    });

    it('should handle case when refreshSession throws a redirect', async () => {
      const redirectResponse = new Response(null, {
        status: 302,
        headers: { Location: '/login' },
      });
      refreshSession.mockRejectedValueOnce(redirectResponse);

      try {
        await switchToOrganization(request, organizationId);
        fail('Expected redirect response to be thrown');
      } catch (response) {
        assertIsResponse(response);
        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('/login');
      }
    });

    it('should redirect to authorization URL for SSO_required errors', async () => {
      const authUrl = 'https://api.workos.com/sso/authorize';
      const errorWithSSOCause = new Error('SSO Required', {
        cause: { error: 'sso_required' },
      });

      refreshSession.mockRejectedValueOnce(errorWithSSOCause);
      (authorizationUrl.getAuthorizationUrl as jest.Mock).mockResolvedValueOnce(authUrl);

      const result = await switchToOrganization(request, organizationId);

      expect(authorizationUrl.getAuthorizationUrl).toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith(authUrl);

      assertIsResponse(result);
      expect(result.status).toBe(302);
      expect(result.headers.get('Location')).toBe(authUrl);
    });

    it('should handle mfa_enrollment errors', async () => {
      const authUrl = 'https://api.workos.com/sso/authorize';
      const errorWithMFACause = new Error('MFA Enrollment Required', {
        cause: { error: 'mfa_enrollment' },
      });

      refreshSession.mockRejectedValueOnce(errorWithMFACause);
      (authorizationUrl.getAuthorizationUrl as jest.Mock).mockResolvedValueOnce(authUrl);

      const result = await switchToOrganization(request, organizationId);

      expect(authorizationUrl.getAuthorizationUrl).toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith(authUrl);

      assertIsResponse(result);
      expect(result.status).toBe(302);
      expect(result.headers.get('Location')).toBe(authUrl);
    });

    it('should return error data for Error instances', async () => {
      const error = new Error('Invalid organization');
      refreshSession.mockRejectedValueOnce(error);

      const result = await switchToOrganization(request, organizationId);

      expect(data).toHaveBeenCalledWith(
        {
          success: false,
          error: 'Invalid organization',
        },
        { status: 400 },
      );
      expect(result).toEqual({
        data: {
          success: false,
          error: 'Invalid organization',
        },
        init: { status: 400 },
      });
    });

    it('should return error data for non-Error objects', async () => {
      const error = 'String error message';
      refreshSession.mockRejectedValueOnce(error);

      await switchToOrganization(request, organizationId);

      expect(data).toHaveBeenCalledWith(
        {
          success: false,
          error: 'String error message',
        },
        { status: 400 },
      );
    });

    it('should handle when Set-Cookie header is missing', async () => {
      // Create a mock without the Set-Cookie header
      const mockResponseWithoutCookie = {
        ...mockAuthResponse,
        headers: {},
      };
      refreshSession.mockResolvedValueOnce(mockResponseWithoutCookie);

      await switchToOrganization(request, organizationId);

      expect(data).toHaveBeenCalledWith(
        { success: true, auth: mockResponseWithoutCookie },
        {
          headers: {
            'Set-Cookie': '',
          },
        },
      );
    });

    it('should handle when returnTo is provided but Set-Cookie header is missing', async () => {
      // Create a mock without the Set-Cookie header
      const mockResponseWithoutCookie = {
        ...mockAuthResponse,
        headers: {},
      };
      refreshSession.mockResolvedValueOnce(mockResponseWithoutCookie);

      await switchToOrganization(request, organizationId, { returnTo: '/dashboard' });

      expect(redirect).toHaveBeenCalledWith('/dashboard', {
        headers: {
          'Set-Cookie': '',
        },
      });
    });
  });

  describe('withAuth', () => {
    const createMockRequest = (cookie?: string) => {
      return {
        request: new Request('https://example.com', {
          headers: cookie ? { Cookie: cookie } : {},
        }),
      } as LoaderFunctionArgs;
    };

    beforeEach(() => {
      jest.clearAllMocks();
      getConfig.mockReturnValue('wos-session');
    });

    it('should return user info when a valid session exists', async () => {
      // Mock session with valid access token
      const mockSession = {
        accessToken: 'valid-access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-1',
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          emailVerified: true,
          profilePictureUrl: 'https://example.com/profile.jpg',
          object: 'user' as const,
          createdAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-01T00:00:00Z',
          lastSignInAt: '2023-01-01T00:00:00Z',
          externalId: null,
        },
        impersonator: {
          email: 'admin@example.com',
          reason: 'testing',
        },
        headers: {},
      };

      // Mock claims from access token
      const mockClaims = {
        sessionId: 'session-123',
        organizationId: 'org-456',
        role: 'admin',
        permissions: ['read', 'write'],
        entitlements: ['feature-1', 'feature-2'],
        exp: Date.now() / 1000 + 3600, // 1 hour from now
        iss: 'https://api.workos.com',
      };

      getSessionFromCookie.mockResolvedValue(mockSession);
      getClaimsFromAccessToken.mockReturnValue(mockClaims);

      const result = await withAuth(createMockRequest('wos-session=valid-session-data'));

      // Verify called with correct params
      expect(getSessionFromCookie).toHaveBeenCalledWith('wos-session=valid-session-data');
      expect(getClaimsFromAccessToken).toHaveBeenCalledWith('valid-access-token');

      // Check result contains expected user info
      expect(result).toEqual({
        user: mockSession.user,
        sessionId: mockClaims.sessionId,
        organizationId: mockClaims.organizationId,
        role: mockClaims.role,
        permissions: mockClaims.permissions,
        entitlements: mockClaims.entitlements,
        impersonator: mockSession.impersonator,
        accessToken: mockSession.accessToken,
      });
    });

    it('should handle expired access tokens', async () => {
      // Mock session with expired access token
      const mockSession = {
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-1',
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          emailVerified: true,
          profilePictureUrl: 'https://example.com/profile.jpg',
          object: 'user' as const,
          createdAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-01T00:00:00Z',
          lastSignInAt: '2023-01-01T00:00:00Z',
          externalId: null,
        },
        headers: {},
      };

      // Mock claims with expired token
      const mockClaims = {
        sessionId: 'session-123',
        organizationId: 'org-456',
        role: 'admin',
        permissions: ['read', 'write'],
        entitlements: ['feature-1', 'feature-2'],
        exp: Date.now() / 1000 - 3600, // 1 hour ago (expired)
        iss: 'https://api.workos.com',
      };

      getSessionFromCookie.mockResolvedValue(mockSession);
      getClaimsFromAccessToken.mockReturnValue(mockClaims);

      // Spy on console.warn
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = await withAuth(createMockRequest('wos-session=expired-session-data'));

      // Should warn about expired token
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[AuthKit] Access token expired. Ensure authkitLoader is used in a parent/root route to handle automatic token refresh.'
      );

      // Result should return null user when token is expired
      expect(result).toEqual({
        user: null,
      });

      consoleWarnSpy.mockRestore();
    });

    it('should return NoUserInfo when no session exists', async () => {
      // Mock no session
      getSessionFromCookie.mockResolvedValue(null);

      const result = await withAuth(createMockRequest());

      expect(result).toEqual({
        user: null,
      });

      // getClaimsFromAccessToken should not be called
      expect(getClaimsFromAccessToken).not.toHaveBeenCalled();
    });

    it('should return NoUserInfo when session exists but has no access token', async () => {
      // Mock session with no access token - we'll add a dummy accessToken that will be ignored
      getSessionFromCookie.mockResolvedValue({
        user: {
          id: 'user-1',
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          emailVerified: true,
          profilePictureUrl: 'https://example.com/profile.jpg',
          object: 'user' as const,
          createdAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-01T00:00:00Z',
          lastSignInAt: '2023-01-01T00:00:00Z',
          externalId: null,
        },
        refreshToken: 'refresh-token',
        headers: {},
        accessToken: '', // Empty string to meet type requirement but it will be treated as falsy
      });

      const result = await withAuth(createMockRequest('wos-session=invalid-session-data'));

      expect(result).toEqual({
        user: null,
      });

      // getClaimsFromAccessToken should not be called
      expect(getClaimsFromAccessToken).not.toHaveBeenCalled();
    });

    it('should warn when no cookie header includes the cookie name', async () => {
      // Spy on console.warn
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      getSessionFromCookie.mockResolvedValue(null);

      await withAuth(createMockRequest('other-cookie=value'));

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('No session cookie "wos-session" found.'));

      consoleWarnSpy.mockRestore();
    });
  });
});
