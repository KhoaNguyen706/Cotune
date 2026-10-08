import { useState } from "react";
import type { Track } from "../types";
import type { Peer } from "../realtime/socket";
import type { Mix } from "../audio/instruments";
import { INSTRUMENTS, instrumentLabel } from "../audio/instrumentList";
import { colorFor } from "../ui/trackColors";
import { Button, EditableName, Select, TextInput } from "../ui/kit";
import { IconButton } from "../ui/shell";
import { CloseIcon, MinusIcon, PlusIcon } from "../ui/icons";
import { PeerDots } from "./PeerDots";

interface ConsoleProps {
  tracks: Track[];
  selectedTrackId: string | null;
  peers: Record<string, Peer>;
  muted: Set<string>;
  soloed: Set<string>;
  canEdit: boolean;
  onSelectTrack: (trackId: string) => void;
  onRenameTrack: (trackId: string, name: string) => void;
  onRemoveTrack: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onAddTrack: (name: string, instrument: string) => Promise<void>;
  /** Mid-drag: local state + live audio, no server traffic. */
  onMixChange: (trackId: string, mix: Partial<Mix>) => void;
  /** Gesture end: persist the final value — one PATCH per drag. */
  onMixCommit: (trackId: string, mix: Partial<Mix>) => void;
}

const panLabel = (value: number) => (value === 0 ? "C" : value < 0 ? `L${-value}` : `R${value}`);

/**
 * The console: one channel strip per lane, side by side, like a mixing desk.
 *
 * It replaced a sidebar that showed ONE lane's mix at a time — so balancing
 * the kick against the bass meant clicking back and forth between them,
 * which is the opposite of what a mixer is for. Every fader is visible at
 * once now, and a strip is also how you pick the lane the grid shows.
 *
 * Everything on a strip except M and S is SONG data (V14 + V17): saved on
 * release, heard by collaborators and listeners. Mute and solo are audition
 * tools and are not saved.
 */
export function Console(props: ConsoleProps) {
  const { tracks, canEdit } = props;
  // Folding is about YOUR screen (a laptop wants the grid back), not the
  // song — local state, like the arrangement palette's collapse. A phone
  // starts folded: there, the grid is the job and the mixer is a visit.
  const [folded, setFolded] = useState(() => window.matchMedia("(max-width: 767px)").matches);

  return (
    <section aria-label="Mixer" className="flex shrink-0 flex-col border-t border-edge-strong bg-surface">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-edge px-4">
        <h2 className="text-[0.8125rem] font-bold">Mixer</h2>
        <span className="text-xs text-muted tabular-nums">
          {tracks.length} lane{tracks.length === 1 ? "" : "s"}
        </span>
        <IconButton
          className="ml-auto !h-6"
          aria-expanded={!folded}
          title={folded ? "Show the mixer" : "Fold the mixer away"}
          onClick={() => setFolded((value) => !value)}
        >
          {folded ? <PlusIcon className="h-3.5 w-3.5" /> : <MinusIcon className="h-3.5 w-3.5" />}
          <span className="text-xs">{folded ? "Show" : "Fold"}</span>
        </IconButton>
      </div>
      {!folded && (
        <div className="flex h-52 min-w-0 overflow-x-auto pointer-coarse:h-64">
          {tracks.map((track) => (
            <ChannelStrip key={track.id} track={track} {...props} />
          ))}
          {canEdit && <AddLaneStrip onAddTrack={props.onAddTrack} first={tracks.length === 0} />}
          {!canEdit && tracks.length === 0 && (
            <p className="self-center px-4 text-sm text-muted">This beat has no lanes yet.</p>
          )}
        </div>
      )}
    </section>
  );
}

