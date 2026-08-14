"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useNumberLocale } from "@/i18n/format-context";
import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatMoney, money } from "@/modules/currencies/money";
import {
  assignReceipt,
  type ItemAssignment,
  type SharedChargeStrategy,
} from "@/modules/receipts";
import { draftItems, type ReceiptDraft } from "./draft";

/**
 * Who had what.
 *
 * The screen that makes this feature worth having: reading the total off a
 * receipt saves a little typing, but knowing that Julie only had the tiramisu
 * is the thing that is tedious to work out and easy to get wrong.
 *
 * Every number shown is computed by `assignReceipt`, which is the same code
 * that produces the split that gets stored — so the preview cannot disagree
 * with the result. It is not a separate estimate rendered for the UI.
 */

export interface Participant {
  readonly id: string;
  readonly displayName: string;
}

export function ItemAssignmentView({
  draft,
  participants,
  assignments,
  onAssignmentsChange,
  strategy,
  onStrategyChange,
  total,
}: {
  draft: ReceiptDraft;
  participants: readonly Participant[];
  assignments: readonly ItemAssignment[];
  onAssignmentsChange: (next: readonly ItemAssignment[]) => void;
  strategy: SharedChargeStrategy;
  onStrategyChange: (next: SharedChargeStrategy) => void;
  /** The confirmed expense total, which the shares must add up to. */
  total: bigint;
}) {
  const t = useTranslations("receiptScanner.assign");
  const locale = useNumberLocale();

  const items = useMemo(() => draftItems(draft), [draft]);
  const claimed = useMemo(
    () =>
      new Map(assignments.map((entry) => [entry.itemId, entry.participantIds])),
    [assignments],
  );

  const result = useMemo(() => {
    if (participants.length === 0) return null;
    try {
      return assignReceipt({
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          total: item.total,
        })),
        assignments,
        participantIds: participants.map((participant) => participant.id),
        total,
        strategy,
      });
    } catch {
      // A split with nobody in it: the caller's guard covers this, and a
      // preview is not worth an error boundary.
      return null;
    }
  }, [items, assignments, participants, total, strategy]);

  const show = (amount: bigint) =>
    formatMoney(money(amount, draft.currency), { locale });

  const toggle = (itemId: string, participantId: string) => {
    const current = claimed.get(itemId) ?? [];
    const next = current.includes(participantId)
      ? current.filter((id) => id !== participantId)
      : [...current, participantId];

    const others = assignments.filter((entry) => entry.itemId !== itemId);
    onAssignmentsChange([...others, { itemId, participantIds: next }]);
  };

  const everyone = (itemId: string) =>
    onAssignmentsChange([
      ...assignments.filter((entry) => entry.itemId !== itemId),
      {
        itemId,
        participantIds: participants.map((participant) => participant.id),
      },
    ]);

  return (
    <div className="space-y-6">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noItems")}</p>
      ) : (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t("whoHadWhat")}</legend>

          <ul className="divide-y rounded-lg border">
            {items.map((item) => {
              const holders = claimed.get(item.id) ?? [];
              return (
                <li key={item.id} className="space-y-2 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">
                      {item.name || t("untitledItem")}
                      {item.quantity ? ` ×${item.quantity}` : ""}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {show(item.total)}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {participants.map((participant) => {
                      const active = holders.includes(participant.id);
                      return (
                        <button
                          key={participant.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggle(item.id, participant.id)}
                          className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                            active
                              ? "border-primary bg-primary text-primary-foreground"
                              : "hover:bg-muted"
                          }`}
                        >
                          {participant.displayName}
                        </button>
                      );
                    })}
                    {holders.length !== participants.length && (
                      <button
                        type="button"
                        onClick={() => everyone(item.id)}
                        className="rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground hover:bg-muted"
                      >
                        {t("everyone")}
                      </button>
                    )}
                  </div>

                  {holders.length > 1 && (
                    <p className="text-xs text-muted-foreground">
                      {t("splitBetween", { count: holders.length })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {result && result.sharedCharges !== 0n && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">
            {t("sharedCharges", { amount: show(result.sharedCharges) })}
          </legend>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {t("sharedExplanation")}
          </p>

          <RadioGroup
            value={strategy}
            onValueChange={(value) =>
              onStrategyChange(value as SharedChargeStrategy)
            }
            className="gap-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="proportional" id="shared-proportional" />
              <Label htmlFor="shared-proportional" className="font-normal">
                {t("proportional")}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="equal" id="shared-equal" />
              <Label htmlFor="shared-equal" className="font-normal">
                {t("equal")}
              </Label>
            </div>
          </RadioGroup>
        </fieldset>
      )}

      {result && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("eachPerson")}</h3>
          <ul className="divide-y rounded-lg border">
            {result.shares.map((share) => {
              const participant = participants.find(
                (entry) => entry.id === share.participantId,
              );
              return (
                <li
                  key={share.participantId}
                  className="flex items-baseline justify-between gap-3 p-3"
                >
                  <span className="text-sm">{participant?.displayName}</span>
                  <span className="text-right">
                    <span className="block text-sm font-medium tabular-nums">
                      {show(share.amount)}
                    </span>
                    {share.shared !== 0n && (
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {t("breakdown", {
                          items: show(share.items),
                          shared: show(share.shared),
                        })}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          {result.unassignedItemIds.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("unassigned", { count: result.unassignedItemIds.length })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
