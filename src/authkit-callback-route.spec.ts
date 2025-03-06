import type { LoaderFunction } from 'react-router';
import { getWorkOS } from './workos.js';
import { authLoader } from './authkit-callback-route.js';
import {
  createRequestWithSearchParams,
  createAuthWithCodeResponse,
  assertIsResponse,
} from './test-utils/test-helpers.js';
import { configureSessionStorage } from './sessionStorage.js';

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
  let loader: LoaderFunction;
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
      const response = (await loader({ request, params: {}, context: {} })) as Response;

      expect(response.status).toBe(500);
    });

    it('should handle authentication failure with string error', async () => {
      authenticateWithCode.mockRejectedValue('Auth failed');
      request = createRequestWithSearchParams(request, { code: 'invalid-code' });
      const response = (await loader({ request, params: {}, context: {} })) as Response;

      expect(response.status).toBe(500);
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
});
