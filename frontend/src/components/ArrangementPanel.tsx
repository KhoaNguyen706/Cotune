import { useEffect, useRef, useState } from "react";
import { ApiError, fetchBinary, gql, rest } from "../api/client";
import { downloadBlob, evictAudioBuffer, secondsPerStep, STEPS_PER_BAR, uploadAudioFile } from "../audio/engine";
import { beatColor, colorFor } from "../ui/trackColors";
import { Button, EmptyState } from "../ui/kit";
import type { AudioFile, Beat, Clip } from "../types";

/**
 * The timeline: lanes × bars, video-editor style. BEATS (whole
 * multi-instrument grooves — Beat 1, Beat 2...) and uploaded audio are
 * MATERIAL (left palette); the timeline holds PLACEMENTS (clips). One
 * beat clip plays every lane of that beat, looping bar by bar.
 * Arm material by clicking it, then click a lane to place a clip. Drag to
 * move, drag the right edge to resize, right-click to delete, double-click
 * a beat clip to open that beat in the Beats tab.
 */

// Geometry constants shared by rendering and drag math — same rule as the
// piano roll: one source, pixel-exact agreement.
const STEP_W = 3.5; // px per 16th step → 56px per bar
const BAR_W = STEP_W * STEPS_PER_BAR;
const LANE_H = 44;
const LANES = 8;
const MAX_STEPS = 16 * 128; // mirrors Clip.MAX_TIMELINE_STEPS server-side

const ADD_CLIP = `
  mutation AddClip($input: AddClipInput!) {
    addClip(input: $input) { id lane startStep lengthSteps type beatId audioId }
  }
`;

const UPDATE_CLIP = `
  mutation UpdateClip($id: ID!, $input: UpdateClipInput!) {
    updateClip(id: $id, input: $input) { id }
  }
`;

const DELETE_CLIP = `
  mutation DeleteClip($id: ID!) { deleteClip(id: $id) }
`;

type Armed =
  | { kind: "BEAT"; beatId: string }
  | { kind: "AUDIO"; audioId: string }
  | null;

interface DragState {
  clipId: string;
  mode: "move" | "resize";
  grabOffsetSteps: number; // move: steps between clip.startStep and grab point
  rect: DOMRect; // lanes-content geometry at drag start
  moved: boolean;
}

interface ArrangementPanelProps {
  songId: string;
  bpm: number;
  beats: Beat[];
  audioFiles: AudioFile[];
  clips: Clip[];
  onClipsChange: (updater: (prev: Clip[]) => Clip[]) => void;
  onAudioFilesChange: (updater: (prev: AudioFile[]) => AudioFile[]) => void;
  /** Absolute playhead step during arrangement playback; -1 when stopped. */
  playheadStep: number;
  onError: (message: string | null) => void;
  onOpenBeat: (beatId: string) => void;
}

