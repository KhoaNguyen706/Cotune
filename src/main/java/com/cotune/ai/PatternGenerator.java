package com.cotune.ai;

import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.track.Step;
import com.cotune.track.Track;
import com.cotune.track.TrackRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The ROADMAP's Phase 4 headline: "give me a boom-bap drum pattern" → notes.
 *
 * The design lives or dies on one property: THE MODEL'S OUTPUT IS NEVER
 * TRUSTED. Constrained decoding ({@link #PATTERN_SCHEMA}) guarantees the
 * JSON parses into the record below, but schema-valid is not domain-valid
 * — so every note is rebuilt through the same {@link Step} constructor a
 * human's edit goes through, clamped to the beat it targets, and anything
 * that doesn't survive is dropped. What leaves this class is
 * indistinguishable from notes a person drew, which is why the rest of
 * the pipeline (undo, dirty-flush, delta broadcast) needs no changes to
 * carry them.
 *
 * Deliberately does NOT save anything. The mutation returns the notes and
 * the CLIENT lands them as ordinary local edits — auditionable and
 * undoable before they ever persist, exactly as the roadmap scoped it.
 */
@Component
public class PatternGenerator {

    private static final Logger log = LoggerFactory.getLogger(PatternGenerator.class);

    /** More notes than any human programs into one lane; a runaway model
     *  response gets truncated here rather than flooding the grid. */
    static final int MAX_NOTES = 256;

    /**
     * Fixed and identical on every call, same as AiAdvisor. Musical
     * guidance only — the SHAPE of the output is enforced by
     * {@link #PATTERN_SCHEMA}, so the prompt spends its tokens on what
     * makes a pattern good rather than on JSON formatting rules.
     */
    static final String SYSTEM_PROMPT = """
            You are a pattern composer inside Cotune, a collaborative step \
            sequencer (16 sixteenth-note steps per bar). You will be shown a \
            song as text grids (x = hit, — = held, . = silence), a target \
            lane, and a request. Compose notes for the TARGET LANE ONLY that \
            fit the song's feel and the request. Steps are 0-based and must \
            stay below the lane's step count. Pitch is scientific notation \
            (C4, F#2); use idiomatic octaves — kicks and snares near C2, \
            basslines C1-C3, chords and melodies C4-C6. Velocity is 0.1-1.0; \
            vary it, accents make grooves. Length is in steps (1 = one \
            sixteenth; drums are usually 1, held bass or pads longer). \
            Never place two notes at the same step and pitch. Prefer what a \
            human would program: strong beats, purposeful syncopation, \
            usually 4-40 notes.""";

    /**
     * Gemini's responseSchema (OpenAPI-subset dialect) for
     * {@link GeneratedPattern}. Hand-written where the Anthropic SDK used
     * to derive it from the record via reflection — the record and this
     * constant must agree, and the deserialization in GeminiClient is what
     * holds them honest (a drifted schema surfaces as an unusable
     * response, never as silently wrong notes).
     */
    static final Map<String, Object> PATTERN_SCHEMA = Map.of(
            "type", "OBJECT",
            "description", "The generated pattern for the target lane",
            "properties", Map.of(
                    "notes", Map.of(
                            "type", "ARRAY",
                            "description", "The note events, in any order",
                            "items", Map.of(
                                    "type", "OBJECT",
                                    "properties", Map.of(
                                            "step", Map.of(
                                                    "type", "INTEGER",
                                                    "description", "0-based sixteenth-note position; must be below the lane's step count"),
                                            "pitch", Map.of(
                                                    "type", "STRING",
                                                    "description", "Scientific pitch notation, e.g. C2 or F#4"),
                                            "velocity", Map.of(
                                                    "type", "NUMBER",
                                                    "description", "Loudness from 0.1 (soft) to 1.0 (accent)"),
                                            "length", Map.of(
                                                    "type", "INTEGER",
                                                    "description", "Duration in steps; 1 = one sixteenth note")),
                                    "required", List.of("step", "pitch", "velocity", "length")))),
            "required", List.of("notes"));

    private final GeminiClient gemini;
    private final TrackRepository trackRepository;

    public PatternGenerator(GeminiClient gemini, TrackRepository trackRepository) {
        this.gemini = gemini;
        this.trackRepository = trackRepository;
    }

    /**
     * The DB reads, separated from the API call on purpose: this method is
     * transactional and returns in microseconds; {@link #generate} then
     * talks to Gemini for seconds while holding NO connection. One method
     * doing both would pin a pool connection (5 per dyno!) for the whole
     * round trip.
     */
    @Transactional(readOnly = true)
    public LaneContext laneContext(UUID trackId) {
        Track track = trackRepository.findById(trackId)
                .orElseThrow(() -> ResourceNotFoundException.track(trackId));
        UUID songId = trackRepository.findSongIdById(trackId)
                .orElseThrow(() -> ResourceNotFoundException.track(trackId));
        return new LaneContext(
                songId,
                track.getName(),
                track.getInstrument().name(),
                track.getBeat().getName(),
                track.getBeat().totalSteps());
    }

    /** Everything the prompt says about the lane being written into. */
    public record LaneContext(UUID songId, String laneName, String instrument,
                              String beatName, int totalSteps) {
    }

    /**
     * One request, one validated pattern, synchronous — the caller is an
     * HTTP request whose answer IS these notes, so unlike chat there is
     * nothing to gain from an executor.
     *
     * @throws GenerationUnavailableException with a user-safe message when
     *                                        the model can't deliver
     */
    public List<Step> generate(String songContext, LaneContext lane, String prompt) {
        if (!enabled()) {
            throw new GenerationUnavailableException(
                    "AI generation isn't configured on this server (GEMINI_API_KEY is not set).");
        }

        GeneratedPattern generated;
        try {
            generated = gemini.generateJson(SYSTEM_PROMPT, """
                            %s
                            Target lane: "%s" [%s] in beat "%s" — %d steps (0..%d).
                            Request: %s""".formatted(
                            songContext, lane.laneName(), lane.instrument(), lane.beatName(),
                            lane.totalSteps(), lane.totalSteps() - 1, prompt),
                    PATTERN_SCHEMA, GeneratedPattern.class);
        } catch (GeminiClient.RateLimitedException tooFast) {
            throw new GenerationUnavailableException(
                    "The AI is rate-limited right now — try again in a minute.");
        } catch (GeminiClient.UnusableResponseException malformed) {
            // A refusal or a max-tokens truncation leaves no parseable
            // pattern behind — constrained decoding guarantees the schema
            // only when the model actually finishes an answer.
            log.warn("AI pattern response was unusable: {}", malformed.toString());
            throw new GenerationUnavailableException(
                    "The AI didn't produce a usable pattern — try rephrasing.");
        } catch (GeminiClient.ApiErrorException apiFailure) {
            // Generic on purpose: API error bodies can name models, projects
            // and quota details that don't belong in a user-facing message.
            log.warn("AI pattern generation failed: {}", apiFailure.toString());
            throw new GenerationUnavailableException(
                    "The AI hit an error — try again shortly.");
        }

        if (generated == null || generated.notes() == null) {
            throw new GenerationUnavailableException(
                    "The AI didn't produce a pattern — try rephrasing.");
        }

        List<Step> notes = sanitize(generated.notes(), lane.totalSteps());
        if (notes.isEmpty()) {
            throw new GenerationUnavailableException(
                    "The AI couldn't come up with valid notes for that — try a different description.");
        }
        return notes;
    }

    public boolean enabled() {
        return gemini.enabled();
    }

    /**
     * Schema-valid → domain-valid. Every survivor went through the Step
     * constructor — the exact validation a human's note gets — after two
     * repairs that are worth making instead of rejecting: a length that
     * overruns the beat is trimmed to fit (the START was musical intent;
     * the overhang is likely the model forgetting the bar count), and a
     * velocity above 1 is clamped (clearly meant "loud"). Everything else
     * — steps outside the beat, garbage pitches, non-positive velocities,
     * duplicate step+pitch — is dropped, because guessing intent there
     * would put notes on the grid nobody asked for.
     */
    static List<Step> sanitize(List<GeneratedNote> raw, int totalSteps) {
        List<Step> notes = new ArrayList<>();
        Set<String> occupied = new HashSet<>();
        for (GeneratedNote note : raw) {
            if (notes.size() >= MAX_NOTES) {
                break;
            }
            if (note.step() < 0 || note.step() >= totalSteps) {
                continue;
            }
            if (!occupied.add(note.step() + "|" + note.pitch())) {
                continue; // the backend rejects duplicate step+pitch outright
            }
            int length = Math.max(1, Math.min(note.length(), totalSteps - note.step()));
            double velocity = Math.min(1.0, note.velocity());
            try {
                notes.add(new Step(note.step(), note.pitch(), velocity, length));
            } catch (IllegalArgumentException invalid) {
                // bad pitch or velocity <= 0 — this note never existed
            }
        }
        return notes;
    }

    // ---- the shape the model must produce ---------------------------------
    // Public: Jackson maps the constrained JSON onto these; PATTERN_SCHEMA
    // above is the same shape spelled out for the API.

    public record GeneratedPattern(List<GeneratedNote> notes) {
    }

    public record GeneratedNote(int step, String pitch, double velocity, int length) {
    }

    /** User-safe failure: the MESSAGE is what the person sees. */
    public static class GenerationUnavailableException extends RuntimeException {
        public GenerationUnavailableException(String userSafeMessage) {
            super(userSafeMessage);
        }
    }
}
