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

test("links a real Balancia favicon, not the framework default", async ({
  page,
  request,
}) => {
  await page.goto("/");

  // All three matter, and to different clients: the .ico is what Safari and
  // anything fetching /favicon.ico blind will take, the SVG is what modern
  // tabs prefer, and the apple-touch-icon is what iOS puts on the home screen.
  const hrefs = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLLinkElement).getAttribute("href") ?? ""),
    );
  expect(hrefs.some((href) => href.startsWith("/favicon.ico"))).toBe(true);
  expect(hrefs.some((href) => href.startsWith("/icon.svg"))).toBe(true);
  expect(hrefs.some((href) => href.startsWith("/apple-icon.png"))).toBe(true);

  for (const href of hrefs) {
    const response = await request.get(href);
    expect(response.status(), `${href} should exist`).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/");
  }

  // The scaffold favicon shipped here unnoticed once. It is a single 48px
  // Next.js logo; ours is the Balancia mark at three tab sizes, and the
  // directory count is the cheapest way to tell them apart.
  const ico = await (await request.get("/favicon.ico")).body();
  expect(ico.readUInt16LE(0)).toBe(0); // reserved
  expect(ico.readUInt16LE(2)).toBe(1); // type: icon
  expect(ico.readUInt16LE(4)).toBe(3); // 16, 32 and 48px entries

  const svg = await (await request.get("/icon.svg")).text();
  // The plum ground and coral dot are the mark; the Next.js logo has neither.
  expect(svg).toContain("#2a0e31");
  expect(svg).toContain("#f97361");
});

test("registers a service worker and serves it from the root scope", async ({
  page,
  request,
}) => {
  const response = await request.get("/sw.js");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("javascript");

  await page.goto("/");

  // Registration is kicked off from an effect after hydration, so it is not
  // done by the time `goto` resolves. Poll rather than sample once: asserting
  // immediately tests how fast the page hydrates, not whether the worker
  // registers.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (!("serviceWorker" in navigator)) return false;
          const registration =
            await navigator.serviceWorker.getRegistration("/");
          return registration !== undefined;
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
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
