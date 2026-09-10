"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GroupIconTile } from "@/components/groups/group-icon";
import type { GroupIcon, GroupIconColor } from "@/modules/groups/icons";
import {
  RESUME_PARAM,
  withFragment,
} from "@/components/entries/drawer-fragment";
import { uploadReceipt } from "@/components/expenses/upload-receipt";
import { saveDraft } from "@/lib/offline/drafts";
import {
  sharedText,
  takeSharedPayload,
  type SharedPayload,
} from "@/lib/offline/shared";
import { shareDraft } from "./share-draft";

/**
 * Where a share sheet lands.
 *
 * Somebody has just forwarded a receipt, a booking confirmation or a line out
 * of a chat, and the only thing this screen is for is finding out which group
 * it belongs to. So it asks that and nothing else: no form, no amount, no
 * confirmation step. Once a group is chosen it writes the group's draft and
 * navigates into the drawer, which is where every other entry in this app is
 * made.
 *
 * The share itself is *taken* rather than read — see `shared.ts` — so a reload
 * of this screen shows the empty state instead of filing the same receipt
 * twice. That is what shapes the state here: the effect that takes it runs once
 * on arrival and the payload is then carried in the stage, because there is
 * nothing left in the store to read a second time.
 *
 * One group means no question worth asking, so it is not asked. The screen
 * files straight into it.
 */

export interface ShareableGroup {
  readonly id: string;
  readonly name: string;
  readonly icon: GroupIcon | null;
  readonly iconColor: GroupIconColor | null;
  /** What the group balances in, for a sentence that names no currency. */
  readonly currency: string;
}

type Stage =
  | { readonly kind: "reading" }
  | { readonly kind: "empty" }
  | { readonly kind: "choosing"; readonly payload: SharedPayload }
  | { readonly kind: "filing"; readonly payload: SharedPayload }
  | { readonly kind: "failed"; readonly payload: SharedPayload };

export function ShareScreen({ groups }: { groups: readonly ShareableGroup[] }) {
  const t = useTranslations("share");
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "reading" });
  const filing = useRef(false);

  const file = useCallback(
    async (payload: SharedPayload, group: ShareableGroup) => {
      // Two taps on one row, or the auto-file below racing a tap, would upload
      // the receipt twice and leave an orphan attachment behind.
      if (filing.current) return;
      filing.current = true;
      setStage({ kind: "filing", payload });

      try {
        const roster = await fetch(`/api/groups/${group.id}`);
        if (!roster.ok) throw new Error("roster");
        const read = (await roster.json()) as {
          participantId: string;
          participants: readonly { id: string }[];
        };

        let attachmentId: string | null = null;
        if (payload.file) {
          const uploaded = await uploadReceipt(
            group.id,
            payload.file,
            payload.file.name,
          );
          // A receipt that will not upload does not cost the entry: the words
          // and the amount are still worth having, and the drawer can attach
          // the photograph again from the library.
          if (uploaded.ok) attachmentId = uploaded.file.id;
        }

        await saveDraft(
          shareDraft({
            groupId: group.id,
            text: sharedText(payload),
            fallbackCurrency: group.currency,
            selfParticipantId: read.participantId,
            memberIds: read.participants.map((participant) => participant.id),
            attachmentId,
          }),
        );

        router.push(
          withFragment(`/groups/${group.id}/expenses/new`, {
            [RESUME_PARAM]: "1",
          }),
        );
      } catch {
        filing.current = false;
        setStage({ kind: "failed", payload });
      }
    },
    [router],
  );

  useEffect(() => {
    let cancelled = false;
    void takeSharedPayload().then((payload) => {
      if (cancelled) return;
      if (!payload) {
        setStage({ kind: "empty" });
        return;
      }
      const only = groups.length === 1 ? groups[0] : undefined;
      if (only) {
        void file(payload, only);
        return;
      }
      setStage({ kind: "choosing", payload });
    });
    return () => {
      cancelled = true;
    };
    // Once, on arrival: the payload is consumed by this read, so re-running it
    // would find nothing and blank a screen somebody is looking at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nothing at all while the store is read. A flash of "nothing was shared"
  // followed by a receipt is worse than a beat of blank, and this read is fast.
  if (stage.kind === "reading") return null;

  if (stage.kind === "empty") {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <h1 className="text-lg font-semibold tracking-[-0.02em]">
          {t("emptyTitle")}
        </h1>
        <p className="max-w-xs text-sm text-pretty text-muted-foreground">
          {t("emptyBody")}
        </p>
        <Button asChild variant="outline">
          <a href="/dashboard">{t("toGroups")}</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-5 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-[-0.02em]">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <SharePreview payload={stage.payload} />

      {stage.kind === "failed" && (
        <p role="alert" className="text-sm text-negative-ink">
          {t("failed")}
        </p>
      )}

      <ul className="border-t">
        {groups.map((group) => (
          <li key={group.id} className="border-b">
            <button
              type="button"
              disabled={stage.kind === "filing"}
              onClick={() => void file(stage.payload, group)}
              className="flex w-full items-center gap-3 py-[13px] text-left transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:translate-y-0"
            >
              <GroupIconTile
                icon={group.icon}
                color={group.iconColor}
                name={group.name}
                className="size-8 rounded-[10px] bg-accent text-sm text-accent-foreground"
                iconClassName="size-4"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {group.name}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {groups.length === 0 && (
        <p className="text-sm text-pretty text-muted-foreground">
          {t("noGroups")}
        </p>
      )}
    </div>
  );
}

/**
 * What arrived, said back.
 *
 * Not a form, and not the parsed amount: this screen has not chosen a group
 * yet, so it does not know which currency the figure is in and would be
 * guessing at the one number people check. The words and the file name are
 * enough to recognise what is being filed — which is the only question the
 * preview has to answer before the group list underneath it.
 */
function SharePreview({ payload }: { payload: SharedPayload }) {
  const t = useTranslations("share");
  const text = sharedText(payload);
  const isPdf = payload.file?.type === "application/pdf";

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/60 px-4 py-3">
      {payload.file && (
        <p className="flex items-center gap-2 text-sm font-medium">
          {isPdf ? (
            <FileText aria-hidden="true" className="size-4 shrink-0" />
          ) : (
            <ImageIcon aria-hidden="true" className="size-4 shrink-0" />
          )}
          <span className="min-w-0 truncate">{payload.file.name}</span>
        </p>
      )}
      {text !== "" && (
        <p className="text-sm text-pretty text-muted-foreground">{text}</p>
      )}
      {text === "" && !payload.file && (
        <p className="text-sm text-muted-foreground">{t("nothingReadable")}</p>
      )}
    </div>
  );
}
