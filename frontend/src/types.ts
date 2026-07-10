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

export interface Track {
  id: string;
  name: string;
  instrument: string;
  position: number;
  pattern: Step[];
}

export interface Song {
  id: string;
  title: string;
  bpm: number;
  timeSignature: string;
  ownerId: string | null; // null = created before ownership existed
  version: number;
  createdAt: string;
  tracks: Track[];
}
