import { describe, expect, it } from "vitest";
import type { GroupExport } from "@/modules/exports/service";
import { contentHashOf } from "./bundle";
import type { ReceiptManifestEntry } from "./receipts";

/**
 * The hash decides whether a night writes anything. What it must notice is
 * everything that makes the copy in the cloud the wrong one — including a new
 * recovery key, which changes nothing in the groups.
 */

const group = (name: string, exportedAt: string) =>
  ({
    balancia: { exportedAt },
    group: { id: "0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f6", name },
  }) as unknown as GroupExport;

const receipt = {
  id: "0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f6",
  groupId: "0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f6",
  expenseId: "0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f6",
  fileName: "ticket.jpg",
  contentType: "image/jpeg",
  byteSize: "10",
  checksum: "abc",
  object: "receipts/receipt-0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f6-9f3a07c2.age",
} satisfies ReceiptManifestEntry;

describe("contentHashOf", () => {
  it("is blind to when the export was taken", () => {
    expect(
      contentHashOf([group("Flat", "2026-10-09T03:30:00Z")], [], "9f3a07c2"),
    ).toBe(
      contentHashOf([group("Flat", "2026-10-10T03:30:00Z")], [], "9f3a07c2"),
    );
  });

  it("notices what a person edited", () => {
    expect(contentHashOf([group("Flat", "x")], undefined, "9f3a07c2")).not.toBe(
      contentHashOf([group("Flat share", "x")], undefined, "9f3a07c2"),
    );
  });

  it("notices a new recovery key, though the groups are the same", () => {
    expect(contentHashOf([group("Flat", "x")], undefined, "9f3a07c2")).not.toBe(
      contentHashOf([group("Flat", "x")], undefined, "00c0ffee"),
    );
    expect(contentHashOf([group("Flat", "x")], [receipt], "9f3a07c2")).not.toBe(
      contentHashOf([group("Flat", "x")], [receipt], "00c0ffee"),
    );
  });

  it("notices a receipt", () => {
    expect(contentHashOf([group("Flat", "x")], [], "9f3a07c2")).not.toBe(
      contentHashOf([group("Flat", "x")], [receipt], "9f3a07c2"),
    );
  });
});
