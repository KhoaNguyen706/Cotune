package com.cotune.user;

import com.cotune.common.mapping.Timestamps;
import com.cotune.user.dto.UserDto;
import org.springframework.stereotype.Component;

/**
 * Entity → DTO only. There is deliberately no toEntity(RegisterInput):
 * turning a registration into a User requires hashing the password, which
 * needs the PasswordEncoder bean — a decision that belongs to the service,
 * not to a dumb translation class.
 */
@Component
public class UserMapper {

    public UserDto toDto(User user) {
        return new UserDto(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                user.getRole(),
                user.getRole() == Role.ADMIN || user.isAiAccess(),
                Timestamps.utc(user.getCreatedAt())
        );
    }
}
