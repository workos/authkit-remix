import { createCookieSessionStorage, type SessionIdStorageStrategy, type SessionStorage } from '@remix-run/node';
import { WORKOS_REDIRECT_URI, WORKOS_COOKIE_MAX_AGE, WORKOS_COOKIE_PASSWORD } from './env-variables.js';

interface SessionStorageConfig {
  storage?: SessionStorage;
  cookie?: SessionIdStorageStrategy['cookie'];
}

export const errors = {
  configureSessionStorage:
    'SessionStorage was never configured. Did you forget to call configureSessionStorage in your root loader? ' +
    'This typically means either:\n' +
    '1. Your root loader is not calling configureSessionStorage\n' +
    '2. A route loader is running before the root loader completes\n\n' +
    'Make sure configureSessionStorage is called in your root loader.',
  configAlreadyCalled: 'SessionStorage has already been configured.',
} as const;

/**
 * A promise that can be resolved or rejected externally.
 * This is useful for creating a promise and resolving it later.
 * Note: Replace with `Promise.withResolvers` when upgrading to Node.js 22.
 * @template T - The type of the value that the promise will resolve to.
 * @returns An object containing the promise, and the resolve and reject functions.
 */
function createPromiseWithResolvers<T>() {
  let resolve: (value: T) => void;
  let reject: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve: resolve!, reject: reject! };
}

export class SessionStorageManager {
  /**
   * The default cookie name used for storing the session id.
   */
  static readonly DEFAULT_COOKIE_NAME = 'wos-session';

  private sessionStoragePromise: Promise<SessionStorage>;
  private cookieName: string = SessionStorageManager.DEFAULT_COOKIE_NAME;
  private resolveConfig: (storage: SessionStorage) => void;
  private isConfigured = false;

  constructor() {
    const { promise, resolve } = createPromiseWithResolvers<SessionStorage>();
    this.sessionStoragePromise = promise;
    this.resolveConfig = resolve;
  }

  configure(config: SessionStorageConfig = {}) {
    if (this.isConfigured) {
      throw new Error(errors.configAlreadyCalled);
    }

    const sessionStorage = this.createSessionStorage(config);
    this.cookieName = config.cookie?.name ?? SessionStorageManager.DEFAULT_COOKIE_NAME;
    this.isConfigured = true;
    this.resolveConfig(sessionStorage);
    return { ...sessionStorage, cookieName: this.cookieName };
  }

  /**
   * Returns the configured SessionStorage instance.
   * If no configuration has been set, this will throw an error.
   * @returns The configured SessionStorage instance, and the cookie name.
   */
  async getSessionStorage() {
    if (!this.isConfigured) {
      throw new Error(errors.configureSessionStorage);
    }

    const storage = await this.sessionStoragePromise;
    const { cookieName } = this;
    return { ...storage, cookieName };
  }

  private createSessionStorage({
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
      ...this.getDefaultCookieOptions(),
      ...cookie,
    };

    return createCookieSessionStorage({
      cookie: cookieOptions,
    });
  }

  private getDefaultCookieOptions(): SessionIdStorageStrategy['cookie'] {
    const redirectUrl = new URL(WORKOS_REDIRECT_URI);
    const isSecureProtocol = redirectUrl.protocol === 'https:';
    return {
      name: SessionStorageManager.DEFAULT_COOKIE_NAME,
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
}

const sessionManager = new SessionStorageManager();

/**
 * Returns the configured SessionStorage instance.
 * If no configuration has been set, this will return a new instance of
 * SessionStorage using the default cookie settings.
 * @param config - The configuration options for the SessionStorage instance.
 * @returns The configured SessionStorage instance.
 */
export function configureSessionStorage(config: SessionStorageConfig = {}) {
  return sessionManager.configure(config);
}

/**
 * Returns the configured SessionStorage instance.
 * If no configuration has been set, this will throw an error.
 * @returns The configured SessionStorage instance, and the cookie name.
 */
export async function getSessionStorage() {
  return await sessionManager.getSessionStorage();
}
