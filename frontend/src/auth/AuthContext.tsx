import { createContext, useContext, useState, type ReactNode } from "react";
import type { AuthPayload, User } from "../types";
import { clearSession, loadSession, rest, saveSession } from "../api/client";

interface AuthContextValue {
  user: User | null;
  register(email: string, password: string, displayName: string): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): void;
}

// Context, because auth state is needed by nearly every screen: prop-drilling
// `user` through every component is the frontend version of passing a
// parameter through ten methods that don't use it.
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Lazy initializer: read localStorage ONCE on mount, not on every render.
  const [user, setUser] = useState<User | null>(() => loadSession()?.user ?? null);

  async function register(email: string, password: string, displayName: string) {
    const session = await rest<AuthPayload>("/api/auth/register", {
      method: "POST",
      body: { email, password, displayName },
    });
    saveSession(session);
    setUser(session.user);
  }

  async function login(email: string, password: string) {
    const session = await rest<AuthPayload>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    saveSession(session);
    setUser(session.user);
  }

  // "Sign out" with JWTs is purely client-side: the server keeps no session
  // to destroy (that's what stateless means), so logging out = forgetting
  // the token. The token itself stays technically valid until it expires —
  // the trade-off documented in JwtService, seen from the client's side.
  function logout() {
    clearSession();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  // Fail loudly at development time if a component is used outside the
  // provider — the alternative is `user` mysteriously null forever.
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
