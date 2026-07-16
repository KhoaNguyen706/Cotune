import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * The APP SHELL: the layout vocabulary of a workstation, not a document.
 *
 * The whole app is one viewport-sized grid — a fixed TopBar, then a row of
 * panes that split the remaining height. Every pane that can overflow
 * scrolls INTERNALLY (min-h-0 + overflow-auto). That combination is the
 * entire trick: the page itself never scrolls, so the transport bar stays
 * put and the canvas always fills the screen no matter how empty or full
 * the song is.
 *
 * The `min-h-0` on flex children is not decoration — a flex item's default
 * min-height is auto, meaning it refuses to shrink below its content, so
 * an overflowing child would push the layout taller than the viewport
 * instead of scrolling. Forgetting it is THE classic full-height-app bug.
 */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------- structure ---------- */

/** Fills the viewport; hosts a TopBar plus a Workspace. */
export function AppShell({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col">{children}</div>;
}

/** The fixed command bar. Never scrolls, never grows: h-14, three slots. */
export function TopBar({
  left,
  center,
  right,
}: {
  left: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header
      className="flex h-14 shrink-0 items-center gap-4 border-b border-edge bg-surface/80 px-4 backdrop-blur-md max-md:gap-2 max-md:overflow-x-auto max-md:px-2"
      // A translucent bar over a scrolling canvas needs the blur, or the
      // clips sliding underneath turn the text into soup. On phones the bar
      // scrolls horizontally: a command bar that WRAPS steals canvas height,
      // and one that truncates hides commands — sideways scroll loses nothing.
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 max-md:gap-2">{left}</div>
      {center && <div className="flex shrink-0 items-center gap-2">{center}</div>}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{right}</div>
    </header>
  );
}

/** The row under the TopBar: sidebar(s) + canvas, splitting all leftover height. */
export function Workspace({ children }: { children: ReactNode }) {
  // relative: on phones the Sidebar positions itself as an overlay drawer
  // against this box (see Sidebar below).
  return <div className="relative flex min-h-0 flex-1">{children}</div>;
}

/**
 * The NAV RAIL: the app's primary navigation, pinned left for the whole
 * session. Distinct from Sidebar below — that one is a *document* browser
 * (this song's beats and audio), this one is *app* navigation (which
 * screen am I on). Keeping them separate components keeps the distinction
 * legible; a DAW has both, and conflating them is how sidebars turn into
 * junk drawers.
 */
export function NavRail({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    // On phones the rail narrows to icons (labels hidden by NavItem below):
    // 240px of navigation on a 375px screen would leave the actual app a
    // third of the glass. Same rail, same buttons — just their icon column.
    <nav className="flex w-60 shrink-0 flex-col border-r border-edge bg-surface/40 p-3 max-md:w-auto max-md:p-2">
      <div className="flex flex-1 flex-col gap-1">{children}</div>
      {footer && <div className="mt-4 flex flex-col gap-2">{footer}</div>}
    </nav>
  );
}

export function NavItem({
  icon,
  label,
  active,
  soon,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  /** Not built yet. Rendered, but visibly inert — an honest "coming", not
   *  a dead link that pretends to work. */
  soon?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      disabled={soon}
      onClick={onClick}
      aria-label={label}
      title={soon ? "Coming soon" : label}
      className={cx(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors duration-150 " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        soon
          ? "cursor-default text-muted/45"
          : active
            ? "cursor-pointer bg-surface-2 text-text"
            : "cursor-pointer text-muted hover:bg-surface-2/60 hover:text-text",
      )}
    >
      <span aria-hidden className="w-4 text-center">
        {icon}
      </span>
      {/* Icon-only on phones — the aria-label above keeps it accessible. */}
      <span className="max-md:hidden">{label}</span>
      {soon && (
        <span className="ml-auto rounded-full border border-edge px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wider max-md:hidden">
          soon
        </span>
      )}
    </button>
  );
}

/**
 * The browser column: fixed width, scrolls on its own, and can fold away.
 *
 * Collapsing animates the WIDTH (not display:none) so the canvas reclaims
 * the space smoothly — and so a drag in progress sees a continuous layout
 * change rather than a teleport. `overflow-hidden` while folding keeps the
 * contents from spilling across the canvas mid-animation.
 */
export function Sidebar({ children, collapsed }: { children: ReactNode; collapsed?: boolean }) {
  return (
    <aside
      aria-hidden={collapsed}
      className={cx(
        "flex shrink-0 flex-col gap-6 border-r border-edge bg-surface/40 transition-[width,padding] duration-200",
        // On phones an open sidebar OVERLAYS the canvas instead of
        // squeezing it: 256px out of 375 would leave a grid too narrow to
        // mean anything. Solid background because there's content under it.
        "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:bg-surface max-md:shadow-2xl",
        collapsed ? "w-0 overflow-hidden border-r-0 p-0" : "w-64 overflow-y-auto p-4",
      )}
    >
      {children}
    </aside>
  );
}

/** A labeled block inside the sidebar, with an optional action on the right. */
export function SidebarSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex h-6 items-center justify-between">
        <h2 className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The main work area. Scrolls in both axes; the grid lives in here. */
export function Canvas({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cx("min-w-0 flex-1 overflow-auto", className)}>{children}</main>;
}

/** A thin strip above the canvas content for contextual controls (octave,
 *  bar count, velocity) — the "inspector" row every DAW has. */
export function CanvasBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-3 flex h-11 shrink-0 items-center gap-3 border-b border-edge bg-bg/90 px-4 backdrop-blur-md">
      {children}
    </div>
  );
}

