package com.cotune.common.metrics;

import com.cotune.realtime.dto.NoteEvent;
import com.cotune.realtime.dto.RealtimeEvent;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The names and tags are the contract, so the names and tags are what this
 * asserts.
 *
 * A Micrometer meter is identified by its name STRING, which means the bug
 * this class exists to catch never throws: a typo silently registers a second,
 * near-empty time series beside the real one, and you discover it while
 * staring at a dashboard that says zero. Nothing else in the suite would
 * notice — the app works perfectly with mis-named metrics.
 *
 * Deliberately a plain unit test on a SimpleMeterRegistry rather than a scrape
 * of the live endpoint. Counters only appear in a Prometheus scrape once
 * incremented, so an integration test asserting on cotune_* meters would pass
 * or fail depending on which other tests ran first in the shared context —
 * green by ordering is worse than no test. What the integration test
 * (MetricsEndpointIntegrationTest) owns is that the endpoint exists and is
 * ADMIN-only; what this owns is that the numbers going into it are the ones
 * intended. The dotted-name → cotune_..._total translation in between is
 * Micrometer's code, not ours, and is not retested here.
 */
class CotuneMetricsTest {

    private final MeterRegistry registry = new SimpleMeterRegistry();

    private CotuneMetrics metrics(String relayMode) {
        return new CotuneMetrics(registry, new MockEnvironment()
                .withProperty("cotune.realtime.relay", relayMode));
    }

    @Test
    void broadcastIsTaggedByEventTypeAndRelayMode() {
        RealtimeEvent event = anyNoteEvent();

        metrics("redis").broadcast(event);

        assertThat(registry.get("cotune.realtime.broadcast")
                .tag("type", "NoteEvent")
                .tag("relay", "redis")
                .counter().count()).isEqualTo(1.0);
    }

    @Test
    void relayModeIsResolvedOnceFromConfiguration() {
        // The tag must reflect THIS instance's configured mode, not a guess
        // per call. Getting it wrong makes local and redis traffic
        // indistinguishable, which defeats the comparison the tag exists for.
        metrics("local").broadcast(anyNoteEvent());

        assertThat(registry.find("cotune.realtime.broadcast").tag("relay", "local").counter())
                .isNotNull();
        assertThat(registry.find("cotune.realtime.broadcast").tag("relay", "redis").counter())
                .isNull();
    }

    @Test
    void validatedPlanRecordsKeptAndDroppedSeparately() {
        // The whole point of this metric is the ratio, so the two outcomes
        // must land on the same meter under different tags — not on two
        // differently-named meters, which no single query could compare.
        metrics("local").aiPlanValidated(5, 2);

        assertThat(registry.get("cotune.ai.plan.action").tag("outcome", "kept")
                .counter().count()).isEqualTo(5.0);
        assertThat(registry.get("cotune.ai.plan.action").tag("outcome", "dropped")
                .counter().count()).isEqualTo(2.0);
    }

    @Test
    void aPlanThatSurvivedIntactRecordsZeroDropped() {
        // increment(0) must still REGISTER the series. If a plan with nothing
        // dropped left the meter absent, "dropped" would only exist on
        // instances that had already seen a bad plan, and a rate() query over
        // it would return nothing rather than zero on a healthy deploy.
        metrics("local").aiPlanValidated(3, 0);

        assertThat(registry.get("cotune.ai.plan.action").tag("outcome", "dropped")
                .counter().count()).isEqualTo(0.0);
    }

    @Test
    void theRemainingCountersRegisterUnderTheirDocumentedNames() {
        CotuneMetrics metrics = metrics("redis");

        metrics.relayDelivered();
        metrics.aiPlanProposed();
        metrics.staleVersionConflict();

        assertThat(registry.get("cotune.realtime.relay.delivered").counter().count()).isEqualTo(1.0);
        assertThat(registry.get("cotune.ai.plan.proposed").counter().count()).isEqualTo(1.0);
        assertThat(registry.get("cotune.conflict.stale.version").counter().count()).isEqualTo(1.0);
    }

    @Test
    void descriptionsAreNotAccidentallyRegisteredAsTags() {
        // Guards a real mistake made while writing this class: the varargs
        // form registry.counter(name, "description", "...") does NOT set a
        // description — those varargs are TAG key/value pairs, so it silently
        // creates a tag literally named "description" holding a sentence.
        // Cheap to write, invisible until a dashboard sprouts a garbage label.
        metrics("local").relayDelivered();

        assertThat(registry.get("cotune.realtime.relay.delivered").counter()
                .getId().getTag("description")).isNull();
    }

    private static RealtimeEvent anyNoteEvent() {
        // Field values are irrelevant here — only the runtime TYPE reaches the
        // metric, since that is what becomes the tag. (Which is also the
        // property that keeps this metric's cardinality fixed: no field of the
        // event can ever leak into a label.)
        return new NoteEvent(null, null, null, 0, "C4", 1.0, 1, 0L, null);
    }
}
