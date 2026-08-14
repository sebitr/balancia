"use client";

import { useMemo, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useNumberLocale } from "@/i18n/format-context";
import { toast } from "sonner";
import { ArrowLeft, Bell, Check, Share2, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Amount } from "@/components/money/amount";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { formatMoney, money } from "@/modules/currencies/money";
import { sendReminderAction } from "@/modules/reminders/actions";
import { sumByCurrency } from "@/modules/reminders/debts";
import {
  DEFAULT_TONE,
  DRAFTS,
  pickDraft,
  positionOf,
  type RemindTone,
} from "@/modules/reminders/messages";
import type { RemindDebt, RemindRecipient } from "@/modules/reminders/types";

/**
 * Two steps: who owes you, and what to say to them.
 *
 * The message is one draft, personalised per recipient and sent one at a time,
 * because the two halves of "send" are not the same act: where Balancia can
 * deliver a push it does, and where it cannot the sender's own share sheet
 * does — nothing is ever sent *as* the user without them seeing it go.
 *
 * Which of those two routes a person is on is shown before anything is sent,
 * never discovered afterwards. Somebody who silenced this group still appears,
 * still gets asked, and still does not get a push: their setting wins, and the
 * row says so.
 *
 * One row per person, never per debt. A group that spends in two currencies
 * leaves the same person owing in both, and since a reminder may only go out
 * once a day, asking them per currency would spend the whole allowance on half
 * the debt. Their amounts are listed instead — beside each other in the row,
 * and both named in the one message — because two currencies have no sum.
 */

const TONES: readonly RemindTone[] = ["gentle", "dry", "cheeky"];

type Step = "who" | "message";

