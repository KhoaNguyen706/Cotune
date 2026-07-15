package com.cotune.history;

import com.cotune.history.dto.SongEventDto;
import com.cotune.track.Step;

import java.util.List;
import java.util.UUID;

public interface SongHistoryService {

    /**
     * One note landed (possibly replacing the note at its step+pitch).
     * Called INSIDE the edit's transaction — the history row and the
     * pattern change commit or roll back together; a history that can
     * disagree with the data is worse than none.
     */
    void recordNoteAdd(UUID songId, UUID trackId, UUID actorId, Step note);

    /** One note removed — `note` is the note AS IT WAS (the wire's remove
     *  op only identifies step+pitch; the server saw the rest). */
    void recordNoteRemove(UUID songId, UUID trackId, UUID actorId, Step note);

    /** The whole grid replaced at once (HTTP save, kept restore). */
    void recordPatternSet(UUID songId, UUID trackId, UUID actorId, List<Step> pattern);

    /** The song's history page, newest first, names resolved. */
    List<SongEventDto> history(UUID songId, int limit);

    /**
     * The lane's grid as of (and including) event {@code eventId} — replay
     * from the lane's birth, PATTERN_SET replacing, ADD upserting, REMOVE
     * deleting. This is the whole restore feature: the CLIENT lands the
     * returned notes exactly like AI generation (undoable local edit), so
     * keeping a restore is an ordinary save and history records it too.
     */
    List<Step> patternAt(UUID trackId, long eventId);
}
