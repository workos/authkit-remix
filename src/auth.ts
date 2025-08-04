import { LoaderFunctionArgs, data, redirect } from '@remix-run/node';
import { getAuthorizationUrl } from './get-authorization-url.js';
import { NoUserInfo, UserInfo } from './interfaces.js';
import { getClaimsFromAccessToken, getSessionFromCookie, refreshSession, terminateSession } from './session.js';
import { getConfig } from './config.js';

export async function getSignInUrl(returnPathname?: string) {
  return getAuthorizationUrl({ returnPathname, screenHint: 'sign-in' });
}

export async function getSignUpUrl(returnPathname?: string) {
  return getAuthorizationUrl({ returnPathname, screenHint: 'sign-up' });
}

export async function signOut(request: Request, options?: { returnTo?: string }) {
  return await terminateSession(request, options);
}

/**
 * Given a loader's args, this function will check if the user is authenticated.
 * If the user is authenticated, it will return their information.
 * If the user is not authenticated, it will return an object with user set to null.
 * IMPORTANT: This authkitLoader must be used in a parent/root loader
 * to handle session refresh and cookie management.
 * @param args - The loader's arguments.
 * @returns An object containing user information
 */
export async function withAuth(args: LoaderFunctionArgs): Promise<UserInfo | NoUserInfo> {
  const { request } = args;
  const cookieHeader = request.headers.get('Cookie') as string;
  const cookieName = getConfig('cookieName');

  // Simple check without environment detection
  if (!cookieHeader || !cookieHeader.includes(cookieName)) {
    console.warn(
      `[AuthKit] No session cookie "${cookieName}" found. ` + `Make sure authkitLoader is used in a parent/root route.`,
    );
  }
  const session = await getSessionFromCookie(cookieHeader);

  if (!session?.accessToken) {
    return {
      user: null,
    };
  }

  const {
    sessionId,
    organizationId,
    permissions,
    entitlements,
    role,
    exp = 0,
  } = getClaimsFromAccessToken(session.accessToken);

  if (Date.now() >= exp * 1000) {
    // The access token is expired. This function does not handle token refresh.
    // Ensure that token refresh is implemented in the parent/root loader as documented.
    console.warn(
      '[AuthKit] Access token expired. Ensure authkitLoader is used in a parent/root route to handle automatic token refresh.'
    );
    return {
      user: null,
    };
  }

  return {
    user: session.user,
    sessionId,
    organizationId,
    role,
    permissions,
    entitlements,
    impersonator: session.impersonator,
    accessToken: session.accessToken,
  };
}

/**
 * Switches the current session to a different organization.
 * @param request - The incoming request object.
 * @param organizationId - The ID of the organization to switch to.
 * @param options - Optional parameters.
 * @returns A redirect response to the specified returnTo URL or a data response with the updated auth data.
 */
export async function switchToOrganization(
  request: Request,
  organizationId: string,
  { returnTo }: { returnTo?: string } = {},
) {
  try {
    const auth = await refreshSession(request, { organizationId });

    // if returnTo is provided, redirect to there
    if (returnTo) {
      return redirect(returnTo, {
        headers: {
          'Set-Cookie': auth.headers?.['Set-Cookie'] ?? '',
        },
      });
    }

    // otherwise return the updated auth data
    return data(
      { success: true, auth },
      {
        headers: {
          'Set-Cookie': auth.headers?.['Set-Cookie'] ?? '',
        },
      },
    );
  } catch (error) {
    if (error instanceof Response && error.status === 302) {
      throw error;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorCause: any = error instanceof Error ? error.cause : null;
    if (errorCause?.error === 'sso_required' || errorCause?.error === 'mfa_enrollment') {
      return redirect(await getAuthorizationUrl({ organizationId }));
    }

    return data(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
