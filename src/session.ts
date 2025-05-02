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
  constructor(cause: unknown) {
    super('Session refresh error', { cause });
    this.name = 'SessionRefreshError';
  }
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
    const { accessToken, refreshToken } = await getWorkOS().userManagement.authenticateWithRefreshToken({
      clientId: getConfig('clientId'),
      refreshToken: session.refreshToken,
      organizationId,
    });

    const newSession = {
      accessToken,
      refreshToken,
      user: session.user,
      impersonator: session.impersonator,
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
      permissions,
      entitlements,
    } = getClaimsFromAccessToken(accessToken);

    return {
      user: session.user,
      sessionId,
      accessToken,
      organizationId: newOrgId,
      role,
      permissions,
      entitlements,
      impersonator: session.impersonator || null,
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

    // If the session is invalid (i.e. the access token has expired) attempt to re-authenticate with the refresh token
    const { accessToken, refreshToken } = await getWorkOS().userManagement.authenticateWithRefreshToken({
      clientId: getConfig('clientId'),
      refreshToken: session.refreshToken,
    });

    // istanbul ignore next
    if (debug) console.log(`Refresh successful. New access token ends in ${accessToken.slice(-10)}`);

    const newSession = {
      accessToken,
      refreshToken,
      user: session.user,
      impersonator: session.impersonator,
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
  args: LoaderFunctionArgs & { auth: AuthorizedData | UnauthorizedData },
) => LoaderReturnValue<Data>;

type AuthorizedAuthLoader<Data> = (args: LoaderFunctionArgs & { auth: AuthorizedData }) => LoaderReturnValue<Data>;

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
        accessToken: null,
        impersonator: null,
        organizationId: null,
        permissions: null,
        entitlements: null,
        role: null,
        sessionId: null,
        sealedSession: null,
      };

      return await handleAuthLoader(loader, loaderArgs, auth);
    }

    // Session found and valid (or refreshed successfully)
    const {
      sessionId,
      organizationId = null,
      role = null,
      permissions = [],
      entitlements = [],
    } = getClaimsFromAccessToken(session.accessToken);

    const cookieSession = await getSession(request.headers.get('Cookie'));
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
      accessToken: session.accessToken,
      organizationId,
      role,
      permissions,
      entitlements,
      impersonator,
      sealedSession: cookieSession.get('jwt'),
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

      throw redirect('/', {
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

  // Call the user's loader function
  const loaderResult = await loader({ ...args, auth: auth as AuthorizedData });

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
