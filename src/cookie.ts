import { createCookieSessionStorage, type SessionIdStorageStrategy, type SessionStorage } from '@remix-run/node';
import { WORKOS_REDIRECT_URI, WORKOS_COOKIE_MAX_AGE, WORKOS_COOKIE_PASSWORD } from './env-variables.js';

interface SessionStorageConfig {
  storage?: SessionStorage;
  cookie?: SessionIdStorageStrategy['cookie'];
}

let sessionStorage: SessionStorage;
let cookieName: string;

const { promise, resolve } = Promise.withResolvers<SessionStorage>();

/**
 * The default cookie name used for storing the session id.
 */
export const DEFAULT_COOKIE_NAME = 'wos-session';

function getDefaultCookieOptions(): SessionIdStorageStrategy['cookie'] {
  const redirectUrl = new URL(WORKOS_REDIRECT_URI);
  const isSecureProtocol = redirectUrl.protocol === 'https:';
  return {
    name: DEFAULT_COOKIE_NAME,
    path: '/',
    httpOnly: true,
    secure: isSecureProtocol,
    sameSite: 'lax',
    // Defaults to 400 days, the maximum allowed by Chrome
    // It's fine to have a long cookie expiry date as the access/refresh tokens
    // act as the actual time-limited aspects of the session.
    maxAge: WORKOS_COOKIE_MAX_AGE ? parseInt(WORKOS_COOKIE_MAX_AGE, 10) : 60 * 60 * 24 * 400,
    secrets: [WORKOS_COOKIE_PASSWORD],
  };
}

function createSessionStorage({
  storage,
  cookie,
}: {
  storage?: SessionStorage;
  cookie?: SessionIdStorageStrategy['cookie'];
} = {}): SessionStorage {
  if (storage) {
    return storage;
  }

  const cookieOptions = {
    ...getDefaultCookieOptions(),
    ...cookie,
  };

  return createCookieSessionStorage({
    cookie: cookieOptions,
  });
}

/**
 * Returns the configured SessionStorage instance.
 * If no configuration has been set, this will return a new instance of
 * SessionStorage using the default cookie settings.
 * @param config - The configuration options for the SessionStorage instance.
 * @returns The configured SessionStorage instance.
 */
export function configureSessionStorage(config: SessionStorageConfig = {}) {
  sessionStorage = createSessionStorage(config);
  cookieName = config.cookie?.name ?? DEFAULT_COOKIE_NAME;
  resolve(sessionStorage);
  return sessionStorage;
}

/**
 * Returns the configured SessionStorage instance.
 * If no configuration has been set, this will throw an error.
 * @returns The configured SessionStorage instance, and the cookie name.
 */
export async function getSessionStorage() {
  const storage = await promise;
  return { ...storage, cookieName };
}
