import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

/**
 * Client-side route guarding is UX, not security: it stops the app
 * rendering a screen that would only show errors. The actual enforcement
 * is server-side (@PreAuthorize / URL rules) — anyone can bypass this
 * component with devtools, and the API must not care.
 *
 * `requireAdmin` gates the admin console the same way: a non-admin who
 * types /admin lands back on their songs instead of a page whose every
 * button 403s. The server's hasRole('ADMIN') is still the only thing
 * that decides.
 *
 * Both redirects below name a route deliberately: signed OUT goes to /login
 * (you need an account), while a signed-in non-admin goes to /songs — their
 * library, not "/" — because "/" is the landing page now and bouncing a
 * logged-in user onto the sales pitch is not "back where you were".
 */
export function ProtectedRoute({
  children,
  requireAdmin,
}: {
  children: ReactNode;
  requireAdmin?: boolean;
}) {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (requireAdmin && user.role !== "ADMIN") {
    return <Navigate to="/songs" replace />;
  }
  return children;
}
