import { useCallback, useEffect, useMemo, useRef } from "react";
import { createInstrument, type Mix, type TrackInstrument } from "../audio/instruments";

export interface Instruments {
  /** The live synths, keyed by LANE id. A ref, not state: nothing renders from
   *  it, and the Tone callbacks that read it are scheduled once. */
  map: React.MutableRefObject<Map<string, TrackInstrument>>;
  ensure: (laneId: string, instrument: string, mix?: Partial<Mix>) => void;
  dispose: (laneId: string) => void;
}

/**
 * Owns one synth per lane.
 *
 * This is a hook of its own rather than part of usePlayback for a structural
 * reason, not a stylistic one. Playback READS instruments (to trigger notes);
 * the data layer CREATES and DESTROYS them (lanes are added and deleted on the
 * server). Put the map inside usePlayback and the two hooks need each other:
 * playback would depend on the song's notes, and the song data would depend on
 * playback to make synths. Pulling the map out leaves a straight line —
 * instruments → data → playback — with no arrow pointing backwards.
 */
export function useInstruments(): Instruments {
  const map = useRef<Map<string, TrackInstrument>>(new Map());

  // Tone nodes are not garbage: they hold Web Audio graph nodes and will happily
  // outlive the page that made them.
  useEffect(() => {
    const owned = map.current;
    return () => {
      owned.forEach((instrument) => instrument.dispose());
      owned.clear();
    };
  }, []);

  /**
   * STABLE IDENTITIES, and this is not a micro-optimisation — it is a
   * correctness requirement, learned the hard way.
   *
   * `ensure` and `dispose` are dependencies of useSongData's `load`, which is a
   * dependency of the effect that CALLS load. Return fresh arrow functions here
   * and that chain re-creates itself on every render: load gets a new identity,
   * the effect sees a changed dependency and fires again, load() sets state, the
   * component re-renders, and round it goes.
   *
   * The symptom is not a crash. The app looks fine — it just silently refetches
   * the song forever (28 times in 6 seconds, when this was first caught), and
   * every refetch overwrites the grid with the server's copy. So a note you draw
   * vanishes a moment later, unless it happened to be flushed to the server
   * first, which makes the bug look like a race in the SAVE code rather than an
   * unstable dependency in a hook that has nothing to do with saving.
   *
   * useMemo on the object too: the object itself is passed to usePlayback, and a
   * fresh one each render would push the same problem one level up.
   */
  const ensure = useCallback((laneId: string, instrument: string, mix?: Partial<Mix>) => {
    const existing = map.current.get(laneId);
    if (existing) {
      // A reload may carry a mix a collaborator changed — apply it to the
      // synth that already exists rather than rebuilding the audio graph.
      if (mix) existing.setMix(mix);
      return;
    }
    map.current.set(laneId, createInstrument(instrument, mix));
  }, []);

  const dispose = useCallback((laneId: string) => {
    map.current.get(laneId)?.dispose();
    map.current.delete(laneId);
  }, []);

  return useMemo(() => ({ map, ensure, dispose }), [ensure, dispose]);
}
