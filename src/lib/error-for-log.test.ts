import { inspect } from "node:util";
import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  errorForLog,
  guardConsoleErrors,
  holdsDatabaseError,
} from "./error-for-log";

/**
 * A failed query, reduced to what may be written to the log.
 *
 * Every error below carries the same sentinel, standing in for an address, a
 * password hash or a description: somewhere a statement's values end up —
 * Drizzle's message, its `params`, pg's `detail`, the message of a data
 * exception, a wrapper that quoted one of those. The assertion is the same
 * each time: serialize what would be logged and search it for the sentinel.
 */

const SENTINEL = "leak-me@example.com";
const STATEMENT =
  'insert into "users" ("email", "password_hash") values ($1, $2)';

/** pg's error for a statement PostgreSQL refused, as the driver builds it. */
function databaseError(
  message: string,
  fields: Record<string, string>,
): DatabaseError {
  return Object.assign(new DatabaseError(message, 120, "error"), {
    severity: "ERROR",
    ...fields,
  });
}

function uniqueViolation(): DatabaseError {
  return databaseError(
    'duplicate key value violates unique constraint "users_email_key"',
    {
      code: "23505",
      detail: `Key (email)=(${SENTINEL}) already exists.`,
      schema: "public",
      table: "users",
      constraint: "users_email_key",
      routine: "_bt_check_unique",
    },
  );
}

/** Drizzle's wrapper, exactly as `node-postgres` sessions throw it. */
function failedQuery(cause: Error = uniqueViolation()): DrizzleQueryError {
  return new DrizzleQueryError(STATEMENT, [SENTINEL, "$argon2id$hash"], cause);
}

function assertClean(logged: unknown): string {
  const serialized = JSON.stringify(logged);
  expect(serialized).not.toContain(SENTINEL);
  expect(serialized).not.toContain("argon2id");
  return serialized;
}

describe("errorForLog", () => {
  it("drops a failed query's parameters and keeps what diagnoses it", () => {
    const logged = errorForLog(failedQuery());
    assertClean(logged);

    expect(logged.type).toBe("DrizzleQueryError");
    expect(logged.message).toBe("Failed query");
    // The statement, with its placeholders and nothing bound to them.
    expect(logged.query).toBe(STATEMENT);
    expect(logged.cause).toMatchObject({
      type: "PostgresError_23505",
      code: "23505",
      message:
        'duplicate key value violates unique constraint "users_email_key"',
      table: "users",
      constraint: "users_email_key",
    });
    expect(logged.cause).not.toHaveProperty("detail");
  });

  it("keeps the stack's frames under a header rebuilt from the safe message", () => {
    const error = failedQuery();
    // The original header runs over two lines: the statement, then the values.
    expect(error.stack).toContain(`params: ${SENTINEL}`);

    const logged = errorForLog(error);
    expect(logged.stack).toMatch(/^DrizzleQueryError: Failed query\n\s+at /);
    expect(logged.stack).toContain("error-for-log.test.ts");
    assertClean(logged);
  });

  it("withholds the message of a data exception, which quotes the value", () => {
    const logged = errorForLog(
      failedQuery(
        databaseError(`invalid input syntax for type uuid: "${SENTINEL}"`, {
          code: "22P02",
          routine: "string_to_uuid",
        }),
      ),
    );
    assertClean(logged);

    expect(logged.cause).toMatchObject({
      type: "PostgresError_22P02",
      code: "22P02",
      routine: "string_to_uuid",
    });
    expect(logged.cause?.message).toMatch(/^Database error 22P02/);
  });

  it("takes pg's error on its own, as pg-boss and the migrator raise it", () => {
    const logged = errorForLog(uniqueViolation());
    assertClean(logged);
    expect(logged).toMatchObject({
      type: "PostgresError_23505",
      code: "23505",
    });
  });

  it("drops a name field that is not an identifier, whole", () => {
    const logged = errorForLog(
      databaseError("relation does not exist", {
        code: "42P01",
        table: `users ${SENTINEL}`,
      }),
    );
    assertClean(logged);
    expect(logged).not.toHaveProperty("table");
  });

  it("scrubs a wrapper that quoted the database's message into its own", () => {
    // What the migrator throws: its own sentence, with the driver's appended.
    const cause = databaseError(
      `invalid input syntax for type integer: "${SENTINEL}"`,
      { code: "22P02" },
    );
    const error = new Error(
      `Migration 0042_split failed and was rolled back: ${cause.message}`,
      { cause },
    );

    const logged = errorForLog(error);
    assertClean(logged);
    expect(logged.type).toBe("Error");
    expect(logged.message).toMatch(
      /^Migration 0042_split failed and was rolled back: Database error 22P02/,
    );
    expect(logged.stack).toMatch(/^Error: Migration 0042_split failed/);
  });

  it("scrubs a wrapper that quoted Drizzle's message", () => {
    const cause = failedQuery();
    const logged = errorForLog(
      new Error(`Could not save: ${String(cause)}`, { cause }),
    );
    assertClean(logged);
    expect(logged.message).toBe("Could not save: Error: Failed query");
  });

  it("reads PGlite's errors, which carry the statement and values themselves", () => {
    const error = Object.assign(
      databaseError('null value in column "email" violates not-null', {
        code: "23502",
        column: "email",
      }),
      { query: STATEMENT, params: [SENTINEL] },
    );
    const logged = errorForLog(error);
    assertClean(logged);
    expect(logged).toMatchObject({ code: "23502", column: "email" });
    expect(logged.query).toBe(STATEMENT);
  });

  it("reads pg-boss's error events, which are plain objects", () => {
    const original = failedQuery();
    const event = {
      ...original,
      message: original.message,
      stack: original.stack,
      queue: "import.commit",
    };
    const logged = errorForLog(event);
    assertClean(logged);
    expect(logged.message).toBe("Failed query");
  });

  it("leaves an error that is not the database's as it was", () => {
    const error = Object.assign(
      new Error("connect ECONNREFUSED 10.0.0.4:5432"),
      {
        code: "ECONNREFUSED",
      },
    );
    const logged = errorForLog(error);

    expect(logged).toMatchObject({
      type: "SystemError_ECONNREFUSED",
      message: "connect ECONNREFUSED 10.0.0.4:5432",
      code: "ECONNREFUSED",
    });
    expect(logged.stack).toBe(error.stack);
  });

  it("follows a cause chain without looping on a cycle", () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    (first as { cause?: unknown }).cause = second;

    const logged = errorForLog(first);
    expect(logged.message).toBe("first");
    expect(logged.cause?.message).toBe("second");
    expect(logged.cause?.cause).toBeUndefined();
  });

  it("takes things that are not errors at all", () => {
    expect(errorForLog("a thrown string")).toEqual({
      type: "UnknownError",
      message: "a thrown string",
    });
    expect(errorForLog(undefined)).toEqual({
      type: "UnknownError",
      message: "undefined",
    });
  });
});

