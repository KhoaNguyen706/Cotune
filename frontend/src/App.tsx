import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { BeatMakerPage } from "./pages/BeatMakerPage";
import { ListenPage } from "./pages/ListenPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SongsPage } from "./pages/SongsPage";
import { SettingsProvider } from "./ui/settings";

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
          <Route
            path="/"
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
          {/* Unknown URLs fall back to home (which itself redirects to
              /login when signed out) — no dead ends. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </SettingsProvider>
  );
}
