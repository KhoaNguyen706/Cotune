package com.cotune.collab;

import com.cotune.collab.dto.CollaboratorDto;
import com.cotune.collab.dto.ShareSongInput;
import com.cotune.common.exception.ResourceNotFoundException;
import com.cotune.song.Song;
import com.cotune.song.SongRepository;
import com.cotune.user.User;
import com.cotune.user.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@Transactional
@RequiredArgsConstructor
public class CollaboratorServiceImpl implements CollaboratorService {

    private final SongCollaboratorRepository collaboratorRepository;
    private final SongRepository songRepository;
    private final UserRepository userRepository;
    private final CollaboratorMapper collaboratorMapper;

    @Override
    public CollaboratorDto share(ShareSongInput input, UUID actorId) {
        Song song = songRepository.findById(input.songId())
                .orElseThrow(() -> ResourceNotFoundException.song(input.songId()));

        // Normalize through the SAME function the registration path uses, or
        // inviting "Bob@Example.com" would miss the account stored as
        // "bob@example.com" and report a baffling "no such account".
        String email = User.normalizeEmail(input.email());
        User invitee = userRepository.findByEmail(email)
                .orElseThrow(() -> ResourceNotFoundException.userByEmail(email));

        // The owner already holds every right this table can grant. Letting
        // the row exist would create a second, weaker source of truth about
        // the owner's access — and a later unshare() would then appear able
        // to evict the owner from their own song.
        if (invitee.getId().equals(song.getOwnerId())) {
            throw new IllegalArgumentException("You already own this song");
        }

        // UPSERT, not INSERT: re-sharing with an existing collaborator changes
        // their role. Doing it as "delete then insert" would churn created_at
        // (losing when they actually joined) and would briefly revoke access
        // mid-transaction. Mutating the managed entity is both truer and
        // cheaper — Hibernate's dirty checking issues the UPDATE at commit.
        SongCollaborator collaborator = collaboratorRepository
                .findById_SongIdAndId_UserId(song.getId(), invitee.getId())
                .map(existing -> {
                    existing.changeRole(input.role());
                    return existing;
                })
                .orElseGet(() -> collaboratorRepository.save(
                        new SongCollaborator(song.getId(), invitee.getId(), input.role(), actorId)));

        // created_at is filled by @CreationTimestamp on the INSERT — and the
        // INSERT is deferred to commit, i.e. AFTER this method returns. Flush
        // to force it now, or the response hands the client a null timestamp
        // for a brand-new invite. (Same reason SongServiceImpl.update flushes.)
        collaboratorRepository.flush();
        return collaboratorMapper.toDto(collaborator, invitee);
    }

    @Override
    public void unshare(UUID songId, UUID userId) {
        // Check first: a derived delete is silent about rows that were never
        // there, but the API promises NOT_FOUND for "they weren't on the song"
        // — otherwise revoking a typo'd id reports cheerful success.
        if (collaboratorRepository.findById_SongIdAndId_UserId(songId, userId).isEmpty()) {
            throw ResourceNotFoundException.collaborator(songId, userId);
        }
        collaboratorRepository.deleteById_SongIdAndId_UserId(songId, userId);
    }

    @Override
    @Transactional(readOnly = true)
    public List<CollaboratorDto> listFor(UUID songId) {
        List<SongCollaborator> rows =
                collaboratorRepository.findById_SongIdOrderByCreatedAtAsc(songId);
        Map<UUID, User> users = loadUsers(rows);

        return rows.stream()
                .map(row -> collaboratorMapper.toDto(row, requireUser(users, row.getUserId())))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, List<CollaboratorDto>> listForSongs(Collection<UUID> songIds) {
        if (songIds.isEmpty()) {
            return Map.of(); // never send an empty IN () to the database
        }
        List<SongCollaborator> rows =
                collaboratorRepository.findById_SongIdInOrderByCreatedAtAsc(songIds);
        Map<UUID, User> users = loadUsers(rows);

        // Group the ROWS (which know their song) rather than the DTOs (which
        // deliberately don't — a collaborator's identity has nothing to do
        // with which song you happened to look them up through).
        return rows.stream().collect(Collectors.groupingBy(
                SongCollaborator::getSongId,
                LinkedHashMap::new, // preserve the invite ordering from the query
                Collectors.mapping(
                        row -> collaboratorMapper.toDto(row, requireUser(users, row.getUserId())),
                        Collectors.toList())));
    }

    /**
     * Membership rows carry only a user id; the share sheet needs names and
     * emails. Fetch every referenced user in ONE query and join in memory.
     * The naive version — look the user up inside the mapping loop — is an
     * N+1 that stays invisible until a song has more than a few collaborators.
     */
    private Map<UUID, User> loadUsers(List<SongCollaborator> rows) {
        List<UUID> userIds = rows.stream().map(SongCollaborator::getUserId).toList();
        return userRepository.findAllById(userIds).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
    }

    private User requireUser(Map<UUID, User> users, UUID userId) {
        User user = users.get(userId);
        if (user == null) {
            // Unreachable while the FK holds (deleting a user cascades their
            // memberships). If it ever fires, the database disagrees with its
            // own constraints — fail loudly rather than quietly dropping a
            // collaborator out of the list.
            throw ResourceNotFoundException.user(userId);
        }
        return user;
    }
}
