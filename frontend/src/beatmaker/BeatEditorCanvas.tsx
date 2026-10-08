import type { MutableRefObject } from "react";
import type { Beat, Step, Track } from "../types";
import { peerColor, type Peer } from "../realtime/socket";
import { colorFor } from "../ui/trackColors";
import { Button, EmptyState, ErrorBanner, RangeField, Select } from "../ui/kit";
import { Canvas, CanvasBar, IconButton, ToolGroup } from "../ui/shell";
import { BlocksIcon, LanesIcon, LibraryIcon, MinusIcon, PlusIcon, SparkIcon } from "../ui/icons";
import { CELL_H, CELL_W, PITCH_ROWS, ROLL_ROWS, VELOCITY_H, pitchOf, rowOf } from "./constants";
import { keyOf, type NoteKey } from "./noteOps";
import type { Box } from "./usePianoRoll";
import type { ClearScope } from "./ClearNotesDialog";

interface BeatEditorCanvasProps {
  selectedBeat: Beat | null;
  selectedTrack: Track | null;
  tracks: Track[];
  selectedBeatId: string | null;
  selectedTrackId: string | null;
  selection: Set<NoteKey>;
  marquee: Box | null;
  notesByTrack: Record<string, Step[]>;
  peers: Record<string, Peer>;
  flashing: Set<string>;
  live: boolean;
  canEdit: boolean;
  /** Whether THIS account may use the AI (admin-granted, mirrors the @ai
   *  chat hint) — controls only what's advertised; the server enforces. */
  aiEnabled: boolean;
  currentStep: number;
  octave: number;
  beatSteps: number;
  laneNoteCount: number;
  beatNoteCount: number;
  error: string | null;
  onDismissError: () => void;
  rollRef: MutableRefObject<HTMLDivElement | null>;
  onPatchBeat: (beatId: string, patch: { bars?: number }) => void;
  /** Swing mid-drag (local + audible on the next loop) and on release (saved). */
  onSwingChange: (swing: number) => void;
  onSwingCommit: (swing: number) => void;
  onOctaveChange: (octave: number) => void;
  onRequestClear: (scope: ClearScope) => void;
  onRequestGenerate: () => void;
  onRequestCompose: () => void;
  /** Empty-state actions: the fix offered where the gap is, not described. */
  onAddBeat: () => void;
  onOpenPresets: () => void;
  onAddLane: (name: string, instrument: string) => void;
  onRollMouseDown: (event: React.MouseEvent) => void;
  onRollMouseMove: (event: React.MouseEvent) => void;
  onRollMouseLeave: () => void;
  onNoteMouseDown: (event: React.MouseEvent, note: Step, resize: boolean) => void;
  onNoteContextMenu: (event: React.MouseEvent, note: Step) => void;
  onVelocityMouseDown: (event: React.MouseEvent) => void;
  onRackCursorMove: (event: React.MouseEvent, trackId: string) => void;
  onSelectTrack: (trackId: string) => void;
}

/** The gestures, where the grid can say them. There is no other place to
 *  discover Shift-drag or Ctrl+D; the handbook has the full list. */
const ROLL_HELP =
  "Click to draw · drag to move · drag a note's right edge to stretch · right-click to delete\n" +
  "Shift-drag to select · Shift-click to add · Ctrl+C / Ctrl+V / Ctrl+D · arrows nudge (Shift: beat / octave)";

