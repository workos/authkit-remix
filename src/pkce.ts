import { createHash } from 'node:crypto';
import { createCookie } from '@remix-run/node';
import { unsealData } from 'iron-session';
import { getConfig } from './config.js';

export const PKCE_COOKIE_MAX_AGE = 600;

export function getPKCECookie(state: string, request?: Request, redirectUri?: string) {
  // Separate cookies allow sign-in/sign-up links and concurrent tabs to coexist.
  const suffix = createHash('sha256').update(state).digest('hex').slice(0, 32);
  const forwardedProto = request?.headers.get('X-Forwarded-Proto')?.split(',')[0].trim().toLowerCase();
  const protocol = forwardedProto ?? new URL(request?.url ?? redirectUri ?? getConfig('redirectUri')).protocol;

  return createCookie(`wos-auth-verifier-${suffix}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: protocol === 'https:' || protocol === 'https',
    path: '/',
    maxAge: PKCE_COOKIE_MAX_AGE,
  });
}

export interface PKCEPayload {
  nonce: string;
  codeVerifier: string;
  returnPathname?: string;
}

export async function readPKCECookie(request: Request, state: string): Promise<PKCEPayload> {
  const sealed = await getPKCECookie(state, request).parse(request.headers.get('Cookie'));
  if (typeof sealed !== 'string' || !sealed) {
    throw new Error('Missing auth cookie. Forward the headers returned by getSignInUrl/getSignUpUrl.');
  }

  const payload = await unsealData<unknown>(sealed, { password: getConfig('cookiePassword') });
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('nonce' in payload) ||
    payload.nonce !== state ||
    !('codeVerifier' in payload) ||
    typeof payload.codeVerifier !== 'string' ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(payload.codeVerifier) ||
    ('returnPathname' in payload && typeof payload.returnPathname !== 'string')
  ) {
    throw new Error('Invalid or expired auth cookie / OAuth state mismatch');
  }

  return payload as PKCEPayload;
}
