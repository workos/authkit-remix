import { json, redirect } from '@remix-run/node';
import { WORKOS_CLIENT_ID, WORKOS_COOKIE_PASSWORD } from './env-variables.js';
import { AccessToken, Session } from './interfaces.js';
import { getSession, destroySession, commitSession } from './cookie.js';
import { getAuthorizationUrl } from './get-authorization-url.js';
import { workos } from './workos.js';

import { sealData, unsealData } from 'iron-session';
import { jwtVerify, createRemoteJWKSet, decodeJwt } from 'jose';

const JWKS = createRemoteJWKSet(new URL(workos.userManagement.getJwksUrl(WORKOS_CLIENT_ID)));

async function updateSession(request: Request, debug: boolean) {
  const session = await getSessionFromCookie(request.headers.get('Cookie'));

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

async function withAuth(
  request: Request,
  options: {
    ensureSignedIn?: boolean;
    debug?: boolean;
    data?: object;
    headers?: Record<string, string>;
  },
): Promise<Response>;

async function withAuth(
  request: Request,
  { ensureSignedIn = false, debug = false, data = {}, headers = {} } = {},
): Promise<Response> {
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

    return json(
      {
        user: null,
        ...data,
      },
      {
        headers,
      },
    );
  }

  const { sessionId, organizationId, role, permissions } = getClaimsFromAccessToken(session.accessToken);

  return json(
    {
      sessionId,
      user: session.user,
      organizationId,
      role,
      permissions,
      impersonator: session.impersonator,
      accessToken: session.accessToken,
      ...data,
    },
    {
      headers: {
        ...headers,
        ...session.headers,
      },
    },
  );
}

async function terminateSession(request: Request) {
  const cookieSession = await getSession(request.headers.get('Cookie'));

  const { sessionId } = getClaimsFromAccessToken(cookieSession.get('accessToken'));

  const headers = {
    'Set-Cookie': await destroySession(cookieSession),
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

async function getSessionFromCookie(cookie: string | null) {
  const session = await getSession(cookie);

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

export { encryptSession, withAuth, terminateSession };
