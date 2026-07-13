import { useRef, useState } from "react";
import type { Step } from "../types";

/** One undoable editor state: the whole grid + which lanes were unsaved.
 *  Snapshots are shallow — pattern arrays are replaced, never mutated
 *  (see updateNote), so sharing them across entries is safe. */
export interface HistoryEntry {
  notes: Record<string, Step[]>;
  dirty: Set<string>;
}

export interface History {
  /** Call BEFORE a mutation: pushes the current state as an undo point. */
  record: () => void;
  undo: () => void;
  redo: () => void;
  /** Cleared when server truth replaces local state — stale undo targets. */
  reset: () => void;
  /** Drives the enabled/disabled state of the undo & redo buttons. */
  sizes: { past: number; future: number };
}

/**
 * Which lanes actually changed between two grids.
 *
 * Undo used to restore the SNAPSHOT'S dirty set, which is a bug that had been
 * sitting here since undo was written: record() runs before an edit, so the set
 * it captures is usually EMPTY (auto-save had just flushed). Undo then restored
 * the old notes and marked them clean — so the restoration was never saved.
 * Reload the page and your undo was gone; the server still had the thing you
 * undid. Real-time only made it visible, by having a collaborator sit there
 * watching the notes not come back.
 *
 * Restoring a state is an EDIT. It has to be marked dirty like any other, and
 * the only honest way to know which lanes to mark is to compare them.
 */
function lanesThatDiffer(
  before: Record<string, Step[]>,
  after: Record<string, Step[]>,
): string[] {
  const key = (notes: Step[]) =>
    notes
      .map((n) => `${n.step}|${n.pitch}|${n.velocity}|${n.length}`)
      .sort()
      .join(","); // order-insensitive: a lane is a SET of notes, not a list
  const laneIds = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...laneIds].filter((id) => key(before[id] ?? []) !== key(after[id] ?? []));
}

/**
 * Undo/redo over PATTERN edits only (local, pre-save). Server-synced structure
 * (beats, lanes, clips) is out of scope until inverse server ops exist — that's
 * collaboration-phase machinery.
 *
 * Everything here reads the CURRENT grid through refs rather than through
 * closed-over state, because the keyboard handler that calls undo() is attached
 * once and would otherwise be frozen against the first render's notes forever.
 * That is also why the hook takes refs instead of values: it must be safe to
 * call from a listener that outlives the render it was created in.
 */
export function useHistory(
  notesRef: React.RefObject<Record<string, Step[]>>,
  dirtyRef: React.RefObject<Set<string>>,
  setNotes: (notes: Record<string, Step[]>) => void,
  setDirty: (dirty: Set<string>) => void,
  onRestore: () => void,
): History {
  const stack = useRef<{ past: HistoryEntry[]; future: HistoryEntry[] }>({ past: [], future: [] });
  const [sizes, setSizes] = useState({ past: 0, future: 0 });

  function record() {
    const h = stack.current;
    h.past.push({ notes: notesRef.current, dirty: dirtyRef.current });
    if (h.past.length > 100) h.past.shift(); // bounded — old history is noise
    h.future = []; // a new edit forks the timeline; redo targets are gone
    setSizes({ past: h.past.length, future: 0 });
  }

  /** undo and redo are the same move in opposite directions — pop one stack,
   *  push the current state onto the other, and mark whatever changed dirty. */
  function step(from: "past" | "future", to: "past" | "future") {
    const h = stack.current;
    const entry = h[from].pop();
    if (!entry) return;
    const current = notesRef.current;
    h[to].push({ notes: current, dirty: dirtyRef.current });
    setNotes(entry.notes);
    // Union: whatever was already unsaved, PLUS every lane this change touched.
    setDirty(new Set([...entry.dirty, ...lanesThatDiffer(current, entry.notes)]));
    onRestore(); // indices may no longer exist in the restored grid
    setSizes({ past: h.past.length, future: h.future.length });
  }

  return {
    record,
    undo: () => step("past", "future"),
    redo: () => step("future", "past"),
    reset: () => {
      stack.current = { past: [], future: [] };
      setSizes({ past: 0, future: 0 });
    },
    sizes,
  };
}
