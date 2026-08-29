"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, TriangleAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useDateFormatter, useNumberLocale } from "@/i18n/format-context";
import { formatMoney, money } from "@/modules/currencies/money";
import {
  listQueuedForGroup,
  removeQueued,
  subscribeToOutbox,
  type QueuedEntry,
} from "@/lib/offline/outbox";
import { useOnline } from "./use-online";

/**
 * The one piece of chrome this feature adds: a line above the group saying
 * what has not reached the server yet.
 *
 * It is the answer to the question the queue creates. Somebody who types four
 * expenses at dinner with no signal has, from the app's point of view, added
 * nothing to the group — the list is unchanged and the balances are unchanged,
 * and without this they would have no way to tell that from the app having
 * lost their evening. So the count is stated plainly, on the screen the
 * entries belong to, and tapping it shows exactly which ones.
 *
 * It renders nothing when the queue is empty and there is a network, which is
 * almost always. Being offline alone is worth a line too: it explains why the
 * numbers below are the ones from earlier.
 */
export function PendingStrip({ groupId }: { groupId: string }) {
  const t = useTranslations("outbox");
  const online = useOnline();
  const [entries, setEntries] = useState<QueuedEntry[]>([]);
  const [showing, setShowing] = useState(false);

  const reload = useCallback(() => {
    void listQueuedForGroup(groupId).then(setEntries);
  }, [groupId]);

  useEffect(() => {
    reload();
    return subscribeToOutbox(reload);
  }, [reload]);

  const blocked = entries.filter((entry) => entry.status === "blocked").length;
  if (entries.length === 0 && online) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => entries.length > 0 && setShowing(true)}
        // Not a button at all when there is nothing to open — offline with an
        // empty queue is a statement, and a control that does nothing invites
        // a tap that answers nothing.
        aria-disabled={entries.length === 0}
        className="flex w-full items-center gap-2.5 rounded-xl border bg-muted/50 px-3 py-2.5 text-left text-sm text-muted-foreground"
      >
        {blocked > 0 ? (
          <TriangleAlert
            aria-hidden="true"
            className="size-4 shrink-0 text-destructive"
          />
        ) : online ? (
          <Loader2
            aria-hidden="true"
            className="size-4 shrink-0 animate-spin"
          />
        ) : (
          <WifiOff aria-hidden="true" className="size-4 shrink-0" />
        )}
        <span className="text-pretty">
          {blocked > 0
            ? t("stripBlocked", { count: blocked })
            : entries.length > 0
              ? online
                ? t("stripSyncing", { count: entries.length })
                : t("stripWaiting", { count: entries.length })
              : t("stripOffline")}
        </span>
      </button>

      <Sheet open={showing} onOpenChange={setShowing}>
        <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("sheetTitle")}</SheetTitle>
            <SheetDescription>{t("sheetBody")}</SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {entries.map((entry) => (
              <PendingRow key={entry.clientKey} entry={entry} />
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}

function PendingRow({ entry }: { entry: QueuedEntry }) {
  const t = useTranslations("outbox");
  const locale = useNumberLocale();
  const dates = useDateFormatter();
  const [discarding, setDiscarding] = useState(false);

  const amount = formatMoney(
    money(BigInt(entry.payload.amount), entry.payload.currency),
    { locale },
  );

  return (
    <li className="flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{entry.payload.description}</span>
        <span className="shrink-0 font-mono text-sm">{amount}</span>
      </div>
      <span className="text-xs text-muted-foreground">
        {dates.plain(entry.payload.expenseDate)}
      </span>

      {entry.status === "blocked" && (
        <>
          <p className="text-xs text-pretty text-destructive">
            {t(
              entry.blockedFor === "noAccess"
                ? "blockedNoAccess"
                : "blockedRefused",
            )}
          </p>
          {/*
           * Discarding is the only destructive thing this feature offers, and
           * it is offered only here — on an entry the server has already
           * refused, in front of the person who typed it, with the reason
           * beside it. Nothing else ever removes a queued entry except the
           * server accepting it.
           */}
          <Button
            variant="outline"
            size="sm"
            disabled={discarding}
            onClick={() => {
              setDiscarding(true);
              void removeQueued(entry.clientKey);
            }}
          >
            {t("discard")}
          </Button>
        </>
      )}
    </li>
  );
}
