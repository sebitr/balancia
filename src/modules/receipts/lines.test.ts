import { describe, expect, it } from "vitest";
import { groupLines, medianLineHeight } from "./lines";
import type { OcrTextBox } from "./types";

function box(
  text: string,
  x0: number,
  y0: number,
  width = text.length * 10,
  height = 20,
  confidence = 0.95,
): OcrTextBox {
  return { text, confidence, box: { x0, y0, x1: x0 + width, y1: y0 + height } };
}

describe("groupLines", () => {
  it("joins boxes that share a baseline, left to right", () => {
    const lines = groupLines([
      box("19.00", 400, 100),
      box("Margherita", 40, 100),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Margherita 19.00");
  });

  it("keeps separate rows separate", () => {
    const lines = groupLines([
      box("Margherita", 40, 100),
      box("Carbonara", 40, 130),
    ]);
    expect(lines.map((line) => line.text)).toEqual(["Margherita", "Carbonara"]);
  });

  it("tolerates a receipt photographed at a slight angle", () => {
    // The price sits a few pixels lower than the description, as it does on
    // any photo taken by hand.
    const lines = groupLines([
      box("Margherita", 40, 100),
      box("19.00", 400, 108),
    ]);
    expect(lines).toHaveLength(1);
  });

  it("orders lines top to bottom whatever order they arrive in", () => {
    const lines = groupLines([
      box("Total", 40, 200),
      box("Margherita", 40, 100),
      box("Carbonara", 40, 150),
    ]);
    expect(lines.map((line) => line.text)).toEqual([
      "Margherita",
      "Carbonara",
      "Total",
    ]);
  });

  it("takes the lowest confidence in the line", () => {
    const lines = groupLines([
      box("Margherita", 40, 100, 100, 20, 0.99),
      box("19.00", 400, 100, 50, 20, 0.42),
    ]);
    expect(lines[0].confidence).toBe(0.42);
  });

  it("drops empty recognitions", () => {
    const lines = groupLines([box("", 40, 100), box("Margherita", 40, 130)]);
    expect(lines.map((line) => line.text)).toEqual(["Margherita"]);
  });

  it("keeps the union of the boxes it merged", () => {
    const [line] = groupLines([
      box("Margherita", 40, 100),
      box("19.00", 400, 100),
    ]);
    expect(line.box).toEqual({ x0: 40, y0: 100, x1: 450, y1: 120 });
    expect(line.segments).toHaveLength(2);
  });

  it("returns nothing for no input", () => {
    expect(groupLines([])).toEqual([]);
  });
});

describe("medianLineHeight", () => {
  it("describes the page in units of text", () => {
    const lines = groupLines([
      box("a", 40, 100, 10, 20),
      box("b", 40, 140, 10, 30),
      box("c", 40, 200, 10, 40),
    ]);
    expect(medianLineHeight(lines)).toBe(30);
  });

  it("is zero for an empty page", () => {
    expect(medianLineHeight([])).toBe(0);
  });
});
