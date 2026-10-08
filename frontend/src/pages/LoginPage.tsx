import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { type LoginFields, validateLogin } from "../auth/validateLogin";
import { Button, Card, ErrorBanner, Field, TextInput, Wordmark } from "../ui/kit";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<LoginFields>>({});
  // Errors appear on the first SUBMIT, not while the user is still typing
  // their address — then re-check on every keystroke so each message
  // clears the moment the field is fixed.
  const [submitted, setSubmitted] = useState(false);
  // Disable the button while the request is in flight: double-submit on a
  // slow network is the classic way users fire duplicate requests.
  const [busy, setBusy] = useState(false);

  function onChange(next: LoginFields) {
    setEmail(next.email);
    setPassword(next.password);
    if (submitted) setFieldErrors(validateLogin(next));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitted(true);
    const errors = validateLogin({ email, password });
    setFieldErrors(errors);
    const firstInvalid = (["email", "password"] as const).find((k) => errors[k]);
    if (firstInvalid) {
      // Keyboard and screen-reader users land on the field to fix.
      (event.currentTarget.elements.namedItem(firstInvalid) as HTMLInputElement | null)?.focus();
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
      // /songs, not "/": "/" is the landing page, and signing in only to be
      // shown the "Start a session" pitch again would be a joke at the
      // user's expense.
      navigate("/songs");
    } catch (e) {
      // The server's 401 message is deliberately vague ("Invalid email or
      // password") — we show it verbatim rather than "improving" it into
      // something that leaks which half was wrong.
      setError(e instanceof ApiError ? e.message : "Something went wrong");
      // The server is still the authority: a 400 carries per-field
      // messages (errors.email) that annotate the inputs like ours do.
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
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
        className="mb-6 flex justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <Wordmark size="lg" />
      </Link>

      <Card>
        <h1 className="mb-6 text-lg font-semibold">Sign in</h1>
        {/* noValidate: our inline messages replace the browser's bubbles,
            which differ per browser and vanish after a second. type, required
            and autoComplete stay for mobile keyboards and password managers. */}
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field label="Email" error={fieldErrors.email}>
            <TextInput
              name="email"
              type="email"
              value={email}
              onChange={(e) => onChange({ email: e.target.value, password })}
              placeholder="you@example.com"
              required
              aria-invalid={!!fieldErrors.email}
              maxLength={320}
              autoComplete="email"
            />
          </Field>
          <Field label="Password" error={fieldErrors.password}>
            <TextInput
              name="password"
              type="password"
              value={password}
              onChange={(e) => onChange({ email, password: e.target.value })}
              placeholder="••••••••"
              required
              aria-invalid={!!fieldErrors.password}
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
