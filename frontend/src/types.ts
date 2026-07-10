// App-facing view types, DERIVED from src/generated/schema.ts (which
// `npm run codegen` regenerates from the backend's schema.graphqls).
// Each type Picks exactly the fields our queries fetch — per-view field
// selection is GraphQL's point, so response shapes are narrower than the
// schema — but because the field names/types come from the generated
// file, a server-side rename or retype breaks THIS file at compile time
// instead of lying at runtime. (That drift bit us once: Song.tracks.)
import type * as gql from "./generated/schema";

export type Role = "USER" | "ADMIN";

/** Auth is REST (/api/auth/*), not GraphQL — hand-written on purpose. */
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

export type Step = Pick<gql.Step, "step" | "pitch" | "velocity" | "length">;

/** One instrument LANE inside a beat (kick lane, bass lane, ...). */
export interface Track
  extends Pick<gql.Track, "id" | "name" | "instrument" | "position" | "version"> {
  pattern: Step[];
}

/** A named multi-instrument pattern group — "Beat 1", "Beat 2" — the
 *  FL-Studio pattern model. The unit the arrangement places on the
 *  timeline: one beat clip plays ALL of the beat's lanes together. */
export interface Beat extends Pick<gql.Beat, "id" | "name" | "position" | "bars"> {
  tracks: Track[];
}

export type ClipType = gql.ClipType;

/** One placement on the arrangement timeline. Time in 16th-note steps
 *  (16 = one 4/4 bar) — the arrangement survives BPM changes. */
export type Clip = Pick<
  gql.Clip,
  "id" | "lane" | "startStep" | "lengthSteps" | "type" | "beatId" | "audioId"
>;

/** Upload metadata; the bytes live at GET /api/audio/{id}. */
export type AudioFile = Pick<
  gql.AudioFile,
  "id" | "filename" | "contentType" | "sizeBytes" | "durationSeconds"
>;

export interface Song
  extends Pick<
    gql.Song,
    "id" | "title" | "bpm" | "timeSignature" | "ownerId" | "version" | "createdAt"
  > {
  beats: Beat[];
  clips: Clip[];
  audioFiles: AudioFile[];
}
