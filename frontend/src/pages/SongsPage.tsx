import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError, gql, rest } from "../api/client";
import { colorFor } from "../ui/trackColors";
import { coverFor } from "../ui/cover";
import { Button, EditableName, ErrorBanner, Field, Skeleton, TextInput } from "../ui/kit";
import { AppShell, Canvas, IconButton, Modal, TopBar } from "../ui/shell";
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

  const [creating, setCreating] = useState(false); // modal open?
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
      setCreating(false);
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
      setError(
        e instanceof ApiError && e.status === 403
          ? "Only the song's creator can delete it"
          : "Failed to delete song",
      );
    }
  }

  return (
    <AppShell>
      <TopBar
        left={
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-2 text-base text-bg shadow-glow">
              ♪
            </span>
            <span className="bg-gradient-to-br from-accent to-accent-2 bg-clip-text text-lg font-extrabold tracking-tight text-transparent">
              Cotune
            </span>
          </span>
        }
        right={
          <>
            <Button onClick={() => setCreating(true)}>+ New song</Button>
            <span className="ml-2 flex items-center gap-2 border-l border-edge pl-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-sm font-bold text-text">
                {user?.displayName?.[0]?.toUpperCase() ?? "?"}
              </span>
              <span className="hidden text-sm text-muted sm:inline">{user?.displayName}</span>
              <IconButton onClick={logout} title="Sign out" aria-label="Sign out">
                ⏻
              </IconButton>
            </span>
          </>
        }
      />

      <Canvas className="p-8">
        {/* A real max-width, and only to stop lines from getting absurd on
            ultrawides — the grid still fills a 1440 screen, which the old
            max-w-3xl column did not. */}
        <div className="mx-auto max-w-[1600px]">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">Your songs</h1>
              <p className="text-sm text-muted">
                {loading ? "Loading…" : `${songs.length} song${songs.length === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>

          {error && <ErrorBanner>{error}</ErrorBanner>}

          {loading ? (
            // Skeletons mirror the CARD shape (cover + two text lines) — no
            // spinner, no layout shift when the real grid lands.
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex flex-col gap-3">
                  <Skeleton className="aspect-square w-full rounded-xl" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              ))}
            </div>
          ) : (
            <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5 p-0">
              {songs.map((song) => {
                const cover = coverFor(song.id);
                const mine = song.ownerId === user?.id;
                const lanes = song.beats.flatMap((b) => b.tracks);
                return (
                  <li key={song.id} className="group relative">
                    {/* The WHOLE card is the link (stretched-link pattern):
                        a 220px target instead of a 50px "Open →" text link.
                        Interactive children below sit above it via z-index. */}
                    <Link
                      to={`/songs/${song.id}`}
                      className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      aria-label={`Open ${song.title}`}
                    />
                    <div
                      className="relative mb-3 flex aspect-square items-end overflow-hidden rounded-xl border border-edge shadow-card transition-transform duration-200 group-hover:-translate-y-1"
                      style={{ backgroundImage: cover.backgroundImage }}
                    >
                      {/* Play affordance on hover — the card looks like it
                          DOES something, which a flat gradient does not. */}
                      <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-lg text-black shadow-lg">
                          ▶
                        </span>
                      </span>

                      {/* Instrument dots = the song's actual contents, read
                          at a glance without opening it. */}
                      <span className="relative flex w-full items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8">
                        {lanes.slice(0, 8).map((lane) => (
                          <i
                            key={lane.id}
                            className="h-1.5 w-1.5 rounded-full ring-1 ring-black/30"
                            style={{ background: colorFor(lane.instrument) }}
                          />
                        ))}
                        {lanes.length === 0 && (
                          <span className="text-[0.65rem] font-semibold text-white/70">empty</span>
                        )}
                      </span>

                      {mine && (
                        // z-20: above the stretched link, or it would never
                        // receive the click.
                        <span className="absolute right-2 top-2 z-20 opacity-0 transition-opacity group-hover:opacity-100">
                          <IconButton
                            tone="danger"
                            className="bg-black/50 backdrop-blur-sm hover:bg-black/70"
                            title="Delete song"
                            onClick={() => void onDelete(song.id)}
                          >
                            🗑
                          </IconButton>
                        </span>
                      )}
                    </div>

                    <div className="relative z-20 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm font-semibold tracking-tight">
                          {mine ? (
                            <EditableName
                              value={song.title}
                              maxLength={120}
                              onRename={(next) => onRename(song.id, next)}
                            />
                          ) : (
                            song.title
                          )}
                        </strong>
                        <span className="text-xs text-muted">
                          {song.bpm} BPM · {song.timeSignature}
                          {song.beats.length > 0 &&
                            ` · ${song.beats.length} beat${song.beats.length === 1 ? "" : "s"}`}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}

              {/* The create affordance lives IN the grid, where your eye
                  already is after scanning the songs — instead of a
                  permanent form block above them. */}
              <li>
                <button
                  onClick={() => setCreating(true)}
                  className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-edge text-muted transition-colors duration-150 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="text-3xl">+</span>
                  <span className="text-sm font-semibold">New song</span>
                </button>
              </li>
            </ul>
          )}
        </div>
      </Canvas>

      {creating && (
        <Modal title="New song" onClose={() => setCreating(false)}>
          <form onSubmit={onCreate} className="flex flex-col gap-4">
            <Field label="Title">
              <TextInput
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Midnight Sketch"
                required
                maxLength={120}
              />
            </Field>
            <div className="flex gap-4">
              <div className="flex-1">
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
              <div className="flex-1">
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
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create song"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </AppShell>
  );
}
