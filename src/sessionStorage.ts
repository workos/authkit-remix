import { createCookieSessionStorage, type SessionIdStorageStrategy, type SessionStorage } from '@remix-run/node';
import { getConfig, getRequiredConfig } from './config';

type SessionStorageConfig = { storage?: never; cookieName?: string } | { storage: SessionStorage; cookieName: string };

export const errors = {
  configureSessionStorage:
    'SessionStorage was never configured. Did you forget to call configureSessionStorage in your root loader? ' +
    'This typically means either:\n' +
    '1. Your root loader is not calling configureSessionStorage\n' +
    '2. A route loader is running before the root loader completes\n\n' +
    'Make sure configureSessionStorage is called in your root loader.',
  configAlreadyCalled: 'SessionStorage has already been configured.',
} as const;

export class SessionStorageManager {
  /**
   * The default cookie name used for storing the session id.
   */

  private storage: SessionStorage | null = null;
  private configPromise: Promise<void> | null = null;
  private cookieName: string = getConfig('cookieName') || 'wos-session';

  async configure(config: SessionStorageConfig = {}) {
    if (!this.configPromise) {
      this.configPromise = new Promise<void>((resolve) => {
        this.storage = this.createSessionStorage(config);
        resolve();
      });
    }

    return this.getSessionStorage();
  }

  /**
   * Returns the configured SessionStorage instance.
   * If no configuration has been set, this will throw an error.
   * @returns The configured SessionStorage instance, and the cookie name.
   */
  async getSessionStorage(): Promise<SessionStorage & { cookieName: string }> {
    this.configPromise && (await this.configPromise);
    const { storage, cookieName } = this;

    if (!storage || !cookieName) {
      throw new Error(errors.configureSessionStorage);
    }

    return { ...storage, cookieName };
  }

  private createSessionStorage({ storage, cookieName }: SessionStorageConfig): SessionStorage {
    if (cookieName) {
      this.cookieName = cookieName;
    }

    if (storage) {
      return storage;
    }

    const cookieOptions = {
      ...this.getDefaultCookieOptions(),
      ...(cookieName ? { name: cookieName } : {}),
    };

    return createCookieSessionStorage({
      cookie: cookieOptions,
    });
  }

  private getDefaultCookieOptions(): SessionIdStorageStrategy['cookie'] {
    const redirectUrl = new URL(getRequiredConfig('redirectUri'));
    const isSecureProtocol = redirectUrl.protocol === 'https:';
    // Defaults to 400 days, the maximum allowed by Chrome
    // It's fine to have a long cookie expiry date as the access/refresh tokens
    // act as the actual time-limited aspects of the session.
    const maxAge = getConfig('cookieMaxAge') ?? 60 * 60 * 24 * 400;

    return {
      name: this.cookieName,
      path: '/',
      httpOnly: true,
      secure: isSecureProtocol,
      sameSite: 'lax',
      maxAge,
      secrets: [getRequiredConfig('cookiePassword')],
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
export async function configureSessionStorage(config?: SessionStorageConfig) {
  return await sessionManager.configure(config);
}

/**
 * Returns the configured SessionStorage instance.
 * If no configuration has been set, this will throw an error.
 * @returns The configured SessionStorage instance, and the cookie name.
 */
export async function getSessionStorage() {
  return await sessionManager.getSessionStorage();
}
