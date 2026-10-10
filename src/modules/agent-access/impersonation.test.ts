import { describe, expect, it } from "vitest";
import { impersonation } from "./impersonation";

describe("an application that names an assistant it is not", () => {
  it("is caught when the answer is bound for somebody else's address", () => {
    expect(
      impersonation("Claude", "https://evil.example/api/mcp/auth_callback"),
    ).toEqual({ claims: "Claude", host: "evil.example" });
    expect(impersonation("ChatGPT", "https://chat-gpt.example/cb")).toEqual({
      claims: "ChatGPT",
      host: "chat-gpt.example",
    });
  });

  it("is caught however the name is spelled", () => {
    for (const name of [
      "CLAUDE",
      "C l a u d e",
      "Cláude",
      "Claude (official)",
      "claude.ai connector",
      "Anthropic Claude",
      "ＣＬＡＵＤＥ",
    ]) {
      expect(
        impersonation(name, "https://evil.example/cb"),
        name,
      ).not.toBeNull();
    }
    expect(impersonation("OpenAI", "https://evil.example/cb")?.claims).toBe(
      "ChatGPT",
    );
  });

  it("is caught when the vendor's name is only the start of the host", () => {
    // `endsWith("claude.ai")` alone would let this through.
    expect(impersonation("Claude", "https://evilclaude.ai/cb")).not.toBeNull();
    expect(
      impersonation("Claude", "https://claude.ai.evil.example/cb"),
    ).not.toBeNull();
  });
});

describe("an application that is who it says", () => {
  it("is left alone on the vendor's own addresses", () => {
    expect(
      impersonation("Claude", "https://claude.ai/api/mcp/auth_callback"),
    ).toBeNull();
    expect(impersonation("Claude", "https://claude.com/cb")).toBeNull();
    expect(impersonation("Claude", "https://app.claude.ai/cb")).toBeNull();
    expect(
      impersonation(
        "ChatGPT",
        "https://chatgpt.com/connector_platform_oauth_redirect",
      ),
    ).toBeNull();
  });

  it("is left alone when it does not name an assistant at all", () => {
    expect(
      impersonation("My budgeting bot", "https://bot.example/cb"),
    ).toBeNull();
    expect(
      impersonation("Unnamed application", "https://x.example/cb"),
    ).toBeNull();
  });

  it("is left alone when it comes back to the person's own device", () => {
    // A name proves nothing on these, and there is no vendor address to compare.
    expect(
      impersonation("Claude Code", "http://localhost:8765/callback"),
    ).toBeNull();
    expect(impersonation("Claude", "http://127.0.0.1:1234/cb")).toBeNull();
    expect(
      impersonation("Cursor Claude", "cursor://anysphere/callback"),
    ).toBeNull();
  });

  it("does not trip on an address that is not one", () => {
    expect(impersonation("Claude", "not a url")).toBeNull();
  });
});
