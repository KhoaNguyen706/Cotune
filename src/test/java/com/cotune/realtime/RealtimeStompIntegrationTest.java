package com.cotune.realtime;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.realtime.dto.NoteEvent;
import com.cotune.realtime.dto.PresenceEvent;
import com.cotune.realtime.dto.RealtimeError;
import com.cotune.testsupport.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
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
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Real-time editing over a REAL WebSocket, against real Postgres.
 *
 * TrackNoteOpTest already proves the merge; this class proves the things a unit
 * test structurally cannot, and every one of them is a place where a silent
 * failure would look exactly like success:
 *
 *   - that @PreAuthorize is actually PROCESSED on a @MessageMapping (it is not,
 *     unless SecurityContextChannelInterceptor is registered — and without it
 *     the rules are simply ignored, which is the same shape of bug as forgetting
 *     @EnableMethodSecurity);
 *   - that a JWT in a STOMP CONNECT frame is validated at all;
 *   - that a stranger cannot SUBSCRIBE to a song's topic — the hole that would
 *     PUSH other people's work to them continuously, unprompted;
 *   - that a VIEWER can watch and cannot write.
 */
class RealtimeStompIntegrationTest extends AbstractIntegrationTest {

    private static final String CREATE_SONG = """
            mutation Create($input: CreateSongInput!) { createSong(input: $input) { id } }""";
    private static final String ADD_BEAT = """
            mutation AddBeat($input: AddBeatInput!) { addBeat(input: $input) { id } }""";
    private static final String ADD_TRACK = """
            mutation AddTrack($input: AddTrackInput!) { addTrack(input: $input) { id } }""";
    private static final String SHARE = """
            mutation Share($input: ShareSongInput!) { shareSong(input: $input) { role } }""";
    private static final String SONG_PATTERN = """
            query Song($id: ID!) {
                song(id: $id) { beats { tracks { id pattern { step pitch velocity length } } } }
            }""";

    /** A live, authenticated STOMP session plus everything it has received. */
    private record Client(StompSession session,
                          BlockingQueue<NoteEvent> events,
                          BlockingQueue<String> errors) {

        NoteEvent nextEvent() throws InterruptedException {
            NoteEvent event = events.poll(5, TimeUnit.SECONDS);
            assertThat(event).as("expected a broadcast within 5s").isNotNull();
            return event;
        }

        void expectNoEvent() throws InterruptedException {
            // A negative assertion needs a real wait: asserting "nothing arrived"
            // immediately would pass even on a server that was about to send.
            assertThat(events.poll(1, TimeUnit.SECONDS))
                    .as("no broadcast should have been sent").isNull();
        }

        String nextError() throws InterruptedException {
            String error = errors.poll(5, TimeUnit.SECONDS);
            assertThat(error).as("expected an error on the private queue").isNotNull();
            return error;
        }
    }

    private WebSocketStompClient stompClient() {
        WebSocketStompClient client = new WebSocketStompClient(new StandardWebSocketClient());
        client.setMessageConverter(new MappingJackson2MessageConverter());
        return client;
    }

    /** Opens a socket and CONNECTs with the token in the frame's headers —
     *  the browser cannot put it in the handshake, so neither do we. */
    private StompSession connect(String token) throws Exception {
        StompHeaders connectHeaders = new StompHeaders();
        if (token != null) {
            connectHeaders.add("Authorization", "Bearer " + token);
        }
        return stompClient()
                .connectAsync("ws://localhost:" + port + "/ws",
                        new WebSocketHttpHeaders(), // handshake headers: empty on purpose
                        connectHeaders,             // STOMP headers: the token rides HERE
                        new StompSessionHandlerAdapter() {})
                .get(5, TimeUnit.SECONDS);
    }

