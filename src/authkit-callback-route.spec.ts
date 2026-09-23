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

import { getAuthorizationUrl } from './get-authorization-url.js';
import { getPKCECookie, readPKCECookie } from './pkce.js';
import { sealData } from 'iron-session';
import { getConfig } from './config.js';

async function createCallbackRequest(url = 'http://example.com/callback', returnPathname?: string) {
  const { url: authUrl, headers } = await getAuthorizationUrl({ returnPathname, request: new Request(url) });
  const state = new URL(authUrl).searchParams.get('state')!;
  return createRequestWithSearchParams(
    new Request(url, { headers: { Cookie: headers.getSetCookie()[0].split(';')[0] } }),
    {
      code: 'test-code',
      state,
    },
  );
}

describe('authLoader', () => {
  let loader: ReturnType<typeof authLoader>;
  let request: Request;
  const workos = getWorkOS();
  const authenticateWithCode = jest.spyOn(workos.userManagement, 'authenticateWithCode');

  beforeAll(() => {
    // Silence console.error during tests
    jest.spyOn(console, 'error').mockImplementation(() => {});
    configureSessionStorage();
  });

  beforeEach(async () => {
    authenticateWithCode.mockClear();
    const mockAuthResponse = createAuthWithCodeResponse();
    authenticateWithCode.mockResolvedValue(mockAuthResponse);

    loader = authLoader();
    request = await createCallbackRequest();
  });

  describe('error handling', () => {
    it('rejects an attacker-supplied code without browser-bound state before exchanging it', async () => {
      authenticateWithCode.mockClear();
      const response = await loader({
        request: new Request('https://example.com/callback?code=attacker-code'),
        params: {},
        context: {},
      });

      expect(authenticateWithCode).not.toHaveBeenCalled();
      expect((response as DataWithResponseInit<unknown>).init?.status).toBe(500);
    });

    it.each([
      'missing-cookie',
      'wrong-flow',
      'tampered-cookie',
      'url-as-cookie',
      'legacy-state',
      'malformed-state',
      'expired-cookie',
      'invalid-payload',
    ])('rejects %s before exchanging a code or issuing a session', async (scenario) => {
      const url = new URL(request.url);
      const state = url.searchParams.get('state')!;
      if (scenario === 'missing-cookie') request.headers.delete('Cookie');
      if (scenario === 'wrong-flow') {
        const other = await createCallbackRequest();
        const otherState = new URL(other.url).searchParams.get('state')!;
        const otherValue = await getPKCECookie(otherState).parse(other.headers.get('Cookie'));
        request.headers.set('Cookie', (await getPKCECookie(state).serialize(otherValue)).split(';')[0]);
      }
      if (scenario === 'tampered-cookie' || scenario === 'url-as-cookie') {
        request.headers.set(
          'Cookie',
          (await getPKCECookie(state).serialize(scenario === 'url-as-cookie' ? state : 'tampered')).split(';')[0],
        );
      }
      if (scenario === 'legacy-state' || scenario === 'malformed-state') {
        request = createRequestWithSearchParams(request, {
          state: scenario === 'legacy-state' ? btoa(JSON.stringify({ returnPathname: '/billing' })) : '!not-base64',
        });
      }
      if (scenario === 'invalid-payload') {
        const invalid = await sealData({ nonce: state }, { password: getConfig('cookiePassword'), ttl: 600 });
        request.headers.set('Cookie', (await getPKCECookie(state).serialize(invalid)).split(';')[0]);
      }
      const clock =
        scenario === 'expired-cookie' ? jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 700_000) : undefined;
      try {
        const response = (await loader({ request, params: {}, context: {} })) as DataWithResponseInit<unknown>;
        expect(authenticateWithCode).not.toHaveBeenCalled();
        expect(response.init?.status).toBe(500);
        const cookies = new Headers(response.init?.headers).get('Set-Cookie');
        expect(cookies).toContain('Max-Age=0');
        expect(cookies).not.toContain('wos-session=');
      } finally {
        clock?.mockRestore();
      }
    });

    it('clears the flow cookie when authorization is canceled', async () => {
      request = createRequestWithSearchParams(request, (params) => {
        params.delete('code');
        params.set('error', 'access_denied');
      });
      const response = await loader({ request, params: {}, context: {} });
      assertIsResponse(response);
      expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
      expect(authenticateWithCode).not.toHaveBeenCalled();
    });

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
      codeVerifier: (await readPKCECookie(request, new URL(request.url).searchParams.get('state')!)).codeVerifier,
    });

    assertIsResponse(response);
    expect(response.status).toBe(302);
    expect(response.headers.get('Set-Cookie')).toContain('wos-session=');
    expect(response.headers.get('Set-Cookie')).toContain('wos-auth-verifier-');
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
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

  it('uses the configured default when the requested return path is too large for a cookie', async () => {
    loader = authLoader({ returnPathname: '/dashboard' });
    const response = await loader({
      request: await createCallbackRequest('http://example.com/callback', '/' + 'a'.repeat(2047)),
      params: {},
      context: {},
    });

    assertIsResponse(response);
    expect(response.headers.get('Location')).toBe('http://example.com/dashboard');
    expect(authenticateWithCode).toHaveBeenCalledTimes(1);
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
      request: await createCallbackRequest('http://example.com/callback', '/profile'),
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
      const request = await createCallbackRequest();

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
      const request = await createCallbackRequest('http://example.com:3000/callback');

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
