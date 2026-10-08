import { useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { AlertIcon, CloseIcon } from "./icons";

/**
 * The UI kit: every interactive atom owns its full state set — hover,
 * focus-visible, active, disabled — so screens can't ship a button that
 * forgets its focus ring. Spacing inside atoms sticks to the 8px grid
 * (px-4 py-2 = 16/8); the only 4px exceptions are icon-to-label gaps.
 *
 * Classes reference SEMANTIC tokens only (accent, surface, edge, muted…)
 * — no raw palette values anywhere below this comment.
 */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------- Button ---------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "destructive";
  size?: "md" | "sm";
};

// A press moves the key DOWN a pixel — what a hardware key does — rather
// than shrinking it, which no physical button has ever done. Touch targets
// grow to 44px on coarse pointers; with a mouse, a DAW's density wins.
const buttonBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold " +
  "transition-[transform,background-color,border-color,color] duration-150 ease-key cursor-pointer " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg " +
  "active:translate-y-px disabled:opacity-55 disabled:cursor-default disabled:active:translate-y-0 " +
  "pointer-coarse:min-h-11";

const buttonVariants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  // The black key: ink fill, light legend. One per view — it is the only
  // heavy thing on a grey panel, which is the whole of its emphasis.
  primary: "bg-accent text-bg-soft hover:not-disabled:bg-accent/85",
  ghost:
    "border border-edge-strong text-text bg-transparent " +
    "hover:not-disabled:bg-surface-2",
  danger:
    "border border-transparent text-muted bg-transparent " +
    "hover:not-disabled:text-danger hover:not-disabled:border-danger",
  // The confirm button of an irreversible action: solid, so the dialog's
  // last word is unmistakably the dangerous one.
  destructive: "bg-danger text-bg-soft hover:not-disabled:bg-danger/85",
};

const buttonSizes: Record<NonNullable<ButtonProps["size"]>, string> = {
  md: "px-4 py-2 text-sm",
  sm: "px-2 py-1 text-xs",
};

/** The button look, for a <Link> that navigates: an <a> styled as a key,
 *  never a <button> that routes (a link wearing a costume). */
export function buttonClass(variant: ButtonProps["variant"] = "primary", size: ButtonProps["size"] = "md"): string {
  return cx(buttonBase, buttonVariants[variant], buttonSizes[size]);
}

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return <button className={cx(buttonClass(variant, size), className)} {...props} />;
}

/* ---------- Brand ---------- */

/**
 * The wordmark: one bar's four step keys, then the name set wide.
 *
 * It exists as ONE component because it had been copy-pasted into five
 * screens (login, register, listen, songs, admin) — a rebrand is one edit.
 *
 * The mark IS the signature: the four beat keys of a bar, red / orange /
 * yellow / white, the same keys the editor paints over its grid. The name
 * is set in Archivo's wide cut, heavy, the way a model name is printed on
 * the faceplate of a machine.
 */
export function Wordmark({ size = "md", compactOnPhone }: { size?: "md" | "lg"; compactOnPhone?: boolean }) {
  const lg = size === "lg";
  return (
    <span className="flex items-center gap-2.5">
      {/* aria-hidden: the keys are the mark beside the name; a screen
          reader gets "Cotune" and nothing else. */}
      <span aria-hidden className={cx("grid shrink-0 grid-cols-4 gap-[2px]", lg ? "h-4 w-11" : "h-3 w-8")}>
        {[1, 2, 3, 4].map((key) => (
          <i
            key={key}
            className="rounded-[1px]"
            style={{
              background: `var(--color-key-${key})`,
              boxShadow: key === 4 ? "inset 0 0 0 1px var(--color-key-edge)" : undefined,
            }}
          />
        ))}
      </span>
      <span
        className={cx(
          "font-extrabold font-stretch-125% tracking-[-0.01em]",
          lg ? "text-[1.6rem]" : "text-[17px]",
          // In the phone-width nav rail the name would set the rail's width.
          compactOnPhone && "max-md:hidden",
        )}
      >
        Cotune
      </span>
    </span>
  );
}

