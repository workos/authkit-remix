import { createHash, randomBytes } from 'node:crypto';
import { sealData } from 'iron-session';
import type { GetAuthURLResult } from './interfaces.js';
import { getPKCECookie, PKCE_COOKIE_MAX_AGE, type PKCEPayload } from './pkce.js';
import { sanitizeReturnPathname } from './return-pathname.js';
import { getConfig } from './config.js';
import { getWorkOS } from './workos.js';

interface GetAuthURLOptions {
  screenHint?: 'sign-up' | 'sign-in';
  returnPathname?: string;
  organizationId?: string;
  redirectUri?: string;
  loginHint?: string;
  request?: Request;
}

export async function getAuthorizationUrl(options: GetAuthURLOptions = {}): Promise<GetAuthURLResult> {
  const { returnPathname, screenHint, organizationId, redirectUri, loginHint, request } = options;
  const nonce = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  // The URL carries only a nonce. The verifier must never travel in URL state,
  // even encrypted: a leaked callback URL must not be reusable as its cookie.
  const sealedVerifier = await sealData(
    {
      nonce,
      codeVerifier,
      ...(returnPathname !== undefined ? { returnPathname: sanitizeReturnPathname(returnPathname) } : {}),
    } satisfies PKCEPayload,
    { password: getConfig('cookiePassword'), ttl: PKCE_COOKIE_MAX_AGE },
  );

  const url = getWorkOS().userManagement.getAuthorizationUrl({
    provider: 'authkit',
    clientId: getConfig('clientId'),
    redirectUri: redirectUri || getConfig('redirectUri'),
    state: nonce,
    codeChallenge,
    codeChallengeMethod: 'S256',
    screenHint,
    organizationId,
    loginHint,
  });

  return {
    url,
    headers: { 'Set-Cookie': await getPKCECookie(nonce, request, redirectUri).serialize(sealedVerifier) },
  };
}
