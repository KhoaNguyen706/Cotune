import { useEffect, useRef } from "react";
import type { Step } from "../types";
import { cellFromEvent, pitchOf } from "./constants";
import type { History } from "./useHistory";

interface DragState {
  trackId: string;
  index: number;
  mode: "move" | "resize";
  grabOffset: number; // move only: steps between note.step and the grabbed cell
  rect: DOMRect; // roll geometry captured at drag start
  moved: boolean; // false until the mouse leaves the starting cell — a
  // "click" is a drag that never moved; we use it for note selection
  recorded: boolean; // history snapshot taken for this gesture? One drag =
  // one undo entry, captured lazily on the FIRST actual change so plain
  // clicks (note selection) never pollute the history
}

export interface PianoRoll {
  /** The grid element — drag math measures against it. */
  rollRef: React.MutableRefObject<HTMLDivElement | null>;
  onRollMouseDown: (e: React.MouseEvent) => void;
  onNoteMouseDown: (e: React.MouseEvent, index: number, note: Step, resize: boolean) => void;
  onNoteContextMenu: (e: React.MouseEvent, index: number) => void;
  updateNote: (trackId: string, index: number, changes: Partial<Step>) => void;
  deleteNote: (trackId: string, index: number) => void;
  clearLanes: (trackIds: string[]) => void;
}

/**
 * Drawing, dragging, stretching and deleting notes.
 *
 * The drag handlers live on the DOCUMENT, not the grid, so a gesture survives
 * the mouse leaving the roll — release outside and the note still lands. They
 * are attached ONCE and read everything through refs, which is why this hook
 * takes refs and stable callbacks rather than values.
 */
