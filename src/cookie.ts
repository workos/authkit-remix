import { createCookieSessionStorage } from '@remix-run/node';
import { getEnvVariable, getOptionalEnvVariable } from './env-variables.js';

const redirectUrl = new URL(getEnvVariable('WORKOS_REDIRECT_URI'));
const isSecureProtocol = redirectUrl.protocol === 'https:';
const maxAgeEnv = getOptionalEnvVariable('WORKOS_COOKIE_MAX_AGE');

// Defaults to 400 days, the maximum allowed by Chrome
// It's fine to have a long cookie expiry date as the access/refresh tokens
// act as the actual time-limited aspects of the session.
const maxAge = maxAgeEnv ? parseInt(maxAgeEnv, 10) : 60 * 60 * 24 * 400;

const cookieName = 'wos-session';
const cookieOptions = {
  path: '/',
  httpOnly: true,
  secure: isSecureProtocol,
  sameSite: 'lax' as const,
  maxAge,
  secrets: [getEnvVariable('WORKOS_COOKIE_PASSWORD')],
};
const { getSession, commitSession, destroySession } = createCookieSessionStorage({
  cookie: {
    name: cookieName,
    ...cookieOptions,
  },
});

export { commitSession, cookieName, destroySession, getSession };
