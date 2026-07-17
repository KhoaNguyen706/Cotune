import { describe, expect, it } from "vitest";
import type { AiAction, Step } from "../types";
import { bpmOf, hasIrreversible, lanesToAdd, notesByLaneId, planSummary } from "./plan";

/**
 * The plan-reading rules, pinned.
 *
 * These exist because the code that USES them (composeInto) cannot be
 * tested without a live Gemini key and a browser — so the part with the
 * actual decisions in it was moved somewhere a test can reach. What's
 * checked here is meaning: which lane a name refers to, which action wins
 * when two touch the same lane, and what the preview promises the apply
 * will do.
 *
 * The plans below are shaped like the ones Gemini really returns (see the
 * live probe: SetBpm 75, three lanes, mixed case, patterns keyed by name).
 */

const note = (step: number, pitch: string): Step => ({ step, pitch, velocity: 0.8, length: 1 });

const KICK: Step[] = [note(0, "C2"), note(8, "C2")];
const BASS: Step[] = [note(1, "C1")];

describe("bpmOf", () => {
  it("finds the tempo the plan sets", () => {
    expect(bpmOf([{ __typename: "SetBpm", bpm: 75 }])).toBe(75);
  });

  it("is null when the plan leaves the tempo alone", () => {
    // The prompt said nothing about feel or speed — a plan with no set_bpm
    // must not be read as "set it to 0".
    expect(bpmOf([{ __typename: "ClearLane", lane: "kick" }])).toBeNull();
  });
});

describe("lanesToAdd", () => {
  it("lists the new lanes in the plan's own order", () => {
    const plan: AiAction[] = [
      { __typename: "AddLane", lane: "drums", instrument: "DRUMS" },
      { __typename: "SetBpm", bpm: 75 },
      { __typename: "AddLane", lane: "bass", instrument: "BASS" },
    ];
    expect(lanesToAdd(plan)).toEqual([
      { name: "drums", instrument: "DRUMS" },
      { name: "bass", instrument: "BASS" },
    ]);
  });

  it("skips a lane the beat already has — the retry after a half-applied plan", () => {
    // Three lanes asked for, the network died after "drums". The plan is
    // still on screen with its Apply button and the user presses it again;
    // "drums" must not be created twice.
    const plan: AiAction[] = [
      { __typename: "AddLane", lane: "drums", instrument: "DRUMS" },
      { __typename: "AddLane", lane: "bass", instrument: "BASS" },
    ];
    expect(lanesToAdd(plan, ["drums"])).toEqual([{ name: "bass", instrument: "BASS" }]);
  });

  it("compares against existing lanes case-insensitively", () => {
    const plan: AiAction[] = [{ __typename: "AddLane", lane: "Kick", instrument: "DRUMS" }];
    expect(lanesToAdd(plan, ["kick"])).toEqual([]);
  });

  it("won't emit the same name twice from one plan", () => {
    const plan: AiAction[] = [
      { __typename: "AddLane", lane: "kick", instrument: "DRUMS" },
      { __typename: "AddLane", lane: "KICK", instrument: "SYNTH" },
    ];
    expect(lanesToAdd(plan, [])).toEqual([{ name: "kick", instrument: "DRUMS" }]);
  });

  it("adds everything when the beat is empty", () => {
    const plan: AiAction[] = [{ __typename: "AddLane", lane: "drums", instrument: "DRUMS" }];
    expect(lanesToAdd(plan, [])).toEqual([{ name: "drums", instrument: "DRUMS" }]);
  });
});

