import type { BeatPreset } from "./presets";
import { BEAT_PRESETS, noteCount } from "./presets";
import { Button, Chip, ErrorBanner, Spinner } from "../ui/kit";
import { Modal } from "../ui/shell";

interface PresetLibraryDialogProps {
  /** The song's current tempo, so a preset can say how far off it is
   *  instead of quoting a number with nothing to compare it to. */
  bpm: number;
  /** The preset being inserted right now, or null. */
  inserting: string | null;
  error: string | null;
  onClose: () => void;
  onInsert: (preset: BeatPreset) => void;
}

/**
 * The parts box.
 *
 * WHY IT INSERTS INSTEAD OF PREVIEWING. ComposeBeatDialog previews because
 * what the AI proposes is unknown until it answers, and it can retempo the
 * song and delete lanes. A preset is none of that: it is fixed, it is
 * written down, and it only ever ADDS a new beat — so the honest thing is
 * to make it fast and let the beat itself be the preview. Nothing existing
 * is touched, and deleting the beat undoes it completely.
 */
export function PresetLibraryDialog({
  bpm,
  inserting,
  error,
  onClose,
  onInsert,
}: PresetLibraryDialogProps) {
  const busy = inserting !== null;

  return (
    <Modal title="Preset beats" onClose={busy ? () => {} : onClose}>
      <p className="text-sm text-muted">
        Finished parts to build a song out of, all in the same five-note{" "}
        <strong className="text-text">ngũ cung</strong> scale — so any two of them stack. Insert one
        and it becomes an ordinary beat: edit it, then drop it on the timeline as many times as the
        song needs.
      </p>

      {error && (
        <div className="mt-3">
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}

      <div className="mt-4 flex max-h-[55vh] flex-col gap-2 overflow-y-auto pr-1">
        {BEAT_PRESETS.map((preset) => {
          const thisOne = inserting === preset.id;
          // Only worth mentioning when it would actually sound wrong —
          // a tempo note on every card is a tempo note nobody reads.
          const offTempo = Math.abs(preset.bpm - bpm) > 12;
          return (
            <div
              key={preset.id}
              className="rounded-lg border border-edge bg-surface px-3 py-2.5 transition-colors duration-150 hover:border-edge-strong"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <strong className="text-sm font-semibold text-text">{preset.name}</strong>
                    <span className="text-xs text-muted">{preset.english}</span>
                    <Chip>{preset.role}</Chip>
                  </div>
                  <p className="mt-1 text-[0.68rem] tabular-nums text-muted">
                    {preset.bars} bar{preset.bars > 1 ? "s" : ""} · {preset.lanes.length} lanes ·{" "}
                    {noteCount(preset)} notes · best around {preset.bpm} BPM
                    {/* Amber, not danger: it's worth noticing, not a failure. */}
                    {offTempo && <span className="text-solo"> (song is {bpm})</span>}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onInsert(preset)}
                >
                  {thisOne ? <Spinner className="h-3.5 w-3.5" /> : "Insert"}
                </Button>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{preset.note}</p>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[0.68rem] leading-relaxed text-muted">
        These change the notes, not the instruments — what makes them sound Vietnamese is the scale
        and the rhythm, which survive being played on the synths the app already has. Inserting
        never changes the song's tempo; the suggestions above are yours to follow or ignore.
      </p>

      <div className="mt-4 flex justify-end">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
