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
  /** Admin-granted invitation to the AI features (admins always true).
   *  Affordance only — the server enforces on every @ai regardless. */
  aiAccess: boolean;
  createdAt: string;
}

export interface AuthPayload {
  token: string;
  expiresAt: string;
  user: User;
}

export type Step = Pick<gql.Step, "step" | "pitch" | "velocity" | "length">;

/**
 * One edit the AI proposes (composeBeat) — the client half of the server's
 * `union AiAction`.
 *
 * WHY THIS ISN'T JUST `gql.AiAction`: codegen runs with `skipTypename`, so
 * the generated union is `AddLane | ClearLane | SetBpm | SetLanePattern`
 * with nothing to tell them apart. TypeScript would then narrow
 * STRUCTURALLY — and `ClearLane` ({lane}) is a structural subset of
 * `SetLanePattern` ({lane, notes}), so "does it have a lane?" cannot
 * distinguish "empty this lane" from "fill it". Getting that backwards
 * silently erases a lane the AI meant to write.
 *
 * `__typename` is what a GraphQL union is discriminated by, and the query
 * asks for it, so it is added back HERE rather than by flipping skipTypename
 * for every type in the schema. The FIELDS still come from the generated
 * file, so a server-side rename still breaks this file at compile time —
 * which is the whole point of this module.
 *
 * The `__typename` strings must match the schema's type names; the server
 * pins the same agreement from its side (BeatCompositionIntegrationTest).
 */
export type AiAction =
  | ({ __typename: "SetBpm" } & Pick<gql.SetBpm, "bpm">)
  | ({ __typename: "AddLane" } & Pick<gql.AddLane, "lane" | "instrument">)
  | ({ __typename: "SetLanePattern" } & Pick<gql.SetLanePattern, "lane"> & { notes: Step[] })
  | ({ __typename: "ClearLane" } & Pick<gql.ClearLane, "lane">);

/** One instrument LANE inside a beat (kick lane, bass lane, ...). */
export interface Track
  extends Pick<
    gql.Track,
    "id" | "name" | "instrument" | "position" | "volume" | "pan" | "version"
  > {
  pattern: Step[];
}

/** A named multi-instrument pattern group — "Beat 1", "Beat 2" — the
 *  FL-Studio pattern model. The unit the arrangement places on the
 *  timeline: one beat clip plays ALL of the beat's lanes together. */
export interface Beat extends Pick<gql.Beat, "id" | "name" | "position" | "bars"> {
  tracks: Track[];
}

/** One line of the song's edit log (V15). trackName null = the lane was
 *  deleted (not restorable); actorName null = the pre-history baseline. */
export type SongEvent = Pick<
  gql.SongEvent,
  "id" | "trackId" | "trackName" | "actorName" | "type" | "summary" | "createdAt"
>;

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
    | "id" | "title" | "bpm" | "timeSignature" | "ownerId" | "myRole" | "version" | "createdAt"
    // Owner-only by VALUE (the server sends null to everyone else); null
    // for the owner means "no public link yet".
    | "listenToken"
  > {
  beats: Beat[];
  clips: Clip[];
  audioFiles: AudioFile[];
  collaborators: Collaborator[];
}

/* ---- public listen page -------------------------------------------------
   The shapes behind /listen/:token — a separate, smaller type family on
   purpose, mirroring the server's Listen* GraphQL types: what a stranger
   holding the link sees is decided there, and these types just can't hold
   more than that. Structurally they satisfy the audio engine's Playable*
   interfaces, so the same scheduler plays both the editor and this page. */

export interface ListenTrack
  extends Pick<gql.ListenTrack, "id" | "name" | "instrument" | "position" | "volume" | "pan"> {
  pattern: Step[];
}

export interface ListenBeat extends Pick<gql.ListenBeat, "id" | "name" | "position" | "bars"> {
  tracks: ListenTrack[];
}

export type ListenClip = Pick<
  gql.ListenClip,
  "id" | "lane" | "startStep" | "lengthSteps" | "type" | "beatId" | "audioId"
>;

export type ListenAudio = Pick<gql.ListenAudio, "id" | "contentType" | "durationSeconds">;

export interface ListenSong extends Pick<gql.ListenSong, "title" | "bpm" | "timeSignature"> {
  beats: ListenBeat[];
  clips: ListenClip[];
  audioFiles: ListenAudio[];
}

/** The single place the client interprets a role — and it decides nothing:
 *  it reads the answer the server already computed. */
export const canEditSong = (song: Pick<Song, "myRole">): boolean =>
  song.myRole === "OWNER" || song.myRole === "EDITOR";
