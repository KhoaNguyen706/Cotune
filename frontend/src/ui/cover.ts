/**
 * Deterministic cover art: every song gets a unique WAVEFORM derived from
 * its id. No uploads, no storage, no empty-image placeholders — and the
 * same song draws the same waveform forever, on every device, because the
 * id is the only input.
 *
 * Why a waveform rather than a gradient: it says "audio" at a glance, and
 * the bar heights give each card a silhouette you recognize before you've
 * read the title — the same pre-attentive trick as instrument colors
 * (trackColors.ts). It is ART, not data: it does not depict the song's
 * actual audio, which doesn't exist until the arrangement is rendered.
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

/** Mulberry32: a seeded PRNG. Math.random() would give a DIFFERENT
 *  waveform on every render (and every reload) — the id must be the only
 *  source of randomness, so we carry the seed forward explicitly. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Cover {
  /** Bar heights as percentages (0–100), left to right. */
  bars: number[];
  /** The song's hue, used for the bars and the card's ambient tint. */
  accent: string;
  /** A dark, tinted backdrop for the art area — the bars sit ON this. */
  backdrop: string;
}

const BAR_COUNT = 32;

export function coverFor(id: string): Cover {
  const h = hash(id);
  const rand = seeded(h);
  const hue = h % 360;

  const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
    // A slow sine sets the overall arc so the waveform reads as a musical
    // phrase (a shape with a build and a fall) rather than white noise,
    // and the random term keeps neighbors from looking identical.
    const arc = Math.sin((i / BAR_COUNT) * Math.PI * 2 + (h % 10)) * 0.25 + 0.6;
    return Math.round(Math.max(18, Math.min(100, (arc + rand() * 0.45 - 0.15) * 100)));
  });

  return {
    bars,
    accent: `hsl(${hue} 70% 62%)`,
    // Deep and desaturated: the art must sit ON the near-black canvas, not
    // glow off it. The tint is just enough to identify the song.
    backdrop: `linear-gradient(160deg, hsl(${hue} 40% 14%), hsl(${(hue + 40) % 360} 45% 8%))`,
  };
}
