/**
 * Cover art for a song card: the song's note density over its length, drawn
 * as bars — a busy chorus is a tall band, an empty stretch a flat one. The
 * id only picks the HUE, deterministically, so a song keeps its colour on
 * every device.
 */

/** FNV-1a: a tiny, well-distributed string hash. Any decent hash works;
 *  what matters is that it's PURE — same id in, same art out, always. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0; // force unsigned — bit ops in JS yield signed int32
}

export interface Cover {
  /** Bar heights as percentages (0–100), left to right. */
  bars: number[];
  /** The song's hue, used for the bars and the card's ambient tint. */
  accent: string;
  /** A tinted backdrop for the art area — the bars sit ON this. */
  backdrop: string;
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
 * @param id     the song id — the only input for colour.
 *
 * @param source the song's actual notes. When present the waveform is a
 *               real HISTOGRAM of note density over the song's length, so
 *               the card genuinely visualizes the music: a busy chorus is a
 *               tall band, an empty stretch is a flat one. A purely
 *               decorative shape that ignores the data would be a lie the
 *               user can spot the moment they add a lane.
 */
export function coverFor(id: string, source?: CoverSource): Cover {
  const h = hash(id);
  const hue = h % 360;

  /**
   * Per-song hue, but at the DESIGN'S chroma, which is the whole trick.
   *
   * This used to be `hsl(hue 40% 14%)` — a properly coloured panel — and on
   * the old violet palette it passed. Against lime it did not: a grid of
   * fully saturated teal, salmon and purple panels next to one lime accent
   * reads as a crayon box, and the brand colour stops meaning "this is the
   * action" because everything is shouting.
   *
   * So the tint drops to chroma 0.026 — a hue you can name if you look, and
   * cannot see if you don't. The BARS keep real colour (0.13), because they
   * are the thing being identified; the panel behind them is just the room
   * they stand in. oklch, not hsl, so that every hue lands at the same
   * PERCEIVED lightness: hsl(60 …) and hsl(240 …) at identical "lightness"
   * are wildly different to the eye, which is why the old covers had some
   * cards glowing and others muddy.
   */
  const palette = {
    accent: `oklch(0.74 0.13 ${hue})`,
    backdrop: `oklch(0.19 0.026 ${hue})`,
  };

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
      ...palette,
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
    ...palette,
    fromNotes: false,
    bars: new Array<number>(BAR_COUNT).fill(6),
  };
}
