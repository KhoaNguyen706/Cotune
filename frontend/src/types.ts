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

/** What can be GRANTED to someone else. Not OWNER — see SongRole. */
export type CollaboratorRole = gql.CollaboratorRole;

/**
 * What YOU may do with a song. Sent by the server on every Song.
 *
 * Do not reconstruct this from `ownerId === user.id`. Session 14 shipped
 * exactly that, the client's copy of the rule drifted from the server's, and
 * the UI offered rename/save buttons that were guaranteed to 403. Since
 * sharing exists the rule isn't even derivable from ownerId any more: an
 * EDITOR doesn't own the song and can still write to it.
 */
export type SongRole = gql.SongRole;

/** One invited person on a song. The owner is NOT in this list. */
export type Collaborator = Pick<
  gql.Collaborator,
  "userId" | "email" | "displayName" | "role"
>;

export interface Song
  extends Pick<
    gql.Song,
    "id" | "title" | "bpm" | "timeSignature" | "ownerId" | "myRole" | "version" | "createdAt"
  > {
  beats: Beat[];
  clips: Clip[];
  audioFiles: AudioFile[];
  collaborators: Collaborator[];
}

/** The single place the client interprets a role — and it decides nothing:
 *  it reads the answer the server already computed. */
export const canEditSong = (song: Pick<Song, "myRole">): boolean =>
  song.myRole === "OWNER" || song.myRole === "EDITOR";
