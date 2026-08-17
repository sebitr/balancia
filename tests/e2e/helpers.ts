import { expect, type Page } from "@playwright/test";

/**
 * Shared steps for the end-to-end journeys.
 *
 * Each test registers its own account so runs are independent and can be
 * repeated against the same database without cleanup.
 */

/**
 * A toast, by what it says.
 *
 * Matched on the toast element rather than on the text anywhere on the page:
 * "Expense added" is also the sort of thing a list behind it could be showing,
 * and the point of the assertion is that the confirmation appeared.
 */
export async function expectToast(page: Page, text: string): Promise<void> {
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: text }),
  ).toBeVisible();
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.test`;
}

export const TEST_PASSWORD = "playwright-test-password";

export async function registerAndSignIn(
  page: Page,
  options: { name?: string; email?: string } = {},
): Promise<{ email: string; name: string }> {
  const email = options.email ?? uniqueEmail("e2e");
  const name = options.name ?? "Ada Lovelace";

  await page.goto("/register");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  return { email, name };
}

/**
 * Creates a group through the sheet at `/groups/new`.
 *
 * The name field carries no label, only a placeholder, so it is addressed by
 * its accessible name. Converted is the sheet's own default, which is why only
 * "separate" needs a click.
 */
export async function createGroup(
  page: Page,
  options: {
    name: string;
    mode?: "separate" | "converted";
    baseCurrency?: string;
  },
): Promise<string> {
  await page.goto("/groups/new");
  await page.getByRole("textbox", { name: "Group name" }).fill(options.name);

  if (options.mode === "separate") {
    await page.getByRole("radio", { name: /Keep currencies separate/ }).click();
  }

  if (options.baseCurrency) {
    // The currency is one row that opens the full list in the same sheet.
    await page.getByRole("button", { name: /currency/i }).click();
    await page
      .getByRole("textbox", { name: "Search a currency" })
      .fill(options.baseCurrency);
    await page
      .getByRole("button", { name: new RegExp(`^${options.baseCurrency}`) })
      .click();
  }

  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/);

  const groupId = page.url().split("/groups/")[1];
  return groupId;
}

/**
 * Adds someone with no way in — the "Just add them" path.
 *
 * The composer offers a link by default, which most callers here do not want:
 * the invitation tests issue one deliberately, and the rest only need a name to
 * split an expense with.
 */
export async function addParticipant(
  page: Page,
  groupId: string,
  name: string,
): Promise<void> {
  await page.goto(`/groups/${groupId}/members`);
  await page.getByRole("button", { name: "Add someone" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Just add them" }).click();
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}

/**
 * Opens someone's row and issues them an invitation link, returning the URL
 * from its one-time reveal.
 */
export async function createInviteLink(
  page: Page,
  groupId: string,
  name: string,
): Promise<string> {
  await page.goto(`/groups/${groupId}/members`);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Create invite link" }).click();

  // Shown once, in a code block rather than a field: it is there to be copied,
  // never edited.
  const url = await page
    .getByText(/\/join\//)
    .first()
    .innerText();
  expect(url).toContain("/join/");
  return url.trim();
}