/* ---------- controls ---------- */

/**
 * A segmented cluster of controls that belong together (transport, export).
 * Grouping is what turns "a row of loose buttons" into a toolbar: related
 * actions share one bordered container, unrelated ones are separated by a
 * gap. The old header had neither, which is why it read as clutter.
 */
export function ToolGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "flex items-center gap-0.5 rounded-lg border border-edge bg-bg-soft/70 p-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Visual weight: `solid` is the one primary action (play). */
  tone?: "default" | "solid" | "danger";
  /** Pressed/latched state — mute, solo, an armed clip, the active tab. */
  active?: boolean;
};

/**
 * Square, 32px, icon-sized. Every toolbar button is this — uniform hit
 * targets and one focus treatment, so a toolbar can't drift into the
 * mismatched sizes the old header had.
 */
export function IconButton({ tone = "default", active, className, ...props }: IconButtonProps) {
  return (
    <button
      className={cx(
        "inline-flex h-8 min-w-8 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 " +
          "text-sm font-semibold transition-colors duration-150 " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 " +
          "disabled:cursor-default disabled:opacity-40",
        // Flat accent — same reasoning as kit.tsx's primary Button: the
        // lime→amber ramp goes through olive.
        tone === "solid" && "bg-accent text-bg hover:not-disabled:brightness-110",
        tone === "danger" && "text-muted hover:not-disabled:bg-danger/15 hover:not-disabled:text-danger",
        tone === "default" &&
          !active &&
          "text-muted hover:not-disabled:bg-surface-2 hover:not-disabled:text-text",
        tone === "default" && active && "bg-surface-2 text-text",
        className,
      )}
      {...props}
    />
  );
}

/** Read-only numeric readout (BPM, time signature, bar) — tabular so the
 *  digits don't jitter as values change during playback. */
export function Readout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col justify-center px-2 leading-tight">
      <span className="text-[0.6rem] font-bold uppercase tracking-[0.1em] text-muted">{label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums text-text">{children}</span>
    </div>
  );
}

/* ---------- overlay ---------- */

/** A centered modal. Used for "New song" so the create form stops
 *  occupying permanent real estate on a page it isn't the point of. */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={onClose} // click-outside closes
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl border border-edge bg-gradient-to-b from-surface-2 to-surface p-6 shadow-card"
        onMouseDown={(e) => e.stopPropagation()} // ...but clicks inside don't
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          <IconButton onClick={onClose} aria-label="Close">
            ✕
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
