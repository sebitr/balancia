import { describe, expect, it } from "vitest";
import { drawsOwnAttribution } from "./send";

/**
 * Which browsers name the app for us.
 *
 * Safari prints the manifest's `short_name` under every push title and offers
 * no way to turn it off, so a title that names the app there names it twice.
 * The only thing a sender has to tell them apart by is the endpoint the
 * browser handed over when it subscribed.
 */
describe("recognising a browser that attributes a push itself", () => {
  it("knows Safari by its push service", () => {
    expect(
      drawsOwnAttribution("https://web.push.apple.com/QDcbQwertyAbc123"),
    ).toBe(true);
  });

  it("does not expect a name from Chrome, Edge or Firefox", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc123:APA91b",
      "https://android.googleapis.com/gcm/send/abc123",
      "https://updates.push.services.mozilla.com/wpush/v2/abc123",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      expect(drawsOwnAttribution(endpoint), endpoint).toBe(false);
    }
  });

  /**
   * The check reads a parsed hostname, not the string, so a host that merely
   * contains Apple's is not mistaken for it.
   */
  it("is not fooled by a host that only looks like Apple's", () => {
    for (const endpoint of [
      "https://web.push.apple.com.example.com/abc",
      "https://notweb.push.apple.com.attacker.test/abc",
      "https://example.com/?x=web.push.apple.com",
    ]) {
      expect(drawsOwnAttribution(endpoint), endpoint).toBe(false);
    }
  });

  /** A subdomain Apple has not used yet is still Apple's. */
  it("accepts another host under Apple's push domain", () => {
    expect(drawsOwnAttribution("https://web2.push.apple.com/abc")).toBe(true);
  });

  /**
   * An unparseable endpoint cannot be pushed to at all, but guessing "names
   * itself" would be the guess that leaves a card unattributed if it could.
   */
  it("assumes nothing is named when the endpoint will not parse", () => {
    expect(drawsOwnAttribution("not a url")).toBe(false);
    expect(drawsOwnAttribution("")).toBe(false);
  });
});
