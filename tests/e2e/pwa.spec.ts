import { expect, test } from "@playwright/test";

/**
 * PWA installability: the manifest, its icons, and the offline shell.
 */
test("serves a valid, installable web app manifest", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("manifest+json");

  const manifest = (await response.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };

  // The minimum an installable PWA needs.
  expect(manifest.name).toContain("Balancia");
  expect(manifest.short_name).toBe("Balancia");
  expect(manifest.start_url).toBeTruthy();
  expect(manifest.display).toBe("standalone");
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);

  // 192 and 512 are what browsers require for the install prompt, plus a
  // maskable icon so Android does not letterbox it.
  const sizes = manifest.icons.map((icon) => icon.sizes);
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");
  expect(
    manifest.icons.some((icon) => icon.purpose?.includes("maskable")),
  ).toBe(true);
});

test("every manifest icon actually resolves", async ({ request }) => {
  const manifest = (await (
    await request.get("/manifest.webmanifest")
  ).json()) as {
    icons: { src: string; type: string }[];
  };

  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.status(), `${icon.src} should exist`).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/");
  }
});

test("links the manifest from the document head", async ({ page }) => {
  await page.goto("/");
  const manifestHref = await page
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  expect(manifestHref).toBe("/manifest.webmanifest");

  const themeColor = await page
    .locator('meta[name="theme-color"]')
    .first()
    .getAttribute("content");
  expect(themeColor).toBeTruthy();
});

test("registers a service worker and serves it from the root scope", async ({
  page,
  request,
}) => {
  const response = await request.get("/sw.js");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("javascript");

  await page.goto("/");
  const registered = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration("/");
    return registration !== undefined;
  });
  expect(registered).toBe(true);
});

test("the service worker never caches authentication endpoints", async ({
  request,
}) => {
  const source = await (await request.get("/sw.js")).text();
  // The NetworkOnly rule for /api/auth must survive the build.
  expect(source).toContain("/api/auth");
});

test("shows an offline shell that explains the limitation", async ({
  page,
}) => {
  await page.goto("/offline");
  await expect(
    page.getByRole("heading", { name: "You are offline" }),
  ).toBeVisible();
  // The page must be honest that offline entry is not supported.
  await expect(
    page.getByText(/does not store expenses on your device/),
  ).toBeVisible();
});
