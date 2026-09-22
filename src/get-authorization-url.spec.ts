import { createHash } from 'node:crypto';
import { getAuthorizationUrl } from './get-authorization-url.js';
import { getConfig } from './config.js';
import { getPKCECookie, readPKCECookie } from './pkce.js';

async function startFlow(returnPathname?: string) {
  const result = await getAuthorizationUrl({ returnPathname });
  const params = new URL(result.url).searchParams;
  const state = params.get('state')!;
  const request = new Request('https://example.com/callback', {
    headers: { Cookie: result.headers['Set-Cookie'].split(';')[0] },
  });
  const payload = await readPKCECookie(request, state);
  return { ...result, params, state, payload, request };
}

describe('getAuthorizationUrl', () => {
  it('generates a valid authorization URL with S256 PKCE and a cookie-only verifier', async () => {
    const { url, params, state, payload, headers } = await startFlow();
    expect(url).toMatch(/^https:\/\/api\.workos\.com\/user_management\/authorize\?/);
    expect(params.get('client_id')).toBe(getConfig('clientId'));
    expect(params.get('redirect_uri')).toBe(getConfig('redirectUri'));
    expect(params.get('provider')).toBe('authkit');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(payload.nonce).toBe(state);
    expect(payload.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('code_challenge')).toBe(createHash('sha256').update(payload.codeVerifier).digest('base64url'));
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(url).not.toContain(payload.codeVerifier);
    expect(headers['Set-Cookie']).not.toContain(payload.codeVerifier);
    expect(headers['Set-Cookie']).toContain('HttpOnly');
    expect(headers['Set-Cookie']).toContain('SameSite=Lax');
    expect(headers['Set-Cookie']).toContain('Path=/');
    expect(headers['Set-Cookie']).toContain('Max-Age=600');
    expect(headers['Set-Cookie']).not.toContain('Domain=');
  });

  it('stores the return pathname in the encrypted cookie, not URL state', async () => {
    const { payload, url } = await startFlow('/dashboard?tab=billing');
    expect(payload.returnPathname).toBe('/dashboard?tab=billing');
    expect(url).not.toContain('dashboard');
  });

  it('sanitizes return pathnames before sealing', async () => {
    expect((await startFlow('https://evil.example')).payload.returnPathname).toBe('/');
  });

  it('creates independent cookies for concurrent flows', async () => {
    const first = await startFlow();
    const second = await startFlow();
    expect(first.state).not.toBe(second.state);
    expect(first.payload.codeVerifier).not.toBe(second.payload.codeVerifier);
    expect(getPKCECookie(first.state).name).not.toBe(getPKCECookie(second.state).name);
    const request = new Request(first.request, {
      headers: { Cookie: [first, second].map(({ headers }) => headers['Set-Cookie'].split(';')[0]).join('; ') },
    });
    expect(await readPKCECookie(request, first.state)).toEqual(first.payload);
    expect(await readPKCECookie(request, second.state)).toEqual(second.payload);
  });

  it.each([
    ['https://example.com/login', undefined, true],
    ['http://localhost:3000/login', undefined, false],
    ['http://internal/login', 'https', true],
    ['http://internal/login', 'https, http', true],
  ])('sets Secure for %s forwarded via %s', async (url, proto, secure) => {
    const request = new Request(url, { headers: proto ? { 'X-Forwarded-Proto': proto } : {} });
    const { headers } = await getAuthorizationUrl({ request });
    expect(headers['Set-Cookie'].includes('; Secure')).toBe(secure);
  });

  it('uses the redirect URI when there is no request', async () => {
    const { url, headers } = await getAuthorizationUrl({ redirectUri: 'https://example.com/callback' });
    expect(new URL(url).searchParams.get('redirect_uri')).toBe('https://example.com/callback');
    expect(headers['Set-Cookie']).toContain('; Secure');
  });

  it('includes screenHint when provided', async () => {
    const { url } = await getAuthorizationUrl({ screenHint: 'sign-up' });
    expect(url).toContain('screen_hint=sign-up');
  });
});
