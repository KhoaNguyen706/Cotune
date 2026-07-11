package com.cotune.realtime;

/**
 * Presence — "who else is in this song, and where is their cursor".
 *
 * NOTE WHAT IS MISSING FROM THE SERVER: a session registry. Nothing here
 * remembers who is connected. The server relays presence and forgets it; each
 * CLIENT keeps its own list of peers and expires anyone it hasn't heard from in
 * a few seconds.
 *
 * That is a deliberate trade, and it is the one that survives the next session.
 * A server-side registry would be a pile of mutable state (a map of song → set
 * of sessions, kept in sync with SessionConnected/SessionDisconnect events,
 * leaking an entry every time a laptop lid closes without a clean DISCONNECT) —
 * and the moment there are two backend instances it would be WRONG, because each
 * instance can only see its own half of the room. A heartbeat that peers expire
 * locally has neither problem: it is stateless, self-healing, and identical on
 * one instance or ten.
 *
 * The cost is honesty about timing: a peer who unplugs their network cable
 * lingers on your screen for a few seconds before fading. For "is Bob in here
 * with me", that is a fine answer.
 */
public enum PresenceKind {

    /** "I just arrived." Peers reply with their own CURSOR so the newcomer sees
     *  the room immediately instead of waiting for the next heartbeat. */
    HELLO,

    /** "I am here, and my cursor is at this cell." Also serves as the heartbeat
     *  — one message type, two jobs, so there is no way for a client to be
     *  present but invisible. */
    CURSOR,

    /** "I am leaving." A courtesy, not a guarantee: a crashed tab never sends
     *  it, which is exactly why expiry cannot depend on it. */
    BYE
}
