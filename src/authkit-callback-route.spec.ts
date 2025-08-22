import { getWorkOS } from './workos.js';
import { authLoader } from './authkit-callback-route.js';
import {
  createRequestWithSearchParams,
  createAuthWithCodeResponse,
  assertIsResponse,
} from './test-utils/test-helpers.js';
import { configureSessionStorage } from './sessionStorage.js';
import { isDataWithResponseInit } from './utils.js';
import { DataWithResponseInit } from './interfaces.js';

// Mock dependencies
const fakeWorkosInstance = {
  userManagement: {
    authenticateWithCode: jest.fn(),
    getJwksUrl: jest.fn(() => 'https://api.workos.com/sso/jwks/client_1234567890'),
  },
};

jest.mock('./workos.js', () => ({
  getWorkOS: jest.fn(() => fakeWorkosInstance),
}));

describe('authLoader', () => {
  let loader: ReturnType<typeof authLoader>;
  let request: Request;
  const workos = getWorkOS();
  const authenticateWithCode = jest.mocked(workos.userManagement.authenticateWithCode);

  beforeAll(() => {
    // Silence console.error during tests
    jest.spyOn(console, 'error').mockImplementation(() => {});
    configureSessionStorage();
  });

  beforeEach(async () => {
    const mockAuthResponse = createAuthWithCodeResponse();
    authenticateWithCode.mockResolvedValue(mockAuthResponse);

    loader = authLoader();
    const url = new URL('http://example.com/callback');

    request = createRequestWithSearchParams(new Request(url), {
      code: 'test-code',
    });
  });

  describe('error handling', () => {
    it('returns undefined if there is no code', async () => {
      const response = await loader({
        request: new Request('https://example.com'),
        params: {},
        context: {},
      });

      expect(response).toBeUndefined();
    });

    it('should handle authentication failure', async () => {
      authenticateWithCode.mockRejectedValue(new Error('Auth failed'));
      request = createRequestWithSearchParams(request, { code: 'invalid-code' });
      const response = (await loader({ request, params: {}, context: {} })) as DataWithResponseInit<unknown>;
      expect(isDataWithResponseInit(response)).toBeTruthy();

      expect(response?.init?.status).toBe(500);
    });

    it('should handle authentication failure with string error', async () => {
      authenticateWithCode.mockRejectedValue('Auth failed');
      request = createRequestWithSearchParams(request, { code: 'invalid-code' });
      const response = (await loader({ request, params: {}, context: {} })) as DataWithResponseInit<unknown>;
      expect(isDataWithResponseInit(response)).toBeTruthy();

      expect(response?.init?.status).toBe(500);
    });
  });

  it('returns a response when a code is present', async () => {
    const response = await loader({
      request,
      params: {},
      context: {},
    });

    expect(workos.userManagement.authenticateWithCode).toHaveBeenCalledWith({
      clientId: process.env.WORKOS_CLIENT_ID,
      code: 'test-code',
    });

    assertIsResponse(response);
    expect(response.status).toBe(302);
    expect(response.headers.get('Set-Cookie')).toBeDefined();
  });

  it('should redirect to the returnPathname', async () => {
    loader = authLoader({ returnPathname: '/dashboard' });
    const response = await loader({
      request,
      params: {},
      context: {},
    });

    assertIsResponse(response);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('http://example.com/dashboard');
  });

  it('copies search params from returnPathname', async () => {
    loader = authLoader({ returnPathname: '/dashboard?foo=bar' });
    const response = await loader({
      request,
      params: {},
      context: {},
    });

    assertIsResponse(response);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('http://example.com/dashboard?foo=bar');
  });

  it('handles calling onSuccess when provided', async () => {
    const onSuccess = jest.fn();
    loader = authLoader({ onSuccess });
    await loader({
      request,
      params: {},
      context: {},
    });

    expect(onSuccess).toHaveBeenCalled();
  });

  it('uses returnPathname from state when provided', async () => {
    const response = await loader({
      request: createRequestWithSearchParams(request, {
        state: btoa(JSON.stringify({ returnPathname: '/profile' })),
      }),
      params: {},
      context: {},
    });
    assertIsResponse(response);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('http://example.com/profile');
  });

  it('provides impersonator to onSuccess callback when provided', async () => {
    const onSuccess = jest.fn();
    authenticateWithCode.mockResolvedValue(
      createAuthWithCodeResponse({
        impersonator: {
          email: 'test@example.com',
        },
      }),
    );

    loader = authLoader({ onSuccess });

    await loader({
      request,
      params: {},
      context: {},
    });

    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ impersonator: { email: 'test@example.com' } }));
  });

  it('provides oauthTokens to onSuccess callback when provided', async () => {
    const onSuccess = jest.fn();
    authenticateWithCode.mockResolvedValue(
      createAuthWithCodeResponse({
        oauthTokens: {
          accessToken: 'access123',
          refreshToken: 'refresh123',
          expiresAt: 1719811200,
          scopes: ['foo', 'bar'],
        },
      }),
    );

    loader = authLoader({ onSuccess });

    await loader({
      request,
      params: {},
      context: {},
    });

    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthTokens: expect.objectContaining({ accessToken: 'access123' }),
      }),
    );
  });

  it('fixes protocol mismatch for load balancer TLS termination', async () => {
    // Set WORKOS_REDIRECT_URI to HTTPS (as configured for production)
    const originalRedirectUri = process.env.WORKOS_REDIRECT_URI;
    process.env.WORKOS_REDIRECT_URI = 'https://example.com/callback';

    try {
      const request = createRequestWithSearchParams(new Request('http://example.com/callback'), {
        code: 'test-code-123',
      });

      const loader = authLoader();
      const response = await loader({
        request,
        params: {},
        context: {},
      });

      // Should be a redirect response
      assertIsResponse(response);
      expect(response.status).toBe(302);

      // The redirect URL should be fixed to HTTPS (not HTTP)
      const location = response.headers.get('Location');
      expect(location).toBe('https://example.com/');
      expect(new URL(location!).protocol).toBe('https:');
    } finally {
      // Restore original env var
      if (originalRedirectUri) {
        process.env.WORKOS_REDIRECT_URI = originalRedirectUri;
      } else {
        delete process.env.WORKOS_REDIRECT_URI;
      }
    }
  });

  it('preserves port from request URL when fixing protocol mismatch', async () => {
    // Set WORKOS_REDIRECT_URI to HTTPS with different port
    const originalRedirectUri = process.env.WORKOS_REDIRECT_URI;
    process.env.WORKOS_REDIRECT_URI = 'https://example.com:8443/callback';

    try {
      const request = createRequestWithSearchParams(new Request('http://example.com:3000/callback'), {
        code: 'test-code-123',
      });

      const loader = authLoader();
      const response = await loader({
        request,
        params: {},
        context: {},
      });

      // Should be a redirect response
      assertIsResponse(response);
      expect(response.status).toBe(302);

      // The redirect URL should use HTTPS but preserve the request port (3000)
      // This documents current behavior - may need adjustment if port should come from config
      const location = response.headers.get('Location');
      expect(location).toBe('https://example.com:3000/');
      expect(new URL(location!).port).toBe('3000');
    } finally {
      // Restore original env var
      if (originalRedirectUri) {
        process.env.WORKOS_REDIRECT_URI = originalRedirectUri;
      } else {
        delete process.env.WORKOS_REDIRECT_URI;
      }
    }
  });
});
