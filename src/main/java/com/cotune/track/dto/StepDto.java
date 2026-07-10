package com.cotune.track.dto;

/**
 * Wire shape of one note event. Identical fields to the domain Step today —
 * still worth keeping separate: the domain record carries validation and
 * can evolve (e.g. per-note length), while this stays glued to the GraphQL
 * schema. Cheap insurance, same reasoning as every other DTO here.
 */
public record StepDto(int step, String pitch, double velocity, int length) {
}
