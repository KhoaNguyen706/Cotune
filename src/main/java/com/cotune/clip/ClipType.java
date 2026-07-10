package com.cotune.clip;

/**
 * What a clip places on the timeline: a BEAT references a track's pattern
 * (looped for the clip's length), AUDIO references an uploaded file.
 * Stored as STRING (see Instrument.java for the ordinal trap).
 */
public enum ClipType {
    BEAT,
    AUDIO
}
