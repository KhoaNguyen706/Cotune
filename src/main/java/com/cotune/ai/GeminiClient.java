package com.cotune.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * The one place this codebase talks to Google's Gemini API (session 25 —
 * switched from Anthropic; the provider is a config concern, and both
 * consumers only ever needed two call shapes: "answer in prose" and
 * "answer as JSON matching this schema").
 *
 * Plain REST over Spring's RestClient rather than Google's SDK, for the
 * same reason SupabaseAudioStorage does it: two request shapes don't earn
 * a dependency, and the house pattern (JdkClientHttpRequestFactory,
 * explicit timeouts) already exists. The timeouts matter more here than
 * anywhere: Gemini 2.5 models THINK by default, a generation can take
 * tens of seconds, and the RestClient default would wait forever — a hung
 * call pinning a Tomcat thread (PatternGenerator) or the chat-ai-advisor
 * executor (AiAdvisor) until the pool starves.
 *
 * Callers translate the typed failures below into their own user-safe
 * messages; nothing Google says in an error body ever reaches a chat
 * message or GraphQL error (quota details and project ids don't belong
 * there).
 */
@Component
public class GeminiClient {

    static final String BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

    /**
     * Generous on purpose: on Gemini 2.5 models the THINKING tokens spend
     * from this same budget before a single answer token is written, and a
     * budget sized to the answer alone would surface as truncated JSON or
     * an empty reply. Tokens on flash's free tier cost nothing; a starved
     * response costs a user-facing failure.
     */
    static final int MAX_OUTPUT_TOKENS = 8192;

    private final AiProperties properties;
    private final ObjectMapper objectMapper;
    // Built once and reused (it holds a connection pool); null when the
    // feature is off — enabled() guards every use.
    private final RestClient http;

