import { expect, test } from "@playwright/test";
import { createGroup, expectToast, registerAndSignIn } from "./helpers";

/**
 * Mobile viewport behaviour. Runs on the Pixel 7 project.
 */
test("shows bottom navigation and no horizontal overflow on a phone", async ({
  page,
}) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Mobile group" });

  await page.goto(`/groups/${groupId}`);

  // The group's bottom navigation is the primary way around on a phone.
  const nav = page.getByRole("navigation", { name: "Group sections" });
  await expect(nav).toBeVisible();
  for (const label of ["Overview", "Expenses", "Add", "People", "Settings"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }

  // Nothing may spill sideways: horizontal scrolling on a phone is a bug.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows).toBe(false);
});

test("the add-expense form is usable at a phone width", async ({ page }) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Mobile form" });

  await page.goto(`/groups/${groupId}/expenses/new`);
  await expect(page.getByLabel("Description")).toBeVisible();
  await expect(page.getByLabel("Amount")).toBeVisible();

  await page.getByLabel("Description").fill("Snack");
  await page.getByLabel("Amount").fill("5.00");
  await page.getByRole("button", { name: "Add expense" }).click();

  // The drawer leaves and confirms in a toast; the list is a navigation away.
  await expectToast(page, "Expense added");
  await page.goto(`/groups/${groupId}/expenses`);
  await expect(page.getByText("Snack")).toBeVisible();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows).toBe(false);
});

test("navigating with the bottom bar moves between sections", async ({
  page,
}) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Nav group" });
  await page.goto(`/groups/${groupId}`);

  const nav = page.getByRole("navigation", { name: "Group sections" });
  await nav.getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/members$`));
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/settings$`));
});
