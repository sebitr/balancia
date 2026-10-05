import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sql } from "drizzle-orm";
import IntlMessageFormat from "intl-messageformat";
import en from "../../messages/en.json";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { LocalStorageDriver, setStorageDriver } from "@/lib/storage";
import type { UserActor } from "@/lib/security/authorization";
import { GROUP_STORAGE_MAX_BYTES } from "@/modules/attachments/service";
import { createTestGroup, createTestUser } from "../helpers/factories";

/**
 * The upload and export routes, through their handlers.
 *
 * What these promise lives in the handler rather than the service: the size
 * of a body that declares none, the words a refusal comes back in, and how
 * often one person may ask for a whole group's history. A test against the
 * services would pass with all three missing.
 */

const cookieActor = vi.hoisted(() => ({
  value: null as UserActor | null,
}));

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () => cookieActor.value,
  getCurrentActor: async () => cookieActor.value,
  getClientIp: async () => "203.0.113.20",
}));

/** The real catalogue, formatted the way `next-intl` would. */
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => {
    const messages = (en as unknown as Record<string, Record<string, string>>)[
      namespace
    ];
    const t = (key: string, values?: Record<string, unknown>) =>
      new IntlMessageFormat(messages[key], "en").format(values) as string;
    t.has = (key: string) => key in messages;
    return t;
  },
}));

const attachmentsRoute =
  await import("@/app/api/groups/[groupId]/attachments/route");
const exportRoute = await import("@/app/api/groups/[groupId]/export/route");

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100" +
    "05fe02fea7d4e2110000000049454e44ae426082",
  "hex",
);

let storageRoot: string;

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "balancia-routes-"));
  setStorageDriver(new LocalStorageDriver(storageRoot));
});

beforeEach(() => {
  cookieActor.value = null;
});

afterAll(async () => {
  setStorageDriver(undefined);
  await rm(storageRoot, { recursive: true, force: true });
});

function context(groupId: string) {
  return { params: Promise.resolve({ groupId }) } as never;
}

async function signedInWithGroup() {
  const owner = await createTestUser({ name: "Ada" });
  const group = await createTestGroup(owner, { name: "Lisbon" });
  cookieActor.value = owner;
  return group;
}

function uploadRequest(groupId: string, body: FormData): Request {
  return new Request(`http://localhost/api/groups/${groupId}/attachments`, {
    method: "POST",
    body,
  });
}

/**
 * A multipart body of `fileBytes` bytes, streamed with no `Content-Length`
 * — the shape a chunked upload arrives in. Generated as it is read, so the
 * test holds no more of it in memory than the route does.
 */
function chunkedUpload(groupId: string, fileBytes: number): Request {
  const boundary = "----balancia-chunked";
  const head = new TextEncoder().encode(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="huge.jpg"\r\n' +
      "Content-Type: image/jpeg\r\n\r\n",
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const piece = new Uint8Array(64 * 1024).fill(0x61);

  let sentHead = false;
  let remaining = fileBytes;
  let sentTail = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sentHead) {
        sentHead = true;
        controller.enqueue(head);
      } else if (remaining > 0) {
        const next = piece.subarray(0, Math.min(piece.length, remaining));
        remaining -= next.length;
        controller.enqueue(next);
      } else if (!sentTail) {
        sentTail = true;
        controller.enqueue(tail);
      } else {
        controller.close();
      }
    },
  });

  return new Request(`http://localhost/api/groups/${groupId}/attachments`, {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: stream,
    duplex: "half",
  } as RequestInit);
}

describe("uploading a receipt", () => {
  it("stores a file sent the ordinary way", async () => {
    const group = await signedInWithGroup();
    const form = new FormData();
    form.append("file", new Blob([PNG]), "receipt.png");

    const response = await attachmentsRoute.POST(
      uploadRequest(group.groupId, form),
      context(group.groupId),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ contentType: "image/png" });
  });

  it("answers 413 to a chunked body over the limit, with the limit in words", async () => {
    const group = await signedInWithGroup();
    const request = chunkedUpload(
      group.groupId,
      getEnv().UPLOAD_MAX_BYTES + 64 * 1024,
    );
    expect(request.headers.get("content-length")).toBeNull();

    const response = await attachmentsRoute.POST(
      request,
      context(group.groupId),
    );

    expect(response.status).toBe(413);
    const limitMb = Math.floor(getEnv().UPLOAD_MAX_BYTES / (1024 * 1024));
    expect(await response.json()).toEqual({
      error: `That file is larger than the ${limitMb} MB upload limit.`,
      code: "fileTooLarge",
    });
  });

  it("answers the same 413 when the size was declared", async () => {
    const group = await signedInWithGroup();
    const request = new Request(
      `http://localhost/api/groups/${group.groupId}/attachments`,
      {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(getEnv().UPLOAD_MAX_BYTES * 2),
        },
        body: "--x--",
      },
    );

    const response = await attachmentsRoute.POST(
      request,
      context(group.groupId),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "fileTooLarge" });
  });

  it("refuses a group with no room left, in words, and keeps nothing", async () => {
    const group = await signedInWithGroup();
    await getDb().execute(sql`
      INSERT INTO attachments (group_id, storage_key, file_name, content_type, byte_size, checksum)
      VALUES (${group.groupId}::uuid, 'receipts/filler/full', 'filler.png', 'image/png',
              ${String(GROUP_STORAGE_MAX_BYTES)}::bigint, 'x')
    `);
    const form = new FormData();
    form.append("file", new Blob([PNG]), "receipt.png");

    const response = await attachmentsRoute.POST(
      uploadRequest(group.groupId, form),
      context(group.groupId),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: en.serverErrors.groupStorageFull,
      code: "groupStorageFull",
    });
    const kept = await readdir(
      path.join(storageRoot, "receipts", group.groupId),
    ).catch(() => []);
    expect(kept).toHaveLength(0);
  });
});

describe("exporting a group", () => {
  it("answers 429 once one person has asked too often", async () => {
    const group = await signedInWithGroup();
    const ask = () =>
      exportRoute.GET(
        new Request(
          `http://localhost/api/groups/${group.groupId}/export?format=csv`,
        ),
        context(group.groupId),
      );

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await ask()).status).toBe(200);
    }

    const refused = await ask();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("keeps each group's allowance to itself", async () => {
    const group = await signedInWithGroup();
    const owner = cookieActor.value!;
    const other = await createTestGroup(owner, { name: "Flat" });
    const ask = (groupId: string) =>
      exportRoute.GET(
        new Request(`http://localhost/api/groups/${groupId}/export?format=csv`),
        context(groupId),
      );

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await ask(group.groupId);
    }
    expect((await ask(group.groupId)).status).toBe(429);
    expect((await ask(other.groupId)).status).toBe(200);
  });
});
