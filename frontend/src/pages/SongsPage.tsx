import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError, gql, rest } from "../api/client";
import { colorFor } from "../ui/trackColors";
import { Button, Card, Chip, EditableName, EmptyState, ErrorBanner, Field, Skeleton, TextInput } from "../ui/kit";
import type { Song } from "../types";

// Queries live next to the component that owns them; each asks for exactly
// the fields this screen renders — that per-view field selection is the
// actual point of GraphQL (no over-fetching, no v2-endpoint-per-screen).
const SONGS_QUERY = `
  query Songs {
    songs {
      id title bpm timeSignature ownerId version createdAt
      beats { id name position tracks { id instrument position } }
    }
  }
`;

const CREATE_SONG = `
  mutation CreateSong($input: CreateSongInput!) {
    createSong(input: $input) { id }
  }
`;

const DELETE_SONG = `
  mutation DeleteSong($id: ID!) {
    deleteSong(id: $id)
  }
`;

export function SongsPage() {
  const { user, logout } = useAuth();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [bpm, setBpm] = useState(120);
  const [timeSignature, setTimeSignature] = useState("4/4");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await gql<{ songs: Song[] }>(SONGS_QUERY);
      setSongs(data.songs);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load songs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await gql(CREATE_SONG, { input: { title, bpm, timeSignature } });
      setTitle("");
      // Re-query instead of hand-patching local state: one source of truth
      // (the server), and we automatically see songs other collaborators
      // created — a habit that matters once real-time editing arrives.
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create song");
    } finally {
      setBusy(false);
    }
  }

  // Rename rides on REST (PATCH /api/songs/{id}) — single-field updates
  // don't need the graph. Patch local state on success: the server
  // confirmed exactly this change, no need for a full re-query.
  async function onRename(id: string, newTitle: string) {
    setError(null);
    try {
      await rest(`/api/songs/${id}`, { method: "PATCH", body: { title: newTitle } });
      setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, title: newTitle } : s)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to rename song");
    }
  }

  async function onDelete(id: string) {
    setError(null);
    try {
      await gql(DELETE_SONG, { id });
      await refresh();
    } catch (e) {
      // Shouldn't normally happen (the button only renders for the owner),
      // but the SERVER is the enforcement — this catch is for devtools
      // adventurers and stale pages.
      setError(e instanceof ApiError && e.status === 403
        ? "Only the song's creator can delete it"
        : "Failed to delete song");
    }
  }

  return (
    <main className="w-full max-w-3xl">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="bg-gradient-to-br from-accent to-accent-2 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
          Cotune
        </h1>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-sm font-bold text-bg">
            {user?.displayName?.[0]?.toUpperCase() ?? "?"}
          </span>
          <span className="mr-2 text-sm text-muted">{user?.displayName}</span>
          <Button variant="ghost" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>
      </header>

      <Card className="mb-4">
        <h2 className="mb-4 font-semibold">New song</h2>
        <form onSubmit={onCreate} className="flex flex-wrap items-end gap-4">
          <div className="min-w-48 flex-1">
            <Field label="Title">
              <TextInput
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Midnight Sketch"
                required
                maxLength={120}
              />
            </Field>
          </div>
          <div className="w-24">
            <Field label="BPM">
              <TextInput
                type="number"
                min={20}
                max={400}
                value={bpm}
                onChange={(e) => setBpm(Number(e.target.value))}
                required
              />
            </Field>
          </div>
          <div className="w-28">
            <Field label="Time sig">
              <TextInput
                value={timeSignature}
                onChange={(e) => setTimeSignature(e.target.value)}
                required
                pattern="\d{1,2}/\d{1,2}"
                title="e.g. 4/4"
              />
            </Field>
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </form>
      </Card>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <h2 className="mb-4 font-semibold">Songs</h2>

      {loading ? (
        // Skeletons mirror the card shape — no spinner, no layout shift.
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <div className="flex items-center gap-4">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-6 w-12" />
              </div>
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-6 w-20" />
              </div>
            </Card>
          ))}
        </div>
      ) : songs.length === 0 ? (
        <Card>
          <EmptyState
            icon="🎛️"
            title="No songs yet"
            hint='Every track starts with a first beat. Name one above — "Midnight Sketch" at 120 BPM is a classic place to begin.'
          />
        </Card>
      ) : (
        <ul className="flex list-none flex-col gap-4 p-0">
          {songs.map((song) => (
            <li key={song.id}>
              <Card className="transition-[transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-edge-strong">
                <div className="flex flex-wrap items-center gap-4">
                  <strong className="text-base tracking-tight">
                    <EditableName
                      value={song.title}
                      maxLength={120}
                      onRename={(next) => onRename(song.id, next)}
                    />
                  </strong>
                  <span className="flex flex-1 gap-2">
                    <Chip>{song.bpm} BPM</Chip>
                    <Chip>{song.timeSignature}</Chip>
                    {song.ownerId === user?.id && <Chip tone="accent">yours</Chip>}
                  </span>
                  <Link
                    className="rounded text-sm font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    to={`/songs/${song.id}`}
                  >
                    Open →
                  </Link>
                  {/* UI mirrors the server rule (owner-only) for honest
                      affordances; the real gate is @PreAuthorize server-side. */}
                  {song.ownerId === user?.id && (
                    <Button variant="danger" size="sm" onClick={() => void onDelete(song.id)}>
                      Delete
                    </Button>
                  )}
                </div>
                {song.beats.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {[...song.beats]
                      // The API contract says: sort by position, never
                      // assume contiguity (gaps appear after deletes).
                      .sort((a, b) => a.position - b.position)
                      .map((beat) => (
                        <span
                          key={beat.id}
                          className="inline-flex items-center gap-2 rounded-full border border-edge bg-bg-soft px-2 py-0.5 text-xs text-muted"
                        >
                          <span className="inline-flex gap-1">
                            {[...beat.tracks]
                              .sort((a, b) => a.position - b.position)
                              .map((track) => (
                                <i
                                  key={track.id}
                                  className="h-2 w-2 rounded-full"
                                  style={{ background: colorFor(track.instrument) }}
                                />
                              ))}
                          </span>
                          {beat.name}
                        </span>
                      ))}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
