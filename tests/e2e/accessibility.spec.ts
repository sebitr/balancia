import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  addParticipant,
  createGroup,
  expectToast,
  registerAndSignIn,
} from "./helpers";

/**
 * The critical journeys, read by an accessibility checker.
 *
 * Everything else about accessibility here is pinned one rule at a time —
 * the field sizes, the type scale, the tap targets, the contrast of every
 * token — and each of those tests reads source or a stylesheet. None of them
 * sees a rendered page, which is where the remaining kind of mistake lives: a
 * button with no name, an id pointed at by nothing, a tab list with no tabs,
 * a dialog that forgot its title. axe reads the page the browser actually
 * built, so it catches those wherever they come from.
 *
 * Serious and critical only. The moderate and minor findings are mostly about
 * landmarks and best practice, useful to read but not what should stop a
 * build; the two above are the ones that stop somebody using the screen.
 *
 * With reduced motion, so that no screen is read halfway through fading in:
 * a heading at half opacity fails a contrast check it passes at rest.
 */

test.use({ contextOptions: { reducedMotion: "reduce" } });

const BLOCKING = new Set(["serious", "critical"]);

async function expectNoBlockingViolations(page: Page, screen: string) {
  // Two frames, so whatever the last navigation started has been painted.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  const blocking = results.violations.filter((violation) =>
    BLOCKING.has(violation.impact ?? ""),
  );
  // Said in full on failure: which rule, how bad, and the first few elements
  // it found, which is what the person reading a red build needs to start.
  const report = blocking.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.help}\n` +
      violation.nodes
        .slice(0, 5)
        .map((node) => `    ${node.target.join(" ")}`)
        .join("\n"),
  );
  expect(report, `${screen} has accessibility violations`).toEqual([]);
}

test("the sign-in screen", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByLabel("Email")).toBeVisible();

  await expectNoBlockingViolations(page, "Sign-in");
});

test("the dashboard, a group, adding an expense and settling up", async ({
  page,
}) => {
  await registerAndSignIn(page);
  await expect(
    page.getByRole("heading", { name: "Your groups" }),
  ).toBeVisible();
  await expectNoBlockingViolations(page, "The dashboard");

  const groupId = await createGroup(page, { name: "Checked trip" });
  await addParticipant(page, groupId, "Blaise");

  await page.goto(`/groups/${groupId}/expenses/new`);
  await expect(page.getByLabel("Amount")).toBeVisible();
  await expectNoBlockingViolations(page, "Adding an expense");

  await page.getByLabel("Description").fill("Dinner");
  await page.getByLabel("Amount").fill("30.00");
  await page.getByRole("button", { name: "Add expense" }).click();
  await expectToast(page, "Expense added");

  await page.goto(`/groups/${groupId}`);
  await expect(
    page.getByRole("heading", { name: "Checked trip", level: 1 }),
  ).toBeAttached();
  await expectNoBlockingViolations(page, "The group overview");

  await page.goto(`/groups/${groupId}/settle`);
  await expect(page.getByText(/pays/).first()).toBeVisible();
  await expectNoBlockingViolations(page, "Settling up");
});
