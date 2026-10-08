import { useEffect, useRef, useState } from "react";
import type { Step } from "../types";
import { CELL_W, VELOCITY_H, cellFromEvent, pitchFromSemitone, pitchOf, semitoneOf } from "./constants";
import type { History } from "./useHistory";
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
  type CopiedNotes,
  type NoteKey,
} from "./noteOps";

/** A marquee in grid cells, inclusive on both ends. */
export interface Box {
  stepFrom: number;
  stepTo: number;
  rowFrom: number;
  rowTo: number;
}

/**
 * One gesture in progress. Every editing drag works the same way: snapshot
 * the lane at mousedown (`origin`), and on each mousemove recompute the
 * result FROM THAT SNAPSHOT with a pure function from noteOps. Recomputing
 * from the origin, rather than nudging the previous frame, is what lets a
 * block that hits a wall stop there and come back when you drag away from
 * it, instead of accumulating error frame by frame.
 */
type Drag =
  | {
      kind: "move" | "resize";
      laneId: string;
      rect: DOMRect;
      anchorCol: number;
      anchorRow: number;
      origin: Step[];
      selected: Set<NoteKey>;
      /** The note that was grabbed — a click (no movement) selects it alone. */
      grabbed: NoteKey;
      /** Its pitch right now, so a move auditions only when the pitch changes. */
      pitch: string;
      moved: boolean;
      /** History snapshot taken? Lazily, on the first real change, so a plain
       *  click (selection) never pollutes undo. A fresh note arrives `true`:
       *  add + stretch is one gesture, one undo entry. */
      recorded: boolean;
    }
  | { kind: "marquee"; rect: DOMRect; anchorCol: number; anchorRow: number; base: Set<NoteKey> }
  | { kind: "velocity"; laneId: string; rect: DOMRect; recorded: boolean };

/** Order-insensitive identity of a lane's layout — "did this frame change
 *  anything?" without caring how the array happens to be ordered. */
function signature(notes: Step[]): string {
  return notes
    .map((note) => `${keyOf(note)}|${note.length}`)
    .sort()
    .join(",");
}

export interface PianoRoll {
  /** The grid element — drag math measures against it. */
  rollRef: React.MutableRefObject<HTMLDivElement | null>;
  marquee: Box | null;
  onRollMouseDown: (e: React.MouseEvent) => void;
  onRollMouseMove: (e: React.MouseEvent) => void;
  onRollMouseLeave: () => void;
  onNoteMouseDown: (e: React.MouseEvent, note: Step, resize: boolean) => void;
  onNoteContextMenu: (e: React.MouseEvent, note: Step) => void;
  onVelocityMouseDown: (e: React.MouseEvent) => void;
  clearLanes: (trackIds: string[]) => void;
  /** Keyboard commands — the page's shortcut handler calls these. Each one
   *  returns whether it did anything, so the handler only swallows a key
   *  (preventDefault) when it was actually used. */
  commands: {
    selectAll: () => boolean;
    clearSelection: () => boolean;
    deleteSelected: () => boolean;
    copy: () => boolean;
    cut: () => boolean;
    paste: () => boolean;
    duplicate: () => boolean;
    nudge: (deltaSteps: number, deltaSemitones: number) => boolean;
  };
}

