# Cotune design: "Chassis"

The direction every screen builds inside. The tokens themselves live in
`frontend/src/styles.css` (the part the browser reads); this file is the
reasoning, so later screens extend the system instead of reinventing it.

## The idea

Cotune is the drum machine on your desk. Warm grey hardware, ink-black keys,
and the one thing every drum machine has that a web app doesn't: step keys
painted by beat (red, orange, yellow, white, after the TR-808's key strip), so
you always know where in the bar a note sits.

- **Product:** a pattern sequencer where everyone on a song edits the same grid
  at the same time.
- **Core job:** draw and hear a beat, with collaborators, fast.
- **Personality:** precise, warm, hands-on. **Never:** toy-like, glossy.

## Tokens (summary; values in styles.css)

| Role | Light (chassis) | Means |
|---|---|---|
| `bg` | `#D8D5CE` | the chassis: the lowest surface |
| `surface` | `#EEECE7` | the faceplate: bars, panels, strips |
| `bg-soft` | `#F7F6F2` | keys: grid cells, inputs, wells (lightest = touchable) |
| `edge` / `edge-strong` | `#B3AFA6` / `#857F75` | rules / bar lines and control outlines (3:1) |
| `text` = `accent` | `#1C1D1C` | ink: text, notes, and the one primary key per view |
| `muted` | `#55524B` | legends and meta (6.6:1 on the faceplate) |
| `key-1..4` | `#CF4A2F #E58A2E #E9C04A #F4F1E8` | position in time, nothing else |
| `lane-1..6` | cobalt, teal, moss, walnut, berry, steel | which instrument (lane caps) |
| `danger` | `#A8241B` | errors and destruction, always with an icon or words |

- **Color means one thing each.** Neutrals are structure. Ink is "do this" and
  "this is a note". Key colors mean which beat of the bar (and the running
  light, the playhead). Lane caps identify an instrument. No per-song hues,
  no violet, no gradients.
- **Elevation is lightness, not shadow.** Chassis, then faceplate, then keys.
  The only shadow is on things that float (dialogs).
- **Type:** Archivo, using its width axis: condensed for lane names on narrow
  strips, wide and heavy for titles and readouts, like a model badge. Numbers
  use tabular figures, not a monospace; mono is for code and key names only.
- **Shape:** radius grows with size: keys 3px, controls 4px, panels 6px,
  dialogs 8px. 1px rules.
- **Motion:** 150–250ms, a key goes down a pixel and comes back. Everything
  respects `prefers-reduced-motion`.
- **Night panel** (dark): the same hardware with the lights off. Keys stay the
  lightest surface, key colors desaturate a step, lane caps lift to clear 3:1.
  Designed, not inverted.

## Layout: the console

- **Transport** on top (fixed): title, Arrange/Beat, Play (the one black key),
  BPM and time readouts, master volume.
- **Pattern bank** below it: one tab per beat, plus that beat's own settings
  (length, swing, compose, clear).
- **Grid** in the middle: the step ruler (the signature) over the piano roll,
  velocity lane and channel rack. Opening a lane scrolls its notes into view.
- **Mixer** at the bottom: one channel strip per lane (M/S, vertical volume
  fader, pan, reverb and delay sends). Foldable, and folded by default on
  phones.
- Arrange view keeps its palette sidebar and timeline on the same tokens.

On phones the transport scrolls sideways, the bank splits into two rows, and
the mixer starts folded. Nothing shrinks below its content, because a flex
item that does that overlaps its neighbor instead of scrolling.

## Rejected

- **B. Sơn mài** (Vietnamese lacquer: brown-black, eggshell notes, gold-leaf
  playhead, Be Vietnam Pro). The most distinctive option, and tied to the ngũ
  cung presets, but a narrower identity than a general beat tool should have.
- **C. Session** (daylight white, one color per collaborator, serif for what
  people wrote). Shows collaboration in every screenshot, but it spends the
  color budget on people, leaving none to say where in the bar a note sits.
- **Hardware skeuomorphism** (knobs, bevels, brushed metal). Common in music
  apps; only the beat-key logic was taken from the hardware.
- **Per-song cover hues** on the song list. A seventh palette that would mean
  nothing; the covers are ink note-density bars instead, so the shape is data.
- **Tracked all-caps eyebrows, mono data labels, middle-dot meta strings.**
  Replaced with sentence-case headings, tabular Archivo, and commas.

## Gotcha worth knowing

Tailwind v4 only emits theme variables it sees used in class names. The key
and lane colors are read through template strings (`var(--color-key-${n})`),
which the scanner can't see, so the light theme silently lost them while the
dark theme (plain CSS) kept them. The theme block is `@theme static` for that
reason.
