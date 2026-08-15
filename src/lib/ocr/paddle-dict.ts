/**
 * PaddleOCR's character list, whichever way the release ships it.
 *
 * PP-OCRv5 publishes a plain `ppocrv5_dict.txt`, one character per line, which
 * is what the worker's `buildCharset` reads. PP-OCRv6 publishes no `.txt` at
 * all: the list is a YAML sequence inside each recognizer's `inference.yml`,
 * under `PostProcess.character_dict`.
 *
 * Rather than teach the worker a second format — it is untyped source text
 * shipped to every browser, and the last thing it needs is a YAML parser — the
 * conversion happens once, on the operator's machine, in `pnpm ocr:install`.
 * What lands in `public/models` is a `.txt` in the v5 shape whichever model was
 * chosen, and the browser cannot tell the difference.
 *
 * This is a deliberately small reader for one generated file, not a YAML
 * implementation. It handles exactly what PaddleOCR emits: a flat sequence of
 * single-character scalars, plain or single-quoted, at one indentation.
 */

/** The character list is a sequence under this key. */
const DICT_KEY = "character_dict:";

/**
 * Reads `PostProcess.character_dict` out of a PP-OCRv6 `inference.yml`.
 *
 * Returns the characters in index order — the order the recognizer's output
 * classes are in, which is the only thing that makes the list useful. The CTC
 * blank and the trailing space are *not* added here; that is `buildCharset`'s
 * job in the worker, and it must stay the one place that knows the convention.
 *
 * @throws if the key is absent or the sequence is empty, because a recognizer
 * with no character list decodes every receipt to an empty string, and failing
 * the install is far kinder than shipping that.
 */
export function extractCharacterDictionary(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);

  const keyIndex = lines.findIndex((line) => line.trim() === DICT_KEY);
  if (keyIndex < 0) {
    throw new Error(`No ${DICT_KEY} in the model's inference.yml`);
  }

  const characters: string[] = [];
  for (let index = keyIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];

    // A blank line inside a block sequence is legal and carries nothing.
    if (line.trim() === "") continue;

    const item = /^\s*-\s(.*)$/.exec(line);
    // The first line that is not a sequence item is the next key: the
    // dictionary has ended. Everything after it belongs to something else.
    if (!item) break;

    characters.push(unquoteScalar(item[1]));
  }

  if (characters.length === 0) {
    throw new Error(`${DICT_KEY} in the model's inference.yml is empty`);
  }

  return characters;
}

/**
 * One YAML scalar as the character it stands for.
 *
 * Only trailing *ASCII* blanks are trimmed. The dictionaries contain U+3000,
 * the ideographic space, as a plain scalar — a `\s`-based trim silently turns
 * that entry into an empty string, and since the entry keeps its index the
 * damage is not a crash but a character that decodes to nothing forever after.
 */
function unquoteScalar(raw: string): string {
  const value = raw.replace(/[ \t\r]+$/, "");

  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    // YAML's single-quoted style escapes a quote by doubling it, which is how
    // the apostrophe entry arrives: `- ''''`.
    return value.slice(1, -1).replace(/''/g, "'");
  }

  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value) as string;
  }

  return value;
}

/**
 * The character list as the worker expects to fetch it.
 *
 * One character per line, no trailing newline games: `buildCharset` splits on
 * newlines and drops empty trailing entries, so this is the shape it already
 * handles for v5.
 */
export function toDictionaryText(characters: readonly string[]): string {
  return `${characters.join("\n")}\n`;
}
