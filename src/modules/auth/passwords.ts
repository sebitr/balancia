import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { containsIdentity, isCommonPassword } from "./common-passwords";

/**
 * Password hashing.
 *
 * Uses scrypt, which is part of Node's standard library — no native
 * dependency, no third-party package, and a memory-hard KDF that is the
 * right shape for password storage (unlike a bare SHA family hash).
 *
 * Parameters follow the OWASP recommendation for scrypt: N = 2^17 (131072),
 * r = 8, p = 1, which costs roughly 128 MB of memory per hash. That is
 * deliberately expensive — it is what makes an offline attack on a stolen
 * database impractical.
 *
 * The stored format is self-describing so the parameters can be raised later
 * without invalidating existing hashes:
 *
 *     scrypt$N$r$p$<salt base64url>$<hash base64url>
 */

/**
 * Promisified scrypt. Written out rather than `promisify`d because the
 * options-taking overload does not survive promisify's type inference.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

const PARAMS = {
  N: 1 << 17,
  r: 8,
  p: 1,
  keyLength: 64,
  saltLength: 16,
} as const;

/**
 * scrypt needs `maxmem` above the default 32 MB for these parameters:
 * memory ≈ 128 * N * r bytes, plus headroom.
 */
const MAX_MEMORY = 256 * 1024 * 1024;

/**
 * A refusal the person choosing the password is meant to read.
 *
 * Carries a `code` for the same reason `AuthError` does: `lib/server-errors.ts`
 * translates it, and a policy that only speaks English is a policy half the
 * readers of this app cannot act on. Listed in `SAFE_ERRORS` in
 * `lib/actions.ts`, without which every one of these would reach the form as
 * "something went wrong" and the log as an ERROR.
 */
export type PasswordErrorCode =
  | "passwordTooShort"
  | "passwordTooLong"
  | "passwordCommon"
  | "passwordPersonal";

export class PasswordError extends Error {
  constructor(
    message: string,
    readonly code: PasswordErrorCode = "passwordTooShort",
  ) {
    super(message);
    this.name = "PasswordError";
  }
}

/** Bounds that keep a pathological input from becoming a denial of service. */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 512;

/**
 * What the account is called, for the checks that need to know.
 *
 * Optional throughout: `hashPassword` is reached from places that hold a
 * password and nothing else, and the length bounds — the part that protects
 * the *server* rather than the account — must run there regardless.
 */
export interface PasswordIdentity {
  readonly email?: string | null;
  readonly name?: string | null;
}

/**
 * The rules a chosen password has to clear.
 *
 * Length came first and is still the only one the server needs for its own
 * sake. The other two are for the account: `MIN_PASSWORD_LENGTH` says nothing
 * about `password123`, which is ten characters and is guessed within the first
 * thousand tries of every credential-stuffing run there is, nor about the
 * address the person is signing up with typed back as its own password.
 *
 * Run on every path that sets a password — registration, reset and change —
 * because a rule that only applies to new accounts leaves the reset form as
 * the way around it.
 */
export function assertPasswordPolicy(
  password: string,
  identity: PasswordIdentity = {},
): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordError(
      `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
      "passwordTooShort",
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordError("That password is too long.", "passwordTooLong");
  }
  if (isCommonPassword(password)) {
    throw new PasswordError(
      "That password is one of the most commonly used ones. Please choose another.",
      "passwordCommon",
    );
  }
  if (containsIdentity(password, identity)) {
    throw new PasswordError(
      "Your password should not contain your name or email address.",
      "passwordPersonal",
    );
  }
}

export async function hashPassword(
  password: string,
  identity: PasswordIdentity = {},
): Promise<string> {
  assertPasswordPolicy(password, identity);
  const salt = randomBytes(PARAMS.saltLength);
  const derived = await scryptAsync(
    password.normalize("NFKC"),
    salt,
    PARAMS.keyLength,
    { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAX_MEMORY },
  );

  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/**
 * Verifies a password against a stored hash in constant time.
 *
 * Returns false rather than throwing for a malformed hash: a corrupted row
 * should deny access, not produce a 500 that distinguishes it from a wrong
 * password.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, nText, rText, pText, saltText, hashText] = parts;
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  let expected: Buffer;
  let salt: Buffer;
  try {
    expected = Buffer.from(hashText, "base64url");
    salt = Buffer.from(saltText, "base64url");
  } catch {
    return false;
  }
  if (expected.length === 0 || salt.length === 0) {
    return false;
  }

  let derived: Buffer;
  try {
    derived = await scryptAsync(
      password.normalize("NFKC"),
      salt,
      expected.length,
      { N, r, p, maxmem: MAX_MEMORY },
    );
  } catch {
    return false;
  }

  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}

/**
 * A hash to compare against when the account does not exist.
 *
 * Sign-in must take the same time whether or not the email is registered,
 * otherwise response timing reveals which addresses have accounts. Callers
 * verify against this when no user is found.
 */
let dummyHashPromise: Promise<string> | undefined;

export async function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString("base64url"));
  return dummyHashPromise;
}
