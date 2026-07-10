import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";

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
      navigate("/");
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
    <main className="auth-shell">
      <div className="brand">
        <span className="brand-mark">♪</span> Cotune
      </div>
      <div className="card">
        <h2>Sign in</h2>
        <p className="sub">Make beats in the browser. Your bandmates are waiting.</p>
        <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
      <p>
        No account? <Link to="/register">Create one</Link>
      </p>
    </main>
  );
}
