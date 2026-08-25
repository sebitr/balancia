import { expect, test } from "@playwright/test";
import {
  addParticipant,
  attachVirtualAuthenticator,
  createGroup,
  createInviteLink,
  registerAndSignIn,
  uniqueEmail,
} from "./helpers";

/**
 * Getting in, from the two directions somebody can arrive from.
 *
 * The cold journey is the one worth driving end to end, because it is the only
 * place where the whole passkey signup runs for real: the browser produces an
 * attestation for an account that does not exist yet, and the server creates
 * the user and the credential in one transaction on the strength of it. There
 * is no password anywhere in it and no mail server involved.
 *
 * The code path is not driven here. It ends in an inbox, and the test instance
 * has no SMTP — which is also why the screens do not offer it there.
 */

test.describe("onboarding", () => {
  test("creates an account with a passkey and no password", async ({
    page,
  }) => {
    const { client, authenticatorId } = await attachVirtualAuthenticator(page);
    const email = uniqueEmail("onboarding");

    await page.goto("/register");

    // No group card and no guest option: there is no group to describe, and
    // nothing to be a guest of.
    await expect(
      page.getByRole("heading", { name: "Where do I stand?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Continue as a guest/ }),
    ).toBeHidden();

    await page.getByRole("button", { name: "Create an account" }).click();

    await page.getByPlaceholder("you@example.com").fill(email);
    await page.getByRole("button", { name: /Continue with a passkey/ }).click();

    // The name is asked for after the account exists, not before it.
    await expect(
      page.getByRole("heading", { name: /Last thing — your name/ }),
    ).toBeVisible();
    await page.getByRole("textbox", { name: "Your name" }).fill("Ada Lovelace");
    // "Continue" rather than "Create my account": the passkey already created
    // it, and this screen is naming an account that exists.
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByRole("heading", { name: "You're in, Ada" }),
    ).toBeVisible();
    await expect(page.getByText("No groups yet")).toBeVisible();

    // A real credential now sits on the authenticator, which is what makes the
    // account reachable again on this device.
    const { credentials } = await client.send("WebAuthn.getCredentials", {
      authenticatorId,
    });
    expect(credentials.length).toBe(1);

    await page.getByRole("button", { name: "Create your first group" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("walks an invited guest to the group without asking for an address", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await registerAndSignIn(ownerPage);
    const groupId = await createGroup(ownerPage, { name: "Verbier" });
    // The link is addressed to one participant, so that participant has to
    // exist before there is anything to address it to.
    await addParticipant(ownerPage, groupId, "Grace");
    const inviteUrl = await createInviteLink(ownerPage, groupId, "Grace");

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await guestPage.goto(inviteUrl);

    await expect(guestPage).toHaveURL(/\/invite$/);
    await guestPage
      .getByRole("button", { name: /Continue as a guest/ })
      .click();

    // The name the group already knows them by is prefilled — asking again
    // would only invite a second spelling of the same person.
    await expect(
      guestPage.getByRole("textbox", { name: "Your name" }),
    ).toHaveValue("Grace");
    await guestPage.getByRole("button", { name: "Join as a guest" }).click();

    await expect(
      guestPage.getByRole("heading", { name: "You're in as a guest" }),
    ).toBeVisible();
    await guestPage.getByRole("button", { name: "See the group" }).click();

    // The checklist marks the unclaimed account urgent, and only that row.
    await expect(guestPage.getByText("Claim your account")).toBeVisible();
    await guestPage.getByRole("button", { name: "Go to the group" }).click();
    await expect(guestPage).toHaveURL(new RegExp(`/groups/${groupId}$`));

    await ownerContext.close();
    await guestContext.close();
  });
});
