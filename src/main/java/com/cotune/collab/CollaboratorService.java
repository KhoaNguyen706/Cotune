package com.cotune.collab;

import com.cotune.collab.dto.CollaboratorDto;
import com.cotune.collab.dto.ShareSongInput;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Use cases for song membership: who is on a song, and how do they get on
 * or off it.
 *
 * Note what is NOT here: "may this user edit?". That question is answered by
 * SongAccess, which owns the whole permission rule (owner OR editor OR ...).
 * Splitting it would mean two classes each holding half of the rule — which
 * is precisely how the frontend's copy of the edit rule drifted out of sync
 * with the server's in Session 14. This service manages MEMBERSHIP; SongAccess
 * interprets it. One fact, one owner.
 */
public interface CollaboratorService {

    /**
     * Invite someone, or change the role of someone already invited.
     * Idempotent by design: sharing with the same person twice is a role
     * update, not a duplicate row and not an error — that is the behaviour a
     * share sheet needs (you re-open it and flip EDITOR to VIEWER).
     */
    CollaboratorDto share(ShareSongInput input, UUID actorId);

    /** Revoke access. NOT_FOUND if that user was never on the song. */
    void unshare(UUID songId, UUID userId);

    /** Everyone on one song, in invite order. */
    List<CollaboratorDto> listFor(UUID songId);

    /**
     * Batch variant for @BatchMapping: memberships for many songs in one
     * round trip. Songs with no collaborators are simply absent from the map;
     * the caller substitutes an empty list, because a DataLoader must return
     * something for every key it was given.
     */
    Map<UUID, List<CollaboratorDto>> listForSongs(Collection<UUID> songIds);
}
