import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * A logger call hands over the error, never its message or its stack.
 *
 * The logger's `err` serializer (`error-for-log.ts`) is what keeps a failed
 * query's bound values out of the log, and it can only do that with the thrown
 * value itself. A call site that reads `error.message` or `error.stack` first
 * hands it a string instead, and Drizzle's message *is* the statement followed
 * by every value bound to it — the address and password hash of a refused
 * sign-up, the description and amount of a refused expense. Every route in the
 * app once logged `error instanceof Error ? error.message : String(error)`,
 * which is exactly that string.
 *
 * So inside the arguments of a call on anything named `…logger`, reading a
 * `.message` or a `.stack` fails the build. Other properties are fine —
 * `message.subject` is a mail's subject — and so is the helper itself, which
 * reads both but never inside a logger call.
 */

const ROOTS = ["src", "scripts"];
const LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace"]);
const FORBIDDEN = new Set(["message", "stack"]);

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
        found.push(full);
    }
  };
  for (const root of ROOTS) walk(path.join(process.cwd(), root));
  return found;
}

/** `logger`, `jobLogger`, `logger.child({…})` — whatever the call hangs off. */
function rootName(expression: ts.Expression): string | null {
  let current = expression;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isCallExpression(current)
  ) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : null;
}

function isLoggerCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!LEVELS.has(callee.name.text)) return false;
  const name = rootName(callee.expression);
  return name !== null && /logger$/i.test(name);
}

/** Every `.message` or `.stack` read inside a logger call's arguments. */
function offences(source: ts.SourceFile): string[] {
  const found: string[] = [];
  const file = path.relative(process.cwd(), source.fileName);

  const inspect = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && FORBIDDEN.has(node.name.text)) {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      );
      found.push(`${file}:${line + 1}: ${node.getText(source)}`);
    }
    ts.forEachChild(node, inspect);
  };
  const visit = (node: ts.Node): void => {
    if (isLoggerCall(node)) node.arguments.forEach(inspect);
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

describe("log hygiene", () => {
  it("never logs an error's message or stack in place of the error", () => {
    const found = sourceFiles().flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return /logger/i.test(text) ? offences(parse(file, text)) : [];
    });

    // Pass the error itself — `logger.error({ err: error }, "…")` — and the
    // serializer writes its class, message and stack, less any query values.
    expect(found).toEqual([]);
  });

  it("recognises the pattern it exists to refuse", () => {
    // Guards the guard: were the scan to stop matching, the test above would
    // pass on anything.
    const sample = parse(
      path.join(process.cwd(), "sample.ts"),
      [
        'logger.error({ err: error instanceof Error ? error.message : String(error) }, "a");',
        'jobLogger.child({ queue }).warn({ err: failure.stack }, "b");',
        'logger.info({ subject: message.subject }, "c");',
        'logger.error({ err: error }, "d");',
      ].join("\n"),
    );

    expect(offences(sample)).toEqual([
      "sample.ts:1: error.message",
      "sample.ts:2: failure.stack",
    ]);
  });
});
