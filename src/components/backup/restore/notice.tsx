"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cloudErrorKey } from "./cloud";

/**
 * Why a backup could not be opened, other than the key.
 *
 * A wrong key has its own slot under the key field, because the cure is a
 * different key. Everything here is about the backup itself, or about getting
 * it from the cloud, and sits above the source: the cure is a different file,
 * or another try.
 */
export type Notice =
  /** Larger than the screen will read into memory. */
  | { readonly kind: "tooBig" }
  /** Not an age file, truncated, or damaged on the way. */
  | { readonly kind: "unreadable" }
  /** Decrypts, but is not something Balancia wrote. */
  | { readonly kind: "notABackup" }
  /** Written by a newer Balancia than this one. */
  | { readonly kind: "tooNew" }
  /** The cloud would not list its backups, with the code if it gave one. */
  | { readonly kind: "cloud"; readonly code: string | null }
  /** The cloud would not hand over the chosen backup, with the code if it gave one. */
  | { readonly kind: "download"; readonly code: string | null }
  /** Anything this screen has no better words for. */
  | { readonly kind: "unknown" };

/**
 * A destructive alert in the screen's one voice.
 *
 * `provider` is the name the cloud sentences use. `children` is for the one
 * action that can follow a failure to read the list: trying again. The
 * provider's own explanation, when the server sent a code, follows the screen's
 * sentence; the `…Hint` lines that go with those explanations are about the
 * schedule ("Balancia will try again"), which is not what is happening here,
 * so they are left out.
 */
export function NoticeAlert({
  notice,
  provider,
  children,
}: {
  notice: Notice;
  provider: string;
  children?: ReactNode;
}) {
  const t = useTranslations("cloudBackup");

  let first: string;
  let second: string | null = null;
  switch (notice.kind) {
    case "tooBig":
      first = t("restore.fileTooBig");
      break;
    case "unreadable":
      first = t("restore.unreadable");
      break;
    case "notABackup":
      first = t("restore.notABackup");
      break;
    case "tooNew":
      first = t("restore.tooNew");
      break;
    case "cloud":
    case "download": {
      first =
        notice.kind === "cloud"
          ? t("restore.cloudFailed", { provider })
          : t("restore.downloadFailed", { provider });
      const key = cloudErrorKey(notice.code);
      second = key ? t(`error.${key}`, { provider }) : null;
      break;
    }
    case "unknown":
      first = t("error.unknown");
      break;
  }

  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertDescription>
        <span className="block">{first}</span>
        {second && <span className="mt-0.5 block">{second}</span>}
      </AlertDescription>
      {children && <div className="mt-2">{children}</div>}
    </Alert>
  );
}
