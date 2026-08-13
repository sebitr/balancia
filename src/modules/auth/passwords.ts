import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

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

export class PasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordError";
  }
}

/** Bounds that keep a pathological input from becoming a denial of service. */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 512;

export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordError(
      `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordError("That password is too long.");
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
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
