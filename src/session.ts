import { data, redirect, type LoaderFunctionArgs, type SessionData } from '@remix-run/node';
import { getAuthorizationUrl } from './get-authorization-url.js';
import type {
  AccessToken,
  AuthKitLoaderOptions,
  AuthorizedData,
  DataWithResponseInit,
  Session,
  UnauthorizedData,
} from './interfaces.js';
import { getWorkOS } from './workos.js';

import { sealData, unsealData } from 'iron-session';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { getConfig } from './config.js';
import { configureSessionStorage, getSessionStorage } from './sessionStorage.js';
import { isResponse, isRedirect, isJsonResponse, isDataWithResponseInit } from './utils.js';

// must be a type since this is a subtype of response
// interfaces must conform to the types they extend
export type TypedResponse<T> = Response & {
  json(): Promise<T>;
};

export class SessionRefreshError extends Error {
  /**
   * Whether the refresh failed for a transient reason (network error, timeout,
   * 429, or 5xx) rather than a terminal one (the refresh token is dead). When
   * `true`, the existing session is still valid and should be preserved and
   * retried rather than destroyed.
   */
  readonly isTransient: boolean;

  constructor(cause: unknown) {
    super('Session refresh error', { cause });
    this.name = 'SessionRefreshError';
    this.isTransient = isTransientRefreshError(cause);
  }
}

// HTTP statuses the WorkOS SDK treats as idempotent/retryable and retries
// internally. If one of these still surfaces, the failure is transient rather
// than a dead refresh token: request timeouts (normalized to 408), rate limits
// (429), and 5xx.
const RETRYABLE_REFRESH_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

// A network-level fetch failure surfaces as a TypeError ("fetch failed" /
// "Failed to fetch"). Match its message so an unrelated programming TypeError
// isn't misclassified as a transient (and therefore session-preserving) error.
const NETWORK_ERROR_MESSAGE = /fetch failed|failed to fetch|network|load failed|terminated/i;

// A raw network TypeError is not an HttpClientError, so the WorkOS SDK re-wraps
// it in a plain Error whose `cause` is the original TypeError. Follow the cause
// chain to recognize it.
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return NETWORK_ERROR_MESSAGE.test(error.message);
  }

  if (error instanceof Error && error.cause != null && error.cause !== error) {
    return isNetworkError(error.cause);
  }

  return false;
}

/**
 * Determines whether a failed refresh is transient (the session should be
 * preserved and retried) rather than terminal (the refresh token is dead and
 * the user must re-authenticate).
 *
 * Mirrors the WorkOS SDK's own retry classification: transient HTTP responses
 * (request timeout normalized to `408`, `429`, and `5xx`) surface as an
 * exception carrying a retryable numeric `status`, and a network-level failure
 * surfaces as a `TypeError` (wrapped by the SDK in an `Error` with the
 * `TypeError` as its `cause`). Anything else (a terminal `invalid_grant` at
 * 400, a 401, or an unrecognized error) is treated as terminal.
 */
export function isTransientRefreshError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error;
    if (typeof status === 'number' && RETRYABLE_REFRESH_STATUS_CODES.has(status)) {
      return true;
    }
  }

  return isNetworkError(error);
}

/**
 * This function is used to refresh the session by using the refresh token.
 * It will authenticate the user with the refresh token and return a new session object.
 * @param request - The request object
 * @param options - Optional configuration options
 * @returns A promise that resolves to the new session object
 */
