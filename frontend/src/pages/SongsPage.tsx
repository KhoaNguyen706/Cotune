import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError, gql, rest } from "../api/client";
import { beatColor } from "../ui/trackColors";
import { coverFor } from "../ui/cover";
import { Button, EditableName, ErrorBanner, Field, Skeleton, TextInput, Wordmark } from "../ui/kit";
import { LibraryIcon, ListIcon, SearchIcon, ShareIcon, ShieldIcon, SlidersIcon } from "../ui/icons";
import { AppShell, Canvas, Modal, NavItem, NavRail, Workspace } from "../ui/shell";
import { SettingsModal } from "../ui/SettingsModal";
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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("mine");
  /** The search box. Not in the URL: a filter you typed is a glance, not a
   *  place — you don't bookmark it and you don't want Back to walk you out
   *  of it one letter at a time. */
  const [query, setQuery] = useState("");

  const [creating, setCreating] = useState(false); // modal open?
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * The share sheet tracks a song ID, not a Song object. Holding the object
   * would freeze a copy: after an invite we re-query, `songs` gets a fresh
   * list, and the modal would still be rendering the snapshot it captured
   * when it opened — so the person you just added wouldn't appear until you
   * closed and reopened it. Looking the song up by id each render keeps the
   * modal reading the same state everything else does.
   */
  const [sharingId, setSharingId] = useState<string | null>(null);
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
  const visible = matching(view === "mine" ? mine : shared, query);

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
              <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface p-3">
                <Avatar name={user?.displayName} />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-sm font-bold">{user?.displayName}</span>
                  {/* Mono, like every other piece of machine state in the
                      designs — a plan name is a fact about the account, not
                      prose. */}
                  <span className="block font-mono text-[10.5px] text-muted">Free plan</span>
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
          <div className="mb-4 px-1 py-2">
            <Wordmark />
          </div>

          <NavItem
            icon={<ListIcon className="h-[17px] w-[17px]" />}
            label="My songs"
            active={view === "mine"}
            onClick={() => setView("mine")}
          />
          {/* No longer "soon": V10 added the collaborators table, so this is
              a real destination. A sample library still isn't — it needs an
              asset store — and it stays honestly inert rather than linking
              to a blank page. */}
          <NavItem
            icon={<ShareIcon className="h-[17px] w-[17px]" />}
            label="Shared with me"
            active={view === "shared"}
            onClick={() => setView("shared")}
          />
          <NavItem icon={<LibraryIcon className="h-[17px] w-[17px]" />} label="Library" soon />
          {/* Admins get one extra destination: the AI-invite console. Gated
              on role here for the affordance; the /admin route and the
              mutations behind it enforce it server-side regardless. */}
          {user?.role === "ADMIN" && (
            <NavItem
              icon={<ShieldIcon className="h-[17px] w-[17px]" />}
              label="Admin"
              onClick={() => navigate("/admin")}
            />
          )}
          <NavItem
            icon={<SlidersIcon className="h-[17px] w-[17px]" />}
            label="Settings"
            onClick={() => setSettingsOpen(true)}
          />
        </NavRail>

        <Canvas className="p-8">
          <div className="mx-auto max-w-[1400px]">
            <div className="mb-8 flex items-start justify-between gap-5 max-md:flex-col">
              <div>
                <h1 className="text-3xl font-semibold tracking-[-0.02em]">
                  {view === "mine" ? "My songs" : "Shared with me"}
                </h1>
                <p className="mt-1.5 text-sm text-muted">
                  {loading
                    ? "Loading…"
                    : view === "mine"
                      ? `${mine.length} song${mine.length === 1 ? "" : "s"} · autosaved to your account`
                      : `${shared.length} song${shared.length === 1 ? "" : "s"} shared with you`}
                </p>
              </div>
              <div className="flex items-center gap-3 max-md:w-full">
                <label className="relative flex items-center max-md:flex-1">
                  <SearchIcon className="pointer-events-none absolute left-3 h-[15px] w-[15px] text-muted" />
                  <TextInput
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search songs and beats"
                    aria-label="Search songs and beats"
                    className="w-[230px] pl-9 max-md:w-full"
                  />
                </label>
                {view === "mine" && (
                  <Button className="shrink-0 shadow-glow" onClick={() => setCreating(true)}>
                    + New song
                  </Button>
                )}
              </div>
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
                          className="absolute -bottom-5 right-5 z-20 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-accent pl-0.5 text-sm text-bg shadow-glow transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
                          <strong className="min-w-0 truncate font-semibold tracking-[-0.01em]">
                            {editable ? (
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
                          <RoleBadge role={song.myRole} />
                        </div>

                        {/* Mono: this line is four numbers and a time
                            signature. Proportional digits make "124 BPM ·
                            4/4" read as a sentence; tabular ones make it
                            read as a spec, which is what it is. */}
                        <p className="mt-2 font-mono text-xs text-muted">
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

                          {/* The right-hand slot holds two things that both
                              want the same corner, so they take turns: at
                              rest it shows WHO is on the song (the design's
                              idea), and on hover it becomes what you can DO
                              about it. The actions were hover-only before
                              this redesign too — the avatars just gave the
                              resting state something true to say.

                              Sharing and deleting are OWNER rights — an
                              editor has neither (see SongAccess). The UI
                              mirrors the server rule so nobody meets a button
                              guaranteed to 403; @PreAuthorize is still the
                              only thing that decides. */}
                          <div className="relative ml-auto flex shrink-0 items-center">
                            <span
                              className={
                                "transition-opacity duration-150 " +
                                (isOwner ? "group-hover:opacity-0 group-focus-within:opacity-0" : "")
                              }
                            >
                              <Collaborators people={song.collaborators} />
                            </span>
                            {isOwner && (
                              <span className="absolute right-0 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
                                <button
                                  className="cursor-pointer rounded px-1 text-sm font-medium text-muted transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                                  onClick={() => setSharingId(song.id)}
                                >
                                  Share
                                </button>
                                <button
                                  className="cursor-pointer rounded px-1 text-sm font-medium text-muted transition-colors duration-150 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                                  onClick={() => void onDelete(song.id)}
                                >
                                  Delete
                                </button>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}

                {/* The create affordance lives IN the grid too, where your eye
                    already is after scanning the songs — but only on YOUR
                    songs, and not while you are searching: "New song" as the
                    lone answer to a query that matched nothing reads as a
                    result, and clicking it is never what you meant. */}
                {view === "mine" && !query.trim() && (
                  <li>
                    <button
                      onClick={() => setCreating(true)}
                      className="flex h-full min-h-[240px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-edge-strong text-muted transition-colors duration-150 hover:border-accent hover:bg-surface hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span className="text-3xl font-light">+</span>
                      <span className="text-sm font-medium">New song</span>
                    </button>
                  </li>
                )}

                {/* A search with no hits must say so. Without this the grid
                    just empties, which looks identical to "your songs are
                    gone" — the scariest possible reading of a filter. */}
                {query.trim() && visible.length === 0 && (
                  <li className="col-span-full rounded-2xl border border-dashed border-edge p-10 text-center">
                    <p className="text-sm font-semibold">No matches for “{query.trim()}”</p>
                    <p className="mt-1 text-sm text-muted">
                      Searches song titles and beat names in{" "}
                      {view === "mine" ? "your songs" : "songs shared with you"}.
                    </p>
                  </li>
                )}

                {!query.trim() && view === "shared" && shared.length === 0 && (
                  <li className="col-span-full rounded-2xl border border-dashed border-edge p-10 text-center">
                    <p className="text-sm font-semibold">Nothing shared with you yet</p>
                    <p className="mt-1 text-sm text-muted">
                      When someone invites you to a song, it shows up here.
                    </p>
                  </li>
                )}
              </ul>
            )}
          </div>
        </Canvas>
      </Workspace>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

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

/** Someone's initials in a tile. The account card's version of a face,
 *  and the atom the collaborator stack below is built from. */
function Avatar({ name, className }: { name?: string | null; className?: string }) {
  return (
    <span
      className={
        "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg " +
        "bg-accent/15 text-[13px] font-semibold text-accent " +
        (className ?? "")
      }
    >
      {name?.trim()?.[0]?.toUpperCase() ?? "?"}
    </span>
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
