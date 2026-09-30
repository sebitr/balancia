import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import {
  AREA_NAMESPACES,
  OFFLINE_NAMESPACES,
  ROOT_NAMESPACES,
  clientMessages,
  pickMessages,
} from "./client-messages";

/**
 * Every Client Component finds the messages it asks for.
 *
 * The browser is no longer sent the whole catalogue: the root provider carries
 * a list, and each area of the app adds its own on a provider of its own (see
 * `client-messages.ts`). That is a promise the lists cannot keep by
 * themselves. A Client Component asking for a namespace its provider does not
 * carry gets no error from the compiler and none from the server render — it
 * gets its keys, printed as text, in the browser, and only on the screens
 * that render it.
 *
 * So this reads the code the way the bundler does. It parses every file under
 * `src/`, follows every import that survives compilation (type-only ones do
 * not), and marks as client code every `"use client"` file and everything it
 * imports. Then it works out which provider each of those renders under, by
 * walking back up the imports to where an area's provider is mounted — a file
 * that mounts one, or a route whose layout does — and checks each
 * `useTranslations` namespace against what that provider carries. A module
 * reached from two areas is held to both.
 *
 * Two shapes are refused outright, because no reading of the code can say
 * what they need: a namespace that is not written out as a literal, and
 * `useTranslations()` or `useMessages()` with none at all. Write the namespace
 * out; if a component genuinely chooses between two, call the hook twice.
 */

/** Paths relative to the repository root, `/`-separated, as the keys. */
type Sources = ReadonlyMap<string, string>;

interface Lists {
  readonly root: readonly string[];
  readonly areas: Readonly<Record<string, readonly string[]>>;
  readonly offline: readonly string[];
}

/** Where a component's messages come from: the root, an area, or offline. */
type Provider = "root" | "offline" | `area:${string}`;

interface Hook {
  readonly line: number;
  /** The namespace, or why there is not one to read. */
  readonly namespace: string | { readonly refused: string };
}

interface Module {
  readonly client: boolean;
  readonly server: boolean;
  readonly imports: readonly string[];
  readonly hooks: readonly Hook[];
  /** `<NextIntlClientProvider>` elements, and whether each states `messages`. */
  readonly providers: readonly { line: number; messages: boolean }[];
  /** `<AreaMessages area="…">` elements. */
  readonly areas: readonly { line: number; area: string | null }[];
}

/**
 * The files a provider is expected in, and what each one is.
 *
 * Anything else rendering `NextIntlClientProvider` is a provider this rule
 * knows nothing about, and fails below rather than being guessed at.
 */
const KNOWN_PROVIDERS: Readonly<Record<string, Provider | "area">> = {
  "src/app/layout.tsx": "root",
  "src/i18n/area-messages.tsx": "area",
  "src/components/pwa/offline-notice.tsx": "offline",
};

/**
 * Listed paths the offline screen reads straight off the catalogue it picked,
 * with no hook: its own copy, drawn above the provider it mounts.
 */
const READ_WITHOUT_A_HOOK = new Set(["offline"]);

const ROUTE_FILE =
  /^(page|layout|loading|error|not-found|default|template|global-error|forbidden|unauthorized)\.tsx?$/;

