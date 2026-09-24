import type { AiAction, Instrument, Step } from "../types";

/**
 * A pack of ready-made beats — COMPOSITION, not sound design.
 *
 * WHY THIS EXISTS. Almost nobody writes a song by drawing every note from
 * an empty grid. They start from small finished pieces — a groove, a
 * cascade, a fill — and arrange them into three minutes. The arrangement is
 * where a song actually lives; this pack is the box of parts to arrange.
 * One click turns a preset into an ordinary Beat, and from there it is a
 * clip you drop on the timeline as many times as the song needs.
 *
 * WHY IT ADDS NO INSTRUMENTS. There is no đàn tranh voice here and there
 * doesn't need to be: what makes these read as Vietnamese is the NOTES, not
 * the timbre. Traditional Vietnamese music is pentatonic (ngũ cung) — five
 * notes, no semitone steps — and that mode survives being played on a
 * plucked string or an electric piano. So every preset is written for the
 * six instruments the app already synthesizes (audio/instrumentList.ts).
 * Sampling real instruments is a different project, and it is the one that
 * needs a storage bucket.
 *
 * ONE KEY FOR THE WHOLE PACK, on purpose: A C D E G, which is A minor
 * pentatonic and C major pentatonic at the same time — the same five notes,
 * heard as dark or bright depending on which one the music leans on. Every
 * preset drawn from that single pool means ANY two of them stack without
 * clashing, which is the difference between a pack you arrange and a pack
 * you audition. `presets.test.ts` enforces it rather than trusting it.
 *
 * `bpm` here is a SUGGESTION shown in the UI, never applied. Inserting a
 * preset must not retempo a song that already has five other beats in it.
 */

/** The pack's five notes, letter names only. Enforced by the tests. */
export const PENTATONIC = ["A", "C", "D", "E", "G"] as const;

export interface PresetLane {
  name: string;
  instrument: Instrument;
  notes: Step[];
}

export interface BeatPreset {
  id: string;
  /** The Vietnamese name — this becomes the beat's name in the browser. */
  name: string;
  /** Plain-English gloss, for everyone who doesn't read the first one. */
  english: string;
  /** Where it belongs in a song, so the pack reads as parts of one thing. */
  role: "Intro" | "Groove" | "Melody" | "Fill";
  /** 1..8, mirrors Beat.MAX_BARS. The beat is resized to this on insert —
   *  before its notes are written, or every note past step 15 is rejected. */
  bars: number;
  /** Suggested tempo. Displayed only; inserting never changes the song. */
  bpm: number;
  /** One line on what the part is musically. */
  note: string;
  lanes: PresetLane[];
}

/* ---- authoring helpers ---------------------------------------------------
   The note data below is read far more often than it is written, so these
   exist to keep a groove looking like a groove instead of forty object
   literals. Velocity defaults are per-helper because they encode a mixing
   decision: percussion sits forward, pads sit back. */

/** Repeated one-step hits of a single pitch — how percussion is written. */
const hits = (pitch: string, steps: number[], velocity = 0.85): Step[] =>
  steps.map((step) => ({ step, pitch, velocity, length: 1 }));

/** A melodic line: [step, pitch, length, velocity?] per note. */
const line = (notes: [number, string, number, number?][]): Step[] =>
  notes.map(([step, pitch, length, velocity = 0.8]) => ({ step, pitch, velocity, length }));

/** Simultaneous pitches — one Step each, same start. Quiet by default: a
 *  pad that competes with the melody is a pad in the wrong place. */
const chord = (step: number, pitches: string[], length: number, velocity = 0.45): Step[] =>
  pitches.map((pitch) => ({ step, pitch, velocity, length }));

/** A drum roll that gets louder — the classic way a fill hands over to the
 *  next section. Velocity ramps linearly across the run. */
const roll = (pitch: string, from: number, count: number, quiet: number, loud: number): Step[] =>
  Array.from({ length: count }, (_, i) => ({
    step: from + i,
    pitch,
    velocity: Number((quiet + ((loud - quiet) * i) / (count - 1)).toFixed(2)),
    length: 1,
  }));

