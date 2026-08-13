import type { OcrResult, OcrTextBox } from "./types";

/**
 * Synthetic OCR output for tests.
 *
 * These are *fixtures*, not photographs: every one was written by hand to
 * reproduce a layout Balancia has to cope with, and none contains anybody's
 * real card number, tax ID or dinner. Running the actual models in a unit test
 * would make the suite depend on a 21 MB download and on floating-point
 * agreement between two runtimes, and would test the model rather than the
 * parser.
 *
 * A fixture line is either one box (`"Margherita 19.00"`, which is what the
 * detector usually returns) or two (`["Margherita", "19.00"]`, which is what it
 * returns when the gap is wide). Both spellings of the same receipt must parse
 * identically — that is precisely what `lines.ts` is for, and several tests
 * assert it.
 */

export type FixtureLine = string | readonly [string, string];

const LINE_HEIGHT = 30;
const CHAR_WIDTH = 11;
const LEFT = 40;
const RIGHT_COLUMN = 400;

/** Lays fixture lines out on a page so the boxes have believable geometry. */
export function buildOcrResult(
  lines: readonly FixtureLine[],
  options: { readonly confidence?: number } = {},
): OcrResult {
  const confidence = options.confidence ?? 0.97;
  const boxes: OcrTextBox[] = [];

  lines.forEach((line, index) => {
    const y0 = 20 + index * LINE_HEIGHT;
    const y1 = y0 + 22;

    if (typeof line === "string") {
      if (line === "") return;
      boxes.push({
        text: line,
        confidence,
        box: { x0: LEFT, y0, x1: LEFT + line.length * CHAR_WIDTH, y1 },
      });
      return;
    }

    const [left, right] = line;
    if (left !== "") {
      boxes.push({
        text: left,
        confidence,
        box: { x0: LEFT, y0, x1: LEFT + left.length * CHAR_WIDTH, y1 },
      });
    }
    if (right !== "") {
      boxes.push({
        text: right,
        confidence,
        box: {
          x0: RIGHT_COLUMN,
          y0: y0 + 1, // a hair off the baseline, as a real detector would be
          x1: RIGHT_COLUMN + right.length * CHAR_WIDTH,
          y1: y1 + 1,
        },
      });
    }
  });

  return { boxes, width: 640, height: 20 + lines.length * LINE_HEIGHT + 20 };
}

/* ------------------------------------------------------------- fixtures */

/** Zurich restaurant: CHF, apostrophe grouping, German summary rows. */
export const SWISS_RESTAURANT: readonly FixtureLine[] = [
  "Casa Italia",
  "Bahnhofstrasse 12, 8001 Zurich",
  "13.08.2026 20:14",
  "",
  ["Margherita", "19.00"],
  ["Carbonara", "24.50"],
  ["2 x Bier", "14.00"],
  ["Tiramisu", "9.50"],
  "",
  ["Zwischensumme", "67.00"],
  ["MwSt 7.7%", "5.10"],
  ["TOTAL CHF", "72.10"],
  ["Bar", "80.00"],
  ["Rueckgeld", "7.90"],
];

/** Paris bistro: comma decimals, TVA, service compris. */
export const FRENCH_BISTRO: readonly FixtureLine[] = [
  "Le Petit Comptoir",
  "24 rue des Lilas, 75011 Paris",
  "Le 03/07/2026 a 21:32",
  "",
  ["Entrecote", "26,50"],
  ["Salade de chevre", "12,00"],
  ["Carafe de vin", "18,00"],
  ["Cafe gourmand", "8,50"],
  "",
  ["Sous-total", "65,00"],
  ["TVA 10%", "6,50"],
  ["TOTAL", "71,50"],
];

