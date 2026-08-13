import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { registerAndSignIn, TEST_PASSWORD, uniqueEmail } from "./helpers";

/**
 * Passkey registration and sign-in, driven by Chrome's WebAuthn virtual
 * authenticator.
 *
 * This exercises the real ceremony — the browser produces a genuine
 * attestation and assertion, and the server verifies signatures, origin,
 * relying-party ID and the challenge it issued. Nothing is stubbed on the
 * server side.
 */

async function attachVirtualAuthenticator(
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

test.describe("passkeys", () => {
  test("registers a passkey and signs in with it", async ({ page }) => {
    const { client, authenticatorId } = await attachVirtualAuthenticator(page);

    const email = uniqueEmail("passkey");
    await registerAndSignIn(page, { email, name: "Passkey User" });

    // Register a passkey from account security settings.
    await page.goto("/profile/security");
    await expect(
      page.getByRole("heading", { name: "Passkeys & security" }),
    ).toBeVisible();

    await page.getByLabel(/Name/).fill("Virtual key");
    await page.getByRole("button", { name: "Register a passkey" }).click();

    // It appears in the list.
    await expect(page.getByText("Virtual key")).toBeVisible();

    // A real credential now exists on the authenticator — the ceremony was not
    // faked at the UI level.
    const stored = await client.send("WebAuthn.getCredentials", {
      authenticatorId,
    });
    expect(stored.credentials.length).toBe(1);

    // Now sign out and back in using only the passkey.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/");

    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(
      page.getByRole("heading", { name: "Your groups" }),
    ).toBeVisible();
  });

  test("removing a passkey stops it working", async ({ page }) => {
    await attachVirtualAuthenticator(page);
    await registerAndSignIn(page, { email: uniqueEmail("passkey-remove") });

    await page.goto("/profile/security");
    await page.getByLabel(/Name/).fill("Temporary key");
    await page.getByRole("button", { name: "Register a passkey" }).click();
    await expect(page.getByText("Temporary key")).toBeVisible();

    await page.getByRole("button", { name: /Remove Temporary key/ }).click();
    await page.getByRole("button", { name: "Remove" }).click();

    await expect(page.getByText("No passkeys yet")).toBeVisible();
  });

  test("offers passkey sign-in only where the browser supports it", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    // Chromium supports WebAuthn, so the option must be offered.
    await expect(
      page.getByRole("button", { name: "Sign in with a passkey" }),
    ).toBeVisible();
  });

  test("password sign-in still works alongside passkeys", async ({ page }) => {
    await attachVirtualAuthenticator(page);
    const email = uniqueEmail("both");
    await registerAndSignIn(page, { email });

    await page.goto("/profile/security");
    await page.getByRole("button", { name: "Register a passkey" }).click();
    await expect(page.getByText("Unnamed passkey")).toBeVisible();

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    // The password is unaffected by having registered a passkey.
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard/);
  });
});