export function usePianoRoll(params: {
  selectedLaneId: string | null;
  canEdit: boolean;
  notesRef: React.MutableRefObject<Record<string, Step[]>>;
  beatStepsRef: React.MutableRefObject<number>;
  setNotes: React.Dispatch<React.SetStateAction<Record<string, Step[]>>>;
  setDirty: React.Dispatch<React.SetStateAction<Set<string>>>;
  history: History;
  preview: (trackId: string, pitch: string, velocity?: number) => void;
  /** Selection and per-lane octave are the PAGE's state, not the roll's.
   *  They are read by the beat browser and reset by a reload, so hoisting them
   *  is what keeps this hook from having to depend on the data layer that
   *  depends on it. */
  selectedNote: number | null;
  setSelectedNote: React.Dispatch<React.SetStateAction<number | null>>;
  octaves: Record<string, number>;
  octavesRef: React.MutableRefObject<Record<string, number>>;
}): PianoRoll {
  const {
    selectedLaneId,
    canEdit,
    notesRef,
    beatStepsRef,
    setNotes,
    setDirty,
    history,
    preview,
    setSelectedNote,
    octaves,
    octavesRef,
  } = params;

  const rollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  function markDirty(trackId: string) {
    setDirty((prev) => new Set(prev).add(trackId));
  }

  function updateNote(trackId: string, index: number, changes: Partial<Step>) {
    setNotes((prev) => {
      const notes = [...(prev[trackId] ?? [])];
      const updated = { ...notes[index], ...changes };
      // The backend rejects two events at the same step+pitch; blocking the
      // collision in the editor beats a save-time error message.
      const collides = notes.some(
        (n, i) => i !== index && n.step === updated.step && n.pitch === updated.pitch,
      );
      if (collides) return prev;
      notes[index] = updated;
      return { ...prev, [trackId]: notes };
    });
    markDirty(trackId);
  }

  function deleteNote(trackId: string, index: number) {
    history.record();
    setNotes((prev) => ({
      ...prev,
      [trackId]: (prev[trackId] ?? []).filter((_, i) => i !== index),
    }));
    markDirty(trackId);
    setSelectedNote(null);
  }

  /**
   * Wipe every note from some lanes.
   *
   * Note what this does NOT do: talk to the server. It empties local state and
   * marks the lanes dirty, and the existing flush diffs them against the last
   * server-confirmed pattern — which turns the wipe into one REMOVE op per note
   * that was actually there. No new op type, no new endpoint, no new tests on
   * the wire.
   *
   * And that is not merely convenient, it is more CORRECT than a "CLEAR_LANE" op
   * would be. A clear op says "empty this lane", so it would also delete a note
   * your collaborator added in the half-second before it arrived — a note you
   * never saw and never meant to touch. Per-note removals say "delete the notes
   * I could see", which is what you actually meant, and their note survives.
   * Deltas keep being the right shape for concurrent editing.
   *
   * history.record() first, so Ctrl+Z brings it all back (and undo re-emits the
   * notes as ADDs, so it un-clears for everyone else too).
   */
  function clearLanes(trackIds: string[]) {
    if (!canEdit || trackIds.length === 0) return;
    history.record();
    setNotes((prev) => {
      const next = { ...prev };
      for (const id of trackIds) next[id] = [];
      return next;
    });
    setDirty((prev) => {
      const next = new Set(prev);
      for (const id of trackIds) next.add(id);
      return next;
    });
    setSelectedNote(null); // the selected note no longer exists
  }

  function onRollMouseDown(e: React.MouseEvent) {
    // Only empty-cell presses land here — notes stop propagation.
    if (!selectedLaneId || e.button !== 0 || !rollRef.current) return;
    e.preventDefault();
    setSelectedNote(null);
    const rect = rollRef.current.getBoundingClientRect();
    const { col, row } = cellFromEvent(e, rect, beatStepsRef.current);
    const pitch = pitchOf(row, octaves[selectedLaneId] ?? 4);
    const notes = notesRef.current[selectedLaneId] ?? [];
    if (notes.some((n) => n.step === col && n.pitch === pitch)) return;

    history.record(); // undo removes the note (and any stretch that follows)
    setNotes((prev) => ({
      ...prev,
      [selectedLaneId]: [...(prev[selectedLaneId] ?? []), { step: col, pitch, velocity: 0.9, length: 1 }],
    }));
    markDirty(selectedLaneId);
    preview(selectedLaneId, pitch);
    // FL-style: the fresh note is immediately in resize mode — press, drag
    // right, release = a note exactly as long as you dragged.
    // recorded: true — add + stretch is ONE gesture, one undo entry.
    dragRef.current = {
      trackId: selectedLaneId,
      index: notes.length,
      mode: "resize",
      grabOffset: 0,
      rect,
      moved: false,
      recorded: true,
    };
  }

  function onNoteMouseDown(e: React.MouseEvent, index: number, note: Step, resize: boolean) {
    if (!selectedLaneId || e.button !== 0 || !rollRef.current) return;
    e.preventDefault();
    e.stopPropagation(); // don't let the roll create a note underneath
    const rect = rollRef.current.getBoundingClientRect();
    const { col } = cellFromEvent(e, rect, beatStepsRef.current);
    dragRef.current = {
      trackId: selectedLaneId,
      index,
      mode: resize ? "resize" : "move",
      grabOffset: col - note.step,
      rect,
      moved: false,
      recorded: false, // snapshot lazily on first change — clicks stay free
    };
  }

  function onNoteContextMenu(e: React.MouseEvent, index: number) {
    // Right-click deletes — the DAW convention.
    e.preventDefault();
    if (!selectedLaneId) return;
    deleteNote(selectedLaneId, index);
  }

  // Document-level listeners so a drag survives leaving the grid; attached once,
  // reading current drag state through the ref.
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const note = notesRef.current[drag.trackId]?.[drag.index];
      if (!note) return;
      const { col, row } = cellFromEvent(e, drag.rect, beatStepsRef.current);
      if (drag.mode === "resize") {
        const length = Math.max(1, Math.min(beatStepsRef.current - note.step, col - note.step + 1));
        if (length !== note.length) {
          if (!drag.recorded) {
            history.record(); // one entry per gesture, taken pre-change
            drag.recorded = true;
          }
          drag.moved = true;
          updateNote(drag.trackId, drag.index, { length });
        }
      } else {
        const octave = octavesRef.current[drag.trackId] ?? 4;
        const step = Math.max(0, Math.min(beatStepsRef.current - note.length, col - drag.grabOffset));
        const pitch = pitchOf(row, octave);
        if (step !== note.step || pitch !== note.pitch) {
          if (!drag.recorded) {
            history.record();
            drag.recorded = true;
          }
          drag.moved = true;
          updateNote(drag.trackId, drag.index, { step, pitch });
          if (pitch !== note.pitch) preview(drag.trackId, pitch, note.velocity);
        }
      }
    }
    function onUp() {
      const drag = dragRef.current;
      // A press-and-release that never moved is a CLICK — select the note so the
      // velocity slider (and Delete key) target it.
      if (drag && !drag.moved && drag.mode === "move") {
        setSelectedNote(drag.index);
      }
      dragRef.current = null;
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    rollRef,
    onRollMouseDown,
    onNoteMouseDown,
    onNoteContextMenu,
    updateNote,
    deleteNote,
    clearLanes,
  };
}
