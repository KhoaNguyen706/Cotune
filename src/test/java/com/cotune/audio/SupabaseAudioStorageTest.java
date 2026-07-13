package com.cotune.audio;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * SupabaseAudioStorage against a REAL HTTP server (the JDK's, on a random port)
 * rather than a mocked RestClient.
 *
 * WHY NOT MOCK: a mock would be asserting that the class calls the methods I
 * wrote, which is a tautology. The entire risk in this class is whether the
 * REQUESTS it emits match the ones Supabase Storage actually answers — the verb,
 * the path, the auth headers, the raw-bytes body. A mocked client cannot be
 * wrong about any of those, so it cannot catch the only bug available. This stub
 * records what really came over a socket.
 *
 * The paths asserted below are taken from the storage server's own route
 * definitions (supabase/storage, src/http/routes): `POST /object/:bucket/*` to
 * upload, GET and DELETE on the same for read and remove, `POST /bucket` to
 * create — all behind the gateway's /storage/v1 prefix. If Supabase ever moves
 * them, this test is where you find out, instead of in the first user's upload.
 */
class SupabaseAudioStorageTest {

    /** One recorded request, as it actually arrived over the wire. */
    private record Received(String method, String path, String auth, String apikey, byte[] body) {}

    private HttpServer server;
    private final List<Received> received = new ArrayList<>();
    /** What the stub should answer with next: {status, body}. */
    private final AtomicInteger nextStatus = new AtomicInteger(200);
    private volatile byte[] nextBody = new byte[0];

    private SupabaseAudioStorage storage;

    private static final String SERVICE_KEY = "service-role-key-xyz";
    private static final String BUCKET = "cotune-audio";

    @BeforeEach
    void startStub() throws IOException {
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/", this::handle);
        server.start();

        storage = new SupabaseAudioStorage(
                "http://localhost:" + server.getAddress().getPort(), SERVICE_KEY, BUCKET);
    }

    @AfterEach
    void stopStub() {
        server.stop(0);
    }

    private void handle(HttpExchange exchange) throws IOException {
        byte[] body = exchange.getRequestBody().readAllBytes();
        received.add(new Received(
                exchange.getRequestMethod(),
                exchange.getRequestURI().getPath(),
                exchange.getRequestHeaders().getFirst("Authorization"),
                exchange.getRequestHeaders().getFirst("apikey"),
                body));

        byte[] response = nextBody;
        int status = nextStatus.get();
        exchange.sendResponseHeaders(status, response.length == 0 ? -1 : response.length);
        if (response.length > 0) {
            exchange.getResponseBody().write(response);
        }
        exchange.close();
    }

    private void stubRespond(int status, String body) {
        nextStatus.set(status);
        nextBody = body.getBytes(StandardCharsets.UTF_8);
    }

    // ---- the requests we actually emit ---------------------------------------

    @Test
    void storePostsTheRawBytesToTheObjectEndpointWithBothAuthHeaders() {
        stubRespond(200, "");

        String key = storage.store("kick.wav bytes".getBytes(StandardCharsets.UTF_8));

        assertThat(received).hasSize(1);
        Received request = received.getFirst();
        assertThat(request.method()).isEqualTo("POST");
        // The bucket and the server-generated key, never a user-supplied filename.
        assertThat(request.path()).isEqualTo("/storage/v1/object/" + BUCKET + "/" + key);
        assertThat(key).endsWith(".bin");
        assertThat(request.body()).asString().isEqualTo("kick.wav bytes");

        // BOTH headers. `apikey` is what the Supabase gateway routes on and
        // `Authorization` is what storage authorizes on; sending only one yields a
        // 401 from whichever layer you skipped, which is a maddening way to spend
        // an afternoon.
        assertThat(request.auth()).isEqualTo("Bearer " + SERVICE_KEY);
        assertThat(request.apikey()).isEqualTo(SERVICE_KEY);
    }

    @Test
    void loadGetsTheObjectBackAsRawBytes() {
        stubRespond(200, "the audio");

        byte[] bytes = storage.load("abc.bin");

        assertThat(bytes).asString().isEqualTo("the audio");
        assertThat(received.getFirst().method()).isEqualTo("GET");
        assertThat(received.getFirst().path()).isEqualTo("/storage/v1/object/" + BUCKET + "/abc.bin");
    }

    @Test
    void deleteIssuesADelete() {
        stubRespond(200, "");

        storage.delete("abc.bin");

        assertThat(received.getFirst().method()).isEqualTo("DELETE");
        assertThat(received.getFirst().path()).isEqualTo("/storage/v1/object/" + BUCKET + "/abc.bin");
    }

    // ---- failure behaviour, which is the whole reason for the try/catches ----

    @Test
    void aFailedStoreThrows() {
        stubRespond(403, "{\"message\":\"new row violates row-level security policy\"}");

        // The real-world cause of exactly this response: using the `anon` key
        // instead of `service_role`. The message has to survive into the exception
        // or the operator has nothing to go on.
        assertThatThrownBy(() -> storage.store("x".getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("row-level security");
    }

    @Test
    void aFailedDeleteIsSwallowed() {
        stubRespond(404, "{\"message\":\"Not found\"}");

        // Best-effort by contract: AudioServiceImpl has ALREADY deleted the DB row
        // by the time we get here. Throwing would fail a delete that, from the
        // user's point of view, succeeded — and leave them unable to retry it.
        assertThatCode(() -> storage.delete("gone.bin")).doesNotThrowAnyException();
    }

    // ---- bucket bootstrap ----------------------------------------------------

    @Test
    void theBucketIsCreatedOnBootSoAFreshDeployNeedsNoDashboardStep() {
        stubRespond(200, "{\"name\":\"" + BUCKET + "\"}");

        storage.ensureBucketExists();

        Received request = received.getFirst();
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.path()).isEqualTo("/storage/v1/bucket");
        // private: nobody reads these bytes without passing through AudioAccess.
        assertThat(request.body()).asString()
                .contains("\"name\":\"" + BUCKET + "\"")
                .contains("\"public\":false");
    }

    @Test
    void anAlreadyExistingBucketIsNotAnError() {
        stubRespond(409, "{\"message\":\"The resource already exists\"}");

        // Idempotent boot: this is the SECOND and every subsequent deploy, i.e. the
        // common case. If a conflict were fatal the app would boot exactly once.
        assertThatCode(() -> storage.ensureBucketExists()).doesNotThrowAnyException();
    }

    @Test
    void anUnreachableUrlFailsTheBootWithAMessageThatNamesTheCulprit() {
        // Port 1 answers nothing. Stands in for the deploy-day classic: a typo in
        // SUPABASE_URL, or a project ref copied from the wrong environment.
        SupabaseAudioStorage misconfigured =
                new SupabaseAudioStorage("http://localhost:1", SERVICE_KEY, BUCKET);

        // A connection failure is NOT a RestClientResponseException — there is no
        // response — so it takes a different catch. Miss that and this surfaces as
        // a raw "I/O error on POST request for ..." with no hint about which of the
        // four Supabase config vars is wrong.
        assertThatThrownBy(misconfigured::ensureBucketExists)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("cotune.storage.supabase.url");
    }

    @Test
    void abadServiceKeyFailsTheBootRatherThanTheFirstUpload() {
        stubRespond(401, "{\"message\":\"Invalid JWT\"}");

        // Fail FAST and loudly. The alternative — shrug at boot, blow up on the
        // first upload hours later — means the deploy looks green and the bug
        // surfaces as "audio is broken" rather than "your key is wrong".
        assertThatThrownBy(() -> storage.ensureBucketExists())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Cannot reach Supabase Storage")
                .hasMessageContaining("Invalid JWT");
    }
}
