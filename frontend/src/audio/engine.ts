import * as Tone from "tone";
import { fetchBinary, upload } from "../api/client";
import { createInstrument, type TrackInstrument } from "./instruments";
import type { AudioFile, Beat, Clip, Step } from "../types";

/**
 * The arrangement engine. One scheduling function drives BOTH live
 * playback and offline export — that's the invariant that makes "the
 * exported WAV sounds exactly like the play button" true by construction
 * instead of by testing.
 */

export const STEPS_PER_BAR = 16;

/** Seconds per 16th-note step at a given tempo (bpm counts quarters). */
export function secondsPerStep(bpm: number): number {
  return 60 / bpm / 4;
}

/** Everything scheduling needs to know, already denormalized by the page:
 *  `patterns` carries the LIVE (possibly unsaved) notes per LANE id, so
 *  what you hear always matches what the editor shows. A BEAT clip plays
 *  every lane of its beat — that's the big-beat model. */
export interface ArrangementSources {
  bpm: number;
  clips: Clip[];
  beats: Beat[];
  patterns: Record<string, Step[]>;
}

/** Timeline end = right edge of the last clip. Zero for an empty
 *  arrangement — callers use that as "nothing to play". */
export function arrangementEndSeconds(sources: ArrangementSources): number {
  const perStep = secondsPerStep(sources.bpm);
  return sources.clips.reduce(
    (end, clip) => Math.max(end, (clip.startStep + clip.lengthSteps) * perStep),
    0,
  );
}

/* ---- audio buffer cache -------------------------------------------------

   Decoded uploads, keyed by audio file id. AudioBuffers are context-free
   PCM — the SAME buffer feeds live players and offline-render players, so
   each file is downloaded and decoded exactly once per session. */

const bufferCache = new Map<string, AudioBuffer>();

export async function getAudioBuffer(audioId: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(audioId);
  if (cached) return cached;
  const bytes = await fetchBinary(`/api/audio/${audioId}`);
  const decoded = await Tone.getContext().rawContext.decodeAudioData(bytes);
  bufferCache.set(audioId, decoded);
  return decoded;
}

export function evictAudioBuffer(audioId: string): void {
  bufferCache.delete(audioId);
}

/** Upload one file. The browser decodes it first — both to REJECT
 *  non-audio before wasting the upload, and to measure the duration the
 *  server stores (the server never decodes audio). The decoded buffer is
 *  cached under the new id, so placing the clip right after upload plays
 *  with zero additional network. */
export async function uploadAudioFile(songId: string, file: File): Promise<AudioFile> {
  const bytes = await file.arrayBuffer();
  let decoded: AudioBuffer;
  try {
    // decodeAudioData DETACHES the buffer it's given; hand it a copy so
    // `bytes` stays usable for the actual upload below.
    decoded = await Tone.getContext().rawContext.decodeAudioData(bytes.slice(0));
  } catch {
    throw new Error(`"${file.name}" is not a playable audio file`);
  }
  const form = new FormData();
  form.append("file", file);
  form.append("durationSeconds", String(decoded.duration));
  const dto = await upload<AudioFile>(`/api/songs/${songId}/audio`, form);
  bufferCache.set(dto.id, decoded);
  return dto;
}

/* ---- scheduling ---------------------------------------------------------- */

interface ScheduleOptions {
  sources: ArrangementSources;
  /** Live instruments keyed by LANE id (page-owned) or fresh offline
   *  ones — caller's call. */
  instruments: Map<string, TrackInstrument>;
  /** Pre-fetched decoded audio, keyed by audio file id. Clips whose
   *  buffer is missing are skipped (failed download ≠ broken playback). */
  buffers: Map<string, AudioBuffer>;
  /** Mute/solo hook (per lane id), evaluated AT TRIGGER TIME so toggling
   *  during playback takes effect on the next note. Omitted = everything
   *  sounds. */
  audible?: (trackId: string) => boolean;
}

/**
 * Schedules every event of the arrangement onto the CURRENT context's
 * transport (live page transport, or the offline one inside Tone.Offline).
 * Returns the players it created so the caller can dispose them on stop.
 */
