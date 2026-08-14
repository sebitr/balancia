import { describe, expect, it } from "vitest";
import { parseReceiptDate } from "./dates";

describe("parseReceiptDate", () => {
  it("reads ISO dates", () => {
    expect(parseReceiptDate("2026-08-13")).toBe("2026-08-13");
  });

  it("reads European numeric dates day-first", () => {
    expect(parseReceiptDate("13.08.2026")).toBe("2026-08-13");
    expect(parseReceiptDate("13/08/2026")).toBe("2026-08-13");
    expect(parseReceiptDate("13-08-2026")).toBe("2026-08-13");
  });

  it("expands two-digit years", () => {
    expect(parseReceiptDate("13.08.26")).toBe("2026-08-13");
    expect(parseReceiptDate("13.08.98")).toBe("1998-08-13");
  });

  it("uses a value above twelve to settle the order", () => {
    // Unambiguous whichever convention the printer used.
    expect(parseReceiptDate("25.12.2026")).toBe("2026-12-25");
    expect(parseReceiptDate("12/25/2026")).toBe("2026-12-25");
  });

  it("reads day-first when the date is genuinely ambiguous", () => {
    expect(parseReceiptDate("05/08/2026")).toBe("2026-08-05");
  });

  it("reads month names in several languages", () => {
    expect(parseReceiptDate("13 Aug 2026")).toBe("2026-08-13");
    expect(parseReceiptDate("13 août 2026")).toBe("2026-08-13");
    expect(parseReceiptDate("13. Dezember 2026")).toBe("2026-12-13");
    expect(parseReceiptDate("13 gennaio 2026")).toBe("2026-01-13");
  });

  it("reads month-first month names", () => {
    expect(parseReceiptDate("Aug 13, 2026")).toBe("2026-08-13");
    expect(parseReceiptDate("August 13 2026")).toBe("2026-08-13");
  });

  it("finds a date inside a longer line", () => {
    expect(parseReceiptDate("Le 03/07/2026 a 21:32")).toBe("2026-07-03");
    expect(parseReceiptDate("Datum: 13.08.2026 20:14")).toBe("2026-08-13");
  });

  it("reads a date the recognizer ran into the time", () => {
    // Exactly what came back from the first real browser run: receipts print
    // the date and time close together and OCR drops the space.
    expect(parseReceiptDate("13.08.202620:14")).toBe("2026-08-13");
    expect(parseReceiptDate("03/07/20269:05")).toBe("2026-07-03");
  });

  it("rejects impossible dates", () => {
    expect(parseReceiptDate("32.08.2026")).toBeNull();
    expect(parseReceiptDate("31.02.2026")).toBeNull();
  });

  it("rejects lines with no date", () => {
    expect(parseReceiptDate("Margherita 19.00")).toBeNull();
    expect(parseReceiptDate("Thank you")).toBeNull();
    expect(parseReceiptDate("")).toBeNull();
  });

  it("does not read a time as a date", () => {
    expect(parseReceiptDate("20:14")).toBeNull();
  });
});