const INTL_MODULES = new Set(["next-intl", "use-intl"]);

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** An import that compiles away: `import type`, or only `type` bindings. */
function typeOnly(
  clause: ts.ImportClause | undefined,
  exported?: ts.ExportDeclaration,
): boolean {
  if (exported) {
    if (exported.isTypeOnly) return true;
    const named = exported.exportClause;
    return (
      named !== undefined &&
      ts.isNamedExports(named) &&
      named.elements.length > 0 &&
      named.elements.every((element) => element.isTypeOnly)
    );
  }
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  return (
    clause.name === undefined &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function resolve(
  sources: Sources,
  from: string,
  specifier: string,
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.posix.join("src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.posix.join(path.posix.dirname(from), specifier);
  } else {
    return null;
  }
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (sources.has(candidate)) return candidate;
  }
  return null;
}

function parse(sources: Sources, file: string, text: string): Module {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const directives = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      break;
    }
    directives.add(statement.expression.text);
  }

  const imports: string[] = [];
  const translate = new Set<string>();
  const messages = new Set<string>();
  const hooks: Hook[] = [];
  const providers: { line: number; messages: boolean }[] = [];
  const areas: { line: number; area: string | null }[] = [];

  const follow = (specifier: string) => {
    const target = resolve(sources, file, specifier);
    if (target) imports.push(target);
  };

  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      if (typeOnly(statement.importClause)) continue;
      const specifier = statement.moduleSpecifier.text;
      follow(specifier);
      // The local names the two hooks are bound to, aliases included.
      const bindings = statement.importClause?.namedBindings;
      if (
        INTL_MODULES.has(specifier) &&
        bindings &&
        ts.isNamedImports(bindings)
      ) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (imported === "useTranslations") translate.add(element.name.text);
          if (imported === "useMessages") messages.add(element.name.text);
        }
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      !typeOnly(undefined, statement)
    ) {
      follow(statement.moduleSpecifier.text);
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (first && ts.isStringLiteralLike(first)) follow(first.text);
      } else if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        const line = lineOf(source, node);
        if (translate.has(name)) {
          hooks.push({
            line,
            namespace:
              first === undefined
                ? { refused: "no namespace, which is the whole catalogue" }
                : ts.isStringLiteralLike(first)
                  ? first.text
                  : {
                      refused: `a namespace that is not written out (${first.getText(source)})`,
                    },
          });
        } else if (messages.has(name)) {
          hooks.push({
            line,
            namespace: {
              refused: "useMessages(), which is the whole catalogue",
            },
          });
        }
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const attribute = (name: string) =>
        node.attributes.properties.find(
          (property): property is ts.JsxAttribute =>
            ts.isJsxAttribute(property) &&
            property.name.getText(source) === name,
        );
      if (tag === "NextIntlClientProvider") {
        providers.push({
          line: lineOf(source, node),
          messages: attribute("messages") !== undefined,
        });
      } else if (tag === "AreaMessages") {
        const value = attribute("area")?.initializer;
        areas.push({
          line: lineOf(source, node),
          area: value && ts.isStringLiteral(value) ? value.text : null,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return {
    client: directives.has("use client"),
    server: directives.has("use server"),
    imports,
    hooks,
    providers,
    areas,
  };
}

/** Whether a provider's list carries the namespace a hook asked for. */
function carries(list: readonly string[], namespace: string): boolean {
  return list.some(
    (path) => namespace === path || namespace.startsWith(`${path}.`),
  );
}

/** Whether a hook's namespace reads any part of a listed path. */
function reads(namespace: string, path: string): boolean {
  return (
    namespace === path ||
    namespace.startsWith(`${path}.`) ||
    path.startsWith(`${namespace}.`)
  );
}

/**
 * Which provider a route file renders under: the area whose provider the
 * nearest enclosing layout mounts, or the root. A layout does not enclose
 * itself — it renders under its parent's — while a page, a loading state or
 * an error boundary renders under the layout beside it.
 */
function enclosing(
  file: string,
  mounts: ReadonlyMap<string, Provider>,
): Provider {
  let dir = path.posix.dirname(file);
  if (path.posix.basename(file).startsWith("layout.")) {
    dir = path.posix.dirname(dir);
  }
  while (dir.startsWith("src/app")) {
    for (const layout of [`${dir}/layout.tsx`, `${dir}/layout.ts`]) {
      const mounted = mounts.get(layout);
      if (mounted) return mounted;
    }
    dir = path.posix.dirname(dir);
  }
  return "root";
}

/**
 * Everything wrong with the messages a set of sources would get.
 *
 * A function of the sources and the lists rather than of the repository, so
 * the cases below can hand it a few files of their own and watch it refuse
 * what it should.
 */
function check(sources: Sources, lists: Lists): string[] {
  const problems: string[] = [];
  const modules = new Map<string, Module>();
  for (const [file, text] of sources) {
    modules.set(file, parse(sources, file, text));
  }

  // Client code: every "use client" file and all it imports, up to the
  // server actions it calls, which reach the browser as references only.
  const client = new Set<string>();
  const pending = [...modules].filter(([, m]) => m.client).map(([f]) => f);
  while (pending.length > 0) {
    const file = pending.pop() as string;
    const parsed = modules.get(file) as Module;
    if (client.has(file) || parsed.server) continue;
    client.add(file);
    pending.push(...parsed.imports);
  }

  // Where each provider is mounted.
  const mounts = new Map<string, Provider>();
  for (const [file, parsed] of modules) {
    for (const { line, messages } of parsed.providers) {
      const known = KNOWN_PROVIDERS[file];
      if (!known) {
        problems.push(
          `${file}:${line} renders a NextIntlClientProvider this rule does not know about. ` +
            `Mount AreaMessages instead, or name the file in KNOWN_PROVIDERS and say what it carries.`,
        );
      } else if (!messages) {
        problems.push(
          `${file}:${line} renders a NextIntlClientProvider with no \`messages\`, ` +
            `which sends the browser the whole catalogue.`,
        );
      }
    }
    if (KNOWN_PROVIDERS[file] === "offline") mounts.set(file, "offline");
    const named = new Set(parsed.areas.map(({ area }) => area));
    for (const { line, area } of parsed.areas) {
      if (area === null) {
        problems.push(
          `${file}:${line} mounts AreaMessages without a literal area.`,
        );
      } else if (!(area in lists.areas)) {
        problems.push(
          `${file}:${line} mounts an area with no list: "${area}".`,
        );
      }
    }
    if (named.size > 1) {
      problems.push(
        `${file} mounts more than one area; give each its own file.`,
      );
    } else if (named.size === 1) {
      const [area] = named;
      if (area !== null) mounts.set(file, `area:${area}`);
    }
  }

  // Which providers each file can render under, to a fixed point: a mount is
  // its own provider, a route file is its layout's, and anything else is
  // whatever everything importing it is under. A file nothing imports and no
  // route renders is counted under the root, the conservative answer.
  const importers = new Map<string, string[]>();
  for (const [file, parsed] of modules) {
    for (const target of parsed.imports) {
      const list = importers.get(target) ?? [];
      list.push(file);
      importers.set(target, list);
    }
  }
  const under = new Map<string, Set<Provider>>();
  const fixed = new Set<string>();
  for (const file of modules.keys()) {
    const mounted = mounts.get(file);
    const base = path.posix.basename(file);
    if (mounted) {
      under.set(file, new Set([mounted]));
      fixed.add(file);
    } else if (file.startsWith("src/app/") && ROUTE_FILE.test(base)) {
      under.set(file, new Set([enclosing(file, mounts)]));
      fixed.add(file);
    } else if (!importers.has(file)) {
      under.set(file, new Set(["root"]));
      fixed.add(file);
    } else {
      under.set(file, new Set());
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const [file, providers] of under) {
      if (fixed.has(file)) continue;
      for (const importer of importers.get(file) ?? []) {
        for (const provider of under.get(importer) ?? []) {
          if (!providers.has(provider)) {
            providers.add(provider);
            changed = true;
          }
        }
      }
    }
  }
  // Files that import only each other, and that nothing else reaches, are
  // left with nothing: counted under the root, like any other orphan.
  for (const providers of under.values()) {
    if (providers.size === 0) providers.add("root");
  }

  const listOf = (provider: Provider): readonly string[] => {
    if (provider === "root") return lists.root;
    if (provider === "offline") return lists.offline;
    const area = provider.slice("area:".length);
    return [...lists.root, ...(lists.areas[area] ?? [])];
  };
  const nameOf = (provider: Provider): string =>
    provider === "root"
      ? "the root provider (ROOT_NAMESPACES)"
      : provider === "offline"
        ? "the offline screen's provider (OFFLINE_NAMESPACES)"
        : `the ${provider.slice("area:".length)} area's provider (AREA_NAMESPACES.${provider.slice("area:".length)})`;

  // Every hook in client code, against every provider it can render under.
  const read = new Map<Provider, Set<string>>();
  for (const file of [...client].sort()) {
    const parsed = modules.get(file) as Module;
    const providers = under.get(file) ?? new Set<Provider>(["root"]);
    for (const { line, namespace } of parsed.hooks) {
      if (typeof namespace !== "string") {
        problems.push(
          `${file}:${line} calls a message hook with ${namespace.refused}.`,
        );
        continue;
      }
      for (const provider of providers) {
        const seen = read.get(provider) ?? new Set<string>();
        seen.add(namespace);
        read.set(provider, seen);
        if (!carries(listOf(provider), namespace)) {
          problems.push(
            `${file}:${line} asks for "${namespace}", and renders under ` +
              `${nameOf(provider)}, which does not carry it.`,
          );
        }
      }
    }
  }

  // And the lists against the code: nothing carried that nothing reads.
  const readUnder = (providers: readonly Provider[], path: string) =>
    providers.some((provider) =>
      [...(read.get(provider) ?? [])].some((namespace) =>
        reads(namespace, path),
      ),
    );
  const everywhere = [...read.keys()];
  for (const path of lists.root) {
    if (!readUnder(everywhere, path)) {
      problems.push(
        `ROOT_NAMESPACES carries "${path}", which no Client Component reads.`,
      );
    }
  }
  for (const [area, paths] of Object.entries(lists.areas)) {
    for (const path of paths) {
      if (lists.root.includes(path)) {
        problems.push(
          `AREA_NAMESPACES.${area} repeats "${path}", which the root already carries.`,
        );
      } else if (!readUnder([`area:${area}`], path)) {
        problems.push(
          `AREA_NAMESPACES.${area} carries "${path}", which no Client Component in that area reads.`,
        );
      }
    }
  }
  for (const path of lists.offline) {
    if (!READ_WITHOUT_A_HOOK.has(path) && !readUnder(["offline"], path)) {
      problems.push(
        `OFFLINE_NAMESPACES carries "${path}", which nothing on the offline screen reads.`,
      );
    }
  }

  return problems;
}

function repositorySources(): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith(".d.ts")
      ) {
        found.set(full, readFileSync(full, "utf8"));
      }
    }
  };
  walk("src");
  return found;
}

