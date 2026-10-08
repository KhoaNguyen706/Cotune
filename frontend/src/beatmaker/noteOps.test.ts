import { describe, expect, it } from "vitest";
import type { Step } from "../types";
import { lowestOctave, pitchOf, rowOf, ROLL_ROWS } from "./constants";
import {
  copyNotes,
  deleteNotes,
  duplicateNotes,
  keyOf,
  notesInBox,
  paintVelocity,
  pasteNotes,
  resizeNotes,
  shiftNotes,
} from "./noteOps";

/**
 * The multi-note editing rules, pinned. The piano roll's gestures are thin
 * wrappers over these, so what is checked here is what a drag, a nudge or a
 * paste MEANS: all-or-nothing moves, upsert pastes, edge-of-beat behaviour.
 */

const note = (step: number, pitch: string, length = 1, velocity = 0.8): Step => ({
  step,
  pitch,
  velocity,
  length,
});
const keys = (...notes: Step[]) => new Set(notes.map(keyOf));
const sorted = (notes: Step[]) => [...notes].sort((a, b) => a.step - b.step || a.pitch.localeCompare(b.pitch));

describe("the two-octave roll", () => {
  it("maps rows to pitches with the lane's octave as the BOTTOM band", () => {
    expect(pitchOf(ROLL_ROWS - 1, 3)).toBe("C3"); // bottom row
    expect(pitchOf(0, 3)).toBe("B4"); // top row is the upper band
    expect(pitchOf(11, 3)).toBe("C4"); // last row of the upper band
  });

  it("opens a lane's view at its lowest note, never past the top band", () => {
    expect(lowestOctave([note(0, "E4"), note(2, "G3"), note(4, "C5")])).toBe(3);
    expect(lowestOctave([note(0, "B8")])).toBe(7); // B8 must still be visible
    expect(lowestOctave([])).toBeNull();
  });

  it("round-trips every visible row and rejects pitches outside both bands", () => {
    for (let row = 0; row < ROLL_ROWS; row++) {
      expect(rowOf(pitchOf(row, 2), 2)).toBe(row);
    }
    expect(rowOf("B1", 2)).toBeNull();
    expect(rowOf("C4", 2)).toBeNull();
  });
});

describe("shiftNotes", () => {
  const chord = [note(0, "C3"), note(0, "E3"), note(4, "G3")];

  it("moves and transposes a block, and returns the new selection", () => {
    const result = shiftNotes(chord, keys(chord[0], chord[1]), 2, 12, 16)!;
    expect(sorted(result.notes)).toEqual(sorted([note(2, "C4"), note(2, "E4"), note(4, "G3")]));
    expect(result.selected).toEqual(new Set(["2|C4", "2|E4"]));
  });

  it("crosses a sharp correctly — transposing is semitones, not rows", () => {
    expect(shiftNotes([note(0, "B2")], keys(note(0, "B2")), 0, 1, 16)!.notes).toEqual([note(0, "C3")]);
  });

  it("refuses the WHOLE move when one note would leave the beat", () => {
    const block = [note(0, "C3"), note(14, "C3", 2)];
    expect(shiftNotes(block, keys(...block), 1, 0, 16)).toBeNull();
  });

  it("refuses to land on a note that is not part of the move", () => {
    expect(shiftNotes(chord, keys(chord[0]), 4, 7, 16)).toBeNull(); // C3@0 → G3@4: occupied
  });

  it("lets a block slide over its own old positions", () => {
    const run = [note(0, "C3"), note(1, "C3"), note(2, "C3")];
    const result = shiftNotes(run, keys(...run), 1, 0, 16)!;
    expect(result.notes.map((n) => n.step).sort()).toEqual([1, 2, 3]);
  });

  it("refuses to leave C0..B8", () => {
    expect(shiftNotes([note(0, "C0")], keys(note(0, "C0")), 0, -1, 16)).toBeNull();
  });
});

describe("resize, delete", () => {
  it("resizes every selected note, each clamped to the beat and to one step", () => {
    const notes = [note(0, "C3", 2), note(14, "D3", 1), note(4, "E3", 3)];
    const longer = resizeNotes(notes, keys(notes[0], notes[1]), 3, 16);
    expect(longer.map((n) => n.length)).toEqual([5, 2, 3]); // the D3 hits the wall at 2
    expect(resizeNotes(notes, keys(...notes), -10, 16).map((n) => n.length)).toEqual([1, 1, 1]);
  });

  it("deletes exactly the selection", () => {
    const notes = [note(0, "C3"), note(0, "E3")];
    expect(deleteNotes(notes, keys(notes[0]))).toEqual([note(0, "E3")]);
  });
});

describe("copy, paste, duplicate", () => {
  const riff = [note(4, "C3", 2), note(6, "E3"), note(9, "G3")];

  it("copies relative to the block's first step, with its span", () => {
    expect(copyNotes(riff, keys(...riff))).toEqual({
      notes: [note(0, "C3", 2), note(2, "E3"), note(5, "G3")],
      span: 6,
    });
    expect(copyNotes(riff, new Set())).toBeNull();
  });

  it("pastes as an upsert — an existing note at the same spot is replaced", () => {
    const copied = { notes: [note(0, "C3", 1, 0.3)], span: 1 };
    const result = pasteNotes([note(8, "C3", 4, 0.9)], copied, 8, 16);
    expect(result.notes).toEqual([note(8, "C3", 1, 0.3)]);
    expect(result.selected).toEqual(new Set(["8|C3"]));
  });

  it("drops pasted notes that would run past the beat instead of squashing them", () => {
    const copied = copyNotes(riff, keys(...riff))!;
    const result = pasteNotes([], copied, 12, 16);
    expect(result.notes).toEqual([note(12, "C3", 2), note(14, "E3")]);
  });

  it("duplicates a selection immediately after itself", () => {
    // C3@4 (2 long) + E3@6 span steps 4..7, so the copy starts at 7. Its E3
    // lands on step 9 beside the existing G3 — a different pitch, both stay.
    const result = duplicateNotes(riff, keys(riff[0], riff[1]), 32)!;
    expect(sorted(result.notes)).toEqual(
      sorted([...riff, note(7, "C3", 2), note(9, "E3")]),
    );
    expect(result.selected).toEqual(new Set(["7|C3", "9|E3"]));
  });
});

describe("marquee and velocity painting", () => {
  it("selects notes whose start cell is in the box, in the visible bands only", () => {
    const notes = [note(0, "C3"), note(3, "E3"), note(8, "C3"), note(2, "C5")];
    const box = { stepFrom: 0, stepTo: 4, rowFrom: 0, rowTo: ROLL_ROWS - 1 };
    expect(notesInBox(notes, 3, box)).toEqual(new Set(["0|C3", "3|E3"]));
  });

  it("paints every note starting at the step, or only the selected ones", () => {
    const notes = [note(0, "C2"), note(0, "F#3"), note(1, "C2")];
    expect(paintVelocity(notes, 0, 0.5, new Set()).map((n) => n.velocity)).toEqual([0.5, 0.5, 0.8]);
    expect(paintVelocity(notes, 0, 0.5, new Set(["0|F#3"])).map((n) => n.velocity)).toEqual([0.8, 0.5, 0.8]);
  });

  it("never paints a note silent or past full", () => {
    expect(paintVelocity([note(0, "C2")], 0, 0, new Set())[0].velocity).toBe(0.05);
    expect(paintVelocity([note(0, "C2")], 0, 3, new Set())[0].velocity).toBe(1);
  });
});
