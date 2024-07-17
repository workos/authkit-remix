import { json, LoaderFunctionArgs, redirect, SessionData } from '@remix-run/node';
import { WORKOS_CLIENT_ID, WORKOS_COOKIE_PASSWORD } from './env-variables.js';
import { AccessToken, AuthData, AuthKitLoaderOptions, Session } from './interfaces.js';
import { getSession, destroySession, commitSession } from './cookie.js';
import { getAuthorizationUrl } from './get-authorization-url.js';
import { workos } from './workos.js';

import { sealData, unsealData } from 'iron-session';
import { jwtVerify, createRemoteJWKSet, decodeJwt } from 'jose';

type AuthLoader = (loaderArgs: LoaderFunctionArgs & { auth: AuthData }) => Promise<Response>;

const JWKS = createRemoteJWKSet(new URL(workos.userManagement.getJwksUrl(WORKOS_CLIENT_ID)));

async function updateSession(request: Request, debug: boolean) {
  const session = await getSessionFromCookie(request.headers.get('Cookie') as string);

  // If no session, just continue
  if (!session) {
    return null;
  }

  const hasValidSession = await verifyAccessToken(session.accessToken);

  if (hasValidSession) {
    if (debug) console.log('Session is valid');
    return session;
  }

  try {
    if (debug) console.log('Session invalid. Attempting refresh', session.refreshToken);

    // If the session is invalid (i.e. the access token has expired) attempt to re-authenticate with the refresh token
    const { accessToken, refreshToken } = await workos.userManagement.authenticateWithRefreshToken({
      clientId: WORKOS_CLIENT_ID,
      refreshToken: session.refreshToken,
    });

    if (debug) console.log('Refresh successful:', refreshToken);

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
  return sealData(session, { password: WORKOS_COOKIE_PASSWORD });
}

async function authkitLoader(
  loaderArgs: LoaderFunctionArgs,
  loaderOrOptions?: AuthLoader | AuthKitLoaderOptions,
  options: AuthKitLoaderOptions = {},
) {
  const loader = typeof loaderOrOptions === 'function' ? loaderOrOptions : undefined;
  const { ensureSignedIn = false, debug = false } = typeof loaderOrOptions === 'object' ? loaderOrOptions : options;

  const { request } = loaderArgs;
  const session = await updateSession(request, debug);

  if (!session) {
    if (ensureSignedIn) {
      const returnPathname = new URL(request.url).pathname;
      const cookieSession = await getSession(request.headers.get('Cookie'));

      throw redirect(await getAuthorizationUrl({ returnPathname }), {
        headers: {
          'Set-Cookie': await destroySession(cookieSession),
        },
      });
    }

    if (loader) {
      return await loader({ ...loaderArgs, auth: { user: null } });
    }

    return json({
      user: null,
    });
  }

  const { sessionId, organizationId, role, permissions } = getClaimsFromAccessToken(session.accessToken);

  const authData = {
    user: session.user,
    sessionId,
    accessToken: session.accessToken,
    organizationId,
    role,
    permissions,
    impersonator: session.impersonator,
  };

  if (!loader) {
    return json(authData, {
      headers: {
        ...session.headers,
      },
    });
  }

  // If there's a custom loader, get the resulting data and return it with our auth data plus session cookie header
  const loaderResult: Response | object = await loader({ ...loaderArgs, auth: authData });

  if (loaderResult instanceof Response) {
    // If the result is a redirect, return it unedited
    if (loaderResult.status >= 300 && loaderResult.status < 400) {
      return loaderResult;
    }

    const newResponse = new Response(loaderResult.body, loaderResult);
    const data = await newResponse.json();

    // Set the content type in case the user returned a Response instead of the json helper method
    newResponse.headers.set('Content-Type', 'application/json');
    newResponse.headers.append('Set-Cookie', (session.headers as Record<string, string>)['Set-Cookie']);

    return json({ ...(data || {}), ...authData }, newResponse);
  }

  // If the loader returns a non-Response, assume it's a data object
  return json({ ...loaderResult, ...authData }, { headers: { ...session.headers } });
}

async function terminateSession(request: Request) {
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
    return redirect(workos.userManagement.getLogoutUrl({ sessionId }), {
      headers,
    });
  }

  return redirect('/', {
    headers,
  });
}

function getClaimsFromAccessToken(accessToken: string) {
  const { sid: sessionId, org_id: organizationId, role, permissions } = decodeJwt<AccessToken>(accessToken);

  return {
    sessionId,
    organizationId,
    role,
    permissions,
  };
}

async function getSessionFromCookie(cookie: string, session?: SessionData) {
  if (!session) {
    session = await getSession(cookie);
  }

  if (session.has('jwt')) {
    return unsealData<Session>(session.get('jwt'), {
      password: WORKOS_COOKIE_PASSWORD,
    });
  } else {
    return null;
  }
}

async function verifyAccessToken(accessToken: string) {
  try {
    await jwtVerify(accessToken, JWKS);
    return true;
  } catch (e) {
    return false;
  }
}

export { encryptSession, terminateSession, authkitLoader };
