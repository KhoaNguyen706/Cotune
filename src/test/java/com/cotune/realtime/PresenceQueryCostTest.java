package com.cotune.realtime;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.realtime.dto.PresenceEvent;
import com.cotune.testsupport.AbstractIntegrationTest;
import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.lang.reflect.Type;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A CURSOR FRAME MUST NOT TOUCH THE DATABASE.
 *
 * This test exists because of a real, reported bug: "it's not actually
 * real-time, it takes a while for my friend to see my edit". The cause was
 * not the socket and not the debounce — both were already fast. It was this:
 *
 *   @PreAuthorize("@songAccess.canView(...)") on the presence handler ran on
 *   EVERY frame, and canView is two SELECTs against Postgres. The editor
 *   sends a cursor frame every 50ms while the mouse moves (CURSOR_THROTTLE_MS),
 *   so ONE person waggling their mouse was ~40 queries/second — against a
 *   production Hikari pool of 5. Note ops then queued behind cursor frames for
 *   a connection, and an edit that should land in ~100ms took seconds.
 *
 * The fix (SongAccessCache) makes the answer to "may this session touch this
 * song" a cached one. This test pins the property that matters: presence
 * costs ZERO queries in steady state. It is a performance characteristic that
 * regresses SILENTLY — everything still works, just slowly, and only under two
 * people and a real network — so it gets a real assertion rather than a note
 * in a comment.
 *
 * It counts JDBC prepared statements (Hibernate's own counter) rather than
 * timing anything: a timing assertion on CI is a flake, and "how many round
 * trips" is the thing actually being fixed.
 */
class PresenceQueryCostTest extends AbstractIntegrationTest {

    private static final String CREATE_SONG = """
            mutation Create($input: CreateSongInput!) { createSong(input: $input) { id } }""";

    /** How many frames a real editor sends in one second of mouse movement. */
    private static final int FRAMES = 20;

    @Autowired
    private EntityManagerFactory entityManagerFactory;

    /**
     * Statistics are switched on HERE rather than via a property, deliberately:
     * a @DynamicPropertySource would fork a second Spring context and boot a
     * second Postgres container for the whole suite (see AbstractIntegrationTest).
     * Toggling the same SessionFactory at runtime keeps this class sharing the
     * one cached context.
     */
    private Statistics statistics() {
        return entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
    }

    @Test
    void cursorFramesDoNotQueryTheDatabase() throws Exception {
        AuthPayload alice = registerFreshUser();
        UUID songId = createSong(alice, "Cursor Cost");

        StompSession session = connect(alice.token());
        // The frames come back on the presence topic — that echo is how we know
        // the server has actually PROCESSED them. Counting statements after a
        // fixed sleep instead would measure whatever happened to have finished.
        CountDownLatch received = new CountDownLatch(FRAMES);
        session.subscribe("/topic/songs/" + songId + "/presence", new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return PresenceEvent.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                received.countDown();
            }
        });

        // WARM UP FIRST, and outside the measurement. The first frame legitimately
        // populates the cache, and Hibernate/Hikari do first-use work that would
        // otherwise be blamed on presence. What is under test is the STEADY state:
        // the 20th cursor frame of a drag must cost nothing.
        session.send("/app/songs/" + songId + "/presence", cursorAt(3));
        Thread.sleep(500);

        statistics().setStatisticsEnabled(true);
        statistics().clear();
        long before = statistics().getPrepareStatementCount();

        for (int step = 0; step < FRAMES; step++) {
            session.send("/app/songs/" + songId + "/presence", cursorAt(step));
        }

        assertThat(received.await(10, TimeUnit.SECONDS))
                .as("all %s presence frames should have been broadcast back", FRAMES)
                .isTrue();
        // The broadcast is sent from the handler, so the echo arriving proves the
        // handler ran — but @PreAuthorize runs BEFORE it, and any statement it
        // issued is already counted by now.
        long queries = statistics().getPrepareStatementCount() - before;

        System.out.printf("PRESENCE COST: %d JDBC statements for %d cursor frames (%.1f per frame)%n",
                queries, FRAMES, (double) queries / FRAMES);

        assertThat(queries)
                .as("""
                        %d cursor frames issued %d database statements. Presence persists \
                        NOTHING and its authorization answer cannot change mid-drag, so the \
                        steady-state cost must be zero — see SongAccessCache. At 20 frames/sec \
                        per user, anything above zero here is what starves note ops of the \
                        (5-connection) pool and makes collaboration feel laggy.""",
                        FRAMES, queries)
                .isZero();

        session.disconnect();
    }

    private static Map<String, Object> cursorAt(int step) {
        return Map.of("kind", "CURSOR", "step", step, "row", 0);
    }

    private StompSession connect(String token) throws Exception {
        WebSocketStompClient client = new WebSocketStompClient(new StandardWebSocketClient());
        client.setMessageConverter(new MappingJackson2MessageConverter());
        StompHeaders connectHeaders = new StompHeaders();
        connectHeaders.add("Authorization", "Bearer " + token);
        return client.connectAsync("ws://localhost:" + port + "/ws",
                        new WebSocketHttpHeaders(), connectHeaders,
                        new StompSessionHandlerAdapter() {})
                .get(5, TimeUnit.SECONDS);
    }

    private UUID createSong(AuthPayload who, String title) {
        return graphQl(who.token()).document(CREATE_SONG)
                .variable("input", Map.of("title", title, "bpm", 120, "timeSignature", "4/4"))
                .execute().path("createSong.id").entity(UUID.class).get();
    }
}
