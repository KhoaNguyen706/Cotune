import type { MutableRefObject } from "react";
import type { Beat, Step, Track } from "../types";
import { peerColor, type Peer } from "../realtime/socket";
import { colorFor } from "../ui/trackColors";
import { EmptyState, ErrorBanner, Select } from "../ui/kit";
import { Canvas, CanvasBar, IconButton, ToolGroup } from "../ui/shell";
import { CELL_H, CELL_W, PITCH_ROWS, rowOf } from "./constants";
import type { ClearScope } from "./ClearNotesDialog";

interface BeatEditorCanvasProps {
  selectedBeat: Beat | null;
  selectedTrack: Track | null;
  tracks: Track[];
  selectedBeatId: string | null;
  selectedTrackId: string | null;
  selectedNote: number | null;
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
  rollRef: MutableRefObject<HTMLDivElement | null>;
  onPatchBeat: (beatId: string, patch: { bars?: number }) => void;
  onOctaveChange: (octave: number) => void;
  onRequestClear: (scope: ClearScope) => void;
  onRequestGenerate: () => void;
  /** Mid-drag: local state + live audio, no server traffic. */
  onMixChange: (mix: { volume?: number; pan?: number }) => void;
  /** Pointer-up: persist the final values — one PATCH per drag. */
  onMixCommit: (mix: { volume?: number; pan?: number }) => void;
  onRecordHistory: () => void;
  onUpdateNote: (trackId: string, index: number, changes: Partial<Step>) => void;
  onPreview: (trackId: string, pitch: string, velocity: number) => void;
  onRollMouseDown: (event: React.MouseEvent) => void;
  onNoteMouseDown: (event: React.MouseEvent, index: number, note: Step, resize: boolean) => void;
  onNoteContextMenu: (event: React.MouseEvent, index: number) => void;
  onRollCursorMove: (event: React.MouseEvent) => void;
  onRackCursorMove: (event: React.MouseEvent, trackId: string) => void;
  onSelectTrack: (trackId: string) => void;
}

