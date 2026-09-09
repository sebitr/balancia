"use client";

import { useFormatter, useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { EntryMember } from "./pills";

/**
 * What the sentence said about people, offered rather than applied.
 *
 * The dictation parser fills the amount, the currency and the description
 * outright, because a wrong figure is visible in the field it landed in. A
 * name is not: a payer the reader never chose looks exactly like a payer they
 * did, and the split row would read as true. So the people go no further than
 * this — two chips under the row they would change, each one a sentence the
 * reader can agree with in a tap or leave alone.
 *
 * Which is why there is no toast on either side of it. The chip is the
 * confirmation: press it and the row above says the new thing, press the
 * cross and the offer is gone. Both answers are already on screen, and a
 * toast over the row it is describing would be a slower second copy of one of
 * them — the doctrine at `toastUndoable` in src/components/ui/sonner.tsx.
 *
 * Nothing is rendered for a proposal the form already agrees with: the parent
 * passes "" and [] for the halves that match, and a chip offering what is
 * there is a chip that does nothing.
 */

const CHIP =
  "tap-target h-10 rounded-full border border-border bg-wash-1 px-3 text-sm text-muted-foreground transition-colors active:bg-wash-3";

export function HeardPeopleChips({
  members,
  selfId,
  payerId,
  participantIds,
  onPayer,
  onSplit,
  onDismiss,
}: {
  members: readonly EntryMember[];
  selfId: string;
  /** The payer the sentence named, or "" when there is nothing to offer. */
  payerId: string;
  /** The people it put in the split, or [] when there is nothing to offer. */
  participantIds: readonly string[];
  onPayer: () => void;
  onSplit: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("addEntry.voice.heard");
  const format = useFormatter();

  const nameOf = (id: string): string =>
    members.find((member) => member.id === id)?.displayName ?? "";

  const payerName = payerId === "" ? "" : nameOf(payerId);
  const justSelf =
    participantIds.length === 1 && participantIds[0] === selfId && selfId !== "";
  const splitNames = format.list(
    participantIds.map(nameOf).filter((name) => name !== ""),
    { type: "conjunction" },
  );

  // A member who has left the group between the sentence and the chip has no
  // name to show, and a chip with a hole in it says less than no chip.
  const showPayer = payerName !== "";
  const showSplit = splitNames !== "";
  if (!showPayer && !showSplit) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      <span className="text-xs text-muted-foreground">{t("label")}</span>

      {showPayer && (
        <button type="button" onClick={onPayer} className={CHIP}>
          {t("payer", { name: payerName })}
        </button>
      )}

      {showSplit && (
        <button type="button" onClick={onSplit} className={CHIP}>
          {justSelf ? t("justYou") : t("split", { names: splitNames })}
        </button>
      )}

      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("dismiss")}
        className="tap-target -m-1 shrink-0 rounded-full p-1 text-muted-foreground transition-colors active:bg-wash-3"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
