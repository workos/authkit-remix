# AuthKit Remix Library

The AuthKit library for Remix provides convenient helpers for authentication and session management using WorkOS & AuthKit with Remix. You can find this library in action in the [remix-authkit-example](https://github.com/workos/remix-authkit-example) repo.

## Installation

Install the package with:

```
npm i @workos-inc/authkit-remix
```

or

```
yarn add @workos-inc/authkit-remix
```

## Configuration

AuthKit for Remix offers a flexible configuration system that allows you to customize various settings. You can configure the library in three ways:

### 1. Environment Variables

  The simplest way is to set environment variables in your `.env.local` file:

  ```bash
  WORKOS_CLIENT_ID="client_..." # retrieved from the WorkOS dashboard
  WORKOS_API_KEY="sk_test_..." # retrieved from the WorkOS dashboard
  WORKOS_REDIRECT_URI="http://localhost:5173/callback" # configured in the WorkOS dashboard
  WORKOS_COOKIE_PASSWORD="<your password>" # generate a secure password here
```

### 2. Programmatic Configuration

You can also configure AuthKit programmatically by importing the `configure` function:

```typescript
import { configure } from '@workos-inc/authkit-remix';
// In your root or entry file
configure({
  clientId: 'client_1234567890',
  apiKey: 'sk_test_1234567890',
  redirectUri: 'http://localhost:5173/callback',
  cookiePassword: 'your-secure-cookie-password',
  // Optional settings
  cookieName: 'my-custom-cookie-name',
  apiHttps: true,
  cookieMaxAge: 60 * 60 * 24 * 30, // 30 days
});
```

### 3. Custom Environment Source

For non-standard environments (like Deno or Edge functions), you can provide a custom environment variable source:

> [!Warning]
>
>While this library includes support for custom environment sources that could theoretically work in non-Node.js runtimes like Deno or Edge functions, this functionality has not been extensively tested (yet). If you're planning to use AuthKit in these environments, you may encounter unexpected issues. We welcome feedback and contributions from users who test in these environments.

```typescript
import { configure } from '@workos-inc/authkit-remix';

configure(key => Deno.env.get(key));
// Or combine with explicit values
configure(
  { clientId: 'client_1234567890' },
  key => Deno.env.get(key)
);
```

### Configuration Priority

When retrieving configuration values, AuthKit follows this priority order:

1. Programmatically provided values via `configure()`
2. Environment variables (prefixed with `WORKOS_`)
3. Default values for optional settings

### Available Configuration Options

>[!NOTE]
>
>To print out the entire config, a `getFullConfig` function is provided for debugging purposes.

|  Option |  Environment Variable |  Default |  Required |  Description |  
| ---- | ---- | ---- | ---- | ----  |
|  `clientId` |  `WORKOS_CLIENT_ID` |  - |  Yes |  Your WorkOS Client ID |  
|  `apiKey` |  `WORKOS_API_KEY` |  - |  Yes |  Your WorkOS API Key |  
|  `redirectUri` |  `WORKOS_REDIRECT_URI` |  - |  Yes |  The callback URL configured in WorkOS |  
|  `cookiePassword` |  `WORKOS_COOKIE_PASSWORD` |  - |  Yes |  Password for cookie encryption (min 32 chars) |  
|  `cookieName` |  `WORKOS_COOKIE_NAME` |  `wos-session` |  No |  Name of the session cookie |  
|  `apiHttps` |  `WORKOS_API_HTTPS` |  `true` |  No |  Whether to use HTTPS for API calls |  
|  `cookieMaxAge` |  `WORKOS_COOKIE_MAX_AGE` |  `34560000` (400 days) |  No |  Maximum age of cookie in seconds |  
|  `apiHostname` |  `WORKOS_API_HOSTNAME` |  `api.workos.com` |  No |  WorkOS API hostname |  
|  `apiPort` |  `WORKOS_API_PORT` |  - |  No |  Port to use for API calls | 

>[!NOTE]
>
>The `cookiePassword` must be at least 32 characters long for security reasons.

## Setup

### Callback route

AuthKit requires that you have a callback URL to redirect users back to after they've authenticated. In your Remix app, [create a new route](https://remix.run/docs/en/main/discussion/routes) and add the following:

```ts
import { authLoader } from '@workos-inc/authkit-remix';

export const loader = authLoader();
```

Make sure this route matches the `WORKOS_REDIRECT_URI` variable and the configured redirect URI in your WorkOS dashboard. For instance if your redirect URI is `http://localhost:2884/callback` then you'd put the above code in `/app/routes/callback.ts`.

You can also control the pathname the user will be sent to after signing-in by passing a `returnPathname` option to `authLoader` like so:

```ts
export const loader = authLoader({ returnPathname: '/dashboard' });
```

If your application needs to persist `oauthTokens` or other auth-related information after the callback is successful, you can pass an `onSuccess` option:

```ts
export const loader = authLoader({
  onSuccess: async ({ oauthTokens }) => {
    await saveToDatabase(oauthTokens);
  },
});
```

## Usage

### Access authentication data in your Remix application

Use `authkitLoader` to configure AuthKit for your Remix application routes.

```tsx
import type { LoaderFunctionArgs } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { authkitLoader } from '@workos-inc/authkit-remix';

export const loader = (args: LoaderFunctionArgs) => authkitLoader(args);

export function App() {
  // Retrieves the user from the session or returns `null` if no user is signed in
  // Other supported values include `sessionId`, `organizationId`,
  // `role`, `permissions`, `entitlements`, and `impersonator`.
  const { user, signInUrl, signUpUrl } = useLoaderData<typeof loader>();

  return (
    <div>
      <p>Welcome back {user?.firstName && `, ${user?.firstName}`}</p>
    </div>
  );
}
```

For pages where you want to display a signed-in and signed-out view, use `authkitLoader` to retrieve the user profile from WorkOS. You can pass in additional data by providing a loader function directly to `authkitLoader`.

```tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { Form, Link, useLoaderData } from '@remix-run/react';
import { getSignInUrl, getSignUpUrl, signOut, authkitLoader } from '@workos-inc/authkit-remix';

export const loader = (args: LoaderFunctionArgs) =>
  authkitLoader(args, async ({ request, auth }) => {
    return {
      signInUrl: await getSignInUrl(),
      signUpUrl: await getSignUpUrl(),
    };
  });

export async function action({ request }: ActionFunctionArgs) {
  return await signOut(request);
}

export default function HomePage() {
  const { user, signInUrl, signUpUrl } = useLoaderData<typeof loader>();

  if (!user) {
    return (
      <>
        <Link to={signInUrl}>Log in</Link>
        <br />
        <Link to={signUpUrl}>Sign Up</Link>
      </>
    );
  }

  return (
    <Form method="post">
      <p>Welcome back {user?.firstName && `, ${user?.firstName}`}</p>
      <button type="submit">Sign out</button>
    </Form>
  );
}
```

### Requiring auth

For pages where a signed-in user is mandatory, you can use the `ensureSignedIn` option:

```tsx
export const loader = (args: LoaderFunctionArgs) => authkitLoader(args, { ensureSignedIn: true });
```

Enabling `ensureSignedIn` will redirect users to AuthKit if they attempt to access the page without being authenticated.

### Signing out

Use the `signOut` method to sign out the current logged in user, end the session, and redirect to your app's homepage. The homepage redirect is set in your WorkOS dashboard settings under "Redirect".

If you would like to specify where a user is redirected, an optional `returnTo` argument can be passed. Allowed values are configured in the WorkOS Dashboard under _[Logout redirects](https://workos.com/docs/user-management/sessions/configuring-sessions/logout-redirect)_.

```ts
export async function action({ request }: ActionFunctionArgs) {
  // Called when the form in SignInButton is submitted
  return await signOut(request, { returnTo: 'https://example.com' });
}
```

### Get the access token

Access tokens are available through the `getAccessToken()` function within your loader. This design encourages server-side token usage while making the security implications explicit.

```tsx
import type { LoaderFunctionArgs } from '@remix-run/node';
import { authkitLoader } from '@workos-inc/authkit-remix';

export const loader = (args: LoaderFunctionArgs) =>
  authkitLoader(args, async ({ auth, getAccessToken }) => {
    if (!auth.user) {
      // Not signed in - getAccessToken() would return null
      return { data: null };
    }

    // Explicitly call the function to get the access token
    const accessToken = getAccessToken();
    
    const serviceData = await fetch('/api/path', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return {
      data: await serviceData.json(),
    };
  });
```

#### Security Considerations

By default, access tokens are not included in the data sent to React components. This helps prevent unintentional token exposure in:
- Browser developer tools
- HTML source code  
- Client-side logs or error reporting

If you need to expose the access token to client-side code, you can explicitly return it from your loader:

```tsx
export const loader = (args: LoaderFunctionArgs) =>
  authkitLoader(args, async ({ auth, getAccessToken }) => {
    const accessToken = getAccessToken();
    
    return {
      // Only expose to client if absolutely necessary
      accessToken,
      userData: await fetchUserData(accessToken)
    };
  }, { ensureSignedIn: true });
```

**Note:** Only expose access tokens to the client when necessary for your use case (e.g., making direct API calls from the browser). Consider alternatives like:
- Making API calls server-side in your loaders
- Creating proxy endpoints in your application
- Using separate client-specific tokens with limited scope

#### Using with `ensureSignedIn`

When using the `ensureSignedIn` option, you can be confident that `getAccessToken()` will always return a valid token:

```tsx
export const loader = (args: LoaderFunctionArgs) =>
  authkitLoader(args, async ({ auth, getAccessToken }) => {
    // With ensureSignedIn: true, the user is guaranteed to be authenticated
    const accessToken = getAccessToken();
    
    // Use the token for your API calls
    const data = await fetchProtectedData(accessToken);
    
    return { data };
  }, { ensureSignedIn: true });
```

### Using withAuth for low-level access

For advanced use cases, the `withAuth` function provides direct access to authentication data, including the access token. Unlike `authkitLoader`, this function:

- Does not handle automatic token refresh
- Does not manage cookies or session updates  
- Returns the access token directly as a property
- Requires manual redirect handling for unauthenticated users

```tsx
import { withAuth } from '@workos-inc/authkit-remix';
import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';

export const loader = async (args: LoaderFunctionArgs) => {
  const auth = await withAuth(args);
  
  if (!auth.user) {
    // Manual redirect - withAuth doesn't handle this automatically
    throw redirect('/sign-in');
  }
  
  // Access token is directly available as a property
  const { accessToken, user, sessionId } = auth;
  
  // Use the token for server-side operations
  const apiData = await fetch('https://api.example.com/data', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  
  // Be careful what you return - accessToken will be exposed if included
  return {
    user,
    apiData: await apiData.json(),
    // accessToken, // ⚠️ Only include if client-side access is necessary
  };
};
```

**When to use `withAuth` vs `authkitLoader`:**

- Use `authkitLoader` for most cases - it handles token refresh, cookies, and provides safer defaults
- Use `withAuth` when you need more control or are building custom authentication flows
- `withAuth` is useful for API routes or middleware where you don't need the full loader functionality

### Debugging

To enable debug logs, pass in the debug flag when using `authkitLoader`.

```ts
import { authkitLoader } from '@workos-inc/authkit-remix';

export const loader = (args: LoaderFunctionArgs) => authkitLoader(args, { debug: true });
```

If providing a loader function, you can pass the options object as the third parameter

```ts
import { authkitLoader } from '@workos-inc/authkit-remix';

export const loader = (args: LoaderFunctionArgs) =>
  authkitLoader(
    args,
    async ({ auth }) => {
      return { foo: 'bar' };
    },
    { debug: true },
  );
```

## Customizing Session Storage

By default, AuthKit for Remix uses cookie-based session storage with these settings:

```typescript
{
  name: "wos-session", // Default or WORKOS_COOKIE_NAME if set
  path: "/",
  httpOnly: true,
  secure: true, // When redirect URI uses HTTPS
  sameSite: "lax",
  maxAge: 34560000, // 400 days (configurable via WORKOS_COOKIE_MAX_AGE)
  secrets: [/* your cookie password, configurable via WORKOS_COOKIE_PASSWORD */],
}
```

### Custom Session Storage

You can provide your own session storage implementation to both `authkitLoader` and `authLoader`:

```typescript
import { createMemorySessionStorage } from "@remix-run/node";
import { authkitLoader, authLoader } from "@workos-inc/authkit-remix";

// Create memory-based session storage
const memoryStorage = createMemorySessionStorage({
  cookie: {
    name: "auth-session",
    secrets: ["test-secret"],
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    secure: false, // Use false for testing
    maxAge: 60 * 60 * 24 // 1 day
  }
});

// In your root loader
export const loader = (args) => authkitLoader(args, {
  storage: memoryStorage,
  cookie: { name: "auth-session" }
});

// In your callback route
export const loader = authLoader({
  storage: memoryStorage,
  cookie: { name: "auth-session" }
});
```

For code reuse and consistency, consider using a shared function:

```typescript
// app/lib/session.ts
export function getAuthStorage() {
  const storage = createCookieSessionStorage({/* config */});
  return { storage, cookie: { name: "my-custom-session" } };
}

// Then in your routes
import { getAuthStorage } from "~/lib/session";
export const loader = (args) => authkitLoader(args, {
  ...getAuthStorage(),
  // Other options...
});
```

> [!NOTE]
>When deploying to serverless environments like AWS Lambda, ensure you pass the same storage configuration to both your main routes and the callback route to handle cold starts properly.

AuthKit works with any session storage that implements Remix's `SessionStorage` interface, including Redis-based or database-backed implementations.
