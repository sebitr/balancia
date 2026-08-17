/**
 * Renders every transactional email, in every language, to disk.
 *
 * Two jobs. It regenerates `tests/fixtures/emails`, which is what the template
 * tests assert against — so a deliberate design change is made by editing the
 * templates, running this, and reviewing the fixture diff. And it is how you
 * look at one: the files open in a browser, which is a reasonable first pass
 * before putting them through a real client.
 *
 *   pnpm email:render                 # rewrite the fixtures
 *   pnpm email:render /tmp/emails     # somewhere else, to eyeball
 *
 * What it renders lives in src/modules/auth/emails/preview.ts, so the tests
 * assert exactly what this writes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { LOCALES } from "@/i18n/locales";
import { renderAll } from "@/modules/auth/emails/preview";

const DEFAULT_OUT = "tests/fixtures/emails";

function main(): void {
  const out = process.argv[2] ?? DEFAULT_OUT;
  let written = 0;

  for (const locale of LOCALES) {
    const directory = `${out}/${locale}`;
    mkdirSync(directory, { recursive: true });
    for (const [name, email] of Object.entries(renderAll(locale))) {
      writeFileSync(`${directory}/${name}.html`, email.html, "utf8");
      // Subject on the first line, so a copy change to either part of the
      // message shows up in the fixture diff.
      writeFileSync(
        `${directory}/${name}.txt`,
        `Subject: ${email.subject}\n\n${email.text}\n`,
        "utf8",
      );
      written += 2;
    }
  }

  console.log(`Wrote ${written} files to ${out}`);
}

main();
