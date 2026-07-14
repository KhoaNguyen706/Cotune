package com.cotune.chat;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.realtime.dto.ChatEvent;
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
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Chat over the real socket, against real Postgres — the same fidelity
 * argument as RealtimeStompIntegrationTest, for the same reasons. What
 * chat specifically has to prove:
 *
 *   - a line posted by one collaborator reaches the OTHERS, with identity
 *     stamped from the token (not the payload — there is no name in the
 *     payload to begin with);
 *   - a VIEWER may speak — chat's rule is canView, deliberately weaker
 *     than the note path's canEdit;
 *   - the transcript is PERSISTED and served back in reading order over
 *     GraphQL, so a collaborator who arrives late still has the context;
 *   - strangers can neither read the history nor sit on the topic;
 *   - garbage (blank message) is refused to the sender's error queue and
 *     never broadcast.
 */
class ChatStompIntegrationTest extends AbstractIntegrationTest {

    private static final String CREATE_SONG = """
            mutation Create($input: CreateSongInput!) { createSong(input: $input) { id } }""";
    private static final String SHARE = """
            mutation Share($input: ShareSongInput!) { shareSong(input: $input) { role } }""";
    private static final String CHAT_HISTORY = """
            query Chat($songId: ID!) {
                chatMessages(songId: $songId) { id authorId authorName body createdAt }
            }""";

