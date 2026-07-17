import { useState } from "react";
import type { AiAction, Beat } from "../types";
import { Button, ErrorBanner, TextInput } from "../ui/kit";
import { Modal } from "../ui/shell";
import { SparkIcon } from "../ui/icons";
import { hasIrreversible, planSummary } from "./plan";

interface ComposeBeatDialogProps {
  beat: Beat;
  /** The plan the server proposed, once it has. null = still asking. */
  plan: AiAction[] | null;
  /** A request is in flight (fetching a plan, or applying one). */
  busy: boolean;
  /** Failure shown IN the dialog (not the page banner): the person's next
   *  move is to fix the prompt, which is right here. */
  error: string | null;
  onCancel: () => void;
  onCompose: (prompt: string) => void;
  onApply: () => void;
  /** Throw the plan away and go back to the prompt, so a bad plan costs a
   *  reword rather than an undo. */
  onDiscard: () => void;
}

/**
 * "Describe the beat, read the plan, then decide."
 *
 * WHY THE PREVIEW EXISTS, when GeneratePatternDialog has none: the server
 * deliberately PROPOSES and never executes (BeatComposer returns a plan and
 * saves nothing) — but that promise only reaches the user if something
 * shows them the proposal. Generating one lane's notes needs no preview
 * because the result IS notes, visible on the grid and undoable. A plan is
 * not: it can retempo the song and add lanes, and Ctrl+Z covers patterns
 * ONLY. Applying that sight-unseen would mean the one part the user cannot
 * take back is also the part they never got to see.
 *
 * So: prompt → plan → Apply/Discard. Two phases in one dialog, because
 * they are one decision.
 */
export function ComposeBeatDialog({
  beat,
  plan,
  busy,
  error,
  onCancel,
  onCompose,
  onApply,
  onDiscard,
}: ComposeBeatDialogProps) {
  const [prompt, setPrompt] = useState("");
  const ready = prompt.trim().length > 0 && !busy;
  const empty = beat.tracks.length === 0;

  // ---- phase 2: the plan, waiting to be accepted -------------------------
  if (plan) {
    const steps = planSummary(plan);
    return (
      <Modal title={`Compose ${beat.name}`} onClose={busy ? () => {} : onCancel}>
        <p className="text-sm text-muted">
          Here's what the AI wants to do. Nothing has changed yet.
        </p>

        <ol className="mt-4 flex flex-col gap-2">
          {steps.map((step, index) => (
            <li
              key={index}
              className="flex items-start gap-3 rounded-lg border border-edge bg-surface px-3 py-2 text-sm"
            >
              <span className="mt-px font-mono text-[11px] text-muted">{index + 1}</span>
              <span className="text-text">{step}</span>
            </li>
          ))}
        </ol>

        {hasIrreversible(plan) && (
          // Only when it's true — a notes-only plan IS fully undoable, and
          // crying wolf on those would train the warning away.
          <p className="mt-4 rounded-lg border border-edge bg-surface-2/60 px-3 py-2 text-xs text-muted">
            The tempo change and any new lanes save immediately and are{" "}
            <strong className="text-text">not undoable</strong>. The notes are — Ctrl+Z brings the
            old ones back.
          </p>
        )}

        {error && (
          <div className="mt-3">
            <ErrorBanner>{error}</ErrorBanner>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDiscard} disabled={busy}>
            Discard
          </Button>
          <Button type="button" onClick={onApply} disabled={busy}>
            {busy ? "Applying…" : "Apply to beat"}
          </Button>
        </div>
      </Modal>
    );
  }

  // ---- phase 1: the prompt ----------------------------------------------
  return (
    <Modal title={`Compose ${beat.name}`} onClose={busy ? () => {} : onCancel}>
      <p className="text-sm text-muted">
        Describe the beat you want. The AI sees the whole song, and can set the tempo, add the
        lanes the music needs, and write each one —{" "}
        {empty ? (
          <>this beat is empty, so it has a free hand.</>
        ) : (
          <>
            it writes into <strong className="text-text">{beat.name}</strong>'s existing lanes
            rather than duplicating them.
          </>
        )}{" "}
        You'll see the plan before anything changes.
      </p>
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onCompose(prompt.trim());
        }}
      >
        <TextInput
          autoFocus
          maxLength={300}
          placeholder='e.g. "a sad lofi beat with brushed drums and a late bass"'
          value={prompt}
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
        />
        {error && (
          <div className="mt-3">
            <ErrorBanner>{error}</ErrorBanner>
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready}>
            {busy ? (
              "Composing…"
            ) : (
              <>
                <SparkIcon className="h-4 w-4" />
                Compose beat
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
