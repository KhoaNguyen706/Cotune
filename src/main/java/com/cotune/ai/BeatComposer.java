package com.cotune.ai;

import com.cotune.beat.Beat;
import com.cotune.beat.BeatRepository;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.common.metrics.CotuneMetrics;
import com.cotune.song.Song;
import com.cotune.track.Instrument;
import com.cotune.track.Step;
import com.cotune.track.Track;
import com.cotune.track.TrackRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * "Make me a sad beat" → a whole beat, not one lane.
 *
 * WHAT MAKES THIS DIFFERENT FROM PatternGenerator: that one answers a
 * question ("what notes go in THIS lane?") and the shape of the answer is
 * fixed before the call. Here the model decides WHAT TO DO — add a lane,
 * write a pattern, slow the tempo down — by choosing from a set of tools.
 * A sad beat is not a pattern; it is 70 BPM, a minor piano figure, a bass
 * that lands late, and brushed drums that stay out of the way. No single
 * lane can express that, which is why one prompt has to be able to move
 * more than one thing.
 *
 * THE MODEL PROPOSES; IT DOES NOT EXECUTE. Nothing in this class writes to
 * the database. It returns a PLAN — a list of {@link AiAction} — and the
 * client applies it through the ordinary edit paths, which is what keeps
 * undo, the dirty-flush and the delta broadcast working without knowing an
 * AI was involved. It is the same decision PatternGenerator made ("returns
 * the notes, the CLIENT lands them"), and it matters more here: a plan that
 * saved itself would be an AI with write access to your song, and the
 * first thing you would want is the undo it just skipped.
 *
 * EVERY ARGUMENT IS RE-VALIDATED. Gemini's schema constrains the JSON's
 * shape, and shape is not meaning: nothing stops a schema-valid call from
 * naming instrument "SAD", a BPM of 900, or a lane that does not exist. So
 * each call is rebuilt through the same domain rules a human's edit meets
 * (Instrument.valueOf, Song's BPM bounds, the Step constructor via
 * PatternGenerator.sanitize) and dropped if it doesn't survive. The tool
 * list is not a security boundary; this is.
 */
@Component
@RequiredArgsConstructor
public class BeatComposer {

    private static final Logger log = LoggerFactory.getLogger(BeatComposer.class);

    /** A plan longer than this is a runaway, not an arrangement: a beat has
     *  a handful of lanes, and each lane needs at most one pattern. */
    static final int MAX_ACTIONS = 24;

    /** Matches Track's own rule (non-blank) plus a ceiling, so a model that
     *  decides to name a lane with a paragraph doesn't get one. */
    static final int MAX_LANE_NAME = 40;

    static final String SYSTEM_PROMPT = """
            You are a beat maker working inside Cotune, a collaborative step \
            sequencer. A bar is 16 sixteenth-note steps. You will be shown the \
            current beat — its lanes and their notes as text grids (x = hit, \
            — = held, . = silence) — and a request.

            THE REQUEST LEADS. Do what THIS request asks before you do what a \
            genre usually does. If it names an instrument, a tempo, a key, a \
            mood or a section, honour that exactly; only fall back to the \
            conventions below to fill in what the request left unsaid. A prompt \
            for "just drums and a bassline at 96" is two lanes at 96, not a \
            full arrangement.

            Build what was asked for by CALLING TOOLS. Think like someone \
            making the track, not like someone filling a form:
            - Tempo carries mood, and real genres sit at known tempos. Call \
            set_bpm to match the request: lofi/boom-bap 70-90, hip-hop 85-100, \
            trap 130-150 (half-time feel), house 120-128, techno 128-135, \
            drum-and-bass 170-176, reggaeton ~95, ballad 60-80. Pick a value \
            inside the named range; only leave the tempo alone when the \
            request implies nothing about feel or speed.
            - Meter, when it matters. Call set_time_signature for a request \
            that implies one — a waltz or 3/4, a 6/8 shuffle, a 7/8 oddity. \
            Most beats are 4/4; don't set it just to restate that.
            - A beat needs more than drums. Add the lanes the music needs \
            (add_lane) and write each one (set_lane_pattern). A typical beat \
            is 3-5 lanes.
            - Write into lanes that already exist rather than duplicating \
            them. Only add a lane when nothing suitable is there.
            - Remove, don't just empty. If the request asks to drop an \
            instrument, or wants a sparser beat that some existing lane is \
            fighting, call remove_lane to delete it. Use clear_lane only when \
            the lane should stay but start empty. Never remove a lane you \
            just added.
            - Steps are 0-based and must stay below the beat's step count. \
            Pitch is scientific notation (C4, F#2): kicks and snares near C2, \
            bass C1-C3, chords and melodies C4-C6. Velocity 0.1-1.0 — vary it, \
            accents make grooves. Length is in steps (drums usually 1, held \
            bass and pads longer). Never place two notes at the same step and \
            pitch.
            - Minor keys and space between hits read as sad; swing and ghost \
            notes read as human. Silence is a choice you are allowed to make.

            Call every tool you need in one go. Do not explain yourself.""";

    /** The note argument shared by set_lane_pattern — the same shape
     *  PatternGenerator's schema uses, because it is the same note. */
    private static final Map<String, Object> NOTE_SCHEMA = Map.of(
            "type", "OBJECT",
            "properties", Map.of(
                    "step", Map.of("type", "INTEGER",
                            "description", "0-based sixteenth-note position, below the beat's step count"),
                    "pitch", Map.of("type", "STRING",
                            "description", "Scientific pitch notation, e.g. C2 or F#4"),
                    "velocity", Map.of("type", "NUMBER",
                            "description", "Loudness from 0.1 (soft) to 1.0 (accent)"),
                    "length", Map.of("type", "INTEGER",
                            "description", "Duration in steps; 1 = one sixteenth note")),
            "required", List.of("step", "pitch", "velocity", "length"));

    /**
     * The tools, and the whole surface the model can move.
     *
     * Deliberately small, and every tool is an edit a person can already make
     * by hand — set the tempo or meter, add a lane, write it, empty it,
     * delete it. The model's reach is a SUBSET of the user's own powers, which
     * is what makes "let the AI edit it" something other than alarming. That
     * includes remove_lane: deleting a lane is destructive and NOT undoable
     * (Ctrl+Z covers patterns only), but it is a power the user already has,
     * and the plan is previewed and flagged irreversible before Apply — the
     * model still only ever PROPOSES. What stays off the list is anything
     * outside those powers: no sharing, no deleting the song, no touching
     * someone else's.
     */
    static final List<Map<String, Object>> TOOLS = List.of(
            Map.of(
                    "name", "set_bpm",
                    "description", "Set the song's tempo. Use when the requested feel implies a speed.",
                    "parameters", Map.of(
                            "type", "OBJECT",
                            "properties", Map.of("bpm", Map.of(
                                    "type", "INTEGER",
                                    "description", "Beats per minute, %d-%d".formatted(Song.MIN_BPM, Song.MAX_BPM))),
                            "required", List.of("bpm"))),
            Map.of(
                    "name", "set_time_signature",
                    "description", "Set the song's time signature. Use only when the request implies a "
                            + "meter other than common time; most beats are 4/4.",
                    "parameters", Map.of(
                            "type", "OBJECT",
                            "properties", Map.of("timeSignature", Map.of(
                                    "type", "STRING",
                                    "description", "Like 4/4, 3/4 or 6/8 — digits, a slash, digits")),
                            "required", List.of("timeSignature"))),
            Map.of(
                    "name", "add_lane",
                    "description", "Add a new instrument lane to the beat. Only when no suitable lane exists.",
                    "parameters", Map.of(
                            "type", "OBJECT",
                            "properties", Map.of(
                                    "lane", Map.of("type", "STRING",
                                            "description", "Short lane name, e.g. kick, bass, keys"),
                                    "instrument", Map.of(
                                            "type", "STRING",
                                            "enum", instrumentNames(),
                                            "description", "Which instrument plays this lane")),
                            "required", List.of("lane", "instrument"))),
            Map.of(
                    "name", "set_lane_pattern",
                    "description", "Replace everything in a lane with these notes. The lane must exist "
                            + "or have been added by add_lane in this same plan.",
                    "parameters", Map.of(
                            "type", "OBJECT",
                            "properties", Map.of(
                                    "lane", Map.of("type", "STRING", "description", "The lane's name"),
                                    "notes", Map.of(
                                            "type", "ARRAY",
                                            "description", "The note events, in any order",
                                            "items", NOTE_SCHEMA)),
                            "required", List.of("lane", "notes"))),
            Map.of(
                    "name", "clear_lane",
                    "description", "Remove every note from a lane, leaving it empty. Use when the lane "
                            + "should stay but start over — to delete the lane entirely, use remove_lane.",
                    "parameters", Map.of(
                            "type", "OBJECT",
                            "properties", Map.of(
                                    "lane", Map.of("type", "STRING", "description", "The lane's name")),
                            "required", List.of("lane"))),
            Map.of(
                    "name", "remove_lane",
                    "description", "Delete a lane and its notes entirely. Use when the request asks to "
                            + "drop an instrument. Only for a lane that already exists — never one added "
                            + "in this same plan.",
                    "parameters", Map.of(
                            "type", "OBJECT",
                            "properties", Map.of(
                                    "lane", Map.of("type", "STRING", "description", "The lane's name")),
                            "required", List.of("lane"))));

    private final GeminiClient gemini;
    private final BeatRepository beatRepository;
    private final TrackRepository trackRepository;
    private final CotuneMetrics metrics;

    /**
     * The DB read, separated from the API call for the same reason as
     * PatternGenerator.laneContext: this returns in microseconds, and the
     * Gemini round trip that follows holds no connection out of a pool of
     * five.
     *
     * The lanes come from TrackRepository rather than beat.getTracks(),
     * because Beat has no such collection — deliberately. Entities here
     * point at their parent and never hold the child list, so the graph
     * shape lives in the resolvers that batch it. Reusing the existing
     * findByBeatIdIn... (with a one-element list) also gets ORDER BY
     * position for free: the model reads the lanes in the same order the
     * user sees them, which matters for a prompt that says "the lanes
     * already in this beat".
     */
    @Transactional(readOnly = true)
    public BeatContext beatContext(UUID beatId) {
        Beat beat = beatRepository.findById(beatId)
                .orElseThrow(() -> ResourceNotFoundException.beat(beatId));
        List<Track> tracks = trackRepository.findByBeatIdInOrderByPositionAsc(List.of(beatId));
        List<String> lanes = tracks.stream()
                .map(track -> "%s [%s]".formatted(track.getName(), track.getInstrument().name()))
                .toList();
        // LinkedHashSet, not a plain Set: validate() only needs membership,
        // but the summaries above and these names should tell the same story
        // in the same order when either is read in a log.
        Set<String> laneNames = tracks.stream()
                .map(Track::getName)
                .collect(Collectors.toCollection(LinkedHashSet::new));
        return new BeatContext(beat.getSong().getId(), beat.getName(), beat.totalSteps(), lanes, laneNames);
    }

    /** Everything the prompt says about the beat being composed into. */
    public record BeatContext(UUID songId, String beatName, int totalSteps,
                              List<String> laneSummaries, Set<String> laneNames) {
    }

    /**
     * One request, one validated plan.
     *
     * @throws PatternGenerator.GenerationUnavailableException with a
     *                                                         user-safe message when the model can't deliver
     */
    public List<AiAction> compose(String songContext, BeatContext beat, String prompt) {
        if (!gemini.enabled()) {
            throw new PatternGenerator.GenerationUnavailableException(
                    "AI generation isn't configured on this server (GEMINI_API_KEY is not set).");
        }

        List<GeminiClient.FunctionCall> calls;
        try {
            calls = gemini.generateToolCalls(SYSTEM_PROMPT, """
                    %s
                    Target beat: "%s" — %d steps (0..%d), %d step%s per bar.
                    Lanes already in this beat: %s
                    Request: %s""".formatted(
                    songContext, beat.beatName(), beat.totalSteps(), beat.totalSteps() - 1,
                    16, "s",
                    beat.laneSummaries().isEmpty() ? "(none — this beat is empty)"
                            : String.join(", ", beat.laneSummaries()),
                    prompt), TOOLS);
        } catch (GeminiClient.RateLimitedException tooFast) {
            throw new PatternGenerator.GenerationUnavailableException(
                    "The AI is rate-limited right now — try again in a minute.");
        } catch (GeminiClient.UnusableResponseException refused) {
            log.warn("AI beat plan was unusable: {}", refused.toString());
            throw new PatternGenerator.GenerationUnavailableException(
                    "The AI didn't produce a usable plan — try rephrasing.");
        } catch (GeminiClient.ApiErrorException apiFailure) {
            // Generic on purpose: API error bodies name models, projects and
            // quota details that don't belong in a user-facing message.
            log.warn("AI beat composition failed: {}", apiFailure.toString());
            throw new PatternGenerator.GenerationUnavailableException(
                    "The AI hit an error — try again shortly.");
        }

        List<AiAction> plan = validate(calls, beat);

        // Recorded HERE and not inside validate(), for two reasons. validate()
        // is the one piece of this class covered by a keyless unit test
        // (BeatComposerValidateTest), and a metrics call in there would drag a
        // MeterRegistry into every one of those cases to observe something the
        // test does not assert on. And this is the only spot that sees both
        // sides of the subtraction — what the model proposed and what survived.
        metrics.aiPlanValidated(plan.size(), calls.size() - plan.size());

        if (plan.isEmpty()) {
            // Deliberately BEFORE the throw's early exit: a plan validated down
            // to nothing is the single most interesting event this metric can
            // record, and counting it only on the happy path would hide exactly
            // the failure the counter exists to reveal.
            throw new PatternGenerator.GenerationUnavailableException(
                    "The AI couldn't turn that into edits — try describing the beat differently.");
        }

        metrics.aiPlanProposed();
        return plan;
    }

    /**
     * Proposal → plan. Every call is rebuilt from its arguments against the
     * real domain rules and dropped if it doesn't survive; a bad call costs
     * one action, never the whole request, because a plan that is 90% good
     * is still a beat and refusing it outright would be worse than the one
     * lane it got wrong.
     *
     * The lane bookkeeping is the subtle part: set_lane_pattern may target a
     * lane that does not exist YET because add_lane earlier in this same
     * plan is going to create it. So known-lane tracking starts from the
     * beat's real lanes and grows as the plan adds them — which also means a
     * pattern for a lane nobody ever created gets dropped rather than
     * silently landing nowhere.
     */
    List<AiAction> validate(List<GeminiClient.FunctionCall> calls, BeatContext beat) {
        List<AiAction> plan = new ArrayList<>();
        // Case-insensitive: the model routinely calls add_lane("Kick") and
        // then set_lane_pattern("kick"), which is the same lane to everyone
        // except a string comparison.
        Set<String> known = new HashSet<>();
        beat.laneNames().forEach(name -> known.add(name.toLowerCase(Locale.ROOT)));
        Set<String> patterned = new HashSet<>();
        // Lanes created by add_lane in THIS plan — remove_lane refuses to
        // delete one of them, because "add a lane then delete it" is a plan
        // that spent two actions to do nothing, and far more likely a model
        // confusing itself than an intent.
        Set<String> addedInPlan = new HashSet<>();

        for (GeminiClient.FunctionCall call : calls) {
            if (plan.size() >= MAX_ACTIONS) {
                break;
            }
            Map<String, Object> args = call.args() == null ? Map.of() : call.args();
            try {
                switch (String.valueOf(call.name())) {
                    case "set_bpm" -> {
                        Integer bpm = asInt(args.get("bpm"));
                        // Song's own bounds, not a copy of them: a model that
                        // asks for 900 BPM would have been rejected by the
                        // mutation anyway, so drop it here where we can say so.
                        if (bpm != null && bpm >= Song.MIN_BPM && bpm <= Song.MAX_BPM) {
                            plan.add(AiAction.setBpm(bpm));
                        }
                    }
                    case "set_time_signature" -> {
                        String signature = asString(args.get("timeSignature"));
                        // Song's own rule, same reasoning as the BPM bounds: a
                        // shape the mutation would reject ("seven") is dropped
                        // here rather than carried to a failure downstream.
                        if (Song.isValidTimeSignature(signature)) {
                            plan.add(AiAction.setTimeSignature(signature));
                        }
                    }
                    case "add_lane" -> {
                        String lane = laneName(args.get("lane"));
                        Instrument instrument = instrument(args.get("instrument"));
                        if (lane == null || instrument == null) {
                            break;
                        }
                        // Adding a lane that already exists would give you two
                        // lanes called "kick" and a pattern that lands in a
                        // coin-flip one of them.
                        String key = lane.toLowerCase(Locale.ROOT);
                        if (known.add(key)) {
                            addedInPlan.add(key);
                            plan.add(AiAction.addLane(lane, instrument));
                        }
                    }
                    case "set_lane_pattern" -> {
                        String lane = laneName(args.get("lane"));
                        if (lane == null || !known.contains(lane.toLowerCase(Locale.ROOT))) {
                            break; // a lane nobody has or will create
                        }
                        if (!patterned.add(lane.toLowerCase(Locale.ROOT))) {
                            break; // second pattern for one lane: the first wins
                        }
                        List<Step> notes = notes(args.get("notes"), beat.totalSteps());
                        if (!notes.isEmpty()) {
                            plan.add(AiAction.setLanePattern(lane, notes));
                        }
                    }
                    case "clear_lane" -> {
                        String lane = laneName(args.get("lane"));
                        if (lane != null && known.contains(lane.toLowerCase(Locale.ROOT))) {
                            plan.add(AiAction.clearLane(lane));
                        }
                    }
                    case "remove_lane" -> {
                        String lane = laneName(args.get("lane"));
                        if (lane == null) {
                            break;
                        }
                        String key = lane.toLowerCase(Locale.ROOT);
                        // Only a lane that really exists and wasn't just added
                        // by this plan. Removing it takes it out of `known`, so
                        // any later pattern or clear aimed at it is dropped
                        // rather than landing on a lane that is now gone.
                        if (known.contains(key) && !addedInPlan.contains(key)) {
                            known.remove(key);
                            patterned.remove(key);
                            plan.add(AiAction.removeLane(lane));
                        }
                    }
                    default -> log.warn("AI proposed an unknown tool: {}", call.name());
                }
            } catch (RuntimeException badArguments) {
                // One malformed call must not cost the other lanes.
                log.warn("Dropped an AI tool call ({}): {}", call.name(), badArguments.toString());
            }
        }
        return plan;
    }

    /** Reuses the pattern sanitizer wholesale — an AI note is an AI note,
     *  and having two rules for what one is would be how they drift. */
    private static List<Step> notes(Object raw, int totalSteps) {
        if (!(raw instanceof List<?> items)) {
            return List.of();
        }
        List<PatternGenerator.GeneratedNote> parsed = new ArrayList<>();
        for (Object item : items) {
            if (!(item instanceof Map<?, ?> note)) {
                continue;
            }
            Integer step = asInt(note.get("step"));
            Integer length = asInt(note.get("length"));
            Double velocity = asDouble(note.get("velocity"));
            Object pitch = note.get("pitch");
            if (step == null || pitch == null) {
                continue;
            }
            parsed.add(new PatternGenerator.GeneratedNote(
                    step,
                    String.valueOf(pitch),
                    velocity == null ? 0.8 : velocity,
                    length == null ? 1 : length));
        }
        return PatternGenerator.sanitize(parsed, totalSteps);
    }

    /** A trimmed non-blank string, or null. Used for the time signature,
     *  where blank and null are the same "the model didn't really answer". */
    private static String asString(Object raw) {
        if (raw == null) {
            return null;
        }
        String value = String.valueOf(raw).strip();
        return value.isBlank() ? null : value;
    }

    private static String laneName(Object raw) {
        if (raw == null) {
            return null;
        }
        String name = String.valueOf(raw).strip();
        if (name.isBlank()) {
            return null;
        }
        return name.length() > MAX_LANE_NAME ? name.substring(0, MAX_LANE_NAME).strip() : name;
    }

    private static Instrument instrument(Object raw) {
        if (raw == null) {
            return null;
        }
        try {
            return Instrument.valueOf(String.valueOf(raw).strip().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException notAnInstrument) {
            return null; // the enum is the authority, even against an "enum" schema
        }
    }

    /** Gemini's JSON numbers arrive as Integer, Double or String depending on
     *  the model's mood; none of that is worth a failure. */
    private static Integer asInt(Object raw) {
        if (raw instanceof Number number) {
            return number.intValue();
        }
        try {
            return raw == null ? null : (int) Double.parseDouble(String.valueOf(raw).strip());
        } catch (NumberFormatException notANumber) {
            return null;
        }
    }

    private static Double asDouble(Object raw) {
        if (raw instanceof Number number) {
            return number.doubleValue();
        }
        try {
            return raw == null ? null : Double.parseDouble(String.valueOf(raw).strip());
        } catch (NumberFormatException notANumber) {
            return null;
        }
    }

    private static List<String> instrumentNames() {
        return Arrays.stream(Instrument.values()).map(Enum::name).toList();
    }
}
