'use client';

/**
 * AuthContext.tsx — Provides a React Context for sharing the logout function
 * throughout the component tree without polluting the global window object.
 *
 * Security fix (F-10): Replaces the `window.__adminLogout` global that was
 * exposed and callable by any XSS payload. Using Context restricts access to
 * React component tree only.
 *
 * Usage:
 *   - Wrap your component tree in <AuthProvider onLogout={fn}>
 *   - Call `const { logout } = useAuth()` in any child component
 */

import React, { createContext, useContext } from 'react';

interface AuthContextValue {
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Hook to access the auth context. Must be used inside <AuthProvider>.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() must be called inside an <AuthProvider> component.');
  }
  return ctx;
}

/**
 * Provider that makes the logout function available to all child components.
 */
export function AuthProvider({
  children,
  onLogout,
}: {
  children: React.ReactNode;
  onLogout: () => Promise<void>;
}) {
  return (
    <AuthContext.Provider value={{ logout: onLogout }}>
      {children}
    </AuthContext.Provider>
  );
}
