package com.cotune.user;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    // Derived queries — Spring Data generates the SQL from the method name.
    // Callers MUST pass an already-normalized email (User.normalizeEmail);
    // the query itself is a plain equality match.
    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);
}
