"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { discardDraft, loadDraft, type EntryDraft } from "@/lib/offline/drafts";
import { RESUME_PARAM } from "./add-entry-drawer";

/**
 * The entry somebody started and did not finish, offered back.
 *
 * Dashed, because it is not yet real — the same visual logic as the "Someone
 * else" row in the settle list, whose avatar is dashed because there is no
 * member to show yet. Tapping it reopens the drawer exactly as it was; the
 * small × discards it.
 *
 * A client component that reads the device's own store, so it renders nothing
 * on the server and nothing on a device that has no draft. That is also why it
 * cannot be part of the page's own data: a draft is local and private, and the
 * server is never told it exists.
 *
 * It sits high on the group screen rather than inside the transactions list.
 * The brief puts it at the top of the entry list; this app's group screen
 * leads with balances and the transactions list is a tab away, and the place a
 * reader lands after dismissing the drawer is here.
 */
export function DraftRow({ groupId }: { groupId: string }) {
  const t = useTranslations("addEntry.draft");
  const [draft, setDraft] = useState<EntryDraft | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDraft(groupId).then((stored) => {
      if (!cancelled) setDraft(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  if (!draft) return null;

  const parts = [draft.summary.amount, draft.summary.description].filter(
    (part) => part.trim() !== "",
  );

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-3">
      <Link
        href={`/groups/${groupId}/expenses/new?${RESUME_PARAM}=1`}
        className="min-w-0 flex-1 text-sm"
      >
        <span className="font-medium">{t("label")}</span>
        {parts.length > 0 && (
          <span className="text-muted-foreground"> · {parts.join(" · ")}</span>
        )}
      </Link>
      <button
        type="button"
        aria-label={t("discard")}
        onClick={() => {
          // Optimistic, and nothing here needs telling if it fails: the row is
          // gone from this screen either way, and the next load re-reads.
          setDraft(null);
          void discardDraft(groupId);
        }}
        className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
