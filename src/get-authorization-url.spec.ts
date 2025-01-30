import { getAuthorizationUrl } from './get-authorization-url.js';

describe('getAuthorizationUrl', () => {
  it('should generate a valid WorkOS authorization URL', async () => {
    const url = await getAuthorizationUrl();

    const redirectUri = process.env.WORKOS_REDIRECT_URI ?? 'http://localhost:5173/callback';

    expect(url).toMatch(/^https:\/\/api\.workos\.com\/user_management\/authorize\?/);
    expect(url).toContain(`client_id=${process.env.WORKOS_CLIENT_ID}`);
    expect(url).toContain(`redirect_uri=${encodeURIComponent(redirectUri)}`);
    expect(url).toContain('provider=authkit');
  });

  it('should include envoded state when returnPathname is provided', async () => {
    const returnPathname = '/dashboard';
    const url = await getAuthorizationUrl({ returnPathname });
    const expectedSstate = btoa(JSON.stringify({ returnPathname }));
    expect(url).toContain(`state=${encodeURIComponent(expectedSstate)}`);
  });

  it('should include screenHint when provided', async () => {
    const screenHint = 'sign-up';
    const url = await getAuthorizationUrl({ screenHint });
    expect(url).toContain(`screen_hint=${screenHint}`);
  });
});
