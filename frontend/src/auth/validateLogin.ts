export type LoginFields = { email: string; password: string };

/**
 * Sign-in checks SHAPE, never POLICY. The email must look like an address
 * (same loose rule the server's @Email applies, so a sign-in can never
 * reject an address registration accepted); the password only has to be
 * there. Re-checking the 8-72 length rule here would lock out anyone whose
 * password predates a future policy change, and would hint at what a valid
 * password looks like — LoginInput.java makes the same call server-side.
 */
export function validateLogin({ email, password }: LoginFields): Partial<LoginFields> {
  const errors: Partial<LoginFields> = {};
  const trimmed = email.trim();
  if (!trimmed) errors.email = "Enter your email";
  else if (!/^[^\s@]+@[^\s@]+$/.test(trimmed)) errors.email = "Enter a valid email address";
  if (!password) errors.password = "Enter your password";
  return errors;
}
