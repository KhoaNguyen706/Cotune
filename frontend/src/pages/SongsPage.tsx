import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, gql, rest } from "../api/client";
import { AppNav } from "../ui/AppNav";
import { beatColor } from "../ui/trackColors";
import { coverFor } from "../ui/cover";
import { Button, EditableName, ErrorBanner, Field, Skeleton, TextInput } from "../ui/kit";
import { PlusIcon, SearchIcon } from "../ui/icons";
import { AppShell, Canvas, Modal, Workspace } from "../ui/shell";
import { ShareModal } from "../ui/ShareModal";
import { canEditSong, type Song } from "../types";

// Queries live next to the component that owns them; each asks for exactly
// the fields this screen renders — that per-view field selection is the
// actual point of GraphQL (no over-fetching, no v2-endpoint-per-screen).
// `bars` and each lane's `pattern` are here for the card's WAVEFORM: it is
// a real histogram of note density, not decoration (see ui/cover.ts). This
// is exactly the field-selection GraphQL exists for — the editor's query
// asks for the same graph with more of it.
// `songs` returns YOUR library — songs you own plus songs shared with you.
// The split into "My songs" / "Shared with me" below is a view over this one
// response, not a second request: the server already told us our role on each
// song, so filtering by it locally costs nothing and keeps both lists in sync.
const SONGS_QUERY = `
  query Songs {
    songs {
      id title bpm timeSignature ownerId myRole version createdAt listenToken
      collaborators { userId email displayName role }
      beats {
        id name position bars
        tracks { id name instrument position version pattern { step pitch velocity length } }
      }
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

/** Which slice of the library is on screen. Both come from the same query. */
type View = "mine" | "shared";

/**
 * Filter the library by what you typed.
 *
 * CLIENT-SIDE, and that is a decision with a shelf life. `songs` is already
 * in memory — the whole library, with its beats, fetched in one query — so
 * a server round trip per keystroke would be slower AND would need a new
 * endpoint to answer a question the browser can already answer. It stops
 * being right at the point where the library no longer fits in one query;
 * the same day the grid needs pagination, this needs to move to the server.
 *
 * It matches BEAT NAMES as well as titles because the placeholder promises
 * "songs and beats" — a search box that quietly ignores half its own label
 * is worse than one that never mentioned beats.
 */
function matching(songs: Song[], query: string): Song[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return songs;
  return songs.filter(
    (song) =>
      song.title.toLowerCase().includes(needle) ||
      song.beats.some((beat) => beat.name.toLowerCase().includes(needle)),
  );
}

export function SongsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // The view is part of the URL (see AppNav), so the nav can link to it.
  const view: View = params.get("view") === "shared" ? "shared" : "mine";
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The search box. Not in the URL: a filter you typed is a glance, not a
   *  place — you don't bookmark it and you don't want Back to walk you out
   *  of it one letter at a time. */
  const [query, setQuery] = useState("");

  const [creating, setCreating] = useState(false); // modal open?
  /**
   * The share sheet tracks a song ID, not a Song object. Holding the object
   * would freeze a copy: after an invite we re-query, `songs` gets a fresh
   * list, and the modal would still be rendering the snapshot it captured
   * when it opened — so the person you just added wouldn't appear until you
   * closed and reopened it. Looking the song up by id each render keeps the
   * modal reading the same state everything else does.
   */
  const [sharingId, setSharingId] = useState<string | null>(null);
  /** Same id-not-object rule for the two other per-card actions. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  // One query, two views. `myRole` is the server's answer, not our guess.
  const mine = songs.filter((song) => song.myRole === "OWNER");
  const shared = songs.filter((song) => song.myRole !== "OWNER");
  const sharing = songs.find((song) => song.id === sharingId) ?? null;
  const deleting = songs.find((song) => song.id === deletingId) ?? null;
  const visible = matching(view === "mine" ? mine : shared, query);
  const count = view === "mine" ? mine.length : shared.length;

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await gql<{ createSong: { id: string } }>(CREATE_SONG, {
        input: { title, bpm, timeSignature },
      });
      setTitle("");
      setCreating(false);
      // You made a song to work on it: open it. Landing back on the list
      // made every new song cost a second click to find.
      navigate(`/songs/${data.createSong.id}`);
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
    setDeletingId(null);
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
        <AppNav />

        <Canvas className="p-8 max-md:p-4">
          <div className="mx-auto max-w-[1400px]">
            <div className="mb-6 flex items-end justify-between gap-4 max-md:flex-col max-md:items-stretch">
              <div>
                <h1 className="text-2xl font-semibold tracking-[-0.02em]">
                  {view === "mine" ? "My songs" : "Shared with me"}
                </h1>
                <p className="mt-1 font-mono text-xs text-muted">
                  {loading ? "Loading…" : `${count} song${count === 1 ? "" : "s"}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="relative flex items-center max-md:flex-1">
                  <SearchIcon className="pointer-events-none absolute left-3 h-[15px] w-[15px] text-muted" />
                  <TextInput
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search songs and beats"
                    aria-label="Search songs and beats"
                    className="w-[230px] py-1.5 pl-9 text-sm max-md:w-full"
                  />
                </label>
                {view === "mine" && (
                  <Button className="shrink-0" onClick={() => setCreating(true)}>
                    <PlusIcon className="h-4 w-4" />
                    New song
                  </Button>
                )}
              </div>
            </div>

            {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}

            {loading ? (
              // Skeletons mirror the CARD shape (art + two text lines) — no
              // spinner, no layout shift when the real grid lands.
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="overflow-hidden rounded-xl border border-edge">
                    <Skeleton className="h-20 w-full rounded-none" />
                    <div className="flex flex-col gap-2 p-4">
                      <Skeleton className="h-5 w-1/2" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-edge-strong py-16 text-center">
                <p className="font-semibold">
                  {query.trim()
                    ? `Nothing matches “${query.trim()}”`
                    : view === "mine"
                      ? "No songs yet"
                      : "Nothing shared with you yet"}
                </p>
                {!query.trim() && view === "mine" && (
                  <Button onClick={() => setCreating(true)}>
                    <PlusIcon className="h-4 w-4" />
                    New song
                  </Button>
                )}
              </div>
            ) : (
              // min(280px, 100%): on a phone the column is narrower than the
              // card minimum, and a bare 280px overflowed the screen.
              <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-4 p-0">
                {visible.map((song) => {
                  // Lay the song's beats end to end and collect every note's
                  // absolute step — that histogram IS the card's waveform.
                  const steps: number[] = [];
                  let offset = 0;
                  for (const beat of [...song.beats].sort((a, b) => a.position - b.position)) {
                    for (const lane of beat.tracks) {
                      for (const note of lane.pattern ?? []) {
                        steps.push(offset + note.step);
                      }
                    }
                    offset += (beat.bars ?? 1) * 16;
                  }
                  const cover = coverFor(song.id, { steps, totalSteps: offset });
                  // Straight from the server's myRole — never `ownerId === me`.
                  // Since sharing exists, an EDITOR can write to a song they
                  // don't own, so ownership no longer answers "can I edit?".
                  const isOwner = song.myRole === "OWNER";
                  const editable = canEditSong(song);
                  const trackCount = song.beats.reduce((n, b) => n + b.tracks.length, 0);
                  const action =
                    "cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium text-muted transition-colors duration-150 " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
                  return (
                    <li
                      key={song.id}
                      className="group relative rounded-xl border border-edge bg-surface transition-colors duration-150 hover:border-edge-strong"
                    >
                      {/* Stretched link: the WHOLE card opens the song.
                          Interactive children sit above it via z-index —
                          and the title is NOT one of them: it used to be a
                          double-click rename field at z-20, which made a
                          click on the most obvious target do nothing. */}
                      <Link
                        to={`/songs/${song.id}`}
                        className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        aria-label={`Open ${song.title}`}
                      />

                      {/* Note density over the song's length (ui/cover.ts).
                          Flat and grey when the song has no notes — an
                          invented waveform for an empty song would be
                          decoration posing as data. */}
                      <div
                        className="flex h-20 items-end gap-[2px] overflow-hidden rounded-t-xl px-4 pt-4"
                        style={{ background: cover.backdrop }}
                      >
                        {cover.bars.map((height, i) => (
                          <i
                            key={i}
                            className="min-w-0 flex-1 rounded-t-sm"
                            style={{
                              height: `${height}%`,
                              background: cover.fromNotes ? cover.accent : "var(--color-edge-strong)",
                            }}
                          />
                        ))}
                      </div>

                      <div className="p-4">
                        <div className="flex min-w-0 items-center gap-2">
                          {renamingId === song.id ? (
                            <span className="relative z-20 min-w-0">
                              <EditableName
                                startEditing
                                value={song.title}
                                maxLength={120}
                                className="font-semibold"
                                onRename={(next) => onRename(song.id, next)}
                                onDone={() => setRenamingId(null)}
                              />
                            </span>
                          ) : (
                            <strong className="min-w-0 truncate font-semibold">{song.title}</strong>
                          )}
                          {/* Every song in "My songs" is yours; the badge
                              only carries information on shared ones. */}
                          {!isOwner && <RoleBadge role={song.myRole} />}
                        </div>

                        <p className="mt-1 font-mono text-xs text-muted">
                          {song.bpm} BPM · {song.timeSignature} · {trackCount} lane
                          {trackCount === 1 ? "" : "s"}
                        </p>

                        <div className="mt-3 flex h-6 items-center gap-1.5">
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
                                  className="max-w-[7rem] truncate rounded px-1.5 py-0.5 text-[11px] font-semibold"
                                  style={{
                                    color: tint,
                                    background: `color-mix(in srgb, ${tint} 12%, transparent)`,
                                  }}
                                >
                                  {beat.name}
                                </span>
                              );
                            })}

                          {/* At rest the corner says WHO is on the song; on
                              hover (or always, on touch screens, which have
                              no hover) it becomes what you can DO. Share and
                              delete are OWNER rights, rename is any editor's
                              — mirroring the server rule so nobody meets a
                              button guaranteed to 403. */}
                          <div className="relative ml-auto flex shrink-0 items-center">
                            <span
                              className={
                                "transition-opacity duration-150 " +
                                (editable
                                  ? "group-hover:opacity-0 group-focus-within:opacity-0 pointer-coarse:hidden"
                                  : "")
                              }
                            >
                              <Collaborators people={song.collaborators} />
                            </span>
                            {editable && (
                              <span className="absolute right-0 z-20 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:static pointer-coarse:opacity-100">
                                <button className={action + " hover:text-text"} onClick={() => setRenamingId(song.id)}>
                                  Rename
                                </button>
                                {isOwner && (
                                  <>
                                    <button className={action + " hover:text-text"} onClick={() => setSharingId(song.id)}>
                                      Share
                                    </button>
                                    <button className={action + " hover:text-danger"} onClick={() => setDeletingId(song.id)}>
                                      Delete
                                    </button>
                                  </>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Canvas>
      </Workspace>

      {sharing && (
        <ShareModal
          song={sharing}
          onClose={() => setSharingId(null)}
          // Re-query rather than patching local state by hand: the server is
          // the source of truth for who's on a song, and the modal renders
          // straight out of the refreshed list (see sharingId above).
          onChanged={refresh}
        />
      )}

      {/* Deleting a song takes every beat, lane, clip and upload with it, for
          everyone it is shared with, and the server keeps no copy. That is
          the case that earns a question. */}
      {deleting && (
        <Modal title="Delete this song?" onClose={() => setDeletingId(null)}>
          <p className="text-sm text-muted">
            <strong className="text-text">{deleting.title}</strong> and all of its beats, clips and
            audio will be deleted
            {deleting.collaborators.length > 0 ? " for everyone it's shared with" : ""}. This can't be
            undone.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeletingId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void onDelete(deleting.id)}>
              Delete song
            </Button>
          </div>
        </Modal>
      )}

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

/**
 * Who else is on this song, as a stack of overlapping initials.
 *
 * It reads from `collaborators`, which the songs query already asks for —
 * no new request. The point is that a shared song should LOOK shared from
 * across the grid, before you read a single word: the "SHARED" chip tells
 * you the fact, but faces tell you it is a room with people in it.
 *
 * Capped at three plus a count. Four 24px circles is a design; eleven is a
 * caterpillar.
 */
function Collaborators({ people }: { people: Song["collaborators"] }) {
  if (!people?.length) return null;
  const shown = people.slice(0, 3);
  const rest = people.length - shown.length;

  return (
    <div
      className="flex items-center"
      // One label for the stack: a screen reader wants "shared with Maya and
      // 2 others", not three separate mystery letters.
      aria-label={`Shared with ${people.map((p) => p.displayName).join(", ")}`}
    >
      {shown.map((person, i) => (
        <span
          key={person.userId}
          title={person.displayName}
          className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface bg-surface-2 font-mono text-[9.5px] font-semibold text-muted first:ml-0"
          style={{ marginLeft: i ? -8 : 0, zIndex: 10 - i }}
        >
          {person.displayName?.trim()?.[0]?.toUpperCase() ?? "?"}
        </span>
      ))}
      {rest > 0 && (
        <span className="ml-1.5 font-mono text-[10px] text-muted">+{rest}</span>
      )}
    </div>
  );
}

/**
 * The card's permission chip. It states what the SERVER said you may do —
 * "yours", "can edit", "view only" — so the badge and the buttons next to it
 * can never disagree: both read the same myRole.
 */
function RoleBadge({ role }: { role: Song["myRole"] }) {
  const style = {
    OWNER: { label: "yours", className: "border-accent/40 bg-accent/10 text-accent" },
    EDITOR: { label: "can edit", className: "border-edge-strong bg-surface-2 text-text" },
    VIEWER: { label: "view only", className: "border-edge bg-surface-2 text-muted" },
  }[role];

  return (
    <span
      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider ${style.className}`}
    >
      {style.label}
    </span>
  );
}
