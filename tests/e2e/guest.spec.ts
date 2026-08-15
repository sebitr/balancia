import { expect, test } from "@playwright/test";
import {
  addParticipant,
  createGroup,
  createInviteLink,
  registerAndSignIn,
  TEST_PASSWORD,
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
  await guestPage.getByRole("link", { name: "Continue as guest" }).click();
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
  // The composer confirms in place rather than navigating away.
  await expect(
    guestPage.getByRole("heading", { name: "Expense added" }),
  ).toBeVisible();
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
  await ownerPage.getByRole("button", { name: "Revoke" }).click();
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
  await guestPage.goto(inviteUrl);
  await guestPage.getByRole("link", { name: "Continue as guest" }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/groups/${groupId}$`));

  // Something worth not losing.
  await guestPage.goto(`/groups/${groupId}/expenses/new`);
  await guestPage.getByLabel("Description").fill("Groceries and firewood");
  await guestPage.getByLabel("Amount").fill("40.00");
  await guestPage.getByRole("button", { name: "Add expense" }).click();
  await expect(
    guestPage.getByRole("heading", { name: "Expense added" }),
  ).toBeVisible();

  // The overview says what is at stake, and offers the way out of it.
  await guestPage.goto(`/groups/${groupId}`);
  const widget = guestPage.getByRole("status");
  await expect(widget).toContainText("You are in Conversion as a guest");
  await expect(widget).toContainText("the expense you added");
  await widget.getByRole("link", { name: "Create your account" }).click();
  await expect(guestPage).toHaveURL(/\/register$/);

  // The group already knows their name; they are not asked for it twice.
  await expect(guestPage.getByLabel("Name")).toHaveValue("Grace");
  await guestPage.getByLabel("Email").fill(uniqueEmail("guest"));
  await guestPage.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await guestPage.getByLabel("Confirm password").fill(TEST_PASSWORD);
  await guestPage.getByRole("button", { name: "Create account" }).click();

  // The confirmation lists what came across, line by line.
  await expect(guestPage).toHaveURL(/\/register\/done\?group=/);
  await expect(
    guestPage.getByRole("heading", { name: "You're set, Grace" }),
  ).toBeVisible();
  await expect(guestPage.getByText("Member since today")).toBeVisible();
  await expect(guestPage.getByText("Groceries and firewood")).toBeVisible();
  await expect(guestPage.getByText("Kept")).toBeVisible();
  await expect(
    guestPage.getByText("The old guest link no longer opens this group."),
  ).toBeVisible();

  // And the group opens as a member: no guest badge, no widget.
  await guestPage.getByRole("link", { name: "Go to Conversion" }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/groups/${groupId}$`));
  await expect(guestPage.getByRole("status")).toHaveCount(0);
  await expect(guestPage.getByText("Guest", { exact: true })).toHaveCount(0);

  // The dashboard is theirs now, and it holds the group they arrived through.
  await guestPage.goto("/dashboard");
  await expect(guestPage.getByText("Conversion").first()).toBeVisible();

  // The link that got them here is spent.
  await guestPage.goto(inviteUrl);
  await expect(guestPage).toHaveURL(/\/join\/error/);

  await ownerContext.close();
  await guestContext.close();
});
