/**
 * Cover art for a song card: the song's note density over its length, drawn
 * as bars — a busy chorus is a tall band, an empty stretch a flat one.
 *
 * Ink on a key-colored well, like a level meter printed on the faceplate.
 * There is no per-song hue any more: the old covers hashed the song id into
 * a color, which under Chassis would be a seventh palette meaning nothing
 * (beat keys mean "where in the bar", lane caps mean "which instrument").
 * The SHAPE is what tells two songs apart, and it is real data.
 */

export interface Cover {
  /** Bar heights as percentages (0–100), left to right. */
  bars: number[];
  /** True when the shape reflects real notes rather than a placeholder. */
  fromNotes: boolean;
}

const BAR_COUNT = 32;

/** Note counts per slice of the song, if it has any notes at all. */
export interface CoverSource {
  /** Every note's absolute step, across every lane of every beat. */
  steps: number[];
  /** The song's total length in steps (so slices are proportional). */
  totalSteps: number;
}

/**
 * @param source the song's actual notes. The bars are a real HISTOGRAM of
 *               note density over the song's length, so the card genuinely
 *               visualizes the music. A purely decorative shape that ignores
 *               the data would be a lie the user can spot the moment they
 *               add a lane.
 */
export function coverFor(source?: CoverSource): Cover {
  const hasNotes = source != null && source.steps.length > 0 && source.totalSteps > 0;
  if (hasNotes) {
    const counts = new Array<number>(BAR_COUNT).fill(0);
    for (const step of source.steps) {
      // Clamp: a note at the very last step must land in the last bucket,
      // not one past the end.
      const bucket = Math.min(
        BAR_COUNT - 1,
        Math.floor((step / source.totalSteps) * BAR_COUNT),
      );
      counts[bucket]++;
    }
    const peak = Math.max(...counts);
    return {
      fromNotes: true,
      // Normalized against the song's own peak (relative dynamics), with a
      // floor so empty slices still read as a quiet bar rather than a gap.
      bars: counts.map((n) => Math.round(12 + (n / peak) * 88)),
    };
  }

  // No notes yet: a flat line. This used to be a seeded, invented waveform —
  // which made an empty song look exactly like a busy one, i.e. the card
  // lied about the one thing it exists to show.
  return {
    fromNotes: false,
    bars: new Array<number>(BAR_COUNT).fill(6),
  };
}
