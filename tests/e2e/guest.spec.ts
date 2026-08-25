import { expect, test } from "@playwright/test";
import {
  addParticipant,
  attachVirtualAuthenticator,
  createGroup,
  createInviteLink,
  expectToast,
  registerAndSignIn,
  uniqueEmail,
} from "./helpers";

/**
 * Guest participation through a secure link — including the property that the
 * token disappears from the URL after redemption.
 */
test("invite a guest and participate through the secure link", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();

  await registerAndSignIn(ownerPage);
  const groupId = await createGroup(ownerPage, { name: "Guest group" });
  await addParticipant(ownerPage, groupId, "Grace");

  // Create the invitation link.
  const inviteUrl = await createInviteLink(ownerPage, groupId, "Grace");

  // The warning about what the link grants must be shown.
  await expect(ownerPage.getByText(/Copy this link now/)).toBeVisible();
  await expect(ownerPage.getByText(/can act as/)).toBeVisible();

  // Redeem it in a fresh browser context — a different person entirely.
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto(inviteUrl);

  // The token must not survive the redirect. It lands on the invite screen,
  // which reads the session from its cookie rather than from the URL.
  await expect(guestPage).toHaveURL(/\/invite$/);
  expect(guestPage.url()).not.toContain("/join/");
  const token = inviteUrl.split("/join/")[1];
  expect(guestPage.url()).not.toContain(token);

  // That screen introduces the group before asking for anything.
  await expect(
    guestPage.getByRole("heading", { name: "Guest group" }),
  ).toBeVisible();

  /*
   * The guest route, which is four taps and asks for one thing.
   *
   * Every screen between here and the group is deliberate: a name to be known
   * by, the balance that name arrives at, and the list of what is left to set
   * up. None of them asks for an address, which is the whole point of the
   * guest option.
   */
  await guestPage.getByRole("button", { name: /Continue as a guest/ }).click();
  await guestPage.getByRole("button", { name: "Join as a guest" }).click();
  await guestPage.getByRole("button", { name: "See the group" }).click();
  await expect(
    guestPage.getByText("Guest access lives in this browser only"),
  ).toBeVisible();
  await guestPage.getByRole("button", { name: "Go to the group" }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/groups/${groupId}$`));

  // The guest sees the group and is labelled as a guest. Both are addressed
  // precisely: the guest widget below names the group again, and says "guest".
  await expect(
    guestPage.getByRole("heading", { name: "Guest group" }),
  ).toBeVisible();
  await expect(guestPage.getByText("Guest", { exact: true })).toBeVisible();

  // A guest can add an expense.
  await guestPage.goto(`/groups/${groupId}/expenses/new`);
  await guestPage.getByLabel("Description").fill("Guest lunch");
  await guestPage.getByLabel("Amount").fill("24.00");
  await guestPage.getByRole("button", { name: "Add expense" }).click();
  // The composer closes and confirms in a toast over the group.
  await expectToast(guestPage, "Expense added");
  await guestPage.goto(`/groups/${groupId}/expenses`);
  await expect(guestPage.getByText("Guest lunch")).toBeVisible();

  // The owner sees it too.
  await ownerPage.goto(`/groups/${groupId}/expenses`);
  await expect(ownerPage.getByText("Guest lunch")).toBeVisible();

  await ownerContext.close();
  await guestContext.close();
});

test("a guest cannot reach another group or the dashboard", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();

  await registerAndSignIn(ownerPage);
  const invitedGroup = await createGroup(ownerPage, { name: "Invited group" });
  const privateGroup = await createGroup(ownerPage, { name: "Private group" });
  await addParticipant(ownerPage, invitedGroup, "Grace");

  const inviteUrl = await createInviteLink(ownerPage, invitedGroup, "Grace");

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto(inviteUrl);
  await expect(guestPage).toHaveURL(/\/invite$/);
  await guestPage.goto(`/groups/${invitedGroup}`);

  // The other group must be indistinguishable from one that does not exist.
  const response = await guestPage.goto(`/groups/${privateGroup}`);
  expect(response?.status()).toBe(404);

  // And the dashboard belongs to accounts, not guests.
  await guestPage.goto("/dashboard");
  await expect(guestPage).toHaveURL(/\/sign-in/);

  await ownerContext.close();
  await guestContext.close();
});

test("revoking a link ends the guest's access immediately", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();

  await registerAndSignIn(ownerPage);
  const groupId = await createGroup(ownerPage, { name: "Revocation" });
  await addParticipant(ownerPage, groupId, "Grace");

  const inviteUrl = await createInviteLink(ownerPage, groupId, "Grace");

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto(inviteUrl);
  await expect(guestPage).toHaveURL(/\/invite$/);
  await guestPage.goto(`/groups/${groupId}`);

  // Owner revokes. Dismissing the one-time reveal returns the row to the live
  // link and its two actions; revoking needs no confirmation of its own,
  // because issuing a fresh link is all it takes to undo.
  await ownerPage.getByRole("button", { name: "I’ve copied it" }).click();
  // Exactly "Revoke": the group's own invite card sits further down the same
  // page with a "Revoke link" of its own, and this is the person's.
  await ownerPage.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(
    ownerPage.getByRole("button", { name: "Create invite link" }),
  ).toBeVisible();

  // The guest's session is dead. They are no longer authenticated at all, so
  // the group redirects them to sign in rather than 404ing — a revoked guest
  // is an anonymous visitor, not an authorised one looking at the wrong group.
  await guestPage.goto(`/groups/${groupId}`);
  await expect(guestPage).toHaveURL(/\/sign-in/);

  // And the old link no longer redeems.
  await guestPage.goto(inviteUrl);
  await expect(guestPage).toHaveURL(/\/join\/error/);

  await ownerContext.close();
  await guestContext.close();
});

test("a guest keeps their group and expenses by creating an account", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();

  await registerAndSignIn(ownerPage);
  const groupId = await createGroup(ownerPage, { name: "Conversion" });
  await addParticipant(ownerPage, groupId, "Grace");
  const inviteUrl = await createInviteLink(ownerPage, groupId, "Grace");

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  // The account is created with a passkey, so this browser needs something to
  // create one with.
  await attachVirtualAuthenticator(guestPage);

  await guestPage.goto(inviteUrl);
  await guestPage.getByRole("button", { name: /Continue as a guest/ }).click();
  await guestPage.getByRole("button", { name: "Join as a guest" }).click();
  await guestPage.getByRole("button", { name: "See the group" }).click();
  await guestPage.getByRole("button", { name: "Go to the group" }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/groups/${groupId}$`));

  // Something worth not losing.
  await guestPage.goto(`/groups/${groupId}/expenses/new`);
  await guestPage.getByLabel("Description").fill("Groceries and firewood");
  await guestPage.getByLabel("Amount").fill("40.00");
  await guestPage.getByRole("button", { name: "Add expense" }).click();
  await expectToast(guestPage, "Expense added");

  // The overview says what is at stake, and offers the way out of it.
  await guestPage.goto(`/groups/${groupId}`);
  const widget = guestPage.getByRole("status");
  await expect(widget).toContainText("You are in Conversion as a guest");
  await expect(widget).toContainText("the expense you added");
  await widget.getByRole("link", { name: "Create your account" }).click();
  await expect(guestPage).toHaveURL(/\/register$/);

  /*
   * Not a cold arrival, whatever the URL says.
   *
   * There is a group behind this person, so they are shown it — and they are
   * not offered the guest option, which is what they already have.
   */
  await expect(guestPage.getByText("Conversion").first()).toBeVisible();
  await expect(
    guestPage.getByRole("button", { name: /Continue as a guest/ }),
  ).toBeHidden();

  await guestPage.getByRole("button", { name: "Create an account" }).click();
  await guestPage
    .getByPlaceholder("you@example.com")
    .fill(uniqueEmail("guest"));
  await guestPage
    .getByRole("button", { name: /Continue with a passkey/ })
    .click();

  // The name the group knows them by is already in the field; this screen is
  // naming an account that now exists rather than asking for one.
  await expect(
    guestPage.getByRole("textbox", { name: "Your name" }),
  ).toHaveValue("Grace");
  await guestPage.getByRole("button", { name: "Continue" }).click();

  // The group came across with the account, and so did the expense filed
  // under the guest's name. The badge that said "Guest" is gone.
  await expect(
    guestPage.getByRole("heading", { name: /You're in, Grace/ }),
  ).toBeVisible();
  await guestPage.getByRole("button", { name: "See the group" }).click();
  await expect(guestPage.getByText("Account created")).toBeVisible();
  await expect(guestPage.getByText("Claim your account")).toBeHidden();

  await guestPage.getByRole("button", { name: "Go to the group" }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/groups/${groupId}$`));
  await guestPage.goto(`/groups/${groupId}/expenses`);
  await expect(guestPage.getByText("Groceries and firewood")).toBeVisible();

  await ownerContext.close();
  await guestContext.close();
});
