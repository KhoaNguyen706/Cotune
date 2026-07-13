package com.cotune.realtime;

import com.cotune.CotuneApplication;
import com.cotune.auth.dto.AuthPayload;
import com.cotune.realtime.dto.NoteEvent;
import com.cotune.realtime.dto.PresenceEvent;
import com.cotune.testsupport.AbstractIntegrationTest;
import com.cotune.testsupport.RedisTestcontainersConfiguration;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.Environment;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;

import java.lang.reflect.Type;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * TWO REAL INSTANCES OF THE APP, one Redis, one Postgres, and a note that has to
 * get from one JVM to the other.
 *
 * Everything else in the suite runs one instance, which is exactly why none of it
 * could catch the bug this session fixes: with a single JVM, the in-memory broker
 * is a COMPLETE implementation of "broadcast to everyone", and every test passes
 * whether or not a relay exists. The failure only exists in the gap between two
 * processes, so the test has to open that gap. Nothing short of a second
 * ApplicationContext does.
 *
 * (This is the general shape of the thing: a distributed bug is invisible to a
 * non-distributed test, and mocking the second instance would mock away the only
 * part under test.)
 *
 * PER_CLASS lifecycle so the second instance boots once for the class rather than
 * once per test method — it is a whole Spring context, and paying for it four
 * times would put this test firmly in the "someone will delete it because it's
 * slow" category.
 */
