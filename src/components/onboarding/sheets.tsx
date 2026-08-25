"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  openOnContent,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BalanceAmount } from "@/components/money/amount";
import { NotificationPreferencesForm } from "@/components/notifications/notification-preferences-form";
import { usePushSubscription } from "@/components/notifications/use-push-subscription";
import { initialsOf } from "@/components/join/types";
import { currencyCatalogue } from "@/modules/currencies/catalog";
import {
  PAYMENT_METHOD_MAX_LENGTH,
  countryForTimezone,
  findPaymentMethod,
  methodsForCountry,
  type PaymentMethodId,
} from "@/modules/settlements/payment-methods";
import {
  setFavoriteCurrenciesAction,
  setPreferredCurrencyAction,
} from "@/modules/profile/actions";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import type { SettleRequestView } from "./types";

/**
 * The four sheets the checklist opens, and the one the settle-up row does.
 *
 * All of them use `SheetContent side="bottom"` rather than rebuilding its
 * chrome: the grabber, the blurred overlay, drag-to-dismiss and the keyboard
 * inset are already there, and so is `openOnContent`, which is what stops a
 * sheet opening with the keyboard already up and its first field focused.
 *
 * Two rules run through all of them:
 *
 *  - **Settings write on tap.** There is no Save button anywhere in Balancia's
 *    settings, so the primary here only dismisses — which is why it says
 *    "Done" and counts what was chosen, rather than saying "Save".
 *  - **A tick, not a radio dot.** A 16px dot inside a 44px row is not what a
 *    thumb aims at. The tick's slot is always occupied and only its colour
 *    changes, so labels never shift as the selection moves.
 */

/** 54px, matching the flow's primaries. */
const DONE = "h-[3.375rem] w-full text-base";

/**
 * The payout methods to offer, most likely first.
 *
 * Taken from the phone's own timezone, which is the best country signal
 * available before anybody has been asked anything — better than the currency,
 * which says nothing at all (EUR spans twenty countries), and better than one
 * more question on a form. An unrecognised zone falls back to the dull list
 * that works anywhere rather than to nothing.
 */
function useRegionalMethods(): readonly PaymentMethodId[] {
  return useMemo(() => {
    const timezone =
      typeof Intl === "undefined"
        ? null
        : Intl.DateTimeFormat().resolvedOptions().timeZone;
    return methodsForCountry(countryForTimezone(timezone));
  }, []);
}

/** A row that can be ticked. At least 44px, tick on the right. */
function ChoiceRow({
  checked,
  onToggle,
  children,
  disabled = false,
}: {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        checked ? "bg-primary/6" : "hover:bg-muted",
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <Check
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0 transition-colors",
          checked ? "text-primary" : "text-transparent",
        )}
      />
    </button>
  );
}

function SheetShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" onOpenAutoFocus={openOnContent}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {children}
        {footer}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Which currencies do you spend in.
 *
 * Multi-select, and the first one picked is the default the dashboard totals
 * in — which is why the order is kept rather than sorted. Both halves are
 * already columns on the account: the set is `favorite_currencies`, the first
 * is `preferred_currency`.
 *
 * A guest has no account to write either to, so their choice lives as long as
 * the visit does — the same bargain everything else a guest does makes.
 */
export function CurrenciesSheet({
  open,
  onOpenChange,
  chosen,
  onChange,
  suggested,
  persist,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chosen: readonly string[];
  onChange: (codes: readonly string[]) => void;
  /** The group's own currencies, and whatever the phone's locale suggests. */
  suggested: readonly string[];
  persist: boolean;
}) {
  const t = useTranslations("onboarding.sheets.currencies");
  const locale = useLocale();
  const catalogue = useMemo(() => currencyCatalogue(locale), [locale]);
  const detected = suggested[0] ?? null;

  const rows = useMemo(() => {
    const codes = new Set([...suggested, ...chosen]);
    // A short list, not the whole catalogue: this is a first guess to confirm,
    // and the full picker is a tap away from every field that takes a currency.
    for (const code of ["EUR", "CHF", "USD", "GBP"]) codes.add(code);
    return [...codes]
      .map((code) => catalogue.find((entry) => entry.code === code))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }, [catalogue, chosen, suggested]);

  const toggle = (code: string) => {
    const next = chosen.includes(code)
      ? chosen.filter((candidate) => candidate !== code)
      : [...chosen, code];
    onChange(next);
    if (!persist) return;
    // Fire and forget, exactly as the star in the picker does: the tick has
    // already landed on screen, and the worst case is a favourite that does
    // not follow the reader to their next device.
    void setFavoriteCurrenciesAction(next);
    void setPreferredCurrencyAction(next[0] ?? "");
  };

  return (
    <SheetShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("sub")}
      footer={
        <Button size="lg" className={DONE} onClick={() => onOpenChange(false)}>
          {chosen.length > 0
            ? t("doneCount", { count: chosen.length })
            : t("done")}
        </Button>
      }
    >
      <div className="flex max-h-70 flex-col overflow-y-auto">
        {rows.map((entry) => (
          <ChoiceRow
            key={entry.code}
            checked={chosen.includes(entry.code)}
            onToggle={() => toggle(entry.code)}
          >
            <span className="flex items-baseline gap-3">
              <span className="w-9 shrink-0 text-xs font-semibold tabular-nums">
                {entry.code}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {entry.name}
              </span>
              {entry.code === detected && (
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {t("detected")}
                </span>
              )}
            </span>
          </ChoiceRow>
        ))}
      </div>
    </SheetShell>
  );
}

