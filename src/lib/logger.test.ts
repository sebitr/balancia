import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { mobileApiError } from "@/app/api/mobile";
import { runAction } from "./actions";
import { createLogger } from "./logger";

/**
 * What actually reaches the log when a statement fails.
 *
 * The logger is the real one, options and all, writing into an array instead
 * of stdout — so these assert on the line an operator's collector would
 * receive, not on what a call site passed in. The two funnels every
 * unexpected error goes through, Server Actions and the mobile API, are driven
 * with the errors the database really raises.
 */

const lines = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./logger")>();
  return {
    ...actual,
    logger: actual.createLogger({ write: (line: string) => lines.push(line) }),
  };
});

vi.mock("@/lib/telemetry/crash-reporter", () => ({
  reportCrash: vi.fn(async () => "disabled"),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const entries = messages[namespace] as Record<string, string>;
    return Object.assign((key: string) => entries[key] ?? key, {
      has: (key: string) => key in entries,
    });
  },
}));

const SENTINEL = "leak-me@example.com";

function uniqueViolation(): DatabaseError {
  return Object.assign(
    new DatabaseError(
      'duplicate key value violates unique constraint "users_email_key"',
      120,
      "error",
    ),
    {
      severity: "ERROR",
      code: "23505",
      detail: `Key (email)=(${SENTINEL}) already exists.`,
      table: "users",
      constraint: "users_email_key",
    },
  );
}

function failedInsert(): DrizzleQueryError {
  return new DrizzleQueryError(
    'insert into "users" ("email", "password_hash") values ($1, $2)',
    [SENTINEL, "$argon2id$v=19$hash"],
    uniqueViolation(),
  );
}

function logged(): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function assertClean(): string {
  const written = lines.join("\n");
  expect(written).not.toContain(SENTINEL);
  expect(written).not.toContain("argon2id");
  return written;
}

beforeEach(() => {
  lines.length = 0;
});

describe("the logger", () => {
  it("writes a failed query's class, SQLSTATE and statement, not its values", () => {
    const logger = createLogger({ write: (line: string) => lines.push(line) });
    logger.error({ err: failedInsert() }, "Something failed");

    assertClean();
    const [line] = logged();
    expect(line.msg).toBe("Something failed");
    expect(line.err).toMatchObject({
      type: "DrizzleQueryError",
      message: "Failed query",
      query: 'insert into "users" ("email", "password_hash") values ($1, $2)',
      cause: {
        type: "PostgresError_23505",
        code: "23505",
        constraint: "users_email_key",
      },
    });
  });

  it("drops pg's detail when the driver's error is logged on its own", () => {
    const logger = createLogger({ write: (line: string) => lines.push(line) });
    logger.warn({ err: uniqueViolation() }, "Refused");

    assertClean();
    expect(logged()[0].err).toMatchObject({ code: "23505", table: "users" });
  });

  it("does not let pino fall back to the raw message for a bare error", () => {
    // Given no message, pino writes the error's own as `msg` — which for
    // Drizzle is the statement and its values.
    const logger = createLogger({ write: (line: string) => lines.push(line) });
    logger.error(failedInsert());
    logger.error({ err: failedInsert() });

    assertClean();
    expect(logged().map((line) => line.msg)).toEqual([
      "Failed query",
      "Failed query",
    ]);
  });

  it("still redacts by key", () => {
    const logger = createLogger({ write: (line: string) => lines.push(line) });
    logger.info({ token: "sk_live_secret" }, "Keyed");
    expect(lines.join("\n")).not.toContain("sk_live_secret");
  });
});

describe("the funnels that log unexpected errors", () => {
  it("runAction logs a refused insert without its parameters", async () => {
    const result = await runAction("auth.register", async () => {
      throw failedInsert();
    });

    expect(result).toEqual({ ok: false, error: messages.serverErrors.generic });
    assertClean();
    const [line] = logged();
    expect(line).toMatchObject({
      action: "auth.register",
      msg: "Action failed",
    });
    expect(line.err).toMatchObject({
      type: "DrizzleQueryError",
      cause: { code: "23505" },
    });
  });

  it("runAction logs pg's own error without its detail", async () => {
    await runAction("auth.register", async () => {
      throw uniqueViolation();
    });

    assertClean();
    expect(logged()[0].err).toMatchObject({
      type: "PostgresError_23505",
      code: "23505",
    });
  });

  it("mobileApiError logs a refused insert without its parameters", async () => {
    const response = mobileApiError(failedInsert(), "POST /api/groups", {
      groupId: "3f1c6d5e-0b7a-4f2a-9c3d-2b8e1a4f6c7d",
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unavailable." });
    assertClean();
    const [line] = logged();
    expect(line).toMatchObject({
      msg: "POST /api/groups failed",
      groupId: "3f1c6d5e-0b7a-4f2a-9c3d-2b8e1a4f6c7d",
    });
    expect(line.err).toMatchObject({
      type: "DrizzleQueryError",
      cause: { type: "PostgresError_23505", code: "23505" },
    });
  });

  it("mobileApiError logs pg's own error without its detail", () => {
    mobileApiError(uniqueViolation(), "POST /api/auth/register");

    assertClean();
    expect(logged()[0].err).toMatchObject({ code: "23505" });
  });
});
