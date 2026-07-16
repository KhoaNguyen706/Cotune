import { Link } from "react-router-dom";
import type { Beat, Song } from "../types";
import { peerColor, type Peer } from "../realtime/socket";
import { Button, EditableName } from "../ui/kit";
import { IconButton, Readout, ToolGroup, TopBar } from "../ui/shell";

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
  onTestSound: () => void;
  onSave: () => void;
  onExport: (format: "wav" | "mp3") => void;
  onToggleChat: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}

function peerLocation(peer: Peer, beats: Beat[]): string {
  const beat = beats.find((candidate) => candidate.id === peer.beatId);
  const track = beat?.tracks.find((candidate) => candidate.id === peer.trackId);
  if (beat && track) return `${beat.name} · ${track.name}`;
  if (beat) return beat.name;
  return "elsewhere in this song";
}

/** Shared editor chrome. It knows how controls look, but not how songs are saved or played. */
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
    onTestSound,
    onSave,
    onExport,
    onToggleChat,
    onOpenHistory,
    onOpenSettings,
  } = props;

  const tab = (id: EditorMode, label: string) => (
    <IconButton
      active={mode === id}
      className="px-3"
      onClick={() => onModeChange(id)}
      title={id === "arrange" ? "Arrange the song timeline" : "Build the beats"}
    >
      {label}
    </IconButton>
  );

  return (
    <TopBar
      left={
        <>
          <Link
            to="/songs"
            title="Back to songs"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            ←
          </Link>
          <IconButton
            onClick={onToggleSidebar}
            active={!sidebarCollapsed}
            title={sidebarCollapsed ? "Show panel" : "Hide panel"}
          >
            ☰
          </IconButton>
          <span className="min-w-0">
            <h1 className="flex items-center gap-2 truncate text-base font-bold leading-tight tracking-tight">
              {canEdit ? (
                <EditableName value={song.title} maxLength={120} onRename={onRenameSong} />
              ) : (
                song.title
              )}
              <span
                data-testid="socket-status"
                title={
                  live
                    ? "Live — collaborators see your edits as you make them"
                    : "Offline — edits are saved, but not shared live"
                }
                className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wider ${
                  live
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-edge bg-surface-2 text-muted"
                }`}
              >
                <i className={`h-1.5 w-1.5 rounded-full ${live ? "bg-accent" : "bg-muted"}`} aria-hidden />
                {live ? "live" : "offline"}
              </span>
              {Object.values(peers).map((peer) => (
                <span
                  key={peer.userId}
                  title={`${peer.displayName} — ${peerLocation(peer, beats)}`}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold text-bg ring-2 ring-bg"
                  style={{ background: peerColor(peer.userId) }}
                >
                  {peer.displayName[0]?.toUpperCase() ?? "?"}
                </span>
              ))}
            </h1>
            <span className="text-[0.68rem] text-muted">
              {readOnly
                ? "Read-only — you were invited to view this song"
                : saving
                  ? "Saving…"
                  : dirtyCount > 0
                    ? autoSave || live
                      ? `${dirtyCount} unsaved · saving shortly`
                      : `${dirtyCount} unsaved`
                    : "All changes saved"}
            </span>
          </span>
        </>
      }
      center={
        <>
          <ToolGroup>
            {tab("arrange", "Arrange")}
            {tab("beats", "Beats")}
          </ToolGroup>
          <ToolGroup>
            <IconButton onClick={onUndo} disabled={historyPast === 0} title="Undo (Ctrl+Z)">
              ↺
            </IconButton>
            <IconButton onClick={onRedo} disabled={historyFuture === 0} title="Redo (Ctrl+Shift+Z)">
              ↻
            </IconButton>
            <IconButton
              tone="solid"
              className="min-w-16"
              onClick={onTogglePlay}
              title={mode === "arrange" ? "Play the arrangement (Space)" : "Loop the selected beat (Space)"}
            >
              {playing ? "■ Stop" : "▶ Play"}
            </IconButton>
          </ToolGroup>
          <ToolGroup>
            <Readout label="BPM">
              {canEdit ? (
                <EditableName value={String(song.bpm)} maxLength={3} onRename={onChangeBpm} />
              ) : (
                song.bpm
              )}
            </Readout>
            <Readout label="Sig">
              {canEdit ? (
                <EditableName value={song.timeSignature} maxLength={5} onRename={onChangeTimeSignature} />
              ) : (
                song.timeSignature
              )}
            </Readout>
          </ToolGroup>
        </>
      }
      right={
        <>
          <ToolGroup>
            <label className="flex items-center gap-2 px-2" title="Master volume">
              <span aria-hidden className="text-xs">🔊</span>
              <input
                type="range"
                className="w-20"
                min={0}
                max={100}
                value={volume}
                onChange={(event) => onVolumeChange(Number(event.target.value))}
              />
            </label>
            <IconButton onClick={onTestSound} title="Play a test blip — if you can't hear this, check your tab/OS volume">
              🎧
            </IconButton>
          </ToolGroup>
          {!readOnly && !autoSave && (
            <Button variant="ghost" size="sm" onClick={onSave} disabled={saving || dirtyCount === 0}>
              {saving ? "Saving…" : dirtyCount > 0 ? `Save ${dirtyCount}` : "Saved"}
            </Button>
          )}
          {mode === "arrange" && (
            <ToolGroup>
              <IconButton onClick={() => onExport("wav")} disabled={exporting} title="Render the arrangement to a WAV file (lossless)">
                {exporting ? "…" : "WAV"}
              </IconButton>
              <IconButton onClick={() => onExport("mp3")} disabled={exporting} title="Render the arrangement to an MP3 file (192 kbps)">
                {exporting ? "…" : "MP3"}
              </IconButton>
            </ToolGroup>
          )}
          <span className="relative">
            <IconButton active={chatOpen} onClick={onToggleChat} title={chatOpen ? "Close chat" : "Chat with everyone in this song"}>
              💬
            </IconButton>
            {!chatOpen && chatUnread > 0 && (
              <span
                className="pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.6rem] font-bold text-bg"
                data-testid="chat-unread"
              >
                {chatUnread > 9 ? "9+" : chatUnread}
              </span>
            )}
          </span>
          <IconButton onClick={onOpenHistory} title="History — who changed what, and restore a lane to any moment">
            🕘
          </IconButton>
          <IconButton onClick={onOpenSettings} title="Settings">⚙</IconButton>
        </>
      }
    />
  );
}
