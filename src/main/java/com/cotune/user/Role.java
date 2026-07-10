package com.cotune.user;

/**
 * Coarse-grained roles for role-based access control (RBAC).
 *
 * Deliberately NOT the place for fine-grained rules like "may edit song X" —
 * that is ownership/relationship-based authorization and will be modeled on
 * the data (a song↔collaborator table) in a later session. Roles answer
 * "what KIND of user are you", not "what may you do to THIS object".
 */
public enum Role {
    USER,
    ADMIN
}
