import { expect, type CDPSession, type Page } from "@playwright/test";

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

  /*
   * The password form, which is no longer what `/register` shows.
   *
   * `/register` leads with a passkey and falls back to a mailed code, and
   * neither is reachable from a headless browser with no authenticator and no
   * mail server. The password form is still there for the one instance that
   * can offer neither, and that is what every other journey needs from this
   * helper: an account, in as few steps as possible, so the test can get on
   * with what it is actually about. Onboarding itself is covered by
   * `onboarding.spec.ts`.
   */
  await page.goto("/register/password");
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
    await page.getByRole("radio", { name: /A balance per currency/ }).click();
  }

  if (options.baseCurrency) {
    // The currency is one row that opens the full list in the same sheet, and
    // it is only there under the converted answer — the mode that has a
    // balance for it to be in.
    await page.getByRole("button", { name: /That balance is in/ }).click();
    await page
      .getByRole("textbox", { name: "Search a currency" })
      .fill(options.baseCurrency);
    await page
      .getByRole("button", { name: new RegExp(`^${options.baseCurrency}`) })
      .click();
  }

  await page.getByRole("button", { name: "Create group" }).click();
  // Creating a group hands over its invite link before going anywhere. Nothing
  // below needs the link, so every caller here takes the way past it.
  await page.getByRole("button", { name: "Later" }).click();
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

  /*
   * Shown once, in a code block rather than a field: it is there to be copied,
   * never edited — and the code block is what this reads, rather than the
   * first `/join/` on the page.
   *
   * This page also carries the group's own invite link, which is on screen
   * before the button is even pressed. Matching the page for `/join/` would
   * resolve to that one immediately and never wait for this one to arrive:
   * the test would then walk a whole group's link through the guest flow and
   * fail somewhere further along, saying nothing about what went wrong.
   */
  const url = await page
    .locator("code")
    .filter({ hasText: "/join/" })
    .first()
    .innerText();
  expect(url).toContain("/join/");
  return url.trim();
}

/**
 * Chrome's WebAuthn virtual authenticator, attached to one page.
 *
 * What it buys is a real ceremony rather than a stubbed one: the browser
 * produces a genuine attestation, and the server verifies the signature, the
 * origin, the relying-party ID and the challenge it issued. Nothing on the
 * server side knows this authenticator is not a phone.
 */
export async function attachVirtualAuthenticator(
  page: Page,
): Promise<{ client: CDPSession; authenticatorId: string }> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  return { client, authenticatorId };
}

/**
 * Whether the virtual authenticator answers a request nobody has approved.
 *
 * On from the moment it is attached, which is what lets a test click "Use a
 * passkey" and be signed in without a fingerprint to give. It has to be turned
 * off for the sign-in page's conditional request, which a real authenticator
 * leaves pending until the reader picks the passkey out of the browser's
 * autofill dropdown — this one, left to itself, signs them straight in.
 */
export async function setPasskeyPresence(
  client: CDPSession,
  authenticatorId: string,
  enabled: boolean,
): Promise<void> {
  await client.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId,
    enabled,
  });
}
