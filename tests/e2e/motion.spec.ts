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

/** Opens the drawer, closes it again, and reports what the screen did. */
async function openAndCloseDrawer(page: Page): Promise<{
  opening: Awaited<ReturnType<typeof readScreen>>;
  closing: Awaited<ReturnType<typeof readScreen>>;
}> {
  const drawer = page.getByRole("dialog", { name: "Add expense" });

  await watchScreen(page);
  await page.getByRole("link", { name: "Add", exact: true }).click();
  await expect(drawer).toBeVisible();
  await page.waitForTimeout(600);
  const opening = await readScreen(page);

  await watchScreen(page);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();
  await page.waitForTimeout(900);
  const closing = await readScreen(page);

  return { opening, closing };
}

const STILL = { transitions: 0, remounted: false, animated: 0 };

/**
 * The bottom bar is on every screen in the group, so the drawer opens over
 * whichever one you were reading — and every one of them has to hold still.
 * The overview alone passed while the transactions list underneath still slid,
 * because the screen it was keyed to was the group's own path rather than the
 * path it was actually on.
 */
test("every group screen holds still under the add-entry drawer", async ({
  page,
}) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Motion" });
  await addParticipant(page, groupId, "Blaise");

  for (const path of ["", "/expenses", "/balances", "/members"]) {
    await page.goto(`/groups/${groupId}${path}`);
    const { opening, closing } = await openAndCloseDrawer(page);

    expect(opening, `opening over /groups/<id>${path}`).toEqual(STILL);
    expect(closing, `closing over /groups/<id>${path}`).toEqual(STILL);
    await expect(page).toHaveURL(new RegExp(`/groups/${groupId}${path}$`));
  }
});

/**
 * The same URL, reached from outside the group, is not a drawer at all.
 *
 * `(.)` only intercepts within the group, so the dashboard's picker lands on
 * the standalone page — a screen in its own right, which must not be pinned to
 * the dashboard the way the drawer is pinned to the group behind it.
 *
 * Only the remount is asserted. This navigation crosses from the `(app)` shell
 * into the group's, so `<Screen>` is torn down with its layout and no view
 * transition runs at all — which is true either side of this change, and not
 * this test's business.
 */
test("reaching the same form from the dashboard is a screen of its own", async ({
  page,
}) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Motion outside" });
  await page.goto("/dashboard");

  await page.getByRole("button", { name: "Add expense" }).click();
  const picker = page.getByRole("dialog", { name: "Add to which group?" });
  await expect(picker).toBeVisible();

  await watchScreen(page);
  await picker.getByRole("link", { name: /Motion outside/ }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/expenses/new$`));
  await page.waitForTimeout(600);

  const arrived = await readScreen(page);
  expect(arrived.remounted).toBe(true);
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
