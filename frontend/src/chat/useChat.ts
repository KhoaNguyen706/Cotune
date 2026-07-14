import { useCallback, useEffect, useRef, useState } from "react";
import { gql } from "../api/client";
import type { ChatMessage } from "../realtime/socket";

const CHAT_HISTORY = `
  query Chat($songId: ID!) {
    chatMessages(songId: $songId) { id songId authorId authorName body createdAt }
  }
`;

/** More than the server's history page, comfortably less than "the tab
 *  leaks memory during an all-day session". */
const LOCAL_CAP = 200;

export interface Chat {
  /** Oldest first — reading order, straight onto the screen. */
  messages: ChatMessage[];
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Lines that arrived while the panel was closed. Drives the badge. */
  unread: number;
  /** Wire into useRealtime's onChat. Referentially stable, because the
   *  socket effect depends on it — an unstable handler reconnects the
   *  socket every render. */
  receive: (message: ChatMessage) => void;
}

/**
 * The conversation's state: history + live stream, merged.
 *
 * The subscription opens BEFORE the history query returns (the socket and
 * the HTTP query race), so a message can arrive live and then arrive again
 * inside the history page. Merging by id makes the race unobservable —
 * and it is also why sending renders nothing optimistically: the echo,
 * carrying the server's id, is the single source of "this line exists".
 */
export function useChat(params: {
  songId: string | undefined;
  /** The song's id once loaded — the same gate the socket waits behind. */
  loadedSongId: string | undefined;
}): Chat {
  const { songId, loadedSongId } = params;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [open, setOpenState] = useState(false);
  const [unread, setUnread] = useState(0);
  // The receive callback must stay stable (see interface note), so it reads
  // the panel's openness through a ref rather than closing over state.
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!songId || !loadedSongId) return;
    setMessages([]); // navigated to a different song: that room's words stay there
    let cancelled = false;
    void gql<{ chatMessages: ChatMessage[] }>(CHAT_HISTORY, { songId })
      .then((data) => {
        if (!cancelled) setMessages((live) => merge(data.chatMessages, live));
      })
      .catch(() => {
        // History failing must not take the editor down with it: the panel
        // just opens empty and live lines still arrive over the socket.
      });
    return () => {
      cancelled = true;
    };
  }, [songId, loadedSongId]);

  const receive = useCallback((message: ChatMessage) => {
    setMessages((prev) => merge(prev, [message]));
    if (!openRef.current) setUnread((n) => n + 1);
  }, []);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (next) setUnread(0); // opening the panel is reading it
  }, []);

  return { messages, open, setOpen, unread, receive };
}

/** Union by id, chronological. createdAt is ISO-8601 UTC from one server,
 *  so string comparison IS time comparison; id breaks the same-instant tie
 *  the same way the server's index does. */
function merge(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of a) byId.set(message.id, message);
  for (const message of b) byId.set(message.id, message);
  return [...byId.values()]
    .sort((x, y) =>
      x.createdAt === y.createdAt
        ? x.id.localeCompare(y.id)
        : x.createdAt.localeCompare(y.createdAt),
    )
    .slice(-LOCAL_CAP);
}
