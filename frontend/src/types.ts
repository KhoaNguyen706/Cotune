// Hand-written mirrors of the backend DTOs / GraphQL types. Good enough at
// this size; the moment these drift from the server they become lies, which
// is why real teams GENERATE them (graphql-codegen reads schema.graphqls,
// openapi-generator reads the REST spec) — one source of truth, no drift.

export type Role = "USER" | "ADMIN";

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
}

export interface AuthPayload {
  token: string;
  expiresAt: string;
  user: User;
}

export interface Step {
  step: number;
  pitch: string;
  velocity: number;
  length: number;
}

/** One instrument LANE inside a beat (kick lane, bass lane, ...). */
export interface Track {
  id: string;
  name: string;
  instrument: string;
  position: number;
  /** Optimistic-concurrency counter — send back as expectedVersion. */
  version: number;
  pattern: Step[];
}

/** A named multi-instrument pattern group — "Beat 1", "Beat 2" — the
 *  FL-Studio pattern model. The unit the arrangement places on the
 *  timeline: one beat clip plays ALL of the beat's lanes together. */
export interface Beat {
  id: string;
  name: string;
  position: number;
  tracks: Track[];
}

export type ClipType = "BEAT" | "AUDIO";

/** One placement on the arrangement timeline. Time in 16th-note steps
 *  (16 = one 4/4 bar) — the arrangement survives BPM changes. */
export interface Clip {
  id: string;
  lane: number;
  startStep: number;
  lengthSteps: number;
  type: ClipType;
  beatId: string | null;  // set when type === "BEAT" — the WHOLE beat plays
  audioId: string | null; // set when type === "AUDIO"
}

/** Upload metadata; the bytes live at GET /api/audio/{id}. */
export interface AudioFile {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds: number;
}

export interface Song {
  id: string;
  title: string;
  bpm: number;
  timeSignature: string;
  ownerId: string | null; // null = created before ownership existed
  version: number;
  createdAt: string;
  beats: Beat[];
  clips: Clip[];
  audioFiles: AudioFile[];
}
