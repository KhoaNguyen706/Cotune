import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useSettings } from "../ui/settings";
import { ArrangementPalette, ArrangementTimeline, type Armed } from "../components/ArrangementPanel";
import { ChatPanel } from "../chat/ChatPanel";
import { useChat } from "../chat/useChat";
import { SettingsModal } from "../ui/SettingsModal";
import { ErrorBanner, Skeleton } from "../ui/kit";
import { AppShell, Canvas, Sidebar, TopBar, Workspace } from "../ui/shell";
import { canEditSong } from "../types";
import type { Beat } from "../types";

import { CELL_H, CELL_W, PITCH_ROWS, STEPS } from "../beatmaker/constants";
import { BeatBrowserSidebar } from "../beatmaker/BeatBrowserSidebar";
import { BeatEditorCanvas } from "../beatmaker/BeatEditorCanvas";
import { ClearNotesDialog, type ClearScope } from "../beatmaker/ClearNotesDialog";
import { GeneratePatternDialog } from "../beatmaker/GeneratePatternDialog";
import { BeatMakerTopBar, type EditorMode } from "../beatmaker/BeatMakerTopBar";
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
  const [mode, setMode] = useState<EditorMode>("arrange");
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
  const [clearing, setClearing] = useState<ClearScope | null>(null);
  /** The AI generate dialog: open?, in flight?, and its own error (shown in
   *  the dialog, where the fix — rewording the prompt — happens). */
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

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

  function switchMode(next: EditorMode) {
    // Switching views mid-playback would leave the play button lying about what
    // it plays — stop first.
    if (playing) playback.stop();
    setMode(next);
  }

  async function addBeat() {
    const id = await data.addBeat();
    if (id) setSelectedBeatId(id); // select what you just made
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

  /**
   * The AI's notes land EXACTLY like a human's: one history snapshot (so
   * Ctrl+Z restores the old lane), local state replaced, lane marked dirty
   * — and the existing flush turns the change into per-note deltas that
   * collaborators watch arrive. The server returned validated notes but
   * saved nothing; keeping them is this client's ordinary save.
   */
  async function generateInto(prompt: string) {
    if (!selectedId) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const generated = await data.generatePattern(selectedId, prompt);
      recordHistory();
      data.setNotes((prev) => ({ ...prev, [selectedId]: generated }));
      data.setDirty((prev) => new Set(prev).add(selectedId));
      setSelectedNote(null); // old indices don't exist in the new pattern
      setGenerateOpen(false);
    } catch (e) {
      // Stays in the dialog: the fix is rewording the prompt, right there.
      setGenerateError(e instanceof Error ? e.message : "Generation failed — try again.");
    } finally {
      setGenerating(false);
    }
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

  // What a clear would actually destroy. Counted across ALL octaves, not just
  // the rows currently on screen — a "clear" that quietly spared the notes you
  // had scrolled past would be the worst kind of surprise.
  const laneNoteCount = selectedId ? (notesByTrack[selectedId] ?? []).length : 0;
  const beatNoteCount = sortedLanes.reduce(
    (total, lane) => total + (notesByTrack[lane.id] ?? []).length,
    0,
  );

  const selected = sortedLanes.find((t) => t.id === selectedId) ?? null;
  const octave = selected ? octaves[selected.id] ?? 4 : 4;


  return (
    <AppShell>
      <BeatMakerTopBar
        song={song}
        beats={sortedBeats}
        peers={peers}
        mode={mode}
        canEdit={canEdit}
        readOnly={readOnly}
        live={live}
        autoSave={autoSave}
        saving={saving}
        dirtyCount={dirty.size}
        sidebarCollapsed={sidebarCollapsed}
        playing={playing}
        historyPast={historySizes.past}
        historyFuture={historySizes.future}
        volume={volume}
        exporting={exporting}
        chatOpen={chat.open}
        chatUnread={chat.unread}
        onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
        onRenameSong={(title) => void patchSong({ title })}
        onChangeBpm={changeBpm}
        onChangeTimeSignature={(timeSignature) => void patchSong({ timeSignature })}
        onModeChange={switchMode}
        onUndo={undo}
        onRedo={redo}
        onTogglePlay={() => void togglePlay()}
        onVolumeChange={applyVolume}
        onTestSound={() => void testSound()}
        onSave={() => void save()}
        onExport={(format) => void exportAs(format)}
        onToggleChat={() => chat.setOpen(!chat.open)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {generateOpen && selected && (
        <GeneratePatternDialog
          track={selected}
          busy={generating}
          error={generateError}
          onCancel={() => {
            setGenerateOpen(false);
            setGenerateError(null);
          }}
          onGenerate={(prompt) => void generateInto(prompt)}
        />
      )}

      {/* A confirm, even though Ctrl+Z would undo it. Undo protects YOU; it
          does not protect the collaborator who is watching notes vanish out of
          a beat they were working in, and who has no idea it was deliberate.
          Destructive-and-shared earns one question. */}
      {clearing && selectedBeat && (
        <ClearNotesDialog
          scope={clearing}
          beat={selectedBeat}
          track={selected}
          laneNoteCount={laneNoteCount}
          beatNoteCount={beatNoteCount}
          peers={peers}
          onCancel={() => setClearing(null)}
          onConfirm={() => {
            clearLanes(
              clearing === "lane"
                ? selectedId
                  ? [selectedId]
                  : []
                : sortedLanes.map((lane) => lane.id),
            );
            setClearing(null);
          }}
        />
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
            <BeatBrowserSidebar
              beats={sortedBeats}
              selectedBeat={selectedBeat}
              selectedBeatId={selectedBeatId}
              tracks={sortedLanes}
              selectedTrackId={selectedId}
              peers={peers}
              muted={muted}
              soloed={soloed}
              canEdit={canEdit}
              onAddBeat={() => void addBeat()}
              onSelectBeat={(beatId, firstTrackId) => {
                setSelectedBeatId(beatId);
                setSelectedId(firstTrackId);
              }}
              onRenameBeat={(beatId, name) => void patchBeat(beatId, { name })}
              onRemoveBeat={(beatId) => void removeBeat(beatId)}
              onSelectTrack={setSelectedId}
              onRenameTrack={(trackId, name) => void renameTrack(trackId, name)}
              onRemoveTrack={(trackId) => void removeTrack(trackId)}
              onToggleMute={(trackId) => setMuted((current) => toggleIn(current, trackId))}
              onToggleSolo={(trackId) => setSoloed((current) => toggleIn(current, trackId))}
              onAddTrack={async (name, instrument) => {
                if (!selectedBeatId) return;
                await data.addTrack(selectedBeatId, name, instrument);
              }}
            />
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
          <BeatEditorCanvas
            selectedBeat={selectedBeat}
            selectedTrack={selected}
            tracks={sortedLanes}
            selectedBeatId={selectedBeatId}
            selectedTrackId={selectedId}
            selectedNote={selectedNote}
            notesByTrack={notesByTrack}
            peers={peers}
            flashing={flashing}
            live={live}
            canEdit={canEdit}
            aiEnabled={user?.aiAccess ?? false}
            currentStep={currentStep}
            octave={octave}
            beatSteps={beatSteps}
            laneNoteCount={laneNoteCount}
            beatNoteCount={beatNoteCount}
            error={error}
            rollRef={rollRef}
            onPatchBeat={(beatId, patch) => void patchBeat(beatId, patch)}
            onOctaveChange={(nextOctave) => {
              if (selected) setOctaves((current) => ({ ...current, [selected.id]: nextOctave }));
            }}
            onRequestClear={setClearing}
            onRequestGenerate={() => setGenerateOpen(true)}
            onRecordHistory={recordHistory}
            onUpdateNote={updateNote}
            onPreview={preview}
            onRollMouseDown={onRollMouseDown}
            onNoteMouseDown={onNoteMouseDown}
            onNoteContextMenu={onNoteContextMenu}
            onRollCursorMove={onRollCursorMove}
            onRackCursorMove={onRackCursorMove}
            onSelectTrack={setSelectedId}
          />
        )}

        {chat.open && (
          <ChatPanel
            messages={chat.messages}
            meId={user?.id}
            live={live}
            aiEnabled={user?.aiAccess ?? false}
            onSend={realtime.sendChat}
            onClose={() => chat.setOpen(false)}
          />
        )}
      </Workspace>
    </AppShell>
  );
}