/**
 * The pack, in the order it is offered.
 *
 * Drum pitches follow the same convention the AI composer is told to use
 * (BeatComposer's prompt): low notes near C2 are the big drums, and because
 * DRUMS is a pitched membrane rather than a sampled kit (audio/instruments.ts),
 * a high pitch on the same lane IS the small drum. So a kit here is several
 * DRUMS lanes at different pitches — which also means each drum gets its own
 * mute, solo and fader, like any DAW.
 */
export const BEAT_PRESETS: BeatPreset[] = [
  {
    id: "trong-hoi",
    name: "Trống Hội",
    english: "Festival Drums",
    role: "Groove",
    bars: 2,
    bpm: 104,
    note: "The village-festival drum: a big drum on the accents, a small one chattering between them, and a wooden clapper holding time.",
    lanes: [
      {
        name: "Trống cái",
        instrument: "DRUMS",
        notes: [
          // The accents. Bar starts land hardest; the pushes before beat 3
          // are what stop this sounding like a march.
          ...hits("C2", [0, 16], 1),
          ...hits("C2", [6, 10, 22, 26, 30], 0.7),
        ],
      },
      {
        name: "Trống con",
        instrument: "DRUMS",
        notes: hits("G3", [2, 4, 8, 12, 14, 18, 20, 24, 28], 0.55),
      },
      {
        name: "Phách",
        instrument: "DRUMS",
        notes: hits("C5", [0, 4, 8, 12, 16, 20, 24, 28], 0.4),
      },
      {
        name: "Bè trầm",
        instrument: "BASS",
        notes: line([
          [0, "A2", 6],
          [10, "A2", 4],
          [16, "E2", 6],
          [26, "G2", 4],
        ]),
      },
    ],
  },
  {
    id: "dan-tranh",
    name: "Đàn Tranh",
    english: "Zither Cascade",
    role: "Intro",
    bars: 2,
    bpm: 96,
    note: "The zither's signature move — a run down all five notes, landing on one that rings. Plucked strings, so the notes decay on their own.",
    lanes: [
      {
        name: "Tranh",
        instrument: "GUITAR",
        notes: line([
          // Falling through the pentatonic, one note per sixteenth: the
          // cascade the instrument is known for.
          [0, "C6", 1],
          [1, "A5", 1],
          [2, "G5", 1],
          [3, "E5", 1],
          [4, "D5", 1],
          [5, "C5", 1],
          [6, "A4", 1],
          [7, "G4", 1],
          [8, "E4", 8], // ...and it lands.
          // Bar two answers by climbing back up.
          [16, "A4", 1],
          [17, "C5", 1],
          [18, "D5", 1],
          [19, "E5", 1],
          [20, "G5", 1],
          [21, "A5", 1],
          [22, "C6", 1],
          [23, "D6", 1],
          [24, "E6", 8],
        ]),
      },
      {
        name: "Nền dây",
        instrument: "STRINGS",
        notes: [...chord(0, ["A3", "C4", "E4"], 16), ...chord(16, ["G3", "C4", "D4"], 16)],
      },
    ],
  },
  {
    id: "ru-con",
    name: "Ru Con",
    english: "Lullaby",
    role: "Melody",
    bars: 4,
    bpm: 68,
    note: "A cradle song: a slow, uneven melody over two held chords. The long notes are the point — leave them room.",
    lanes: [
      {
        name: "Giai điệu",
        instrument: "PIANO",
        notes: line([
          [0, "A4", 6],
          [6, "C5", 4],
          [10, "D5", 6],
          [16, "C5", 8],
          [24, "A4", 8],
          [32, "G4", 6],
          [38, "A4", 4],
          [42, "C5", 6],
          [48, "A4", 12],
          [60, "G4", 4],
        ]),
      },
      {
        name: "Nền",
        instrument: "STRINGS",
        notes: [...chord(0, ["A3", "C4", "E4"], 32), ...chord(32, ["G3", "C4", "D4"], 32)],
      },
    ],
  },
  {
    id: "lofi-quan-ho",
    name: "Lofi Quan Họ",
    english: "Lofi Folk",
    role: "Groove",
    bars: 2,
    bpm: 84,
    note: "The fusion the pack is built for: boom-bap drums that drag behind the beat, with folk-pentatonic keys on top.",
    lanes: [
      {
        name: "Trống trầm",
        instrument: "DRUMS",
        // Late and uneven — a kick exactly on the quarters is a metronome.
        notes: hits("C2", [0, 10, 16, 22, 26], 0.95),
      },
      {
        name: "Trống đập",
        instrument: "DRUMS",
        notes: hits("D3", [4, 12, 20, 28], 0.8),
      },
      {
        name: "Nhịp lẻ",
        instrument: "DRUMS",
        notes: hits("A4", [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], 0.3),
      },
      {
        name: "Bè trầm",
        instrument: "BASS",
        notes: line([
          [0, "A2", 4],
          [10, "A2", 2],
          [16, "G2", 4],
          [26, "E2", 4],
        ]),
      },
      {
        name: "Phím",
        instrument: "PIANO",
        notes: [
          ...chord(0, ["A3", "C4", "E4"], 6, 0.55),
          ...chord(12, ["G3", "C4", "D4"], 4, 0.45),
          ...chord(16, ["A3", "C4", "E4"], 6, 0.55),
          ...chord(28, ["E4", "G4"], 4, 0.45),
        ],
      },
    ],
  },
  {
    id: "sao-truc",
    name: "Sáo Trúc",
    english: "Bamboo Flute",
    role: "Melody",
    bars: 4,
    bpm: 84,
    note: "A lead line in long breaths. The quick quiet notes before the long ones are luyến — the slide a flute player makes into a note, written as a grace note because the grid has no bends.",
    lanes: [
      {
        name: "Sáo",
        instrument: "SYNTH",
        notes: line([
          [0, "G4", 1, 0.45], // luyến into...
          [1, "A4", 7],
          [8, "C5", 1, 0.45],
          [9, "D5", 7],
          [16, "E5", 12],
          [28, "D5", 4],
          [32, "C5", 1, 0.45],
          [33, "A4", 7],
          [40, "G4", 8],
          [48, "A4", 16],
        ]),
      },
    ],
  },
  {
    id: "song-lang",
    name: "Song Lang",
    english: "Break & Roll",
    role: "Fill",
    bars: 2,
    bpm: 104,
    note: "Two bars that hand over to the next section: near-silence, then a roll that gets louder. Drop this where one part of the song becomes another.",
    lanes: [
      {
        name: "Trống cái",
        instrument: "DRUMS",
        notes: hits("C2", [0, 8], 0.9),
      },
      {
        name: "Song lang",
        instrument: "DRUMS",
        // The clapper marks the phrase, and almost nothing else. Sparse is
        // correct here, not unfinished.
        notes: hits("C5", [4, 12], 0.5),
      },
      {
        name: "Dồn trống",
        instrument: "DRUMS",
        notes: roll("G3", 16, 16, 0.3, 1),
      },
    ],
  },
];

