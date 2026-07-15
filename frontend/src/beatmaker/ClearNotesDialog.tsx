import type { Beat, Track } from "../types";
import type { Peer } from "../realtime/socket";
import { Button } from "../ui/kit";
import { Modal } from "../ui/shell";

export type ClearScope = "lane" | "beat";

interface ClearNotesDialogProps {
  scope: ClearScope;
  beat: Beat;
  track: Track | null;
  laneNoteCount: number;
  beatNoteCount: number;
  peers: Record<string, Peer>;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation for a destructive collaborative edit. */
export function ClearNotesDialog({
  scope,
  beat,
  track,
  laneNoteCount,
  beatNoteCount,
  peers,
  onCancel,
  onConfirm,
}: ClearNotesDialogProps) {
  const count = scope === "lane" ? laneNoteCount : beatNoteCount;
  const collaborators = Object.values(peers);

  return (
    <Modal title={scope === "lane" ? `Clear the ${track?.name} lane?` : `Clear ${beat.name}?`} onClose={onCancel}>
      <p className="text-sm text-muted">
        {scope === "lane" ? (
          <>
            This deletes all <strong className="text-text">{count}</strong> note{count === 1 ? "" : "s"} in{" "}
            <strong className="text-text">{track?.name}</strong>. Other lanes are untouched.
          </>
        ) : (
          <>
            This deletes all <strong className="text-text">{count}</strong> note{count === 1 ? "" : "s"} across
            every lane in <strong className="text-text">{beat.name}</strong>.
          </>
        )}{" "}
        {collaborators.length > 0 && (
          <>
            <strong className="text-text">{collaborators.map((peer) => peer.displayName).join(" and ")}</strong>{" "}
            {collaborators.length === 1 ? "is" : "are"} in this song right now and will see it happen.{" "}
          </>
        )}
        You can undo with Ctrl+Z.
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>
          {scope === "lane" ? "Clear lane" : "Clear beat"}
        </Button>
      </div>
    </Modal>
  );
}
