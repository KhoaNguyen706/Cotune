import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Button, Card, ErrorBanner, Field, TextInput } from "../ui/kit";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Disable the button while the request is in flight: double-submit on a
  // slow network is the classic way users fire duplicate requests.
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      // /songs, not "/": "/" is the landing page, and signing in only to be
      // shown the "Start a session" pitch again would be a joke at the
      // user's expense.
      navigate("/songs");
    } catch (e) {
      // The server's 401 message is deliberately vague ("Invalid email or
      // password") — we show it verbatim rather than "improving" it into
      // something that leaks which half was wrong.
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    // page-center: the auth screens are the one place a centered column is
    // right — there's no workspace to fill. Everything else is full-bleed.
    <main className="page-center flex-col">
      <div className="w-full max-w-sm">
      {/* The wordmark goes home. Every site trains you to click the logo to
          escape, and until the landing page existed there was nowhere to
          escape TO — now there is, so this stops being decoration. */}
      <Link
        to="/"
        aria-label="Cotune home"
        className="mb-6 flex items-center justify-center gap-2 rounded text-3xl font-extrabold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-2 text-xl text-bg shadow-glow">
          ♪
        </span>
        <span className="bg-gradient-to-br from-accent to-accent-2 bg-clip-text text-transparent">
          Cotune
        </span>
      </Link>

      <Card>
        <h2 className="mb-1 font-semibold">Sign in</h2>
        <p className="mb-6 text-sm text-muted">Make beats in the browser. Your bandmates are waiting.</p>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Email">
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@band.com"
              required
              autoComplete="email"
            />
          </Field>
          <Field label="Password">
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </Field>
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-center text-sm text-muted">
        No account?{" "}
        <Link
          className="font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded"
          to="/register"
        >
          Create one
        </Link>
      </p>
      </div>
    </main>
  );
}
