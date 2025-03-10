import { createContext, useContext, type ReactNode } from 'react';
import type { AuthorizedData, UnauthorizedData } from '../interfaces.js';

type AuthContextType = AuthorizedData | UnauthorizedData;

const AuthContext = createContext<AuthContextType | null>(null);

export interface AuthKitProviderProps {
  children: ReactNode;
  loaderData: AuthorizedData | UnauthorizedData;
}

export function AuthKitProvider({ children, loaderData }: AuthKitProviderProps) {
  return <AuthContext.Provider value={loaderData}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthKitProvider');
  }

  return context;
}
