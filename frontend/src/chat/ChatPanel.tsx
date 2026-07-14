import { useEffect, useRef, useState } from "react";
import { peerColor, type ChatMessage } from "../realtime/socket";
import { IconButton } from "../ui/shell";
import { TextInput } from "../ui/kit";

/** Same-author lines closer together than this render as one block —
 *  the grouping every chat UI does so a burst of thoughts reads as one. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * The conversation, docked beside the canvas. Deliberately a dumb view:
 * useChat owns the messages, useRealtime owns the socket — this renders
 * one and calls the other, and could be deleted without either noticing.
 *
 * On phones it overlays from the right instead of narrowing a canvas that
 * has no width to spare (the max-md: variants).
 */
export function ChatPanel({
  messages,
  meId,
  live,
  onSend,
  onClose,
}: {
  messages: ChatMessage[];
  meId: string | undefined;
  /** Socket status. Chat is live-only by design — no HTTP fallback like
   *  the pattern save, because a "sent" message that nobody received yet
   *  is a lie the note path never has to tell. Offline disables the input
   *  and says why. */
  live: boolean;
  onSend: (body: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  // "Pinned" = the reader is at (or near) the newest line, so new arrivals
  // may auto-scroll. Reading old messages must never be yanked away from —
  // the badge on the toggle already says something new arrived.
  const pinnedRef = useRef(true);

  function onScroll() {
    const el = listRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  useEffect(() => {
    const el = listRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !live) return;
    onSend(body);
    // Cleared immediately, rendered never: the line appears when the echo
    // lands, which is the proof it was stored (see useChat).
    setDraft("");
  }

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-l border-edge bg-surface max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:w-[85vw] max-md:max-w-80 max-md:shadow-2xl"
      data-testid="chat-panel"
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-edge px-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Chat</h2>
        <IconButton onClick={onClose} title="Close chat">
          ×
        </IconButton>
      </header>

      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-2">
        {messages.length === 0 && (
          <p className="mt-4 text-center text-xs text-muted">
            Talk about the beat right next to it — everyone in this song can read along.
            <br />
            <br />
            Start a message with <strong className="text-text">@ai</strong> to ask the AI
            mentor how to improve what you&apos;ve built.
          </p>
        )}
        {messages.map((message, index) => {
          const previous = index > 0 ? messages[index - 1] : null;
          const grouped =
            previous != null &&
            previous.authorId === message.authorId &&
            +new Date(message.createdAt) - +new Date(previous.createdAt) < GROUP_WINDOW_MS;
          return (
            <div key={message.id} className={grouped ? "mt-0.5" : "mt-3"}>
              {!grouped && (
                <div className="flex items-baseline gap-2">
                  <strong
                    className="text-xs font-bold"
                    style={{ color: peerColor(message.authorId ?? message.authorName) }}
                  >
                    {message.authorId === meId ? "You" : message.authorName}
                  </strong>
                  <span className="text-[0.6rem] tabular-nums text-muted">
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              )}
              {/* break-words: a pasted URL must wrap, not stretch the panel */}
              <p className="whitespace-pre-wrap break-words text-sm leading-snug">{message.body}</p>
            </div>
          );
        })}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-edge p-2">
        <TextInput
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={live ? "Message the room…" : "Offline — chat needs the live connection"}
          disabled={!live}
          maxLength={1000}
          aria-label="Chat message"
        />
      </form>
    </aside>
  );
}
