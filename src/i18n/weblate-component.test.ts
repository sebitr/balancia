import { describe, expect, it } from "vitest";
import local from "../../scripts/weblate-component.json";
import hosted from "../../scripts/weblate-component-hosted.json";

/**
 * Guards on the two Weblate component definitions.
 *
 * There are two instances translating the same files: the public one on Hosted
 * Weblate, where contributors work, and the local one in compose.weblate.yaml,
 * where maintainers sweep wording without publishing a half-finished rewrite.
 * Each needs its own definition because they reach the repository differently
 * — one over GitHub, one over a bind-mounted mirror.
 *
 * Everything *else* about them has to match. A component that disagreed on the
 * file format, the mask or the language-code style would write `messages/`
 * differently from the other, and the difference would surface as a pull
 * request that reformats every catalogue, or as a `pt-BR.json` the app cannot
 * load. Neither is a thing to discover from a contributor's first PR.
 *
 * This lives in src/ because that is where vitest looks; the files it reads do
 * not.
 */

type Component = Record<string, unknown>;

const localComponent = (local as Component[])[0]!;
const hostedComponent = (hosted as Component[])[0]!;

describe("weblate component definitions", () => {
  /**
   * How a catalogue is read and written. These decide the bytes that land in
   * `messages/`, so the two instances must agree on all of them.
   */
  const SHARED = [
    "slug",
    "branch",
    "file_format",
    "filemask",
    "template",
    "new_base",
    "new_lang",
    "language_code_style",
    "manage_units",
    "check_flags",
  ] as const;

  it.each(SHARED)("agrees on %s", (field) => {
    expect(hostedComponent[field]).toEqual(localComponent[field]);
  });

  it("reaches the repository the way each instance can", () => {
    // The local instance has no network identity and pushes to the bare mirror
    // scripts/weblate.sh bind-mounts at /repo. The public one opens a pull
    // request, which is the only way a stranger's translation should arrive.
    expect(localComponent.vcs).toBe("git");
    expect(localComponent.repo).toBe("/repo/balancia.git");
    expect(hostedComponent.vcs).toBe("github");
    expect(hostedComponent.repo).toBe(hostedComponent.push);
  });

  it("lets English be edited locally and nowhere else", () => {
    // messages/en.json is the source that next-intl.d.ts types every t() call
    // against, so changing an English string is a code change and belongs in a
    // branch — not in a text box open to anyone who signed up this morning.
    expect(localComponent.edit_template).toBe(true);
    expect(hostedComponent.edit_template).toBe(false);
  });

  it("keeps the ICU check on both, so a dropped placeholder fails early", () => {
    // src/i18n/messages.test.ts catches this too, but only once the file has
    // been pulled. In the editor it is a red mark next to the string, while
    // the person who wrote it is still looking at it.
    expect(localComponent.check_flags).toContain("icu-message-format");
    expect(hostedComponent.check_flags).toContain("icu-message-format");
  });
});
