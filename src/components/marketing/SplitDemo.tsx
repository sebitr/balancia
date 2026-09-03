"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Copy } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { INSTALL_COMMANDS } from "./install-commands";
import {
  computeBalances,
  simplifyDebts,
  type BalanceInputExpense,
} from "@/modules/balances/engine";
import {
  resolveSplit,
  type SplitInputEntry,
  type SplitMethod,
} from "@/modules/expenses/split";

type PersonId = "sam" | "mina" | "theo" | "ada";
type DemoMode = "equal" | "shares" | "percentage";

const PERSON_IDS: readonly PersonId[] = ["sam", "mina", "theo", "ada"];

const PERSON_INITIALS: Record<PersonId, string> = {
  sam: "SM",
  mina: "MI",
  theo: "TH",
  ada: "AD",
};

const SHARE_WEIGHTS: Record<PersonId, string> = {
  sam: "3",
  mina: "2",
  theo: "2",
  ada: "1",
};

const PERCENT_WEIGHTS: Record<PersonId, string> = {
  sam: "40",
  mina: "25",
  theo: "25",
  ada: "10",
};

const PRIOR_EXPENSES = [
  { id: "prior-mina", payer: "mina" as const, amount: 42_000n },
  { id: "prior-ada", payer: "ada" as const, amount: 6_340n },
  { id: "prior-theo", payer: "theo" as const, amount: 2_800n },
] as const;

const CURRENCY = "EUR";
const MONEY_LOCALE = "en-IE";

function parseAmount(text: string): bigint {
  const match = /^(\d+)(?:[.,](\d{0,2}))?$/.exec(text.trim());
  if (!match) return 0n;
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return whole * 100n + fraction;
}

function formatMoney(amount: bigint): string {
  return new Intl.NumberFormat(MONEY_LOCALE, {
    style: "currency",
    currency: CURRENCY,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount) / 100);
}

function entriesFor(mode: DemoMode): SplitInputEntry[] {
  return PERSON_IDS.map((participantId) => {
    if (mode === "equal") return { participantId };
    return {
      participantId,
      value:
        mode === "shares"
          ? SHARE_WEIGHTS[participantId]
          : PERCENT_WEIGHTS[participantId],
    };
  });
}

function equalSplit(amount: bigint) {
  return resolveSplit(amount, {
    method: "equal",
    entries: PERSON_IDS.map((participantId) => ({ participantId })),
  }).allocations;
}

