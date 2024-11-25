import { OauthTokens, User } from '@workos-inc/node';

export interface HandleAuthOptions {
  returnPathname?: string;
}

export interface Impersonator {
  email: string;
  reason: string | null;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: User;
  impersonator?: Impersonator;
  headers: Record<string, string>;
}

export interface AccessToken {
  sid: string;
  org_id?: string;
  role?: string;
  permissions?: string[];
}

export interface GetAuthURLOptions {
  screenHint?: 'sign-up' | 'sign-in';
  returnPathname?: string;
}

export interface AuthKitLoaderOptions {
  ensureSignedIn?: boolean;
  debug?: boolean;
}

export interface AuthorizedData {
  user: User;
  sessionId: string;
  accessToken: string;
  organizationId: string | null;
  role: string | null;
  permissions: string[];
  impersonator: Impersonator | null;
  sealedSession: string;
}

export interface UnauthorizedData {
  user: null;
  sessionId: null;
  accessToken: null;
  organizationId: null;
  role: null;
  permissions: null;
  impersonator: null;
  sealedSession: null;
}
