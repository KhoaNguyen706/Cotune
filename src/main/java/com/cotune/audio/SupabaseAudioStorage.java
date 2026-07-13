package com.cotune.audio;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

/**
 * Bytes in Supabase Storage — an S3-backed object store that outlives any one
 * container. This is what makes audio upload survive a Heroku deploy, a dyno
 * cycle, and a second dyno (see AudioStorage for why the filesystem does not).
 *
 * Talking to the REST API directly rather than pulling in the AWS SDK: the
 * whole surface we need is three verbs on one URL, the project already has an
 * HTTP client, and the S3 SDK is ~10MB of transitive dependency to do a PUT.
 * If this ever grows to multipart uploads or presigned URLs, revisit.
 *
 * THE KEY IS THE service_role KEY, NOT THE ANON KEY. The anon key is subject to
 * Row Level Security and is the one safe to ship to a browser; it cannot write
 * to a private bucket. The service_role key bypasses RLS entirely — it is a
 * root credential for the storage project, which is exactly why it lives in an
 * env var, never in the repo, and never anywhere the frontend can read it. The
 * browser never talks to Supabase Storage at all: it asks OUR api for the bytes
 * (GET /api/audio/{id}), which is object-level authorized by AudioAccess.
 * That indirection is the point — it means the storage bucket needs no public
 * read, no signed URLs, and no second permission model that could drift from
 * SongAccess.
 */
@Component
@ConditionalOnProperty(name = "cotune.storage.backend", havingValue = "supabase")
public class SupabaseAudioStorage implements AudioStorage {

    private static final Logger log = LoggerFactory.getLogger(SupabaseAudioStorage.class);

    private final RestClient http;
    private final String bucket;

    public SupabaseAudioStorage(@Value("${cotune.storage.supabase.url}") String projectUrl,
                                @Value("${cotune.storage.supabase.service-key}") String serviceKey,
                                @Value("${cotune.storage.supabase.bucket}") String bucket) {
        this.bucket = bucket;

        // JdkClientHttpRequestFactory (java.net.http.HttpClient), NOT the
        // SimpleClientHttpRequestFactory you reach for first. That one wraps the
        // ancient HttpURLConnection, which SWALLOWS THE RESPONSE BODY ON 401 —
        // it reserves 401s for its own auth-negotiation machinery and never hands
        // the error stream back. The exception then reads "401 Unauthorized: [no
        // body]" and Supabase's actual explanation is gone.
        //
        // That is precisely the error you cannot afford to lose: a 401 here means
        // the service key is wrong, and "[no body]" is the least useful thing to
        // tell whoever is trying to fix it at deploy time. (403s DO carry a body
        // through, which is what makes the bug so easy to ship — the RLS case
        // looks fine and only the auth case is mute.) A test caught this; a code
        // review would not have.
        //
        // Explicit timeouts, too: the default waits FOREVER, and a hung storage
        // call would pin a Tomcat thread per upload until the pool is exhausted —
        // a storage outage would present as the entire API going down rather than
        // as uploads failing.
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build());
        factory.setReadTimeout(Duration.ofSeconds(30)); // audio files; not a JSON round trip

        this.http = RestClient.builder()
                .baseUrl(projectUrl.replaceAll("/+$", "") + "/storage/v1")
                .requestFactory(factory)
                // Both headers, and they are not redundant: `apikey` is what the
                // Supabase gateway routes on, `Authorization` is what the storage
                // service authorizes on. Send only one and you get a confusing
                // 401 from whichever layer you skipped.
                .defaultHeader("apikey", serviceKey)
                .defaultHeader("Authorization", "Bearer " + serviceKey)
                .build();
    }

    /**
     * Create the bucket if it isn't there, so a fresh deploy needs no manual
     * dashboard step — the app owns its own storage schema, exactly like Flyway
     * owns the DB's. Idempotent: an existing bucket comes back as a conflict,
     * which is a success for our purposes.
     */
    @PostConstruct
    void ensureBucketExists() {
        try {
            http.post()
                    .uri("/bucket")
                    .contentType(MediaType.APPLICATION_JSON)
                    // public: false — nobody reads these bytes without going
                    // through our authorization. See the class comment.
                    .body(Map.of("id", bucket, "name", bucket, "public", false))
                    .retrieve()
                    .toBodilessEntity();
            log.info("Created Supabase storage bucket '{}'", bucket);
        } catch (RestClientResponseException e) {
            if (e.getStatusCode().value() == 409 || e.getResponseBodyAsString().contains("already exists")) {
                log.info("Supabase storage bucket '{}' already exists", bucket);
                return;
            }
            // The server answered, and said no: a bad service key (401), the anon
            // key instead of service_role (403). Carry its explanation forward —
            // it is the only thing that tells the operator WHICH mistake they made.
            throw new IllegalStateException(
                    "Cannot reach Supabase Storage bucket '" + bucket + "' — check "
                            + "cotune.storage.supabase.url / service-key. Response: "
                            + e.getResponseBodyAsString(), e);
        } catch (RestClientException e) {
            // No answer at all: DNS failure, wrong host, firewall. Caught SEPARATELY
            // because it is NOT a RestClientResponseException (there is no response),
            // so the branch above would let it escape as a raw "I/O error on POST"
            // with the URL buried in it. A typo'd SUPABASE_URL is the single most
            // likely deploy-day mistake; it deserves to say so.
            throw new IllegalStateException(
                    "Cannot reach Supabase Storage at the configured URL — check "
                            + "cotune.storage.supabase.url. Cause: " + e.getMessage(), e);
        }
    }

    @Override
    public String store(byte[] bytes) {
        String key = UUID.randomUUID() + ".bin";
        try {
            http.post()
                    .uri("/object/{bucket}/{key}", bucket, key)
                    .contentType(MediaType.APPLICATION_OCTET_STREAM)
                    .body(bytes)
                    .retrieve()
                    .toBodilessEntity();
            return key;
        } catch (RestClientResponseException e) {
            // Surfaces to the uploader as a failed upload, and — critically —
            // AudioServiceImpl has not written the DB row yet, so a failure here
            // leaves nothing behind. Row-pointing-at-missing-bytes stays impossible.
            throw new IllegalStateException("Failed to store audio object " + key
                    + ": " + e.getResponseBodyAsString(), e);
        }
    }

    @Override
    public byte[] load(String storagePath) {
        try {
            byte[] bytes = http.get()
                    .uri("/object/{bucket}/{key}", bucket, storagePath)
                    .retrieve()
                    .body(byte[].class);
            if (bytes == null) {
                throw new IllegalStateException("Empty audio object " + storagePath);
            }
            return bytes;
        } catch (RestClientResponseException e) {
            throw new IllegalStateException("Failed to read audio object " + storagePath
                    + ": " + e.getResponseBodyAsString(), e);
        }
    }

    @Override
    public void delete(String storagePath) {
        try {
            http.delete()
                    .uri("/object/{bucket}/{key}", bucket, storagePath)
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException e) {
            // Best effort, same contract as LocalAudioStorage: the row is already
            // gone. Log it — unlike a local file, an orphaned object costs money.
            log.warn("Could not delete audio object {} (orphaned in bucket {}): {}",
                    storagePath, bucket, e.getResponseBodyAsString());
        }
    }
}