/** Piano roll, velocity lane and channel rack. It renders editor state and emits user intent through callbacks. */
export function BeatEditorCanvas(props: BeatEditorCanvasProps) {
  const {
    selectedBeat,
    selectedTrack,
    tracks,
    selectedBeatId,
    selectedTrackId,
    selection,
    marquee,
    notesByTrack,
    peers,
    flashing,
    live,
    canEdit,
    aiEnabled,
    currentStep,
    octave,
    beatSteps,
    laneNoteCount,
    beatNoteCount,
    error,
    onDismissError,
    rollRef,
    onPatchBeat,
    onSwingChange,
    onSwingCommit,
    onOctaveChange,
    onRequestClear,
    onRequestGenerate,
    onRequestCompose,
    onAddBeat,
    onOpenPresets,
    onAddLane,
    onRollMouseDown,
    onRollMouseMove,
    onRollMouseLeave,
    onNoteMouseDown,
    onNoteContextMenu,
    onVelocityMouseDown,
    onRackCursorMove,
    onSelectTrack,
  } = props;

  const laneNotes = selectedTrack ? notesByTrack[selectedTrack.id] ?? [] : [];
  const hiddenNotes = selectedTrack
    ? laneNotes.filter((note) => rowOf(note.pitch, octave) === null).length
    : 0;
  const color = selectedTrack ? colorFor(selectedTrack.instrument) : undefined;

  const peerCells = new Map<string, Peer[]>();
  for (const peer of Object.values(peers)) {
    if (!peer.trackId) continue;
    const key = `${peer.trackId}:${peer.step}`;
    const current = peerCells.get(key);
    if (current) current.push(peer);
    else peerCells.set(key, [peer]);
  }

  return (
    <Canvas>
      {selectedBeat && (
        <CanvasBar>
          <span className="truncate text-sm font-semibold tracking-tight">
            {selectedTrack ? selectedTrack.name : selectedBeat.name}
          </span>
          {selectedTrack && (
            <span className="text-xs text-muted">{selectedTrack.instrument.toLowerCase()}</span>
          )}

          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted">
              length
              <Select
                className="!w-auto !py-0.5 !text-xs"
                value={selectedBeat.bars}
                disabled={!canEdit}
                onChange={(event) => onPatchBeat(selectedBeat.id, { bars: Number(event.target.value) })}
              >
                {[1, 2, 4, 8].map((bars) => (
                  <option key={bars} value={bars}>
                    {bars} bar{bars > 1 ? "s" : ""}
                  </option>
                ))}
              </Select>
            </label>
            {/* Swing belongs to the BEAT (V16), so it sits next to its length.
                0 = straight, 67 ≈ triplet swing, 100 = dotted. */}
            <div className="w-44">
              <RangeField
                label="swing"
                value={Math.round(selectedBeat.swing * 100)}
                min={0}
                max={100}
                format={(value) => `${value}%`}
                disabled={!canEdit}
                resetTo={0}
                title="Pushes every off-beat 16th late — 0 straight, ~67 triplet, 100 dotted. Double-click to reset."
                onChange={(value) => onSwingChange(value / 100)}
                onCommit={(value) => onSwingCommit(value / 100)}
              />
            </div>
          </div>

          {selectedTrack && (
            <ToolGroup>
              <IconButton onClick={() => onOctaveChange(Math.max(0, octave - 1))} title="Octave down">
                <MinusIcon className="h-3.5 w-3.5" />
              </IconButton>
              <span className="px-1 font-mono text-xs tabular-nums text-muted">
                C{octave}–B{octave + 1}
              </span>
              <IconButton onClick={() => onOctaveChange(Math.min(7, octave + 1))} title="Octave up">
                <PlusIcon className="h-3.5 w-3.5" />
              </IconButton>
            </ToolGroup>
          )}
          {/* Beat-level, so it does NOT require a selected lane — an empty
              beat has none, and "compose me a beat" is exactly what you want
              there. The per-lane Generate below needs a target. */}
          {canEdit && aiEnabled && (
            <IconButton
              title={`Describe a beat and the AI writes ${selectedBeat.name} — tempo, lanes and all`}
              onClick={onRequestCompose}
            >
              <SparkIcon className="h-4 w-4" />
              Compose
            </IconButton>
          )}
          {selectedTrack && canEdit && aiEnabled && (
            <IconButton
              title={`Describe a pattern and the AI writes it into ${selectedTrack.name} — undoable like any edit`}
              onClick={onRequestGenerate}
            >
              <SparkIcon className="h-4 w-4" />
              Generate
            </IconButton>
          )}
          {selectedTrack && canEdit && (
            <ToolGroup>
              <IconButton
                tone="danger"
                disabled={laneNoteCount === 0}
                title={`Clear the ${selectedTrack.name} lane (${laneNoteCount} note${laneNoteCount === 1 ? "" : "s"})`}
                onClick={() => onRequestClear("lane")}
              >
                Clear lane
              </IconButton>
              <IconButton
                tone="danger"
                disabled={beatNoteCount === 0}
                title={`Clear every lane in ${selectedBeat.name} (${beatNoteCount} note${beatNoteCount === 1 ? "" : "s"})`}
                onClick={() => onRequestClear("beat")}
              >
                Clear beat
              </IconButton>
            </ToolGroup>
          )}
        </CanvasBar>
      )}

      {error && (
        <div className="px-4 pt-4">
          <ErrorBanner onDismiss={onDismissError}>{error}</ErrorBanner>
        </div>
      )}

      {!selectedBeat ? (
        <div className="flex h-full items-center justify-center">
          <EmptyState
            icon={<BlocksIcon className="h-8 w-8" />}
            title="No beats yet"
            hint="A beat is a pattern of instrument lanes that you place on the timeline."
            action={
              canEdit && (
                <>
                  <Button onClick={onOpenPresets}>
                    <LibraryIcon className="h-4 w-4" />
                    Start from a preset
                  </Button>
                  <Button variant="ghost" onClick={onAddBeat}>
                    Empty beat
                  </Button>
                </>
              )
            }
          />
        </div>
      ) : !selectedTrack ? (
        <div className="flex h-full items-center justify-center">
          <EmptyState
            icon={<LanesIcon className="h-8 w-8" />}
            title="No lanes in this beat"
            action={
              canEdit && (
                <>
                  <Button onClick={() => onAddLane("Drums", "DRUMS")}>
                    <PlusIcon className="h-4 w-4" />
                    Drums
                  </Button>
                  <Button variant="ghost" onClick={() => onAddLane("Bass", "BASS")}>
                    Bass
                  </Button>
                  <Button variant="ghost" onClick={() => onAddLane("Keys", "PIANO")}>
                    Keys
                  </Button>
                </>
              )
            }
          />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col p-4">
          <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-edge bg-bg-soft p-2">
            <div className="w-max select-none">
              {/* ---- piano roll ---- */}
              <div className="flex">
                <div className="sticky left-0 z-2 w-11 shrink-0 bg-bg-soft text-[0.68rem] text-muted">
                  {Array.from({ length: ROLL_ROWS }, (_, row) => {
                    const pitch = pitchOf(row, octave);
                    const isC = row % PITCH_ROWS.length === PITCH_ROWS.length - 1;
                    return (
                      <div
                        key={row}
                        style={{ height: CELL_H }}
                        className={
                          "flex items-center justify-end pr-2 font-mono " +
                          (pitch.includes("#") ? "text-muted/45" : isC ? "font-semibold text-text" : "")
                        }
                      >
                        {pitch}
                      </div>
                    );
                  })}
                </div>
                <div
                  className="roll"
                  ref={rollRef}
                  data-testid="piano-roll"
                  title={canEdit ? ROLL_HELP : undefined}
                  onMouseDown={canEdit ? onRollMouseDown : undefined}
                  onMouseMove={onRollMouseMove}
                  onMouseLeave={onRollMouseLeave}
                  style={{ width: beatSteps * CELL_W, height: ROLL_ROWS * CELL_H }}
                >
                  {Array.from({ length: ROLL_ROWS }, (_, row) => {
                    const sharp = PITCH_ROWS[row % PITCH_ROWS.length].includes("#");
                    const octaveSeam = row % PITCH_ROWS.length === PITCH_ROWS.length - 1;
                    return Array.from({ length: beatSteps }, (_, column) => (
                      <div
                        key={`${row}-${column}`}
                        className={[
                          "roll-cell",
                          sharp ? "dark" : "",
                          octaveSeam ? "seam" : "",
                          column % 16 === 0 ? "bar" : column % 4 === 0 ? "beat" : "",
                          column === currentStep ? "playcol" : "",
                        ].join(" ")}
                        style={{
                          left: column * CELL_W,
                          top: row * CELL_H,
                          width: CELL_W,
                          height: CELL_H,
                        }}
                      />
                    ));
                  })}
                  {Object.values(peers)
                    .filter((peer) => peer.trackId === selectedTrack.id && peer.beatId === selectedBeatId)
                    .map((peer) => (
                      <div
                        key={peer.userId}
                        className="peer-cursor"
                        style={{
                          left: peer.step * CELL_W,
                          top: peer.row * CELL_H,
                          "--pc": peerColor(peer.userId),
                        } as React.CSSProperties}
                      >
                        <span className="peer-label">{peer.displayName}</span>
                      </div>
                    ))}
                  {laneNotes.map((note) => {
                    const row = rowOf(note.pitch, octave);
                    if (row === null) return null;
                    const key = keyOf(note);
                    const remote = flashing.has(`${selectedTrack.id}:${note.step}:${note.pitch}`);
                    return (
                      <div
                        key={key}
                        className={`note ${selection.has(key) ? "selected" : ""} ${remote ? "landed" : ""}`}
                        style={{
                          left: note.step * CELL_W + 1,
                          top: row * CELL_H + 2,
                          width: note.length * CELL_W - 3,
                          height: CELL_H - 4,
                          opacity: 0.45 + 0.55 * note.velocity,
                          "--tc": color,
                        } as React.CSSProperties}
                        onMouseDown={canEdit ? (event) => onNoteMouseDown(event, note, false) : undefined}
                        onContextMenu={canEdit ? (event) => onNoteContextMenu(event, note) : undefined}
                      >
                        {canEdit && (
                          <span
                            className="note-handle"
                            onMouseDown={(event) => onNoteMouseDown(event, note, true)}
                          />
                        )}
                      </div>
                    );
                  })}
                  {marquee && (
                    <div
                      className="marquee"
                      style={{
                        left: marquee.stepFrom * CELL_W,
                        top: marquee.rowFrom * CELL_H,
                        width: (marquee.stepTo - marquee.stepFrom + 1) * CELL_W,
                        height: (marquee.rowTo - marquee.rowFrom + 1) * CELL_H,
                      }}
                    />
                  )}
                </div>
              </div>

              {/* ---- velocity lane ----
                  Every note in the lane, not just the visible octaves:
                  loudness is per note whatever its pitch. Press and sweep to
                  paint; with a selection, only selected notes change. */}
              <div className="mt-2 flex border-t border-edge pt-2">
                <div className="sticky left-0 z-2 flex w-11 shrink-0 items-start justify-end bg-bg-soft pr-2 pt-0.5 text-[0.62rem] font-semibold uppercase tracking-wider text-muted">
                  vel
                </div>
                <div
                  className={"velocity-lane" + (canEdit ? " editable" : "")}
                  style={{ width: beatSteps * CELL_W, height: VELOCITY_H }}
                  onMouseDown={canEdit ? onVelocityMouseDown : undefined}
                  title={canEdit ? "Drag up and down across the notes to set how hard each one hits" : undefined}
                >
                  {laneNotes.map((note) => {
                    const key = keyOf(note);
                    return (
                      <div
                        key={key}
                        className={"velocity-bar" + (selection.has(key) ? " selected" : "")}
                        style={{
                          left: note.step * CELL_W + CELL_W / 2 - 3,
                          height: Math.max(2, note.velocity * VELOCITY_H),
                          "--tc": color,
                        } as React.CSSProperties}
                      />
                    );
                  })}
                </div>
              </div>
              {hiddenNotes > 0 && (
                <p className="mt-1 pl-11 text-xs text-muted">
                  {hiddenNotes} note{hiddenNotes === 1 ? "" : "s"} outside C{octave}–B{octave + 1}
                </p>
              )}

              {/* ---- channel rack: every lane of the beat at a glance ---- */}
              <div className="mt-3 flex flex-col gap-1 border-t border-edge pt-3">
                {tracks.map((track) => {
                  const notes = notesByTrack[track.id] ?? [];
                  return (
                    <div
                      key={track.id}
                      className={
                        "flex cursor-pointer items-center rounded transition-colors duration-150 " +
                        (track.id === selectedTrackId ? "bg-surface-2" : "hover:bg-surface-2/60")
                      }
                      onClick={() => onSelectTrack(track.id)}
                    >
                      <span className="sticky left-0 z-2 flex w-11 shrink-0 items-center gap-1 bg-bg-soft pr-1">
                        <i
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: colorFor(track.instrument) }}
                          title={track.name}
                        />
                        <span className="truncate text-[0.6rem] font-semibold text-muted">{track.name}</span>
                      </span>
                      <div
                        className="flex"
                        onMouseMove={live ? (event) => onRackCursorMove(event, track.id) : undefined}
                        style={{ "--tc": colorFor(track.instrument) } as React.CSSProperties}
                      >
                        {Array.from({ length: beatSteps }, (_, step) => {
                          const here = peerCells.get(`${track.id}:${step}`);
                          return (
                            <span
                              key={step}
                              title={here && `${here.map((peer) => peer.displayName).join(", ")} here`}
                              className={[
                                "cell",
                                notes.some((note) => step >= note.step && step < note.step + note.length) ? "on" : "",
                                step === currentStep ? "playhead" : "",
                                step % 16 === 0 ? "bar" : step % 4 === 0 ? "beat" : "",
                                here ? "peer" : "",
                              ].join(" ")}
                              style={{
                                width: CELL_W - 3,
                                height: 16,
                                marginRight: 3,
                                ...(here ? { "--pcell": peerColor(here[0].userId) } : {}),
                              } as React.CSSProperties}
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
  );
}
