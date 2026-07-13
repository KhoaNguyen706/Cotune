package com.cotune.realtime.dto;

/**
 * Everything the server broadcasts to a room. A marker, with teeth.
 *
 * WHY SEALED, and why this is not ceremony: the relay has to turn an event back
 * into a Java object on the far side of Redis, which means SOMETHING has to map
 * "this JSON" to "this class". The lazy way is to put the class name in the
 * message and Class.forName() it on receipt — which is a deserialization gadget
 * handed to anyone who can write to the channel, and the exact shape of half the
 * RCEs in the JVM ecosystem. So the relay switches over a closed set instead.
 *
 * "Closed" is what `sealed` buys. RelayEnvelope switches over this type with no
 * default branch, so the day somebody adds a third event, the relay STOPS
 * COMPILING until they teach it how to carry one. The alternative — an
 * open interface and a default branch — compiles perfectly and silently drops
 * the new event on the floor for every collaborator on another instance. That
 * bug would present as "chat works but reactions don't, sometimes", and you
 * would look for it in the WebSocket layer for a day.
 *
 * Deliberately carries NO Jackson annotations. @JsonTypeInfo would have worked
 * for the relay, but these records are also the wire format sent to BROWSERS —
 * so it would inject a discriminator field into every payload the frontend
 * receives, to solve a problem the frontend does not have. The type tag belongs
 * on the envelope that needs it, not on the letter inside.
 */
public sealed interface RealtimeEvent permits NoteEvent, PresenceEvent {
}
