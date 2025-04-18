import { User } from '@workos-inc/node';
import { getSignInUrl, getSignUpUrl, signOut, switchToOrganization } from './auth.js';
import * as authorizationUrl from './get-authorization-url.js';
import * as session from './session.js';
import { data, redirect } from '@remix-run/node';
import { assertIsResponse } from './test-utils/test-helpers.js';

const terminateSession = jest.mocked(session.terminateSession);
const refreshSession = jest.mocked(session.refreshSession);

jest.mock('./session', () => ({
  terminateSession: jest.fn().mockResolvedValue(new Response()),
  refreshSession: jest.fn(),
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
      const response = await signOut(request, returnTo);
      expect(response).toBeInstanceOf(Response);
      expect(terminateSession).toHaveBeenCalledWith(request, returnTo);
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
});
