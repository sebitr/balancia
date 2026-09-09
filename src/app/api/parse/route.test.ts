// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The endpoint around the parser, which is where the mouths other than the
 * microphone come in.
 *
 * What is worth pinning here is not the parsing — `heard-entry.test.ts` holds
 * a hundred sentences for that, and repeating any of them would only mean two
 * places to edit when the parser learns something. It is the wrapper: that
 * the answer is exactly the parser's own three fields, that a caller with no
 * session gets nothing, that unreadable words are a 200 rather than a refusal,
 * and that the fallback currency is honoured rather than assumed.
 */

const actor = vi.hoisted(() => ({ value: { userId: "u1" } as unknown }));
const limit = vi.hoisted(() => ({
  value: { allowed: true, retryAfterSeconds: 0 },
}));

vi.mock("@/lib/security/actor", () => ({
  getCurrentActor: async () => actor.value,
  getClientIp: async () => "203.0.113.1",
}));

vi.mock("@/lib/security/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/rate-limit")>()),
  consumeRateLimit: async () => limit.value,
}));

const { POST } = await import("./route");

function post(body: unknown): Request {
  return new Request("http://localhost/api/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function parse(body: unknown) {
  const response = await POST(post(body));
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  actor.value = { userId: "u1" };
  limit.value = { allowed: true, retryAfterSeconds: 0 };
});

describe("POST /api/parse", () => {
  it("answers with the three fields the form needs", async () => {
    const { status, body } = await parse({ text: "add 24 francs Coop" });

    expect(status).toBe(200);
    expect(body).toEqual({
      amountText: "24",
      currency: "CHF",
      description: "Coop",
    });
  });

  /*
   * The mouths this endpoint exists for. None of them is a microphone, and
   * each is a shape the dictate button would never have produced on its own:
   * a bank writes the sign closed up in front, a chat line counts things
   * first, and a receipt photographed by Live Text arrives in capitals with
   * the total last.
   */
  it.each([
    ["a bank's text", "CHF 42.50 debited at MIGROS", "42.50", "CHF"],
    ["a line from a chat", "2 coffees 8 francs", "8", "CHF"],
    ["a pasted receipt total", "COOP PRONTO TOTAL 24.90", "24.90", ""],
    ["a shared price", "$24 lunch", "24", "USD"],
  ])("reads %s", async (_mouth, text, amountText, currency) => {
    const { body } = await parse({ text });
    expect(body.amountText).toBe(amountText);
    expect(body.currency).toBe(currency);
  });

  /*
   * The parser's middle rule, which is the one that needs a parameter to
   * survive being put behind HTTP: a sentence with no currency in it does not
   * mean "no currency", it means the group's — and only the caller knows
   * which that is.
   */
  it("leaves the caller's currency in place when the words name none", async () => {
    const { body } = await parse({ text: "coffee 5", fallbackCurrency: "SEK" });
    expect(body.currency).toBe("SEK");
  });

  it("lets the words overrule the caller's currency", async () => {
    const { body } = await parse({
      text: "coffee 5 euros",
      fallbackCurrency: "SEK",
    });
    expect(body.currency).toBe("EUR");
  });

  it("says nothing about the currency when the caller named none either", async () => {
    const { body } = await parse({ text: "coffee 5" });
    expect(body.currency).toBe("");
  });

  /*
   * The parser's graceful failure, carried across intact. Words that hold no
   * amount are the description with the amount left empty — a caller that
   * read this as a refusal would throw away the half that worked.
   */
  it("keeps the words when there is no amount in them", async () => {
    const { status, body } = await parse({ text: "dinner with Marie" });

    expect(status).toBe(200);
    expect(body).toEqual({
      amountText: "",
      currency: "",
      description: "dinner with Marie",
    });
  });

  it("treats empty text as nothing to say rather than as a mistake", async () => {
    const { status, body } = await parse({ text: "   " });

    expect(status).toBe(200);
    expect(body).toEqual({ amountText: "", currency: "", description: "" });
  });

  it("turns nobody away from a parse it could not make sense of", async () => {
    const { status } = await parse({ text: "🐟🐟🐟" });
    expect(status).toBe(200);
  });

  describe("what it refuses", () => {
    it("asks a caller with no session to sign in", async () => {
      actor.value = null;
      const { status, body } = await parse({ text: "24 francs Coop" });

      expect(status).toBe(401);
      expect(body.error).toBe("Sign in to continue.");
    });

    it("refuses a currency this instance does not account in", async () => {
      const { status } = await parse({
        text: "coffee 5",
        fallbackCurrency: "XYZ",
      });
      expect(status).toBe(422);
    });

    it("refuses more text than one entry could be", async () => {
      const { status } = await parse({ text: "a".repeat(2001) });
      expect(status).toBe(422);
    });

    it("refuses a body with no text in it at all", async () => {
      expect((await parse({})).status).toBe(422);
      expect((await POST(post("not json"))).status).toBe(422);
    });

    /*
     * A shortcut told to wait can only obey a number, so the header matters
     * as much as the status.
     */
    it("says how long to wait when it is being asked too often", async () => {
      limit.value = { allowed: false, retryAfterSeconds: 90 };
      const response = await POST(post({ text: "24 francs Coop" }));

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("90");
    });
  });

  /*
   * A parse is one person's spending read out of one person's text. It is not
   * anyone else's to serve from a cache, however cheap it is to recompute.
   */
  it("lets no shared cache keep the answer", async () => {
    const response = await POST(post({ text: "24 francs Coop" }));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
