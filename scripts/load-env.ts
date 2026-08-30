/**
 * Reads the .env files into the environment, the way Next.js does.
 *
 * `next dev` and `next build` load `.env.local` and `.env` themselves. A `tsx`
 * script is a bare Node process and loads nothing, so `pnpm db:migrate`
 * against a perfectly good `.env.local` failed with "DATABASE_URL is required
 * to run migrations" while `pnpm dev`, a line further down the same page of
 * docs, worked. Every standalone entry in package.json preloads this.
 *
 * It is a preload — `tsx --import ./scripts/load-env.ts …` — rather than an
 * import at the top of each script, because the environment has to be in place
 * before the first module that reads it while being evaluated, and
 * `src/lib/logger.ts` reads LOG_LEVEL at module scope. An import statement is
 * only the first one until somebody sorts the imports; a preload runs before
 * the entry file's module graph exists at all.
 *
 * Precedence, highest first: a variable already in the environment, then the
 * files below in the order listed. Nothing here overwrites anything — which is
 * what keeps the containers out of it. compose.dev.yaml bind-mounts the whole
 * working tree, so the host's `.env.local` and its host-side DATABASE_URL are
 * sitting right there inside the container; the environment Compose sets wins
 * over that file, exactly as it already does for the `next dev` running two
 * services along.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const nodeEnv = process.env.NODE_ENV ?? "development";

/**
 * The same list `@next/env` builds, in the same order.
 *
 * `.env.local` drops out under NODE_ENV=test, as it does in Next: a test run
 * should be the same run on every machine, and a file one developer happens to
 * have would quietly make it something else.
 */
const envFiles = [
  `.env.${nodeEnv}.local`,
  ...(nodeEnv === "test" ? [] : [".env.local"]),
  `.env.${nodeEnv}`,
  ".env",
];

for (const file of envFiles) {
  const path = resolve(process.cwd(), file);
  // Silent when a file is not there. Most installs have one of these, not
  // four, and a script whose output is a VAPID key pair or a rendered email
  // should not open with three lines about files nobody expected to exist.
  // (Node's own --env-file-if-exists announces every miss on stderr, which is
  // most of why this is not that.)
  //
  // `loadEnvFile` leaves a variable that is already set alone, so the earlier
  // file of the two wins and the environment wins over both. That is the whole
  // precedence rule.
  if (existsSync(path)) process.loadEnvFile(path);
}
