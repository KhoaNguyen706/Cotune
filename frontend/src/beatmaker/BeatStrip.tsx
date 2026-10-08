import type { Beat } from "../types";
import type { Peer } from "../realtime/socket";
import { beatColor } from "../ui/trackColors";
import { EditableName, RangeField, Select } from "../ui/kit";
import { IconButton } from "../ui/shell";
import { CloseIcon, LibraryIcon, PlusIcon, SparkIcon } from "../ui/icons";
import { PeerDots } from "./PeerDots";

interface BeatStripProps {
  beats: Beat[];
  selectedBeat: Beat | null;
  peers: Record<string, Peer>;
  canEdit: boolean;
  /** Whether THIS account may use the AI (admin-granted) — controls only
   *  what's advertised; the server enforces. */
  aiEnabled: boolean;
  beatNoteCount: number;
  onSelectBeat: (beatId: string, firstTrackId: string | null) => void;
  onRenameBeat: (beatId: string, name: string) => void;
  onRemoveBeat: (beatId: string) => void;
  onAddBeat: () => void;
  onOpenPresets: () => void;
  onChangeBars: (beatId: string, bars: number) => void;
  /** Swing mid-drag (local + audible on the next loop) and on release (saved). */
  onSwingChange: (swing: number) => void;
  onSwingCommit: (swing: number) => void;
  onRequestCompose: () => void;
  onRequestClearBeat: () => void;
}

/**
 * The pattern bank: every beat in the song as a row of tabs, and the
 * settings that belong to the BEAT (length, swing) beside them.
 *
 * A drum machine keeps its patterns in banks you flip between with one
 * press, and that is the move here — the beat list used to live in a
 * sidebar, which spent 256px of width on what is really a row of names.
 * Lane-level controls (octave, generate, clear lane) are NOT here; they sit
 * on the grid, next to the lane they act on.
 */
export function BeatStrip(props: BeatStripProps) {
  const {
    beats,
    selectedBeat,
    peers,
    canEdit,
    aiEnabled,
    beatNoteCount,
    onSelectBeat,
    onRenameBeat,
    onRemoveBeat,
    onAddBeat,
    onOpenPresets,
    onChangeBars,
    onSwingChange,
    onSwingCommit,
    onRequestCompose,
    onRequestClearBeat,
  } = props;

  return (
    // Two rows on a phone (tabs, then the beat's settings), each scrolling
    // sideways on its own; one row on a desk, the tabs scrolling if a song
    // has many beats. Never a nav squeezed below its content: that
    // OVERLAPS the settings instead of scrolling.
    <div className="flex min-h-12 shrink-0 items-center gap-4 border-b border-edge bg-surface px-4 max-md:flex-col max-md:items-stretch max-md:gap-0 max-md:px-2">
      <nav aria-label="Beats in this song" className="flex min-w-0 items-center gap-1 overflow-x-auto max-md:h-12">
        {beats.map((beat) => {
          const selected = beat.id === selectedBeat?.id;
          const firstLane = [...beat.tracks].sort((a, b) => a.position - b.position)[0]?.id ?? null;
          return (
            <div
              key={beat.id}
              className={
                "group flex h-9 max-w-56 shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm transition-colors duration-150 pointer-coarse:h-11 " +
                // Open = a raised key with an ink rule under it, the way the
                // lit pattern key stands out on the bank. Never color alone.
                (selected
                  ? "bg-bg-soft font-semibold text-text shadow-[inset_0_-2px_0_var(--color-text)]"
                  : "text-muted hover:bg-bg-soft hover:text-text")
              }
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelectBeat(beat.id, firstLane)}
            >
              <i aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: beatColor(beat.position) }} />
              <span className="min-w-0 truncate" title={beat.name}>
                {canEdit ? (
                  <EditableName value={beat.name} onRename={(name) => onRenameBeat(beat.id, name)} />
                ) : (
                  beat.name
                )}
              </span>
              <span className="shrink-0 text-xs font-medium tabular-nums text-muted">
                {beat.bars} bar{beat.bars > 1 ? "s" : ""}
              </span>
              <PeerDots list={Object.values(peers).filter((peer) => peer.beatId === beat.id)} where={beat.name} />
              {canEdit && (
                <button
                  className="shrink-0 cursor-pointer rounded-sm text-muted opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100 pointer-coarse:opacity-100"
                  title="Delete beat (removes its lanes and timeline clips)"
                  aria-label={`Delete ${beat.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveBeat(beat.id);
                  }}
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {canEdit && (
          <>
            {/* Presets first: from an empty song, starting from a finished
                part is the likelier move than drawing one from nothing. */}
            <IconButton onClick={onOpenPresets} title="Preset beats">
              <LibraryIcon className="h-4 w-4" />
              Presets
            </IconButton>
            <IconButton onClick={onAddBeat} title="New empty beat" aria-label="New empty beat">
              <PlusIcon className="h-4 w-4" />
            </IconButton>
          </>
        )}
      </nav>

      {selectedBeat && (
        <div className="ml-auto flex shrink-0 items-center gap-4 max-md:ml-0 max-md:h-12 max-md:overflow-x-auto max-md:border-t max-md:border-edge max-md:[&>*]:shrink-0">
          <label className="flex items-center gap-2 text-xs font-medium text-muted">
            Length
            <Select
              className="!w-auto !py-1 !text-sm"
              value={selectedBeat.bars}
              disabled={!canEdit}
              onChange={(event) => onChangeBars(selectedBeat.id, Number(event.target.value))}
            >
              {[1, 2, 4, 8].map((bars) => (
                <option key={bars} value={bars}>
                  {bars} bar{bars > 1 ? "s" : ""}
                </option>
              ))}
            </Select>
          </label>
          {/* Swing belongs to the BEAT (V16), so it sits next to its length.
              0 = straight, 67 ≈ triplet swing, 100 = dotted. */}
          <div className="w-44">
            <RangeField
              label="Swing"
              value={Math.round(selectedBeat.swing * 100)}
              min={0}
              max={100}
              format={(value) => `${value}%`}
              disabled={!canEdit}
              resetTo={0}
              title="Pushes every off-beat 16th late: 0 straight, about 67 triplet, 100 dotted. Double-click to reset."
              onChange={(value) => onSwingChange(value / 100)}
              onCommit={(value) => onSwingCommit(value / 100)}
            />
          </div>
          {/* Beat-level, so it does NOT require a selected lane — an empty
              beat has none, and "compose me a beat" is exactly what you want
              there. The per-lane Generate needs a target and lives on the grid. */}
          {canEdit && aiEnabled && (
            <IconButton
              title={`Describe a beat and the AI writes ${selectedBeat.name}: tempo, lanes and all`}
              onClick={onRequestCompose}
            >
              <SparkIcon className="h-4 w-4" />
              Compose
            </IconButton>
          )}
          {canEdit && (
            <IconButton
              tone="danger"
              disabled={beatNoteCount === 0}
              title={`Clear every lane in ${selectedBeat.name} (${beatNoteCount} note${beatNoteCount === 1 ? "" : "s"})`}
              onClick={onRequestClearBeat}
            >
              Clear beat
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}
