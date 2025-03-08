import { LoaderFunctionArgs, data, redirect } from 'react-router';
import { getConfig } from './config.js';
import { HandleAuthOptions } from './interfaces.js';
import { encryptSession } from './session.js';
import { getSessionStorage } from './sessionStorage.js';
import { getWorkOS } from './workos.js';

export function authLoader(options: HandleAuthOptions = {}) {
  return async function loader({ request }: LoaderFunctionArgs) {
    const { getSession, commitSession, cookieName } = await getSessionStorage();
    const { returnPathname: returnPathnameOption = '/', onSuccess } = options;

    const url = new URL(request.url);

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    let returnPathname = state && state !== 'null' ? JSON.parse(atob(state)).returnPathname : null;

    if (code) {
      try {
        const { accessToken, refreshToken, user, impersonator, oauthTokens } =
          await getWorkOS().userManagement.authenticateWithCode({
            clientId: getConfig('clientId'),
            code,
          });

        // Clean up params
        url.searchParams.delete('code');
        url.searchParams.delete('state');

        // Redirect to the requested path and store the session
        returnPathname = returnPathname ?? returnPathnameOption;

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
          });
        }

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
      return data(
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