export function ArrangementPanel({
  songId,
  bpm,
  beats,
  audioFiles,
  clips,
  onClipsChange,
  onAudioFilesChange,
  playheadStep,
  onError,
  onOpenBeat,
}: ArrangementPanelProps) {
  const [armed, setArmed] = useState<Armed>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lanesRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;

  // Timeline width grows with content: last clip + breathing room.
  const lastStep = clips.reduce((max, c) => Math.max(max, c.startStep + c.lengthSteps), 0);
  const bars = Math.min(128, Math.max(16, Math.ceil(lastStep / STEPS_PER_BAR) + 4));

  const beatById = new Map(beats.map((b) => [b.id, b]));
  const audioById = new Map(audioFiles.map((a) => [a.id, a]));

  function snapBar(steps: number): number {
    return Math.round(steps / STEPS_PER_BAR) * STEPS_PER_BAR;
  }

  function stepFromX(clientX: number, rect: DOMRect): number {
    return Math.max(0, Math.min(MAX_STEPS - 1, (clientX - rect.left) / STEP_W));
  }

  function laneFromY(clientY: number, rect: DOMRect): number {
    return Math.max(0, Math.min(LANES - 1, Math.floor((clientY - rect.top) / LANE_H)));
  }

  // ---- clip mutations -----------------------------------------------------

  async function placeArmed(e: React.MouseEvent) {
    if (!armed || e.button !== 0 || !lanesRef.current) return;
    const rect = lanesRef.current.getBoundingClientRect();
    const lane = laneFromY(e.clientY, rect);
    const startStep = Math.min(MAX_STEPS - STEPS_PER_BAR, snapBar(stepFromX(e.clientX, rect)));

    // Beat clips start at one bar (one pattern pass — stretch to loop);
    // audio clips get their natural duration in steps at the CURRENT tempo.
    let lengthSteps = STEPS_PER_BAR;
    if (armed.kind === "AUDIO") {
      const file = audioById.get(armed.audioId);
      if (!file) return;
      lengthSteps = Math.max(2, Math.ceil(file.durationSeconds / secondsPerStep(bpm)));
    }
    lengthSteps = Math.min(lengthSteps, MAX_STEPS - startStep);

    onError(null);
    try {
      const data = await gql<{ addClip: Clip }>(ADD_CLIP, {
        input: {
          songId,
          lane,
          startStep,
          lengthSteps,
          beatId: armed.kind === "BEAT" ? armed.beatId : null,
          audioId: armed.kind === "AUDIO" ? armed.audioId : null,
        },
      });
      onClipsChange((prev) => [...prev, data.addClip]);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to place clip");
    }
  }

  function onClipMouseDown(e: React.MouseEvent, clip: Clip, resize: boolean) {
    if (e.button !== 0 || !lanesRef.current) return;
    e.preventDefault();
    e.stopPropagation(); // don't fall through to placeArmed
    const rect = lanesRef.current.getBoundingClientRect();
    dragRef.current = {
      clipId: clip.id,
      mode: resize ? "resize" : "move",
      grabOffsetSteps: stepFromX(e.clientX, rect) - clip.startStep,
      rect,
      moved: false,
    };
  }

  async function onClipContextMenu(e: React.MouseEvent, clip: Clip) {
    e.preventDefault();
    onError(null);
    // Optimistic remove; restore on failure.
    onClipsChange((prev) => prev.filter((c) => c.id !== clip.id));
    try {
      await gql(DELETE_CLIP, { id: clip.id });
    } catch (err) {
      onClipsChange((prev) => [...prev, clip]);
      onError(err instanceof ApiError ? err.message : "Failed to delete clip");
    }
  }

  // Document-level drag listeners, one-time attach, state through refs —
  // the piano-roll pattern (drags must survive leaving the panel).
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const clip = clipsRef.current.find((c) => c.id === drag.clipId);
      if (!clip) return;
      const cursorStep = stepFromX(e.clientX, drag.rect);

      if (drag.mode === "move") {
        const lane = laneFromY(e.clientY, drag.rect);
        const startStep = Math.max(
          0,
          Math.min(MAX_STEPS - clip.lengthSteps, snapBar(cursorStep - drag.grabOffsetSteps)),
        );
        if (lane !== clip.lane || startStep !== clip.startStep) {
          drag.moved = true;
          onClipsChange((prev) =>
            prev.map((c) => (c.id === clip.id ? { ...c, lane, startStep } : c)),
          );
        }
      } else {
        // Beat clips resize by whole bars (every lane's pattern loops per
        // bar); audio clips resize by steps (truncation is free-form, like
        // trimming a clip's right edge in a video editor).
        const raw = cursorStep - clip.startStep;
        const lengthSteps = Math.max(
          clip.type === "BEAT" ? STEPS_PER_BAR : 2,
          Math.min(
            MAX_STEPS - clip.startStep,
            clip.type === "BEAT" ? snapBar(raw) : Math.round(raw),
          ),
        );
        if (lengthSteps !== clip.lengthSteps) {
          drag.moved = true;
          onClipsChange((prev) =>
            prev.map((c) => (c.id === clip.id ? { ...c, lengthSteps } : c)),
          );
        }
      }
    }

    function onUp() {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || !drag.moved) return;
      const clip = clipsRef.current.find((c) => c.id === drag.clipId);
      if (!clip) return;
      // The drag mutated local state live; the release commits it.
      gql(UPDATE_CLIP, {
        id: clip.id,
        input: { lane: clip.lane, startStep: clip.startStep, lengthSteps: clip.lengthSteps },
      }).catch((err) => {
        onError(err instanceof ApiError ? err.message : "Failed to save clip position");
      });
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc disarms — the hint text promises it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === "Escape") setArmed(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ---- audio material -----------------------------------------------------

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // same file re-selectable
    if (!file) return;
    setUploading(true);
    onError(null);
    try {
      const dto = await uploadAudioFile(songId, file);
      onAudioFilesChange((prev) => [...prev, dto]);
      setArmed({ kind: "AUDIO", audioId: dto.id }); // ready to place
    } catch (err) {
      onError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function downloadAudio(file: AudioFile) {
    onError(null);
    try {
      const bytes = await fetchBinary(`/api/audio/${file.id}`);
      downloadBlob(new Blob([bytes], { type: file.contentType }), file.filename);
    } catch {
      onError("Failed to download audio file");
    }
  }

  async function deleteAudio(file: AudioFile) {
    onError(null);
    try {
      await rest<void>(`/api/audio/${file.id}`, { method: "DELETE" });
      evictAudioBuffer(file.id);
      onAudioFilesChange((prev) => prev.filter((f) => f.id !== file.id));
      // Server cascades clip deletion; mirror it locally.
      onClipsChange((prev) => prev.filter((c) => c.audioId !== file.id));
      setArmed((prev) => (prev?.kind === "AUDIO" && prev.audioId === file.id ? null : prev));
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to delete audio file");
    }
  }

  // ---- render ---------------------------------------------------------------

  const paletteItem =
    "flex w-full items-center gap-2 rounded-lg border px-2 py-1 text-left text-xs cursor-pointer " +
    "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Timeline</h2>
        <p className="text-xs text-muted">
          {armed
            ? "Click a lane to place the armed clip · Esc or click it again to disarm"
            : "Click a beat or audio file on the left to arm it, then click a lane to place it"}
          {" · drag = move · right edge = resize (beat clips loop per bar) · right-click = delete · double-click beat = edit"}
        </p>
      </div>

      <div className="flex gap-4">
        {/* -- palette -------------------------------------------------- */}
        <div className="flex w-52 shrink-0 flex-col gap-4">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Beats</h3>
            <div className="flex flex-col gap-1">
              {beats.length === 0 && (
                <p className="text-xs text-muted">No beats yet — create Beat 1 in the Beats tab.</p>
              )}
              {beats.map((beat) => {
                const isArmed = armed?.kind === "BEAT" && armed.beatId === beat.id;
                return (
                  <button
                    key={beat.id}
                    className={
                      paletteItem +
                      (isArmed
                        ? " border-accent bg-accent/10 text-text"
                        : " border-edge bg-bg-soft text-muted hover:border-edge-strong")
                    }
                    title={
                      beat.tracks.length === 0
                        ? "Empty beat — add lanes in the Beats tab"
                        : beat.tracks.map((t) => t.name).join(" + ")
                    }
                    onClick={() => setArmed(isArmed ? null : { kind: "BEAT", beatId: beat.id })}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: beatColor(beat.position) }}
                    />
                    <span className="truncate font-semibold">{beat.name}</span>
                    {/* one dot per lane, instrument-colored — the beat's
                        "ingredients" at a glance */}
                    <span className="ml-auto inline-flex shrink-0 gap-0.5">
                      {beat.tracks.slice(0, 6).map((lane) => (
                        <i
                          key={lane.id}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: colorFor(lane.instrument) }}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Audio</h3>
              <Button variant="ghost" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                {uploading ? "Uploading…" : "+ Upload"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => void onUpload(e)}
              />
            </div>
            <div className="flex flex-col gap-1">
              {audioFiles.length === 0 && (
                <p className="text-xs text-muted">Upload a wav/mp3 to place it on the timeline.</p>
              )}
              {audioFiles.map((file) => {
                const isArmed = armed?.kind === "AUDIO" && armed.audioId === file.id;
                return (
                  <div
                    key={file.id}
                    className={
                      paletteItem +
                      (isArmed
                        ? " border-accent-2 bg-accent-2/10 text-text"
                        : " border-edge bg-bg-soft text-muted hover:border-edge-strong")
                    }
                    onClick={() => setArmed(isArmed ? null : { kind: "AUDIO", audioId: file.id })}
                  >
                    <span aria-hidden>🎧</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{file.filename}</span>
                      <span className="block">{file.durationSeconds.toFixed(1)}s</span>
                    </span>
                    <button
                      className="rounded px-1 text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                      title="Download"
                      onClick={(e) => {
                        e.stopPropagation();
                        void downloadAudio(file);
                      }}
                    >
                      ⬇
                    </button>
                    <button
                      className="rounded px-1 text-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                      title="Delete (removes its clips)"
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteAudio(file);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* -- timeline -------------------------------------------------- */}
        <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-edge">
          {/* ruler */}
          <div className="tl-ruler" style={{ width: bars * BAR_W }}>
            {Array.from({ length: bars }, (_, bar) => (
              <span key={bar} className="tl-ruler-bar" style={{ width: BAR_W }}>
                {bar + 1}
              </span>
            ))}
          </div>

          <div
            ref={lanesRef}
            className={"tl-lanes" + (armed ? " arming" : "")}
            style={{
              width: bars * BAR_W,
              height: LANES * LANE_H,
              backgroundSize: `${BAR_W}px ${LANE_H}px`,
            }}
            onMouseDown={(e) => void placeArmed(e)}
          >
            {clips.length === 0 && !armed && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <EmptyState
                  icon="🎬"
                  title="Empty timeline"
                  hint="Arm a beat on the left, then click a lane — same beat, as many placements as you like."
                />
              </div>
            )}
            {clips.map((clip) => {
              const beat = clip.beatId ? beatById.get(clip.beatId) : undefined;
              const audio = clip.audioId ? audioById.get(clip.audioId) : undefined;
              const label =
                clip.type === "BEAT"
                  ? beat?.name ?? "(deleted beat)"
                  : audio?.filename ?? "(deleted audio)";
              const barsLong = clip.lengthSteps / STEPS_PER_BAR;
              return (
                <div
                  key={clip.id}
                  className={"tl-clip" + (clip.type === "AUDIO" ? " audio" : "")}
                  style={{
                    left: clip.startStep * STEP_W,
                    top: clip.lane * LANE_H + 3,
                    width: clip.lengthSteps * STEP_W - 2,
                    height: LANE_H - 6,
                    "--tc": beat ? beatColor(beat.position) : undefined,
                  } as React.CSSProperties}
                  title={label}
                  onMouseDown={(e) => onClipMouseDown(e, clip, false)}
                  onContextMenu={(e) => void onClipContextMenu(e, clip)}
                  onDoubleClick={() => clip.beatId && onOpenBeat(clip.beatId)}
                >
                  <span className="truncate px-2 text-[0.68rem] font-bold">
                    {label}
                    {clip.type === "BEAT" && barsLong > 1 ? ` ×${barsLong}` : ""}
                  </span>
                  <span
                    className="tl-clip-handle"
                    onMouseDown={(e) => onClipMouseDown(e, clip, true)}
                  />
                </div>
              );
            })}
            {playheadStep >= 0 && (
              <div className="tl-playhead" style={{ left: playheadStep * STEP_W }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
