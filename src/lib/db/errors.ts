/**
 * Reading PostgreSQL's answer when a write is refused.
 *
 * Lives here rather than beside the first caller that needed it. A unique
 * index is how two of this codebase's guarantees are actually enforced — one
 * account per email address, one entry per client key — and both have to
 * recognise the same refusal. Importing that recognition from the auth service,
 * where it started, would drag password hashing into the expense module's
 * graph to ask a question about a SQLSTATE.
 */

/**
 * Detects PostgreSQL's unique_violation (SQLSTATE 23505).
 *
 * Drizzle wraps driver errors, so the code lives on `cause` rather than on the
 * error itself; matching on the message text would break the moment the
 * wrapper's wording changes.
 */
export function isUniqueViolation(error: unknown): boolean {
  const codeOf = (value: unknown): string | undefined =>
    typeof value === "object" && value !== null && "code" in value
      ? String((value as { code: unknown }).code)
      : undefined;

  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (codeOf(current) === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
