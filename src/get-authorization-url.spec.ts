import { createHash } from 'node:crypto';
import { getAuthorizationUrl } from './get-authorization-url.js';
import { getConfig } from './config.js';
import { getPKCECookie, readPKCECookie } from './pkce.js';

async function startFlow(returnPathname?: string, initiationRequest?: Request) {
  const result = await getAuthorizationUrl({ returnPathname, request: initiationRequest });
  const params = new URL(result.url).searchParams;
  const state = params.get('state')!;
  const request = new Request('https://example.com/callback', {
    headers: { Cookie: result.headers.getSetCookie()[0].split(';')[0] },
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
    expect(headers.get('Set-Cookie')).not.toContain(payload.codeVerifier);
    expect(headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(headers.get('Set-Cookie')).toContain('SameSite=Lax');
    expect(headers.get('Set-Cookie')).toContain('Path=/');
    expect(headers.get('Set-Cookie')).toContain('Max-Age=600');
    expect(headers.get('Set-Cookie')).not.toContain('Domain=');
  });

  it('stores the return pathname in the encrypted cookie, not URL state', async () => {
    const { payload, url } = await startFlow('/dashboard?tab=billing');
    expect(payload.returnPathname).toBe('/dashboard?tab=billing');
    expect(url).not.toContain('dashboard');
  });

  it.each(['/' + 'a'.repeat(2047), '/' + 'a'.repeat(1022), '/?q=' + '\\'.repeat(700)])(
    'omits oversized return paths without exceeding the browser cookie limit',
    async (returnPathname) => {
      const { headers, payload } = await startFlow(returnPathname);
      expect(Buffer.byteLength(new Headers(headers).get('Set-Cookie')!, 'utf8')).toBeLessThan(4096);
      expect(payload.returnPathname).toBeUndefined();
    },
  );

  it('keeps a return path at the serialized payload limit', async () => {
    const returnPathname = '/' + 'a'.repeat(1021);
    const { headers, payload } = await startFlow(returnPathname);
    expect(payload.returnPathname).toBe(returnPathname);
    expect(Buffer.byteLength(new Headers(headers).get('Set-Cookie')!, 'utf8')).toBeLessThan(4096);
  });

  it('bounds abandoned flows without deleting the session or unrelated cookies', async () => {
    const cookies = new Map([
      ['wos-session', 's'.repeat(2500)],
      ['theme', 'dark'],
    ]);
    for (let i = 0; i < 30; i++) {
      const request = new Request('https://example.com/sign-in', {
        headers: { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') },
      });
      const result = await getAuthorizationUrl({ request, returnPathname: '/' + 'a'.repeat(1021) });
      for (const cookie of result.headers.getSetCookie()) {
        expect(Buffer.byteLength(cookie, 'utf8')).toBeLessThan(4096);
        const [pair] = cookie.split(';');
        const separator = pair.indexOf('=');
        const name = pair.slice(0, separator);
        if (cookie.includes('Max-Age=0')) cookies.delete(name);
        else cookies.set(name, pair.slice(separator + 1));
      }
      expect([...cookies.keys()].filter((name) => name.startsWith('wos-auth-verifier-')).length).toBeLessThanOrEqual(5);
      const cookieHeader = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
      expect(Buffer.byteLength(cookieHeader, 'utf8')).toBeLessThan(16 * 1024);
      expect(cookies.get('wos-session')).toBe('s'.repeat(2500));
      expect(cookies.get('theme')).toBe('dark');
      const state = new URL(result.url).searchParams.get('state')!;
      expect(await readPKCECookie(new Request(request, { headers: { Cookie: cookieHeader } }), state)).toEqual(
        expect.objectContaining({ nonce: state }),
      );
    }
  });

  it.each([4, 5, 8])('prunes only owned flow cookies at the threshold (%s existing)', async (count) => {
    const names = Array.from({ length: count }, (_, i) => `wos-auth-verifier-${i.toString(16).padStart(32, '0')}`);
    const request = new Request('https://example.com/sign-in', {
      headers: {
        Cookie: [...names.map((name) => `${name}=sealed`), 'wos-auth-verifier-preference=keep'].join('; '),
      },
    });

    const { headers } = await getAuthorizationUrl({ request });
    const cookies = headers.getSetCookie();
    expect(cookies.slice(0, -1)).toEqual(count >= 5 ? names.map((name) => `${name}=; Path=/; Max-Age=0`) : []);
    expect(cookies[cookies.length - 1]).toContain('Max-Age=600');
  });

  it('sanitizes return pathnames before sealing', async () => {
    expect((await startFlow('https://evil.example')).payload.returnPathname).toBe('/');
  });

  it('creates independent cookies for concurrent flows', async () => {
    const first = await startFlow();
    const second = await startFlow(undefined, first.request);
    expect(second.headers.getSetCookie()).toHaveLength(1);
    expect(first.state).not.toBe(second.state);
    expect(first.payload.codeVerifier).not.toBe(second.payload.codeVerifier);
    expect(getPKCECookie(first.state).name).not.toBe(getPKCECookie(second.state).name);
    const request = new Request(first.request, {
      headers: { Cookie: [first, second].map(({ headers }) => headers.getSetCookie()[0].split(';')[0]).join('; ') },
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
    expect(headers.get('Set-Cookie')!.includes('; Secure')).toBe(secure);
  });

  it('uses the redirect URI when there is no request', async () => {
    const { url, headers } = await getAuthorizationUrl({ redirectUri: 'https://example.com/callback' });
    expect(new URL(url).searchParams.get('redirect_uri')).toBe('https://example.com/callback');
    expect(headers.get('Set-Cookie')).toContain('; Secure');
  });

  it('includes screenHint when provided', async () => {
    const { url } = await getAuthorizationUrl({ screenHint: 'sign-up' });
    expect(url).toContain('screen_hint=sign-up');
  });
});
