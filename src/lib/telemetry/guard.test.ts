import { describe, expect, it } from "vitest";
import { findForbiddenContent } from "./guard";

/**
 * The content scan, which is the check that does not trust the schema.
 *
 * Its job is to catch a field somebody adds in good faith three versions from
 * now — "just the route path", "just the error message" — which would pass
 * validation the moment it was declared.
 */

const VALID_REPORT = {
  schema: 1,
  version: "1.8.2",
  deployment: "docker-compose",
  database: "postgresql",
  architecture: "arm64",
  instanceAge: "91-180d",
  users: "6-10",
  groups: "11-25",
  features: {
    registrationOpen: false,
    email: true,
    push: true,
    appleSignIn: false,
    exchangeRates: false,
    receiptScanning: true,
    semanticCategorization: false,
    storage: "local",
    worker: "separate",
  },
  last7Days: {
    expensesCreated: "51-100",
    splitMethods: { equal: "26-50" },
    expenseParticipants: { "2-5": "51-100" },
  },
};

describe("findForbiddenContent", () => {
  it("passes a real report", () => {
    // The guard is worthless if it cannot tell a bucket label from an address:
    // a false positive here would silently stop telemetry working at all.
    expect(findForbiddenContent(VALID_REPORT)).toBeNull();
  });

  it("passes every bucket label and enum member the schema allows", () => {
    for (const label of [
      "0",
      "1",
      "2-5",
      "500+",
      "100+",
      "365d+",
      "91-180d",
      "docker-compose",
      "postgresql",
      "in-web",
      "1.8.2",
      "1.8.2-rc.1",
    ]) {
      expect(findForbiddenContent({ field: label }), label).toBeNull();
    }
  });

  const rejected: [string, unknown, string][] = [
    ["an email address", { contact: "john@example.com" }, "email"],
    ["an instance URL", { instance: "https://balancia.example.com" }, "url"],
    [
      "a database connection string",
      { dsn: "postgres://balancia:hunter2@db:5432/balancia" },
      "url",
    ],
    ["an authorization header", { header: "Bearer abc123" }, "credential"],
    ["a UUID", { id: "3f1c6d5e-0b7a-4f2a-9c3d-2b8e1a4f6c7d" }, "uuid"],
    ["an amount in minor units", { total: "845000" }, "long-number"],
    ["a request path", { path: "/groups/123/expenses/456" }, "path"],
    ["a query string", { query: "?groupId=abc&expenseId=def" }, "path"],
    ["a key that names a secret", { sessionToken: "abc" }, "key:secret"],
    [
      "prose",
      { note: "Dinner at Chez Marie with Ada and Grace, split four ways" },
      "too-long",
    ],
  ];

  for (const [description, payload, rule] of rejected) {
    it(`rejects ${description}`, () => {
      const found = findForbiddenContent(payload);
      expect(found, description).not.toBeNull();
      expect(found?.rule).toBe(rule);
    });
  }

  it("finds something buried deep in a payload", () => {
    const found = findForbiddenContent({
      ...VALID_REPORT,
      last7Days: {
        ...VALID_REPORT.last7Days,
        detail: { extra: { contact: "john@example.com" } },
      },
    });
    expect(found?.rule).toBe("email");
    expect(found?.path).toBe("$.last7Days.detail.extra.contact");
  });

  it("reports where it found something, never what it found", () => {
    const found = findForbiddenContent({ contact: "john@example.com" });
    expect(JSON.stringify(found)).not.toContain("john");
  });

  it("rejects values that are not data at all", () => {
    expect(findForbiddenContent({ fn: () => 1 })?.rule).toBe(
      "unsupported:function",
    );
    expect(findForbiddenContent({ big: 1n })?.rule).toBe("unsupported:bigint");
    expect(findForbiddenContent({ n: Number.NaN })?.rule).toBe("not-a-number");
  });

  it("refuses a payload nested past any legitimate depth", () => {
    let deep: object = { value: "1" };
    for (let level = 0; level < 12; level += 1) deep = { level: deep };
    expect(findForbiddenContent(deep)?.rule).toBe("too-deep");
  });

  it("checks inside arrays", () => {
    expect(
      findForbiddenContent({ items: ["2-5", "john@example.com"] })?.rule,
    ).toBe("email");
  });
});