@Import(RedisTestcontainersConfiguration.class)
@TestPropertySource(properties = "cotune.realtime.relay=redis")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class RedisRelayIntegrationTest extends AbstractIntegrationTest {

    private static final String CREATE_SONG = """
            mutation Create($input: CreateSongInput!) { createSong(input: $input) { id } }""";
    private static final String ADD_BEAT = """
            mutation AddBeat($input: AddBeatInput!) { addBeat(input: $input) { id } }""";
    private static final String ADD_TRACK = """
            mutation AddTrack($input: AddTrackInput!) { addTrack(input: $input) { id } }""";
    private static final String SHARE = """
            mutation Share($input: ShareSongInput!) { shareSong(input: $input) { role } }""";

    @Autowired
    private PostgreSQLContainer<?> postgres;
    /** By NAME, not by type: PostgreSQLContainer IS a GenericContainer, so
     *  by-type injection here matches both containers and fails to start. */
    @Autowired
    @Qualifier("redisContainer")
    private GenericContainer<?> redis;
    @Autowired
    private Environment environment;

    /** The "other" app instance — the one a load balancer might have put Bob on. */
    private ConfigurableApplicationContext instanceTwo;
    private int portTwo;

    @BeforeAll
    void bootTheSecondInstance() {
        // Passed as COMMAND-LINE ARGS, not via .properties(). It looks like a
        // stylistic choice and is not: SpringApplicationBuilder.properties()
        // registers DEFAULT properties, which sit at the BOTTOM of Spring's
        // precedence order — below application.yml. So every one of these would
        // have been silently overridden by the file, and the second instance
        // would have booted pointing at localhost:5432 and localhost:6379, i.e.
        // at nothing. Command-line args sit near the TOP and win.
        instanceTwo = new SpringApplicationBuilder(CotuneApplication.class)
                .run(
                        "--server.port=0",
                        "--cotune.realtime.relay=redis",
                        // SAME Redis and SAME Postgres as the instance the base
                        // class booted. That is what makes these two processes one
                        // system rather than two apps that happen to be running.
                        "--spring.data.redis.host=" + redis.getHost(),
                        "--spring.data.redis.port=" + redis.getMappedPort(6379),
                        "--spring.datasource.url=" + postgres.getJdbcUrl(),
                        "--spring.datasource.username=" + postgres.getUsername(),
                        "--spring.datasource.password=" + postgres.getPassword(),
                        "--cotune.storage.audio-dir="
                                + environment.getProperty("cotune.storage.audio-dir"));

        portTwo = Integer.parseInt(
                instanceTwo.getEnvironment().getRequiredProperty("local.server.port"));
    }

    @AfterAll
    void shutDownTheSecondInstance() {
        if (instanceTwo != null) {
            instanceTwo.close();
        }
    }

    // ---- the feature --------------------------------------------------------

    @Test
    void aNoteSentToOneInstanceReachesACollaboratorConnectedToTheOther() throws Exception {
        AuthPayload alice = registerFreshUser();
        AuthPayload bob = registerFreshUser();
        UUID songId = createSong(alice, "Cross Instance Jam");
        UUID trackId = addLane(alice, songId);
        share(alice, songId, bob, "EDITOR");

        // The two of them are on DIFFERENT JVMs. Neither instance's broker has
        // ever heard of the other's subscriber.
        Client onInstanceOne = join(alice.token(), port, songId);
        Client onInstanceTwo = join(bob.token(), portTwo, songId);

        onInstanceTwo.session().send("/app/songs/" + songId + "/notes", addNote(trackId, 4, "C3"));

        // THE ASSERTION THE WHOLE SESSION EXISTS FOR. Before the relay this line
        // timed out — forever, not intermittently. Alice's instance applied
        // nothing, was told nothing, and had no way to find out.
        NoteEvent crossed = onInstanceOne.nextEvent();
        assertThat(crossed.pitch()).isEqualTo("C3");
        assertThat(crossed.step()).isEqualTo(4);
        assertThat(crossed.trackId()).isEqualTo(trackId);
        assertThat(crossed.actorId()).isEqualTo(bob.user().id());
        // The version survived the trip: the envelope carries the APPLIED event,
        // so a client that later drops to the HTTP save path still has a base
        // version to send as expectedVersion.
        assertThat(crossed.version()).isEqualTo(1);

        // And Bob still gets his own echo — from Redis, like everybody else.
        assertThat(onInstanceTwo.nextEvent().actorId()).isEqualTo(bob.user().id());
    }

    @Test
    void theSenderIsEchoedExactlyOnceEvenThoughItPublishedTheMessageItself() throws Exception {
        AuthPayload alice = registerFreshUser();
        UUID songId = createSong(alice, "Echo Once");
        UUID trackId = addLane(alice, songId);

        Client alone = join(alice.token(), port, songId);
        alone.session().send("/app/songs/" + songId + "/notes", addNote(trackId, 0, "C3"));

        assertThat(alone.nextEvent().pitch()).isEqualTo("C3");

        // THE TRAP. This instance PUBLISHED that note, and it is also SUBSCRIBED
        // to the channel it published on — so it receives its own message back.
        // The naive relay ("send to my clients, then publish for the others")
        // delivers it a second time here, and the duplicate is invisible on a
        // beat grid because NOTE_ADD is idempotent: it lands on the same cell.
        // So the bug ships, and detonates later under the first op that is NOT
        // idempotent. There is exactly one delivery path — Redis — and this
        // asserts it.
        assertThat(alone.events().poll(1, TimeUnit.SECONDS))
                .as("the loopback must be the ONLY delivery, not a second one")
                .isNull();
    }

    @Test
    void presenceCrossesInstancesToo() throws Exception {
        AuthPayload alice = registerFreshUser();
        AuthPayload bob = registerFreshUser();
        UUID songId = createSong(alice, "Where Is Everyone");
        UUID trackId = addLane(alice, songId);
        share(alice, songId, bob, "VIEWER"); // a viewer is in the room too

        StompSession aliceSession = connect(alice.token(), port);
        BlockingQueue<PresenceEvent> seenByAlice = new ArrayBlockingQueue<>(16);
        subscribe(aliceSession, "/topic/songs/" + songId + "/presence",
                PresenceEvent.class, seenByAlice);

        StompSession bobSession = connect(bob.token(), portTwo);
        bobSession.send("/app/songs/" + songId + "/presence", Map.of(
                "kind", "CURSOR",
                "trackId", trackId.toString(),
                "step", 7,
                "row", 3));

        // Presence is the traffic that would have been quietly forgotten: it is a
        // SECOND destination (/presence), and a relay that only carried note
        // events would leave collaborators on another instance permanently
        // invisible — while notes flowed perfectly. "Half the real-time works" is
        // a nastier bug than "none of it does", because nobody suspects the
        // transport.
        PresenceEvent event = seenByAlice.poll(5, TimeUnit.SECONDS);
        assertThat(event).as("Bob's cursor should cross to Alice's instance").isNotNull();
        assertThat(event.userId()).isEqualTo(bob.user().id());
        assertThat(event.step()).isEqualTo(7);
        assertThat(event.row()).isEqualTo(3);
        // Identity was stamped from Bob's TOKEN on instance two and survived the
        // relay intact — the server that authenticated him is not the server that
        // will show him to Alice, and the JWT is what makes that safe.
        assertThat(event.displayName()).isEqualTo("Integration Tester");
    }

    @Test
    void theRelayDeliversOnlyToTheRoomTheEventWasAddressedTo() throws Exception {
        AuthPayload alice = registerFreshUser();
        UUID busySong = createSong(alice, "Busy");
        UUID quietSong = createSong(alice, "Quiet");
        UUID busyTrack = addLane(alice, busySong);

        // Alice watches the QUIET song from the other instance...
        Client watchingQuiet = join(alice.token(), portTwo, quietSong);
        // ...while editing the BUSY one here.
        Client editingBusy = join(alice.token(), port, busySong);
        editingBusy.session().send("/app/songs/" + busySong + "/notes", addNote(busyTrack, 0, "C3"));
        editingBusy.nextEvent(); // it really did happen

        // Every instance receives EVERY message on the channel — there is one
        // channel for the whole system (see RelaySubscriber). What stops the quiet
        // room from hearing the busy one is the destination in the envelope, and
        // the local broker finding no subscribers for it. Drop the destination and
        // this test is how you find out.
        assertThat(watchingQuiet.events().poll(1, TimeUnit.SECONDS))
                .as("a song's edits must not leak into another song's room")
                .isNull();
    }

    // ---- STOMP plumbing -----------------------------------------------------

    private record Client(StompSession session, BlockingQueue<NoteEvent> events) {
        NoteEvent nextEvent() throws InterruptedException {
            NoteEvent event = events.poll(5, TimeUnit.SECONDS);
            assertThat(event).as("expected a broadcast within 5s").isNotNull();
            return event;
        }
    }

    /** Connects to a SPECIFIC instance — the parameter that makes this test a test. */
    private StompSession connect(String token, int atPort) throws Exception {
        WebSocketStompClient client = new WebSocketStompClient(new StandardWebSocketClient());
        client.setMessageConverter(new MappingJackson2MessageConverter());

        StompHeaders connectHeaders = new StompHeaders();
        connectHeaders.add("Authorization", "Bearer " + token);

        // The SAME token works on either instance, and that is not an accident of
        // the test setup — it is why this scales. A JWT is verified with a signing
        // key both instances hold, so no instance needs to have seen the login, and
        // no session state has to be replicated. Had auth been server-side sessions,
        // "collaboration across instances" would have needed a shared session store
        // before it could even begin.
        return client.connectAsync("ws://localhost:" + atPort + "/ws",
                        new WebSocketHttpHeaders(), connectHeaders,
                        new StompSessionHandlerAdapter() {})
                .get(5, TimeUnit.SECONDS);
    }

    private <T> void subscribe(StompSession session, String destination,
                               Class<T> type, BlockingQueue<T> sink) {
        session.subscribe(destination, new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return type;
            }

            @Override
            @SuppressWarnings("unchecked")
            public void handleFrame(StompHeaders headers, Object payload) {
                sink.add((T) payload);
            }
        });
    }

    private Client join(String token, int atPort, UUID songId) throws Exception {
        StompSession session = connect(token, atPort);
        BlockingQueue<NoteEvent> events = new ArrayBlockingQueue<>(16);
        subscribe(session, "/topic/songs/" + songId, NoteEvent.class, events);
        return new Client(session, events);
    }

    private static Map<String, Object> addNote(UUID trackId, int step, String pitch) {
        return Map.of("type", "ADD", "trackId", trackId.toString(),
                "step", step, "pitch", pitch, "velocity", 0.9, "length", 1);
    }

    // ---- fixtures -----------------------------------------------------------

    private UUID createSong(AuthPayload who, String title) {
        return graphQl(who.token()).document(CREATE_SONG)
                .variable("input", Map.of("title", title, "bpm", 120, "timeSignature", "4/4"))
                .execute().path("createSong.id").entity(UUID.class).get();
    }

    private UUID addLane(AuthPayload who, UUID songId) {
        UUID beatId = graphQl(who.token()).document(ADD_BEAT)
                .variable("input", Map.of("songId", songId.toString(), "name", "Beat 1"))
                .execute().path("addBeat.id").entity(UUID.class).get();
        return graphQl(who.token()).document(ADD_TRACK)
                .variable("input", Map.of("beatId", beatId.toString(), "name", "Lead", "instrument", "SYNTH"))
                .execute().path("addTrack.id").entity(UUID.class).get();
    }

    private void share(AuthPayload owner, UUID songId, AuthPayload with, String role) {
        graphQl(owner.token()).document(SHARE)
                .variable("input", Map.of("songId", songId.toString(),
                        "email", with.user().email(), "role", role))
                .execute().path("shareSong.role").entity(String.class).isEqualTo(role);
    }
}