function ChannelStrip({
  track,
  selectedTrackId,
  peers,
  muted,
  soloed,
  canEdit,
  onSelectTrack,
  onRenameTrack,
  onRemoveTrack,
  onToggleMute,
  onToggleSolo,
  onMixChange,
  onMixCommit,
}: ConsoleProps & { track: Track }) {
  const selected = track.id === selectedTrackId;
  const isMuted = muted.has(track.id);
  const isSolo = soloed.has(track.id);

  /** One fader's wiring: the drag moves sound, the release saves. Pointer-up
   *  AND key-up commit, or an arrow-key nudge would change the sound and
   *  never be saved (the bug the old sliders had). */
  const fader = (key: keyof Mix, scale: number) => ({
    disabled: !canEdit,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      onMixChange(track.id, { [key]: Number(event.target.value) / scale }),
    onPointerUp: (event: React.PointerEvent<HTMLInputElement>) =>
      onMixCommit(track.id, { [key]: Number(event.currentTarget.value) / scale }),
    onKeyUp: (event: React.KeyboardEvent<HTMLInputElement>) =>
      onMixCommit(track.id, { [key]: Number(event.currentTarget.value) / scale }),
  });

  /** Double-click a fader to return it to its default — the DAW convention. */
  const reset = (key: keyof Mix, value: number) => () => {
    if (!canEdit) return;
    onMixChange(track.id, { [key]: value });
    onMixCommit(track.id, { [key]: value });
  };

  const volume = Math.round(track.volume * 100);
  const pan = Math.round(track.pan * 100);
  const reverb = Math.round(track.reverb * 100);
  const delay = Math.round(track.delay * 100);

  const latch = (on: boolean) =>
    "flex h-6 w-8 cursor-pointer items-center justify-center rounded-sm text-xs font-bold transition-colors duration-150 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent pointer-coarse:h-11 pointer-coarse:w-11 " +
    (on ? "bg-accent text-bg-soft" : "border border-edge-strong text-muted hover:text-text");

  return (
    <div
      className={
        "group relative flex w-32 shrink-0 cursor-pointer flex-col gap-2 border-r border-edge p-2 transition-colors duration-150 " +
        // The open lane: raised to key color with an ink rule under it —
        // the same mark as the open beat tab above the grid.
        (selected ? "bg-bg-soft shadow-[inset_0_-3px_0_var(--color-text)]" : "hover:bg-surface-2/60")
      }
      role="group"
      aria-current={selected ? "true" : undefined}
      aria-label={`${track.name} channel`}
      onClick={() => onSelectTrack(track.id)}
    >
      {/* The fader cap color: which instrument this is, at a glance. */}
      <i aria-hidden className="h-1 shrink-0 rounded-full" style={{ background: colorFor(track.instrument) }} />
      <div className="flex min-h-0 items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[0.8125rem] font-bold leading-tight font-stretch-condensed" title={track.name}>
            {canEdit ? (
              <EditableName value={track.name} onRename={(name) => onRenameTrack(track.id, name)} />
            ) : (
              track.name
            )}
          </p>
          <p className="text-[0.7rem] text-muted">{instrumentLabel(track.instrument)}</p>
        </div>
        {canEdit && (
          <button
            className="shrink-0 cursor-pointer rounded-sm text-muted opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100 pointer-coarse:opacity-100"
            title="Delete lane"
            aria-label={`Delete ${track.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onRemoveTrack(track.id);
            }}
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          className={latch(isMuted)}
          aria-pressed={isMuted}
          title="Mute (not saved: only you hear it)"
          onClick={(event) => {
            event.stopPropagation();
            onToggleMute(track.id);
          }}
        >
          M
        </button>
        <button
          className={latch(isSolo)}
          aria-pressed={isSolo}
          title="Solo (not saved: only you hear it)"
          onClick={(event) => {
            event.stopPropagation();
            onToggleSolo(track.id);
          }}
        >
          S
        </button>
        <span className="ml-auto">
          <PeerDots list={Object.values(peers).filter((peer) => peer.trackId === track.id)} where={track.name} />
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex flex-col items-center">
          <span className="text-[0.7rem] font-semibold tabular-nums">{volume}</span>
          <input
            type="range"
            className="fader-v min-h-0 flex-1"
            min={0}
            max={100}
            value={volume}
            aria-label={`${track.name} volume`}
            title="Volume. Double-click for 100."
            onDoubleClick={reset("volume", 1)}
            {...fader("volume", 100)}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-end gap-1">
          <Send label="Pan" value={panLabel(pan)}>
            <input
              type="range"
              className="w-full"
              min={-100}
              max={100}
              value={pan}
              aria-label={`${track.name} pan`}
              title="Pan. Double-click to center."
              onDoubleClick={reset("pan", 0)}
              {...fader("pan", 100)}
            />
          </Send>
          <Send label="Rev" value={String(reverb)}>
            <input
              type="range"
              className="w-full"
              min={0}
              max={100}
              value={reverb}
              aria-label={`${track.name} reverb send`}
              title="How much of this lane goes to the song's shared reverb"
              onDoubleClick={reset("reverb", 0)}
              {...fader("reverb", 100)}
            />
          </Send>
          <Send label="Dly" value={String(delay)}>
            <input
              type="range"
              className="w-full"
              min={0}
              max={100}
              value={delay}
              aria-label={`${track.name} delay send`}
              title="How much of this lane goes to the song's shared delay (dotted eighths, in time)"
              onDoubleClick={reset("delay", 0)}
              {...fader("delay", 100)}
            />
          </Send>
        </div>
      </div>
    </div>
  );
}

function Send({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="flex justify-between text-[0.68rem] leading-none text-muted">
        {label}
        <span className="font-semibold tabular-nums text-text">{value}</span>
      </span>
      {children}
    </div>
  );
}

/** The last strip on the desk: an empty one, waiting for a lane. */
function AddLaneStrip({
  onAddTrack,
  first,
}: {
  onAddTrack: (name: string, instrument: string) => Promise<void>;
  first: boolean;
}) {
  const [name, setName] = useState("");
  const [instrument, setInstrument] = useState("DRUMS");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onAddTrack(name.trim(), instrument);
      setName("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex w-48 shrink-0 flex-col gap-2 border-r border-dashed border-edge-strong p-3"
    >
      <p className="text-[0.8125rem] font-bold">{first ? "Add the first lane" : "Add a lane"}</p>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Lane name
        <TextInput
          className="!py-1 !text-sm"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Kick"
          required
          maxLength={80}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Instrument
        <Select className="!py-1 !text-sm" value={instrument} onChange={(event) => setInstrument(event.target.value)}>
          {INSTRUMENTS.map((value) => (
            <option key={value} value={value}>
              {instrumentLabel(value)}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" size="sm" disabled={busy || !name.trim()}>
        Add
      </Button>
    </form>
  );
}
