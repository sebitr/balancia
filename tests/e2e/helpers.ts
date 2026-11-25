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
 * Opens the settings hub from the account link.
 *
 * The link has two names because it is two elements: a phone's header says
 * "Your account", and the sidebar a desktop window gets says who is signed in,
 * "Ada Lovelace, Settings". Only one of them is on screen at a time, so
 * matching either finds it at either width.
 *
 * Only from the app: settings is a surface of its own that replaces the app's
 * chrome, the account link with it.
 */
export async function openSettings(page: Page): Promise<void> {
  await page.getByRole("link", { name: /^Your account$|, Settings$/ }).click();
}

/**
 * Signs out, which lives at the foot of the settings hub and asks first.
 *
 * Two presses rather than one: it is the only action in settings with no way
 * back, because the Undo would be raised into a page nobody is signed in to.
 *
 * On a desk the hub is the navigation pane down the left of every settings
 * screen, and the account screen a desk opens `/settings` on has a Sign out
 * row of its own — so the button is the pane's, which is there whichever
 * screen is beside it, and is waited for: the pane streams in after the
 * screen. From inside settings there is no account link to open it from, and
 * nothing to open.
 */
export async function signOut(page: Page): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith("/settings")) {
    await openSettings(page);
  }
  await page
    .getByRole("navigation", { name: "Settings", exact: true })
    .getByRole("button", { name: "Sign out" })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Sign out" })
    .click();
  await expect(page).toHaveURL("/");
}

/**
 * Opens the add-entry drawer from the group's Add link.
 *
 * "Add" is the bottom bar a phone has; the sidebar a desktop window has says
 * "Add expense", since it has the room.
 */
export async function openAddDrawer(page: Page): Promise<void> {
  await page.getByRole("link", { name: /^Add( expense)?$/ }).click();
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
 * Opens someone's row and issues them a personal link, returning the URL from
 * its one-time reveal. The row offers it as a quiet button that asks how long
 * the link should last before it makes one.
 */
export async function createInviteLink(
  page: Page,
  groupId: string,
  name: string,
): Promise<string> {
  await page.goto(`/groups/${groupId}/members`);
  // A phone opens the row; a desk draws the people as a table whose name is a
  // link to the person's page, and whose options button opens the same panel.
  // Only one of the two is on screen at a time.
  await page
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .or(page.getByRole("button", { name: `Options for ${name}` }))
    .click();
  await page.getByRole("button", { name: `Personal link for ${name}` }).click();
  await page.getByRole("button", { name: "Create the link" }).click();

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
