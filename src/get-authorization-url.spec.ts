import { getAuthorizationUrl } from './get-authorization-url.js';
import { getConfig } from './config.js';

describe('getAuthorizationUrl', () => {
  it('should generate a valid WorkOS authorization URL', async () => {
    const url = await getAuthorizationUrl();

    expect(url).toMatch(/^https:\/\/api\.workos\.com\/user_management\/authorize\?/);
    expect(url).toContain(`client_id=${getConfig('clientId')}`);
    expect(url).toContain(`redirect_uri=${encodeURIComponent(getConfig('redirectUri'))}`);
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
