import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createRecoveryKey, encryptTo } from "./age";
import { openBackup, RestoreError } from "./restore";

/**
 * The day it matters: a laptop, a file from the cloud and a recovery key.
 *
 * Files are made here exactly as the worker makes them (JSON, gzip, age) and
 * opened by the code the restore screen runs. The last test is the one that
 * justifies choosing age: the same file opened by the independent `age`
 * command, with no Balancia anywhere.
 */

const group = (name: string, expenses = 2) => ({
  balancia: { exportVersion: 1, exportedAt: "2026-10-09T03:30:00.000Z" },
  group: { id: `id-${name}`, name, currencyMode: "separate" },
  participants: [{ id: "p1" }, { id: "p2" }],
  expenses: Array.from({ length: expenses }, (_, i) => ({ id: `e${i}` })),
  settlements: [{ id: "s1" }],
});

async function backup(
  recipient: string,
  groups: unknown[],
  version = 1,
): Promise<Uint8Array> {
  const bundle = {
    balancia: {
      backupVersion: version,
      createdAt: "2026-10-09T03:30:00.000Z",
      instance: "balancia.example.com",
    },
    groups,
  };
  return encryptTo(
    recipient,
    gzipSync(Buffer.from(JSON.stringify(bundle), "utf8")),
  );
}

describe("openBackup", () => {
  it("lists the groups, each ready to hand to the import screen", async () => {
    const { identity, recipient } = await createRecoveryKey();
    const file = await backup(recipient, [
      group("Lisbon trip", 3),
      group("Flat"),
    ]);

    const opened = await openBackup(file, identity);

    expect(opened.createdAt).toBe("2026-10-09T03:30:00.000Z");
    expect(opened.instance).toBe("balancia.example.com");
    expect(opened.groups.map((g) => [g.name, g.expenseCount])).toEqual([
      ["Lisbon trip", 3],
      ["Flat", 2],
    ]);
    expect(opened.groups[0]?.participantCount).toBe(2);
    expect(opened.groups[0]?.settlementCount).toBe(1);
    // Exactly what Export writes, so the import screen reads it unchanged.
    expect(JSON.parse(opened.groups[0]?.json ?? "")).toEqual(
      group("Lisbon trip", 3),
    );
  });

  it("names the files so that no two collide, and none is odd", async () => {
    const { identity, recipient } = await createRecoveryKey();
    const file = await backup(recipient, [
      group("Été à Lisbonne"),
      group("Été à Lisbonne"),
      group("???"),
    ]);

    const names = (await openBackup(file, identity)).groups.map(
      (g) => g.fileName,
    );

    expect(names).toEqual([
      "balancia-ete-a-lisbonne.json",
      "balancia-ete-a-lisbonne-2.json",
      "balancia-group.json",
    ]);
  });

  it("opens a backup with no groups, which is a legitimate one", async () => {
    const { identity, recipient } = await createRecoveryKey();

    expect(
      (await openBackup(await backup(recipient, []), identity)).groups,
    ).toEqual([]);
  });

  it("says the key is wrong when it is", async () => {
    const owner = await createRecoveryKey();
    const other = await createRecoveryKey();
    const file = await backup(owner.recipient, [group("Flat")]);

    await expect(openBackup(file, other.identity)).rejects.toMatchObject({
      reason: "wrong-key",
    });
  });

  it("says the key is wrong for text that is not a key at all", async () => {
    const owner = await createRecoveryKey();
    const file = await backup(owner.recipient, [group("Flat")]);

    await expect(openBackup(file, "not a key")).rejects.toMatchObject({
      reason: "wrong-key",
    });
  });

  it("says the key is wrong, not the file, for a key mistyped or cut short", async () => {
    // The library's own message for a bad checksum reads like one for a damaged
    // file, and a typo is by far the commonest way to meet it.
    const owner = await createRecoveryKey();
    const file = await backup(owner.recipient, [group("Flat")]);
    const mistyped =
      owner.identity.slice(0, -1) + (owner.identity.endsWith("Q") ? "P" : "Q");

    await expect(openBackup(file, mistyped)).rejects.toMatchObject({
      reason: "wrong-key",
    });
    await expect(
      openBackup(file, owner.identity.slice(0, 40)),
    ).rejects.toMatchObject({ reason: "wrong-key" });
    await expect(openBackup(file, "")).rejects.toMatchObject({
      reason: "wrong-key",
    });
  });

  it("says the file is unreadable when it is not an age file", async () => {
    const { identity } = await createRecoveryKey();

    await expect(
      openBackup(
        new TextEncoder().encode("hello, this is not encrypted"),
        identity,
      ),
    ).rejects.toMatchObject({ reason: "unreadable" });
  });

  it("says so when a decryptable file is not a Balancia backup", async () => {
    const { identity, recipient } = await createRecoveryKey();

    await expect(
      openBackup(
        await encryptTo(recipient, new TextEncoder().encode("plain text")),
        identity,
      ),
    ).rejects.toMatchObject({ reason: "not-a-backup" });
    await expect(
      openBackup(
        await encryptTo(recipient, gzipSync(Buffer.from('{"hello":1}'))),
        identity,
      ),
    ).rejects.toMatchObject({ reason: "not-a-backup" });
  });

  it("asks for a newer Balancia rather than guessing at a newer format", async () => {
    const { identity, recipient } = await createRecoveryKey();
    const file = await backup(recipient, [group("Flat")], 2);

    await expect(openBackup(file, identity)).rejects.toMatchObject({
      reason: "too-new",
    });
  });

  it("is a RestoreError, so a screen can tell it from a bug", async () => {
    const { identity } = await createRecoveryKey();

    await expect(
      openBackup(new Uint8Array([1, 2, 3]), identity),
    ).rejects.toBeInstanceOf(RestoreError);
  });
});

const HAVE_AGE = spawnSync("age", ["--version"]).status === 0;

describe.skipIf(!HAVE_AGE)("the way out that does not need Balancia", () => {
  it("is opened by the age command and gunzip alone", async () => {
    const { identity, recipient } = await createRecoveryKey();
    const file = await backup(recipient, [group("Lisbon trip")]);

    const dir = await mkdtemp(join(tmpdir(), "balancia-age-"));
    try {
      await writeFile(join(dir, "key.txt"), `${identity}\n`, { mode: 0o600 });
      await writeFile(join(dir, "backup.json.gz.age"), file);

      const result = spawnSync(
        "age",
        [
          "--decrypt",
          "--identity",
          join(dir, "key.txt"),
          join(dir, "backup.json.gz.age"),
        ],
        { encoding: "buffer" },
      );

      expect(result.status).toBe(0);
      const json = JSON.parse(gunzipSync(result.stdout).toString("utf8")) as {
        groups: { group: { name: string } }[];
      };
      expect(json.groups[0]?.group.name).toBe("Lisbon trip");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("encrypts to a recipient made by the age command, not only ours", async () => {
    const dir = await mkdtemp(join(tmpdir(), "balancia-age-"));
    try {
      const keygen = spawnSync("age-keygen", { encoding: "utf8" });
      const identity = /AGE-SECRET-KEY-[A-Z0-9]+/.exec(
        keygen.stdout + keygen.stderr,
      )?.[0];
      const recipient = /age1[a-z0-9]+/.exec(
        keygen.stderr + keygen.stdout,
      )?.[0];
      expect(identity).toBeDefined();
      expect(recipient).toBeDefined();

      const file = await backup(recipient ?? "", [group("Flat")]);

      expect((await openBackup(file, identity ?? "")).groups[0]?.name).toBe(
        "Flat",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