    /** Connect, listen to the song, and listen to our own error queue. */
    private Client join(String token, UUID songId) throws Exception {
        StompSession session = connect(token);
        BlockingQueue<NoteEvent> events = new ArrayBlockingQueue<>(16);
        BlockingQueue<String> errors = new ArrayBlockingQueue<>(16);

        session.subscribe("/topic/songs/" + songId, new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return NoteEvent.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                events.add((NoteEvent) payload);
            }
        });
        session.subscribe("/user/queue/errors", new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return RealtimeError.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                errors.add(((RealtimeError) payload).message());
            }
        });
        return new Client(session, events, errors);
    }

    private static Map<String, Object> addNote(UUID trackId, int step, String pitch) {
        return Map.of("type", "ADD", "trackId", trackId.toString(),
                "step", step, "pitch", pitch, "velocity", 0.9, "length", 1);
    }

    // ---- the feature --------------------------------------------------------

    @Test
    void anEditorsNoteReachesEveryoneOnTheSongAndIsPersisted() throws Exception {
        AuthPayload alice = registerFreshUser();
        AuthPayload bob = registerFreshUser();
        UUID songId = createSong(alice, "Live Jam");
        UUID trackId = addLane(alice, songId);
        share(alice, songId, bob, "EDITOR");

        Client owner = join(alice.token(), songId);
        Client editor = join(bob.token(), songId);

        editor.session().send("/app/songs/" + songId + "/notes", addNote(trackId, 4, "C3"));

        // The OWNER — who did nothing — is told about it. That is the feature.
        NoteEvent seenByOwner = owner.nextEvent();
        assertThat(seenByOwner.pitch()).isEqualTo("C3");
        assertThat(seenByOwner.step()).isEqualTo(4);
        assertThat(seenByOwner.trackId()).isEqualTo(trackId);
        assertThat(seenByOwner.actorId()).isEqualTo(bob.user().id());
        // The lane's new version rides along, so a client that later loses the
        // socket can still use the whole-pattern save's expectedVersion check.
        assertThat(seenByOwner.version()).isEqualTo(1);

        // The sender is echoed too — that is their acknowledgement that it landed.
        assertThat(editor.nextEvent().actorId()).isEqualTo(bob.user().id());

        // And it is in the DATABASE, not merely in flight: a separate HTTP
        // request, a separate transaction.
        graphQl(alice.token()).document(SONG_PATTERN).variable("id", songId).execute()
                .path("song.beats[0].tracks[0].pattern[0].pitch").entity(String.class).isEqualTo("C3");
    }

    @Test
    void twoEditorsInTheSameLaneDoNotOverwriteEachOther() throws Exception {
        AuthPayload alice = registerFreshUser();
        AuthPayload bob = registerFreshUser();
        UUID songId = createSong(alice, "Same Lane");
        UUID trackId = addLane(alice, songId);
        share(alice, songId, bob, "EDITOR");

        Client owner = join(alice.token(), songId);
        Client editor = join(bob.token(), songId);

        // Neither has heard of the other's note when they send.
        owner.session().send("/app/songs/" + songId + "/notes", addNote(trackId, 0, "C3"));
        editor.session().send("/app/songs/" + songId + "/notes", addNote(trackId, 8, "E3"));

        owner.nextEvent();
        owner.nextEvent(); // both ops come back to both clients

        // THE ASSERTION THIS WHOLE SESSION EXISTS FOR. Under the old
        // whole-pattern save, whoever wrote second would have erased the other's
        // note, because their array never contained it.
        java.util.List<String> pitches = graphQl(alice.token())
                .document(SONG_PATTERN).variable("id", songId).execute()
                .path("song.beats[0].tracks[0].pattern[*].pitch")
                .entityList(String.class).get();
        assertThat(pitches).containsExactlyInAnyOrder("C3", "E3");
    }

    // ---- authorization ------------------------------------------------------

    @Test
    void connectingWithoutATokenIsRejected() {
        // The HTTP handshake is permitAll (a browser cannot send a header on
        // it), so the socket OPENS — and must then be useless. The CONNECT
        // frame is where the door actually is.
        assertThatThrownBy(() -> connect(null)).isInstanceOf(ExecutionException.class);
    }

    @Test
    void connectingWithAGarbageTokenIsRejected() {
        assertThatThrownBy(() -> connect("not.a.jwt")).isInstanceOf(ExecutionException.class);
    }

    @Test
    void aViewerMayWatchButNotWrite() throws Exception {
        AuthPayload alice = registerFreshUser();
        AuthPayload bob = registerFreshUser();
        UUID songId = createSong(alice, "Look Dont Touch");
        UUID trackId = addLane(alice, songId);
        share(alice, songId, bob, "VIEWER");

        Client viewer = join(bob.token(), songId); // subscribing is fine: canView
        Client owner = join(alice.token(), songId);

        viewer.session().send("/app/songs/" + songId + "/notes", addNote(trackId, 0, "C3"));

        // @PreAuthorize(canEdit) refuses it. The rejection must be TOLD to the
        // sender — a silently dropped op leaves their screen showing a note the
        // server never stored, and the two disagree until the next reload.
        assertThat(viewer.nextError()).isNotBlank();
        // Nobody else is told anything, because nothing happened.
        owner.expectNoEvent();

        // The viewer still WATCHES: the owner's note reaches them.
        owner.session().send("/app/songs/" + songId + "/notes", addNote(trackId, 2, "D3"));
        assertThat(viewer.nextEvent().pitch()).isEqualTo("D3");
    }

    @Test
    void aStrangerCannotSubscribeToSomeoneElsesSong() throws Exception {
        AuthPayload alice = registerFreshUser();
        AuthPayload stranger = registerFreshUser();
        UUID songId = createSong(alice, "Private Session");

        StompSession session = connect(stranger.token()); // a valid account...
        BlockingQueue<NoteEvent> received = new ArrayBlockingQueue<>(4);
        session.subscribe("/topic/songs/" + songId, new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return NoteEvent.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                received.add((NoteEvent) payload);
            }
        });

        // ...whose subscription is refused, so the session is torn down and no
        // amount of editing by Alice will ever push anything to them. An
        // unguarded topic is worse than an unguarded GET: it does not wait to
        // be asked.
        UUID trackId = addLane(alice, songId);
        Client owner = join(alice.token(), songId);
        owner.session().send("/app/songs/" + songId + "/notes", addNote(trackId, 0, "C3"));
        owner.nextEvent(); // the edit really did happen

        assertThat(received.poll(1, TimeUnit.SECONDS))
                .as("a stranger must never be pushed this song's edits").isNull();
    }

    @Test
    void aLaneFromAnotherSongCannotBeEditedThroughASongYouOwn() throws Exception {
        AuthPayload attacker = registerFreshUser();
        AuthPayload victim = registerFreshUser();

        UUID victimSong = createSong(victim, "Victim");
        UUID victimTrack = addLane(victim, victimSong);

        UUID ownSong = createSong(attacker, "Decoy"); // they really do own this
        Client client = join(attacker.token(), ownSong);

        // Authorized against a song they own, but naming a lane inside someone
        // else's. If the service trusted the trackId in the body, one throwaway
        // song would be a skeleton key to every lane in the database.
        client.session().send("/app/songs/" + ownSong + "/notes", addNote(victimTrack, 0, "C3"));

        assertThat(client.nextError()).isNotBlank();

        graphQl(victim.token()).document(SONG_PATTERN).variable("id", victimSong).execute()
                .path("song.beats[0].tracks[0].pattern").entityList(Object.class).hasSize(0);
    }

    // ---- presence -----------------------------------------------------------

    @Test
    void presenceIsRelayedWithTheIdentityTakenFromTheTokenNotThePayload() throws Exception {
        AuthPayload alice = registerFreshUser();
        AuthPayload bob = registerFreshUser();
        UUID songId = createSong(alice, "Who Is Here");
        UUID trackId = addLane(alice, songId);
        share(alice, songId, bob, "VIEWER"); // a VIEWER is in the room too

        StompSession aliceSession = connect(alice.token());
        BlockingQueue<PresenceEvent> seenByAlice = new ArrayBlockingQueue<>(16);
        aliceSession.subscribe("/topic/songs/" + songId + "/presence", new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return PresenceEvent.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                seenByAlice.add((PresenceEvent) payload);
            }
        });

        StompSession bobSession = connect(bob.token());
        bobSession.send("/app/songs/" + songId + "/presence", Map.of(
                "kind", "CURSOR",
                "beatId", UUID.randomUUID().toString(),
                "trackId", trackId.toString(),
                "step", 7,
                "row", 3));

        PresenceEvent event = seenByAlice.poll(5, TimeUnit.SECONDS);
        assertThat(event).as("Alice should be told where Bob's cursor is").isNotNull();
        assertThat(event.step()).isEqualTo(7);
        assertThat(event.row()).isEqualTo(3);

        // THE ASSERTION THAT MATTERS. Bob's message carried no identity at all —
        // the server filled it in from his signed token. If identity were
        // accepted from the payload, anyone could paint a cursor labelled
        // "Alice" onto her collaborators' screens.
        assertThat(event.userId()).isEqualTo(bob.user().id());
        assertThat(event.displayName()).isEqualTo("Integration Tester");
    }

    @Test
    void aStrangerCannotWatchWhereTheEditorsCursorIs() throws Exception {
        AuthPayload alice = registerFreshUser();
        AuthPayload stranger = registerFreshUser();
        UUID songId = createSong(alice, "Private Room");

        StompSession session = connect(stranger.token());
        BlockingQueue<PresenceEvent> received = new ArrayBlockingQueue<>(4);
        session.subscribe("/topic/songs/" + songId + "/presence", new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return PresenceEvent.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                received.add((PresenceEvent) payload);
            }
        });

        // The presence topic is a SEPARATE destination from the edit topic, so
        // it needs its own place in the SUBSCRIBE rule — and a sub-topic that
        // someone forgot to add to the pattern is exactly how a "secure" socket
        // springs a leak. canView guards both.
        StompSession aliceSession = connect(alice.token());
        aliceSession.send("/app/songs/" + songId + "/presence",
                Map.of("kind", "CURSOR", "step", 1, "row", 1));

        assertThat(received.poll(1, TimeUnit.SECONDS))
                .as("a stranger must not be told where the editors are working").isNull();
    }

    // ---- helpers ------------------------------------------------------------

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
