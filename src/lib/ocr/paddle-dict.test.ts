import { describe, expect, it } from "vitest";
import { extractCharacterDictionary, toDictionaryText } from "./paddle-dict";

/**
 * The character list decides what every recognized glyph *is*, and it is read
 * from a file nothing else in Balancia parses. An entry read wrongly does not
 * throw: it keeps its index and decodes to the wrong character, or to nothing,
 * on every scan from then on. So the awkward cases are pinned here.
 */

/**
 * U+3000, the ideographic space, written as an escape.
 *
 * It is a real entry in both PP-OCRv6 dictionaries, and the whole point of the
 * test below is that it survives. Spelled literally it is an invisible
 * character in this file that any editor, formatter or careless trim could
 * quietly turn into an ASCII space, and the test would then pass while
 * asserting nothing.
 */
const IDEOGRAPHIC_SPACE = "　";

/** The shape PaddleOCR actually emits, trimmed to the interesting entries. */
const INFERENCE_YML = `Global:
  model_name: PP-OCRv6_tiny_rec
PreProcess:
  transform_ops:
  - RecResizeImg:
      image_shape:
      - 3
      - 48
      - 320
PostProcess:
  name: CTCLabelDecode
  character_dict:
  - '!'
  - $
  - ''''
  - '%'
  - A
  - ${IDEOGRAPHIC_SPACE}
  - 、
  - ￥
use_space_char: true
`;

describe("extractCharacterDictionary", () => {
  const dictionary = extractCharacterDictionary(INFERENCE_YML);

  it("reads the sequence in index order", () => {
    expect(dictionary).toEqual([
      "!",
      "$",
      "'",
      "%",
      "A",
      IDEOGRAPHIC_SPACE,
      "、",
      "￥",
    ]);
  });

  it("unwraps single-quoted scalars", () => {
    expect(dictionary[0]).toBe("!");
    expect(dictionary[3]).toBe("%");
  });

  it("reads a doubled quote as one apostrophe", () => {
    // `- ''''` is YAML for a single `'`. Read literally it is two characters,
    // and every apostrophe on a receipt then decodes as two.
    expect(dictionary[2]).toBe("'");
  });

  it("keeps the ideographic space, which a whitespace trim would erase", () => {
    // U+3000 matches `\s` in JavaScript. Trimmed away, this entry becomes ""
    // and silently decodes to nothing while holding on to its class index.
    expect(dictionary[5]).toBe(IDEOGRAPHIC_SPACE);
    expect(dictionary.filter((character) => character === "")).toEqual([]);
  });

  it("stops at the end of the sequence rather than reading the next key", () => {
    expect(dictionary).toHaveLength(8);
    expect(dictionary).not.toContain("true");
  });

  it("ignores the preprocessing sequences above it", () => {
    // `image_shape` is a sequence of numbers a few lines earlier. Keying off
    // "a line starting with a dash" rather than off the dictionary key would
    // swallow 3, 48 and 320 as characters.
    expect(dictionary).not.toContain("3");
    expect(dictionary).not.toContain("320");
  });

  it("refuses a file with no character list", () => {
    expect(() =>
      extractCharacterDictionary("Global:\n  model_name: x\n"),
    ).toThrow(/character_dict/);
  });

  it("refuses an empty character list", () => {
    expect(() =>
      extractCharacterDictionary("PostProcess:\n  character_dict:\nnext: 1\n"),
    ).toThrow(/empty/);
  });
});

describe("toDictionaryText", () => {
  it("writes the file the worker's buildCharset already reads", () => {
    expect(toDictionaryText(["!", "$", "A"])).toBe("!\n$\nA\n");
  });

  it("round-trips through the worker's split", () => {
    const characters = extractCharacterDictionary(INFERENCE_YML);
    const lines = toDictionaryText(characters).split(/\r?\n/);
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    expect(lines).toEqual(characters);
  });
});
