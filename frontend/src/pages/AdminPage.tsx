import { useState, type FormEvent } from "react";
import { ApiError, gql } from "../api/client";
import { AppNav } from "../ui/AppNav";
import { Button, Card, Field, TextInput } from "../ui/kit";
import { AppShell, Canvas, Workspace } from "../ui/shell";

// The two ADMIN-gated mutations already exist server-side (AiAccessGraphql
// Controller) and take an EMAIL directly — a UUID isn't something an admin
// can type. This page is the surface for them; it decides nothing, the
// @PreAuthorize("hasRole('ADMIN')") on the server is the real gate.
const GRANT_AI_ACCESS = `
  mutation GrantAiAccess($email: String!) {
    grantAiAccess(email: $email)
  }
`;

const REVOKE_AI_ACCESS = `
  mutation RevokeAiAccess($email: String!) {
    revokeAiAccess(email: $email)
  }
`;

type Result = { kind: "ok" | "err"; text: string } | null;

/**
 * The admin console — currently one job: hand out (and take back) the AI
 * invitation by email. Route-gated to admins in App.tsx, but the buttons
 * would 403 for anyone else anyway; the client gate is affordance, the
 * server's hasRole('ADMIN') is enforcement (same split as every other
 * surface in the app).
 */
export function AdminPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function run(mutation: string, verb: "Granted" | "Revoked", event: FormEvent) {
    event.preventDefault();
    const target = email.trim();
    if (!target || busy) return;
    setBusy(true);
    setResult(null);
    try {
      await gql(mutation, { email: target });
      setResult({ kind: "ok", text: `${verb} AI access for ${target}.` });
      setEmail("");
    } catch (e) {
      setResult({
        kind: "err",
        text:
          e instanceof ApiError
            ? e.status === 404
              ? `No account found for ${target}.`
              : e.message
            : "Something went wrong — try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <Workspace>
        <AppNav />

        <Canvas className="p-8 max-md:p-4">
          <div className="mx-auto max-w-2xl">
            <div className="mb-8">
              <h1 className="text-3xl font-extrabold tracking-tight">Admin</h1>
              <p className="mt-1 text-sm text-muted">
                Invite people to the AI features — the @ai chat advisor and pattern generation.
                Admins always have access; everyone else needs an invite here.
              </p>
            </div>

            <Card>
              <h2 className="text-lg font-bold tracking-tight">AI access</h2>
              <p className="mt-1 text-sm text-muted">
                Enter the email of a registered account. The change takes effect the next time they
                open the app.
              </p>

              <form className="mt-5 flex flex-col gap-4">
                <Field label="Account email">
                  <TextInput
                    type="email"
                    autoFocus
                    placeholder="collaborator@example.com"
                    value={email}
                    disabled={busy}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={busy || email.trim().length === 0}
                    onClick={(e) => run(GRANT_AI_ACCESS, "Granted", e)}
                  >
                    {busy ? "Working…" : "Grant access"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy || email.trim().length === 0}
                    onClick={(e) => run(REVOKE_AI_ACCESS, "Revoked", e)}
                  >
                    Revoke
                  </Button>
                </div>
              </form>

              {result && (
                <p
                  role="status"
                  className={
                    result.kind === "ok"
                      ? "mt-4 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm text-accent"
                      : "mt-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger"
                  }
                >
                  {result.text}
                </p>
              )}
            </Card>
          </div>
        </Canvas>
      </Workspace>
    </AppShell>
  );
}
