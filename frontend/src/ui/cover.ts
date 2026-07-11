/**
 * Deterministic cover art: every song gets a unique gradient derived from
 * its id. No uploads, no storage, no empty-image placeholders — and the
 * SAME song is the same color forever, on every device, because the id is
 * the only input.
 *
 * Why bother: a gallery of identically-gray cards forces you to READ every
 * title to find your song. Give each one a stable hue and you start
 * recognizing them pre-attentively — the same reason tracks are colored
 * (see trackColors.ts). This is the cheapest possible visual identity.
 */

/** FNV-1a: a tiny, well-distributed string hash. Any decent hash works;
 *  what matters is that it's PURE — same id in, same hue out, always. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0; // force unsigned — bit ops in JS yield signed int32
}

export interface Cover {
  /** Ready to drop into `style={{ backgroundImage }}`. */
  backgroundImage: string;
  /** The dominant hue, for accents that must match the cover. */
  accent: string;
}

export function coverFor(id: string): Cover {
  const h = hash(id);
  // Two hues a fixed distance apart on the wheel: related enough to look
  // designed, far enough apart to read as a gradient rather than a smudge.
  const hue = h % 360;
  const hue2 = (hue + 48) % 360;
  // Saturation/lightness stay in a narrow, DEEP band: covers must sit on a
  // near-black canvas without glowing off it. The first pass used ~58%
  // lightness and the gallery read as confetti — bright enough that the
  // titles beneath them looked like an afterthought. Muted and darker lets
  // the art identify the song while the text stays the loudest thing.
  const from = `hsl(${hue} 48% 42%)`;
  const to = `hsl(${hue2} 55% 24%)`;
  // The angle varies too, so same-hue neighbors still differ.
  const angle = 115 + (h % 5) * 20;

  return {
    backgroundImage:
      `linear-gradient(${angle}deg, ${from}, ${to}), ` +
      // A faint diagonal weave over the gradient: texture at zero cost,
      // and it keeps large flat covers from looking like dead CSS.
      `repeating-linear-gradient(${angle + 90}deg, rgb(255 255 255 / 0.06) 0 2px, transparent 2px 9px)`,
    accent: from,
  };
}
