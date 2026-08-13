import path from "node:path";
import { expect, test } from "@playwright/test";
import { createGroup, registerAndSignIn } from "./helpers";

/**
 * Splitwise CSV import through the wizard, including the retry that must not
 * duplicate anything.
 */
const FIXTURE = path.join(
  process.cwd(),
  "tests/fixtures/splitwise/trip-group.csv",
);

test("imports a Splitwise CSV with a preview step", async ({ page }) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Imported trip" });

  await page.goto(`/groups/${groupId}/import`);
  await page.getByLabel("Splitwise export").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Read the file" }).click();

  // Preview: counts and the people found in the file.
  await expect(page.getByText("4 expenses")).toBeVisible();
  await expect(page.getByText("1 payments")).toBeVisible();
  await expect(page.getByText("EUR").first()).toBeVisible();
  for (const name of ["Ada", "Blaise", "Grace"]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }

  // Nothing has been written yet — the preview is a preview.
  const expensesBefore = await page.request.get(`/groups/${groupId}/expenses`);
  expect(expensesBefore.ok()).toBe(true);

  await page.getByRole("button", { name: /Import 5 rows/ }).click();

  await expect(page.getByText("Import complete")).toBeVisible();
  // Exact match: the "previous imports" list below also mentions "imported".
  await expect(page.getByText("5 imported", { exact: true })).toBeVisible();

  // The expenses are really there.
  await page.goto(`/groups/${groupId}/expenses`);
  await expect(page.getByText("Groceries")).toBeVisible();
  await expect(page.getByText("Museum tickets")).toBeVisible();
});

test("re-importing the same file adds nothing", async ({ page }) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Retry import" });

  // First import.
  await page.goto(`/groups/${groupId}/import`);
  await page.getByLabel("Splitwise export").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Read the file" }).click();
  await page.getByRole("button", { name: /Import 5 rows/ }).click();
  await expect(page.getByText("Import complete")).toBeVisible();

  await page.goto(`/groups/${groupId}/expenses`);
  const firstCount = await page.locator("li").count();

  // Second import of the identical file.
  await page.goto(`/groups/${groupId}/import`);
  await page.getByLabel("Splitwise export").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Read the file" }).click();

  // The preview tells the user everything is already here.
  await expect(page.getByText("5 already imported")).toBeVisible();
  await page.getByRole("button", { name: /Import 0 rows/ }).click();
  await expect(page.getByText("Import complete")).toBeVisible();
  await expect(page.getByText(/5.*skipped as already present/)).toBeVisible();

  await page.goto(`/groups/${groupId}/expenses`);
  expect(await page.locator("li").count()).toBe(firstCount);
});

test("refuses a file that is not a Splitwise export", async ({
  page,
}, testInfo) => {
  await registerAndSignIn(page);
  const groupId = await createGroup(page, { name: "Bad import" });

  const badFile = testInfo.outputPath("not-splitwise.csv");
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(badFile, "name,total\nAda,10\n"),
  );

  await page.goto(`/groups/${groupId}/import`);
  await page.getByLabel("Splitwise export").setInputFiles(badFile);
  await page.getByRole("button", { name: "Read the file" }).click();

  await expect(
    page.getByText(/not recognised as a Splitwise export/),
  ).toBeVisible();
});