export function SplitDemo() {
  const t = useTranslations("marketing.demo");
  const locale = useLocale();
  const [amountText, setAmountText] = useState("84.60");
  const [payer, setPayer] = useState<PersonId>("sam");
  const [mode, setMode] = useState<DemoMode>("equal");

  const people = PERSON_IDS.map((id) => ({
    id,
    name: t(`people.${id}.name`),
    initials: PERSON_INITIALS[id],
  }));
  const namesById = Object.fromEntries(
    people.map((person) => [person.id, person.name]),
  ) as Record<PersonId, string>;

  const liveAmount = parseAmount(amountText);
  const method: SplitMethod = mode;
  const liveAllocations = resolveSplit(liveAmount, {
    method,
    entries: entriesFor(mode),
  }).allocations;
  const liveAllocationById = Object.fromEntries(
    liveAllocations.map((allocation) => [
      allocation.participantId,
      allocation.amount,
    ]),
  ) as Record<PersonId, bigint>;

  const expenses: BalanceInputExpense[] = PRIOR_EXPENSES.map((expense) => ({
    id: expense.id,
    currency: CURRENCY,
    payers: [{ participantId: expense.payer, amount: expense.amount }],
    shares: equalSplit(expense.amount),
  }));
  expenses.push({
    id: "live",
    currency: CURRENCY,
    payers: [{ participantId: payer, amount: liveAmount }],
    shares: liveAllocations,
  });

  const currencyBalances = computeBalances({
    participantIds: PERSON_IDS,
    expenses,
    settlements: [],
  })[0];
  const netById = Object.fromEntries(
    (currencyBalances?.balances ?? []).map((balance) => [
      balance.participantId,
      balance.amount,
    ]),
  ) as Record<PersonId, bigint>;
  const paidById = Object.fromEntries(
    PERSON_IDS.map((personId) => [personId, 0n]),
  ) as Record<PersonId, bigint>;
  for (const expense of PRIOR_EXPENSES) {
    paidById[expense.payer] += expense.amount;
  }
  paidById[payer] += liveAmount;

  const transfers = simplifyDebts(currencyBalances?.balances ?? []).slice(0, 5);
  const totalSpent =
    PRIOR_EXPENSES.reduce((sum, expense) => sum + expense.amount, 0n) +
    liveAmount;

  let splitNote: string;
  if (liveAmount === 0n) {
    splitNote = t("splitNotes.empty");
  } else if (mode === "equal") {
    const remainder = Number(liveAmount % BigInt(PERSON_IDS.length));
    if (remainder === 0) {
      splitNote = t("splitNotes.equalExact", {
        total: formatMoney(liveAmount),
        share: formatMoney(liveAmount / BigInt(PERSON_IDS.length)),
      });
    } else {
      const extraNames = PERSON_IDS.slice(0, remainder).map(
        (personId) => namesById[personId],
      );
      splitNote = t("splitNotes.equalRemainder", {
        total: formatMoney(liveAmount),
        count: remainder,
        names: new Intl.ListFormat(locale, {
          style: "long",
          type: "conjunction",
        }).format(extraNames),
      });
    }
  } else if (mode === "shares") {
    splitNote = t("splitNotes.shares", {
      allocations: PERSON_IDS.map((personId) =>
        formatMoney(liveAllocationById[personId]),
      ).join(" · "),
    });
  } else {
    splitNote = t("splitNotes.percentage", {
      allocations: PERSON_IDS.map((personId) =>
        formatMoney(liveAllocationById[personId]),
      ).join(" · "),
    });
  }

  return (
    <div className="overflow-hidden rounded-3xl bg-card text-card-foreground shadow-[0_30px_70px_-24px_oklch(0.12_0.05_319_/_0.65),0_0_0_1px_oklch(1_0_0_/_0.08)]">
      <div className="flex items-center justify-between gap-3 border-b px-[18px] py-4">
        <div>
          <p className="text-[15px] font-semibold">{t("groupName")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("groupMeta", { count: people.length, currency: CURRENCY })}
          </p>
        </div>
        <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-primary/14 px-2.5 text-[11px] font-semibold tracking-[0.04em] text-marketing-label uppercase">
          <span className="marketing-pulse-fast size-[5px] rounded-full bg-marketing-link" />
          {t("live")}
        </span>
      </div>

      <div className="p-[18px]">
        <div className="flex items-baseline justify-between gap-2.5">
          <label
            htmlFor="marketing-demo-amount"
            className="text-[13px] font-medium"
          >
            {t("expenseName")}
          </label>
          <span className="text-xs text-muted-foreground">
            {t("changeHint")}
          </span>
        </div>
        <div className="mt-2.5 flex items-center gap-2.5 rounded-[14px] border border-input px-3.5 py-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
          <span className="text-[26px] font-medium text-muted-foreground">
            €
          </span>
          <input
            id="marketing-demo-amount"
            type="text"
            inputMode="decimal"
            value={amountText}
            onChange={(event) =>
              setAmountText(event.target.value.replace(/[^0-9.,]/g, ""))
            }
            aria-label={t("amountAriaLabel")}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[30px] font-semibold tracking-[-0.02em] text-foreground tabular-nums outline-none"
          />
        </div>

        <p className="mt-4 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {t("paidBy")}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {people.map((person) => {
            const selected = payer === person.id;
            return (
              <button
                key={person.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setPayer(person.id)}
                className={cn(
                  "h-8 rounded-full border px-[13px] text-[13px] font-medium transition-all duration-150 motion-reduce:transition-none",
                  selected
                    ? "border-transparent bg-foreground text-background"
                    : "border-input bg-transparent text-foreground hover:bg-muted/60",
                )}
              >
                {person.name}
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {t("split")}
        </p>
        <div
          role="tablist"
          aria-label={t("splitModeAriaLabel")}
          className="mt-2 flex gap-1.5 rounded-xl bg-muted p-1"
        >
          {(["equal", "shares", "percentage"] as const).map((tab) => {
            const selected = mode === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setMode(tab)}
                className={cn(
                  "h-8 flex-1 rounded-[9px] border border-transparent text-[13px] font-medium transition-all duration-150 motion-reduce:transition-none",
                  selected
                    ? "bg-card text-foreground shadow-[0_1px_3px_oklch(0.226_0.072_319_/_0.12)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`modes.${tab}`)}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[12.5px] leading-6 text-pretty text-muted-foreground">
          {splitNote}
        </p>
      </div>

      <div className="border-t">
        <div className="flex items-baseline justify-between gap-3 px-[18px] py-3.5">
          <p className="text-[13px] font-semibold">{t("balancesTitle")}</p>
          <p className="text-xs text-muted-foreground">
            {t("totalSpent", { amount: formatMoney(totalSpent) })}
          </p>
        </div>
        <div>
          {people.map((person, index) => {
            const net = netById[person.id] ?? 0n;
            const positive = net > 0n;
            const negative = net < 0n;
            return (
              <div
                key={person.id}
                className={cn(
                  "flex items-center gap-2.5 px-[18px] py-3",
                  index > 0 && "border-t border-marketing-row",
                )}
              >
                <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
                  {person.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{person.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("paidAmount", {
                      amount: formatMoney(paidById[person.id]),
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={cn(
                      "inline-flex items-center gap-1 text-[15px] font-semibold tabular-nums",
                      positive && "text-positive-ink",
                      negative && "text-negative-ink",
                      !positive && !negative && "text-neutral-balance-ink",
                    )}
                  >
                    {positive && (
                      <ArrowUpRight aria-hidden="true" className="size-3.5" />
                    )}
                    {negative && (
                      <ArrowDownLeft aria-hidden="true" className="size-3.5" />
                    )}
                    {formatMoney(net < 0n ? -net : net)}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-[11.5px]",
                      positive && "text-positive-ink",
                      negative && "text-negative-ink",
                      !positive && !negative && "text-muted-foreground",
                    )}
                  >
                    {positive
                      ? t("getsBack")
                      : negative
                        ? t("owes")
                        : t("settledUp")}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t bg-marketing-soft px-[18px] py-3.5">
        <p className="text-[13px] font-semibold">
          {transfers.length > 0
            ? t("settledIn", { count: transfers.length })
            : t("everyoneSettled")}
        </p>
        {transfers.length > 0 && (
          <ul className="mt-2 space-y-1.5 text-[13.5px] text-muted-foreground">
            {transfers.map((transfer) => (
              <li
                key={`${transfer.fromParticipantId}-${transfer.toParticipantId}`}
              >
                {t("transfer", {
                  from: namesById[transfer.fromParticipantId as PersonId],
                  to: namesById[transfer.toParticipantId as PersonId],
                  amount: formatMoney(transfer.amount),
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The install card is otherwise server-rendered; only clipboard feedback hydrates. */
export function InstallCopyButton() {
  const t = useTranslations("marketing.selfHosting.install");
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const copy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard
        .writeText(INSTALL_COMMANDS.join("\n"))
        .catch(() => undefined);
    }
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/18 px-2.5 text-xs font-medium text-marketing-cream transition-colors hover:bg-white/8"
    >
      {copied ? (
        <Check aria-hidden="true" className="size-3.5" />
      ) : (
        <Copy aria-hidden="true" className="size-3.5" />
      )}
      {copied ? t("copied") : t("copy")}
    </button>
  );
}
