import type { SVGProps } from "react";

/**
 * The icon set, lifted from the Dashboard and Editor designs.
 *
 * WHY THESE EXIST: the nav used to be text glyphs — ▤ ◎ ☰ ⚑ ⚙ — picked
 * because they cost nothing. What they actually cost is control: a glyph
 * renders in whatever font the OS decides has it, so the "icons" were
 * different shapes, weights and vertical alignments on every machine, and
 * ⚑/⚙ arrive as full-colour emoji on some. These are paths: same shape
 * everywhere, and they inherit currentColor so a nav item's hover state
 * moves the icon with the label.
 *
 * All are 24x24, 1.7 stroke, no fill — one visual family, matching the
 * designs. Size comes from the call site via className (w-4 h-4 etc.),
 * never a hardcoded width here.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

/** My songs — a list. */
export function ListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <line x1="8" y1="7" x2="20" y2="7" />
      <line x1="8" y1="12" x2="20" y2="12" />
      <line x1="8" y1="17" x2="20" y2="17" />
      <circle cx="4" cy="7" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="17" r="1" />
    </Icon>
  );
}

/** Shared with me — a share graph. */
export function ShareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="12" r="2.4" />
      <circle cx="17" cy="6" r="2.4" />
      <circle cx="17" cy="18" r="2.4" />
      <line x1="9.1" y1="10.8" x2="14.9" y2="7.2" />
      <line x1="9.1" y1="13.2" x2="14.9" y2="16.8" />
    </Icon>
  );
}

/** Library — samples, as a rack of bars. */
export function LibraryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="5" width="4" height="14" rx="1" />
      <rect x="10" y="5" width="4" height="14" rx="1" />
      <line x1="18" y1="6" x2="20.5" y2="18" />
    </Icon>
  );
}

/** Handbook — an open book. */
export function BookIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 6.5 C10 5 7.5 4.5 4 4.5 V17.5 C7.5 17.5 10 18 12 19.5" />
      <path d="M12 6.5 C14 5 16.5 4.5 20 4.5 V17.5 C16.5 17.5 14 18 12 19.5" />
    </Icon>
  );
}

/** Admin — a shield. */
export function ShieldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3 L20 6.5 V12 C20 16.5 16.5 19.5 12 21 C7.5 19.5 4 16.5 4 12 V6.5 Z" />
    </Icon>
  );
}

/** Settings — mixer sliders, not a cog. The designs chose it and they are
 *  right: this is a DAW, and faders are what its settings look like. */
export function SlidersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <line x1="4" y1="8" x2="20" y2="8" />
      <circle cx="15" cy="8" r="2.4" fill="var(--color-surface)" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9" cy="16" r="2.4" fill="var(--color-surface)" />
    </Icon>
  );
}

/** Search — the dashboard's filter field. */
export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" />
    </Icon>
  );
}

/** Back — the editor's return-to-library arrow. */
export function BackIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="11 18 5 12 11 6" />
    </Icon>
  );
}

/** Saved — the top bar's "all changes saved" tick. */
export function CheckIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2.4} {...props}>
      <polyline points="20 6 9 17 4 12" />
    </Icon>
  );
}

/**
 * The empty-timeline mark: three bars in a box, middle one lit.
 *
 * Not an emoji. This spot used to render 🎬 — a film clapperboard, on a
 * music app, which is the kind of thing that happens when an icon is
 * whatever glyph was nearest. Worse, an emoji is a full-colour bitmap the
 * OS chooses: it cannot take the accent, it does not know the palette, and
 * it looks different on every machine. The design draws this instead, and
 * the lit middle bar is doing a job — it is the only accent in an empty
 * view, so the eye lands where the content will appear.
 */
export function TimelineMark() {
  return (
    <span
      aria-hidden
      className="flex h-[46px] w-[46px] items-center justify-center gap-[3px] rounded-xl border-[1.5px] border-edge-strong bg-surface"
    >
      <i className="h-[14px] w-[3px] rounded-sm bg-muted/70" />
      <i className="h-[20px] w-[3px] rounded-sm bg-accent" />
      <i className="h-[10px] w-[3px] rounded-sm bg-muted/70" />
    </span>
  );
}
