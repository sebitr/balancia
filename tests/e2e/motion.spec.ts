import { expect, test, type Page } from "@playwright/test";
import { addParticipant, createGroup, registerAndSignIn } from "./helpers";

/**
 * What moves when you navigate, and what does not.
 *
 * The screen animates between screens and holds still under a drawer. Neither
 * is visible to an assertion about the DOM, so this watches the two mechanisms
 * that produce the motion: the view transition the router starts, and the
 * remount of `[data-slot="screen"]` that gives its enter and exit animations
 * something to animate.
 */

/** Starts watching, from whatever the page is showing now. */
async function watchScreen(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__transitions = 0;
    w.__anims = [] as string[];
    w.__screen = document.querySelector('[data-slot="screen"]');

    // Patched once per watch, and always over the previous patch, so a second
    // call does not stack another counter on top of the first.
    const doc = document as unknown as {
      startViewTransition?: (cb: () => void) => { ready?: Promise<void> };
      __originalStartViewTransition?: (cb: () => void) => {
        ready?: Promise<void>;
      };
    };
    doc.__originalStartViewTransition ??= doc.startViewTransition?.bind(
      document,
    ) as typeof doc.startViewTransition;
    const original = doc.__originalStartViewTransition;
    if (!original) return;

    doc.startViewTransition = (callback: () => void) => {
      w.__transitions = (w.__transitions as number) + 1;
      const transition = original(callback);
      // The pseudo-elements only exist once the transition is ready; that is
      // also the only moment their animations are listed.
      void transition.ready?.then(() => {
        (w.__anims as string[]).push(
          ...document
            .getAnimations()
            .map((a) => (a.effect as KeyframeEffect)?.pseudoElement ?? "")
            .filter((name) => name.startsWith("::view-transition-old")),
        );
      });
      return transition;
    };
  });
}

async function readScreen(
  page: Page,
): Promise<{ transitions: number; remounted: boolean; animated: number }> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return {
      transitions: w.__transitions as number,
      remounted: w.__screen !== document.querySelector('[data-slot="screen"]'),
      animated: (w.__anims as string[]).length,
    };
  });
}

test("the group holds still under the add-entry drawer", async ({ page }) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Motion" });
  await addParticipant(page, groupId, "Blaise");
  await page.goto(`/groups/${groupId}`);

  // Opening. The drawer rises over the group; the group does nothing.
  await watchScreen(page);
  await page.getByRole("link", { name: "Add", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add expense" })).toBeVisible();
  await page.waitForTimeout(600);

  const opening = await readScreen(page);
  expect(opening).toEqual({ transitions: 0, remounted: false, animated: 0 });

  // Closing. Likewise — the screen underneath was never left.
  await watchScreen(page);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: "Add expense" })).toBeHidden();
  await page.waitForTimeout(900);

  const closing = await readScreen(page);
  expect(closing).toEqual({ transitions: 0, remounted: false, animated: 0 });
});

/**
 * The other half of the same rule: a move between two real screens still
 * animates. Keying every path to the same screen would silence the drawer and
 * the bottom bar alike, and pass the test above for the wrong reason.
 */
test("moving along the bottom bar still animates the screen", async ({
  page,
}) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Motion bar" });
  await page.goto(`/groups/${groupId}`);

  await watchScreen(page);
  await page.getByRole("link", { name: "Expenses", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/expenses$`));
  await page.waitForTimeout(600);

  const moved = await readScreen(page);
  expect(moved.transitions).toBe(1);
  expect(moved.remounted).toBe(true);
  expect(moved.animated).toBeGreaterThan(0);
});
