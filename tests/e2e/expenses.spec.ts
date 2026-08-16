import { expect, test, type Page } from "@playwright/test";
import { addParticipant, createGroup, registerAndSignIn } from "./helpers";

/**
 * Adding an entry ends on a confirmation inside the dialog rather than a
 * navigation, so "was it saved?" is asked of the dialog, not the URL.
 */
async function expectEntrySaved(page: Page, heading: string): Promise<void> {
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
}

/**
 * Opens the split editor.
 *
 * The summary row states the current split — "Split equally between 3 · CHF
 * 3.34 each" — and doubles as the way in, so it is matched on the part that
 * does not move with the numbers.
 */
async function openSplit(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Split .* between|Split by/ }).click();
}

/**
 * The core journey: register, create a group, add an equal expense, and see
 * balances that add up.
 */
test("register, create a group and add an equal expense", async ({ page }) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Weekend trip" });
  await addParticipant(page, groupId, "Blaise");

  await page.goto(`/groups/${groupId}/expenses/new`);
  await page.getByLabel("Description").fill("Dinner");
  await page.getByLabel("Amount").fill("30.00");

  // Both participants are selected by default; the split preview should show
  // an even 15.00 each.
  await expect(page.getByText("15.00").first()).toBeVisible();

  await page.getByRole("button", { name: "Add expense" }).click();
  await expectEntrySaved(page, "Expense added");

  await page.goto(`/groups/${groupId}/expenses`);
  await expect(page.getByText("Dinner")).toBeVisible();

  // Balances: the payer is owed 15.00, the other owes 15.00.
  await page.goto(`/groups/${groupId}/balances`);
  await expect(page.getByText("gets back").first()).toBeVisible();
  await expect(page.getByText("owes").first()).toBeVisible();
});

test("shows the rounding difference when a split does not divide evenly", async ({
  page,
}) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Rounding" });
  await addParticipant(page, groupId, "Blaise");
  await addParticipant(page, groupId, "Grace");

  await page.goto(`/groups/${groupId}/expenses/new`);
  await page.getByLabel("Description").fill("Coffee");
  await page.getByLabel("Amount").fill("10.00");

  // 10.00 between 3 people cannot divide evenly; the UI must say so. The
  // split lives behind its summary row now, and the note with it.
  await openSplit(page);
  await expect(page.getByText(/could not be split evenly/)).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Add expense" }).click();
  await expectEntrySaved(page, "Expense added");
});

test("records an expense split by percentage", async ({ page }) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Percentages" });
  await addParticipant(page, groupId, "Blaise");

  await page.goto(`/groups/${groupId}/expenses/new`);
  // Not "Groceries": that is also a category name, and the assertion below
  // would match the category chip as well as the expense.
  await page.getByLabel("Description").fill("Weekly shop");
  await page.getByLabel("Amount").fill("100.00");

  await openSplit(page);
  await page.getByRole("button", { name: "Percent" }).click();
  const inputs = page.getByLabel(/Percentage for/);
  await inputs.nth(0).fill("60");
  await inputs.nth(1).fill("40");
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Add expense" }).click();
  await expectEntrySaved(page, "Expense added");

  await page.goto(`/groups/${groupId}/expenses`);
  await expect(page.getByText("Weekly shop")).toBeVisible();
});

test("rejects percentages that do not add up to 100", async ({ page }) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Bad percentages" });
  await addParticipant(page, groupId, "Blaise");

  await page.goto(`/groups/${groupId}/expenses/new`);
  await page.getByLabel("Description").fill("Wrong");
  await page.getByLabel("Amount").fill("50.00");

  await openSplit(page);
  await page.getByRole("button", { name: "Percent" }).click();
  const inputs = page.getByLabel(/Percentage for/);
  await inputs.nth(0).fill("60");
  await inputs.nth(1).fill("30");

  await expect(page.getByText(/not 100%/)).toBeVisible();
});

test("records a settlement and clears the balance", async ({ page }) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Settling up" });
  await addParticipant(page, groupId, "Blaise");

  await page.goto(`/groups/${groupId}/expenses/new`);
  await page.getByLabel("Description").fill("Taxi");
  await page.getByLabel("Amount").fill("20.00");
  await page.getByRole("button", { name: "Add expense" }).click();
  await expectEntrySaved(page, "Expense added");

  await page.goto(`/groups/${groupId}/balances`);
  await page.getByRole("button", { name: "Settle up" }).click();

  await page.getByLabel("Who paid").selectOption({ label: "Blaise" });
  await page.getByLabel("Who received it").selectOption({ index: 0 });
  await page.getByLabel("Amount").fill("10.00");
  await page.getByRole("button", { name: "Record payment" }).click();

  await expect(page.getByText("Everyone is settled up")).toBeVisible();
});

test("records a multi-currency expense in a converted group", async ({
  page,
}) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, {
    name: "Multi-currency",
    mode: "converted",
    baseCurrency: "EUR",
  });
  await addParticipant(page, groupId, "Blaise");

  await page.goto(`/groups/${groupId}/expenses/new`);
  await page.getByLabel("Description").fill("Duty free");
  await page.getByLabel("Amount").fill("110.00");

  // Currency is a sheet now, opened from the button beside the amount.
  await page.getByRole("button", { name: "EUR", exact: true }).click();
  await page.getByLabel("Search by code or name").fill("USD");
  await page.getByRole("button", { name: /USD/ }).first().click();
  await page.getByRole("button", { name: "Done" }).click();

  // A foreign currency must ask for a rate before it can be saved.
  const rateField = page.getByLabel(/Exchange rate/);
  await expect(rateField).toBeVisible();
  await rateField.fill("0.92");

  await page.getByRole("button", { name: "Add expense" }).click();
  await expectEntrySaved(page, "Expense added");

  // Listed in its original currency…
  await page.goto(`/groups/${groupId}/expenses`);
  await expect(page.getByText("$110.00")).toBeVisible();

  // …but balanced in the group's base currency.
  await page.goto(`/groups/${groupId}/balances`);
  await expect(page.getByRole("heading", { name: "EUR" })).toBeVisible();
});

test("configures a recurring expense", async ({ page }) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Recurring" });
  await addParticipant(page, groupId, "Blaise");

  await page.goto(`/groups/${groupId}/recurring`);
  await page.getByLabel("Description").fill("Rent");
  await page.getByLabel("Amount").fill("1200.00");
  await page.getByLabel("Repeats").selectOption("monthly");
  await page.getByLabel("Day of month").fill("1");

  await page.getByRole("button", { name: "Create recurring expense" }).click();

  await expect(page.getByText("Rent")).toBeVisible();
  await expect(page.getByText(/Every month on day 1/)).toBeVisible();
});
