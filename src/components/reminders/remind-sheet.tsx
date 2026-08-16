"use client";

import { useMemo, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useNumberLocale } from "@/i18n/format-context";
import { toast } from "sonner";
import {
  Bell,
  Check,
  ChevronLeft,
  Clock,
  Link as LinkIcon,
  Share2,
  Shuffle,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Amount } from "@/components/money/amount";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { formatMoney, money } from "@/modules/currencies/money";
import { sendReminderAction } from "@/modules/reminders/actions";
import { sumByCurrency } from "@/modules/reminders/debts";
import {
  DEFAULT_TONE,
  pickDraft,
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
 * row says so — now as a badge beside the name rather than a line under it,
 * because the route is a label on a person, not a sentence about them.
 *
 * One row per person, never per debt. A group that spends in two currencies
 * leaves the same person owing in both, and since a reminder may only go out
 * once a day, asking them per currency would spend the whole allowance on half
 * the debt. Their amounts are listed instead — beside each other in the row,
 * and both named in the one message — because two currencies have no sum.
 */

const TONES: readonly RemindTone[] = ["gentle", "dry", "cheeky"];

type Step = "who" | "message";

/**
 * Coral at the two weights the sheet selects things with: a row is tinted
 * lightly because it sits among others, a chip more strongly because it stands
 * alone. Written out in full — Tailwind reads these as literal text, so a class
 * assembled from parts is a class that never gets generated.
 */
const PICKED_ROW =
  "border-[color-mix(in_oklch,var(--primary)_45%,transparent)] bg-[color-mix(in_oklch,var(--primary)_8%,transparent)]";
const PICKED_CHIP =
  "border-[color-mix(in_oklch,var(--primary)_45%,transparent)] bg-[color-mix(in_oklch,var(--primary)_12%,transparent)] text-foreground";
const UNPICKED = "border-border text-muted-foreground hover:bg-muted/60";

/** The one action a step ends on: full width, 52px, coral. */
const CTA =
  "h-[52px] w-full rounded-2xl text-base font-semibold [&_svg:not([class*='size-'])]:size-[19px]";

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

  const chosen = openRecipients.filter((recipient) =>
    selected.includes(recipient.participantId),
  );
  const queue = chosen.filter(
    (recipient) => !sentTo.includes(recipient.participantId),
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

  /**
   * How long ago this person was last asked, or null if never.
   *
   * Measured against the moment the sheet opened. The baseline is explicit
   * because the alternative is whatever clock the formatter reaches for, and a
   * sheet left open would then quietly disagree with itself.
   */
  const whenReminded = (
    recipient: RemindRecipient,
    style: "long" | "short" = "long",
  ): string | null =>
    recipient.lastRemindedAt
      ? format.relativeTime(new Date(recipient.lastRemindedAt), {
          now: openedAt,
          style,
        })
      : null;

  /** What the current selection is owed, per currency — the sheet's figure. */
  const chosenTotal = sumByCurrency(
    chosen.flatMap((recipient) => recipient.debts),
  );
  /** What is still to go out — the step-2 header follows the queue down. */
  const queueTotal = sumByCurrency(
    queue.flatMap((recipient) => recipient.debts),
  );

  /**
   * The draft as it reads for one recipient: their debt, the reader's name.
   *
   * This is the editable half. The group link rides along on every reminder —
   * it is what turns a sentence into something the reader can act on — but it
   * is shown as its own chip under the box rather than as text inside it, so
   * that typing past the end of the draft can never push the URL out of view.
   */
  const bodyFor = (recipient: RemindRecipient): string =>
    edited ??
    t(`drafts.${draftKey}` as "drafts.gentle1", {
      name: senderName,
      amount: phrase(recipient.debts),
      group: groupName,
    });

  /** The whole message as it leaves: the draft, then the link. */
  const composeFor = (recipient: RemindRecipient): string => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    return `${bodyFor(recipient)}\n${origin}/groups/${groupId}`;
  };

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
      <div className="animate-in duration-200 fade-in-0 slide-in-from-bottom-1">
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-xl font-semibold tracking-[-0.01em]">
              {t("sheetTitle")}
            </SheetTitle>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {chosen.length === 0
                ? t("sheetSubtitleNone")
                : t("sheetSubtitle", {
                    count: chosen.length,
                    amount: phrase(chosenTotal),
                  })}
            </p>
          </div>
          <CloseButton label={t("close")} onClick={onDone} />
        </div>

        {/* `min-w-0` is not decoration: a fieldset defaults to
            `min-width: min-content`, so without it the rows refuse to shrink
            and a long name pushes the amount off the side of the sheet. */}
        <fieldset className="mb-4 flex min-w-0 flex-col gap-2">
          <legend className="sr-only">{t("recipientsLabel")}</legend>
          {recipients.map((recipient) => {
            const isSelected =
              selected.includes(recipient.participantId) && !recipient.locked;
            const when = whenReminded(recipient);
            return (
              <label
                key={recipient.participantId}
                className={cn(
                  "flex items-center gap-3 rounded-[14px] border p-3 transition-all duration-150",
                  recipient.locked
                    ? "border-border opacity-55"
                    : "cursor-pointer",
                  !recipient.locked &&
                    (isSelected
                      ? PICKED_ROW
                      : "border-border hover:bg-muted/60"),
                )}
              >
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={isSelected}
                  disabled={recipient.locked}
                  onChange={(event) => {
                    // A changed selection changes the amount inside the draft,
                    // so anything typed against the old figure is dropped.
                    setEdited(null);
                    setSelected((ids) =>
                      event.target.checked
                        ? [...ids, recipient.participantId]
                        : ids.filter((id) => id !== recipient.participantId),
                    );
                  }}
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full transition-all duration-150 peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-[inset_0_0_0_1.5px_var(--primary)]"
                      : "text-transparent shadow-[inset_0_0_0_1.5px_var(--input)]",
                  )}
                >
                  <Check className="size-3" strokeWidth={3} />
                </span>

                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">
                    {recipient.name.trim().charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="min-w-[4ch] truncate text-[15px] font-medium">
                    {recipient.name}
                  </span>
                  <RouteBadge
                    recipient={recipient}
                    lockedWhen={whenReminded(recipient, "short")}
                    lockedLabel={when && t("lockedSince", { when })}
                    pushLabel={t("badgePush")}
                    shareLabel={t("badgeShare")}
                    mutedLabel={t("badgeMuted")}
                  />
                </span>

                {/* Stacked, one line per currency: the euros and the yen are
                    two debts to the same person, and there is no rate here to
                    turn them into one figure. */}
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-[15px] font-semibold text-positive">
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

        <Button
          className={CTA}
          disabled={chosen.length === 0}
          onClick={() => setStep("message")}
        >
          {t("writeMessage")}
        </Button>
        <p className="mt-3 text-center text-xs text-balance text-muted-foreground">
          {t("routesNote")}
        </p>
      </div>
    );
  }

  return (
    <div className="animate-in duration-200 fade-in-0 slide-in-from-bottom-1">
      {/* Step two has no heading of its own — the person and the figure are
          the heading. The dialog still needs one, so it is read, not shown. */}
      <SheetTitle className="sr-only">{t("messageTitle")}</SheetTitle>

      <div className="mb-[18px] flex items-center gap-2.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("back")}
          className="size-8 shrink-0 rounded-full text-muted-foreground [&_svg:not([class*='size-'])]:size-[19px]"
          onClick={() => setStep("who")}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>

        <AvatarStack names={queue.map((recipient) => recipient.name)} />

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] text-muted-foreground">
            {t("messageWho", {
              count: queue.length,
              names: format.list(
                queue.map((recipient) => recipient.name),
                { type: "conjunction" },
              ),
              group: groupName,
            })}
          </span>
          <span className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-positive tabular-nums">
            {phrase(queueTotal)}
          </span>
        </div>

        <CloseButton label={t("close")} onClick={onDone} />
      </div>

      <div className="mb-3 flex gap-2" role="group">
        {TONES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => changeTone(option)}
            aria-pressed={tone === option}
            className={cn(
              "h-[38px] flex-1 rounded-xl border text-[13px] font-medium transition-all duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              tone === option ? PICKED_CHIP : UNPICKED,
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
      </div>

      <div className="mb-3.5 rounded-2xl bg-card px-3.5 pt-3.5 pb-2.5 ring-1 ring-[color-mix(in_oklch,var(--foreground)_10%,transparent)]">
        <Textarea
          value={current ? bodyFor(current) : ""}
          aria-label={t("messageLabel")}
          rows={1}
          onChange={(event) => setEdited(event.target.value)}
          className="min-h-[45px] resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 text-[15px] leading-[1.5] shadow-none focus-visible:border-0 focus-visible:ring-0 md:text-[15px] dark:bg-transparent"
        />

        <p className="mt-2.5 flex items-center gap-2 rounded-[10px] bg-muted px-2.5 py-2 text-xs text-muted-foreground">
          <LinkIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="sr-only">{t("groupLink")}</span>
          <span className="truncate">{groupLinkLabel(groupId)}</span>
        </p>

        <div className="-mx-3.5 mt-2 flex justify-end border-t px-2.5 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={shuffle}
            className="h-7 rounded-[10px] px-2.5 text-[13px] font-medium text-primary hover:bg-primary/10 hover:text-primary [&_svg:not([class*='size-'])]:size-3.5"
          >
            <Shuffle aria-hidden="true" />
            {t("shuffle")}
          </Button>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setLogToActivity((on) => !on)}
          aria-pressed={logToActivity}
          className={cn(
            "inline-flex h-8 items-center gap-[7px] rounded-full border px-3 text-[13px] font-medium transition-all duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            logToActivity ? PICKED_CHIP : UNPICKED,
          )}
        >
          <Clock aria-hidden="true" className="size-3.5" />
          {t("logActivity")}
        </button>
      </div>

      {current && (
        <>
          <Button className={CTA} disabled={isPending} onClick={send}>
            {current.channel === "push" ? (
              <Bell aria-hidden="true" />
            ) : (
              <Share2 aria-hidden="true" />
            )}
            {current.channel === "push"
              ? t("sendPush", { name: current.name })
              : t("sendShare", { name: current.name })}
          </Button>
          {/* Whichever route this particular person is on, said plainly. A
              queue may hold both kinds, so the caption follows the recipient
              rather than describing the pair in the abstract. */}
          <p className="mt-3 text-center text-xs text-balance text-muted-foreground">
            {current.channel === "push"
              ? t("sendCaptionPush", { name: current.name })
              : t("sendCaptionShare", { name: current.name })}
          </p>
        </>
      )}
    </div>
  );
}

/** The host, without its scheme: a chip, not an address bar. */
function groupLinkLabel(groupId: string): string {
  const host = typeof window === "undefined" ? "" : window.location.host;
  return `${host}/groups/${groupId}`;
}

function CloseButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      className="size-8 shrink-0 rounded-full text-muted-foreground [&_svg:not([class*='size-'])]:size-[18px]"
      onClick={onClick}
    >
      <X aria-hidden="true" strokeWidth={2} />
    </Button>
  );
}

