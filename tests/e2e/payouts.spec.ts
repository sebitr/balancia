import { expect, test } from "@playwright/test";
import { expectToast, registerAndSignIn } from "./helpers";

/**
 * How people pay you back, stored for real.
 *
 * The two properties worth driving a browser for: a detail that checks out
 * survives a reload, and one that does not is refused *before* it is stored —
 * because a payout detail is discovered to be wrong by the money not arriving,
 * which is far too late.
 *
 * The screen has its own route now, `/settings/payouts`, and the list is built
 * the other way round: nothing is offered until it is added, and adding opens
 * the catalogue over the page. So the walk below adds each method through the
 * sheet rather than ticking it in place.
 */

test.describe("payout methods", () => {
  /*
   * A Swiss browser, said out loud.
   *
   * Which methods the picker suggests first is regional: it reads the
   * browser's own timezone and asks `countryForTimezone` about it, and
   * anywhere the app has no opinion falls back to `DEFAULT_METHODS` — cash,
   * bank transfer, PayPal, Revolut. TWINT is suggested to Switzerland and to
   * nowhere else, so a test that reaches for it has to say where it is
   * standing.
   *
   * Left implicit, this passed on a laptop in Zurich and timed out on CI,
   * which runs in UTC and was duly offered the fallback four. The Swiss IBAN
   * and the +41 mobile below were always reading as Swiss; the timezone is
   * the part that was being borrowed from whoever ran the suite.
   */
  test.use({ timezoneId: "Europe/Zurich" });

  /**
   * Runs an action and waits for the write it starts to come back.
   *
   * Not the toast: every save on this screen raises the same one, by id, so
   * sonner replaces it in place rather than stacking. A second save's
   * `expectToast` therefore matches the *first* one, still on screen, and the
   * reload after it races the write it was supposed to be waiting for. The
   * Server Action's own POST is the only signal that means what it looks like.
   */
  async function saved(
    page: Parameters<typeof registerAndSignIn>[0],
    act: () => Promise<void>,
  ) {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && r.status() < 400,
      ),
      act(),
    ]);
    return response;
  }

  /** Opens the catalogue and takes one method out of it. */
  async function addMethod(
    page: Parameters<typeof registerAndSignIn>[0],
    name: string,
  ) {
    await page.getByRole("button", { name: "Add a method" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name, exact: true }).click();
    await expect(sheet).toBeHidden();
  }

  test("keeps a detail that checks out, and refuses one that does not", async ({
    page,
  }) => {
    await registerAndSignIn(page);
    await page.goto("/settings/payouts");

    await expect(
      page.getByRole("heading", { name: "Get paid back" }),
    ).toBeVisible();

    // A method that needs nothing typed is a complete answer on its own.
    await saved(page, () => addMethod(page, "Cash"));
    await expectToast(page, "Saved");

    // An IBAN with one character wrong passes every length check and fails the
    // checksum, which is the mistake people actually make.
    await addMethod(page, "Bank transfer");
    const iban = page.getByLabel("IBAN");
    await iban.fill("CH93 0076 2011 6238 5295 8");
    await iban.blur();
    await expect(page.getByText(/does not check out/)).toBeVisible();

    await saved(page, async () => {
      await iban.fill("CH93 0076 2011 6238 5295 7");
      await iban.blur();
    });
    await expect(page.getByText(/does not check out/)).toBeHidden();

    // Reload: what came back is what the account kept, with the spacing an
    // IBAN is read out in stripped by the server.
    await page.reload();
    await expect(page.getByText("Cash")).toBeVisible();
    await expect(page.getByLabel("IBAN")).toHaveValue("CH9300762011623852957");

    // A Swiss IBAN is the one case the QR standard needs a postal address for,
    // and the card says which of its two states it is in.
    await expect(
      page.getByRole("heading", { name: "Address for the Swiss QR-bill" }),
    ).toBeVisible();
  });

  test("refuses a phone number without its country code", async ({ page }) => {
    await registerAndSignIn(page);
    await page.goto("/settings/payouts");

    await addMethod(page, "TWINT");
    const phone = page.getByLabel("Phone number");
    await phone.fill("079 123 45 67");
    await phone.blur();
    await expect(page.getByText(/with its country code/)).toBeVisible();

    await saved(page, async () => {
      await phone.fill("+41 79 123 45 67");
      await phone.blur();
    });
    await expectToast(page, "Saved");

    await page.reload();
    // The account holds `+41791234567` — the server strips the spacing, and
    // the field puts it back, because nobody reads a number in one run.
    await expect(page.getByLabel("Phone number")).toHaveValue(
      "+41 79 123 45 67",
    );
  });

  test("puts the preferred method first, where whoever owes you reads it", async ({
    page,
  }) => {
    await registerAndSignIn(page);
    await page.goto("/settings/payouts");

    await saved(page, () => addMethod(page, "Cash"));
    await saved(page, () => addMethod(page, "Cheque"));

    // Cash was added first, so it holds the badge and cheque offers the pill.
    await saved(page, () =>
      page.getByRole("button", { name: "Make preferred" }).click(),
    );

    await page.reload();
    // Order is the preference, and the order survives the round trip.
    const rows = page.getByRole("button", { name: /^Remove / });
    await expect(rows.first()).toHaveAccessibleName("Remove Cheque");
  });
});