/**
 * Know when it actually matters.
 *
 * The five switches are the account's, and they are the same form the settings
 * screen shows — imported rather than redrawn, so a category added there
 * appears here without anybody remembering to.
 *
 * Push is underneath and apart, in its own card, because it is *delivery* and
 * not subscription: everything above still arrives in the app whether or not
 * this device is subscribed. So the rows are never dimmed by it, and the
 * switch speaks only for the browser it is being looked at in.
 */
export function NotificationsSheet({
  open,
  onOpenChange,
  onPushChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPushChange: (enabled: boolean) => void;
}) {
  const t = useTranslations("onboarding.sheets.notifications");
  const tSettings = useTranslations("notificationSettings");
  const { status, busy, enable, disable } = usePushSubscription();
  const on = status === "on";

  const flip = async (next: boolean) => {
    const ok = next ? await enable() : await disable();
    if (ok) onPushChange(next);
  };

  const unavailable =
    status === "unsupported" ||
    status === "blocked" ||
    status === "unavailable" ||
    status === "installFirst";

  return (
    <SheetShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("sub")}
      footer={
        <Button size="lg" className={DONE} onClick={() => onOpenChange(false)}>
          {t("done")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <NotificationPreferencesForm
          defaultValue={{
            expenses: true,
            settlements: true,
            recurring: true,
            imports: true,
            reminders: true,
          }}
        />

        <div className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm font-medium">{t("pushTitle")}</span>
            <span className="text-xs text-pretty text-muted-foreground">
              {unavailable ? tSettings("pushUnsupported") : t("pushNote")}
            </span>
          </div>
          <Switch
            checked={on}
            disabled={busy || unavailable}
            aria-label={t("pushTitle")}
            onCheckedChange={(next) => void flip(next)}
          />
        </div>
      </div>
    </SheetShell>
  );
}

interface PayoutEntry {
  readonly method: PaymentMethodId;
  readonly value: string;
}

/**
 * How should people pay you back.
 *
 * Multi-select, each ticked method opening the one field it needs. The order
 * is the order they were ticked, because whoever owes money sees the top one
 * first.
 *
 * **These do not persist.** Payout details are not in the schema — there is no
 * table, no validation and no API for them yet — so what this sheet holds
 * lives for the length of the flow and is shown back on the checklist. It is
 * built now because the settle-up sheet is the argument for collecting them at
 * all, and that argument is not visible without it.
 */
export function PayoutsSheet({
  open,
  onOpenChange,
  entries,
  onChange,
  title,
  description,
  doneLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: readonly PayoutEntry[];
  onChange: (entries: readonly PayoutEntry[]) => void;
  title?: string;
  description?: string;
  doneLabel?: string;
}) {
  const t = useTranslations("onboarding.sheets.payouts");
  const tMethods = useTranslations("paymentMethods");
  const methods = useRegionalMethods();

  const toggle = (method: PaymentMethodId) => {
    onChange(
      entries.some((entry) => entry.method === method)
        ? entries.filter((entry) => entry.method !== method)
        : [...entries, { method, value: "" }],
    );
  };

  const setValue = (method: PaymentMethodId, value: string) => {
    onChange(
      entries.map((entry) =>
        entry.method === method ? { ...entry, value } : entry,
      ),
    );
  };

  return (
    <SheetShell
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? t("title")}
      description={description ?? t("sub")}
      footer={
        <Button size="lg" className={DONE} onClick={() => onOpenChange(false)}>
          {doneLabel ?? t("done")}
        </Button>
      }
    >
      <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
        {methods.map((id) => {
          const method = findPaymentMethod(id);
          if (!method) return null;
          const entry = entries.find((candidate) => candidate.method === id);
          const label = tMethods(id as Parameters<typeof tMethods>[0]);

          return (
            <div key={id} className="flex flex-col">
              <ChoiceRow checked={Boolean(entry)} onToggle={() => toggle(id)}>
                <span className="text-sm">{label}</span>
              </ChoiceRow>
              {entry && method.kind !== "cash" && (
                <div className="px-3 pb-2">
                  <Label className="sr-only" htmlFor={`payout-${id}`}>
                    {label}
                  </Label>
                  <Input
                    id={`payout-${id}`}
                    className="h-11"
                    value={entry.value}
                    maxLength={PAYMENT_METHOD_MAX_LENGTH}
                    placeholder={t("detail")}
                    onChange={(event) => setValue(id, event.target.value)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SheetShell>
  );
}

/**
 * Somebody wants to settle up, and needs to be told how.
 *
 * This is the argument for asking about payout details here rather than in
 * onboarding: the detail gets entered because there is money on the table, by
 * somebody who wants it. Choosing here ticks the checklist's payout row too,
 * because it is the same answer to the same question.
 */
export function SettleUpSheet({
  open,
  onOpenChange,
  request,
  entries,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: SettleRequestView;
  entries: readonly PayoutEntry[];
  onChange: (entries: readonly PayoutEntry[]) => void;
}) {
  const t = useTranslations("onboarding.sheets.settleUp");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" onOpenAutoFocus={openOnContent}>
        <SheetHeader>
          <div className="flex items-center gap-3">
            <Avatar size="lg">
              <AvatarFallback className="bg-accent text-sm text-accent-foreground">
                {initialsOf(request.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-0.5">
              <SheetTitle>{t("title", { name: request.name })}</SheetTitle>
              <BalanceAmount
                minorUnits={request.amount.minorUnits}
                currency={request.amount.currency}
                size="small"
              />
            </div>
          </div>
          <SheetDescription>
            {t("sub", { name: request.name })}
          </SheetDescription>
        </SheetHeader>

        <PayoutsInline entries={entries} onChange={onChange} />

        <Button size="lg" className={DONE} onClick={() => onOpenChange(false)}>
          {t("save", { name: request.name })}
        </Button>
      </SheetContent>
    </Sheet>
  );
}

/** The method rows again, without a sheet of their own around them. */
function PayoutsInline({
  entries,
  onChange,
}: {
  entries: readonly PayoutEntry[];
  onChange: (entries: readonly PayoutEntry[]) => void;
}) {
  const t = useTranslations("onboarding.sheets.payouts");
  const tMethods = useTranslations("paymentMethods");
  // Three, not the whole list: this sheet is answering one person's question
  // about one payment, not setting up a profile.
  const methods = useRegionalMethods().slice(0, 3);

  return (
    <div className="flex flex-col gap-1">
      {methods.map((id) => {
        const method = findPaymentMethod(id);
        if (!method) return null;
        const entry = entries.find((candidate) => candidate.method === id);
        const label = tMethods(id as Parameters<typeof tMethods>[0]);

        return (
          <div key={id} className="flex flex-col">
            <ChoiceRow
              checked={Boolean(entry)}
              onToggle={() =>
                onChange(
                  entry
                    ? entries.filter((candidate) => candidate.method !== id)
                    : [...entries, { method: id, value: "" }],
                )
              }
            >
              <span className="text-sm">{label}</span>
            </ChoiceRow>
            {entry && method.kind !== "cash" && (
              <div className="px-3 pb-2">
                <Label className="sr-only" htmlFor={`settle-${id}`}>
                  {label}
                </Label>
                <Input
                  id={`settle-${id}`}
                  className="h-11"
                  value={entry.value}
                  maxLength={PAYMENT_METHOD_MAX_LENGTH}
                  placeholder={t("detail")}
                  onChange={(event) =>
                    onChange(
                      entries.map((candidate) =>
                        candidate.method === id
                          ? { ...candidate, value: event.target.value }
                          : candidate,
                      ),
                    )
                  }
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export type { PayoutEntry };
export { ChoiceRow, DONE, SheetShell };
