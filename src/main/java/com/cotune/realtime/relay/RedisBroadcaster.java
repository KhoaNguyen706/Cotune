package com.cotune.realtime.relay;

import com.cotune.realtime.dto.RealtimeEvent;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * Many instances: don't deliver the event — PUBLISH it, and let every instance
 * deliver its own copy. RelaySubscriber is the other half.
 *
 * THE ONE THING TO UNDERSTAND IN THIS CLASS: there is no convertAndSend here.
 *
 * The obvious implementation is "send it to my own subscribers, AND publish it
 * so the other instances can send it to theirs". It is wrong, and it is wrong in
 * a way that is genuinely hard to debug, so it is worth spelling out. This
 * instance is subscribed to the channel too. It cannot NOT be — it is one of the
 * instances. So it receives its own PUBLISH back, and RelaySubscriber dutifully
 * delivers it. Every client connected here gets the note TWICE: once from the
 * direct send, once from the loopback. On a beat grid, a duplicated NOTE_ADD is
 * invisible (it is idempotent — it lands on the same cell). A duplicated cursor
 * frame is invisible too. So the bug ships. Then somebody adds an event that is
 * NOT idempotent — an undo, a "shift everything one bar right" — and it applies
 * twice, on one instance, only when Redis is enabled. Good luck.
 *
 * The fix is not to detect the loopback and skip it. That is the SECOND obvious
 * implementation: stamp an instance id on the envelope, ignore your own. It also
 * works, and it is worse, because it means the message that reaches a local
 * client and the message that reaches a remote client travelled two different
 * code paths — so they can drift, and the local path is the one your tests
 * exercise.
 *
 * The fix is to have exactly ONE delivery path: Redis. Everybody's message,
 * including your own, arrives the same way — off the channel, in RelaySubscriber.
 * The loopback is not a problem to be suppressed; it is the mechanism. Local
 * clients pay one Redis round trip (sub-millisecond on the same network) for the
 * guarantee that there is only one way for a message to reach a browser, and it
 * is the way every test covers.
 */
@Component
@ConditionalOnProperty(name = "cotune.realtime.relay", havingValue = "redis")
public class RedisBroadcaster implements RealtimeBroadcaster {

    private final StringRedisTemplate redis;
    private final ObjectMapper json;
    private final String channel;

    public RedisBroadcaster(StringRedisTemplate redis,
                            ObjectMapper json,
                            @Value("${cotune.realtime.channel}") String channel) {
        this.redis = redis;
        this.json = json;
        this.channel = channel;
    }

    @Override
    public void broadcast(String destination, RealtimeEvent event) {
        RelayEnvelope envelope = RelayEnvelope.of(destination, event, json);
        try {
            // NAME COLLISION WORTH NOTICING: this convertAndSend is Redis PUBLISH.
            // SimpMessagingTemplate.convertAndSend — same method name, one import
            // away — is a STOMP send. Two totally different verbs, and the compiler
            // will happily let you call the wrong one on the wrong template.
            redis.convertAndSend(channel, json.writeValueAsString(envelope));
        } catch (JsonProcessingException e) {
            // An event we cannot serialize is a programming error (a record we
            // added a non-serializable field to), not a runtime condition, so it
            // is unchecked. It surfaces on the sender's private error queue via
            // RealtimeController's @MessageExceptionHandler rather than vanishing.
            throw new IllegalStateException("Cannot serialize realtime event for relay: " + event, e);
        }
    }
}
