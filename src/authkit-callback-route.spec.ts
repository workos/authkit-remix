import type { LoaderFunction } from '@remix-run/node';
import { workos as workosInstance } from '../src/workos.js';
import { authLoader } from './authkit-callback-route';

function assertIsResponse(response: unknown): asserts response is Response {
  expect(response).toBeInstanceOf(Response);
}

type SearchParamsModifier = Record<string, string> | ((params: URLSearchParams) => void);

function withSearchParams(request: Request, modifier: SearchParamsModifier): Request {
  const url = new URL(request.url);

  if (typeof modifier === 'function') {
    // Allow direct manipulation of searchParams
    modifier(url.searchParams);
  } else {
    // Simple key-value setting
    Object.entries(modifier).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  return new Request(url, request);
}

function createAuthWithCodeResponse(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: 'access123',
    refreshToken: 'refresh123',
    user: {
      id: 'user_123',
      email: 'test@example.com',
      emailVerified: true,
      profilePictureUrl: 'https://example.com/photo.jpg',
      firstName: 'Test',
      lastName: 'User',
      object: 'user' as const,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    //oauthTokens: {
    //  accessToken: 'access123',
    //  refreshToken: 'refresh123',
    //  expiresAt: 1719811200,
    //  scopes: ['foo', 'bar'],
    //},
    ...overrides,
  };
}

// Mock dependencies
jest.mock('../src/workos.js', () => ({
  workos: {
    userManagement: {
      authenticateWithCode: jest.fn(),
      getJwksUrl: jest.fn(() => 'https://api.workos.com/sso/jwks/client_1234567890'),
    },
  },
}));

describe('authLoader', () => {
  let loader: LoaderFunction;
  let request: Request;
  const workos = jest.mocked(workosInstance);

  beforeAll(() => {
    // Silence console.error during tests
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  beforeEach(async () => {
    jest.resetAllMocks();

    const mockAuthResponse = createAuthWithCodeResponse();
    workos.userManagement.authenticateWithCode.mockResolvedValue(mockAuthResponse);

    loader = authLoader();
    const url = new URL('http://example.com/callback');

    request = withSearchParams(new Request(url), {
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
      workos.userManagement.authenticateWithCode.mockRejectedValue(new Error('Auth failed'));
      request = withSearchParams(request, { code: 'invalid-code' });
      const response = (await loader({ request, params: {}, context: {} })) as Response;

      expect(response.status).toBe(500);
    });

    it('should handle authentication failure with string error', async () => {
      workos.userManagement.authenticateWithCode.mockRejectedValue('Auth failed');
      request = withSearchParams(request, { code: 'invalid-code' });
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
      request: withSearchParams(request, {
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
    workos.userManagement.authenticateWithCode.mockResolvedValue(
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
    workos.userManagement.authenticateWithCode.mockResolvedValue(
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
