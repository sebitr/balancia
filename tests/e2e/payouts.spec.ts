import { expect, test } from "@playwright/test";
import { expectToast, registerAndSignIn } from "./helpers";

/**
 * How people pay you back, stored for real.
 *
 * The two properties worth driving a browser for: a detail that checks out
 * survives a reload, and one that does not is refused *before* it is stored —
 * because a payout detail is discovered to be wrong by the money not arriving,
 * which is far too late.
 */

test.describe("payout methods", () => {
  /*
   * A Swiss browser, said out loud.
   *
   * Which methods this screen offers is regional: the form reads the
   * browser's own timezone and asks `countryForTimezone` about it, and
   * anywhere the app has no opinion falls back to `DEFAULT_METHODS` — cash,
   * bank transfer, PayPal, Revolut. TWINT is offered to Switzerland and to
   * nowhere else, so a test that ticks it has to say where it is standing.
   *
   * Left implicit, this passed on a laptop in Zurich and timed out on CI,
   * which runs in UTC and was duly offered the fallback four. The Swiss IBAN
   * and the +41 mobile below were always reading as Swiss; the timezone is
   * the part that was being borrowed from whoever ran the suite.
   */
  test.use({ timezoneId: "Europe/Zurich" });

  test("keeps a detail that checks out, and refuses one that does not", async ({
    page,
  }) => {
    await registerAndSignIn(page);
    await page.goto("/settings/money");

    await expect(
      page.getByRole("heading", { name: "How people pay you back" }),
    ).toBeVisible();

    // A method that needs nothing typed is a complete answer on its own.
    await page.getByRole("checkbox", { name: "Cash" }).click();

    // An IBAN with one character wrong passes every length check and fails the
    // checksum, which is the mistake people actually make.
    await page.getByRole("checkbox", { name: /Bank transfer/ }).click();
    const iban = page.getByLabel("IBAN");
    await iban.fill("CH93 0076 2011 6238 5295 8");
    await iban.blur();
    await expect(page.getByText(/does not check out/)).toBeVisible();

    await iban.fill("CH93 0076 2011 6238 5295 7");
    await iban.blur();
    await expect(page.getByText(/does not check out/)).toBeHidden();

    // The toast is the only sign the write landed, and this screen waits for
    // its write — so the reload below has to wait for it too, or it reads the
    // page back before the row exists.
    await expectToast(page, "Saved");

    // Reload: what came back is what the account kept, with the spacing an
    // IBAN is read out in stripped by the server.
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Cash" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByLabel("IBAN")).toHaveValue("CH9300762011623852957");
  });

  test("refuses a phone number without its country code", async ({ page }) => {
    await registerAndSignIn(page);
    await page.goto("/settings/money");

    await page.getByRole("checkbox", { name: "TWINT" }).click();
    const phone = page.getByLabel("Phone number");
    await phone.fill("079 123 45 67");
    await phone.blur();
    await expect(page.getByText(/with its country code/)).toBeVisible();

    await phone.fill("+41 79 123 45 67");
    await phone.blur();
    await expectToast(page, "Saved");

    await page.reload();
    await expect(page.getByLabel("Phone number")).toHaveValue("+41791234567");
  });
});