export function scheduleArrangement(options: ScheduleOptions): Tone.Player[] {
  const { sources, instruments, buffers, audible } = options;
  const transport = Tone.getTransport();
  const perStep = secondsPerStep(sources.bpm);
  const players: Tone.Player[] = [];
  const beatById = new Map(sources.beats.map((b) => [b.id, b]));

  for (const clip of sources.clips) {
    if (clip.type === "BEAT" && clip.beatId) {
      const beat = beatById.get(clip.beatId);
      if (!beat) continue;

      // EVERY lane of the beat plays — one clip, the whole groove. Each
      // lane's 16-step pattern LOOPS bar by bar across the clip; notes
      // (and note tails) are truncated at the clip's right edge —
      // video-editor semantics: the clip's box is the sound's box.
      for (const lane of beat.tracks) {
        const instrument = instruments.get(lane.id);
        const pattern = sources.patterns[lane.id] ?? [];
        if (!instrument || pattern.length === 0) continue;

        for (let offset = 0; offset < clip.lengthSteps; offset += STEPS_PER_BAR) {
          for (const note of pattern) {
            const localStep = offset + note.step;
            if (localStep >= clip.lengthSteps) continue;
            const stepsLeft = clip.lengthSteps - localStep;
            const duration = Math.min(note.length, stepsLeft) * perStep;
            const at = (clip.startStep + localStep) * perStep;
            const laneId = lane.id;
            transport.schedule((time) => {
              if (audible && !audible(laneId)) return;
              // Per-note isolation, same reasoning as the beat-loop
              // player: monophonic synths throw on same-tick collisions.
              try {
                instrument.trigger(time, note.pitch, note.velocity, duration);
              } catch {
                /* skip colliding note */
              }
            }, at);
          }
        }
      }
    } else if (clip.type === "AUDIO" && clip.audioId) {
      const buffer = buffers.get(clip.audioId);
      if (!buffer) continue;
      const player = new Tone.Player(buffer).toDestination();
      // sync() ties the player to the transport: stop/seek the transport
      // and the player follows — no orphaned audio after Stop.
      const start = clip.startStep * perStep;
      const duration = Math.min(buffer.duration, clip.lengthSteps * perStep);
      player.sync().start(start, 0, duration);
      players.push(player);
    }
  }
  return players;
}

/** Fetch every buffer the arrangement needs (cache-aware, parallel).
 *  Failures are swallowed per-file: one broken download mutes that clip
 *  instead of killing playback/export. */
export async function prefetchBuffers(clips: Clip[]): Promise<Map<string, AudioBuffer>> {
  const ids = [...new Set(clips.filter((c) => c.type === "AUDIO" && c.audioId).map((c) => c.audioId!))];
  await Promise.all(
    ids.map((id) => getAudioBuffer(id).catch(() => undefined)),
  );
  const map = new Map<string, AudioBuffer>();
  for (const id of ids) {
    const buffer = bufferCache.get(id);
    if (buffer) map.set(id, buffer);
  }
  return map;
}

/* ---- offline export ------------------------------------------------------ */

/**
 * Renders the arrangement faster than real time in an OfflineAudioContext
 * and returns a 16-bit PCM WAV. Fresh instruments are built INSIDE the
 * Tone.Offline callback — Tone swaps the ambient context for the render's
 * duration, so everything created here wires to the offline graph, not
 * the speakers.
 */
export async function renderArrangementToWav(
  sources: ArrangementSources,
  buffers: Map<string, AudioBuffer>,
): Promise<Blob> {
  // +1.5s tail so releases/decays aren't clipped at the last step.
  const seconds = arrangementEndSeconds(sources) + 1.5;
  const rendered = await Tone.Offline(async () => {
    const instruments = new Map<string, TrackInstrument>();
    for (const beat of sources.beats) {
      for (const lane of beat.tracks) {
        instruments.set(lane.id, createInstrument(lane.instrument));
      }
    }
    scheduleArrangement({ sources, instruments, buffers });
    Tone.getTransport().start(0);
  }, seconds, 2, 44100);
  return encodeWav(rendered.get() as AudioBuffer);
}

/** AudioBuffer → interleaved 16-bit PCM WAV (RIFF) blob. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const out = new DataView(new ArrayBuffer(44 + dataSize));

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  out.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  out.setUint32(16, 16, true); // fmt chunk size
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, channels, true);
  out.setUint32(24, sampleRate, true);
  out.setUint32(28, sampleRate * channels * bytesPerSample, true); // byte rate
  out.setUint16(32, channels * bytesPerSample, true); // block align
  out.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  out.setUint32(40, dataSize, true);

  const channelData = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let c = 0; c < channels; c++) {
      // Clamp before quantizing: synth peaks above 1.0 must saturate, not
      // wrap around into full-scale clicks.
      const sample = Math.max(-1, Math.min(1, channelData[c][frame]));
      out.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}

/** Standard blob download: temp anchor + revoked object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
