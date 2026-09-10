// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * The share target's declaration, which nothing else can check.
 *
 * A manifest is read by the operating system's installer and by nobody else:
 * there is no runtime that would throw, no type that would fail to compile,
 * and a `share_target` with the wrong method or a misspelled field name simply
 * does not appear in the share sheet. The failure is silent and it is on a
 * device, so it is asserted here instead.
 *
 * Three things carry the feature, and each of them is load-bearing in a way a
 * reader of the JSON would not guess:
 *
 *  - `method: POST` with `multipart/form-data`. A GET share target can carry
 *    text and nothing else, and this one exists for photographs of receipts.
 *  - `action: /share` — the same path `src/app/sw.ts` intercepts. If the two
 *    ever disagree the POST reaches Next, which answers 405 for a GET screen.
 *  - the `media` field name, which the worker reads back out of the form.
 */

async function manifest(): Promise<Record<string, unknown>> {
  return (await GET().json()) as Record<string, unknown>;
}

describe("the web app manifest", () => {
  it("offers Balancia in another app's share sheet", async () => {
    const shareTarget = (await manifest()).share_target;

    expect(shareTarget).toEqual({
      action: "/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "media", accept: ["image/*", "application/pdf"] }],
      },
    });
  });

  it("accepts what a receipt is, and not the whole device", async () => {
    // Accepting everything would put Balancia in the share sheet of every text
    // file and video, which is how an app gets turned off there for good.
    const { params } = (await manifest()).share_target as {
      params: { files: { accept: string[] }[] };
    };

    expect(params.files[0]!.accept).not.toContain("*/*");
    expect(params.files[0]!.accept).not.toContain("text/*");
  });

  it("is still served as a manifest", async () => {
    // The content type is why this is a route rather than a static file.
    expect(GET().headers.get("Content-Type")).toBe("application/manifest+json");
  });
});
