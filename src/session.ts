import { data, redirect, type LoaderFunctionArgs, type SessionData } from 'react-router';
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
import { isResponse, isRedirect } from './utils.js';

// must be a type since this is a subtype of response
// interfaces must conform to the types they extend
export type TypedResponse<T> = Response & {
  json(): Promise<T>;
};

async function updateSession(request: Request, debug: boolean) {
  const session = await getSessionFromCookie(request.headers.get('Cookie') as string);
  const { commitSession, getSession, destroySession } = await getSessionStorage();

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

    const cookieSession = await getSession(request.headers.get('Cookie'));

    throw redirect('/', {
      headers: {
        'Set-Cookie': await destroySession(cookieSession),
      },
    });
  }
}

async function encryptSession(session: Session) {
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
async function authkitLoader(
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
async function authkitLoader(
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
async function authkitLoader<Data = unknown>(
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
async function authkitLoader<Data = unknown>(
  loaderArgs: LoaderFunctionArgs,
  loader: AuthLoader<Data>,
  options?: AuthKitLoaderOptions,
): Promise<DataWithResponseInit<Data & (AuthorizedData | UnauthorizedData)>>;

async function authkitLoader<Data = unknown>(
  loaderArgs: LoaderFunctionArgs,
  loaderOrOptions?: AuthLoader<Data> | AuthorizedAuthLoader<Data> | AuthKitLoaderOptions,
  options: AuthKitLoaderOptions = {},
) {
  const loader = typeof loaderOrOptions === 'function' ? loaderOrOptions : undefined;
  const {
    ensureSignedIn = false,
    debug = false,
    storage,
    cookie,
  } = typeof loaderOrOptions === 'object' ? loaderOrOptions : options;

  const cookieName = cookie?.name ?? getConfig('cookieName');
  const { getSession, destroySession } = await configureSessionStorage({ storage, cookieName });

  const { request } = loaderArgs;
  const session = await updateSession(request, debug);

  if (!session) {
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

  // istanbul ignore next
  const {
    sessionId,
    organizationId = null,
    role = null,
    permissions = [],
    entitlements = [],
  } = getClaimsFromAccessToken(session.accessToken);

  const cookieSession = await getSession(request.headers.get('Cookie'));

  // istanbul ignore next
  const { impersonator = null } = session;

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
  const loaderResult = await loader({ ...args, auth: auth as AuthorizedData });

  if (isResponse(loaderResult)) {
    // If the result is a redirect, return it unedited
    if (isRedirect(loaderResult)) {
      throw loaderResult;
    }

    const newResponse = new Response(loaderResult.body, loaderResult);
    const responseData = await newResponse.json();

    // Set the content type in case the user returned a Response instead of the
    // json helper method
    newResponse.headers.set('Content-Type', 'application/json; charset=utf-8');
    if (session) {
      newResponse.headers.append('Set-Cookie', session.headers['Set-Cookie']);
    }

    return data({ ...responseData, ...auth }, newResponse);
  }

  // If the loader returns a non-Response, assume it's a data object
  // istanbul ignore next
  return data({ ...loaderResult, ...auth }, session ? { headers: { ...session.headers } } : undefined);
}

async function terminateSession(request: Request) {
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
    return redirect(getWorkOS().userManagement.getLogoutUrl({ sessionId }), {
      headers,
    });
  }

  return redirect('/', {
    headers,
  });
}

function getClaimsFromAccessToken(accessToken: string) {
  const {
    sid: sessionId,
    org_id: organizationId,
    role,
    permissions,
    entitlements,
  } = decodeJwt<AccessToken>(accessToken);

  return {
    sessionId,
    organizationId,
    role,
    permissions,
    entitlements,
  };
}

async function getSessionFromCookie(cookie: string, session?: SessionData) {
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

export { authkitLoader, encryptSession, terminateSession };
