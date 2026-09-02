// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getRegistry } from "@/lib/metrics/registry";
import { recordOnboardingStepAction } from "./actions";

/**
 * The funnel counter, and the one thing it must never do: take a label from
 * the browser. Both values are closed lists, so a request naming anything
 * else is dropped rather than counted under a new series.
 */
describe("recordOnboardingStepAction", () => {
  it("counts a screen under its arrival and step", async () => {
    await recordOnboardingStepAction({ arrival: "shared", step: "whichOne" });
    await recordOnboardingStepAction({ arrival: "shared", step: "whichOne" });

    expect(getRegistry().render()).toContain(
      'balancia_onboarding_steps_total{arrival="shared",step="whichOne"} 2',
    );
  });

  it("refuses to open a series for a value that is not on the list", async () => {
    await recordOnboardingStepAction({ arrival: "cold", step: "/groups/abc" });
    await recordOnboardingStepAction({ arrival: "1.2.3.4", step: "welcome" });
    await recordOnboardingStepAction("welcome");

    const rendered = getRegistry().render();
    expect(rendered).not.toContain("/groups/abc");
    expect(rendered).not.toContain("1.2.3.4");
  });

  it("never throws, whatever it is handed", async () => {
    await expect(recordOnboardingStepAction(null)).resolves.toBeUndefined();
    await expect(
      recordOnboardingStepAction(undefined),
    ).resolves.toBeUndefined();
  });
});
