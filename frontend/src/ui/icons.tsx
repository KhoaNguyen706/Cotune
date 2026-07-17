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

/** Sidebar toggle — three lines. */
export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </Icon>
  );
}

/** Undo — a counter-clockwise loop back. */
export function UndoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12 A9 9 0 1 0 6 5.3 L3 8" />
      <polyline points="3 3 3 8 8 8" />
    </Icon>
  );
}

/** Redo — undo, mirrored. */
export function RedoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 12 A9 9 0 1 1 18 5.3 L21 8" />
      <polyline points="21 3 21 8 16 8" />
    </Icon>
  );
}

/** Transport play — an outline triangle, in the line family (not a filled
 *  glyph), so it sits with the rest of the toolbar. */
export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 5 L19 12 L7 19 Z" />
    </Icon>
  );
}

/** Transport stop. */
export function StopIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </Icon>
  );
}

/** Master volume — a speaker with waves. */
export function VolumeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 5 L6 9 H2 v6 h4 l5 4 Z" />
      <path d="M15.5 8.5 a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5 a9 9 0 0 1 0 13" />
    </Icon>
  );
}

/** Test-sound / audio sample — headphones. */
export function HeadphonesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 14 v-1 a8 8 0 0 1 16 0 v1" />
      <rect x="3" y="14" width="4.5" height="7" rx="1.5" />
      <rect x="16.5" y="14" width="4.5" height="7" rx="1.5" />
    </Icon>
  );
}

/** Chat — a speech bubble. */
export function ChatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 15 a2 2 0 0 1 -2 2 H8 l-4 4 V6 a2 2 0 0 1 2 -2 h12 a2 2 0 0 1 2 2 Z" />
    </Icon>
  );
}

/** History — a clock. */
export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </Icon>
  );
}

/** Download — tray with a down arrow. */
export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 15 v4 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2 -2 v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </Icon>
  );
}

/** Close — an X. Replaces the ✕/× glyphs, which render in whatever font the
 *  OS picks and drift off the icon family. */
export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </Icon>
  );
}

/**
 * AI actions — a spark. Replaces the ✨ emoji on every AI button (compose,
 * generate, admin copy). The sparkle-emoji is the most worn "AI toy" tell;
 * a drawn two-point spark reads as "generated" while staying in the palette
 * and taking the accent when a button wants it.
 */
export function SparkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4 L13.4 9.6 L19 11 L13.4 12.4 L12 18 L10.6 12.4 L5 11 L10.6 9.6 Z" />
      <path d="M18.5 4 L19 6 L21 6.5 L19 7 L18.5 9 L18 7 L16 6.5 L18 6 Z" />
    </Icon>
  );
}

/** Empty "no beats" mark — four pattern blocks. */
export function BlocksIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
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
