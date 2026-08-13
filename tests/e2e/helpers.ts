import { expect, type Page } from "@playwright/test";

/**
 * Shared steps for the end-to-end journeys.
 *
 * Each test registers its own account so runs are independent and can be
 * repeated against the same database without cleanup.
 */

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

export async function createGroup(
  page: Page,
  options: {
    name: string;
    mode?: "separate" | "converted";
    baseCurrency?: string;
  },
): Promise<string> {
  await page.goto("/groups/new");
  await page.getByLabel("Group name").fill(options.name);

  if (options.mode === "converted") {
    await page
      .getByRole("radio", { name: /Convert to one base currency/ })
      .click();
    if (options.baseCurrency) {
      // Scoped by role: "Base currency" also matches the radio option's label.
      await page
        .getByRole("combobox", { name: "Base currency" })
        .selectOption(options.baseCurrency);
    }
  }

  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/);

  const groupId = page.url().split("/groups/")[1];
  return groupId;
}

export async function addParticipant(
  page: Page,
  groupId: string,
  name: string,
): Promise<void> {
  await page.goto(`/groups/${groupId}/members`);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}
