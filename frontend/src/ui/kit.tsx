import { useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

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
  variant?: "primary" | "ghost" | "danger";
  size?: "md" | "sm";
};

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold " +
  "transition-[transform,box-shadow,filter,border-color,color] duration-150 cursor-pointer " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg " +
  "active:scale-[0.97] disabled:opacity-55 disabled:cursor-default disabled:active:scale-100";

const buttonVariants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-gradient-to-br from-accent to-accent-2 text-bg " +
    "hover:not-disabled:brightness-110 hover:not-disabled:shadow-glow",
  ghost:
    "border border-edge-strong text-text bg-transparent " +
    "hover:not-disabled:border-accent hover:not-disabled:text-text",
  danger:
    "border border-transparent text-muted bg-transparent " +
    "hover:not-disabled:text-danger hover:not-disabled:border-danger",
};

const buttonSizes: Record<NonNullable<ButtonProps["size"]>, string> = {
  md: "px-4 py-2 text-sm",
  sm: "px-2 py-1 text-xs",
};

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      className={cx(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    />
  );
}

/* ---------- Form field ---------- */

const controlBase =
  "w-full rounded-lg border border-edge bg-bg-soft px-4 py-2 text-[0.95rem] text-text " +
  "transition-[border-color,box-shadow] duration-150 " +
  "placeholder:text-muted/60 " +
  "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40";

type FieldProps = {
  label: string;
  error?: string;
  children: ReactNode;
};

export function Field({ label, error, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
      {label}
      {children}
      {error && (
        <span className="text-xs font-medium normal-case tracking-normal text-danger">{error}</span>
      )}
    </label>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(controlBase, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(controlBase, "cursor-pointer", className)} {...props} />;
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
};

/** Double-click-to-rename text. Enter/blur commits, Escape cancels; a
 *  blank draft is a cancel, not a rename — blank names are invalid
 *  everywhere in the domain, so the UI never even sends them. */
export function EditableName({ value, onRename, maxLength = 80, className }: EditableNameProps) {
  const [draft, setDraft] = useState<string | null>(null); // null = not editing

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
    if (next && next !== value) void onRename(next);
  };

  return (
    <input
      autoFocus
      className={cx(
        "rounded border border-accent bg-bg-soft px-1 font-[inherit] text-inherit " +
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
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

/* ---------- Surfaces ---------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cx(
        "rounded-2xl border border-edge bg-gradient-to-b from-surface-2 to-surface p-6 shadow-card",
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
        "whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold",
        tone === "accent"
          ? "border-accent/45 bg-accent/10 text-accent"
          : "border-edge bg-bg-soft text-muted",
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Feedback ---------- */

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="my-2 rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger"
    >
      {children}
    </p>
  );
}

/** Loading placeholder that mirrors the shape of the content it replaces —
 *  skeletons reduce layout shift AND perceived wait versus a spinner. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-surface-2", className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: string;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <span className="text-4xl" aria-hidden>
        {icon}
      </span>
      <p className="font-semibold text-text">{title}</p>
      <p className="max-w-xs text-sm text-muted">{hint}</p>
    </div>
  );
}
