import { CLIENT_NAME_MAX_LENGTH, UNNAMED_CLIENT } from "./constants";

/**
 * What an application calls itself, made safe to put in front of a person.
 *
 * It is typed by whatever registered the client — a stranger, as far as the
 * server can tell — and will be read by someone deciding whether to trust it.
 * Control characters and the invisible format characters go: the bidirectional
 * overrides are how a name is made to read backwards or to hide what follows
 * it, and no honest application's name needs one. Runs of whitespace collapse,
 * so a name cannot be padded to push the redirect address off the screen, and
 * the length is capped.
 *
 * Kept apart from `clients.ts`, which reaches for the database, so the rule
 * can be tested without one.
 */
export function sanitizeClientName(raw: unknown): string {
  if (typeof raw !== "string") return UNNAMED_CLIENT;
  const cleaned = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CLIENT_NAME_MAX_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : UNNAMED_CLIENT;
}
