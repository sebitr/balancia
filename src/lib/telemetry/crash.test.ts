import { describe, expect, it } from "vitest";
import { buildCrashReport, classifyError } from "./crash";
import { findForbiddenContent } from "./guard";
import { crashReportSchema } from "./schema";

/**
 * Sanitization, tested with the things that must never get out.
 *
 * Every error below carries something real: an address, a URL with a group and
 * an expense in it, a bearer token, a merchant, OCR text, a database password.
 * The assertion is the same each time — serialize the report and search it for
 * the string. It must not be there, in any form, mangled or otherwise.
 */

/**
 * Strings that must not appear in a crash report, whole or in fragments a
 * reader could recognise.
 */
const SECRETS = [
  "john@example.com",
  "https://balancia.example.com/groups/123/expenses/456",
  "Bearer sk_live_51H8xQ2eZvKYlo2C",
  "Chez Marie",
  "TOTAL 84.50 EUR CARTE BANCAIRE",
  "hunter2",
  "postgres://balancia:hunter2@db:5432/balancia",
  "3f1c6d5e-0b7a-4f2a-9c3d-2b8e1a4f6c7d",
];

function assertClean(report: object): void {
  const serialized = JSON.stringify(report);
  for (const secret of SECRETS) {
    expect(serialized, `leaked: ${secret}`).not.toContain(secret);
  }
  // Fragments too: a sanitiser that strips punctuation out of an address and
  // keeps the letters has still leaked it.
  for (const fragment of [
    "john",
    "example.com",
    "sk_live",
    "Marie",
    "CARTE",
    "hunter",
    "balancia:hunter2",
    "3f1c6d5e",
  ]) {
    expect(serialized, `leaked fragment: ${fragment}`).not.toContain(fragment);
  }
}

describe("classifyError", () => {
  it("keeps a real error class name", () => {
    class RecurringExpenseGenerationError extends Error {
      override name = "RecurringExpenseGenerationError";
    }
    expect(classifyError(new RecurringExpenseGenerationError("boom"))).toBe(
      "RecurringExpenseGenerationError",
    );
  });

  it("prefers the constructor over a generic name", () => {
    class AllocationError extends Error {}
    expect(classifyError(new AllocationError("shares do not sum"))).toBe(
      "AllocationError",
    );
  });

  it("classifies a PostgreSQL failure by its SQLSTATE", () => {
    // pg reports every database error as `name: "error"`, which classifies
    // nothing; the SQLSTATE is the real class and contains no row data.
    const error = Object.assign(new Error("duplicate key value"), {
      name: "error",
      code: "23505",
      detail: "Key (email)=(john@example.com) already exists.",
    });
    const classified = classifyError(error);
    expect(classified).toBe("PostgresError_23505");
    expect(classified).not.toContain("john");
  });

  it("classifies a Node system error by its code", () => {
    const error = Object.assign(
      new Error("connect ECONNREFUSED 10.0.0.4:587"),
      {
        code: "ECONNREFUSED",
      },
    );
    expect(classifyError(error)).toBe("SystemError_ECONNREFUSED");
  });

  it("rejects an error name that is not an identifier, whole", () => {
    // Not stripped and kept: "john@example.com" with the punctuation removed
    // is "johnexamplecom", which is still an address. The name is discarded
    // and what remains is the constructor, which is genuine.
    const error = new Error("boom");
    error.name = "john@example.com";
    expect(classifyError(error)).toBe("Error");

    const spaced = new Error("boom");
    spaced.name = "Failed to load Chez Marie receipt";
    expect(classifyError(spaced)).toBe("Error");
  });

  it("rejects a name too short to have survived minification meaningfully", () => {
    const error = new Error("boom");
    error.name = "a";
    expect(classifyError(error)).toBe("Error");
  });

  it("gives up entirely when nothing about the error is an identifier", () => {
    // A minified custom class: both the name and the constructor are junk, so
    // there is nothing safe left to say.
    class X extends Error {}
    Object.defineProperty(X, "name", { value: "q" });
    const error = new X("boom");
    error.name = "https://balancia.example.com/groups/123";
    expect(classifyError(error)).toBe("UnknownError");
  });

  it("classifies things that are not errors at all", () => {
    expect(classifyError("just a string")).toBe("UnknownError");
    expect(classifyError(null)).toBe("UnknownError");
    expect(classifyError(undefined)).toBe("UnknownError");
    expect(classifyError(42)).toBe("UnknownError");
    expect(classifyError({ message: "john@example.com" })).toBe("Object");
  });
});

describe("buildCrashReport", () => {
  it("carries none of a rich error's contents", () => {
    const error = Object.assign(
      new Error(
        "Failed POST https://balancia.example.com/groups/123/expenses/456 " +
          "for john@example.com (Authorization: Bearer sk_live_51H8xQ2eZvKYlo2C)",
      ),
      {
        name: "RequestError",
        request: {
          headers: { authorization: "Bearer sk_live_51H8xQ2eZvKYlo2C" },
          body: { description: "Chez Marie", amount: "8450" },
        },
        cause: new Error("postgres://balancia:hunter2@db:5432/balancia"),
        expenseId: "3f1c6d5e-0b7a-4f2a-9c3d-2b8e1a4f6c7d",
        ocr: "TOTAL 84.50 EUR CARTE BANCAIRE",
      },
    );

    const report = buildCrashReport(error, "server-action");

    expect(report.error).toBe("RequestError");
    expect(report.component).toBe("server-action");
    assertClean(report);
  });

  it("carries no stack trace, ever", () => {
    const error = new Error("boom");
    error.stack =
      "Error: boom\n    at createExpense (/app/src/modules/expenses/service.ts:215:11)\n" +
      '    at handle (description="Chez Marie", amount=8450n)';

    const report = buildCrashReport(error, "job");
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain("at ");
    expect(serialized).not.toContain("service.ts");
    expect(serialized).not.toContain("Marie");
    expect(Object.keys(report).sort()).toEqual([
      "architecture",
      "component",
      "database",
      "deployment",
      "error",
      "schema",
      "version",
    ]);
  });

  it("produces a payload that validates and passes the content guard", () => {
    const report = buildCrashReport(new TypeError("nope"), "scheduler");
    expect(crashReportSchema.safeParse(report).success).toBe(true);
    expect(findForbiddenContent(report)).toBeNull();
  });

  it("survives a database error whose message quotes its parameters", () => {
    // The realistic worst case: pg puts the failing statement's values in the
    // message, and here those values are an address and an amount.
    const error = Object.assign(
      new Error(
        'insert into "expenses" ("description","amount") values ' +
          "('Chez Marie', 8450) — duplicate key",
      ),
      { name: "error", code: "23505" },
    );

    const report = buildCrashReport(error, "database");
    expect(report.error).toBe("PostgresError_23505");
    assertClean(report);
  });
});
