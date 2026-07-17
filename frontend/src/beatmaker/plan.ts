import type { AiAction, Step } from "../types";

/**
 * Reading an AI plan: what it will do, and where its notes land.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE. Two callers need the same answers.
 * The preview has to TELL you what a plan does before you accept it; the
 * apply has to DO it. If those two read the plan differently — even
 * slightly, even once — the preview becomes a lie, which is worse than no
 * preview at all. One reading, used twice.
 *
 * It is also the only way this logic gets tested. The apply itself is
 * welded to a network call and a live Gemini key, so it can only be
 * exercised by spending money in a browser. These functions take a plan and
 * return a value, so the ordering rules that matter can be pinned in
 * milliseconds with no key at all (plan.test.ts).
 *
 * Everything here assumes the SERVER already validated the plan
 * (BeatComposer.validate): the instrument is real, the BPM is in range,
 * every note survived the Step constructor. This module is about MEANING,
 * not safety.
 */

/** The tempo the plan sets, or null if it left the tempo alone. */
export function bpmOf(plan: AiAction[]): number | null {
  // First wins. The server allows only one set_bpm through per plan today,
  // but "the last tempo silently overrides the one you were shown in the
  // preview" is the kind of thing that should not depend on that.
  const action = plan.find((a) => a.__typename === "SetBpm");
  return action ? action.bpm : null;
}

/**
 * The lanes the plan will CREATE, in the order it asked for them, minus any
 * that are already there.
 *
 * `existingLaneNames` is what the beat holds RIGHT NOW, and filtering
 * against it is not belt-and-braces — it is the retry story. The server
 * dropped add_lane for lanes that existed when the plan was MADE, but if
 * applying it half-fails (three lanes asked for, the network dies after the
 * second) the plan is still on screen with its Apply button, and the user
 * will press it again. Without this, the retry adds the first two a second
 * time: two lanes called "drums" and a pattern that lands in a coin-flip
 * one of them — the exact thing BeatComposer.validate refuses to do
 * server-side.
 *
 * Case-insensitive, and it also won't emit the same name twice from one
 * plan, for the same reason: "Kick" and "kick" are one lane to everybody
 * except a string comparison.
 */
export function lanesToAdd(
  plan: AiAction[],
  existingLaneNames: string[] = [],
): { name: string; instrument: string }[] {
  const have = new Set(existingLaneNames.map((name) => name.toLowerCase()));
  const toAdd: { name: string; instrument: string }[] = [];
  for (const action of plan) {
    if (action.__typename !== "AddLane") continue;
    const key = action.lane.toLowerCase();
    if (have.has(key)) continue;
    have.add(key);
    toAdd.push({ name: action.lane, instrument: action.instrument });
  }
  return toAdd;
}

/**
 * The plan's note changes, keyed by LANE ID.
 *
 * Lanes are matched by NAME, case-insensitively, because a name is all the
 * model ever sees — it has no ids. The model routinely says add_lane("Kick")
 * then set_lane_pattern("kick"), which is one lane to everybody except a
 * string comparison.
 *
 * `lanes` must be the beat's lanes AFTER the plan's add_lane actions have
 * been created, or every pattern for a new lane silently lands nowhere. A
 * name with no lane is skipped rather than guessed at.
 *
 * LATER ACTIONS WIN. A plan that writes a lane and then clears it ends with
 * it cleared — literal, and the same order the model asked for. Applying it
 * any other way would mean deciding we know better than the plan we just
 * showed the user.
 */
export function notesByLaneId(
  plan: AiAction[],
  lanes: { id: string; name: string }[],
): Record<string, Step[]> {
  const idByName = new Map(lanes.map((lane) => [lane.name.toLowerCase(), lane.id] as const));
  const updates: Record<string, Step[]> = {};
  for (const action of plan) {
    if (action.__typename === "SetLanePattern") {
      const id = idByName.get(action.lane.toLowerCase());
      if (id) updates[id] = action.notes;
    } else if (action.__typename === "ClearLane") {
      const id = idByName.get(action.lane.toLowerCase());
      if (id) updates[id] = [];
    }
  }
  return updates;
}

/** One human-readable line per action, for the preview. Written in the
 *  order the plan will be applied, so the list IS the sequence. */
export function planSummary(plan: AiAction[]): string[] {
  return plan.map((action) => {
    switch (action.__typename) {
      case "SetBpm":
        return `Set the tempo to ${action.bpm} BPM`;
      case "AddLane":
        return `Add a ${action.instrument.toLowerCase()} lane called "${action.lane}"`;
      case "SetLanePattern":
        return `Write ${action.notes.length} note${action.notes.length === 1 ? "" : "s"} into "${action.lane}"`;
      case "ClearLane":
        return `Empty the "${action.lane}" lane`;
    }
  });
}

/** Whether applying this plan changes anything that Ctrl+Z cannot take
 *  back. Undo covers PATTERNS only — a tempo change and a new lane save
 *  immediately — so the dialog says so only when it's actually true. */
export function hasIrreversible(plan: AiAction[]): boolean {
  return plan.some((a) => a.__typename === "SetBpm" || a.__typename === "AddLane");
}
