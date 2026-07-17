/**
 * Every GraphQL document the beat maker sends.
 *
 * Gathered here so the shape of what this page asks the server for is readable
 * in one screen — buried among 2000 lines of editor code, SONG_QUERY in
 * particular was the single most useful thing in the file and the hardest to
 * find.
 */

export const SONG_QUERY = `
  query Song($id: ID!) {
    song(id: $id) {
      id title bpm timeSignature ownerId myRole listenToken
      collaborators { userId email displayName role }
      beats {
        id name position bars
        tracks { id name instrument position volume pan version pattern { step pitch velocity length } }
      }
      clips { id lane startStep lengthSteps type beatId audioId }
      audioFiles { id filename contentType sizeBytes durationSeconds }
    }
  }
`;

export const ADD_BEAT = `
  mutation AddBeat($input: AddBeatInput!) {
    addBeat(input: $input) { id }
  }
`;

export const DELETE_BEAT = `
  mutation DeleteBeat($id: ID!) { deleteBeat(id: $id) }
`;

export const ADD_TRACK = `
  mutation AddTrack($input: AddTrackInput!) {
    addTrack(input: $input) { id }
  }
`;

export const DELETE_TRACK = `
  mutation DeleteTrack($id: ID!) { deleteTrack(id: $id) }
`;

export const SONG_HISTORY = `
  query SongHistory($songId: ID!) {
    songHistory(songId: $songId) {
      id trackId trackName actorName type summary createdAt
    }
  }
`;

export const TRACK_PATTERN_AT = `
  query TrackPatternAt($trackId: ID!, $eventId: ID!) {
    trackPatternAt(trackId: $trackId, eventId: $eventId) { step pitch velocity length }
  }
`;

export const GENERATE_PATTERN = `
  mutation GeneratePattern($trackId: ID!, $prompt: String!) {
    generateTrackPattern(trackId: $trackId, prompt: $prompt) { step pitch velocity length }
  }
`;

// A union, so the selection is inline fragments — and __typename is NOT
// decoration here: it is the only thing that tells ClearLane ({lane}) apart
// from SetLanePattern ({lane, notes}) once this is JSON. Dropping it would
// make "empty the lane" and "fill the lane" indistinguishable.
export const COMPOSE_BEAT = `
  mutation ComposeBeat($beatId: ID!, $prompt: String!) {
    composeBeat(beatId: $beatId, prompt: $prompt) {
      __typename
      ... on SetBpm { bpm }
      ... on AddLane { lane instrument }
      ... on SetLanePattern { lane notes { step pitch velocity length } }
      ... on ClearLane { lane }
    }
  }
`;

export const SAVE_PATTERN = `
  mutation SavePattern($id: ID!, $pattern: [StepInput!]!, $expectedVersion: Int) {
    updateTrackPattern(id: $id, pattern: $pattern, expectedVersion: $expectedVersion) { id version }
  }
`;
