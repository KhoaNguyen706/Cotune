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

export type ChatMessage = {
  authorId?: Maybe<Scalars['ID']['output']>;
  authorName: Scalars['String']['output'];
  body: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  songId: Scalars['ID']['output'];
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

export type Collaborator = {
  createdAt: Scalars['DateTime']['output'];
  displayName: Scalars['String']['output'];
  email: Scalars['String']['output'];
  role: CollaboratorRole;
  userId: Scalars['ID']['output'];
};

export type CollaboratorRole =
  | 'EDITOR'
  | 'VIEWER';

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

export type ListenAudio = {
  contentType: Scalars['String']['output'];
  durationSeconds: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
};

export type ListenBeat = {
  bars: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  position: Scalars['Int']['output'];
  tracks: Array<ListenTrack>;
};

export type ListenClip = {
  audioId?: Maybe<Scalars['ID']['output']>;
  beatId?: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  lane: Scalars['Int']['output'];
  lengthSteps: Scalars['Int']['output'];
  startStep: Scalars['Int']['output'];
  type: ClipType;
};

export type ListenSong = {
  audioFiles: Array<ListenAudio>;
  beats: Array<ListenBeat>;
  bpm: Scalars['Int']['output'];
  clips: Array<ListenClip>;
  timeSignature: Scalars['String']['output'];
  title: Scalars['String']['output'];
};

export type ListenTrack = {
  id: Scalars['ID']['output'];
  instrument: Instrument;
  name: Scalars['String']['output'];
  pan: Scalars['Float']['output'];
  pattern: Array<Step>;
  position: Scalars['Int']['output'];
  volume: Scalars['Float']['output'];
};

export type Mutation = {
  addBeat: Beat;
  addClip: Clip;
  addTrack: Track;
  createSong: Song;
  deleteBeat: Scalars['Boolean']['output'];
  deleteClip: Scalars['Boolean']['output'];
  deleteSong: Scalars['Boolean']['output'];
  deleteTrack: Scalars['Boolean']['output'];
  disableListenLink: Scalars['Boolean']['output'];
  enableListenLink: Scalars['String']['output'];
  generateTrackPattern: Array<Step>;
  grantAiAccess: Scalars['Boolean']['output'];
  revokeAiAccess: Scalars['Boolean']['output'];
  shareSong: Collaborator;
  unshareSong: Scalars['Boolean']['output'];
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


export type MutationDisableListenLinkArgs = {
  songId: Scalars['ID']['input'];
};


export type MutationEnableListenLinkArgs = {
  songId: Scalars['ID']['input'];
};


export type MutationGenerateTrackPatternArgs = {
  prompt: Scalars['String']['input'];
  trackId: Scalars['ID']['input'];
};


export type MutationGrantAiAccessArgs = {
  email: Scalars['String']['input'];
};


export type MutationRevokeAiAccessArgs = {
  email: Scalars['String']['input'];
};


export type MutationShareSongArgs = {
  input: ShareSongInput;
};


export type MutationUnshareSongArgs = {
  songId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
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
  chatMessages: Array<ChatMessage>;
  listen?: Maybe<ListenSong>;
  song?: Maybe<Song>;
  songs: Array<Song>;
};


export type QueryChatMessagesArgs = {
  songId: Scalars['ID']['input'];
};


export type QueryListenArgs = {
  token: Scalars['String']['input'];
};


export type QuerySongArgs = {
  id: Scalars['ID']['input'];
};

export type ShareSongInput = {
  email: Scalars['String']['input'];
  role: CollaboratorRole;
  songId: Scalars['ID']['input'];
};

export type Song = {
  audioFiles: Array<AudioFile>;
  beats: Array<Beat>;
  bpm: Scalars['Int']['output'];
  clips: Array<Clip>;
  collaborators: Array<Collaborator>;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  listenToken?: Maybe<Scalars['String']['output']>;
  myRole: SongRole;
  ownerId?: Maybe<Scalars['ID']['output']>;
  timeSignature: Scalars['String']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  version: Scalars['Int']['output'];
};

export type SongRole =
  | 'EDITOR'
  | 'OWNER'
  | 'VIEWER';

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
  pan: Scalars['Float']['output'];
  pattern: Array<Step>;
  position: Scalars['Int']['output'];
  updatedAt: Scalars['DateTime']['output'];
  version: Scalars['Int']['output'];
  volume: Scalars['Float']['output'];
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