/**
 * A preset, expressed as the same plan the AI composer produces.
 *
 * WHY A PLAN AND NOT A BESPOKE INSERT PATH. The page already knows how to
 * land an `AiAction[]` into a beat, and that path is not trivial — lanes
 * before notes, one history snapshot so Ctrl+Z takes the whole thing back,
 * notes flushed as deltas collaborators watch arrive. Rebuilding a second
 * version of it for presets would mean two ways to fill a beat that drift
 * apart, and the preset one would be the untested one. So a preset is a
 * plan, applied by the plan applier, read by plan.ts like any other.
 *
 * No SetBpm: see the note on `bpm` above.
 */
export function presetToPlan(preset: BeatPreset): AiAction[] {
  return [
    ...preset.lanes.map(
      (lane): AiAction => ({
        __typename: "AddLane",
        lane: lane.name,
        instrument: lane.instrument,
      }),
    ),
    ...preset.lanes.map(
      (lane): AiAction => ({
        __typename: "SetLanePattern",
        lane: lane.name,
        notes: lane.notes,
      }),
    ),
  ];
}

/** Total notes in a preset — shown in the browser so "what am I getting"
 *  has an answer before you insert it. */
export function noteCount(preset: BeatPreset): number {
  return preset.lanes.reduce((total, lane) => total + lane.notes.length, 0);
}
