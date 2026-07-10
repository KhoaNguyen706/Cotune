package com.cotune.auth;

import com.cotune.auth.dto.AuthPayload;
import com.cotune.auth.dto.LoginInput;
import com.cotune.auth.dto.RegisterInput;
import com.cotune.user.dto.UserDto;

import java.util.UUID;

public interface AuthService {

    AuthPayload register(RegisterInput input);

    AuthPayload login(LoginInput input);

    /** The account behind an already-authenticated request ("who am I"). */
    UserDto me(UUID userId);
}
