import { expect, test } from "@playwright/test";
import { registerAndSignIn } from "./helpers";

/**
 * Instance administration, from an ordinary account.
 *
 * The interesting journey here is the one that must *not* work: telemetry
 * settings belong to whoever runs the installation, and an ordinary
 * participant — who may well own several groups — is not that person.
 *
 * The administrator's own journey is covered where it can be set up
 * deterministically: `tests/integration/telemetry.test.ts` drives the whole of
 * it, including the report the preview renders.
 */

test.describe("telemetry administration", () => {
  test("is not offered to an ordinary participant", async ({ page }) => {
    await registerAndSignIn(page);

    await page.getByRole("button", { name: "Account menu" }).click();

    await expect(
      page.getByRole("menuitem", { name: "Notifications" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Administration" }),
    ).toHaveCount(0);
  });

  test("is not reachable by typing its address", async ({ page }) => {
    await registerAndSignIn(page);

    await page.goto("/admin/telemetry");

    // The not-found screen rather than a redirect or a permission message: the
    // page answers as though it does not exist, so its existence is not
    // something a participant can probe for. (The document's HTTP status is
    // 200 because the shell has already begun streaming by the time the page
    // segment refuses — what matters is that none of it is rendered.)
    await expect(
      page.getByRole("heading", { name: "Not found" }),
    ).toBeVisible();
    await expect(
      page.getByText("Share anonymous usage statistics"),
    ).toHaveCount(0);
    await expect(page.getByRole("switch")).toHaveCount(0);
  });
});
