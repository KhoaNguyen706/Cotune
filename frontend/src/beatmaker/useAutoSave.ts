import { useEffect, useRef } from "react";
import { diffNotes } from "../realtime/socket";
import type { Realtime } from "./useRealtime";
import type { SongData } from "./useSongData";

/**
 * When an edit leaves the browser, and by which road.
 *
 * This is the one place that knows there ARE two roads, which is why it exists
 * as its own hook rather than living in useSongData: the delta path needs a live
 * socket, and the socket's note handler writes the state useSongData owns. Wire
 * them directly and the two hooks depend on each other. Composing them here
 * keeps that arrow pointing one way.
 */
export function useAutoSave(params: {
  data: SongData;
  realtime: Realtime;
  /** The user's preference. Note it does NOT govern the socket — see below. */
  autoSave: boolean;
  readOnly: boolean;
}) {
  const { data, realtime, autoSave, readOnly } = params;

  /**
   * Send what CHANGED, not what we hold.
   *
   * The whole-pattern save (saveViaHttp) is the same operation expressed as
   * "here is my entire lane" — and that phrasing is what makes concurrent
   * editing impossible, because our array cannot describe a note we have never
   * heard of, so writing it deletes theirs. The diff says only "add C3 at 4",
   * which the server merges into whatever the lane holds by now, including edits
   * that landed while we were dragging.
   *
   * Note there is no await and no dirty-lane loop over the network: ops are
   * fire-and-forget. Their acknowledgement is the broadcast coming back, which
   * updates serverNotesRef — and if one never arrives, the next diff simply
   * re-derives it. Re-sending is safe because every op is idempotent.
   */
  async function save() {
    // Belt and braces: even with the UI gated, never fire a write the server is
    // guaranteed to reject.
    if (readOnly) return;

    const lanes = data.dirtyRef.current;

    if (realtime.connected()) {
      for (const trackId of lanes) {
        const before = data.serverNotesRef.current[trackId] ?? [];
        const after = data.notesRef.current[trackId] ?? [];
        realtime.sendOps(diffNotes(trackId, before, after));
      }
      data.setDirty(new Set());
      return;
    }

    await data.saveViaHttp(lanes);
  }

  // The effect below is attached once per dirty-change, so it must reach the
  // CURRENT save() — which closes over fresh state on every render.
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    // `|| live`: while the real-time channel is up we ALWAYS flush on the
    // debounce, even for someone who turned auto-save off. Auto-save is a
    // preference about when your work is written to disk; it is not a preference
    // about whether your collaborators can see what you are doing. Honouring it
    // here would leave the other person staring at a stale grid and calling it a
    // bug.
    if (!(autoSave || realtime.live) || readOnly || data.dirty.size === 0 || data.saving) return;

    // TWO DEBOUNCES, because they are paying for completely different things.
    //
    // The 1s one exists to coalesce a burst of edits into a single HTTP save —
    // the cost it is hiding is a round trip per note. Reusing it for the socket
    // (which is what shipped first) put a full second of latency between your
    // note and your collaborator seeing it, and made "real-time" feel broken.
    //
    // On the socket the cost being hidden is tiny — one small frame down an
    // already-open pipe — so the delay only needs to be long enough to swallow
    // the intermediate states of a drag, not long enough to be felt. 90ms is
    // below the ~100ms threshold where a change stops reading as instant.
    const timer = setTimeout(() => void saveRef.current(), realtime.live ? 90 : 1000);
    return () => clearTimeout(timer);
  }, [autoSave, realtime.live, readOnly, data.dirty, data.saving]);

  // Unsaved work guard: the browser shows a "leave site?" prompt while any lane
  // is dirty. Cheap insurance against losing a beat to a reflexive tab-close —
  // and it disappears the moment you save.
  useEffect(() => {
    if (data.dirty.size === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [data.dirty]);

  return { save };
}
