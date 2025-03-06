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
  // Other supported values include `sessionId`, `accessToken`, `organizationId`,
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
import { json } from '@remix-run/node';
import { Form, Link, useLoaderData } from '@remix-run/react';
import { getSignInUrl, getSignUpUrl, signOut, authkitLoader } from '@workos-inc/authkit-remix';

export const loader = (args: LoaderFunctionArgs) =>
  authkitLoader(args, async ({ request, auth }) => {
    return json({
      signInUrl: await getSignInUrl(),
      signUpUrl: await getSignUpUrl(),
    });
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

### Get the access token

Sometimes it is useful to obtain the access token directly, for instance to make API requests to another service.

```tsx
import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authkitLoader } from '@workos-inc/authkit-remix';

export const loader = (args: LoaderFunctionArgs) =>
  authkitLoader(args, async ({ auth }) => {
    const { accessToken } = auth;

    if (!accessToken) {
      // Not signed in
    }

    const serviceData = await fetch('/api/path', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return json({
      data: serviceData,
    });
  });
```

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
      return json({ foo: 'bar' });
    },
    { debug: true },
  );
```
