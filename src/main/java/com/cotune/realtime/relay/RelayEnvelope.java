package com.cotune.realtime.relay;

import com.cotune.realtime.dto.ChatEvent;
import com.cotune.realtime.dto.NoteEvent;
import com.cotune.realtime.dto.PresenceEvent;
import com.cotune.realtime.dto.RealtimeEvent;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * What actually travels over Redis.
 *
 * A STOMP message is (destination, payload). Redis PUBLISH is (channel, bytes) —
 * it has no concept of a destination, so if we published the bare event the
 * receiving instance would hold a NoteEvent and have no idea which topic to fan
 * it out to. The envelope carries the address alongside the letter. That is the
 * whole job.
 *
 * NOTE WHAT IS *NOT* IN HERE: an originating-instance id. Leaving it out is a
 * decision, not an oversight — see RedisBroadcaster for why adding one is the
 * fast way to break this.
 */
public record RelayEnvelope(String destination, Kind kind, JsonNode payload) {

    /**
     * Which concrete event `payload` is. A closed enum, not a class name, because
     * a class name on a wire is an instruction to load arbitrary classes — see
     * RealtimeEvent. The cost of the safe version is exactly one switch.
     */
    public enum Kind {
        NOTE, PRESENCE, CHAT
    }

    public static RelayEnvelope of(String destination, RealtimeEvent event, ObjectMapper json) {
        // Exhaustive over a sealed type: no default branch, and none is possible.
        // Add a third RealtimeEvent and this line is a compile error — which is
        // the entire reason RealtimeEvent is sealed. (Chat was exactly that
        // third event, and this switch refusing to compile is what carried it
        // across the relay on the first try.)
        Kind kind = switch (event) {
            case NoteEvent ignored -> Kind.NOTE;
            case PresenceEvent ignored -> Kind.PRESENCE;
            case ChatEvent ignored -> Kind.CHAT;
        };
        return new RelayEnvelope(destination, kind, json.valueToTree(event));
    }

    /**
     * Rebuild the event on the far side.
     *
     * The payload stays a JsonNode in transit rather than being parsed eagerly:
     * an instance that receives an event for a song nobody here is watching does
     * a map lookup, finds no local subscribers, and drops it. Parsing it into a
     * NoteEvent first would be work done purely to throw away — and at N
     * instances, EVERY instance sees EVERY message, so that waste is multiplied
     * by N.
     */
    public RealtimeEvent decode(ObjectMapper json) throws JsonProcessingException {
        Class<? extends RealtimeEvent> type = switch (kind) {
            case NOTE -> NoteEvent.class;
            case PRESENCE -> PresenceEvent.class;
            case CHAT -> ChatEvent.class;
        };
        return json.treeToValue(payload, type);
    }
}
