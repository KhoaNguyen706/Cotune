package com.cotune.common.metrics;

import com.cotune.realtime.dto.RealtimeEvent;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/**
 * Every custom metric this application emits, named in one place.
 *
 * Boot already gives you a great deal for free — HTTP latency per endpoint, JVM
 * heap and GC, Hikari pool saturation, Tomcat threads. That is the "is the
 * process healthy" half, and none of it needs code. This class is the other
 * half: the handful of numbers that are about COTUNE specifically, which no
 * framework can know to record.
 *
 * WHY A CLASS AND NOT registry.counter(...) AT EACH CALL SITE. A Micrometer
 * meter is identified by its name string, so a typo does not fail — it silently
 * creates a SECOND, near-empty time series next to the real one, and you find
 * out while reading a dashboard that says the number is zero. Centralizing the
 * names means the compiler checks them: call sites call a method, not a string.
 * It also gives the names somewhere to be documented, which matters because a
 * metric with no stated meaning gets interpreted freely by whoever reads the
 * graph six months later.
 *
 * NAMING follows Micrometer's convention — dotted, lowercase, no units in the
 * name (`cotune.realtime.broadcast`, not `cotuneRealtimeBroadcastTotal`). The
 * Prometheus registry translates that to snake_case and appends `_total` for
 * counters on its own, so the name you grep for in a PromQL query is
 * `cotune_realtime_broadcast_total`. Fighting that translation by pre-naming
 * things in Prometheus style produces `cotune_realtime_broadcast_total_total`.
 *
 * CARDINALITY is the one way a metrics change can hurt production: every
 * distinct combination of tag values is a separate stored time series, so a tag
 * carrying a user id or a song id turns one metric into millions and takes the
 * scrape (and eventually the memory) with it. Every tag below is drawn from a
 * closed set — an event type, a relay mode, a two-valued outcome — and that is
 * a rule to keep, not a coincidence. If you ever want per-song numbers, that is
 * a log or a database query, not a label.
 */
@Component
public class CotuneMetrics {

    private final MeterRegistry registry;

    /** The relay mode this instance runs in, resolved once — see broadcast(). */
    private final String relayMode;

    public CotuneMetrics(MeterRegistry registry,
                         org.springframework.core.env.Environment environment) {
        this.registry = registry;
        this.relayMode = environment.getProperty("cotune.realtime.relay", "local");
    }

    /**
     * A realtime event handed to the broadcaster, tagged with the event type
     * and the relay mode that carried it.
     *
     * Called from BOTH broadcaster implementations, at the top of broadcast()
     * before the send — deliberately, so `local` and `redis` produce the same
     * number for the same user activity. That comparability is the point: it
     * makes "did switching on the relay change anything" a question you can
     * answer, and it means the metric measures user behaviour rather than
     * plumbing. (A decorating RealtimeBroadcaster would remove the duplicated
     * line at the cost of a third implementation of the interface and some
     * @ConditionalOnProperty wiring to make it wrap whichever bean exists —
     * not worth it for one call in each of two classes.)
     */
    public void broadcast(RealtimeEvent event) {
        Counter.builder("cotune.realtime.broadcast")
                .description("Realtime events published to a room")
                // A sealed interface of three permitted records, so this tag
                // has exactly three possible values, forever, by compiler
                // enforcement — see RealtimeEvent.
                .tag("type", event.getClass().getSimpleName())
                .tag("relay", relayMode)
                .register(registry)
                .increment();
    }

    /**
     * An event that arrived off the Redis channel and was delivered to this
     * instance's own subscribers. Only ever incremented when the relay is on.
     *
     * WHY THIS IS THE INTERESTING ONE: compared against broadcast() across all
     * instances, it is the only external evidence that the fan-out is actually
     * working. With N instances up, a healthy system delivers roughly N
     * received for every 1 published — every instance gets every message,
     * including the one that sent it (RedisBroadcaster explains why the
     * loopback is the mechanism and not a bug). If that ratio sags toward 1,
     * instances have silently stopped hearing each other and collaboration is
     * broken in the specific way that is invisible on a single dyno: everyone
     * still sees their OWN edits, so nothing looks wrong to the person testing.
     */
    public void relayDelivered() {
        Counter.builder("cotune.realtime.relay.delivered")
                .description("Events received off the relay channel and delivered locally")
                .register(registry)
                .increment();
    }

    /** One AI beat plan returned to a user (the model was called and answered). */
    public void aiPlanProposed() {
        registry.counter("cotune.ai.plan.proposed").increment();
    }

    /**
     * The validator's verdict on one plan: how many tool calls survived
     * server-side re-validation and how many were thrown away.
     *
     * This is the most decision-useful metric in the app. `dropped` rising is
     * the model drifting away from what the domain accepts — a prompt that
     * needs work, or a model version that changed under you — and it is
     * otherwise completely invisible, because a partly-dropped plan still
     * returns a perfectly good-looking beat to the user. Nobody files a bug
     * for the lane they never knew was proposed.
     *
     * Note what is NOT counted anywhere: plans APPLIED. Applying runs through
     * the ordinary edit mutations, and teaching those mutations to recognise an
     * AI-authored edit would put AI-specific code into the exact paths whose
     * innocence is the design's best property (see BeatComposer). The
     * proposed/applied funnel is worth having, but it belongs to the client,
     * which already knows the difference.
     */
    public void aiPlanValidated(int kept, int dropped) {
        registry.counter("cotune.ai.plan.action", "outcome", "kept").increment(kept);
        registry.counter("cotune.ai.plan.action", "outcome", "dropped").increment(dropped);
    }

    /**
     * A write refused because someone else got there first (StaleVersionException).
     *
     * Counted because it is the one error in the system that is not a fault.
     * A steady low rate is optimistic locking doing its job; a spike means
     * either genuine contention worth designing for, or a client that has
     * stopped refreshing its version after a save and is now retrying forever.
     * Those look identical in the logs and different on a graph.
     */
    public void staleVersionConflict() {
        registry.counter("cotune.conflict.stale.version").increment();
    }
}