/** Piano roll and channel rack. It renders editor state and emits user intent through callbacks. */
export function BeatEditorCanvas(props: BeatEditorCanvasProps) {
  const {
    selectedBeat,
    selectedTrack,
    tracks,
    selectedBeatId,
    selectedTrackId,
    selectedNote,
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
    rollRef,
    onPatchBeat,
    onOctaveChange,
    onRequestClear,
    onRequestGenerate,
    onMixChange,
    onMixCommit,
    onRecordHistory,
    onUpdateNote,
    onPreview,
    onRollMouseDown,
    onNoteMouseDown,
    onNoteContextMenu,
    onRollCursorMove,
    onRackCursorMove,
    onSelectTrack,
  } = props;

  const selectedNotes = selectedTrack ? notesByTrack[selectedTrack.id] ?? [] : [];
  const hiddenNotes = selectedTrack
    ? selectedNotes.filter((note) => rowOf(note.pitch, octave) === null).length
    : 0;
  const currentNote =
    selectedTrack !== null && selectedNote !== null ? selectedNotes[selectedNote] ?? null : null;

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
          <span className="text-sm font-bold tracking-tight">
            {selectedTrack ? selectedTrack.name : selectedBeat.name}
          </span>
          {selectedTrack && (
            <span className="text-xs text-muted">{selectedTrack.instrument.toLowerCase()}</span>
          )}
          <label className="ml-auto flex items-center gap-2 text-xs text-muted">
            length
            <Select
              className="!w-auto !py-0.5 text-xs"
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
          {selectedTrack && (
            <ToolGroup>
              <IconButton onClick={() => onOctaveChange(Math.max(0, octave - 1))} title="Octave down">−</IconButton>
              <span className="px-1 font-mono text-xs tabular-nums text-muted">oct {octave}</span>
              <IconButton onClick={() => onOctaveChange(Math.min(7, octave + 1))} title="Octave up">+</IconButton>
            </ToolGroup>
          )}
          {selectedTrack && (
            <ToolGroup>
              {/* The lane's MIX (V14) — saved on the song, so it survives
                  reload and collaborators hear the same balance. Live while
                  dragging (audio + state); persisted once, on release. */}
              <label
                className="flex items-center gap-1.5 px-1 text-xs text-muted"
                title={`${selectedTrack.name} volume — part of the song, everyone hears it`}
              >
                vol
                <input
                  type="range"
                  className="w-16"
                  min={0}
                  max={100}
                  value={Math.round(selectedTrack.volume * 100)}
                  disabled={!canEdit}
                  onChange={(event) => onMixChange({ volume: Number(event.target.value) / 100 })}
                  onPointerUp={(event) =>
                    onMixCommit({ volume: Number(event.currentTarget.value) / 100 })
                  }
                />
              </label>
              <label
                className="flex items-center gap-1.5 px-1 text-xs text-muted"
                title={`${selectedTrack.name} stereo pan — double-click to re-center`}
              >
                pan
                <input
                  type="range"
                  className="w-16"
                  min={-100}
                  max={100}
                  value={Math.round(selectedTrack.pan * 100)}
                  disabled={!canEdit}
                  onChange={(event) => onMixChange({ pan: Number(event.target.value) / 100 })}
                  onPointerUp={(event) =>
                    onMixCommit({ pan: Number(event.currentTarget.value) / 100 })
                  }
                  onDoubleClick={() => {
                    // The DAW convention: double-click a pan knob = center.
                    onMixChange({ pan: 0 });
                    onMixCommit({ pan: 0 });
                  }}
                />
              </label>
            </ToolGroup>
          )}
          {selectedTrack && canEdit && aiEnabled && (
            <IconButton
              title={`Describe a pattern and the AI writes it into ${selectedTrack.name} — undoable like any edit`}
              onClick={onRequestGenerate}
            >
              ✨ Generate
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
          {currentNote && selectedTrack && (
            <label className="flex items-center gap-2 whitespace-nowrap text-xs text-muted">
              vel {Math.round(currentNote.velocity * 100)}%
              <input
                type="range"
                className="w-24"
                min={10}
                max={100}
                value={Math.round(currentNote.velocity * 100)}
                onPointerDown={onRecordHistory}
                onChange={(event) => {
                  const velocity = Number(event.target.value) / 100;
                  onUpdateNote(selectedTrack.id, selectedNote!, { velocity });
                  onPreview(selectedTrack.id, currentNote.pitch, velocity);
                }}
              />
            </label>
          )}
          {hiddenNotes > 0 && <span className="text-xs text-muted">{hiddenNotes} note(s) in other octaves</span>}
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
            hint={'A beat is a full multi-instrument groove — "Beat 1" with kick, snare and bass lanes. Create one in the left panel, build it here, then place it on the Arrange timeline.'}
          />
        </div>
      ) : !selectedTrack ? (
        <div className="flex h-full items-center justify-center">
          <EmptyState
            icon="🥁"
            title="No lanes in this beat"
            hint="Add a drums lane in the left panel, then click cells here to lay down your first kick pattern."
          />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col p-4">
          <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-edge bg-bg-soft p-2">
            <div className="w-max select-none">
              <div className="flex">
                <div className="sticky left-0 z-2 w-11 shrink-0 bg-bg-soft text-[0.68rem] text-muted">
                  {PITCH_ROWS.map((pitch) => (
                    <div
                      key={pitch}
                      style={{ height: CELL_H }}
                      className={"flex items-center justify-end pr-2" + (pitch.includes("#") ? " text-muted/50" : "")}
                    >
                      {pitch}{octave}
                    </div>
                  ))}
                </div>
                <div
                  className="roll"
                  ref={rollRef}
                  data-testid="piano-roll"
                  onMouseDown={canEdit ? onRollMouseDown : undefined}
                  onMouseMove={live ? onRollCursorMove : undefined}
                  style={{ width: beatSteps * CELL_W, height: PITCH_ROWS.length * CELL_H }}
                >
                  {PITCH_ROWS.map((pitch, row) =>
                    Array.from({ length: beatSteps }, (_, column) => (
                      <div
                        key={`${row}-${column}`}
                        className={[
                          "roll-cell",
                          pitch.includes("#") ? "dark" : "",
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
                    )),
                  )}
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
                  {selectedNotes.map((note, index) => {
                    const row = rowOf(note.pitch, octave);
                    if (row === null) return null;
                    const remote = flashing.has(`${selectedTrack.id}:${note.step}:${note.pitch}`);
                    return (
                      <div
                        key={index}
                        className={`note ${index === selectedNote ? "selected" : ""} ${remote ? "landed" : ""}`}
                        style={{
                          left: note.step * CELL_W + 1,
                          top: row * CELL_H + 2,
                          width: note.length * CELL_W - 3,
                          height: CELL_H - 4,
                          opacity: 0.35 + 0.65 * note.velocity,
                          "--tc": colorFor(selectedTrack.instrument),
                        } as React.CSSProperties}
                        onMouseDown={canEdit ? (event) => onNoteMouseDown(event, index, note, false) : undefined}
                        onContextMenu={canEdit ? (event) => onNoteContextMenu(event, index) : undefined}
                      >
                        {canEdit && (
                          <span
                            className="note-handle"
                            onMouseDown={(event) => onNoteMouseDown(event, index, note, true)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

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
