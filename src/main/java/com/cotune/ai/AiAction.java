package com.cotune.ai;

import com.cotune.track.Instrument;
import com.cotune.track.Step;

import java.util.List;

/**
 * One edit the AI proposes — the unit {@link BeatComposer} returns and the
 * client applies.
 *
 * WHY A TYPE AT ALL, RATHER THAN PASSING GeminiClient.FunctionCall AROUND:
 * a FunctionCall is a name and an untyped map of JSON a language model
 * produced. This is the same intent AFTER it survived validation — a lane
 * name that isn't blank, an Instrument that is really in the enum, notes
 * that each came out of the {@link Step} constructor. The type change is
 * the point: crossing from FunctionCall into AiAction is the moment
 * untrusted input becomes domain data, and making that a different Java
 * type means you cannot accidentally skip the crossing. (This is the
 * parse-don't-validate idea: make the illegal state unrepresentable
 * downstream instead of re-checking it at every use.)
 *
 * SEALED, so the switch that maps these onto the wire is exhaustive —
 * javac fails the build if a fifth action is added to {@link
 * BeatComposer#TOOLS} and some mapper forgot about it. The alternative — a
 * single record with a `kind` enum and four nullable fields — compiles just
 * fine while silently dropping the new action at runtime, and "the AI's
 * tempo change quietly did nothing" is exactly the bug you cannot see.
 *
 * A PLAN, NOT AN EFFECT. Nothing here has a save() or touches a
 * repository, and that is deliberate: these travel out to the client, which
 * applies them through the ordinary edit paths so undo, the dirty-flush and
 * the delta broadcast keep working without knowing an AI was involved. An
 * AiAction is a suggestion with a type, not a command.
 */
public sealed interface AiAction {

    /** Change the song's tempo. Validated against Song's own bounds. */
    record SetBpm(int bpm) implements AiAction {
    }

    /** Create a lane the beat doesn't have yet. */
    record AddLane(String lane, Instrument instrument) implements AiAction {
    }

    /**
     * Replace everything in a lane with these notes.
     *
     * REPLACE, not merge, because the model was shown the lane's current
     * contents and answered with what the lane should CONTAIN — treating
     * that as an append would double every note it decided to keep.
     */
    record SetLanePattern(String lane, List<Step> notes) implements AiAction {
    }

    /** Empty a lane without removing it. */
    record ClearLane(String lane) implements AiAction {
    }

    // ---- factories -------------------------------------------------------
    // Named for the tools they come from (set_bpm -> setBpm), so a reader
    // comparing BeatComposer.validate against the tool list can match them
    // line for line. `new SetBpm(...)` would read fine too; these just keep
    // the call sites in the vocabulary the prompt and the schema use.

    static AiAction setBpm(int bpm) {
        return new SetBpm(bpm);
    }

    static AiAction addLane(String lane, Instrument instrument) {
        return new AddLane(lane, instrument);
    }

    static AiAction setLanePattern(String lane, List<Step> notes) {
        // Defensive copy: the plan outlives validate()'s local list, and an
        // action that could be mutated after it was validated would make the
        // validation a formality.
        return new SetLanePattern(lane, List.copyOf(notes));
    }

    static AiAction clearLane(String lane) {
        return new ClearLane(lane);
    }
}
