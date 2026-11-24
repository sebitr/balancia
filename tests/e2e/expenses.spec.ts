import { expect, test, type Page } from "@playwright/test";
import {
  addParticipant,
  createGroup,
  expectToast,
  openAddDrawer,
  registerAndSignIn,
} from "./helpers";

/**
 * Adding an entry closes the drawer and confirms in a toast over the group, so
 * "was it saved?" is asked of the toast rather than of the URL.
 */
async function expectEntrySaved(page: Page, title: string): Promise<void> {
  await expectToast(page, title);
}

/**
 * Whether the window is a desk's, which is `lg` and up — the same line
 * `useDeskWidth` draws, since the form is laid out differently either side.
 */
function isDesk(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

/**
 * Opens the split editor.
 *
 * On a phone the summary row states the current split — "Split equally between
 * 3 · about CHF 3.33 each" — and doubles as the way in, so it is matched on the
 * part that does not move with the numbers. On a desk the editor is already on
 * the form, laid out in place, and there is no row to open.
 */
async function openSplit(page: Page): Promise<void> {
  if (isDesk(page)) return;
  await page.getByRole("button", { name: /Split .* between|Split by/ }).click();
}

/** Closes the split editor, which on a desk was never a sheet to close. */
async function closeSplit(page: Page): Promise<void> {
  if (isDesk(page)) return;
  await page.getByRole("button", { name: "Done" }).click();
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
  // The row says it twice, once as the title and once as the link over the row.
  await expect(page.getByText("Dinner").first()).toBeVisible();

  // The transfer that clears it, written as a sentence on the settle screen.
  await page.goto(`/groups/${groupId}/settle`);
  await expect(page.getByText(/pays/).first()).toBeVisible();
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

  // 10.00 between 3 people cannot divide evenly; the UI must say so, by
  // naming whoever pays the cent more than the others who asked for the same
  // — "You pay CHF 0.01 more so it adds up to CHF 10.00." The note is in the
  // split, behind its summary row on a phone and on the form on a desk.
  await openSplit(page);
  await expect(page.getByText(/ more so it adds up to /)).toBeVisible();
  await closeSplit(page);

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
  // The reader's own field is "Your percentage"; everybody else's is named.
  await page.getByLabel("Your percentage").fill("60");
  await page.getByLabel("Percentage for Blaise").fill("40");
  await closeSplit(page);

  await page.getByRole("button", { name: "Add expense" }).click();
  await expectEntrySaved(page, "Expense added");

  await page.goto(`/groups/${groupId}/expenses`);
  await expect(page.getByText("Weekly shop").first()).toBeVisible();
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
  // The reader's own field is "Your percentage"; everybody else's is named.
  await page.getByLabel("Your percentage").fill("60");
  await page.getByLabel("Percentage for Blaise").fill("30");

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

  // Recording opens the add-entry drawer over the screen, on the settle tab
  // with the pair and the outstanding amount already in place.
  await page.goto(`/groups/${groupId}/settle`);
  // The transfer's own row, "Record Blaise's repayment to Ada Lovelace" — not
  // the header's "Record a repayment" that a desk adds above it, which opens
  // the form with no pair chosen and so nothing to save.
  await page.getByRole("link", { name: /s repayment to / }).click();

  await page.getByLabel("Paying back").fill("10.00");
  await page.getByRole("button", { name: "Record repayment" }).click();

  // Back on the settle-up screen, which now reads as a state: one card saying
  // the group is settled, with the repayment just recorded listed under it —
  // told from where the reader stands, so Ada is "you".
  await expect(
    page.getByRole("heading", { name: "The group is settled" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Last repayments" })
      .getByText("Blaise paid you back"),
  ).toBeVisible();
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

  // Currency is a sheet now, opened from the button beside the amount. Picking
  // a row is the whole interaction: there is nothing to confirm after it.
  await page.getByRole("button", { name: "EUR", exact: true }).click();
  await page.getByRole("textbox", { name: "Search a currency" }).fill("USD");
  await page.getByRole("button", { name: /^USD/ }).first().click();

  // A foreign currency must ask for a rate before it can be saved.
  const rateField = page.getByLabel(/Exchange rate/);
  await expect(rateField).toBeVisible();
  await rateField.fill("0.92");

  await page.getByRole("button", { name: "Add expense" }).click();
  await expectEntrySaved(page, "Expense added");

  /*
   * Listed at the rate it was recorded with: a converted group's list speaks
   * the group's currency, so 110 USD at 0.92 reads as €101.20. Asserting the
   * converted figure rather than the typed one is what actually pins the
   * arithmetic down — the original amount would pass even if the rate were
   * dropped on the floor.
   */
  await page.goto(`/groups/${groupId}/expenses`);
  await expect(page.getByText("€101.20").first()).toBeVisible();

  // And balanced in that same base currency.
  await page.goto(`/groups/${groupId}/settle`);
  await expect(page.getByText(/EUR|€/).first()).toBeVisible();
});

test("configures a recurring expense", async ({ page }) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Recurring" });
  await addParticipant(page, groupId, "Blaise");

  // A recurring expense is made on the entry form, as a repeat switched on: the
  // recurring list only shows and edits what already exists. Monthly is what
  // the switch starts at.
  await page.goto(`/groups/${groupId}/expenses/new`);
  await page.getByLabel("Description").fill("Rent");
  await page.getByLabel("Amount").fill("1200.00");
  await page.getByRole("switch", { name: "Repeats" }).click();

  await page.getByRole("button", { name: "Save recurring expense" }).click();
  await expect(page).not.toHaveURL(/\/expenses\/new/);

  /*
   * A desk lists the rules as a table, and the phone's list is in the HTML
   * beside it with `display: none`. The table folds the schedule into the
   * description's second line when it is narrow and gives it a column when it
   * is not — both drawn, one shown — so the sentence is the visible one of
   * the row's two.
   */
  await page.goto(`/groups/${groupId}/recurring`);
  const rent = page
    .getByRole("table", { name: "Recurring expenses" })
    .getByRole("row")
    .filter({ hasText: "Rent" });
  await expect(rent.getByText("Rent", { exact: true })).toBeVisible();
  await expect(
    rent.getByText(/Every month on the/).filter({ visible: true }),
  ).toBeVisible();
});

/**
 * The drawer, opened the way people actually open it, and closed by saving.
 *
 * Every other test here lands on `/expenses/new` directly, which renders the
 * standalone page rather than the intercepted drawer. The bottom bar's Add is
 * the intercepted one, and the whole point of intercepting is that leaving
 * *pops* the modal's history entry. Confirming with a screen that pushed
 * `/groups/<id>` instead left the drawer sitting behind the group in the back
 * stack, so the next back gesture — the ordinary way out of anything on a
 * phone — opened it again over a group the reader had just come back to.
 */
test("saving from the intercepted drawer leaves the group uncovered", async ({
  page,
}) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Intercepted" });
  await addParticipant(page, groupId, "Blaise");

  await page.goto(`/groups/${groupId}`);
  await openAddDrawer(page);

  const drawer = page.getByRole("dialog", { name: "Add expense" });
  await expect(drawer).toBeVisible();

  await page.getByLabel("Description").fill("Taxi");
  await page.getByLabel("Amount").fill("30.00");
  await page.getByRole("button", { name: "Add expense" }).click();

  // No confirmation screen: the drawer leaves, and says what it saved from
  // outside itself.
  await expectEntrySaved(page, "Expense added");
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));
  await expect(drawer).toBeHidden();

  // The group behind is current, not the empty one the drawer opened over:
  // the position only exists once the group has an expense in it.
  //
  // Not the "since your last visit" line, which this used to read. That
  // section is keyed on `lastOpenedAt`, which the overview stamps in an
  // `after()` on every render of itself — and leaving the drawer renders it
  // twice, once from the pop and once from the `router.refresh()` behind it.
  // The first render shows the new entry as news and moves the boundary past
  // it; the second, which is the one left on screen, has nothing unseen to
  // report. Whether the assertion caught the first render was a coin flip,
  // and CI lost it both times.
  //
  // "Your position" is what names that region here — the `sr-only` heading
  // `PositionHero` and `PositionCard` are labelled by, rendered only once the
  // group has something in it to take a position on. It read "Total balance"
  // from #323 until this branch, which is the home screen's eyebrow on the
  // dashboard's own widget and has never been on a group: the replacement
  // assertion was never capable of passing, and it failed on every run from
  // the day it landed.
  await expect(
    page.getByRole("region", { name: "Your position" }),
  ).toBeVisible();

  // And going back from the group leaves it, rather than reopening the form.
  await page.goBack();
  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/\/expenses\/new$/);
});