const LISTS: Lists = {
  root: ROOT_NAMESPACES,
  areas: AREA_NAMESPACES,
  offline: OFFLINE_NAMESPACES,
};

describe("client messages", () => {
  it("gives every Client Component the namespaces it asks for, and carries nothing else", () => {
    expect(check(repositorySources(), LISTS)).toEqual([]);
  });

  it("lists only paths the catalogue has", () => {
    const catalogue = en as unknown as Record<string, unknown>;
    const missing = [
      ...ROOT_NAMESPACES,
      ...Object.values(AREA_NAMESPACES).flat(),
      ...OFFLINE_NAMESPACES,
    ].filter(
      (path) =>
        path
          .split(".")
          .reduce<unknown>(
            (node, key) =>
              typeof node === "object" && node !== null
                ? (node as Record<string, unknown>)[key]
                : undefined,
            catalogue,
          ) === undefined,
    );
    expect(missing).toEqual([]);
  });
});

/**
 * The rule refusing what it should, on sources small enough to read.
 *
 * A route in the group area, a component only it renders, and one the
 * dashboard renders as well — the smallest graph with both an area and the
 * root in it.
 */
describe("the rule itself", () => {
  const fixture = (component: string): Map<string, string> =>
    new Map([
      [
        "src/app/groups/[groupId]/layout.tsx",
        `import { AreaMessages } from "@/i18n/area-messages";
         export default function Layout({ children }) {
           return <AreaMessages area="group">{children}</AreaMessages>;
         }`,
      ],
      [
        "src/app/groups/[groupId]/page.tsx",
        `import { Remind } from "@/components/remind";
         export default function Page() { return <Remind />; }`,
      ],
      [
        "src/app/dashboard/page.tsx",
        `import { Shared } from "@/components/shared";
         export default function Page() { return <Shared />; }`,
      ],
      ["src/i18n/area-messages.tsx", `export function AreaMessages() {}`],
      ["src/components/remind.tsx", component],
      [
        "src/components/shared.tsx",
        `"use client";
         import { useTranslations } from "next-intl";
         export function Shared() { return useTranslations("common")("ok"); }`,
      ],
    ]);

  const remind = (namespace: string) =>
    `"use client";
     import { useTranslations as useT } from "next-intl";
     import { Shared } from "./shared";
     export function Remind() { return useT(${namespace})("title"); }`;

  it("accepts a namespace the area's provider carries", () => {
    expect(
      check(fixture(remind(`"remind"`)), {
        root: ["common"],
        areas: { group: ["remind"] },
        offline: [],
      }),
    ).toEqual([]);
  });

  it("refuses a namespace the provider it renders under does not carry", () => {
    expect(
      check(fixture(remind(`"remind"`)), {
        root: ["common"],
        areas: { group: [] },
        offline: [],
      }),
    ).toEqual([
      `src/components/remind.tsx:4 asks for "remind", and renders under the group area's provider (AREA_NAMESPACES.group), which does not carry it.`,
    ]);
  });

  it("holds a component rendered in two places to the root", () => {
    // `Shared` renders on the dashboard as well as in the group, so an area's
    // list is not enough for it.
    expect(
      check(fixture(remind(`"remind"`)), {
        root: [],
        areas: { group: ["remind", "common"] },
        offline: [],
      }),
    ).toEqual([
      `src/components/shared.tsx:3 asks for "common", and renders under the root provider (ROOT_NAMESPACES), which does not carry it.`,
    ]);
  });

  it("refuses a namespace it cannot read", () => {
    expect(
      check(fixture(remind("NAMESPACE")), {
        root: ["common"],
        areas: { group: [] },
        offline: [],
      }),
    ).toEqual([
      `src/components/remind.tsx:4 calls a message hook with a namespace that is not written out (NAMESPACE).`,
    ]);
  });

  it("refuses a list carrying what nothing reads", () => {
    expect(
      check(fixture(remind(`"remind"`)), {
        root: ["common", "marketing"],
        areas: { group: ["remind"] },
        offline: [],
      }),
    ).toEqual([
      `ROOT_NAMESPACES carries "marketing", which no Client Component reads.`,
    ]);
  });
});

