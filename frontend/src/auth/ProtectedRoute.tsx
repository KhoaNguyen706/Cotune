import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

/**
 * Client-side route guarding is UX, not security: it stops the app
 * rendering a screen that would only show errors. The actual enforcement
 * is server-side (@PreAuthorize / URL rules) — anyone can bypass this
 * component with devtools, and the API must not care.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
