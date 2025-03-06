import type { SessionStorage, SessionIdStorageStrategy } from 'react-router';
import type { OauthTokens, User } from '@workos-inc/node';

export interface HandleAuthOptions {
  returnPathname?: string;
  onSuccess?: (data: AuthLoaderSuccessData) => void | Promise<void>;
}

export interface AuthLoaderSuccessData {
  accessToken: string;
  impersonator: Impersonator | null;
  oauthTokens: OauthTokens | null;
  refreshToken: string;
  user: User;
}

export interface Impersonator {
  email: string;
  reason: string | null;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: User;
  impersonator?: Impersonator;
  headers: Record<string, string>;
}

export interface AccessToken {
  sid: string;
  org_id?: string;
  role?: string;
  permissions?: string[];
  entitlements?: string[];
}

export interface GetAuthURLOptions {
  screenHint?: 'sign-up' | 'sign-in';
  returnPathname?: string;
}

export type AuthKitLoaderOptions = {
  ensureSignedIn?: boolean;
  debug?: boolean;
} & (
  | {
      storage?: never;
      cookie?: SessionIdStorageStrategy['cookie'];
    }
  | {
      storage: SessionStorage;
      cookie: SessionIdStorageStrategy['cookie'];
    }
);

export interface AuthorizedData {
  user: User;
  sessionId: string;
  accessToken: string;
  organizationId: string | null;
  role: string | null;
  permissions: string[];
  entitlements: string[];
  impersonator: Impersonator | null;
  sealedSession: string;
}

export interface UnauthorizedData {
  user: null;
  sessionId: null;
  accessToken: null;
  organizationId: null;
  role: null;
  permissions: null;
  entitlements: null;
  impersonator: null;
  sealedSession: null;
}

/**
 * AuthKit Configuration Options
 */
export interface AuthKitConfig {
  /**
   * The WorkOS Client ID
   * Equivalent to the WORKOS_CLIENT_ID environment variable
   */
  clientId: string;

  /**
   * The WorkOS API Key
   * Equivalent to the WORKOS_API_KEY environment variable
   */
  apiKey: string;

  /**
   * The redirect URI for the authentication callback
   * Equivalent to the WORKOS_REDIRECT_URI environment variable
   */
  redirectUri: string;

  /**
   * The password used to encrypt the session cookie
   * Equivalent to the WORKOS_COOKIE_PASSWORD environment variable
   * Must be at least 32 characters long
   */
  cookiePassword: string;

  /**
   * The hostname of the API to use
   * Equivalent to the WORKOS_API_HOSTNAME environment variable
   */
  apiHostname?: string;

  /**
   * Whether to use HTTPS for API requests
   * Equivalent to the WORKOS_API_HTTPS environment variable
   */
  apiHttps: boolean;

  /**
   * The port to use for the API
   * Equivalent to the WORKOS_API_PORT environment variable
   */
  apiPort?: number;

  /**
   * The maximum age of the session cookie in seconds
   * Equivalent to the WORKOS_COOKIE_MAX_AGE environment variable
   */
  cookieMaxAge: number;

  /**
   * The name of the session cookie
   * Equivalent to the WORKOS_COOKIE_NAME environment variable
   * Defaults to "wos-session"
   */
  cookieName: string;
}