/* ---------- Form field ---------- */

// border-edge-strong, not edge: an input's outline is how you find it, so
// it is held to the 3:1 non-text contrast rule (3.4:1 on the faceplate).
const controlBase =
  "w-full rounded-md border border-edge-strong bg-bg-soft px-3 py-2 text-[0.95rem] font-normal text-text " +
  "transition-[border-color,box-shadow] duration-150 " +
  "placeholder:text-muted " +
  "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 " +
  "pointer-coarse:min-h-11 " +
  // A field the form flagged (aria-invalid) stays red even while focused,
  // so the input and its message read as one.
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/40";

type FieldProps = {
  label: string;
  error?: string;
  children: ReactNode;
};

export function Field({ label, error, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-2 text-sm font-semibold text-text">
      {label}
      {children}
      {error && (
        <span className="flex items-center gap-1 text-[0.8125rem] font-medium text-danger">
          <AlertIcon className="h-3.5 w-3.5 shrink-0" />
          {error}
        </span>
      )}
    </label>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(controlBase, className)} {...props} />;
}

/** A native select (keyboard, mobile pickers and a11y for free) with the
 *  OS arrow replaced: appearance-none plus our own chevron, so it matches
 *  the inputs next to it instead of rendering as a grey system widget. */
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative inline-flex min-w-0">
      <select className={cx(controlBase, "cursor-pointer appearance-none pr-8", className)} {...props} />
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </span>
  );
}

/* ---------- Mixer slider ---------- */

/**
 * A labelled range with a live readout — every fader, knob and send in the
 * editor. Two callbacks because a mix control has two audiences: `onChange`
 * fires on every pixel of a drag (local state + the audio graph, so you hear
 * it move), `onCommit` fires once when the gesture ends (one PATCH per drag).
 *
 * The commit listens to pointer-up AND key-up. The sliders this replaced
 * only committed on pointer-up, so nudging one with the arrow keys changed
 * the sound and then silently never saved it.
 */
export function RangeField({
  label,
  value,
  min,
  max,
  format,
  disabled,
  title,
  onChange,
  onCommit,
  resetTo,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  format: (value: number) => string;
  disabled?: boolean;
  title?: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  /** Double-click returns here — the DAW convention for "back to default". */
  resetTo?: number;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted" title={title}>
      <span className="w-12 shrink-0">{label}</span>
      <input
        type="range"
        className="min-w-0 flex-1"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={(event) => onCommit(Number(event.currentTarget.value))}
        onKeyUp={(event) => onCommit(Number(event.currentTarget.value))}
        onDoubleClick={
          resetTo === undefined
            ? undefined
            : () => {
                onChange(resetTo);
                onCommit(resetTo);
              }
        }
      />
      <span className="w-9 shrink-0 text-right font-semibold tabular-nums text-text">{format(value)}</span>
    </label>
  );
}

/* ---------- Inline rename ---------- */

type EditableNameProps = {
  value: string;
  /** Called with the trimmed new name; only when it actually changed. */
  onRename: (next: string) => void | Promise<void>;
  maxLength?: number;
  /** Styles the DISPLAY text; the edit input inherits it so the swap
   *  doesn't jump. Size/weight come from the call site (h1 vs chip). */
  className?: string;
  /** Mount already editing — for an explicit "Rename" action, where a
   *  double-click would fight a click that means "open". */
  startEditing?: boolean;
  /** Editing ended, committed or cancelled. */
  onDone?: () => void;
};

/** Double-click-to-rename text. Enter/blur commits, Escape cancels; a
 *  blank draft is a cancel, not a rename — blank names are invalid
 *  everywhere in the domain, so the UI never even sends them. */
