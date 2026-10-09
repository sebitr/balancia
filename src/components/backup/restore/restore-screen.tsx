"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RestoredBackup } from "@/modules/backup/restore";
import { CloudRequestError, downloadCloudBackup } from "./cloud";
import { DecryptYourselfCard } from "./decrypt-yourself-card";
import { GroupsCard } from "./groups-card";
import { extractKey, MAX_BACKUP_BYTES, MAX_KEY_FILE_BYTES } from "./input";
import { KeyCard, type KeyProblem } from "./key-card";
import { NoticeAlert, type Notice } from "./notice";
import { SourceCard, type SourceKind } from "./source-card";
import { useCloudBackups } from "./use-cloud-backups";

export interface RestoreDestination {
  readonly id: string;
  /** The provider's display name ("Google Drive"), for the sentences that name it. */
  readonly provider: string;
}

/**
 * Opening a backup, in this browser, and taking the groups out of it.
 *
 * ## The key stays here
 *
 * The recovery key is typed or loaded on this screen and **goes nowhere**. It
 * is held in one piece of component state, handed to `openBackup`, which runs
 * in this tab, and dropped with the page. There is no request in this file that
 * could carry it — the only two (`cloud.ts`) take a destination and a file
 * name — and it is not put in a URL, in storage of any kind, in a server
 * action or on the console. Keeping that true is the reason the screen is as
 * plain as it is: no effect watches the key, nothing logs a failure, and a
 * failure's `catch` never reads what it caught.
 *
 * ## What it does with what it is given
 *
 * The backup comes from the person's connected cloud (this server fetches the
 * ciphertext, and cannot read it) or from a file. `openBackup` does the rest
 * and says which of four things was wrong; the key's fault is shown under the
 * key field, since its cure is a different key, and the other three above the
 * source, since theirs is a different file. The one failure this screen words
 * itself is a key file with no key in it, which `openBackup` never sees.
 *
 * `openBackup` and the age library behind it are imported when the person
 * first presses Open, so the page they arrive on does not carry them.
 */
export function RestoreScreen({
  available,
  destination,
}: {
  /** Whether this server can reach a cloud at all (rclone is installed). */
  available: boolean;
  /** The person's destination, if they have connected one. */
  destination: RestoreDestination | null;
}) {
  const t = useTranslations("cloudBackup");
  const cloudDestination = available ? destination : null;

  const [source, setSource] = useState<SourceKind>(
    cloudDestination ? "cloud" : "file",
  );
  const [pickedCloud, setPickedCloud] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState("");
  const [keyProblem, setKeyProblem] = useState<KeyProblem | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState<RestoredBackup | null>(null);

  const cloud = useCloudBackups(cloudDestination?.id ?? null);

  // The newest backup is chosen until the person chooses another.
  const listed = cloud.list.status === "ready" ? cloud.list.files : [];
  const cloudChoice =
    listed.find((entry) => entry.name === pickedCloud)?.name ??
    listed[0]?.name ??
    null;

  const haveBackup = source === "cloud" ? cloudChoice !== null : file !== null;
  const canOpen = haveBackup && key.trim() !== "" && !opening;

  /** A different backup is a different question: what was shown no longer applies. */
  const changeBackup = () => {
    setNotice(null);
    setOpened(null);
  };

  const chooseSource = (next: SourceKind) => {
    setSource(next);
    changeBackup();
  };

  const chooseFile = (picked: File) => {
    changeBackup();
    if (picked.size > MAX_BACKUP_BYTES) {
      setFile(null);
      setNotice({ kind: "tooBig" });
      return;
    }
    setFile(picked);
  };

  const chooseCloud = (name: string) => {
    setPickedCloud(name);
    changeBackup();
  };

  const loadKeyFile = async (picked: File) => {
    // Three lines of text. A file of any other size is not a key file, and is
    // not read.
    let found: string | null = null;
    if (picked.size <= MAX_KEY_FILE_BYTES) {
      try {
        found = extractKey(await picked.text());
      } catch {
        found = null;
      }
    }
    setKey(found ?? "");
    setKeyProblem(found === null ? "noKeyInFile" : null);
  };

  const open = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canOpen) return;

    setOpening(true);
    setNotice(null);
    setKeyProblem(null);
    setOpened(null);

    try {
      let bytes: ArrayBuffer;
      if (source === "file" && file) {
        bytes = await file.arrayBuffer();
      } else if (source === "cloud" && cloudDestination && cloudChoice) {
        const downloaded = await downloadCloudBackup(
          cloudDestination.id,
          cloudChoice,
        );
        if (downloaded === "too-big") {
          setNotice({ kind: "tooBig" });
          return;
        }
        bytes = downloaded;
      } else {
        return;
      }

      // The key as the person gave it, or the key found inside what they
      // pasted (a whole key file, comments and all).
      const identity = extractKey(key) ?? key.trim();
      const { openBackup, RestoreError } =
        await import("@/modules/backup/restore");
      try {
        setOpened(await openBackup(new Uint8Array(bytes), identity));
      } catch (error) {
        if (!(error instanceof RestoreError)) throw error;
        switch (error.reason) {
          case "wrong-key":
            setKeyProblem("wrongKey");
            break;
          case "unreadable":
            setNotice({ kind: "unreadable" });
            break;
          case "not-a-backup":
            setNotice({ kind: "notABackup" });
            break;
          case "too-new":
            setNotice({ kind: "tooNew" });
            break;
        }
      }
    } catch (error) {
      // Not logged: the key is in scope here, and an error is the thing most
      // likely to be sent somewhere that logs.
      // A CloudRequestError can only have come from fetching the chosen backup.
      setNotice(
        error instanceof CloudRequestError
          ? { kind: "download", code: error.code }
          : { kind: "unknown" },
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <>
      {opened ? (
        <GroupsCard backup={opened} />
      ) : (
        <p className="px-1.5 text-xs text-pretty text-muted-foreground">
          {t("restore.intro")}
        </p>
      )}

      <form
        onSubmit={(event) => void open(event)}
        autoComplete="off"
        noValidate
        className="flex flex-col gap-3.5"
      >
        {notice && (
          <NoticeAlert notice={notice} provider={destination?.provider ?? ""} />
        )}

        <div className="grid gap-3.5 lg:grid-cols-2 lg:items-start">
          <SourceCard
            cloud={
              cloudDestination
                ? {
                    provider: cloudDestination.provider,
                    list: cloud.list,
                    retry: cloud.retry,
                    chosen: cloudChoice,
                    onChoose: chooseCloud,
                  }
                : null
            }
            source={source}
            onSource={chooseSource}
            file={file}
            onFile={chooseFile}
            disabled={opening}
          />
          <KeyCard
            value={key}
            onChange={(value) => {
              setKey(value);
              setKeyProblem(null);
            }}
            onKeyFile={(picked) => void loadKeyFile(picked)}
            problem={keyProblem}
            disabled={opening}
          />
        </div>

        <div className="lg:flex lg:justify-end">
          <Button
            type="submit"
            disabled={!canOpen}
            className="w-full rounded-xl font-semibold lg:w-auto lg:px-5"
          >
            {opening && <Loader2 aria-hidden="true" className="animate-spin" />}
            {opening ? t("restore.opening") : t("restore.open")}
          </Button>
        </div>

        {/* Said as well as shown, because the button's name changing under a
            screen reader's cursor is not announced. */}
        <p role="status" className="sr-only">
          {opening ? t("restore.opening") : ""}
        </p>
      </form>

      <DecryptYourselfCard />
    </>
  );
}