describe("notesByLaneId", () => {
  const lanes = [
    { id: "lane-kick", name: "kick" },
    { id: "lane-bass", name: "bass" },
  ];

  it("keys a lane's notes by its id", () => {
    const plan: AiAction[] = [{ __typename: "SetLanePattern", lane: "kick", notes: KICK }];
    expect(notesByLaneId(plan, lanes)).toEqual({ "lane-kick": KICK });
  });

  it("matches lane names case-insensitively", () => {
    // The model says add_lane("Kick") then set_lane_pattern("kick") all the
    // time. Same lane to everyone except a string comparison.
    const plan: AiAction[] = [{ __typename: "SetLanePattern", lane: "KICK", notes: KICK }];
    expect(notesByLaneId(plan, [{ id: "lane-kick", name: "Kick" }])).toEqual({
      "lane-kick": KICK,
    });
  });

  it("skips a lane name nothing matches rather than guessing", () => {
    const plan: AiAction[] = [{ __typename: "SetLanePattern", lane: "ghost", notes: KICK }];
    expect(notesByLaneId(plan, lanes)).toEqual({});
  });

  it("turns clear_lane into an empty pattern, not a missing key", () => {
    // A missing key would leave the lane's old notes alone — the opposite
    // of what "empty this lane" means.
    const plan: AiAction[] = [{ __typename: "ClearLane", lane: "kick" }];
    expect(notesByLaneId(plan, lanes)).toEqual({ "lane-kick": [] });
  });

  it("lets the later action win when two touch one lane", () => {
    // Literal: the plan wrote the lane and then emptied it, so it ends
    // empty. Applying it in any other order would mean overriding the plan
    // the user was just shown.
    const plan: AiAction[] = [
      { __typename: "SetLanePattern", lane: "kick", notes: KICK },
      { __typename: "ClearLane", lane: "kick" },
    ];
    expect(notesByLaneId(plan, lanes)).toEqual({ "lane-kick": [] });
  });

  it("ignores the actions that aren't about notes", () => {
    const plan: AiAction[] = [
      { __typename: "SetBpm", bpm: 75 },
      { __typename: "AddLane", lane: "bass", instrument: "BASS" },
      { __typename: "SetLanePattern", lane: "bass", notes: BASS },
    ];
    // The lane list is what exists AFTER add_lane ran — which is exactly
    // why composeInto adds lanes before it calls this.
    expect(notesByLaneId(plan, lanes)).toEqual({ "lane-bass": BASS });
  });

  it("writes several lanes in one pass", () => {
    const plan: AiAction[] = [
      { __typename: "SetLanePattern", lane: "kick", notes: KICK },
      { __typename: "SetLanePattern", lane: "bass", notes: BASS },
    ];
    expect(notesByLaneId(plan, lanes)).toEqual({ "lane-kick": KICK, "lane-bass": BASS });
  });
});

describe("planSummary", () => {
  it("describes each action in the order it will be applied", () => {
    const plan: AiAction[] = [
      { __typename: "SetBpm", bpm: 75 },
      { __typename: "AddLane", lane: "brushes", instrument: "DRUMS" },
      { __typename: "SetLanePattern", lane: "brushes", notes: KICK },
      { __typename: "ClearLane", lane: "old" },
    ];
    expect(planSummary(plan)).toEqual([
      "Set the tempo to 75 BPM",
      'Add a drums lane called "brushes"',
      'Write 2 notes into "brushes"',
      'Empty the "old" lane',
    ]);
  });

  it("counts one note without the plural", () => {
    expect(planSummary([{ __typename: "SetLanePattern", lane: "bass", notes: BASS }])).toEqual([
      'Write 1 note into "bass"',
    ]);
  });
});

describe("hasIrreversible", () => {
  it("is true for a tempo change — undo covers patterns only", () => {
    expect(hasIrreversible([{ __typename: "SetBpm", bpm: 75 }])).toBe(true);
  });

  it("is true for a new lane", () => {
    expect(hasIrreversible([{ __typename: "AddLane", lane: "bass", instrument: "BASS" }])).toBe(
      true,
    );
  });

  it("is false for a plan that only touches notes", () => {
    // Ctrl+Z genuinely covers this one, so the warning must not appear.
    const plan: AiAction[] = [
      { __typename: "SetLanePattern", lane: "kick", notes: KICK },
      { __typename: "ClearLane", lane: "bass" },
    ];
    expect(hasIrreversible(plan)).toBe(false);
  });
});