describe("pickMessages", () => {
  const catalogue = {
    common: { ok: "OK" },
    marketing: {
      demo: { a: "A" },
      hero: "H",
      selfHosting: { install: { b: "B" }, c: "C" },
    },
  };

  it("carries whole namespaces by reference and subtrees by their own paths", () => {
    const picked = pickMessages(catalogue, [
      "common",
      "marketing.demo",
      "marketing.selfHosting.install",
    ]);
    expect(picked).toEqual({
      common: { ok: "OK" },
      marketing: { demo: { a: "A" }, selfHosting: { install: { b: "B" } } },
    });
    expect(picked.common).toBe(catalogue.common);
  });

  it("never writes into the catalogue it picks from", () => {
    // Frozen, so a write throws instead of passing unnoticed: a subtree listed
    // after the namespace it belongs to finds that namespace already carried
    // whole, and the object it would be writing into is the catalogue's own.
    const freeze = (node: object): object => {
      for (const value of Object.values(node)) {
        if (typeof value === "object") freeze(value as object);
      }
      return Object.freeze(node);
    };
    freeze(catalogue);

    const picked = pickMessages(catalogue, ["marketing", "marketing.demo"]);
    expect(picked.marketing).toBe(catalogue.marketing);
  });

  it("hands an area the root's list with its own on top", () => {
    const area = Object.keys(
      AREA_NAMESPACES,
    )[0] as keyof typeof AREA_NAMESPACES;
    expect(Object.keys(clientMessages(en, area))).toEqual(
      expect.arrayContaining(Object.keys(clientMessages(en))),
    );
  });
});