/**
 * How this person's message would reach them, as a label rather than a line.
 *
 * The old sheet gave every row a sentence underneath. Three of the four said
 * the same thing twice, so the route is now the shortest word that still
 * distinguishes it — and a locked row says when instead, because for that one
 * the route no longer matters today.
 */
function RouteBadge({
  recipient,
  lockedWhen,
  lockedLabel,
  pushLabel,
  shareLabel,
  mutedLabel,
}: {
  recipient: RemindRecipient;
  /** "12 hours ago" — what is shown. */
  lockedWhen: string | null;
  /** "Reminded 12 hours ago" — what is read out. */
  lockedLabel: string | null;
  pushLabel: string;
  shareLabel: string;
  mutedLabel: string;
}) {
  // The one case that has to be readable rather than glanced at: it says when,
  // and "when" is the reason the row cannot be picked. Shown as the time alone
  // under a clock — the row is already dimmed and unpickable, so the word
  // "reminded" is left to the screen reader rather than to the last 60 pixels
  // the name could have had.
  if (recipient.locked) {
    return lockedWhen ? (
      // `shrink` rather than the Badge's own `shrink-0`: French says "il y a 12
      // heures" where English says "12 hours ago", and without it the extra
      // width comes out of the name until there is none left.
      <Badge variant="outline" className="min-w-0 shrink font-normal">
        <Clock aria-hidden="true" />
        <span className="truncate" aria-hidden="true">
          {lockedWhen}
        </span>
        <span className="sr-only">{lockedLabel}</span>
      </Badge>
    ) : null;
  }

  // The route is an icon, not a phrase. Spelled out it cost more width than the
  // name and the amount together, and the footnote under the list already says
  // what the two icons mean — twice on one screen is once too many.
  const [Icon, label, tint] =
    recipient.channel === "push"
      ? ([Bell, pushLabel, "text-positive"] as const)
      : ([
          Share2,
          recipient.muted ? mutedLabel : shareLabel,
          "text-muted-foreground",
        ] as const);

  return (
    <span className={cn("shrink-0", tint)}>
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Up to three initials, overlapped, then a count.
 *
 * One recipient is one avatar and reads as a portrait; several are a group,
 * and a single initial standing for all of them would name the wrong person.
 */
function AvatarStack({ names }: { names: readonly string[] }) {
  if (names.length === 0) return null;
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;

  return (
    <div className="flex shrink-0 -space-x-2">
      {shown.map((name, index) => (
        <Avatar
          key={`${name}-${index}`}
          className={cn(
            "ring-2 ring-background",
            names.length === 1 ? "size-11" : "size-9",
          )}
        >
          <AvatarFallback
            className={cn(
              "bg-accent font-semibold text-accent-foreground",
              names.length === 1 ? "text-[15px]" : "text-xs",
            )}
          >
            {name.trim().charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ))}
      {rest > 0 && (
        <Avatar className="size-9 ring-2 ring-background">
          <AvatarFallback className="bg-muted text-xs font-semibold text-muted-foreground">
            +{rest}
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