    public GeminiClient(AiProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        if (!properties.enabled()) {
            this.http = null;
            return;
        }
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build());
        // A minute covers a thinking model on a slow day; anything longer is
        // an outage and failing fast into the "try again shortly" path beats
        // holding the thread.
        factory.setReadTimeout(Duration.ofSeconds(60));
        this.http = RestClient.builder()
                .baseUrl(BASE_URL)
                .requestFactory(factory)
                .defaultHeader("x-goog-api-key", properties.apiKey())
                .build();
    }

    public boolean enabled() {
        return properties.enabled();
    }

    /** One question, one prose answer — guaranteed non-blank. */
    public String generateText(String systemPrompt, String userMessage) {
        return call(systemPrompt, userMessage, Map.of("maxOutputTokens", MAX_OUTPUT_TOKENS));
    }

    /**
     * One question, one answer constrained to {@code responseSchema}
     * (Gemini's OpenAPI-subset dialect) and mapped onto {@code type}.
     * Constrained decoding means "the model ignored the shape" stops being
     * a failure mode — but a refusal or a max-tokens truncation still
     * leaves unparseable text behind, which surfaces as
     * {@link UnusableResponseException}, not as a Jackson stack trace in a
     * caller.
     */
    public <T> T generateJson(String systemPrompt, String userMessage,
                              Map<String, Object> responseSchema, Class<T> type) {
        String json = call(systemPrompt, userMessage, Map.of(
                "maxOutputTokens", MAX_OUTPUT_TOKENS,
                "responseMimeType", "application/json",
                "responseSchema", responseSchema));
        try {
            return objectMapper.readValue(json, type);
        } catch (JsonProcessingException malformed) {
            throw new UnusableResponseException(
                    "response was not valid " + type.getSimpleName() + " JSON", malformed);
        }
    }

    /**
     * One question, a list of TOOL CALLS — the model picks which of
     * {@code functionDeclarations} to invoke, and with what arguments.
     *
     * The third call shape, and the first where the model decides what
     * HAPPENS rather than what is said. Two things make that safe to offer:
     *
     *   mode=ANY forces a function call, so "the model answered in prose
     *   instead of doing the thing" stops being a failure mode. (mode=AUTO
     *   lets it chat back, which for a button labelled "compose" is just a
     *   silent no-op.)
     *
     *   allowedFunctionNames pins it to the tools we declared. Belt and
     *   braces against a hallucinated tool name — but note it is NOT the
     *   security boundary. Nothing here executes anything: this returns a
     *   PROPOSAL, and BeatComposer re-validates every argument against the
     *   domain before any of it becomes an edit. A model is an untrusted
     *   input source that happens to be good at music.
     */
    public List<FunctionCall> generateToolCalls(String systemPrompt, String userMessage,
                                                List<Map<String, Object>> functionDeclarations) {
        List<String> names = functionDeclarations.stream()
                .map(declaration -> String.valueOf(declaration.get("name")))
                .toList();
        Candidate candidate = callRaw(Map.of(
                "systemInstruction", Map.of("parts", List.of(Map.of("text", systemPrompt))),
                "contents", List.of(Map.of(
                        "role", "user",
                        "parts", List.of(Map.of("text", userMessage)))),
                "tools", List.of(Map.of("functionDeclarations", functionDeclarations)),
                "toolConfig", Map.of("functionCallingConfig", Map.of(
                        "mode", "ANY",
                        "allowedFunctionNames", names)),
                "generationConfig", Map.of("maxOutputTokens", MAX_OUTPUT_TOKENS)));

        List<FunctionCall> calls = parts(candidate).stream()
                .map(Part::functionCall)
                .filter(Objects::nonNull)
                .toList();
        if (calls.isEmpty()) {
            // Forced mode and still nothing: a refusal, or the thinking
            // budget ate the whole response before a call was emitted.
            throw new UnusableResponseException(
                    "no function calls (finishReason=" + candidate.finishReason() + ")", null);
        }
        return calls;
    }

    private String call(String systemPrompt, String userMessage, Map<String, Object> generationConfig) {
        // systemInstruction is Gemini's system prompt: byte-stable per
        // caller, which keeps the implicit prefix cache warm and — more
        // importantly — keeps prompt behavior reviewable in one constant.
        Candidate first = callRaw(Map.of(
                "systemInstruction", Map.of("parts", List.of(Map.of("text", systemPrompt))),
                "contents", List.of(Map.of(
                        "role", "user",
                        "parts", List.of(Map.of("text", userMessage)))),
                "generationConfig", generationConfig));

        String text = parts(first).stream()
                // Thought parts only appear when explicitly requested,
                // but a summary leaking into a chat reply would be
                // bizarre enough to guard against anyway.
                .filter(part -> !Boolean.TRUE.equals(part.thought()))
                .map(Part::text)
                .filter(Objects::nonNull)
                .collect(Collectors.joining("\n"))
                .strip();
        if (text.isEmpty()) {
            throw new UnusableResponseException(
                    "empty answer (finishReason=" + first.finishReason() + ")", null);
        }
        return text;
    }

    /** POST, and hand back the first candidate. Everything above differs only
     *  in what it asks for and what it reads out. */
    private Candidate callRaw(Map<String, Object> body) {
        GenerateContentResponse response;
        try {
            response = http.post()
                    .uri("/models/{model}:generateContent", properties.model())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(GenerateContentResponse.class);
        } catch (RestClientResponseException httpError) {
            if (httpError.getStatusCode().value() == 429) {
                throw new RateLimitedException();
            }
            throw new ApiErrorException("Gemini returned HTTP " + httpError.getStatusCode().value(), httpError);
        } catch (RestClientException transportFailure) {
            // Timeout or connection failure — no response to read.
            throw new ApiErrorException("Gemini call failed before a response arrived", transportFailure);
        }

        if (response == null || response.candidates() == null || response.candidates().isEmpty()) {
            // A prompt the model declines (safety block) comes back 200 with
            // no candidates — an answer-shaped nothing.
            throw new UnusableResponseException("no candidates in the response", null);
        }
        return response.candidates().getFirst();
    }

    private static List<Part> parts(Candidate candidate) {
        return candidate.content() == null || candidate.content().parts() == null
                ? List.of() : candidate.content().parts();
    }

    // ---- the slice of the generateContent response we read ----------------

    @JsonIgnoreProperties(ignoreUnknown = true)
    record GenerateContentResponse(List<Candidate> candidates) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Candidate(Content content, String finishReason) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Content(List<Part> parts) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Part(String text, Boolean thought, FunctionCall functionCall) {
    }

    /**
     * A tool the model wants invoked. `args` is deliberately an untyped map:
     * it is JSON a language model produced, and giving it a typed shape here
     * would imply a guarantee nobody made. The consumer reads each argument
     * defensively and throws it away if it doesn't fit the domain.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record FunctionCall(String name, Map<String, Object> args) {
    }

    // ---- typed failures — callers pick the user-facing words ---------------

    /** HTTP 429 — the free tier's requests-per-minute gate, most likely. */
    public static class RateLimitedException extends RuntimeException {
    }

    /** The API errored or was unreachable; message/cause are for LOGS only. */
    public static class ApiErrorException extends RuntimeException {
        ApiErrorException(String logMessage, Throwable cause) {
            super(logMessage, cause);
        }
    }

    /** The call succeeded but no usable answer came back (refusal,
     *  truncation, or JSON that doesn't fit the schema's target type). */
    public static class UnusableResponseException extends RuntimeException {
        UnusableResponseException(String logMessage, Throwable cause) {
            super(logMessage, cause);
        }
    }

    /** Registers the properties record — mirrors SecurityConfig's pattern. */
    @Configuration
    @EnableConfigurationProperties(AiProperties.class)
    static class AiConfig {
    }
}
