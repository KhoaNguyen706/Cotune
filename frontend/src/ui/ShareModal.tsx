import { useState, type FormEvent } from "react";
import { ApiError, gql } from "../api/client";
import { Button, ErrorBanner, Field, Select, TextInput } from "./kit";
import { Modal } from "./shell";
import type { Collaborator, CollaboratorRole, Song } from "../types";

/**
 * The share sheet. Invite by email, set a role, revoke.
 *
 * It renders only for the OWNER (SongsPage gates it on myRole), and that is
 * an affordance decision, not a security one — the server refuses shareSong
 * from anyone else regardless of what the UI draws. The rule is: the client
 * hides what the server would refuse, so the user never meets a button that
 * cannot work. It does NOT get to decide who may share.
 */

const SHARE = `
  mutation Share($input: ShareSongInput!) {
    shareSong(input: $input) { userId email displayName role }
  }
`;

const UNSHARE = `
  mutation Unshare($songId: ID!, $userId: ID!) {
    unshareSong(songId: $songId, userId: $userId)
  }
`;

const ENABLE_LISTEN_LINK = `
  mutation EnableListenLink($songId: ID!) {
    enableListenLink(songId: $songId)
  }
`;

const DISABLE_LISTEN_LINK = `
  mutation DisableListenLink($songId: ID!) {
    disableListenLink(songId: $songId)
  }
`;

const ROLE_HELP: Record<CollaboratorRole, string> = {
  EDITOR: "Can change the music",
  VIEWER: "Can listen, but not edit",
};

export function ShareModal({
  song,
  onClose,
  onChanged,
}: {
  song: Song;
  onClose: () => void;
  /** Re-query the library so the card's collaborator list stays true. */
  onChanged: () => Promise<void> | void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CollaboratorRole>("EDITOR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local, seeded from the prop: the mutations return the truth directly,
  // so the section updates instantly instead of waiting on the library
  // refetch to flow a new `song` prop down.
  const [listenToken, setListenToken] = useState(song.listenToken ?? null);
  const [copied, setCopied] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (e) {
      // The server's message is the useful one here ("No Cotune account for
      // …", "You already own this song"), so surface it rather than replacing
      // it with a generic string that tells the user nothing actionable.
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await gql(SHARE, { input: { songId: song.id, email, role } });
      setEmail("");
    });
  }

  // Sharing again with an existing collaborator UPDATES their role — the
  // server treats it as an upsert — so the role dropdown on each row can
  // reuse the invite mutation instead of needing one of its own.
  const changeRole = (person: Collaborator, next: CollaboratorRole) =>
    run(() => gql(SHARE, { input: { songId: song.id, email: person.email, role: next } }));

  const revoke = (person: Collaborator) =>
    run(() => gql(UNSHARE, { songId: song.id, userId: person.userId }));

  const enableLink = () =>
    run(async () => {
      const data = await gql<{ enableListenLink: string }>(ENABLE_LISTEN_LINK, { songId: song.id });
      setListenToken(data.enableListenLink);
    });

  const disableLink = () =>
    run(async () => {
      await gql(DISABLE_LISTEN_LINK, { songId: song.id });
      setListenToken(null);
      setCopied(false);
    });

  const listenUrl = listenToken ? `${window.location.origin}/listen/${listenToken}` : null;

  async function copyLink() {
    if (!listenUrl) return;
    try {
      await navigator.clipboard.writeText(listenUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be denied (permissions, http origin); the URL is
      // visible in the box either way — the user can select it by hand.
    }
  }

  return (
    <Modal title={`Share "${song.title}"`} onClose={onClose}>
      <form onSubmit={onInvite} className="flex flex-col gap-4">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Invite by email">
              <TextInput
                autoFocus
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="bandmate@example.com"
              />
            </Field>
          </div>
          <div className="w-36 shrink-0">
            <Field label="Access">
              <Select value={role} onChange={(e) => setRole(e.target.value as CollaboratorRole)}>
                <option value="EDITOR">Can edit</option>
                <option value="VIEWER">Can view</option>
              </Select>
            </Field>
          </div>
          <Button type="submit" disabled={busy || email.trim() === ""} className="mb-0.5">
            {busy ? "…" : "Invite"}
          </Button>
        </div>

        <p className="-mt-2 text-xs text-muted">{ROLE_HELP[role]}. They must have a Cotune account.</p>
      </form>

      <div className="mt-6 flex flex-col gap-3 border-t border-edge pt-5">
        <h3 className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-muted">
          People with access
        </h3>

        {/* The owner is not a collaborator row — they're the owner. Showing
            them in the list with a revoke button next to their name would
            imply an action that cannot exist. */}
        <div className="flex items-center gap-3">
          <Avatar name="You" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-semibold">You</span>
            <span className="block text-xs text-muted">Owner · full access</span>
          </span>
        </div>

        {song.collaborators.map((person) => (
          <div key={person.userId} className="flex items-center gap-3">
            <Avatar name={person.displayName} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold">{person.displayName}</span>
              <span className="block truncate text-xs text-muted">{person.email}</span>
            </span>
            {/* The width lives on a WRAPPER, not on the Select. Select carries
                w-full from the kit, and a `w-28` passed through className does
                not reliably beat it — Tailwind resolves that collision by
                stylesheet order, not by the order you wrote the classes in. It
                lost, the dropdown went full-width, and it squeezed the name
                column to zero. Same wrapper pattern as the invite row above. */}
            <div className="w-28 shrink-0">
              <Select
                aria-label={`Access for ${person.displayName}`}
                className="py-1 text-xs"
                disabled={busy}
                value={person.role}
                onChange={(e) => void changeRole(person, e.target.value as CollaboratorRole)}
              >
                <option value="EDITOR">Can edit</option>
                <option value="VIEWER">Can view</option>
              </Select>
            </div>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              aria-label={`Remove ${person.displayName}`}
              onClick={() => void revoke(person)}
            >
              Remove
            </Button>
          </div>
        ))}

        {song.collaborators.length === 0 && (
          <p className="text-sm text-muted">Nobody else yet — this song is private to you.</p>
        )}
      </div>

      {/* The growth loop: a link anyone can LISTEN to, no account. Distinct
          from collaborator access above — a listener is not a member, they
          hold a revocable capability. */}
      <div className="mt-6 flex flex-col gap-3 border-t border-edge pt-5">
        <h3 className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-muted">
          Public listen link
        </h3>

        {listenUrl ? (
          <>
            <div className="flex items-center gap-2">
              <TextInput
                readOnly
                value={listenUrl}
                aria-label="Public listen link"
                onFocus={(e) => e.currentTarget.select()}
                className="text-xs"
              />
              <Button size="sm" disabled={busy} onClick={() => void copyLink()}>
                {copied ? "Copied!" : "Copy"}
              </Button>
              <Button variant="danger" size="sm" disabled={busy} onClick={() => void disableLink()}>
                Turn off
              </Button>
            </div>
            <p className="-mt-1 text-xs text-muted">
              Anyone with this link can listen — no account needed. Turning it off kills every
              copy; turning it back on makes a fresh link.
            </p>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={busy} onClick={() => void enableLink()}>
              Create listen link
            </Button>
            <p className="text-xs text-muted">Let anyone hear this song — read-only, no account.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-xs font-bold text-bg">
      {name[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
