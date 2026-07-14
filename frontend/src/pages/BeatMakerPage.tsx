import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useSettings } from "../ui/settings";
import { peerColor, type Peer } from "../realtime/socket";
import { ArrangementPalette, ArrangementTimeline, type Armed } from "../components/ArrangementPanel";
import { ChatPanel } from "../chat/ChatPanel";
import { useChat } from "../chat/useChat";
import { SettingsModal } from "../ui/SettingsModal";
import { beatColor, colorFor } from "../ui/trackColors";
import { Button, EditableName, EmptyState, ErrorBanner, Select, Skeleton, TextInput } from "../ui/kit";
import {
  AppShell,
  Canvas,
  CanvasBar,
  IconButton,
  Modal,
  Readout,
  Sidebar,
  SidebarSection,
  ToolGroup,
  TopBar,
  Workspace,
} from "../ui/shell";
import { canEditSong } from "../types";
import type { Beat } from "../types";

import { CELL_H, CELL_W, PITCH_ROWS, STEPS, rowOf } from "../beatmaker/constants";
import { PeerDots } from "../beatmaker/PeerDots";
import { useAutoSave } from "../beatmaker/useAutoSave";
import { useHistory } from "../beatmaker/useHistory";
import { useInstruments } from "../beatmaker/useInstruments";
import { usePianoRoll } from "../beatmaker/usePianoRoll";
import { usePlayback } from "../beatmaker/usePlayback";
import { useRealtime } from "../beatmaker/useRealtime";
import { useSongData } from "../beatmaker/useSongData";

/**
 * The beat maker.
 *
 * This page used to be 2,200 lines, because it was doing six unrelated jobs at
 * once: fetching and saving the song, running a Tone.js transport, holding an
 * undo stack, driving a WebSocket, hit-testing mouse drags on a grid, and
 * rendering. Every one of those needed its own refs and its own effects, they
 * all shared one closure, and the only way to know whether a change to one of
 * them broke another was to find out later.
 *
 * They are six hooks now, in `../beatmaker`. What is left HERE is the part that
 * genuinely belongs to the page: which beat and lane you have selected, what the
 * screen looks like, and the wiring between the six.
 *
 * THE ORDER OF THE HOOKS BELOW IS A DEPENDENCY ORDER, not a preference:
 *
 *   instruments → data → playback → piano roll
 *                   ↘ realtime → auto-save
 *
 * Read it as: the synths exist independently of any song; the song's data
 * creates and destroys them as lanes come and go; playback reads both; the roll
 * edits the data and auditions through playback; the socket writes into the same
 * data; and auto-save is the only thing that needs to see BOTH the data and the
 * socket, because it is what decides whether an edit leaves as a delta or as a
 * whole-pattern HTTP save.
 */
