import { randomUUID } from "node:crypto";
import { DrizzleQueryError, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { createLogger } from "@/lib/logger";
import { createTestUser } from "../helpers/factories";

/**
 * A failed statement, from PostgreSQL to the log line.
 *
 * The unit tests build the errors by hand; these let the database raise them,
 * so a change in what Drizzle or pg puts where is caught here rather than in
 * an operator's log collector. Each first checks that the hazard is real — the
 * value really is in the error — and then that it is not in what was written.
 */

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected the statement to fail");
    },
    (error: unknown) => error,
  );
}

function capture() {
  const lines: string[] = [];
  const logger = createLogger({ write: (line: string) => lines.push(line) });
  return { logger, lines };
}

describe("a failed statement in the log", () => {
  it("keeps the address out of a refused duplicate sign-up", async () => {
    const email = `leak-${randomUUID()}@example.com`;
    await createTestUser({ email });
    const error = await failure(createTestUser({ email }));

    expect(error).toBeInstanceOf(DrizzleQueryError);
    expect((error as Error).message).toContain(email);

    const { logger, lines } = capture();
    logger.error({ err: error }, "Registration failed");

    expect(lines.join("\n")).not.toContain(email);
    const line = JSON.parse(lines[0]) as {
      err: { type: string; query: string; cause: Record<string, string> };
    };
    expect(line.err.type).toBe("DrizzleQueryError");
    expect(line.err.query).toMatch(/^insert into "users"/);
    expect(line.err.cause).toMatchObject({ code: "23505", table: "users" });
    expect(line.err.cause.constraint).toBeTruthy();
  });

  it("keeps the value out of a statement PostgreSQL could not read", async () => {
    const value = `leak-${randomUUID()}`;
    const error = await failure(getDb().execute(sql`select ${value}::uuid`));

    // PostgreSQL quotes the value back in the message itself, not only in
    // Drizzle's parameter list.
    expect((error as Error).message).toContain(value);
    expect(((error as Error).cause as Error).message).toContain(value);

    const { logger, lines } = capture();
    logger.error({ err: error }, "Lookup failed");

    expect(lines.join("\n")).not.toContain(value);
    const line = JSON.parse(lines[0]) as {
      err: { cause: Record<string, string> };
    };
    expect(line.err.cause.code).toBe("22P02");
  });
});
