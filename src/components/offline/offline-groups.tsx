"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AddEntryForm } from "@/components/entries/add-entry-form";
import { ENTRY_SHEET_CLASS } from "@/components/entries/add-entry-drawer";
import { listSnapshots, type GroupSnapshot } from "@/lib/offline/snapshot";
import type en from "../../../messages/en.json";

/**
 * The groups this device can still add to, on the screen that has no network.
 *
 * The offline shell used to be a full stop: it said the connection was gone
 * and that nothing typed here would be kept, and it was telling the truth. It
 * is the screen a cold start with no signal lands on — the app reopened at a
 * table in another country, which is the exact moment somebody wants to record
 * what they just paid for.
 *
 * So it lists what it has. Each row opens the same entry form every other
 * screen opens, filled from the snapshot taken the last time this group's add
 * screen was loaded with a server behind it, and saving puts the entry in the
 * queue that drains on reconnect.
 *
 * The strings arrive as a prop rather than through `useTranslations`. This
 * subtree renders inside a statically-prerendered page with no locale and no
 * i18n provider — see `offline-notice.tsx` for why that page is built the way
 * it is — so its parent, which has already picked a catalogue from the cookie,
 * passes the words down.
 */
export function OfflineGroups({
  messages,
}: {
  messages: (typeof en)["offline"];
}) {
  const [groups, setGroups] = useState<GroupSnapshot[] | null>(null);
  const [adding, setAdding] = useState<GroupSnapshot | null>(null);

  useEffect(() => {
    void listSnapshots().then(setGroups);
  }, []);

  // Null while the store is being read: a flash of "no groups" followed by a
  // list is worse than a beat of nothing, and this read is fast.
  if (groups === null) return null;

  if (groups.length === 0) {
    return (
      <p className="text-sm text-pretty text-muted-foreground">
        {messages.noGroups}
      </p>
    );
  }

  return (
    <div className="w-full space-y-3 text-left">
      <h2 className="text-center text-sm font-medium text-muted-foreground">
        {messages.groupsTitle}
      </h2>
      <ul className="space-y-2">
        {groups.map((group) => (
          <li key={group.groupId}>
            <button
              type="button"
              onClick={() => setAdding(group)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left font-medium transition-colors hover:bg-accent"
            >
              <span className="truncate">{group.groupName}</span>
              <Plus aria-hidden="true" className="size-4 shrink-0" />
            </button>
          </li>
        ))}
      </ul>

      <Sheet open={adding !== null} onOpenChange={(o) => !o && setAdding(null)}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className={ENTRY_SHEET_CLASS}
        >
          {adding && (
            <AddEntryForm
              groupId={adding.groupId}
              groupName={adding.groupName}
              members={adding.members}
              selfId={adding.selfId}
              currencyMode={adding.currencyMode}
              baseCurrency={adding.baseCurrency}
              defaultCurrency={adding.defaultCurrency}
              timezone={adding.timezone}
              // As in the in-app offline drawer: no repayments without
              // balances, and no receipt reader without a network to fetch it.
              entryTypes={["expense", "income"]}
              outstanding={[]}
              frequentCategories={adding.frequentCategories}
              receiptScanning={false}
              onClose={() => setAdding(null)}
              onSaved={() => setAdding(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