export function BeatMakerPage() {
  const { songId } = useParams<{ songId: string }>();
  // We need our own id again — NOT to decide what we may do (the server sends
  // myRole for that), but to recognise our own edits coming back on the
  // broadcast. Different question, different answer.
  const { user } = useAuth();
  const { autoSave } = useSettings();

  // ---- what the page itself owns -----------------------------------------
  // Selection and chrome. Everything else has moved into a hook.

  const [error, setError] = useState<string | null>(null);
  // Two editors, one page: "arrange" is the song timeline (clips place whole
  // beats), "beats" is where you build each beat — pick Beat 1/2/3, edit its
  // instrument lanes. One transport serves both.
  const [mode, setMode] = useState<"arrange" | "beats">("arrange");
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null); // lane id
  const [selectedNote, setSelectedNote] = useState<number | null>(null);
  /** Per-lane octave: the roll shows one octave at a time. */
  const [octaves, setOctaves] = useState<Record<string, number>>({});
  // The armed material ("what am I about to place?") is shared by the palette
  // (sidebar) and the timeline (canvas) — two siblings, so the state lives in
  // their closest common ancestor: here.
  const [armed, setArmed] = useState<Armed>(null);
  // Folded while you drag a clip (the timeline asks for the width), and
  // togglable by hand.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Which clear the user is being asked to confirm, if any. */
  const [clearing, setClearing] = useState<"lane" | "beat" | null>(null);
  const [newTrackName, setNewTrackName] = useState("");
  const [newInstrument, setNewInstrument] = useState("DRUMS");

  // Live mirrors for handlers that are attached once and must not freeze
  // against the render that created them.
  const selectedBeatIdRef = useRef(selectedBeatId);
  selectedBeatIdRef.current = selectedBeatId;
  const octavesRef = useRef(octaves);
  octavesRef.current = octaves;
  /** Steps in the SELECTED beat's grid (bars × 16). Assigned during render,
   *  below — the drag handlers clamp against it. */
  const beatStepsRef = useRef(STEPS);

  const onError = useCallback((message: string) => setError(message), []);

  // ---- the six hooks ------------------------------------------------------

  const instruments = useInstruments();

  /**
   * Re-point selection and octaves at whatever survived a reload.
   *
   * Handed to the data layer, which calls it after every load. It is a
   * useCallback with no changing deps so that `load` itself stays stable — a
   * reconcile that changed identity every render would re-run the load effect
   * forever.
   */
  const reconcile = useCallback((beats: Beat[]) => {
    setOctaves((prev) => {
      const merged = { ...prev };
      for (const beat of beats) {
        for (const lane of beat.tracks) {
          merged[lane.id] ??= instruments.map.current.get(lane.id)!.defaultOctave;
        }
      }
      return merged;
    });
    setSelectedBeatId((prev) =>
      prev && beats.some((b) => b.id === prev) ? prev : beats[0]?.id ?? null,
    );
    setSelectedId((prev) => {
      const laneIds = new Set(beats.flatMap((b) => b.tracks.map((t) => t.id)));
      if (prev && laneIds.has(prev)) return prev;
      return beats[0]?.tracks[0]?.id ?? null;
    });
    // instruments.map is a ref — stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * One deliberate indirection, and the alternative is worse.
   *
   * The data layer must clear the undo stack when server truth replaces local
   * state; the undo stack must read the notes the data layer owns. Wire them
   * directly and the two hooks require each other, which React cannot express —
   * one of them has to be constructed first. Routing the single call through a
   * ref lets `data` be built with a stable function that `history` fills in a
   * few lines later, and keeps the dependency graph a DAG.
   */
  const resetHistoryRef = useRef<() => void>(() => {});
  const resetHistory = useCallback(() => resetHistoryRef.current(), []);

  const data = useSongData({
    songId,
    onError,
    ensureInstrument: instruments.ensure,
    disposeInstrument: instruments.dispose,
    resetHistory,
    reconcile,
  });

  const history = useHistory(
    data.notesRef,
    data.dirtyRef,
    (notes) => data.setNotes(notes),
    (dirty) => data.setDirty(dirty),
    () => setSelectedNote(null), // indices may not exist in the restored grid
  );
  resetHistoryRef.current = history.reset;

  /**
   * Can this account edit this song? ASK THE SERVER — don't re-derive it.
   *
   * Session 14 filled the console with 403s because this line was a COPY of the
   * server's rule, and copies drift: the UI offered rename, bar changes and
   * pattern saves on songs the server would always refuse. The fix then was to
   * copy the rule more carefully. That was the wrong fix — V10 proved it,
   * because with sharing the rule stopped being derivable from ownerId at all
   * (an EDITOR doesn't own the song and can still write to it).
   *
   * So the server now sends its verdict as `myRole` and the client reads it.
   * One rule, one implementation, no drift possible.
   */
  const song = data.song;
  const canEdit = song != null && canEditSong(song);
  const readOnly = song != null && !canEdit;

  const playback = usePlayback({
    song,
    mode,
    instruments,
    notesRef: data.notesRef,
    clipsRef: data.clipsRef,
    beatsRef: data.beatsRef,
    selectedBeatIdRef,
    onError,
  });

  const roll = usePianoRoll({
    selectedLaneId: selectedId,
    canEdit,
    notesRef: data.notesRef,
    beatStepsRef,
    setNotes: data.setNotes,
    setDirty: data.setDirty,
    history,
    preview: playback.preview,
    selectedNote,
    setSelectedNote,
    octaves,
    octavesRef,
  });

  // Before useRealtime, which consumes chat.receive: the conversation's
  // state lives here, the socket delivers into it.
  const chat = useChat({ songId, loadedSongId: song?.id });

  const realtime = useRealtime({
    songId,
    loadedSongId: song?.id,
    userId: user?.id,
    setNotes: data.setNotes,
    serverNotesRef: data.serverNotesRef,
    trackVersionsRef: data.trackVersionsRef,
    onError,
    onChat: chat.receive,
  });

  const { save } = useAutoSave({ data, realtime, autoSave, readOnly });

  const { load } = data;
  useEffect(() => {
    void load();
  }, [load]);

  // ---- names the render below reads --------------------------------------
  // Destructured rather than dotted through, so the JSX reads the same as it
  // did when all of this was one component.

  const { clips, audioFiles, notes: notesByTrack, dirty, saving } = data;
  const { live, peers, flashing } = realtime;
  const { playing, currentStep, arrangeStep, muted, soloed, volume, exporting } = playback;
  const { setMuted, setSoloed, togglePlay, testSound, exportAs, preview } = playback;
  const { rollRef, onRollMouseDown, onNoteMouseDown, onNoteContextMenu, updateNote, clearLanes } = roll;
  const { setClips, setAudioFiles, patchSong, patchBeat, renameTrack, removeBeat, removeTrack } = data;
  const { undo, redo, sizes: historySizes } = history;
  const applyVolume = playback.setVolume;
  /** The velocity slider snapshots BEFORE the drag starts (onPointerDown), so a
   *  whole slider sweep is one undo entry rather than forty. */
  const recordHistory = history.record;

  // ---- the wiring the page adds on top ------------------------------------

  function switchMode(next: "arrange" | "beats") {
    // Switching views mid-playback would leave the play button lying about what
    // it plays — stop first.
    if (playing) playback.stop();
    setMode(next);
  }

  async function addBeat() {
    const id = await data.addBeat();
    if (id) setSelectedBeatId(id); // select what you just made
  }

  async function addTrack(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedBeatId) return;
    await data.addTrack(selectedBeatId, newTrackName, newInstrument);
    setNewTrackName("");
  }

  function changeBpm(raw: string) {
    const bpm = Number(raw);
    // Mirror the server's Song.MIN_BPM..MAX_BPM guard for a friendlier message;
    // the server still enforces it.
    if (!Number.isInteger(bpm) || bpm < 20 || bpm > 400) {
      setError("BPM must be a whole number between 20 and 400");
      return;
    }
    void patchSong({ bpm });
  }

  function toggleIn(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  /** The roll broadcasts where we are; see useRealtime for why it is throttled
   *  and why the trailing edge is not optional. */
  function onRollCursorMove(e: React.MouseEvent) {
    if (!rollRef.current || !selectedId) return;
    const rect = rollRef.current.getBoundingClientRect();
    const col = Math.max(0, Math.min(beatStepsRef.current - 1, Math.floor((e.clientX - rect.left) / CELL_W)));
    const row = Math.max(0, Math.min(PITCH_ROWS.length - 1, Math.floor((e.clientY - rect.top) / CELL_H)));
    realtime.reportCursor({ beatId: selectedBeatIdRef.current, trackId: selectedId, step: col, row });
  }

  /**
   * The channel rack broadcasts a position too — otherwise your marker would sit
   * frozen at wherever you last were in the roll while you are visibly working
   * down here, which is a lie with a straight face.
   *
   * No `row`: the rack has no pitch axis, so there is nothing to say about it.
   */
  function onRackCursorMove(e: React.MouseEvent, trackId: string) {
    const rect = e.currentTarget.getBoundingClientRect();
    const col = Math.max(
      0,
      Math.min(beatStepsRef.current - 1, Math.floor((e.clientX - rect.left) / CELL_W)),
    );
    realtime.reportCursor({ beatId: selectedBeatIdRef.current, trackId, step: col });
  }

  // Spacebar = play/stop, Delete/Backspace = remove the selected note, Ctrl+Z /
  // Ctrl+Shift+Z / Ctrl+Y = undo & redo. Attached once, so everything it calls
  // is reached through a ref that the render keeps current.
  const shortcutsRef = useRef({ togglePlay, undo, redo, deleteNote: roll.deleteNote, selectedId, selectedNote });
  shortcutsRef.current = { togglePlay, undo, redo, deleteNote: roll.deleteNote, selectedId, selectedNote };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      // Never hijack keys while the user is typing in a form field.
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      const current = shortcutsRef.current;

      if (e.code === "Space") {
        e.preventDefault(); // spacebar scrolls the page by default
        void current.togglePlay();
      }
      if (e.code === "Delete" || e.code === "Backspace") {
        if (current.selectedId !== null && current.selectedNote !== null) {
          current.deleteNote(current.selectedId, current.selectedNote);
        }
      }
      // Ctrl/Cmd+Z = undo, +Shift = redo; Ctrl+Y = the Windows redo.
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) current.redo();
        else current.undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") {
        e.preventDefault();
        current.redo();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ---- render -------------------------------------------------------------

  if (!song) {
    return (
      <AppShell>
        {/* The skeleton mirrors the SHELL, not a stack of cards: bar on top,
            sidebar left, canvas right. Loading looks like the app it's
            becoming, so nothing jumps when the data lands. */}
        <TopBar left={<Skeleton className="h-6 w-48" />} right={<Skeleton className="h-8 w-64" />} />
        <Workspace>
          <Sidebar>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </Sidebar>
          <Canvas className="p-4">
            {error ? <ErrorBanner>{error}</ErrorBanner> : <Skeleton className="h-full w-full" />}
          </Canvas>
        </Workspace>
      </AppShell>
    );
  }

  const sortedBeats = [...song.beats].sort((a, b) => a.position - b.position);
  const selectedBeat = sortedBeats.find((b) => b.id === selectedBeatId) ?? null;
  const beatSteps = (selectedBeat?.bars ?? 1) * STEPS;
  beatStepsRef.current = beatSteps;
  const sortedLanes = selectedBeat
    ? [...selectedBeat.tracks].sort((a, b) => a.position - b.position)
    : [];

  /**
   * "lane:step" → who is hovering it. Built once per render, so the rack can
   * ask about a cell in O(1) instead of every cell re-scanning every peer —
   * at 8 bars that would be 128 steps × lanes × peers comparisons per frame,
   * on a component that re-renders ~20 times a second while a cursor moves.
   */
  const peerCells = new Map<string, Peer[]>();
  for (const peer of Object.values(peers)) {
    if (!peer.trackId) continue;
    const key = `${peer.trackId}:${peer.step}`;
    const at = peerCells.get(key);
    if (at) at.push(peer);
    else peerCells.set(key, [peer]);
  }

  // What a clear would actually destroy. Counted across ALL octaves, not just
  // the rows currently on screen — a "clear" that quietly spared the notes you
  // had scrolled past would be the worst kind of surprise.
  const laneNoteCount = selectedId ? (notesByTrack[selectedId] ?? []).length : 0;
  const beatNoteCount = sortedLanes.reduce(
    (total, lane) => total + (notesByTrack[lane.id] ?? []).length,
    0,
  );

  /** Where a collaborator is, in words. A peer with no beat is on the Arrange
   *  timeline (or hasn't touched a grid yet) — say so rather than guess. */
  function locationOf(peer: Peer): string {
    const beat = sortedBeats.find((b) => b.id === peer.beatId);
    const lane = beat?.tracks.find((t) => t.id === peer.trackId);
    if (beat && lane) return `${beat.name} · ${lane.name}`;
    if (beat) return beat.name;
    return "elsewhere in this song";
  }
  const selected = sortedLanes.find((t) => t.id === selectedId) ?? null;
  const octave = selected ? octaves[selected.id] ?? 4 : 4;
  const selectedNotes = selected ? notesByTrack[selected.id] ?? [] : [];
  const hiddenNotes = selected
    ? selectedNotes.filter((n) => rowOf(n.pitch, octave) === null).length
    : 0;
  const currentNote =
    selected !== null && selectedNote !== null ? selectedNotes[selectedNote] ?? null : null;

  const msButton =
    "rounded border px-1.5 py-0.5 text-[0.62rem] font-bold transition-colors duration-150 cursor-pointer " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

  // Tabs pick which CANVAS is mounted; the transport, sidebar and title bar
  // are shared chrome. That's the whole reason for a shell — the frame
  // stays, only the work surface swaps.
  const tab = (id: "arrange" | "beats", label: string) => (
    <IconButton
      active={mode === id}
      className="px-3"
      onClick={() => switchMode(id)}
      title={id === "arrange" ? "Arrange the song timeline" : "Build the beats"}
    >
      {label}
    </IconButton>
  );

  return (
    <AppShell>
      <TopBar
        left={
          <>
            <Link
              to="/"
              title="Back to songs"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              ←
            </Link>
            <IconButton
              onClick={() => setSidebarCollapsed((c) => !c)}
              active={!sidebarCollapsed}
              title={sidebarCollapsed ? "Show panel" : "Hide panel"}
            >
              ☰
            </IconButton>
            <span className="min-w-0">
              <h1 className="flex items-center gap-2 truncate text-base font-bold leading-tight tracking-tight">
                {canEdit ? (
                  <EditableName
                    value={song.title}
                    maxLength={120}
                    onRename={(title) => patchSong({ title })}
                  />
                ) : (
                  song.title
                )}
                {/* Honest about the socket. When this is dark, edits are still
                    saved (the HTTP fallback) but nobody else sees them arrive —
                    which is a thing the user genuinely needs to know, so it is
                    not hidden behind a settings panel. */}
                <span
                  // The smoke test's definition of "the socket is up" — same
                  // idea as the roll's testid: a hook that survives restyling.
                  data-testid="socket-status"
                  title={
                    live
                      ? "Live — collaborators see your edits as you make them"
                      : "Offline — edits are saved, but not shared live"
                  }
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wider ${
                    live
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-edge bg-surface-2 text-muted"
                  }`}
                >
                  <i
                    className={`h-1.5 w-1.5 rounded-full ${live ? "bg-accent" : "bg-muted"}`}
                    aria-hidden
                  />
                  {live ? "live" : "offline"}
                </span>

                {/* Who else is in here. Same colour as their cursor down in the
                    grid, so the dot beside a note and the face up here are
                    obviously the same person. */}
                {Object.values(peers).map((peer) => (
                  <span
                    key={peer.userId}
                    // Says WHERE, not just "is here" — the useful half of the
                    // sentence, and the only one you can act on.
                    title={`${peer.displayName} — ${locationOf(peer)}`}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold text-bg ring-2 ring-bg"
                    style={{ background: peerColor(peer.userId) }}
                  >
                    {peer.displayName[0]?.toUpperCase() ?? "?"}
                  </span>
                ))}
              </h1>
              {/* Save state lives WITH the title — it's a property of this
                  document, not a button you press. */}
              <span className="text-[0.68rem] text-muted">
                {readOnly
                  ? // NOT "you don't own this song" any more: an EDITOR doesn't
                    // own it either, and can edit it perfectly well. The thing
                    // that stops you is the ROLE, so say that.
                    "Read-only — you were invited to view this song"
                  : saving
                    ? "Saving…"
                    : dirty.size > 0
                      ? autoSave || live
                        ? `${dirty.size} unsaved · saving shortly`
                        : `${dirty.size} unsaved`
                      : "All changes saved"}
              </span>
            </span>
          </>
        }
        center={
          <>
            <ToolGroup>
              {tab("arrange", "Arrange")}
              {tab("beats", "Beats")}
            </ToolGroup>

            {/* TRANSPORT: the one primary action, flanked by the edit
                history. Grouped and sized identically — the old header had
                these as four differently-shaped buttons in a loose row. */}
            <ToolGroup>
              <IconButton onClick={undo} disabled={historySizes.past === 0} title="Undo (Ctrl+Z)">
                ↺
              </IconButton>
              <IconButton
                onClick={redo}
                disabled={historySizes.future === 0}
                title="Redo (Ctrl+Shift+Z)"
              >
                ↻
              </IconButton>
              <IconButton
                tone="solid"
                className="min-w-16"
                onClick={() => void togglePlay()}
                title={
                  mode === "arrange" ? "Play the arrangement (Space)" : "Loop the selected beat (Space)"
                }
              >
                {playing ? "■ Stop" : "▶ Play"}
              </IconButton>
            </ToolGroup>

            <ToolGroup>
              {/* Tempo and meter are DATA, so they read as data (a numeric
                  readout), not as two more buttons. Still editable —
                  double-click, same as everywhere else in the app. */}
              <Readout label="BPM">
                {canEdit ? (
                  <EditableName value={String(song.bpm)} maxLength={3} onRename={changeBpm} />
                ) : (
                  song.bpm
                )}
              </Readout>
              <Readout label="Sig">
                {canEdit ? (
                  <EditableName
                    value={song.timeSignature}
                    maxLength={5}
                    onRename={(timeSignature) => void patchSong({ timeSignature })}
                  />
                ) : (
                  song.timeSignature
                )}
              </Readout>
            </ToolGroup>
          </>
        }
        right={
          <>
            <ToolGroup>
              <label className="flex items-center gap-2 px-2" title="Master volume">
                <span aria-hidden className="text-xs">
                  🔊
                </span>
                <input
                  type="range"
                  className="w-20"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(e) => applyVolume(Number(e.target.value))}
                />
              </label>
              <IconButton
                onClick={() => void testSound()}
                title="Play a test blip — if you can't hear this, check your tab/OS volume"
              >
                🎧
              </IconButton>
            </ToolGroup>

            {/* With auto-save on, an explicit Save button is redundant
                chrome — it only appears when you've opted out of auto-save
                (or while a save is in flight). */}
            {!readOnly && !autoSave && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void save()}
                disabled={saving || dirty.size === 0}
              >
                {saving ? "Saving…" : dirty.size > 0 ? `Save ${dirty.size}` : "Saved"}
              </Button>
            )}

            {mode === "arrange" && (
              <ToolGroup>
                <IconButton
                  onClick={() => void exportAs("wav")}
                  disabled={exporting}
                  title="Render the arrangement to a WAV file (lossless)"
                >
                  {exporting ? "…" : "WAV"}
                </IconButton>
                <IconButton
                  onClick={() => void exportAs("mp3")}
                  disabled={exporting}
                  title="Render the arrangement to an MP3 file (192 kbps)"
                >
                  {exporting ? "…" : "MP3"}
                </IconButton>
              </ToolGroup>
            )}

            {/* Chat toggle. The badge is the closed panel's only voice —
                without it a collaborator's "wait, don't delete that" sits
                unseen behind a button. */}
            <span className="relative">
              <IconButton
                active={chat.open}
                onClick={() => chat.setOpen(!chat.open)}
                title={chat.open ? "Close chat" : "Chat with everyone in this song"}
              >
                💬
              </IconButton>
              {!chat.open && chat.unread > 0 && (
                <span
                  className="pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.6rem] font-bold text-bg"
                  data-testid="chat-unread"
                >
                  {chat.unread > 9 ? "9+" : chat.unread}
                </span>
              )}
            </span>

            <IconButton onClick={() => setSettingsOpen(true)} title="Settings">
              ⚙
            </IconButton>
          </>
        }
      />

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {/* A confirm, even though Ctrl+Z would undo it. Undo protects YOU; it
          does not protect the collaborator who is watching notes vanish out of
          a beat they were working in, and who has no idea it was deliberate.
          Destructive-and-shared earns one question. */}
      {clearing && selectedBeat && (
        <Modal
          title={clearing === "lane" ? `Clear the ${selected?.name} lane?` : `Clear ${selectedBeat.name}?`}
          onClose={() => setClearing(null)}
        >
          <p className="text-sm text-muted">
            {clearing === "lane" ? (
              <>
                This deletes all <strong className="text-text">{laneNoteCount}</strong> note
                {laneNoteCount === 1 ? "" : "s"} in{" "}
                <strong className="text-text">{selected?.name}</strong>. Other lanes are untouched.
              </>
            ) : (
              <>
                This deletes all <strong className="text-text">{beatNoteCount}</strong> note
                {beatNoteCount === 1 ? "" : "s"} across every lane in{" "}
                <strong className="text-text">{selectedBeat.name}</strong>.
              </>
            )}{" "}
            {Object.keys(peers).length > 0 && (
              <>
                <strong className="text-text">
                  {Object.values(peers)
                    .map((p) => p.displayName)
                    .join(" and ")}
                </strong>{" "}
                {Object.keys(peers).length === 1 ? "is" : "are"} in this song right now and will see
                it happen.{" "}
              </>
            )}
            You can undo with Ctrl+Z.
          </p>

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setClearing(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                clearLanes(
                  clearing === "lane"
                    ? selectedId
                      ? [selectedId]
                      : []
                    : sortedLanes.map((lane) => lane.id),
                )
              }
            >
              {clearing === "lane" ? "Clear lane" : "Clear beat"}
            </Button>
          </div>
        </Modal>
      )}

      <Workspace>
        {/* Folds while dragging a clip (the timeline needs the width) or
            when the user hides it by hand. */}
        <Sidebar collapsed={sidebarCollapsed || dragging}>
          {mode === "arrange" ? (
            <ArrangementPalette
              songId={song.id}
              beats={sortedBeats}
              audioFiles={audioFiles}
              armed={armed}
              onArmedChange={setArmed}
              onClipsChange={setClips}
              onAudioFilesChange={setAudioFiles}
              onError={setError}
              canEdit={canEdit}
            />
          ) : (
            <>
              {/* -- beat browser ---------------------------------------- */}
              <SidebarSection
                title="Beats"
                action={
                  canEdit ? (
                    <IconButton onClick={() => void addBeat()} title="New beat">
                      +
                    </IconButton>
                  ) : undefined
                }
              >
                <div className="flex flex-col gap-1">
                  {sortedBeats.length === 0 && (
                    <p className="text-xs text-muted">
                      A beat is a full multi-instrument groove. Create one to start.
                    </p>
                  )}
                  {sortedBeats.map((beat) => (
                    <div
                      key={beat.id}
                      className={
                        "group flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition-colors duration-150 " +
                        (beat.id === selectedBeatId
                          ? "border-accent bg-accent/15 text-text"
                          : "border-edge bg-bg-soft text-muted hover:border-edge-strong hover:text-text")
                      }
                      onClick={() => {
                        setSelectedBeatId(beat.id);
                        setSelectedId(
                          [...beat.tracks].sort((a, b) => a.position - b.position)[0]?.id ?? null,
                        );
                      }}
                    >
                      <i
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: beatColor(beat.position) }}
                      />
                      <strong className="min-w-0 flex-1 truncate font-semibold">
                        {canEdit ? (
                          <EditableName
                            value={beat.name}
                            onRename={(name) => patchBeat(beat.id, { name })}
                          />
                        ) : (
                          beat.name
                        )}
                      </strong>
                      {/* Who's working in this beat — visible even when it is
                          not the beat you have open. */}
                      <PeerDots
                        list={Object.values(peers).filter((peer) => peer.beatId === beat.id)}
                        where={beat.name}
                      />
                      <span className="shrink-0 text-[0.6rem] tabular-nums">
                        {beat.bars} bar{beat.bars > 1 ? "s" : ""}
                      </span>
                      {canEdit && (
                        <button
                          className="shrink-0 rounded text-muted opacity-0 transition-opacity hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 group-hover:opacity-100"
                          title="Delete beat (removes its lanes and timeline clips)"
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeBeat(beat.id);
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </SidebarSection>

              {/* -- lane browser (the "channel rack") -------------------- */}
              {selectedBeat && (
                <SidebarSection title={`${selectedBeat.name} · lanes`}>
                  <div className="flex flex-col gap-1">
                    {sortedLanes.length === 0 && (
                      <p className="text-xs text-muted">
                        No lanes yet — add drums below, then draw a kick in the roll.
                      </p>
                    )}
                    {sortedLanes.map((track) => {
                      const isMuted = muted.has(track.id);
                      const isSolo = soloed.has(track.id);
                      return (
                        <div
                          key={track.id}
                          className={
                            "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors duration-150 " +
                            (track.id === selectedId
                              ? "border-edge-strong bg-surface-2 text-text"
                              : "border-edge bg-bg-soft text-muted hover:border-edge-strong")
                          }
                          onClick={() => setSelectedId(track.id)}
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: colorFor(track.instrument) }}
                          />
                          <strong className="min-w-0 flex-1 truncate font-semibold">
                            {canEdit ? (
                              <EditableName
                                value={track.name}
                                onRename={(name) => renameTrack(track.id, name)}
                              />
                            ) : (
                              track.name
                            )}
                          </strong>
                          {/* THE ANSWER TO "where is their cursor?" — they are
                              on this lane, and you are not looking at it. */}
                          <PeerDots
                            list={Object.values(peers).filter(
                              (peer) => peer.trackId === track.id,
                            )}
                            where={track.name}
                          />
                          <button
                            className={
                              msButton +
                              (isMuted
                                ? " border-danger bg-danger text-bg"
                                : " border-edge text-muted hover:border-edge-strong")
                            }
                            title="Mute"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMuted((prev) => toggleIn(prev, track.id));
                            }}
                          >
                            M
                          </button>
                          <button
                            className={
                              msButton +
                              (isSolo
                                ? " border-solo bg-solo text-bg"
                                : " border-edge text-muted hover:border-edge-strong")
                            }
                            title="Solo"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSoloed((prev) => toggleIn(prev, track.id));
                            }}
                          >
                            S
                          </button>
                          {canEdit && (
                            <button
                              className="shrink-0 rounded px-0.5 text-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                              title="Delete lane"
                              onClick={(e) => {
                                e.stopPropagation();
                                void removeTrack(track.id);
                              }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {canEdit && (
                  <form onSubmit={(e) => void addTrack(e)} className="mt-2 flex flex-col gap-2">
                    <TextInput
                      className="!py-1 text-xs"
                      value={newTrackName}
                      onChange={(e) => setNewTrackName(e.target.value)}
                      placeholder="808 Kick"
                      required
                      maxLength={80}
                    />
                    <div className="flex gap-2">
                      <Select
                        className="!py-1 text-xs"
                        value={newInstrument}
                        onChange={(e) => setNewInstrument(e.target.value)}
                      >
                        {["DRUMS", "BASS", "SYNTH", "PIANO", "GUITAR", "STRINGS"].map((i) => (
                          <option key={i} value={i}>
                            {i.toLowerCase()}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" size="sm">
                        Add
                      </Button>
                    </div>
                  </form>
                  )}
                </SidebarSection>
              )}
            </>
          )}
        </Sidebar>

        {/* ---- CANVAS -------------------------------------------------- */}
        {mode === "arrange" ? (
          <Canvas>
            {error && (
              <div className="px-4 pt-4">
                <ErrorBanner>{error}</ErrorBanner>
              </div>
            )}
            <ArrangementTimeline
              songId={song.id}
              bpm={song.bpm}
              beats={sortedBeats}
              audioFiles={audioFiles}
              clips={clips}
              onClipsChange={setClips}
              armed={armed}
              onArmedChange={setArmed}
              playheadStep={arrangeStep}
              onError={setError}
              onDraggingChange={setDragging}
              canEdit={canEdit}
              onOpenBeat={(beatId) => {
                setSelectedBeatId(beatId);
                const beat = sortedBeats.find((b) => b.id === beatId);
                setSelectedId(beat?.tracks[0]?.id ?? null);
                switchMode("beats");
              }}
            />
          </Canvas>
        ) : (
          <Canvas>
            {/* The contextual strip: what you can do to THIS beat / THIS
                note. Everything global already lives in the transport. */}
            {selectedBeat && (
              <CanvasBar>
                <span className="text-sm font-bold tracking-tight">
                  {selected ? selected.name : selectedBeat.name}
                </span>
                {selected && (
                  <span className="text-xs text-muted">{selected.instrument.toLowerCase()}</span>
                )}

                <label className="ml-auto flex items-center gap-2 text-xs text-muted">
                  length
                  <Select
                    className="!w-auto !py-0.5 text-xs"
                    value={selectedBeat.bars}
                    disabled={!canEdit}
                    onChange={(e) => void patchBeat(selectedBeat.id, { bars: Number(e.target.value) })}
                  >
                    {[1, 2, 4, 8].map((b) => (
                      <option key={b} value={b}>
                        {b} bar{b > 1 ? "s" : ""}
                      </option>
                    ))}
                  </Select>
                </label>

                {selected && (
                  <ToolGroup>
                    <IconButton
                      onClick={() =>
                        setOctaves((p) => ({ ...p, [selected.id]: Math.max(0, octave - 1) }))
                      }
                      title="Octave down"
                    >
                      −
                    </IconButton>
                    <span className="px-1 font-mono text-xs tabular-nums text-muted">
                      oct {octave}
                    </span>
                    <IconButton
                      onClick={() =>
                        setOctaves((p) => ({ ...p, [selected.id]: Math.min(7, octave + 1) }))
                      }
                      title="Octave up"
                    >
                      +
                    </IconButton>
                  </ToolGroup>
                )}

                {/* Clearing. Two scopes, because "clear" is ambiguous the moment
                    a beat has more than one lane and the roll only shows you
                    one of them — a single button would wipe something the user
                    couldn't see either way. Disabled when there is nothing to
                    clear, so the button never lies about having work to do. */}
                {selected && canEdit && (
                  <ToolGroup>
                    <IconButton
                      tone="danger"
                      disabled={laneNoteCount === 0}
                      title={`Clear the ${selected.name} lane (${laneNoteCount} note${laneNoteCount === 1 ? "" : "s"})`}
                      onClick={() => setClearing("lane")}
                    >
                      Clear lane
                    </IconButton>
                    <IconButton
                      tone="danger"
                      disabled={beatNoteCount === 0}
                      title={`Clear every lane in ${selectedBeat.name} (${beatNoteCount} note${beatNoteCount === 1 ? "" : "s"})`}
                      onClick={() => setClearing("beat")}
                    >
                      Clear beat
                    </IconButton>
                  </ToolGroup>
                )}

                {/* Velocity only exists when a note is selected — a control
                    with nothing to control is noise, so it isn't rendered. */}
                {currentNote && selected && (
                  <label className="flex items-center gap-2 whitespace-nowrap text-xs text-muted">
                    vel {Math.round(currentNote.velocity * 100)}%
                    <input
                      type="range"
                      className="w-24"
                      min={10}
                      max={100}
                      value={Math.round(currentNote.velocity * 100)}
                      onPointerDown={recordHistory}
                      onChange={(e) => {
                        const velocity = Number(e.target.value) / 100;
                        updateNote(selected.id, selectedNote!, { velocity });
                        preview(selected.id, currentNote.pitch, velocity);
                      }}
                    />
                  </label>
                )}

                {hiddenNotes > 0 && (
                  <span className="text-xs text-muted">{hiddenNotes} note(s) in other octaves</span>
                )}
              </CanvasBar>
            )}

            {error && (
              <div className="px-4 pt-4">
                <ErrorBanner>{error}</ErrorBanner>
              </div>
            )}

            {!selectedBeat ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon="🧱"
                  title="No beats yet"
                  hint='A beat is a full multi-instrument groove — "Beat 1" with kick, snare and bass lanes. Create one in the left panel, build it here, then place it on the Arrange timeline.'
                />
              </div>
            ) : !selected ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon="🥁"
                  title="No lanes in this beat"
                  hint="Add a drums lane in the left panel, then click cells here to lay down your first kick pattern."
                />
              </div>
            ) : (
              // ONE horizontal scroll box holds the roll AND the channel
              // rack, so they scroll together and stay column-aligned. At 8
              // bars the grid is 128 steps (~4300px) wide: it must scroll
              // INSIDE this box, not blow the page open — which is what made
              // the 8-bar view "scale" into something unusable.
              // `max-w-full min-w-0` is what actually constrains it to the
              // canvas; without them a flex/grid child sizes to its content
              // and the box would just grow instead of scrolling.
              <div className="flex min-w-0 flex-col p-4">
                <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-edge bg-bg-soft p-2">
                  <div className="w-max select-none">
                    {/* -- piano roll ------------------------------------ */}
                    <div className="flex">
                      {/* The pitch gutter is sticky: scroll to bar 7 and you
                          can still tell a C from an F#. */}
                      <div className="sticky left-0 z-2 w-11 shrink-0 bg-bg-soft text-[0.68rem] text-muted">
                        {PITCH_ROWS.map((p) => (
                          <div
                            key={p}
                            style={{ height: CELL_H }}
                            className={
                              "flex items-center justify-end pr-2" +
                              (p.includes("#") ? " text-muted/50" : "")
                            }
                          >
                            {p}
                            {octave}
                          </div>
                        ))}
                      </div>
                      <div
                        className="roll"
                        ref={rollRef}
                        data-testid="piano-roll"
                        onMouseDown={canEdit ? onRollMouseDown : undefined}
                        // Presence is NOT gated on canEdit: a viewer looking
                        // over your shoulder is exactly who you want to see the
                        // cursor of. Watching is not writing.
                        onMouseMove={live ? onRollCursorMove : undefined}
                        style={{ width: beatSteps * CELL_W, height: PITCH_ROWS.length * CELL_H }}
                      >
                        {PITCH_ROWS.map((p, row) =>
                          Array.from({ length: beatSteps }, (_, col) => (
                            <div
                              key={`${row}-${col}`}
                              className={[
                                "roll-cell",
                                p.includes("#") ? "dark" : "",
                                col % 16 === 0 ? "bar" : col % 4 === 0 ? "beat" : "",
                                col === currentStep ? "playcol" : "",
                              ].join(" ")}
                              style={{
                                left: col * CELL_W,
                                top: row * CELL_H,
                                width: CELL_W,
                                height: CELL_H,
                              }}
                            />
                          )),
                        )}
                        {/* Other people's cursors, drawn INSIDE the roll so
                            they share its coordinate system — the same
                            col*CELL_W the notes use. Only peers looking at THIS
                            beat and THIS lane appear; a cursor from a lane you
                            can't see would be a dot floating over unrelated
                            notes, which is worse than nothing. */}
                        {Object.values(peers)
                          .filter(
                            (peer) =>
                              peer.trackId === selected.id && peer.beatId === selectedBeatId,
                          )
                          .map((peer) => (
                            <div
                              key={peer.userId}
                              className="peer-cursor"
                              style={
                                {
                                  left: peer.step * CELL_W,
                                  top: peer.row * CELL_H,
                                  "--pc": peerColor(peer.userId),
                                } as React.CSSProperties
                              }
                            >
                              <span className="peer-label">{peer.displayName}</span>
                            </div>
                          ))}

                        {selectedNotes.map((note, index) => {
                          const row = rowOf(note.pitch, octave);
                          if (row === null) return null;
                          const remote = flashing.has(`${selected.id}:${note.step}:${note.pitch}`);
                          return (
                            <div
                              key={index}
                              className={`note ${index === selectedNote ? "selected" : ""} ${remote ? "landed" : ""}`}
                              style={
                                {
                                  left: note.step * CELL_W + 1,
                                  top: row * CELL_H + 2,
                                  width: note.length * CELL_W - 3,
                                  height: CELL_H - 4,
                                  // Velocity is VISIBLE: quiet notes are translucent.
                                  opacity: 0.35 + 0.65 * note.velocity,
                                  "--tc": colorFor(selected.instrument),
                                } as React.CSSProperties
                              }
                              onMouseDown={
                                canEdit ? (e) => onNoteMouseDown(e, index, note, false) : undefined
                              }
                              onContextMenu={
                                canEdit ? (e) => onNoteContextMenu(e, index) : undefined
                              }
                            >
                              {canEdit && (
                                <span
                                  className="note-handle"
                                  onMouseDown={(e) => onNoteMouseDown(e, index, note, true)}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* -- channel rack: every lane of this beat at a glance.
                           Cells are sized from CELL_W so its columns line up
                           with the roll above — a rack that drifts out of
                           alignment is worse than no rack. --------------- */}
                    <div className="mt-3 flex flex-col gap-1 border-t border-edge pt-3">
                      {sortedLanes.map((track) => {
                        const notes = notesByTrack[track.id] ?? [];
                        return (
                          <div
                            key={track.id}
                            className={
                              "flex cursor-pointer items-center rounded transition-colors duration-150 " +
                              (track.id === selectedId ? "bg-surface-2" : "hover:bg-surface-2/60")
                            }
                            onClick={() => setSelectedId(track.id)}
                          >
                            <span className="sticky left-0 z-2 flex w-11 shrink-0 items-center gap-1 bg-bg-soft pr-1">
                              <i
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ background: colorFor(track.instrument) }}
                                title={track.name}
                              />
                              <span className="truncate text-[0.6rem] font-semibold text-muted">
                                {track.name}
                              </span>
                            </span>
                            <div
                              className="flex"
                              onMouseMove={
                                live ? (e) => onRackCursorMove(e, track.id) : undefined
                              }
                              style={{ "--tc": colorFor(track.instrument) } as React.CSSProperties}
                            >
                              {Array.from({ length: beatSteps }, (_, s) => {
                                // Who is hovering THIS cell? The rack shows every
                                // lane at once, so unlike the piano roll it can
                                // point at a collaborator no matter which lane
                                // they are on — this is the one view where
                                // "where is everybody" is answerable in full.
                                const here = peerCells.get(`${track.id}:${s}`);
                                return (
                                  <span
                                    key={s}
                                    title={
                                      here && `${here.map((p) => p.displayName).join(", ")} here`
                                    }
                                    className={[
                                      "cell",
                                      notes.some((n) => s >= n.step && s < n.step + n.length)
                                        ? "on"
                                        : "",
                                      s === currentStep ? "playhead" : "",
                                      s % 16 === 0 ? "bar" : s % 4 === 0 ? "beat" : "",
                                      here ? "peer" : "",
                                    ].join(" ")}
                                    style={
                                      {
                                        width: CELL_W - 3,
                                        height: 16,
                                        marginRight: 3,
                                        // First one wins if two people share a
                                        // cell — a blended colour would name
                                        // neither of them.
                                        ...(here ? { "--pcell": peerColor(here[0].userId) } : {}),
                                      } as React.CSSProperties
                                    }
                                  />
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Canvas>
        )}

        {chat.open && (
          <ChatPanel
            messages={chat.messages}
            meId={user?.id}
            live={live}
            onSend={realtime.sendChat}
            onClose={() => chat.setOpen(false)}
          />
        )}
      </Workspace>
    </AppShell>
  );
}
