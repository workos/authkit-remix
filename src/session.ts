import type { LoaderFunctionArgs, SessionData, TypedResponse } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { getAuthorizationUrl } from './get-authorization-url.js';
import type { AccessToken, AuthKitLoaderOptions, AuthorizedData, Session, UnauthorizedData } from './interfaces.js';
import { getWorkOS } from './workos.js';

import { sealData, unsealData } from 'iron-session';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { getConfig } from './config.js';
import { configureSessionStorage, getSessionStorage } from './sessionStorage.js';

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

async function authkitLoader(
  loaderArgs: LoaderFunctionArgs,
  options: AuthKitLoaderOptions & { ensureSignedIn: true },
): Promise<TypedResponse<AuthorizedData>>;

async function authkitLoader(
  loaderArgs: LoaderFunctionArgs,
  options?: AuthKitLoaderOptions,
): Promise<TypedResponse<AuthorizedData | UnauthorizedData>>;

async function authkitLoader<Data = unknown>(
  loaderArgs: LoaderFunctionArgs,
  loader: AuthorizedAuthLoader<Data>,
  options: AuthKitLoaderOptions & { ensureSignedIn: true },
): Promise<TypedResponse<Data & AuthorizedData>>;

async function authkitLoader<Data = unknown>(
  loaderArgs: LoaderFunctionArgs,
  loader: AuthLoader<Data>,
  options?: AuthKitLoaderOptions,
): Promise<TypedResponse<Data & (AuthorizedData | UnauthorizedData)>>;

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
    return json(auth, session ? { headers: { ...session.headers } } : undefined);
  }

  // If there's a custom loader, get the resulting data and return it with our
  // auth data plus session cookie header
  const loaderResult = await loader({ ...args, auth: auth as AuthorizedData });

  if (loaderResult instanceof Response) {
    // If the result is a redirect, return it unedited
    if (loaderResult.status >= 300 && loaderResult.status < 400) {
      return loaderResult;
    }

    const newResponse = new Response(loaderResult.body, loaderResult);
    const data = await newResponse.json();

    // Set the content type in case the user returned a Response instead of the
    // json helper method
    newResponse.headers.set('Content-Type', 'application/json; charset=utf-8');
    if (session) {
      newResponse.headers.append('Set-Cookie', session.headers['Set-Cookie']);
    }

    return json({ ...data, ...auth }, newResponse);
  }

  // If the loader returns a non-Response, assume it's a data object
  // istanbul ignore next
  return json({ ...loaderResult, ...auth }, session ? { headers: { ...session.headers } } : undefined);
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
