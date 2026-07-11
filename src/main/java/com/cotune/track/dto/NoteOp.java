package com.cotune.track.dto;

import com.cotune.track.NoteOpType;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * One note delta, as it arrives over the WebSocket.
 *
 * THIS IS THE WHOLE POINT OF SESSION 16, so it is worth being precise about
 * what it is NOT. It is not an event-log entry: nothing persists this record.
 * The lane's `pattern` column remains the single source of truth; the op is
 * read, applied to that column, and thrown away. What changed is only the
 * WIRE — we send "add C3 at step 4" instead of "here is my whole lane".
 *
 * Why that difference decides whether collaboration works at all: two editors
 * in one lane each hold a snapshot taken moments ago. If each sends its whole
 * array, the second one to arrive overwrites the first person's note, because
 * their array simply doesn't contain it — the data loss is silent and total.
 * A delta cannot do that: it says what CHANGED, so the server can merge it
 * into whatever the lane looks like right now, including edits it has never
 * heard of.
 *
 * velocity/length are meaningless for REMOVE (a note is identified by step +
 * pitch alone) and are ignored there rather than validated — see NoteOpType.
 */
public record NoteOp(
        @NotNull NoteOpType type,
        @NotNull UUID trackId,
        @Min(0) int step,
        @NotBlank String pitch,
        double velocity,
        int length
) {
}
