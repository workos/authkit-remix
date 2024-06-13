import {
  WORKOS_REDIRECT_URI,
  WORKOS_COOKIE_MAX_AGE,
  WORKOS_COOKIE_PASSWORD,
} from './env-variables.js';
import { createCookieSessionStorage } from '@remix-run/node';

const redirectUrl = new URL(WORKOS_REDIRECT_URI);
const isSecureProtocol = redirectUrl.protocol === 'https:';

const cookieName = 'wos-session';
const cookieOptions = {
  path: '/',
  httpOnly: true,
  secure: isSecureProtocol,
  sameSite: 'lax' as const,
  // Defaults to 400 days, the maximum allowed by Chrome
  // It's fine to have a long cookie expiry date as the access/refresh tokens
  // act as the actual time-limited aspects of the session.
  maxAge: WORKOS_COOKIE_MAX_AGE
    ? parseInt(WORKOS_COOKIE_MAX_AGE, 10)
    : 60 * 60 * 24 * 400,
  secrets: [WORKOS_COOKIE_PASSWORD],
};
const { getSession, commitSession, destroySession } =
  createCookieSessionStorage({
    cookie: {
      name: cookieName,
      ...cookieOptions,
    },
  });

export { cookieName, getSession, commitSession, destroySession };
