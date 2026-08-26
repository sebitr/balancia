/**
 * The credential that opens the public demo.
 *
 * Deliberately not an email address and not a password: `demo` / `demo` is
 * what a visitor expects to be able to type, and it authenticates nobody —
 * there is no account behind it until one is minted (see sessions.ts). That is
 * why this file holds no hash and does no comparison in constant time. There
 * is nothing here to steal.
 *
 * Kept free of server imports so the matching rule can be tested on its own,
 * rather than only through a Server Action that a unit test cannot reach.
 */

export const DEMO_USERNAME = "demo";
export const DEMO_PASSWORD = "demo";

/**
 * Whether a sign-in submission is the demo credential.
 *
 * Tolerant of what a browser will hand over — surrounding space, a capital D
 * from a phone keyboard's autocapitalisation — because the alternative is a
 * visitor typing exactly what the page told them to and being refused. The
 * password is matched as typed: it is not a secret, but silently accepting
 * `DEMO ` as a password is a habit worth not forming.
 *
 * Says nothing about whether this instance *is* a demo. The caller pairs it
 * with `DEMO_MODE`, so a real deployment cannot be talked into this path by
 * anyone who has read the source.
 */
export function matchesDemoCredential(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const { email, password } = input as {
    email?: unknown;
    password?: unknown;
  };
  if (typeof email !== "string" || typeof password !== "string") return false;
  return (
    email.trim().toLowerCase() === DEMO_USERNAME && password === DEMO_PASSWORD
  );
}
