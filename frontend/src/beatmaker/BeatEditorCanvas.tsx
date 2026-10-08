import { useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { Beat, Step, Track } from "../types";
import { peerColor, type Peer } from "../realtime/socket";
import { colorFor } from "../ui/trackColors";
import { instrumentLabel } from "../audio/instrumentList";
import { Button, EmptyState, ErrorBanner } from "../ui/kit";
import { Canvas, CanvasBar, IconButton, ToolGroup } from "../ui/shell";
import { BlocksIcon, LanesIcon, LibraryIcon, MinusIcon, PlusIcon, SparkIcon } from "../ui/icons";
import { CELL_H, CELL_W, PITCH_ROWS, ROLL_ROWS, STEPS, VELOCITY_H, pitchOf, rowOf } from "./constants";
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
  error: string | null;
  onDismissError: () => void;
  rollRef: MutableRefObject<HTMLDivElement | null>;
  onOctaveChange: (octave: number) => void;
  onRequestClear: (scope: ClearScope) => void;
  onRequestGenerate: () => void;
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
  "Click to draw, drag to move, drag a note's right edge to stretch, right-click to delete.\n" +
  "Shift-drag to select, Shift-click to add. Ctrl+C, Ctrl+V, Ctrl+D. Arrows nudge (Shift: a beat or an octave).";

/** Width of the pitch-label gutter; the ruler, velocity and rack labels share it
 *  so every row's step 1 lines up under the same ruler key. */
const GUTTER = "w-12";

/** The tint a roll column takes from its beat's key. Beat 4 is the white
 *  key: no tint. On the chassis it would be invisible anyway, and on the
 *  night panel a light tint made every fourth beat look selected. */
const keyVar = (step: number) => {
  const key = Math.floor((step % STEPS) / 4) + 1;
  return key === 4 ? "transparent" : `var(--color-key-${key})`;
};

/**
 * The step ruler — the signature. One cell per beat (4 steps), striped in
 * that beat's key color, numbered in ink: the bar number on the downbeat,
 * "bar.beat" elsewhere. Same columns as the roll below it, so the stripe
 * over a note says which beat it is on without counting squares.
 */
function StepRuler({ steps }: { steps: number }) {
  return (
    <div className="step-ruler" style={{ width: steps * CELL_W }} aria-hidden>
      {Array.from({ length: steps / 4 }, (_, beat) => {
        const key = (beat % 4) + 1;
        const bar = Math.floor(beat / 4) + 1;
        return (
          <span
            key={beat}
            className={`step-ruler-beat k${key}`}
            style={{ left: beat * 4 * CELL_W, width: 4 * CELL_W, "--key": `var(--color-key-${key})` } as React.CSSProperties}
          >
            {key === 1 ? bar : `${bar}.${key}`}
          </span>
        );
      })}
    </div>
  );
}

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
    error,
    onDismissError,
    rollRef,
    onOctaveChange,
    onRequestClear,
    onRequestGenerate,
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

  // Opening a lane scrolls its notes into view. The roll is two octaves
  // tall, more than the bank and mixer leave it, so a kick on C2 sat below
  // the fold and the lane looked empty. Once per lane and octave, and only
  // when the notes are off screen: the view must never jump while you draw.
  const revealed = useRef<string | null>(null);
  useLayoutEffect(() => {
    const roll = rollRef.current;
    const pane = roll?.closest("main");
    const key = `${selectedTrackId}:${octave}`;
    if (!roll || !pane || !selectedTrackId || revealed.current === key) return;
    revealed.current = key;
    const rows = laneNotes.map((note) => rowOf(note.pitch, octave)).filter((row) => row !== null);
    if (rows.length === 0) return;
    const rollTop = roll.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
    const top = rollTop + Math.min(...rows) * CELL_H;
    const bottom = rollTop + (Math.max(...rows) + 1) * CELL_H;
    const laneBar = 44; // the sticky CanvasBar covers the top of the pane
    if (top >= pane.scrollTop + laneBar && bottom <= pane.scrollTop + pane.clientHeight) return;
    pane.scrollTop = Math.max(0, (top + bottom) / 2 - (pane.clientHeight + laneBar) / 2);
  });

  const peerCells = new Map<string, Peer[]>();
  for (const peer of Object.values(peers)) {
    if (!peer.trackId) continue;
    const key = `${peer.trackId}:${peer.step}`;
    const current = peerCells.get(key);
    if (current) current.push(peer);
    else peerCells.set(key, [peer]);
  }

  return (
    <Canvas className="min-h-0">
      {/* The lane bar: what the grid below is showing, and the controls that
          act on THAT lane. Beat-wide settings live in the bank above. */}
      {selectedBeat && selectedTrack && (
        <CanvasBar>
          <i aria-hidden className="h-3 w-3 shrink-0 rounded-[2px]" style={{ background: colorFor(selectedTrack.instrument) }} />
          <span className="min-w-0 truncate text-sm font-bold font-stretch-semi-condensed" title={selectedTrack.name}>
            {selectedTrack.name}
          </span>
          {/* The instrument is on the lane's strip too; a phone spends the
              width on the name instead. */}
          <span className="shrink-0 text-xs text-muted max-md:hidden">{instrumentLabel(selectedTrack.instrument)}</span>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ToolGroup>
              <IconButton onClick={() => onOctaveChange(Math.max(0, octave - 1))} title="Octave down" aria-label="Octave down">
                <MinusIcon className="h-3.5 w-3.5" />
              </IconButton>
              <span className="whitespace-nowrap px-1 text-xs font-semibold tabular-nums" aria-live="polite">
                C{octave} to B{octave + 1}
              </span>
              <IconButton onClick={() => onOctaveChange(Math.min(7, octave + 1))} title="Octave up" aria-label="Octave up">
                <PlusIcon className="h-3.5 w-3.5" />
              </IconButton>
            </ToolGroup>
            {canEdit && aiEnabled && (
              <IconButton
                title={`Describe a pattern and the AI writes it into ${selectedTrack.name}. Undo works like any edit.`}
                onClick={onRequestGenerate}
              >
                <SparkIcon className="h-4 w-4" />
                Generate
              </IconButton>
            )}
            {canEdit && (
              <IconButton
                tone="danger"
                disabled={laneNoteCount === 0}
                title={`Clear the ${selectedTrack.name} lane (${laneNoteCount} note${laneNoteCount === 1 ? "" : "s"})`}
                onClick={() => onRequestClear("lane")}
              >
                Clear lane
              </IconButton>
            )}
          </div>
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
            hint="A beat is a few bars of instrument lanes. Make one here, then place it on the timeline in Arrange."
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
            hint="Each lane is one instrument. Pick one to start, or name your own in the mixer below."
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
          <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-edge bg-surface p-2">
            <div className="w-max select-none">
              {/* ---- step ruler ---- */}
              <div className="flex">
                <div className={`sticky left-0 z-2 ${GUTTER} shrink-0 bg-surface`} />
                <StepRuler steps={beatSteps} />
              </div>
              {/* ---- piano roll ---- */}
              <div className="flex">
                <div className={`sticky left-0 z-2 ${GUTTER} shrink-0 bg-surface text-[0.7rem] text-muted`}>
                  {Array.from({ length: ROLL_ROWS }, (_, row) => {
                    const pitch = pitchOf(row, octave);
                    const isC = row % PITCH_ROWS.length === PITCH_ROWS.length - 1;
                    return (
                      <div
                        key={row}
                        style={{ height: CELL_H }}
                        className={
                          "flex items-center justify-end pr-2 tabular-nums " +
                          (pitch.includes("#") ? "text-muted/70" : isC ? "font-bold text-text" : "")
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
                          "--key": keyVar(column),
                        } as React.CSSProperties}
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
                          // How hard it hits is how dark it prints.
                          opacity: 0.4 + 0.6 * note.velocity,
                        }}
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
                <div className={`sticky left-0 z-2 flex ${GUTTER} shrink-0 items-start justify-end bg-surface pr-2 pt-0.5 text-[0.7rem] font-semibold text-muted`}>
                  Vel
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
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              {hiddenNotes > 0 && (
                <p className="mt-1 pl-12 text-xs text-muted">
                  {hiddenNotes} note{hiddenNotes === 1 ? "" : "s"} outside C{octave} to B{octave + 1}. Change the octave to see them.
                </p>
              )}

              {/* ---- channel rack: every lane of the beat at a glance ----
                  The one view where a collaborator on ANOTHER lane is still
                  visible on the grid (a ring on the step they are on). */}
              <div className="mt-3 flex flex-col gap-1 border-t border-edge pt-3">
                {tracks.map((track) => {
                  const notes = notesByTrack[track.id] ?? [];
                  return (
                    <div
                      key={track.id}
                      className={
                        "flex cursor-pointer items-center rounded-sm transition-colors duration-150 " +
                        (track.id === selectedTrackId ? "bg-surface-2" : "hover:bg-surface-2/60")
                      }
                      onClick={() => onSelectTrack(track.id)}
                    >
                      <span className={`sticky left-0 z-2 flex ${GUTTER} shrink-0 items-center gap-1 bg-surface pr-1`}>
                        <i
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-[2px]"
                          style={{ background: colorFor(track.instrument) }}
                        />
                        <span className="truncate text-[0.68rem] font-semibold font-stretch-condensed" title={track.name}>
                          {track.name}
                        </span>
                      </span>
                      <div
                        className="flex"
                        onMouseMove={live ? (event) => onRackCursorMove(event, track.id) : undefined}
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
