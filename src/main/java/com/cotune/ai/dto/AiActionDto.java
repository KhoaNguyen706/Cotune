package com.cotune.ai.dto;

import com.cotune.ai.AiAction;
import com.cotune.track.Instrument;
import com.cotune.track.dto.StepDto;

import java.util.List;

/**
 * Wire shape of one proposed edit — the `union AiAction` in schema.graphqls.
 *
 * WHY A UNION AND NOT A `kind` ENUM WITH NULLABLE FIELDS: the flat shape
 * would let the schema describe things that cannot exist — kind: SET_BPM
 * carrying notes, or ADD_LANE with a null instrument — and the client would
 * have to defend against combinations the server never sends. Here each
 * member carries exactly its own fields, all non-null, so the client's
 * inline fragment (`... on AddLane { lane instrument }`) gets a lane and an
 * instrument or it doesn't match at all. Illegal states are unrepresentable
 * on the wire, the same property {@link AiAction} buys in Java.
 *
 * THE NAMES ARE LOAD-BEARING. Spring GraphQL resolves a union member by
 * matching the Java class's SIMPLE NAME to a GraphQL type name
 * (ClassNameTypeResolver). `SetBpm` the record must stay `SetBpm` the type
 * — rename one and the resolver stops finding it AT RUNTIME, for that
 * branch only, which is a nastier failure than a compile error. The
 * schema-vs-record agreement is pinned by an integration test rather than
 * by javac, for exactly that reason.
 *
 * Kept separate from the domain {@link AiAction} on the same reasoning as
 * every other DTO here: the domain record carries validated Step values,
 * this one is glued to the schema and speaks StepDto.
 */
public sealed interface AiActionDto {

    record SetBpm(int bpm) implements AiActionDto {
    }

    record AddLane(String lane, Instrument instrument) implements AiActionDto {
    }

    record SetLanePattern(String lane, List<StepDto> notes) implements AiActionDto {
    }

    record ClearLane(String lane) implements AiActionDto {
    }

    /**
     * Domain → wire.
     *
     * The switch has no `default`, and that is the point of sealing
     * AiAction: add a fifth tool tomorrow and this stops COMPILING until
     * it is mapped. With a default branch — or a `kind` enum — the new
     * action would sail through and silently vanish somewhere between the
     * model and the grid.
     */
    static AiActionDto from(AiAction action) {
        return switch (action) {
            case AiAction.SetBpm(int bpm) ->
                    new SetBpm(bpm);
            case AiAction.AddLane(String lane, Instrument instrument) ->
                    new AddLane(lane, instrument);
            case AiAction.SetLanePattern(String lane, var notes) ->
                    new SetLanePattern(lane, notes.stream()
                            .map(note -> new StepDto(note.step(), note.pitch(), note.velocity(), note.length()))
                            .toList());
            case AiAction.ClearLane(String lane) ->
                    new ClearLane(lane);
        };
    }
}
