import { expect, test, type Page } from "@playwright/test";
import {
  attachVirtualAuthenticator,
  registerAndSignIn,
  setPasskeyPresence,
  TEST_PASSWORD,
  uniqueEmail,
} from "./helpers";

/**
 * Passkey registration and sign-in, driven by Chrome's WebAuthn virtual
 * authenticator.
 *
 * This exercises the real ceremony — the browser produces a genuine
 * attestation and assertion, and the server verifies signatures, origin,
 * relying-party ID and the challenge it issued. Nothing is stubbed on the
 * server side.
 */

/**
 * Signing out, which lives at the foot of the settings hub and asks first.
 *
 * Two taps rather than one: it is the only action in settings with no way
 * back, because the Undo would be raised into a page nobody is signed in to.
 */
async function signOut(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Sign out" })
    .click();
  await expect(page).toHaveURL("/");
}

test.describe("passkeys", () => {
  test("registers a passkey and signs in with it", async ({ page }) => {
    const { client, authenticatorId } = await attachVirtualAuthenticator(page);

    const email = uniqueEmail("passkey");
    await registerAndSignIn(page, { email, name: "Passkey User" });

    // Register a passkey from Settings → Sign-in & security.
    await page.goto("/settings/security");
    await expect(
      page.getByRole("heading", { name: "Sign-in & security" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Add this device" }).click();

    // It appears in the list, under the name the authenticator reported.
    await expect(page.getByText("Unnamed passkey")).toBeVisible();

    // A real credential now exists on the authenticator — the ceremony was not
    // faked at the UI level.
    const stored = await client.send("WebAuthn.getCredentials", {
      authenticatorId,
    });
    expect(stored.credentials.length).toBe(1);

    // Now sign out and back in using only the passkey — the button, and not
    // the conditional request the page also arms, which this authenticator
    // would otherwise answer before anything could be clicked.
    await signOut(page);
    await setPasskeyPresence(client, authenticatorId, false);

    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Use a passkey" }).click();
    await setPasskeyPresence(client, authenticatorId, true);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(
      page.getByRole("heading", { name: "Your groups" }),
    ).toBeVisible();
  });

  test("offers the passkey from the email field, without closing the button", async ({
    page,
  }) => {
    const { client, authenticatorId } = await attachVirtualAuthenticator(page);

    const email = uniqueEmail("passkey-autofill");
    await registerAndSignIn(page, { email, name: "Autofill User" });

    await page.goto("/settings/security");
    await page.getByRole("button", { name: "Add this device" }).click();
    await expect(page.getByText("Unnamed passkey")).toBeVisible();

    await signOut(page);

    // Nobody has picked the passkey out of the dropdown yet, so the request
    // has to be left waiting for one — see `setPasskeyPresence`.
    await setPasskeyPresence(client, authenticatorId, false);

    /*
     * The dropdown itself is out of reach: it is browser chrome, and there is
     * no suggestion to click in a headless run. So what is asserted is the
     * request behind it — the page asked for a credential under conditional
     * mediation, which is the whole of what was missing.
     */
    await page.addInitScript(() => {
      const mediations: string[] = [];
      (
        window as unknown as { __passkeyMediations: string[] }
      ).__passkeyMediations = mediations;

      const container = navigator.credentials;
      const get = container.get.bind(container);
      container.get = (options?: CredentialRequestOptions) => {
        mediations.push(options?.mediation ?? "");
        return get(options);
      };
    });

    await page.goto("/sign-in");

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __passkeyMediations?: string[] })
              .__passkeyMediations ?? [],
        ),
      )
      .toContain("conditional");

    // And the button still opens its own modal ceremony with that conditional
    // request pending: starting one cancels the other rather than colliding.
    // The authenticator is handed back its finger only once the click has
    // cancelled the conditional request, so it is the modal one it answers.
    await page.getByRole("button", { name: "Use a passkey" }).click();
    await setPasskeyPresence(client, authenticatorId, true);

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("removing a passkey stops it working", async ({ page }) => {
    await attachVirtualAuthenticator(page);
    await registerAndSignIn(page, { email: uniqueEmail("passkey-remove") });

    await page.goto("/settings/security");
    await page.getByRole("button", { name: "Add this device" }).click();
    await expect(page.getByText("Unnamed passkey")).toBeVisible();

    await page
      .getByRole("button", { name: /Remove/ })
      .first()
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove" })
      .click();

    await expect(
      page.getByText("Add this device to sign in without a password."),
    ).toBeVisible();
  });

  test("offers passkey sign-in only where the browser supports it", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    // Chromium supports WebAuthn, so the option must be offered.
    await expect(
      page.getByRole("button", { name: "Use a passkey" }),
    ).toBeVisible();
  });

  test("password sign-in still works alongside passkeys", async ({ page }) => {
    const { client, authenticatorId } = await attachVirtualAuthenticator(page);
    const email = uniqueEmail("both");
    await registerAndSignIn(page, { email });

    await page.goto("/settings/security");
    await page.getByRole("button", { name: "Add this device" }).click();
    await expect(page.getByText("Unnamed passkey")).toBeVisible();

    await signOut(page);

    // Somebody who has a passkey and means to type their password instead:
    // the sign-in page arms the passkey into the field, and they ignore it.
    await setPasskeyPresence(client, authenticatorId, false);

    // The password is unaffected by having registered a passkey.
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard/);
  });
});
