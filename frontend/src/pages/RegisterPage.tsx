import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Button, Card, ErrorBanner, Field, TextInput } from "../ui/kit";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Server-side validation failures arrive as a field->message map (the
  // RestExceptionHandler collects ALL of them), so the form can annotate
  // each input instead of showing one generic banner.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      await register(email, password, displayName);
      navigate("/");
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFieldErrors(e.fieldErrors);
      } else {
        setError("Something went wrong");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-[82vh] w-full max-w-sm flex-col justify-center">
      <div className="mb-6 flex items-center justify-center gap-2 text-3xl font-extrabold tracking-tight">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-2 text-xl text-bg shadow-glow">
          ♪
        </span>
        <span className="bg-gradient-to-br from-accent to-accent-2 bg-clip-text text-transparent">
          Cotune
        </span>
      </div>

      <Card>
        <h2 className="mb-1 font-semibold">Create account</h2>
        <p className="mb-6 text-sm text-muted">One form away from your first beat.</p>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Display name" error={fieldErrors.displayName}>
            <TextInput
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="DJ Latenight"
              required
              maxLength={60}
            />
          </Field>
          <Field label="Email" error={fieldErrors.email}>
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@band.com"
              required
              autoComplete="email"
            />
          </Field>
          <Field label="Password" error={fieldErrors.password}>
            {/* minLength mirrors the server rule for instant feedback, but
                the server remains the authority — HTML attributes are
                trivially removable in devtools. */}
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8+ characters"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
            />
          </Field>
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link
          className="font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded"
          to="/login"
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}
