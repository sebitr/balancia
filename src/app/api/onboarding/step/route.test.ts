// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getRegistry } from "@/lib/metrics/registry";
import { POST } from "./route";

/**
 * The funnel counter, and the one thing it must never do: take a label from
 * the browser. Both values are closed lists, so a request naming anything
 * else is dropped rather than counted under a new series — and answered the
 * same, so the list cannot be probed.
 */
function post(body: unknown): Request {
  return new Request("http://localhost/api/onboarding/step", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/onboarding/step", () => {
  it("counts a screen under its arrival and step", async () => {
    await POST(post({ arrival: "shared", step: "whichOne" }));
    const response = await POST(post({ arrival: "shared", step: "whichOne" }));

    expect(response.status).toBe(204);
    expect(getRegistry().render()).toContain(
      'balancia_onboarding_steps_total{arrival="shared",step="whichOne"} 2',
    );
  });

  it("refuses to open a series for a value that is not on the list", async () => {
    await POST(post({ arrival: "cold", step: "/groups/abc" }));
    await POST(post({ arrival: "1.2.3.4", step: "welcome" }));
    await POST(post("not json"));

    const rendered = getRegistry().render();
    expect(rendered).not.toContain("/groups/abc");
    expect(rendered).not.toContain("1.2.3.4");
  });

  it("answers a bad request exactly like a good one", async () => {
    const good = await POST(post({ arrival: "cold", step: "welcome" }));
    const bad = await POST(post({ arrival: "cold", step: "nope" }));
    expect(bad.status).toBe(good.status);
  });
});
