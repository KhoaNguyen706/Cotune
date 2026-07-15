import { useState } from "react";
import type { Track } from "../types";
import { Button, ErrorBanner, TextInput } from "../ui/kit";
import { Modal } from "../ui/shell";

interface GeneratePatternDialogProps {
  track: Track;
  /** A request is in flight — the dialog locks so the prompt can't change
   *  out from under the notes that are about to land. */
  busy: boolean;
  /** Failure shown IN the dialog (not the page banner): the person's next
   *  move is to fix the prompt, which is right here. */
  error: string | null;
  onCancel: () => void;
  onGenerate: (prompt: string) => void;
}

/**
 * "Describe it, get notes." One text field on purpose: the model already
 * sees the whole song and the target lane server-side, so the prompt only
 * has to say what the person wants — everything else would be a form
 * standing between them and the music.
 */
export function GeneratePatternDialog({
  track,
  busy,
  error,
  onCancel,
  onGenerate,
}: GeneratePatternDialogProps) {
  const [prompt, setPrompt] = useState("");
  const ready = prompt.trim().length > 0 && !busy;

  return (
    <Modal title={`Generate notes for ${track.name}`} onClose={busy ? () => {} : onCancel}>
      <p className="text-sm text-muted">
        Describe the {track.instrument.toLowerCase()} pattern you want. The AI sees the whole
        song, writes into <strong className="text-text">{track.name}</strong> only, and replaces
        what's there — audition it, and Ctrl+Z brings the old notes back.
      </p>
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onGenerate(prompt.trim());
        }}
      >
        <TextInput
          autoFocus
          maxLength={300}
          placeholder='e.g. "a laid-back boom-bap groove with a ghost hit before beat 3"'
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
            {busy ? "Composing…" : "✨ Generate"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