/**
 * Drawing, selecting, dragging, stretching, deleting — and the multi-note
 * commands (copy, paste, duplicate, nudge) behind the keyboard shortcuts.
 *
 * The drag handlers live on the DOCUMENT, not the grid, so a gesture survives
 * the mouse leaving the roll — release outside and the notes still land. They
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
   *  They are reset by a reload or an undo, so hoisting them is what keeps
   *  this hook from depending on the data layer that depends on it. */
  selection: Set<NoteKey>;
  setSelection: React.Dispatch<React.SetStateAction<Set<NoteKey>>>;
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
    selection,
    setSelection,
    octaves,
    octavesRef,
  } = params;

  const rollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  /** Ctrl+C's contents. A ref on the page-lifetime hook, so it survives
   *  switching lanes and beats — copy a riff from one lane, paste it into
   *  another. `from` is where the block started, for "paste right after". */
  const clipboardRef = useRef<(CopiedNotes & { from: number }) | null>(null);
  /** The column under the mouse, if it is over the roll — where Ctrl+V
   *  lands. Null when the mouse is elsewhere. */
  const hoverStepRef = useRef<number | null>(null);

  const laneRef = useRef(selectedLaneId);
  laneRef.current = selectedLaneId;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  function markDirty(trackId: string) {
    setDirty((prev) => new Set(prev).add(trackId));
  }

  /** Replace one lane's notes as an edit: dirty, and so flushed as deltas. */
  function writeLane(trackId: string, notes: Step[]) {
    // Keep the ref in step immediately: a command fired twice before React
    // re-renders (key repeat on an arrow) must see the first one's result.
    notesRef.current = { ...notesRef.current, [trackId]: notes };
    setNotes((prev) => ({ ...prev, [trackId]: notes }));
    markDirty(trackId);
  }

  function select(next: Set<NoteKey>) {
    selectionRef.current = next;
    setSelection(next);
  }

  /**
   * Wipe every note from some lanes.
   *
   * Note what this does NOT do: talk to the server. It empties local state and
   * marks the lanes dirty, and the existing flush diffs them against the last
   * server-confirmed pattern — which turns the wipe into one REMOVE op per note
   * that was actually there. No new op type, no new endpoint.
   *
   * And that is more CORRECT than a "CLEAR_LANE" op would be. A clear op says
   * "empty this lane", so it would also delete a note your collaborator added
   * in the half-second before it arrived — a note you never saw and never meant
   * to touch. Per-note removals say "delete the notes I could see", and their
   * note survives. Deltas keep being the right shape for concurrent editing.
   */
  function clearLanes(trackIds: string[]) {
    if (!canEdit || trackIds.length === 0) return;
    history.record();
    for (const id of trackIds) writeLane(id, []);
    select(new Set());
  }

  function onRollMouseDown(e: React.MouseEvent) {
    // Only empty-cell presses land here — notes stop propagation.
    if (!selectedLaneId || e.button !== 0 || !rollRef.current || !canEdit) return;
    e.preventDefault();
    const rect = rollRef.current.getBoundingClientRect();
    const { col, row } = cellFromEvent(e, rect, beatStepsRef.current);

    // Shift or Ctrl/Cmd + drag on empty grid = marquee (Shift adds to the
    // current selection). A plain press keeps its old meaning — draw a note —
    // because drawing is what you do most.
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const base = e.shiftKey ? new Set(selectionRef.current) : new Set<NoteKey>();
      dragRef.current = { kind: "marquee", rect, anchorCol: col, anchorRow: row, base };
      setMarquee({ stepFrom: col, stepTo: col, rowFrom: row, rowTo: row });
      select(base);
      return;
    }

    const pitch = pitchOf(row, octaves[selectedLaneId] ?? 4);
    const notes = notesRef.current[selectedLaneId] ?? [];
    if (notes.some((n) => n.step === col && n.pitch === pitch)) return;

    history.record(); // undo removes the note (and any stretch that follows)
    const created: Step = { step: col, pitch, velocity: 0.8, length: 1 };
    writeLane(selectedLaneId, [...notes, created]);
    preview(selectedLaneId, pitch);
    const key = keyOf(created);
    select(new Set([key]));
    // FL-style: the fresh note is immediately in resize mode — press, drag
    // right, release = a note exactly as long as you dragged.
    dragRef.current = {
      kind: "resize",
      laneId: selectedLaneId,
      rect,
      anchorCol: col,
      anchorRow: row,
      origin: notesRef.current[selectedLaneId],
      selected: new Set([key]),
      grabbed: key,
      pitch,
      moved: false,
      recorded: true,
    };
  }

  function onNoteMouseDown(e: React.MouseEvent, note: Step, resize: boolean) {
    if (!selectedLaneId || e.button !== 0 || !rollRef.current || !canEdit) return;
    e.preventDefault();
    e.stopPropagation(); // don't let the roll create a note underneath
    const rect = rollRef.current.getBoundingClientRect();
    const { col, row } = cellFromEvent(e, rect, beatStepsRef.current);
    const key = keyOf(note);

    // Selection rules every DAW shares: Shift toggles a note in or out; a
    // plain press on an unselected note selects just it; a plain press on a
    // note that is ALREADY selected keeps the group, so the drag moves all of
    // it (and a click that never moves collapses to that note on release).
    let selected = selectionRef.current;
    if (e.shiftKey) {
      selected = new Set(selected);
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
    } else if (!selected.has(key)) {
      selected = new Set([key]);
    }
    select(selected);
    if (!selected.has(key)) return; // shift-click deselected it: no drag

    dragRef.current = {
      kind: resize ? "resize" : "move",
      laneId: selectedLaneId,
      rect,
      // A resize measures from the note's END, wherever on the handle you grabbed.
      anchorCol: resize ? note.step + note.length - 1 : col,
      anchorRow: row,
      origin: notesRef.current[selectedLaneId] ?? [],
      selected: new Set(selected),
      grabbed: key,
      pitch: note.pitch,
      moved: false,
      recorded: false,
    };
  }

  function onNoteContextMenu(e: React.MouseEvent, note: Step) {
    // Right-click deletes — the DAW convention. Inside a selection it deletes
    // the selection, so a right-click on one of eight selected notes does
    // what the selection says.
    e.preventDefault();
    if (!selectedLaneId || !canEdit) return;
    const key = keyOf(note);
    const targets = selectionRef.current.has(key) ? selectionRef.current : new Set([key]);
    history.record();
    writeLane(selectedLaneId, deleteNotes(notesRef.current[selectedLaneId] ?? [], targets));
    select(new Set());
  }

  /** Velocity lane: press and sweep to paint. Height = loudness. */
  function onVelocityMouseDown(e: React.MouseEvent) {
    if (!selectedLaneId || e.button !== 0 || !canEdit) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { kind: "velocity", laneId: selectedLaneId, rect, recorded: false };
    paintAt(dragRef.current, e.clientX, e.clientY);
  }

  function paintAt(drag: Extract<Drag, { kind: "velocity" }>, clientX: number, clientY: number) {
    const step = Math.floor((clientX - drag.rect.left) / CELL_W);
    if (step < 0 || step >= beatStepsRef.current) return;
    const velocity = 1 - (clientY - drag.rect.top) / VELOCITY_H;
    const before = notesRef.current[drag.laneId] ?? [];
    const after = paintVelocity(before, step, velocity, selectionRef.current);
    if (after.every((note, i) => note === before[i])) return; // nothing at this step changed
    if (!drag.recorded) {
      history.record(); // one undo entry per sweep
      drag.recorded = true;
    }
    writeLane(drag.laneId, after);
  }

  function onRollMouseMove(e: React.MouseEvent) {
    if (!rollRef.current) return;
    const rect = rollRef.current.getBoundingClientRect();
    hoverStepRef.current = cellFromEvent(e, rect, beatStepsRef.current).col;
  }

  function onRollMouseLeave() {
    hoverStepRef.current = null;
  }

  // Document-level listeners so a drag survives leaving the grid; attached once,
  // reading current drag state through the ref.
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;

      if (drag.kind === "velocity") {
        paintAt(drag, e.clientX, e.clientY);
        return;
      }

      const { col, row } = cellFromEvent(e, drag.rect, beatStepsRef.current);

      if (drag.kind === "marquee") {
        const box = {
          stepFrom: Math.min(drag.anchorCol, col),
          stepTo: Math.max(drag.anchorCol, col),
          rowFrom: Math.min(drag.anchorRow, row),
          rowTo: Math.max(drag.anchorRow, row),
        };
        setMarquee(box);
        const lane = laneRef.current;
        if (!lane) return;
        const inBox = notesInBox(notesRef.current[lane] ?? [], octavesRef.current[lane] ?? 4, box);
        select(new Set([...drag.base, ...inBox]));
        return;
      }

      let result: { notes: Step[]; selected: Set<NoteKey> };
      // Rows run top-down through consecutive semitones (B4 … C4, B3 … C3),
      // so one row down is exactly one semitone lower, seam included.
      const deltaSemitones = -(row - drag.anchorRow);
      if (drag.kind === "resize") {
        result = {
          notes: resizeNotes(drag.origin, drag.selected, col - drag.anchorCol, beatStepsRef.current),
          selected: drag.selected,
        };
      } else if (col === drag.anchorCol && deltaSemitones === 0) {
        result = { notes: drag.origin, selected: drag.selected }; // dragged back home
      } else {
        const shifted = shiftNotes(drag.origin, drag.selected, col - drag.anchorCol, deltaSemitones, beatStepsRef.current);
        if (!shifted) return; // blocked: the block stays where it last fit
        result = shifted;
      }

      if (signature(result.notes) === signature(notesRef.current[drag.laneId] ?? [])) return;

      if (!drag.recorded) {
        history.record(); // one entry per gesture, taken pre-change
        drag.recorded = true;
      }
      drag.moved = true;
      writeLane(drag.laneId, result.notes);
      select(result.selected);

      // Audition the grabbed note when its pitch changes — hearing the note
      // you are dragging is how you find the right one without looking.
      if (drag.kind === "move") {
        const grabbedSemitone = semitoneOf(drag.grabbed.split("|")[1]);
        const pitchNow = grabbedSemitone === null ? null : pitchFromSemitone(grabbedSemitone + deltaSemitones);
        if (pitchNow && pitchNow !== drag.pitch) {
          drag.pitch = pitchNow;
          preview(drag.laneId, pitchNow);
        }
      }
    }

    function onUp() {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.kind === "marquee") {
        setMarquee(null);
        return;
      }
      // A press on a note in a group that never moved is a CLICK: it means
      // "this one", so the selection collapses to the note you clicked.
      if (drag.kind === "move" && !drag.moved && drag.selected.size > 1) {
        select(new Set([drag.grabbed]));
      }
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- keyboard commands ----------------------------------------------------
  // Each acts on the open lane and goes through history + writeLane exactly
  // like a mouse edit, so it is undoable and syncs as ordinary deltas.

  function laneNotes(): [string, Step[]] | null {
    const lane = laneRef.current;
    return lane && canEdit ? [lane, notesRef.current[lane] ?? []] : null;
  }

  const commands: PianoRoll["commands"] = {
    selectAll() {
      const current = laneNotes();
      if (!current) return false;
      select(new Set(current[1].map(keyOf)));
      return true;
    },
    clearSelection() {
      if (selectionRef.current.size === 0) return false;
      select(new Set());
      return true;
    },
    deleteSelected() {
      const current = laneNotes();
      if (!current || selectionRef.current.size === 0) return false;
      history.record();
      writeLane(current[0], deleteNotes(current[1], selectionRef.current));
      select(new Set());
      return true;
    },
    copy() {
      const current = laneNotes();
      if (!current) return false;
      const copied = copyNotes(current[1], selectionRef.current);
      if (!copied) return false;
      const from = Math.min(
        ...current[1].filter((note) => selectionRef.current.has(keyOf(note))).map((note) => note.step),
      );
      clipboardRef.current = { ...copied, from };
      return true;
    },
    cut() {
      return commands.copy() && commands.deleteSelected();
    },
    paste() {
      const current = laneNotes();
      const clip = clipboardRef.current;
      if (!current || !clip) return false;
      // Under the mouse if it is over the roll; otherwise right after where
      // the copied block came from — Ctrl+C, Ctrl+V repeats a phrase.
      const at = hoverStepRef.current ?? clip.from + clip.span;
      history.record();
      const result = pasteNotes(current[1], clip, at, beatStepsRef.current);
      writeLane(current[0], result.notes);
      select(result.selected);
      return true;
    },
    duplicate() {
      const current = laneNotes();
      if (!current) return false;
      const result = duplicateNotes(current[1], selectionRef.current, beatStepsRef.current);
      if (!result) return false;
      history.record();
      writeLane(current[0], result.notes);
      select(result.selected);
      return true;
    },
    nudge(deltaSteps, deltaSemitones) {
      const current = laneNotes();
      if (!current || selectionRef.current.size === 0) return false;
      const result = shiftNotes(current[1], selectionRef.current, deltaSteps, deltaSemitones, beatStepsRef.current);
      if (!result) return true; // at the wall: the key was still "used"
      history.record();
      writeLane(current[0], result.notes);
      select(result.selected);
      if (deltaSemitones !== 0) {
        const first = result.notes.find((note) => result.selected.has(keyOf(note)));
        if (first) preview(current[0], first.pitch, first.velocity);
      }
      return true;
    },
  };

  return {
    rollRef,
    marquee,
    onRollMouseDown,
    onRollMouseMove,
    onRollMouseLeave,
    onNoteMouseDown,
    onNoteContextMenu,
    onVelocityMouseDown,
    clearLanes,
    commands,
  };
}
