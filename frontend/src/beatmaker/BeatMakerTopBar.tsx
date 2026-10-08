import { Link } from "react-router-dom";
import type { Beat, Song } from "../types";
import { peerColor, type Peer } from "../realtime/socket";
import { Button, EditableName } from "../ui/kit";
import { IconButton, Readout, ToolGroup, TopBar } from "../ui/shell";
import {
  BackIcon,
  ChatIcon,
  ClockIcon,
  LoopIcon,
  MetronomeIcon,
  MenuIcon,
  PlayIcon,
  RedoIcon,
  SlidersIcon,
  StopIcon,
  UndoIcon,
  VolumeIcon,
} from "../ui/icons";

const ICON = "h-[18px] w-[18px]";

export type EditorMode = "arrange" | "beats";

interface BeatMakerTopBarProps {
  song: Pick<Song, "title" | "bpm" | "timeSignature">;
  beats: Beat[];
  peers: Record<string, Peer>;
  mode: EditorMode;
  canEdit: boolean;
  readOnly: boolean;
  live: boolean;
  autoSave: boolean;
  saving: boolean;
  dirtyCount: number;
  sidebarCollapsed: boolean;
  playing: boolean;
  /** Is there anything to hear? False = Play (and export) are disabled,
   *  with a tooltip that says what to add. */
  canPlay: boolean;
  metronome: boolean;
  onToggleMetronome: () => void;
  /** Arrangement loop — the button only exists in the Arrange view; the
   *  Beats view always loops the beat you are editing. */
  loopOn: boolean;
  onToggleLoop: () => void;
  historyPast: number;
  historyFuture: number;
  volume: number;
  exporting: boolean;
  chatOpen: boolean;
  chatUnread: number;
  onToggleSidebar: () => void;
  onRenameSong: (title: string) => void;
  onChangeBpm: (value: string) => void;
  onChangeTimeSignature: (value: string) => void;
  onModeChange: (mode: EditorMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onTogglePlay: () => void;
  onVolumeChange: (volume: number) => void;
  onSave: () => void;
  onExport: (format: "wav" | "mp3") => void;
  onToggleChat: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}

function peerLocation(peer: Peer, beats: Beat[]): string {
  const beat = beats.find((candidate) => candidate.id === peer.beatId);
  const track = beat?.tracks.find((candidate) => candidate.id === peer.trackId);
  if (beat && track) return `${beat.name}, ${track.name}`;
  if (beat) return beat.name;
  return "elsewhere in this song";
}

/**
 * The faceplate: the strip across the top of the machine.
 *
 * Left is WHAT this is (the song, set wide like a model name, and who is in
 * it); the middle is the transport, the one cluster your hands live on; the
 * right is the output and the panels you open now and then. Shared editor
 * chrome — it knows how controls look, not how songs are saved or played.
 */
export function BeatMakerTopBar(props: BeatMakerTopBarProps) {
  const {
    song,
    beats,
    peers,
    mode,
    canEdit,
    readOnly,
    live,
    autoSave,
    saving,
    dirtyCount,
    sidebarCollapsed,
    playing,
    canPlay,
    metronome,
    onToggleMetronome,
    loopOn,
    onToggleLoop,
    historyPast,
    historyFuture,
    volume,
    exporting,
    chatOpen,
    chatUnread,
    onToggleSidebar,
    onRenameSong,
    onChangeBpm,
    onChangeTimeSignature,
    onModeChange,
    onUndo,
    onRedo,
    onTogglePlay,
    onVolumeChange,
    onSave,
    onExport,
    onToggleChat,
    onOpenHistory,
    onOpenSettings,
  } = props;

  // "Beat", singular, in the label: you edit one beat at a time, and the
  // tab is named for what is under it. The title keeps the old wording
  // ("Build the beats") because it is also what the smoke test presses.
  const tab = (id: EditorMode, label: string) => (
    <IconButton
      active={mode === id}
      aria-pressed={mode === id}
      className="px-3"
      onClick={() => onModeChange(id)}
      title={id === "arrange" ? "Arrange the song timeline" : "Build the beats"}
    >
      {label}
    </IconButton>
  );

  const saveStatus = readOnly
    ? "View only: you can play this song but not change it"
    : saving
      ? "Saving…"
      : dirtyCount > 0
        ? autoSave || live
          ? `${dirtyCount} unsaved, saving shortly`
          : `${dirtyCount} unsaved`
        : "All changes saved";

  return (
    <TopBar
      left={
        <>
          <Link
            to="/songs"
            title="Back to songs"
            aria-label="Back to songs"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-bg-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent pointer-coarse:h-11 pointer-coarse:w-11"
          >
            <BackIcon className={ICON} />
          </Link>
          {/* The panel only exists in Arrange (the palette). The Beat view
              has no side panel to hide: its lanes are the console below. */}
          {mode === "arrange" && (
            <IconButton
              onClick={onToggleSidebar}
              active={!sidebarCollapsed}
              aria-pressed={!sidebarCollapsed}
              title={sidebarCollapsed ? "Show the palette" : "Hide the palette"}
            >
              <MenuIcon className={ICON} />
            </IconButton>
          )}
          {/* Capped on phones, where the bar no longer shrinks to fit: a
              long title would otherwise push the transport off screen. */}
          <div className="min-w-0 max-md:max-w-36">
            <h1 className="truncate text-lg font-extrabold leading-tight font-stretch-semi-expanded">
              {canEdit ? (
                <EditableName value={song.title} maxLength={120} onRename={onRenameSong} />
              ) : (
                song.title
              )}
            </h1>
            <div className="flex items-center gap-2 text-xs text-muted">
              {/* Filled dot = connected, hollow = not: the state is in the
                  SHAPE and the word, never in a color alone. */}
              <span
                data-testid="socket-status"
                title={
                  live
                    ? "Live: collaborators see your edits as you make them"
                    : "Offline: edits are saved, but not shared live"
                }
                className={`inline-flex shrink-0 items-center gap-1 font-semibold ${live ? "text-text" : "text-muted"}`}
              >
                <i
                  aria-hidden
                  className={`h-2 w-2 rounded-full border-[1.5px] ${live ? "border-text bg-text" : "border-muted"}`}
                />
                {live ? "Live" : "Offline"}
              </span>
              <span className="truncate">{saveStatus}</span>
            </div>
          </div>
          {Object.keys(peers).length > 0 && (
            <div className="flex shrink-0 -space-x-1.5" aria-label="In this song now">
              {Object.values(peers).map((peer) => (
                <span
                  key={peer.userId}
                  title={`${peer.displayName}, ${peerLocation(peer, beats)}`}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[0.7rem] font-bold text-white ring-2 ring-surface"
                  style={{ background: peerColor(peer.userId) }}
                >
                  {peer.displayName[0]?.toUpperCase() ?? "?"}
                </span>
              ))}
            </div>
          )}
        </>
      }
      center={
        <>
          <ToolGroup>
            {tab("arrange", "Arrange")}
            {tab("beats", "Beat")}
          </ToolGroup>
          <ToolGroup>
            <IconButton onClick={onUndo} disabled={historyPast === 0} title="Undo (Ctrl+Z)" aria-label="Undo">
              <UndoIcon className={ICON} />
            </IconButton>
            <IconButton onClick={onRedo} disabled={historyFuture === 0} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
              <RedoIcon className={ICON} />
            </IconButton>
            <IconButton
              tone="solid"
              className="min-w-20"
              onClick={onTogglePlay}
              disabled={!playing && !canPlay}
              title={
                canPlay || playing
                  ? mode === "arrange"
                    ? "Play the arrangement (Space)"
                    : "Loop the selected beat (Space)"
                  : mode === "arrange"
                    ? "Nothing on the timeline yet: place a beat to play it"
                    : "This beat has no notes yet: click the grid to add some"
              }
            >
              {playing ? <StopIcon className={ICON} /> : <PlayIcon className={ICON} />}
              {playing ? "Stop" : "Play"}
            </IconButton>
            {mode === "arrange" && (
              <IconButton
                active={loopOn}
                aria-pressed={loopOn}
                aria-label="Loop"
                onClick={onToggleLoop}
                title={loopOn ? "Loop on: drag on the ruler to change the range (L)" : "Loop a range of bars (L)"}
              >
                <LoopIcon className={ICON} />
              </IconButton>
            )}
            <IconButton
              active={metronome}
              aria-pressed={metronome}
              aria-label="Metronome"
              onClick={onToggleMetronome}
              title={metronome ? "Metronome on (M)" : "Metronome (M)"}
            >
              <MetronomeIcon className={ICON} />
            </IconButton>
          </ToolGroup>
          <div className="flex items-center">
            <Readout label="BPM">
              {canEdit ? (
                <EditableName value={String(song.bpm)} maxLength={3} onRename={onChangeBpm} />
              ) : (
                song.bpm
              )}
            </Readout>
            <Readout label="Time">
              {canEdit ? (
                <EditableName value={song.timeSignature} maxLength={5} onRename={onChangeTimeSignature} />
              ) : (
                song.timeSignature
              )}
            </Readout>
          </div>
        </>
      }
      right={
        <>
          {/* Not on phones: they have a volume rocker, and the bar has no
              width to spare. */}
          <label className="flex items-center gap-2 px-1 max-md:hidden" title="Master volume">
            <VolumeIcon className={`${ICON} shrink-0 text-muted`} />
            <span className="sr-only">Master volume</span>
            <input
              type="range"
              className="w-24"
              min={0}
              max={100}
              value={volume}
              onChange={(event) => onVolumeChange(Number(event.target.value))}
            />
          </label>
          {!readOnly && !autoSave && (
            <Button variant="ghost" size="sm" onClick={onSave} disabled={saving || dirtyCount === 0}>
              {saving ? "Saving…" : dirtyCount > 0 ? `Save ${dirtyCount}` : "Saved"}
            </Button>
          )}
          {mode === "arrange" && (
            <ToolGroup>
              <IconButton onClick={() => onExport("wav")} disabled={exporting || !canPlay} title="Render the arrangement to a WAV file (lossless)">
                {exporting ? "…" : "WAV"}
              </IconButton>
              <IconButton onClick={() => onExport("mp3")} disabled={exporting || !canPlay} title="Render the arrangement to an MP3 file (192 kbps)">
                {exporting ? "…" : "MP3"}
              </IconButton>
            </ToolGroup>
          )}
          <span className="relative">
            <IconButton
              active={chatOpen}
              aria-pressed={chatOpen}
              aria-label="Chat"
              onClick={onToggleChat}
              title={chatOpen ? "Close chat" : "Chat with everyone in this song"}
            >
              <ChatIcon className={ICON} />
            </IconButton>
            {!chatOpen && chatUnread > 0 && (
              <span
                className="pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.6rem] font-bold text-bg-soft tabular-nums"
                data-testid="chat-unread"
              >
                {chatUnread > 9 ? "9+" : chatUnread}
              </span>
            )}
          </span>
          <IconButton onClick={onOpenHistory} aria-label="History" title="History: who changed what, and restore a lane to any moment">
            <ClockIcon className={ICON} />
          </IconButton>
          <IconButton onClick={onOpenSettings} aria-label="Settings" title="Settings">
            <SlidersIcon className={ICON} />
          </IconButton>
        </>
      }
    />
  );
}
