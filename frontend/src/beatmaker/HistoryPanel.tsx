import type { SongEvent } from "../types";
import { Button, EmptyState, ErrorBanner, Skeleton } from "../ui/kit";
import { Modal } from "../ui/shell";
import { ClockIcon } from "../ui/icons";

interface HistoryPanelProps {
  /** null = still loading. */
  entries: SongEvent[] | null;
  error: string | null;
  canEdit: boolean;
  /** The entry currently being restored (its Restore button spins). */
  restoringId: string | null;
  onRestore: (entry: SongEvent) => void;
  onClose: () => void;
}

/**
 * "Who deleted my bassline and when — and give it back."
 *
 * The list is the log, verbatim; the ONE action is per-lane restore, which
 * asks the server to REPLAY the lane to that moment and lands the result
 * as an ordinary undoable edit. Nothing here mutates history: the past is
 * read-only, and un-restoring is Ctrl+Z like any other edit you regret.
 */
export function HistoryPanel({
  entries,
  error,
  canEdit,
  restoringId,
  onRestore,
  onClose,
}: HistoryPanelProps) {
  return (
    <Modal title="Song history" onClose={onClose}>
      {error ? (
        <ErrorBanner>{error}</ErrorBanner>
      ) : entries === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<ClockIcon className="h-9 w-9 text-muted" />}
          title="No history yet"
          hint="Every note added, moved or removed lands here — with who did it and when."
        />
      ) : (
        <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto pr-1">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 rounded-md border border-edge bg-surface-2/40 px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  <strong>{entry.actorName ?? "Before history began"}</strong>{" "}
                  {entry.actorName ? entry.summary : `— ${entry.summary}`}
                </span>
                <span className="block text-[0.68rem] text-muted">
                  {entry.trackName ?? "a deleted lane"} ·{" "}
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </span>
              {canEdit && entry.trackName && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={restoringId !== null}
                  title={`Put ${entry.trackName} back the way it was right after this change — undoable with Ctrl+Z`}
                  onClick={() => onRestore(entry)}
                >
                  {restoringId === entry.id ? "Restoring…" : "Restore"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
