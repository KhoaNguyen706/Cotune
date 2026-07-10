export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  DateTime: { input: string; output: string; }
};

export type AddBeatInput = {
  name: Scalars['String']['input'];
  songId: Scalars['ID']['input'];
};

export type AddClipInput = {
  audioId?: InputMaybe<Scalars['ID']['input']>;
  beatId?: InputMaybe<Scalars['ID']['input']>;
  lane: Scalars['Int']['input'];
  lengthSteps: Scalars['Int']['input'];
  songId: Scalars['ID']['input'];
  startStep: Scalars['Int']['input'];
};

export type AddTrackInput = {
  beatId: Scalars['ID']['input'];
  instrument: Instrument;
  name: Scalars['String']['input'];
};

export type AudioFile = {
  contentType: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  durationSeconds: Scalars['Float']['output'];
  filename: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  sizeBytes: Scalars['Int']['output'];
  songId: Scalars['ID']['output'];
};

export type Beat = {
  bars: Scalars['Int']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  position: Scalars['Int']['output'];
  songId: Scalars['ID']['output'];
  tracks: Array<Track>;
  updatedAt: Scalars['DateTime']['output'];
  version: Scalars['Int']['output'];
};

export type Clip = {
  audioId?: Maybe<Scalars['ID']['output']>;
  beatId?: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  lane: Scalars['Int']['output'];
  lengthSteps: Scalars['Int']['output'];
  songId: Scalars['ID']['output'];
  startStep: Scalars['Int']['output'];
  type: ClipType;
  updatedAt: Scalars['DateTime']['output'];
  version: Scalars['Int']['output'];
};

export type ClipType =
  | 'AUDIO'
  | 'BEAT';

export type CreateSongInput = {
  bpm: Scalars['Int']['input'];
  timeSignature: Scalars['String']['input'];
  title: Scalars['String']['input'];
};

export type Instrument =
  | 'BASS'
  | 'DRUMS'
  | 'GUITAR'
  | 'PIANO'
  | 'STRINGS'
  | 'SYNTH';

export type Mutation = {
  addBeat: Beat;
  addClip: Clip;
  addTrack: Track;
  createSong: Song;
  deleteBeat: Scalars['Boolean']['output'];
  deleteClip: Scalars['Boolean']['output'];
  deleteSong: Scalars['Boolean']['output'];
  deleteTrack: Scalars['Boolean']['output'];
  updateClip: Clip;
  updateSong: Song;
  updateTrack: Track;
  updateTrackPattern: Track;
};


export type MutationAddBeatArgs = {
  input: AddBeatInput;
};


export type MutationAddClipArgs = {
  input: AddClipInput;
};


export type MutationAddTrackArgs = {
  input: AddTrackInput;
};


export type MutationCreateSongArgs = {
  input: CreateSongInput;
};


export type MutationDeleteBeatArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteClipArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteSongArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteTrackArgs = {
  id: Scalars['ID']['input'];
};


export type MutationUpdateClipArgs = {
  id: Scalars['ID']['input'];
  input: UpdateClipInput;
};


export type MutationUpdateSongArgs = {
  id: Scalars['ID']['input'];
  input: UpdateSongInput;
};


export type MutationUpdateTrackArgs = {
  id: Scalars['ID']['input'];
  input: UpdateTrackInput;
};


export type MutationUpdateTrackPatternArgs = {
  expectedVersion?: InputMaybe<Scalars['Int']['input']>;
  id: Scalars['ID']['input'];
  pattern: Array<StepInput>;
};

export type Query = {
  song?: Maybe<Song>;
  songs: Array<Song>;
};


export type QuerySongArgs = {
  id: Scalars['ID']['input'];
};

export type Song = {
  audioFiles: Array<AudioFile>;
  beats: Array<Beat>;
  bpm: Scalars['Int']['output'];
  clips: Array<Clip>;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  ownerId?: Maybe<Scalars['ID']['output']>;
  timeSignature: Scalars['String']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  version: Scalars['Int']['output'];
};

export type Step = {
  length: Scalars['Int']['output'];
  pitch: Scalars['String']['output'];
  step: Scalars['Int']['output'];
  velocity: Scalars['Float']['output'];
};

export type StepInput = {
  length?: Scalars['Int']['input'];
  pitch: Scalars['String']['input'];
  step: Scalars['Int']['input'];
  velocity: Scalars['Float']['input'];
};

export type Track = {
  beatId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  instrument: Instrument;
  name: Scalars['String']['output'];
  pattern: Array<Step>;
  position: Scalars['Int']['output'];
  updatedAt: Scalars['DateTime']['output'];
  version: Scalars['Int']['output'];
};

export type UpdateClipInput = {
  expectedVersion?: InputMaybe<Scalars['Int']['input']>;
  lane: Scalars['Int']['input'];
  lengthSteps: Scalars['Int']['input'];
  startStep: Scalars['Int']['input'];
};

export type UpdateSongInput = {
  bpm: Scalars['Int']['input'];
  timeSignature: Scalars['String']['input'];
  title: Scalars['String']['input'];
};

export type UpdateTrackInput = {
  instrument: Instrument;
  name: Scalars['String']['input'];
};
