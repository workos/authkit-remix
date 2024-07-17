import { HandleAuthOptions } from './interfaces.js';
import { WORKOS_CLIENT_ID } from './env-variables.js';
import { workos } from './workos.js';
import { encryptSession } from './session.js';
import { getSession, commitSession, cookieName } from './cookie.js';
import { redirect, json, LoaderFunctionArgs } from '@remix-run/node';

export function authLoader(options: HandleAuthOptions = {}) {
  return async function loader({ request }: LoaderFunctionArgs) {
    const { returnPathname: returnPathnameOption = '/' } = options;

    const url = new URL(request.url);

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const returnPathname = state ? JSON.parse(atob(state)).returnPathname : null;

    if (code) {
      try {
        const { accessToken, refreshToken, user, impersonator } = await workos.userManagement.authenticateWithCode({
          clientId: WORKOS_CLIENT_ID,
          code,
        });

        // Clean up params
        url.searchParams.delete('code');
        url.searchParams.delete('state');

        // Redirect to the requested path and store the session
        url.pathname = returnPathname ?? returnPathnameOption;

        // The refreshToken should never be accesible publicly, hence why we encrypt it in the cookie session
        // Alternatively you could persist the refresh token in a backend database
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

        return redirect(url.toString(), {
          headers: {
            'Set-Cookie': cookie,
          },
        });
      } catch (error) {
        const errorRes = {
          error: error instanceof Error ? error.message : String(error),
        };

        console.error(errorRes);

        return errorResponse();
      }
    }

    function errorResponse() {
      return json(
        {
          error: {
            message: 'Something went wrong',
            description: 'Couldn’t sign in. If you are not sure what happened, please contact your organization admin.',
          },
        },
        { status: 500 },
      );
    }
  };
}
