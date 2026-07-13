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
      id title bpm timeSignature ownerId myRole
      collaborators { userId email displayName role }
      beats {
        id name position bars
        tracks { id name instrument position version pattern { step pitch velocity length } }
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

export const SAVE_PATTERN = `
  mutation SavePattern($id: ID!, $pattern: [StepInput!]!, $expectedVersion: Int) {
    updateTrackPattern(id: $id, pattern: $pattern, expectedVersion: $expectedVersion) { id version }
  }
`;