    private record Client(StompSession session,
                          BlockingQueue<ChatEvent> messages,
                          BlockingQueue<String> errors) {

        ChatEvent nextMessage() throws InterruptedException {
            ChatEvent event = messages.poll(5, TimeUnit.SECONDS);
            assertThat(event).as("expected a chat broadcast within 5s").isNotNull();
            return event;
        }

        void expectNoMessage() throws InterruptedException {
            assertThat(messages.poll(1, TimeUnit.SECONDS))
                    .as("no chat broadcast should have been sent").isNull();
        }

        String nextError() throws InterruptedException {
            String error = errors.poll(5, TimeUnit.SECONDS);
            assertThat(error).as("expected an error on the private queue").isNotNull();
            return error;
        }
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

    /** Connect, listen to the song's chat, and listen to our own error queue. */
    private Client join(String token, UUID songId) throws Exception {
        StompSession session = connect(token);
        BlockingQueue<ChatEvent> messages = new ArrayBlockingQueue<>(16);
        BlockingQueue<String> errors = new ArrayBlockingQueue<>(16);

        session.subscribe("/topic/songs/" + songId + "/chat", new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return ChatEvent.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                messages.add((ChatEvent) payload);
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
        return new Client(session, messages, errors);
    }

    private void say(Client who, UUID songId, String body) {
        who.session().send("/app/songs/" + songId + "/chat", Map.of("body", body));
    }

    // ---- the feature --------------------------------------------------------

    @Test
    void aViewerCanSpeakAndTheRoomHearsThemWithTokenStampedIdentity() throws Exception {
        AuthPayload alice = registerFreshUser();
        AuthPayload bob = registerFreshUser();
        UUID songId = createSong(alice, "Talk It Over");
        // VIEWER on purpose — the person who cannot touch the grid is exactly
        // who chat exists for. If this test fails on authorization, someone
        // "fixed" canView to canEdit and silenced every viewer.
        share(alice, songId, bob, "VIEWER");

        Client owner = join(alice.token(), songId);
        Client viewer = join(bob.token(), songId);

        say(viewer, songId, "the hats feel late on bar 2");

        ChatEvent heard = owner.nextMessage();
        assertThat(heard.body()).isEqualTo("the hats feel late on bar 2");
        // Identity from the signed token; the payload carried only words.
        assertThat(heard.authorId()).isEqualTo(bob.user().id());
        assertThat(heard.authorName()).isEqualTo("Integration Tester");
        assertThat(heard.id()).as("the echo carries the server-assigned id").isNotNull();

        // The sender's echo is their proof the line was stored.
        assertThat(viewer.nextMessage().id()).isEqualTo(heard.id());
    }

    @Test
    void theTranscriptIsPersistedAndServedInReadingOrder() throws Exception {
        AuthPayload alice = registerFreshUser();
        UUID songId = createSong(alice, "Paper Trail");
        Client owner = join(alice.token(), songId);

        say(owner, songId, "first");
        owner.nextMessage(); // wait for each echo so order is deterministic
        say(owner, songId, "second");
        owner.nextMessage();
        say(owner, songId, "third");
        owner.nextMessage();

        // A separate HTTP request, a separate transaction: the words are in
        // the DATABASE, not merely in flight — a collaborator who opens the
        // song tomorrow gets the same conversation.
        List<String> bodies = graphQl(alice.token()).document(CHAT_HISTORY)
                .variable("songId", songId).execute()
                .path("chatMessages[*].body").entityList(String.class).get();
        assertThat(bodies).containsExactly("first", "second", "third");
    }

    @Test
    void aBlankMessageIsRefusedToTheSenderAndNobodyElseHearsAnything() throws Exception {
        AuthPayload alice = registerFreshUser();
        AuthPayload bob = registerFreshUser();
        UUID songId = createSong(alice, "No Empty Lines");
        share(alice, songId, bob, "EDITOR");

        Client owner = join(alice.token(), songId);
        Client editor = join(bob.token(), songId);

        say(editor, songId, "   ");

        // Bean Validation (@NotBlank) refuses it before the service runs;
        // the rejection is TOLD to the sender, same contract as a refused op.
        assertThat(editor.nextError()).isNotBlank();
        owner.expectNoMessage();
    }

    @Test
    void anAiMentionGetsAReplyFromCotuneAiThroughTheOrdinaryChatPipeline() throws Exception {
        AuthPayload alice = registerFreshUser();
        UUID songId = createSong(alice, "Advice Needed");
        Client owner = join(alice.token(), songId);

        say(owner, songId, "@ai how do I make this groove harder?");

        // The human line broadcasts first, untouched — the conversation
        // never waits on the AI machinery.
        assertThat(owner.nextMessage().body()).startsWith("@ai");

        // Tests run with no ANTHROPIC_API_KEY, so the advisor's reply is its
        // "not configured" line — which is exactly what this test wants to
        // pin down: the @ai trigger, the async answer path, the null-author
        // AI identity and the broadcast all work WITHOUT the external
        // dependency, and a keyless deploy degrades to a polite message
        // instead of silence or a stack trace.
        ChatEvent aiReply = owner.nextMessage();
        assertThat(aiReply.authorName()).isEqualTo("Cotune AI");
        assertThat(aiReply.authorId()).as("the AI is not a user account").isNull();
        assertThat(aiReply.body()).contains("isn't configured");

        // And it is HISTORY like anything said in the room: a collaborator
        // who opens the song tomorrow sees the answer.
        List<String> authors = graphQl(alice.token()).document(CHAT_HISTORY)
                .variable("songId", songId).execute()
                .path("chatMessages[*].authorName").entityList(String.class).get();
        assertThat(authors).containsExactly("Integration Tester", "Cotune AI");
    }

    // ---- authorization ------------------------------------------------------

    @Test
    void aStrangerCanNeitherReadTheHistoryNorSitOnTheTopic() throws Exception {
        AuthPayload alice = registerFreshUser();
        AuthPayload stranger = registerFreshUser();
        UUID songId = createSong(alice, "Private Conversation");

        // History over GraphQL: FORBIDDEN, the same classification every
        // other denied query returns.
        expectSingleError(
                graphQl(stranger.token()).document(CHAT_HISTORY)
                        .variable("songId", songId).execute(),
                "FORBIDDEN");

        // The topic: a subscription that is refused server-side. Alice then
        // speaks; the stranger must hear nothing — a chat topic that leaks
        // is a wiretap on every song in the database.
        StompSession session = connect(stranger.token());
        BlockingQueue<ChatEvent> overheard = new ArrayBlockingQueue<>(4);
        session.subscribe("/topic/songs/" + songId + "/chat", new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return ChatEvent.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                overheard.add((ChatEvent) payload);
            }
        });

        Client owner = join(alice.token(), songId);
        say(owner, songId, "just between us");
        owner.nextMessage(); // the message really did go out

        assertThat(overheard.poll(1, TimeUnit.SECONDS))
                .as("a stranger must never overhear a song's chat").isNull();
    }

    // ---- helpers ------------------------------------------------------------

    private UUID createSong(AuthPayload who, String title) {
        return graphQl(who.token()).document(CREATE_SONG)
                .variable("input", Map.of("title", title, "bpm", 120, "timeSignature", "4/4"))
                .execute().path("createSong.id").entity(UUID.class).get();
    }

    private void share(AuthPayload owner, UUID songId, AuthPayload with, String role) {
        graphQl(owner.token()).document(SHARE)
                .variable("input", Map.of("songId", songId.toString(),
                        "email", with.user().email(), "role", role))
                .execute().path("shareSong.role").entity(String.class).isEqualTo(role);
    }
}
