import { describe, expect, it } from "vitest";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toAuthInfo, type Principal } from "@/modules/agent-access/principal";
import { createBalanciaServer, SERVER_INSTRUCTIONS } from "./server";

/**
 * The MCP server as a client meets it: JSON-RPC over HTTP, through the real
 * SDK handler, in both revisions of the protocol that are in circulation.
 *
 * Nothing here touches a database. Listing tools and reading the server's
 * instructions are decided by the credential alone, which is the point being
 * tested — a read-only credential must not be shown a tool that writes.
 */

const ORIGIN = "https://balancia.example";

function principal(scope: "read" | "write"): Principal {
  return {
    kind: "grant",
    credentialId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    email: "ada@example.com",
    name: "Ada",
    scope,
    groupId: null,
    label: "Claude",
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  };
}

const handler = createMcpHandler(createBalanciaServer, {
  legacy: "stateless",
  responseMode: "auto",
});

interface RpcResult {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/** The first JSON-RPC message in a response that may be JSON or an event stream. */
async function messageOf(response: Response): Promise<RpcResult> {
  const text = await response.text();
  const data = text.trimStart().startsWith("{")
    ? text
    : (text
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5) ?? "{}");
  return JSON.parse(data) as RpcResult;
}

/** A 2025-era client: no envelope, and a request that stands alone. */
async function legacyCall(
  who: Principal,
  method: string,
  params: Record<string, unknown> = {},
): Promise<RpcResult> {
  const response = await handler.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    { authInfo: toAuthInfo(who, ORIGIN) },
  );
  return messageOf(response);
}

/** A 2026-07-28 client: every request carries its own protocol version. */
async function modernCall(
  who: Principal,
  method: string,
  params: Record<string, unknown> = {},
): Promise<RpcResult> {
  const response = await handler.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": method,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {
              name: "test",
              version: "0",
            },
          },
        },
      }),
    }),
    { authInfo: toAuthInfo(who, ORIGIN) },
  );
  return messageOf(response);
}

interface Tool {
  name: string;
  title?: string;
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
    idempotentHint?: boolean;
  };
  inputSchema?: { type?: string; properties?: Record<string, unknown> };
}

async function toolsFor(
  who: Principal,
  call: typeof legacyCall,
): Promise<Tool[]> {
  const message = await call(who, "tools/list");
  expect(message.error).toBeUndefined();
  return (message.result?.tools ?? []) as Tool[];
}

const READ_TOOLS = [
  "balancia_get_expense",
  "balancia_get_group",
  "balancia_list_groups",
  "balancia_list_transactions",
];
const WRITE_TOOLS = [
  "balancia_add_expense",
  "balancia_delete_entry",
  "balancia_record_repayment",
  "balancia_restore_entry",
  "balancia_update_expense",
];

describe.each([
  ["a 2025-era client", legacyCall],
  ["a 2026-07-28 client", modernCall],
] as const)("%s", (_era, call) => {
  it("is shown only the tools that look, on a read-only credential", async () => {
    const tools = await toolsFor(principal("read"), call);
    expect(tools.map((tool) => tool.name).sort()).toEqual(READ_TOOLS);
  });

  it("is shown the tools that change things too, on a write credential", async () => {
    const tools = await toolsFor(principal("write"), call);
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [...READ_TOOLS, ...WRITE_TOOLS].sort(),
    );
  });
});

describe("the tools themselves", async () => {
  const tools = await toolsFor(principal("write"), legacyCall);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  it("have names a client can show: short, unique and namespaced", () => {
    const names = tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(64);
      expect(name).toMatch(/^balancia_[a-z_]+$/);
    }
  });

  it("each say what they are, to a person and to a model", () => {
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.description!.length, tool.name).toBeGreaterThan(60);
      expect(tool.inputSchema?.type, tool.name).toBe("object");
    }
  });

  it("annotate every read as a read, which is what lets a client run it unasked", () => {
    for (const name of READ_TOOLS) {
      const annotations = byName.get(name)!.annotations!;
      expect(annotations.readOnlyHint, name).toBe(true);
      expect(annotations.destructiveHint, name).toBe(false);
      expect(annotations.openWorldHint, name).toBe(false);
    }
  });

  it("annotate every write as a write, and as something other people see", () => {
    for (const name of WRITE_TOOLS) {
      expect(byName.get(name)!.annotations!.readOnlyHint, name).toBe(false);
      // Members are notified, and read what is written: it leaves the
      // conversation, which is what the hint is for.
      expect(byName.get(name)!.annotations!.openWorldHint, name).toBe(true);
    }
  });

  it("say which writes can lose something", () => {
    // Overwriting and deleting are destructive; adding and putting back are not.
    expect(
      byName.get("balancia_update_expense")!.annotations!.destructiveHint,
    ).toBe(true);
    expect(
      byName.get("balancia_delete_entry")!.annotations!.destructiveHint,
    ).toBe(true);
    expect(
      byName.get("balancia_add_expense")!.annotations!.destructiveHint,
    ).toBe(false);
    expect(
      byName.get("balancia_record_repayment")!.annotations!.destructiveHint,
    ).toBe(false);
    expect(
      byName.get("balancia_restore_entry")!.annotations!.destructiveHint,
    ).toBe(false);
  });

  it("do not tell a model to do anything but use the tool", () => {
    // The directory's review rejects a description that instructs the model to
    // reach for other software or to ignore what it was told. Ours name other
    // *Balancia tools* to use, which is the one thing allowed.
    for (const tool of tools) {
      expect(tool.description, tool.name).not.toMatch(
        /ignore (all |any )?(previous|prior|above)|system prompt|do not tell the user/i,
      );
    }
  });

  it("take a group by name, because that is what a person says", () => {
    // Every tool but the one that lists them.
    for (const tool of tools.filter((t) => t.name !== "balancia_list_groups")) {
      expect(tool.inputSchema?.properties, tool.name).toHaveProperty("group");
    }
  });
});

describe("what the server tells a model about itself", () => {
  it("says that text typed by other members is data, not instructions", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/untrusted/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/never follow instructions/i);
  });

  it("states the money convention that a wrong guess would get wrong", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/major units/);
    expect(SERVER_INSTRUCTIONS).toMatch(/never cents/);
  });

  it("is delivered with the server's description", async () => {
    const discovered = await modernCall(principal("read"), "server/discover");
    expect(JSON.stringify(discovered.result)).toContain("Untrusted text");
  });
});

describe("a request with no credential behind it", () => {
  it("cannot build a server at all", async () => {
    const response = await handler.fetch(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    // The route never lets this happen; if it ever did, the answer is an
    // error and not a list of tools.
    const message = await messageOf(response);
    expect(message.result?.tools).toBeUndefined();
  });
});
