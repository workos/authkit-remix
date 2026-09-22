import { LoaderFunctionArgs, data, redirect } from '@remix-run/node';
import { getConfig } from './config.js';
import { HandleAuthOptions } from './interfaces.js';
import { getPKCECookie, readPKCECookie } from './pkce.js';
import { sanitizeReturnPathname } from './return-pathname.js';
import { encryptSession } from './session.js';
import { configureSessionStorage } from './sessionStorage.js';
import { getWorkOS } from './workos.js';

export function authLoader(options: HandleAuthOptions = {}) {
  return async function loader({ request }: LoaderFunctionArgs) {
    const { storage, cookie, returnPathname: returnPathnameOption = '/', onSuccess } = options;
    const cookieName = cookie?.name ?? getConfig('cookieName');
    const { getSession, commitSession } = await configureSessionStorage({ storage, cookieName });

    const url = new URL(request.url);

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const headers = new Headers();
    if (state) {
      headers.append('Set-Cookie', await getPKCECookie(state, request).serialize('', { maxAge: 0 }));
    }

    if (code) {
      try {
        if (!state) throw new Error('Missing OAuth state');
        const { codeVerifier, returnPathname: stateReturnPathname } = await readPKCECookie(request, state);

        const { accessToken, refreshToken, user, impersonator, oauthTokens, organizationId } =
          await getWorkOS().userManagement.authenticateWithCode({
            clientId: getConfig('clientId'),
            code,
            codeVerifier,
          });

        // Clean up params
        url.searchParams.delete('code');
        url.searchParams.delete('state');

        // Redirect to the requested path and store the session
        const returnPathname = sanitizeReturnPathname(stateReturnPathname ?? returnPathnameOption);

        // Extract the search params if they are present
        if (returnPathname.includes('?')) {
          const newUrl = new URL(returnPathname, 'https://example.com');
          url.pathname = newUrl.pathname;

          for (const [key, value] of newUrl.searchParams) {
            url.searchParams.append(key, value);
          }
        } else {
          url.pathname = returnPathname;
        }

        // The refreshToken should never be accesible publicly, hence why we encrypt it
        // in the cookie session. Alternatively you could persist the refresh token in a
        // backend database.
        const encryptedSession = await encryptSession({
          accessToken,
          refreshToken,
          user,
          impersonator,
          headers: {},
        });

        const session = await getSession(cookieName);

        session.set('jwt', encryptedSession);
        const cookie = await commitSession(session);

        if (onSuccess) {
          await onSuccess({
            accessToken,
            impersonator: impersonator ?? null,
            oauthTokens: oauthTokens ?? null,
            refreshToken,
            user,
            organizationId: organizationId ?? null,
          });
        }

        // Fix protocol mismatch for load balancer scenarios
        // If WORKOS_REDIRECT_URI is HTTPS but request is HTTP, use HTTPS for redirect
        const redirectUri = getConfig('redirectUri');
        const configUrl = new URL(redirectUri);
        if (configUrl.protocol === 'https:' && url.protocol === 'http:') {
          url.protocol = 'https:';
        }

        headers.append('Set-Cookie', cookie);
        return redirect(url.toString(), { headers });
      } catch (error) {
        const errorRes = {
          error: error instanceof Error ? error.message : String(error),
        };

        console.error(errorRes);

        return errorResponse();
      }
    }

    // Authorization errors (e.g. user cancellation) also consume the flow cookie.
    if (state) return new Response(null, { headers });

    function errorResponse() {
      return data(
        {
          error: {
            message: 'Something went wrong',
            description: 'Couldn’t sign in. If you are not sure what happened, please contact your organization admin.',
          },
        },
        { status: 500, headers },
      );
    }
  };
}
