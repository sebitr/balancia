import { expect, test } from "@playwright/test";
import {
  addParticipant,
  createGroup,
  createInviteLink,
  registerAndSignIn,
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

  // The token must not survive the redirect.
  await expect(guestPage).toHaveURL(new RegExp(`/groups/${groupId}$`));
  expect(guestPage.url()).not.toContain("/join/");
  const token = inviteUrl.split("/join/")[1];
  expect(guestPage.url()).not.toContain(token);

  // The guest sees the group and is labelled as a guest.
  await expect(guestPage.getByText("Guest group")).toBeVisible();
  await expect(guestPage.getByText("Guest").first()).toBeVisible();

  // A guest can add an expense.
  await guestPage.goto(`/groups/${groupId}/expenses/new`);
  await guestPage.getByLabel("Description").fill("Guest lunch");
  await guestPage.getByLabel("Amount").fill("24.00");
  await guestPage.getByRole("button", { name: "Add expense" }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/groups/${groupId}/expenses$`));
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
  await expect(guestPage).toHaveURL(new RegExp(`/groups/${invitedGroup}$`));

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
  await expect(guestPage).toHaveURL(new RegExp(`/groups/${groupId}$`));

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