export async function refreshSession(request: Request, { organizationId }: { organizationId?: string } = {}) {
  const { getSession, commitSession } = await getSessionStorage();
  const session = await getSessionFromCookie(request.headers.get('Cookie') as string);

  if (!session) {
    throw redirect(await getAuthorizationUrl());
  }

  try {
    const { accessToken, refreshToken, user, impersonator } =
      await getWorkOS().userManagement.authenticateWithRefreshToken({
        clientId: getConfig('clientId'),
        refreshToken: session.refreshToken,
        organizationId,
      });

    const newSession = {
      accessToken,
      refreshToken,
      user,
      impersonator,
      headers: {} as Record<string, string>,
    };

    const cookieSession = await getSession(request.headers.get('Cookie'));
    cookieSession.set('jwt', await encryptSession(newSession));
    const cookie = await commitSession(cookieSession);

    newSession.headers = {
      'Set-Cookie': cookie,
    };

    const {
      sessionId,
      organizationId: newOrgId,
      role,
      roles,
      permissions,
      entitlements,
    } = getClaimsFromAccessToken(accessToken);

    return {
      user,
      sessionId,
      accessToken,
      organizationId: newOrgId,
      role,
      roles,
      permissions,
      entitlements,
      impersonator: impersonator ?? null,
      sealedSession: cookieSession.get('jwt'),
      headers: newSession.headers,
    };
  } catch (error) {
    throw new Error(`Failed to refresh session: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

async function updateSession(request: Request, debug: boolean) {
  const session = await getSessionFromCookie(request.headers.get('Cookie') as string);
  const { commitSession, getSession } = await getSessionStorage();

  // If no session, just continue
  if (!session) {
    return null;
  }

  const hasValidSession = await verifyAccessToken(session.accessToken);

  if (hasValidSession) {
    // istanbul ignore next
    if (debug) console.log('Session is valid');
    return session;
  }

  try {
    // istanbul ignore next
    if (debug) console.log(`Session invalid. Refreshing access token that ends in ${session.accessToken.slice(-10)}`);

    const { organizationId } = getClaimsFromAccessToken(session.accessToken);
    // If the session is invalid (i.e. the access token has expired) attempt to re-authenticate with the refresh token
    const { accessToken, refreshToken, user, impersonator } =
      await getWorkOS().userManagement.authenticateWithRefreshToken({
        clientId: getConfig('clientId'),
        refreshToken: session.refreshToken,
        organizationId,
      });

    // istanbul ignore next
    if (debug) console.log(`Refresh successful. New access token ends in ${accessToken.slice(-10)}`);

    const newSession = {
      accessToken,
      refreshToken,
      user,
      impersonator,
      headers: {},
    };

    // Encrypt session with new access and refresh tokens
    const updatedSession = await getSession(request.headers.get('Cookie'));
    updatedSession.set('jwt', await encryptSession(newSession));

    newSession.headers = {
      'Set-Cookie': await commitSession(updatedSession),
    };

    return newSession;
  } catch (e) {
    // istanbul ignore next
    if (debug) console.log('Failed to refresh. Deleting cookie and redirecting.', e);

    throw new SessionRefreshError(e);
  }
}

export async function encryptSession(session: Session) {
  return sealData(session, {
    password: getConfig('cookiePassword'),
    ttl: 0,
  });
}

type LoaderValue<Data> = Response | TypedResponse<Data> | NonNullable<Data> | null;
type LoaderReturnValue<Data> = Promise<LoaderValue<Data>> | LoaderValue<Data>;

type AuthLoader<Data> = (
  args: LoaderFunctionArgs & { auth: AuthorizedData | UnauthorizedData; getAccessToken: () => string | null },
) => LoaderReturnValue<Data>;

type AuthorizedAuthLoader<Data> = (
  args: LoaderFunctionArgs & { auth: AuthorizedData; getAccessToken: () => string },
) => LoaderReturnValue<Data>;

/**
 * This loader handles authentication state, session management, and access token refreshing
 * automatically, making it easier to build authenticated routes.
 *
 * Creates an authentication-aware loader function for React Router.
 *
 * This loader handles authentication state, session management, and access token refreshing
 * automatically, making it easier to build authenticated routes.
 *
 * @overload
 * Basic usage with enforced authentication that redirects unauthenticated users to sign in.
 *
 * @param loaderArgs - The loader arguments provided by React Router
 * @param options - Configuration options with enforced sign-in
 *
 * @example
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   return authkitLoader(
 *     { request },
 *     { ensureSignedIn: true }
 *   );
 * }
 */
export async function authkitLoader(
  loaderArgs: LoaderFunctionArgs,
  options: AuthKitLoaderOptions & { ensureSignedIn: true },
): Promise<DataWithResponseInit<AuthorizedData>>;

/**
 * This loader handles authentication state, session management, and access token refreshing
 * automatically, making it easier to build authenticated routes.
 *
 * @overload
 * Basic usage without enforced authentication, allowing both signed-in and anonymous users.
 *
 * @param loaderArgs - The loader arguments provided by React Router
 * @param options - Optional configuration options
 *
 * @example
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   return authkitLoader({ request });
 * }
 */
export async function authkitLoader(
  loaderArgs: LoaderFunctionArgs,
  options?: AuthKitLoaderOptions,
): Promise<DataWithResponseInit<AuthorizedData | UnauthorizedData>>;

/**
 * This loader handles authentication state, session management, and access token refreshing
 * automatically, making it easier to build authenticated routes.
 *
 * @overload
 * Custom loader with enforced authentication, providing your own loader function
 * that will only be called for authenticated users.
 *
 * @param loaderArgs - The loader arguments provided by React Router
 * @param loader - A custom loader function that receives authentication data
 * @param options - Configuration options with enforced sign-in
 *
 * @example
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   return authkitLoader(
 *     { request },
 *     async ({ auth }) => {
 *       // This will only be called for authenticated users
 *       const userData = await fetchUserData(auth.accessToken);
 *       return { userData };
 *     },
 *     { ensureSignedIn: true }
 *   );
 * }
 */
export async function authkitLoader<Data = unknown>(
  loaderArgs: LoaderFunctionArgs,
  loader: AuthorizedAuthLoader<Data>,
  options: AuthKitLoaderOptions & { ensureSignedIn: true },
): Promise<DataWithResponseInit<Data & AuthorizedData>>;

/**
 * This loader handles authentication state, session management, and access token refreshing
 * automatically, making it easier to build authenticated routes.
 *
 * @overload
 * Custom loader without enforced authentication, providing your own loader function
 * that will be called for both authenticated and unauthenticated users.
 *
 * @param loaderArgs - The loader arguments provided by React Router
 * @param loader - A custom loader function that receives authentication data
 * @param options - Optional configuration options
 *
 * @example
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   return authkitLoader(
 *     { request },
 *     async ({ auth }) => {
 *       if (auth.user) {
 *         // User is authenticated
 *         const userData = await fetchUserData(auth.accessToken);
 *         return { userData };
 *       } else {
 *         // User is not authenticated
 *         return { publicData: await fetchPublicData() };
 *       }
 *     }
 *   );
 * }
 */
export async function authkitLoader<Data = unknown>(
  loaderArgs: LoaderFunctionArgs,
  loader: AuthLoader<Data>,
  options?: AuthKitLoaderOptions,
): Promise<DataWithResponseInit<Data & (AuthorizedData | UnauthorizedData)>>;

export async function authkitLoader<Data = unknown>(
  loaderArgs: LoaderFunctionArgs,
  loaderOrOptions?: AuthLoader<Data> | AuthorizedAuthLoader<Data> | AuthKitLoaderOptions,
  options: AuthKitLoaderOptions = {},
) {
  const loader = typeof loaderOrOptions === 'function' ? loaderOrOptions : undefined;
  const {
    ensureSignedIn = false,
    debug = false,
    onSessionRefreshSuccess,
    onSessionRefreshError,
    storage,
    cookie,
  } = typeof loaderOrOptions === 'object' ? loaderOrOptions : options;

  const cookieName = cookie?.name ?? getConfig('cookieName');
  const { getSession, destroySession } = await configureSessionStorage({ storage, cookieName });

  const { request } = loaderArgs;

  try {
    // Try to get session, this might throw SessionRefreshError
    const session = await updateSession(request, debug);

    if (!session) {
      // No session found case (not authenticated)
      if (ensureSignedIn) {
        const returnPathname = getReturnPathname(request.url);
        const cookieSession = await getSession(request.headers.get('Cookie'));

        throw redirect(await getAuthorizationUrl({ returnPathname }), {
          headers: {
            'Set-Cookie': await destroySession(cookieSession),
          },
        });
      }

      const auth: UnauthorizedData = {
        user: null,
        impersonator: null,
        organizationId: null,
        permissions: null,
        entitlements: null,
        role: null,
        roles: null,
        sessionId: null,
      };

      return await handleAuthLoader(loader, loaderArgs, auth);
    }

    // Session found and valid (or refreshed successfully)
    const {
      sessionId,
      organizationId = null,
      role = null,
      roles = null,
      permissions = [],
      entitlements = [],
    } = getClaimsFromAccessToken(session.accessToken);

    const { impersonator = null } = session;

    // checking for 'headers' in session determines if the session was refreshed or not
    if (onSessionRefreshSuccess && 'headers' in session) {
      await onSessionRefreshSuccess({
        accessToken: session.accessToken,
        user: session.user,
        impersonator,
        organizationId,
      });
    }

    const auth: AuthorizedData = {
      user: session.user,
      sessionId,
      organizationId,
      role,
      roles,
      permissions,
      entitlements,
      impersonator,
    };

    return await handleAuthLoader(loader, loaderArgs, auth, session);
  } catch (error) {
    if (error instanceof SessionRefreshError) {
      const cookieSession = await getSession(request.headers.get('Cookie'));

      if (onSessionRefreshError) {
        try {
          const result = await onSessionRefreshError({
            error: error.cause,
            request,
            sessionData: cookieSession,
            isTransient: error.isTransient,
          });

          if (result instanceof Response) {
            return result;
          }
        } catch (callbackError) {
          // If callback throws a Response (like redirect), propagate it
          if (callbackError instanceof Response) {
            throw callbackError;
          }
        }
      }

      const returnPathname = getReturnPathname(request.url);

      // Only destroy the session for a terminal failure. A transient failure
      // (network error, timeout, 429, or 5xx that survived the SDK's internal
      // retries) leaves the refresh token valid, so keep the sealed cookie and
      // let a later request refresh successfully rather than forcing the user
      // to re-authenticate.
      if (error.isTransient) {
        throw redirect(await getAuthorizationUrl({ returnPathname }));
      }

      throw redirect(await getAuthorizationUrl({ returnPathname }), {
        headers: {
          'Set-Cookie': await destroySession(cookieSession),
        },
      });
    }

    // Propagate other errors
    throw error;
  }
}

async function handleAuthLoader(
  loader: AuthLoader<unknown> | AuthorizedAuthLoader<unknown> | undefined,
  args: LoaderFunctionArgs,
  auth: AuthorizedData | UnauthorizedData,
  session?: Session,
) {
  if (!loader) {
    return data(auth, session ? { headers: { ...session.headers } } : undefined);
  }

  // If there's a custom loader, get the resulting data and return it with our
  // auth data plus session cookie header
  let loaderResult;

  if (auth.user) {
    // Authorized case
    const getAccessToken = () => {
      if (!session?.accessToken) {
        throw new Error('No access token available');
      }
      return session.accessToken;
    };
    loaderResult = await (loader as AuthorizedAuthLoader<unknown>)({
      ...args,
      auth: auth as AuthorizedData,
      getAccessToken,
    });
  } else {
    // Unauthorized case
    const getAccessToken = () => null;
    loaderResult = await (loader as AuthLoader<unknown>)({ ...args, auth, getAccessToken });
  }

  // Special handling for DataWithResponseInit (from data())
  if (isDataWithResponseInit(loaderResult)) {
    const dataResponse = loaderResult;
    // Use Headers API to properly handle headers
    const mergedHeaders = new Headers();

    // Add all headers from the original response
    if (dataResponse.init?.headers) {
      const origHeaders = dataResponse.init.headers;
      if (origHeaders instanceof Headers) {
        origHeaders.forEach((value, key) => {
          mergedHeaders.append(key, value);
        });
      } else if (typeof origHeaders === 'object') {
        // Handle plain object headers
        Object.entries(origHeaders).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            value.forEach((v) => mergedHeaders.append(key, v));
          } else if (value) {
            mergedHeaders.append(key, value);
          }
        });
      }
    }

    // Add session cookie if present
    if (session?.headers?.['Set-Cookie']) {
      mergedHeaders.append('Set-Cookie', session.headers['Set-Cookie']);
    }

    // Create a new data response with the merged data and headers
    return data(Object.assign({}, dataResponse.data, auth), {
      ...dataResponse.init,
      headers: mergedHeaders,
    });
  }

  // Handle standard Response objects
  if (isResponse(loaderResult)) {
    if (isRedirect(loaderResult)) {
      throw loaderResult;
    }

    // Create a new Response with the original as init
    const newResponse = new Response(loaderResult.body, loaderResult);

    // Add the session cookie if it exists
    if (session?.headers?.['Set-Cookie']) {
      newResponse.headers.append('Set-Cookie', session.headers['Set-Cookie']);
    }

    // If it's not JSON, return as-is
    if (!isJsonResponse(newResponse)) {
      return newResponse;
    }

    try {
      // For JSON responses, we need to extract all data and headers
      const responseData = await newResponse.json();

      // Use Headers directly
      const headers = new Headers(newResponse.headers);

      // Return the final data response
      return data(Object.assign({}, responseData, auth), {
        headers,
        status: newResponse.status,
        statusText: newResponse.statusText,
      });
    } catch (error) {
      // If parsing JSON fails, return the original response
      return newResponse;
    }
  }

  // For plain objects (not Response or DataWithResponseInit)
  return data(Object.assign({}, loaderResult, auth), session ? { headers: { ...session.headers } } : undefined);
}

export async function terminateSession(request: Request, { returnTo }: { returnTo?: string } = {}) {
  const { getSession, destroySession } = await getSessionStorage();
  const encryptedSession = await getSession(request.headers.get('Cookie'));
  const { accessToken } = (await getSessionFromCookie(
    request.headers.get('Cookie') as string,
    encryptedSession,
  )) as Session;

  const { sessionId } = getClaimsFromAccessToken(accessToken);

  const headers = {
    'Set-Cookie': await destroySession(encryptedSession),
  };

  if (sessionId) {
    return redirect(getWorkOS().userManagement.getLogoutUrl({ sessionId, returnTo }), {
      headers,
    });
  }

  return redirect(returnTo ?? '/', {
    headers,
  });
}

export function getClaimsFromAccessToken(accessToken: string) {
  const {
    sid: sessionId,
    org_id: organizationId,
    role,
    roles,
    permissions,
    entitlements,
    exp,
    iss,
  } = decodeJwt<AccessToken>(accessToken);

  return {
    iss,
    exp,
    sessionId,
    organizationId,
    role,
    roles,
    permissions,
    entitlements,
  };
}

export async function getSessionFromCookie(cookie: string, session?: SessionData) {
  const { getSession } = await getSessionStorage();
  if (!session) {
    session = await getSession(cookie);
  }

  if (session.has('jwt')) {
    return unsealData<Session>(session.get('jwt'), {
      password: getConfig('cookiePassword'),
    });
  } else {
    return null;
  }
}

async function verifyAccessToken(accessToken: string) {
  const JWKS = createRemoteJWKSet(new URL(getWorkOS().userManagement.getJwksUrl(getConfig('clientId'))));
  try {
    await jwtVerify(accessToken, JWKS);
    return true;
  } catch (e) {
    return false;
  }
}

function getReturnPathname(url: string): string {
  const newUrl = new URL(url);

  // istanbul ignore next
  return `${newUrl.pathname}${newUrl.searchParams.size > 0 ? '?' + newUrl.searchParams.toString() : ''}`;
}
