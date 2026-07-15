import { useState } from "react";
import type { Beat, Track } from "../types";
import type { Peer } from "../realtime/socket";
import { beatColor, colorFor } from "../ui/trackColors";
import { Button, EditableName, Select, TextInput } from "../ui/kit";
import { IconButton, SidebarSection } from "../ui/shell";
import { PeerDots } from "./PeerDots";

interface BeatBrowserSidebarProps {
  beats: Beat[];
  selectedBeat: Beat | null;
  selectedBeatId: string | null;
  tracks: Track[];
  selectedTrackId: string | null;
  peers: Record<string, Peer>;
  muted: Set<string>;
  soloed: Set<string>;
  canEdit: boolean;
  onAddBeat: () => void;
  onSelectBeat: (beatId: string, firstTrackId: string | null) => void;
  onRenameBeat: (beatId: string, name: string) => void;
  onRemoveBeat: (beatId: string) => void;
  onSelectTrack: (trackId: string) => void;
  onRenameTrack: (trackId: string, name: string) => void;
  onRemoveTrack: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onAddTrack: (name: string, instrument: string) => Promise<void>;
}

const INSTRUMENTS = ["DRUMS", "BASS", "SYNTH", "PIANO", "GUITAR", "STRINGS"];
const mixerButton =
  "rounded border px-1.5 py-0.5 text-[0.62rem] font-bold transition-colors duration-150 cursor-pointer " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/** Beat and lane navigation. Form state stays local because no other feature needs it. */
export function BeatBrowserSidebar(props: BeatBrowserSidebarProps) {
  const {
    beats,
    selectedBeat,
    selectedBeatId,
    tracks,
    selectedTrackId,
    peers,
    muted,
    soloed,
    canEdit,
    onAddBeat,
    onSelectBeat,
    onRenameBeat,
    onRemoveBeat,
    onSelectTrack,
    onRenameTrack,
    onRemoveTrack,
    onToggleMute,
    onToggleSolo,
    onAddTrack,
  } = props;
  const [trackName, setTrackName] = useState("");
  const [instrument, setInstrument] = useState("DRUMS");

  async function submitTrack(event: React.FormEvent) {
    event.preventDefault();
    await onAddTrack(trackName, instrument);
    setTrackName("");
  }

  return (
    <>
      <SidebarSection
        title="Beats"
        action={
          canEdit ? (
            <IconButton onClick={onAddBeat} title="New beat">
              +
            </IconButton>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-1">
          {beats.length === 0 && (
            <p className="text-xs text-muted">A beat is a full multi-instrument groove. Create one to start.</p>
          )}
          {beats.map((beat) => (
            <div
              key={beat.id}
              className={
                "group flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition-colors duration-150 " +
                (beat.id === selectedBeatId
                  ? "border-accent bg-accent/15 text-text"
                  : "border-edge bg-bg-soft text-muted hover:border-edge-strong hover:text-text")
              }
              onClick={() =>
                onSelectBeat(
                  beat.id,
                  [...beat.tracks].sort((left, right) => left.position - right.position)[0]?.id ?? null,
                )
              }
            >
              <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: beatColor(beat.position) }} />
              <strong className="min-w-0 flex-1 truncate font-semibold">
                {canEdit ? (
                  <EditableName value={beat.name} onRename={(name) => onRenameBeat(beat.id, name)} />
                ) : (
                  beat.name
                )}
              </strong>
              <PeerDots list={Object.values(peers).filter((peer) => peer.beatId === beat.id)} where={beat.name} />
              <span className="shrink-0 text-[0.6rem] tabular-nums">
                {beat.bars} bar{beat.bars > 1 ? "s" : ""}
              </span>
              {canEdit && (
                <button
                  className="shrink-0 rounded text-muted opacity-0 transition-opacity hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 group-hover:opacity-100"
                  title="Delete beat (removes its lanes and timeline clips)"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveBeat(beat.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </SidebarSection>

      {selectedBeat && (
        <SidebarSection title={`${selectedBeat.name} · lanes`}>
          <div className="flex flex-col gap-1">
            {tracks.length === 0 && (
              <p className="text-xs text-muted">No lanes yet — add drums below, then draw a kick in the roll.</p>
            )}
            {tracks.map((track) => {
              const isMuted = muted.has(track.id);
              const isSolo = soloed.has(track.id);
              return (
                <div
                  key={track.id}
                  className={
                    "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors duration-150 " +
                    (track.id === selectedTrackId
                      ? "border-edge-strong bg-surface-2 text-text"
                      : "border-edge bg-bg-soft text-muted hover:border-edge-strong")
                  }
                  onClick={() => onSelectTrack(track.id)}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorFor(track.instrument) }} />
                  <strong className="min-w-0 flex-1 truncate font-semibold">
                    {canEdit ? (
                      <EditableName value={track.name} onRename={(name) => onRenameTrack(track.id, name)} />
                    ) : (
                      track.name
                    )}
                  </strong>
                  <PeerDots list={Object.values(peers).filter((peer) => peer.trackId === track.id)} where={track.name} />
                  <button
                    className={
                      mixerButton +
                      (isMuted
                        ? " border-danger bg-danger text-bg"
                        : " border-edge text-muted hover:border-edge-strong")
                    }
                    title="Mute"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleMute(track.id);
                    }}
                  >
                    M
                  </button>
                  <button
                    className={
                      mixerButton +
                      (isSolo
                        ? " border-solo bg-solo text-bg"
                        : " border-edge text-muted hover:border-edge-strong")
                    }
                    title="Solo"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleSolo(track.id);
                    }}
                  >
                    S
                  </button>
                  {canEdit && (
                    <button
                      className="shrink-0 rounded px-0.5 text-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                      title="Delete lane"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveTrack(track.id);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {canEdit && (
            <form onSubmit={(event) => void submitTrack(event)} className="mt-2 flex flex-col gap-2">
              <TextInput
                className="!py-1 text-xs"
                value={trackName}
                onChange={(event) => setTrackName(event.target.value)}
                placeholder="808 Kick"
                required
                maxLength={80}
              />
              <div className="flex gap-2">
                <Select
                  className="!py-1 text-xs"
                  value={instrument}
                  onChange={(event) => setInstrument(event.target.value)}
                >
                  {INSTRUMENTS.map((value) => (
                    <option key={value} value={value}>
                      {value.toLowerCase()}
                    </option>
                  ))}
                </Select>
                <Button type="submit" size="sm">Add</Button>
              </div>
            </form>
          )}
        </SidebarSection>
      )}
    </>
  );
}