describe("holdsDatabaseError", () => {
  it("looks down the cause chain", () => {
    expect(holdsDatabaseError(failedQuery())).toBe(true);
    expect(
      holdsDatabaseError(new Error("wrapped", { cause: uniqueViolation() })),
    ).toBe(true);
    expect(holdsDatabaseError(new Error("nothing to do with it"))).toBe(false);
    // Five capitals is not enough: `EPIPE` is a Node code, not a SQLSTATE.
    expect(
      holdsDatabaseError(
        Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
      ),
    ).toBe(false);
  });
});

describe("guardConsoleErrors", () => {
  /*
   * Next.js prints an error that escapes a page with `console.error(" ⨯", err)`,
   * and Node's formatting of an error includes its own properties — Drizzle's
   * `params` — and its cause, with pg's `detail`.
   */
  it("rewrites a database error on its way to the console", () => {
    const write = vi.fn();
    const target = { error: write };
    guardConsoleErrors(target);

    const error = Object.assign(failedQuery(), { digest: "2781592653" });
    target.error(" ⨯", error);

    const [prefix, printed] = write.mock.calls[0];
    expect(prefix).toBe(" ⨯");
    const text = inspect(printed);
    expect(text).not.toContain(SENTINEL);
    // Node writes the header as `Error [DrizzleQueryError]: Failed query`.
    expect(text).toMatch(/DrizzleQueryError\]?: Failed query/);
    expect(text).toContain("users_email_key");
    expect(text).toContain("2781592653");
  });

  it("passes everything else through untouched", () => {
    const write = vi.fn();
    const target = { error: write };
    guardConsoleErrors(target);

    const error = new TypeError("not a database error");
    target.error("prefix", error, 42);
    expect(write).toHaveBeenCalledWith("prefix", error, 42);
  });

  it("wraps a console once, however often it is asked to", () => {
    const write = vi.fn();
    const target = { error: write };
    guardConsoleErrors(target);
    const wrapped = target.error;
    guardConsoleErrors(target);
    expect(target.error).toBe(wrapped);
  });
});
