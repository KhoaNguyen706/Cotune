import { describe, expect, it } from "vitest";
import { validateLogin } from "./validateLogin";

describe("validateLogin", () => {
  it("accepts a well-formed email and any non-empty password", () => {
    expect(validateLogin({ email: "you@example.com", password: "x" })).toEqual({});
  });

  it("asks for both fields when the form is empty", () => {
    expect(validateLogin({ email: "", password: "" })).toEqual({
      email: "Enter your email",
      password: "Enter your password",
    });
  });

  it("treats a whitespace-only email as empty", () => {
    expect(validateLogin({ email: "   ", password: "x" }).email).toBe("Enter your email");
  });

  it.each(["not-an-email", "a@", "@b.com", "a b@c.com"])("rejects malformed email %s", (email) => {
    expect(validateLogin({ email, password: "x" }).email).toBe("Enter a valid email address");
  });

  it("tolerates surrounding whitespace, which the submit trims", () => {
    expect(validateLogin({ email: "  you@example.com ", password: "x" })).toEqual({});
  });

  it("is never stricter than registration: no TLD needed, no password policy", () => {
    // @Email on the server accepts user@localhost, so sign-in must too, and
    // a 1-char password is the server's 401 to give, not a form error.
    expect(validateLogin({ email: "user@localhost", password: "1" })).toEqual({});
  });
});
