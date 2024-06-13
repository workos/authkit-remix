import { redirect } from '@remix-run/node';
import { WORKOS_CLIENT_ID, WORKOS_COOKIE_PASSWORD } from './env-variables.js';
import { AccessToken, NoUserInfo, Session, UserInfo } from './interfaces.js';
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
    };

    // Encrypt session with new access and refresh tokens
    const updatedSession = await getSession(request.headers.get('Cookie'));
    updatedSession.set('jwt', await encryptSession(newSession));
    await commitSession(updatedSession);

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
  options?: {
    ensureSignedIn?: false;
    debug?: boolean;
  },
): Promise<UserInfo | NoUserInfo>;

async function withAuth(
  request: Request,
  options: {
    ensureSignedIn?: true;
    debug?: boolean;
  },
): Promise<UserInfo>;

async function withAuth(request: Request, { ensureSignedIn = false, debug = false } = {}) {
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
    return { user: null };
  }

  const { sid: sessionId, org_id: organizationId, role } = decodeJwt<AccessToken>(session.accessToken);

  return {
    sessionId,
    user: session.user,
    organizationId,
    role,
    impersonator: session.impersonator,
    accessToken: session.accessToken,
  };
}

async function terminateSession(request: Request) {
  const { sessionId } = await withAuth(request);

  const cookieSession = await getSession(request.headers.get('Cookie'));

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
