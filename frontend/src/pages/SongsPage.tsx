import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError, gql, rest } from "../api/client";
import { beatColor } from "../ui/trackColors";
import { coverFor } from "../ui/cover";
import { Button, EditableName, ErrorBanner, Field, Skeleton, TextInput } from "../ui/kit";
import { AppShell, Canvas, Modal, NavItem, NavRail, Workspace } from "../ui/shell";
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
  const navigate = useNavigate();
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
      <Workspace>
        <NavRail
          footer={
            <>
              {/* The account card: who am I, on what plan. Pinned to the
                  bottom of the rail because identity is ambient — always
                  available, never the thing you came here to do. */}
              <div className="flex items-center gap-3 rounded-xl border border-edge bg-bg-soft/60 p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-sm font-bold text-bg">
                  {user?.displayName?.[0]?.toUpperCase() ?? "?"}
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-sm font-bold">{user?.displayName}</span>
                  <span className="block text-xs text-muted">Free plan</span>
                </span>
              </div>
              <button
                onClick={logout}
                className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-muted transition-colors hover:bg-surface-2/60 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                Sign out
              </button>
            </>
          }
        >
          <div className="mb-4 flex items-center gap-3 px-1 py-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-2 text-base text-bg shadow-glow">
              ♪
            </span>
            <span className="text-lg font-extrabold tracking-tight">Cotune</span>
          </div>

          <NavItem icon="▤" label="My songs" active />
          {/* Rendered but inert: sharing and a sample library are real
              roadmap items (they need the collaborators table and an asset
              store). Showing them as "soon" is honest; wiring them to a
              blank page would not be. */}
          <NavItem icon="◎" label="Shared with me" soon />
          <NavItem icon="☰" label="Library" soon />
        </NavRail>

        <Canvas className="p-8">
          <div className="mx-auto max-w-[1400px]">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight">My songs</h1>
                <p className="mt-1 text-sm text-muted">
                  {loading
                    ? "Loading…"
                    : `${songs.length} song${songs.length === 1 ? "" : "s"} · sketches sync automatically`}
                </p>
              </div>
              <Button className="shadow-glow" onClick={() => setCreating(true)}>
                + New song
              </Button>
            </div>

            {error && <ErrorBanner>{error}</ErrorBanner>}

            {loading ? (
              // Skeletons mirror the CARD shape (art + two text lines) — no
              // spinner, no layout shift when the real grid lands.
              <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="overflow-hidden rounded-2xl border border-edge">
                    <Skeleton className="h-32 w-full rounded-none" />
                    <div className="flex flex-col gap-2 p-4">
                      <Skeleton className="h-5 w-1/2" />
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="h-6 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 p-0">
                {songs.map((song) => {
                  const cover = coverFor(song.id);
                  const mine = song.ownerId === user?.id;
                  const trackCount = song.beats.reduce((n, b) => n + b.tracks.length, 0);
                  return (
                    <li
                      key={song.id}
                      className="group relative overflow-hidden rounded-2xl border border-edge bg-surface transition-[transform,border-color] duration-200 hover:-translate-y-1 hover:border-edge-strong"
                    >
                      {/* Stretched link: the WHOLE card opens the song — a
                          300px target, not a 50px text link. Interactive
                          children sit above it via z-index. */}
                      <Link
                        to={`/songs/${song.id}`}
                        className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        aria-label={`Open ${song.title}`}
                      />

                      {/* -- waveform art --------------------------------
                          The art is `relative` but NOT overflow-hidden: the
                          play FAB below deliberately hangs over its bottom
                          edge, and clipping here would slice it in half.
                          The bars get their own clipped box instead. */}
                      <div className="relative h-32" style={{ background: cover.backdrop }}>
                        <div className="flex h-full items-center gap-[2px] overflow-hidden px-5">
                          {cover.bars.map((height, i) => (
                            <i
                              key={i}
                              // flex-1: the bars DIVIDE the card's width, so
                              // the waveform spans it edge to edge at any
                              // card size instead of huddling in the middle.
                              className="min-w-0 flex-1 rounded-full"
                              style={{
                                height: `${height}%`,
                                background: cover.accent,
                                // Falloff at the edges so the waveform reads
                                // as a clip, not a wall of bars.
                                opacity: 0.45 + 0.55 * Math.sin((i / cover.bars.length) * Math.PI),
                              }}
                            />
                          ))}
                        </div>

                        {/* Play FAB — opens the song in the editor. z-20 so
                            it beats the stretched link and keeps its own
                            label for screen readers. */}
                        <button
                          className="absolute -bottom-5 right-5 z-20 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 pl-0.5 text-sm text-bg shadow-glow transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                          title={`Open ${song.title} in the editor`}
                          aria-label={`Open ${song.title} in the editor`}
                          onClick={() => navigate(`/songs/${song.id}`)}
                        >
                          ▶
                        </button>
                      </div>

                      {/* -- body --------------------------------------- */}
                      <div className="p-5 pt-6">
                        <div className="flex items-center gap-2">
                          <strong className="min-w-0 truncate text-lg font-bold tracking-tight">
                            {mine ? (
                              // z-20: sits above the stretched link so
                              // double-click-to-rename still reaches it.
                              <span className="relative z-20">
                                <EditableName
                                  value={song.title}
                                  maxLength={120}
                                  onRename={(next) => onRename(song.id, next)}
                                />
                              </span>
                            ) : (
                              song.title
                            )}
                          </strong>
                          {mine && (
                            <span className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-accent">
                              yours
                            </span>
                          )}
                        </div>

                        <p className="mt-1 text-sm text-muted">
                          {song.bpm} BPM · {song.timeSignature} · {trackCount} track
                          {trackCount === 1 ? "" : "s"}
                        </p>

                        <div className="mt-4 flex items-center gap-2">
                          {[...song.beats]
                            // The API contract says: sort by position, never
                            // assume contiguity (gaps appear after deletes).
                            .sort((a, b) => a.position - b.position)
                            .slice(0, 3)
                            .map((beat) => {
                              const tint = beatColor(beat.position);
                              return (
                                <span
                                  key={beat.id}
                                  className="rounded-md px-2 py-1 text-xs font-bold"
                                  style={{
                                    color: tint,
                                    background: `color-mix(in srgb, ${tint} 14%, transparent)`,
                                    border: `1px solid color-mix(in srgb, ${tint} 35%, transparent)`,
                                  }}
                                >
                                  {beat.name}
                                </span>
                              );
                            })}
                          {song.beats.length === 0 && (
                            <span className="text-xs text-muted">no beats yet</span>
                          )}

                          {/* UI mirrors the server rule (owner-only) for
                              honest affordances; the real gate is
                              @PreAuthorize server-side. */}
                          {mine && (
                            <button
                              className="relative z-20 ml-auto cursor-pointer rounded px-1 text-sm font-medium text-muted opacity-0 transition-[color,opacity] duration-150 hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 group-hover:opacity-100"
                              onClick={() => void onDelete(song.id)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}

                {/* The create affordance lives IN the grid too, where your
                    eye already is after scanning the songs. */}
                <li>
                  <button
                    onClick={() => setCreating(true)}
                    className="flex h-full min-h-[240px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-edge text-muted transition-colors duration-150 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span className="text-3xl">+</span>
                    <span className="text-sm font-semibold">New song</span>
                  </button>
                </li>
              </ul>
            )}
          </div>
        </Canvas>
      </Workspace>

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
