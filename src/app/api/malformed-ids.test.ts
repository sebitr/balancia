// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";

/**
 * A path segment that is not a UUID names nothing, and is answered 404 like
 * any other id that names nothing — before a single query.
 *
 * These six handlers used to hand the segment straight to PostgreSQL, which
 * refuses a malformed UUID with an error rather than an empty result, and
 * each of them turned that error into a 500. The mocks below fail the same
 * way the database did, so a handler that reaches them answers 500 here too:
 * the 404 can only come from the check at the top of the handler.
 */

const mocks = vi.hoisted(() => {
  const invalidUuid = () =>
    Promise.reject(new Error('invalid input syntax for type uuid: "nope"'));
  return {
    authorizeGroup: vi.fn(invalidUuid),
    deleteSubscriptionById: vi.fn(invalidUuid),
  };
});

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const entries = messages[namespace] as Record<string, string>;
    return (key: string) => entries[key] ?? key;
  },
}));
vi.mock("@/lib/security/actor", () => {
  const user = {
    kind: "user",
    userId: "3f1e5f7a-5f5e-4f6a-9b0e-1c2d3e4f5a6b",
    email: "ada@example.test",
    name: "Ada",
  };
  return {
    getCurrentUser: async () => user,
    getCurrentActor: async () => user,
    getClientIp: async () => "127.0.0.1",
  };
});
vi.mock("@/lib/security/authorization", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  authorizeGroup: mocks.authorizeGroup,
}));
vi.mock("@/modules/notifications/subscriptions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deleteSubscriptionById: mocks.deleteSubscriptionById,
}));
// Scanning answers 404 on an instance with no provider, which would pass the
// test below for the wrong reason; with one configured, the id is all that
// stands between the request and the query.
vi.mock("@/lib/ocr/providers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOcrProvider: () => ({}),
}));

const attachment =
  await import("@/app/api/groups/[groupId]/attachments/[attachmentId]/route");
const attachments =
  await import("@/app/api/groups/[groupId]/attachments/route");
const exportRoute = await import("@/app/api/groups/[groupId]/export/route");
const receiptScan =
  await import("@/app/api/groups/[groupId]/receipt-scan/route");
const transactions =
  await import("@/app/api/groups/[groupId]/transactions/route");
const subscription = await import("@/app/api/push/subscriptions/[id]/route");

const GROUP = randomUUID();

function request(method: string): Request {
  return new Request("http://localhost/api/whatever", { method });
}

function context(params: Record<string, string>) {
  return { params: Promise.resolve(params) } as never;
}

beforeEach(() => {
  mocks.authorizeGroup.mockClear();
  mocks.deleteSubscriptionById.mockClear();
});

describe("a malformed id in the path", () => {
  it.each([
    [
      "GET a receipt, by its group",
      () =>
        attachment.GET(
          request("GET"),
          context({ groupId: "nope", attachmentId: randomUUID() }),
        ),
    ],
    [
      "GET a receipt, by its own id",
      () =>
        attachment.GET(
          request("GET"),
          context({ groupId: GROUP, attachmentId: "nope" }),
        ),
    ],
    [
      "POST a receipt",
      () => attachments.POST(request("POST"), context({ groupId: "nope" })),
    ],
    [
      "GET the export",
      () => exportRoute.GET(request("GET"), context({ groupId: "nope" })),
    ],
    [
      "POST a receipt scan",
      () => receiptScan.POST(request("POST"), context({ groupId: "nope" })),
    ],
    [
      "GET a page of transactions",
      () => transactions.GET(request("GET"), context({ groupId: "nope" })),
    ],
    [
      "DELETE a push subscription",
      () => subscription.DELETE(request("DELETE"), context({ id: "nope" })),
    ],
  ])("answers 404 to %s, without a query", async (_label, call) => {
    const response = await call();

    expect(response.status).toBe(404);
    expect(mocks.authorizeGroup).not.toHaveBeenCalled();
    expect(mocks.deleteSubscriptionById).not.toHaveBeenCalled();
  });

  it("says so as a made-up id is told, on the one route that translates", async () => {
    const response = await subscription.DELETE(
      request("DELETE"),
      context({ id: "nope" }),
    );
    expect(await response.json()).toEqual({
      error: messages.serverErrors.notFound,
    });
  });
});
