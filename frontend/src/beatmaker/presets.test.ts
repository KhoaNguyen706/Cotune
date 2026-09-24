import { describe, expect, it } from "vitest";
import { INSTRUMENTS } from "../audio/instrumentList";
import { BEAT_PRESETS, PENTATONIC, noteCount, presetToPlan } from "./presets";
import { lanesToAdd, notesByLaneId } from "./plan";

/**
 * The presets are hand-written note data, and hand-written note data rots
 * silently: a note one step too long is rejected by the server at insert
 * time, in a dialog, in front of the user — the failure is remote, late and
 * confusing. Everything the server would refuse is refused HERE instead,
 * in milliseconds, with the preset's name in the message.
 *
 * The bounds mirror the Java side deliberately (Step.java, Beat.java,
 * Track.java). They are duplicated rather than imported because they are on
 * the other side of the wire — this file is the tripwire for them drifting.
 */

const STEPS_PER_BAR = 16; // Step.STEPS_PER_BAR
const MAX_BARS = 8; // Beat.MAX_BARS
/** Character-for-character the server's Step.PITCH_FORMAT. Note what it
 *  does NOT allow: flats (write A# not Bb) and octaves outside 0..8. */
const PITCH = /^([A-G])(#?)([0-8])$/;

describe("the preset pack", () => {
  it("has no duplicate ids", () => {
    const ids = BEAT_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(BEAT_PRESETS)("$name is a beat the server would accept", (preset) => {
    expect(preset.bars).toBeGreaterThanOrEqual(1);
    expect(preset.bars).toBeLessThanOrEqual(MAX_BARS);
    // Song.MIN_BPM..MAX_BPM — a suggestion the tempo field would reject is
    // worse than no suggestion.
    expect(preset.bpm).toBeGreaterThanOrEqual(20);
    expect(preset.bpm).toBeLessThanOrEqual(400);
    expect(preset.lanes.length).toBeGreaterThan(0);

    const span = preset.bars * STEPS_PER_BAR;
    for (const lane of preset.lanes) {
      expect(INSTRUMENTS).toContain(lane.instrument);
      expect(lane.notes.length).toBeGreaterThan(0);
      for (const note of lane.notes) {
        expect(note.pitch).toMatch(PITCH);
        expect(note.step).toBeGreaterThanOrEqual(0);
        expect(note.length).toBeGreaterThanOrEqual(1);
        // The one that actually bites: a note may not run past the end of
        // the beat it lives in.
        expect(note.step + note.length).toBeLessThanOrEqual(span);
        // Velocity is (0, 1] — zero is not "quiet", it is a note the server
        // rejects.
        expect(note.velocity).toBeGreaterThan(0);
        expect(note.velocity).toBeLessThanOrEqual(1);
      }
    }
  });

  it.each(BEAT_PRESETS)("$name names each lane once", (preset) => {
    // lanesToAdd de-dupes case-insensitively, so two lanes whose names
    // differ only by case would silently become one — and the second one's
    // notes would land in the first.
    const names = preset.lanes.map((lane) => lane.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * The pack's whole premise: one five-note pool, so any two presets stack.
   * If a preset ever reaches outside it the pack stops being arrangeable,
   * which is a musical regression no type can catch.
   */
  it.each(BEAT_PRESETS)("$name stays in the pentatonic", (preset) => {
    for (const lane of preset.lanes) {
      // Drums are pitched here (a membrane synth, not a sampled kit), so
      // their "pitch" is a drum size, not a note of the melody.
      if (lane.instrument === "DRUMS") continue;
      for (const note of lane.notes) {
        const [, letter, accidental] = PITCH.exec(note.pitch) ?? [];
        const where = `${preset.name} / ${lane.name}: ${note.pitch} is outside ngũ cung`;
        expect(accidental, where).toBe("");
        expect(PENTATONIC, where).toContain(letter);
      }
    }
  });

  it("counts every note it will insert", () => {
    const preset = BEAT_PRESETS[0];
    const counted = preset.lanes.reduce((n, lane) => n + lane.notes.length, 0);
    expect(noteCount(preset)).toBe(counted);
  });
});

describe("presetToPlan", () => {
  /**
   * The insert path reuses the AI plan applier, so what matters is that a
   * preset survives being READ as a plan: every lane gets created, and
   * every lane's notes then find that lane by name. plan.ts matches lanes
   * case-insensitively, which is exactly where a typo in the data would
   * hide — the lane would be added and the notes would land nowhere, with
   * no error anywhere.
   */
  it.each(BEAT_PRESETS)("$name lands all of its notes", (preset) => {
    const plan = presetToPlan(preset);

    // Into an EMPTY beat, which is what insert always creates.
    const added = lanesToAdd(plan, []);
    expect(added).toHaveLength(preset.lanes.length);

    // Stand in for the lanes the server would have created, in order.
    const created = added.map((lane, index) => ({ id: `lane-${index}`, name: lane.name }));
    const landed = notesByLaneId(plan, created);

    expect(Object.keys(landed)).toHaveLength(preset.lanes.length);
    const total = Object.values(landed).reduce((n, notes) => n + notes.length, 0);
    expect(total).toBe(noteCount(preset));
  });

  it("never retempos the song", () => {
    // Inserting a part into a song that already has five others must not
    // change the tempo of all of them. The suggestion is shown, not applied.
    for (const preset of BEAT_PRESETS) {
      const kinds = presetToPlan(preset).map((action) => action.__typename);
      expect(kinds).not.toContain("SetBpm");
      expect(kinds).not.toContain("SetTimeSignature");
      // ...and nothing destructive: a preset only ever adds.
      expect(kinds).not.toContain("RemoveLane");
      expect(kinds).not.toContain("ClearLane");
    }
  });

  it("adds every lane before writing into any of them", () => {
    // plan.ts requires the lanes to exist before notesByLaneId can find
    // them, and the applier creates them in exactly this order.
    for (const preset of BEAT_PRESETS) {
      const kinds = presetToPlan(preset).map((action) => action.__typename);
      expect(kinds.lastIndexOf("AddLane")).toBeLessThan(kinds.indexOf("SetLanePattern"));
    }
  });
});