export function RemindSheet({
  groupId,
  groupName,
  senderName,
  recipients,
  onDone,
}: {
  groupId: string;
  groupName: string;
  /** The reader's own name: the drafts name the person owed, in the third
      person, because the recipient is the one who will read them. */
  senderName: string;
  recipients: readonly RemindRecipient[];
  onDone: () => void;
}) {
  const t = useTranslations("remind");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const locale = useNumberLocale();
  const [isPending, startTransition] = useTransition();

  const [step, setStep] = useState<Step>("who");
  /** Pinned once, so the "reminded 2 hours ago" lines do not drift mid-sheet. */
  const [openedAt] = useState(() => new Date());
  const [tone, setTone] = useState<RemindTone>(DEFAULT_TONE);
  const [draftKey, setDraftKey] = useState(
    () => pickDraft(DEFAULT_TONE, null).key,
  );
  /** Set once the sender types: their words then survive a tone change. */
  const [edited, setEdited] = useState<string | null>(null);
  const [includeLink, setIncludeLink] = useState(true);
  const [logToActivity, setLogToActivity] = useState(true);
  const [sentTo, setSentTo] = useState<readonly string[]>([]);

  // Locked recipients are shown but never selectable — the 24-hour limit is
  // the point, and hiding them would just look like people going missing.
  const openRecipients = useMemo(
    () => recipients.filter((recipient) => !recipient.locked),
    [recipients],
  );
  const [selected, setSelected] = useState<readonly string[]>(() =>
    openRecipients.map((recipient) => recipient.participantId),
  );

  const queue = openRecipients.filter(
    (recipient) =>
      selected.includes(recipient.participantId) &&
      !sentTo.includes(recipient.participantId),
  );
  const current = queue[0] ?? null;

  /**
   * A debt as one phrase: "€148.00", or "€148.00 and ¥1,400" when the group
   * spent in more than one currency. Joined in the reader's language, never
   * added up.
   */
  const phrase = (debts: readonly RemindDebt[]): string =>
    format.list(
      debts.map((debt) =>
        formatMoney(money(BigInt(debt.amount), debt.currency), { locale }),
      ),
      { type: "conjunction" },
    );

  /** Everything the reader is owed, per currency — the subtitle's figure. */
  const totals = useMemo(
    () => sumByCurrency(recipients.flatMap((recipient) => recipient.debts)),
    [recipients],
  );

  /** The draft as it reads for one recipient: their debt, the reader's name. */
  const composeFor = (recipient: RemindRecipient): string => {
    const amount = phrase(recipient.debts);
    const body =
      edited ??
      t(`drafts.${draftKey}` as "drafts.gentle1", {
        name: senderName,
        amount,
        group: groupName,
      });
    if (!includeLink) return body;
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    return `${body}\n${origin}/groups/${groupId}`;
  };

  const preview = current ? composeFor(current) : "";

  const shuffle = () => {
    if (edited !== null && !window.confirm(t("discardEdit"))) return;
    setEdited(null);
    setDraftKey(pickDraft(tone, draftKey).key);
  };

  const changeTone = (next: RemindTone) => {
    if (next === tone) return;
    if (edited !== null && !window.confirm(t("discardEdit"))) return;
    setEdited(null);
    setTone(next);
    setDraftKey(pickDraft(next, draftKey).key);
  };

  const record = (recipient: RemindRecipient, message: string) => {
    startTransition(async () => {
      const result = await sendReminderAction(groupId, {
        toParticipantId: recipient.participantId,
        message,
        logToActivity,
      });

      if (!result.ok) {
        toast.error(result.error ?? t("failed"));
        return;
      }

      const remaining = queue.filter(
        (candidate) => candidate.participantId !== recipient.participantId,
      );
      const next = remaining[0];
      toast.success(
        result.data?.channel === "push"
          ? t("sentPush", { name: recipient.name })
          : t("sentShare", { name: recipient.name }),
        {
          description: next
            ? next.channel === "push"
              ? t("sentNextPush", { name: next.name })
              : t("sentNextShare", { name: next.name })
            : undefined,
        },
      );

      setSentTo((done) => [...done, recipient.participantId]);
      if (remaining.length === 0) onDone();
    });
  };

  /**
   * Hand the message over first, then record it.
   *
   * `navigator.share` has to be called inside the gesture that triggered it,
   * and a reminder that never left should leave no trace: a cancelled share
   * writes nothing, and neither does a hand-off that fails outright — better
   * to let the sender try again than to start a 24-hour lock on a message
   * nobody received.
   */
  const send = async () => {
    if (!current) return;
    const message = composeFor(current);

    if (current.channel === "push") {
      record(current, message);
      return;
    }

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text: message });
      } catch (error) {
        // Backing out of the share sheet is a decision, and says so by
        // saying nothing. Anything else genuinely went wrong.
        if ((error as Error)?.name === "AbortError") return;
        toast.error(t("handoffFailed"));
        return;
      }
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(message);
        toast.info(t("copied"));
      } catch {
        // The clipboard can refuse — an unfocused document, a denied
        // permission. The draft is still on screen to copy by hand.
        toast.error(t("handoffFailed"));
        return;
      }
    } else {
      toast.error(t("handoffFailed"));
      return;
    }

    record(current, message);
  };

  if (step === "who") {
    return (
      <div className="flex flex-col gap-4">
        <span
          aria-hidden="true"
          className="mx-auto h-1 w-9 rounded-full bg-border"
        />

        <div className="flex flex-col gap-1 px-4">
          <SheetTitle className="text-[1.0625rem] font-semibold tracking-[-0.01em]">
            {t("sheetTitle")}
          </SheetTitle>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t("sheetSubtitle", {
              count: recipients.length,
              amount: phrase(totals),
            })}
          </p>
        </div>

        <fieldset className="flex flex-col gap-2 px-4">
          <legend className="sr-only">{t("recipientsLabel")}</legend>
          {recipients.map((recipient) => {
            const isSelected = selected.includes(recipient.participantId);
            return (
              <label
                key={recipient.participantId}
                className={cn(
                  "flex items-start gap-3 rounded-[14px] px-3 py-[11px] transition-colors",
                  recipient.locked
                    ? "opacity-55"
                    : "cursor-pointer hover:bg-muted",
                  isSelected &&
                    !recipient.locked &&
                    "bg-[color-mix(in_oklch,var(--primary)_8%,transparent)] ring-1 ring-[color-mix(in_oklch,var(--primary)_35%,transparent)]",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={isSelected && !recipient.locked}
                  disabled={recipient.locked}
                  onChange={(event) =>
                    setSelected((ids) =>
                      event.target.checked
                        ? [...ids, recipient.participantId]
                        : ids.filter((id) => id !== recipient.participantId),
                    )
                  }
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-md",
                    isSelected && !recipient.locked
                      ? "bg-primary text-primary-foreground"
                      : "ring-1 ring-border",
                  )}
                >
                  {isSelected && !recipient.locked && (
                    <Check className="size-3.5" strokeWidth={3} />
                  )}
                </span>

                <Avatar className="size-7 shrink-0">
                  <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">
                    {recipient.name.trim().charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {recipient.name}
                  </span>
                  <span
                    className={cn(
                      "flex items-start gap-1.5 text-xs",
                      recipient.channel === "push"
                        ? "text-positive"
                        : "text-muted-foreground",
                    )}
                  >
                    {recipient.channel === "push" && (
                      <Bell
                        aria-hidden="true"
                        className="mt-[3px] size-3 shrink-0"
                      />
                    )}
                    {recipient.locked && recipient.lastRemindedAt
                      ? t("lockedSince", {
                          // Measured against the moment the sheet opened. The
                          // baseline is explicit because the alternative is
                          // whatever clock the formatter reaches for.
                          when: format.relativeTime(
                            new Date(recipient.lastRemindedAt),
                            openedAt,
                          ),
                        })
                      : recipient.channel === "push"
                        ? t("channelPush")
                        : recipient.muted
                          ? t("channelMuted")
                          : t("channelShare")}
                  </span>
                </span>

                {/* Stacked, one line per currency: the euros and the yen are
                    two debts to the same person, and there is no rate here to
                    turn them into one figure. */}
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-sm font-medium text-negative">
                  {recipient.debts.map((debt) => (
                    <Amount
                      key={debt.currency}
                      minorUnits={debt.amount}
                      currency={debt.currency}
                    />
                  ))}
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="flex flex-col gap-2 px-4">
          <Button
            size="lg"
            className="h-11 rounded-[14px] text-[0.9375rem] font-semibold"
            disabled={selected.length === 0}
            onClick={() => setStep("message")}
          >
            {t("writeMessage")}
          </Button>
          <p className="px-2 text-center text-xs text-muted-foreground">
            {t("routesNote")}
          </p>
          <Button
            variant="ghost"
            className="h-[38px] text-sm text-muted-foreground"
            onClick={onDone}
          >
            {tCommon("cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <span
        aria-hidden="true"
        className="mx-auto h-1 w-9 rounded-full bg-border"
      />

      <div className="flex items-center gap-2 px-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("back")}
          className="size-[30px] shrink-0"
          onClick={() => setStep("who")}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
        </Button>
        <span className="flex min-w-0 flex-col">
          <SheetTitle className="text-[1.0625rem] font-semibold tracking-[-0.01em]">
            {t("messageTitle")}
          </SheetTitle>
          <span className="truncate text-xs text-muted-foreground">
            {t("messageSubtitle", {
              names: format.list(
                queue.map((recipient) => recipient.name),
                { type: "conjunction" },
              ),
            })}
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-3 px-4">
        <Textarea
          value={preview}
          aria-label={t("messageLabel")}
          rows={4}
          onChange={(event) => setEdited(event.target.value)}
          className="min-h-24 rounded-[14px] text-sm leading-[1.55]"
        />

        <div className="flex items-center gap-2 border-t pt-3">
          {TONES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => changeTone(option)}
              aria-pressed={tone === option}
              className={cn(
                "h-6 rounded-full px-3 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                tone === option
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground ring-1 ring-border hover:bg-muted",
              )}
            >
              {t(
                option === "gentle"
                  ? "toneGentle"
                  : option === "dry"
                    ? "toneDry"
                    : "toneCheeky",
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={shuffle}
            className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-primary transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Shuffle aria-hidden="true" className="size-3.5" />
            {t("shuffle")}
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("draftCaption", {
            index: positionOf(draftKey),
            total: DRAFTS.length,
          })}
        </p>

        <div className="flex flex-col gap-2.5">
          <ToggleRow
            id="remind-link"
            label={t("includeLink")}
            help={t("includeLinkHelp")}
            checked={includeLink}
            onChange={setIncludeLink}
          />
          <ToggleRow
            id="remind-log"
            label={t("logActivity")}
            help={t("logActivityHelp")}
            checked={logToActivity}
            onChange={setLogToActivity}
          />
        </div>
      </div>

      {current && (
        <div className="flex flex-col gap-2 px-4">
          <Button
            size="lg"
            disabled={isPending}
            onClick={send}
            className="h-11 rounded-[14px] text-[0.9375rem] font-semibold"
          >
            {current.channel === "push" ? (
              <Bell aria-hidden="true" className="size-[18px]" />
            ) : (
              <Share2 aria-hidden="true" className="size-4" />
            )}
            {current.channel === "push"
              ? t("sendPush", { name: current.name })
              : t("sendShare", { name: current.name })}
          </Button>
          {/* Whichever route this particular person is on, said plainly. A
              queue may hold both kinds, so the caption follows the recipient
              rather than describing the pair in the abstract. */}
          <p className="px-2 text-center text-xs text-muted-foreground">
            {current.channel === "push"
              ? t("sendCaptionPush", { name: current.name })
              : t("sendCaptionShare", { name: current.name })}
          </p>
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  id,
  label,
  help,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{help}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