export function EditableName({
  value,
  onRename,
  maxLength = 80,
  className,
  startEditing,
  onDone,
}: EditableNameProps) {
  const [draft, setDraft] = useState<string | null>(startEditing ? value : null); // null = not editing

  if (draft === null) {
    return (
      <span
        className={cx("cursor-text", className)}
        title="Double-click to rename"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(value);
        }}
      >
        {value}
      </span>
    );
  }

  const commit = () => {
    const next = draft.trim();
    setDraft(null);
    onDone?.();
    if (next && next !== value) void onRename(next);
  };
  const cancel = () => {
    setDraft(null);
    onDone?.();
  };

  return (
    <input
      autoFocus
      className={cx(
        "rounded-sm border border-accent bg-bg-soft px-1 font-[inherit] text-inherit " +
          "focus:outline-none focus:ring-2 focus:ring-accent/40",
        className,
      )}
      value={draft}
      maxLength={maxLength}
      size={Math.max(draft.length, 6)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") cancel();
      }}
    />
  );
}

/* ---------- Surfaces ---------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cx(
        "rounded-xl border border-edge bg-surface p-6",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Chip({ tone = "default", children }: { tone?: "default" | "accent"; children: ReactNode }) {
  return (
    <span
      className={cx(
        "whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs font-semibold",
        tone === "accent"
          ? "border-accent bg-accent text-bg-soft"
          : "border-edge-strong bg-bg-soft text-muted",
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Feedback ---------- */

/** `onDismiss` adds a close control. Editor errors are one-off reports
 *  ("couldn't save that rename") that otherwise sat above the canvas until
 *  the next error replaced them. */
export function ErrorBanner({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
  return (
    // Ink text on the faceplate, flagged by the danger rule and icon: the
    // message is something to READ and act on, and long red text is hard
    // to read. The color marks it; the words carry it.
    <div
      role="alert"
      className="my-2 flex items-start gap-3 rounded-md border border-danger/60 border-l-4 border-l-danger bg-surface px-4 py-2 text-sm text-text"
    >
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
      <p className="min-w-0 flex-1">{children}</p>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-2 shrink-0 cursor-pointer rounded-sm px-1 text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** Loading placeholder that mirrors the shape of the content it replaces —
 *  skeletons reduce layout shift AND perceived wait versus a spinner. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-surface-2", className)} aria-hidden />;
}

/**
 * The one spinner. Used for in-flight work whose SHAPE we can't mirror with a
 * skeleton — an AI request that returns we-don't-know-what yet. Inherits
 * currentColor so it takes the color of whatever it sits in (a button's text,
 * an accent panel). The track ring is faint; the head arc is solid, so the
 * rotation reads even at 14px. `animate-spin` is neutralised by the global
 * prefers-reduced-motion rule — the ring then sits static, still legible as a
 * loading mark rather than strobing.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The "the AI is working" panel for the compose/generate dialogs. Replacing
 * the form with this while a Gemini call is in flight does two things a
 * disabled input can't: it says plainly that the wait is expected (these
 * calls take a few seconds), and it removes the dead-looking greyed field
 * that reads as "frozen" on a demo recording.
 */
export function AiThinkingPanel({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center" data-testid="ai-thinking">
      <Spinner className="h-8 w-8 text-accent" />
      <p className="text-sm font-semibold text-text">{label}</p>
      <p className="max-w-xs text-xs text-muted">
        The AI is reading your song. This usually takes a few seconds.
      </p>
    </div>
  );
}

/** An empty view says what is missing and offers the way to fix it —
 *  `action` is a button, not a paragraph of instructions. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  /** A drawn mark (icons.tsx), never an emoji. */
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <span className="text-muted" aria-hidden>
        {icon}
      </span>
      <p className="mt-1 text-lg font-bold font-stretch-semi-expanded text-text">{title}</p>
      {hint && <p className="max-w-xs text-sm text-muted">{hint}</p>}
      {action && <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
