import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AdminPage } from "./pages/AdminPage";
import { BeatMakerPage } from "./pages/BeatMakerPage";
import { HomePage } from "./pages/HomePage";
import { ListenPage } from "./pages/ListenPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SongsPage } from "./pages/SongsPage";
import { SettingsProvider } from "./ui/settings";

/**
 * ROUTING, and the one decision that shapes it: "/" is the LANDING PAGE, for
 * everyone, signed in or out (the owner's call). It is the front door of the
 * product, not a redirect — so the library needs a URL of its own, and that
 * is /songs.
 *
 * The alternative, which this replaced, was to render the library at "/" for
 * signed-in users. It needed no new routes, but it meant the landing page was
 * invisible to anyone who had ever logged in — including the person who owns
 * the app, who could only see their own front page in a private window.
 *
 * Consequences worth knowing, because they are easy to get half-right:
 *   - /songs must ALSO be registered in SpaForwardingController and
 *     SecurityConfig, or a hard refresh of it 404s server-side. React Router
 *     only exists once index.html has been served.
 *   - Everything that used to send people "home" after logging in now sends
 *     them to /songs — otherwise signing in would dump you on the marketing
 *     page you just came from.
 */
export function App() {
  return (
    // SettingsProvider wraps everything: it stamps data-theme on <html>, so
    // it must be mounted before any screen paints — including /login, which
    // lives outside AuthProvider's protected routes.
    <SettingsProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          {/* Public on purpose — the token in the URL is the authorization.
              Also registered in SpaForwardingController + SecurityConfig,
              or a hard refresh of the link 404s/403s server-side. */}
          <Route path="/listen/:token" element={<ListenPage />} />
          {/* The front door. Public, and public for everyone — a signed-in
              visitor sees the same page, with its nav pointing at their
              songs instead of at sign-up. */}
          <Route path="/" element={<HomePage />} />
          <Route
            path="/songs"
            element={
              <ProtectedRoute>
                <SongsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/songs/:songId"
            element={
              <ProtectedRoute>
                <BeatMakerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute requireAdmin>
                <AdminPage />
              </ProtectedRoute>
            }
          />
          {/* Unknown URLs fall back to home — no dead ends. Signed out,
              that's now the landing page rather than a login prompt. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </SettingsProvider>
  );
}