/** Berlin: comma decimals, dot thousands, MwSt, EUR suffix. */
export const GERMAN_RESTAURANT: readonly FixtureLine[] = [
  "Gasthaus Sonne",
  "Rechnung Nr. 2026-1184",
  "13.08.2026",
  "",
  ["Schnitzel", "18,90"],
  ["3 x Weissbier", "13,50"],
  ["Apfelstrudel", "6,80"],
  "",
  ["Zwischensumme", "39,20"],
  ["MwSt 19%", "7,45"],
  ["Gesamtbetrag EUR", "46,65"],
];

/** Rome: coperto (cover charge) and servizio, comma decimals. */
export const ITALIAN_TRATTORIA: readonly FixtureLine[] = [
  "Trattoria da Vinci",
  "Via Roma 8, 00184 Roma",
  "13/08/2026",
  "",
  ["Bruschetta", "7,00"],
  ["Cacio e pepe", "14,00"],
  ["2 x Birra media", "11,00"],
  ["Panna cotta", "6,00"],
  "",
  ["Totale parziale", "38,00"],
  ["Coperto", "4,00"],
  ["IVA 10%", "4,20"],
  ["TOTALE", "46,20"],
];

/** US diner: dollar signs, tip line, comma thousands. */
export const US_RESTAURANT: readonly FixtureLine[] = [
  "The Corner Diner",
  "Aug 13, 2026  7:42 PM",
  "Table 12   Server: Dana",
  "",
  ["Cheeseburger", "$16.50"],
  ["Caesar Salad", "$12.00"],
  ["2 x Iced Tea", "$7.00"],
  "",
  ["Subtotal", "$35.50"],
  ["Sales Tax", "$3.11"],
  ["Tip", "$7.10"],
  ["TOTAL", "$45.71"],
  ["Visa", "$45.71"],
];

/** Quantity written as unit price times count, plus a service charge. */
export const QUANTITY_AND_SERVICE: readonly FixtureLine[] = [
  "Harbour Grill",
  "13.08.2026",
  "",
  ["4 x 7.50 Oysters", "30.00"],
  ["2 x 12.25 Fish pie", "24.50"],
  ["Sparkling water", "4.50"],
  "",
  ["Subtotal", "59.00"],
  ["Service charge 12.5%", "7.38"],
  ["TOTAL", "66.38"],
];

/** Swiss apostrophe grouping on a bill that runs into four figures. */
export const LARGE_AMOUNTS: readonly FixtureLine[] = [
  "Hotel Alpenblick",
  "13.08.2026",
  "",
  ["Suite 3 Naechte", "1'260.00"],
  ["Halbpension", "480.00"],
  "",
  ["Zwischensumme", "1'740.00"],
  ["MwSt 3.8%", "66.12"],
  ["TOTAL CHF", "1'806.12"],
];

/**
 * A bad photograph: half the lines came back as fragments, the total is
 * missing, and one price lost its decimal point. Nothing here should throw,
 * and nothing should be invented.
 */
export const POORLY_DETECTED: readonly FixtureLine[] = [
  "C sa Ital a",
  "l|III",
  ["Margherita", "19.00"],
  ["Carbo", "24 5O"],
  ["", "9.50"],
  "Tsch",
];

/**
 * A till that prints the count in front of the name with no `x`, a VAT
 * registration number in the header, and a bottle size in a description.
 * Every one of those misled the parser on a real scan.
 */
export const ITALIAN_BARE_QUANTITY: readonly FixtureLine[] = [
  "RISTORANTE DA LUIGI",
  "Via Garibaldi 47, 20121 Milano",
  "P.IVA 03918270965",
  "14/08/2026 21:47 Tav. 12",
  "",
  ["2 Bruschetta miste", "9,00"],
  ["3 Tagliatelle ragu", "42,00"],
  ["2 Vino rosso cl.75", "36,00"],
  ["1 Acqua nat. 1L", "3,00"],
  "",
  ["Coperto 4 x 2,50", "10,00"],
  ["Totale parziale", "90,00"],
  ["IVA 10%", "9,00"],
  ["TOTALE EUR", "109,00"],
  ["Contanti", "120,00"],
  ["Resto", "11,00"],
];
