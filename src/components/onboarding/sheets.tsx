"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ImageDecodeError,
  squareToWebp,
} from "@/components/settings/square-image";
import { setDisplayNameAction } from "@/modules/profile/actions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  openOnContent,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BalanceAmount } from "@/components/money/amount";
import { NotificationPreferencesForm } from "@/components/notifications/notification-preferences-form";
import { usePushSubscription } from "@/components/notifications/use-push-subscription";
import { initialsOf } from "@/components/join/types";
import { currencyCatalogue } from "@/modules/currencies/catalog";
import {
  PayoutMethodsForm,
  type PayoutEntry,
} from "@/components/payouts/payout-methods-form";
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
          checked ? "text-primary-ink" : "text-transparent",
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

/**
 * How should people pay you back.
 *
 * The rows, the fields and the writing are all `PayoutMethodsForm`, which the
 * money settings screen renders too — one list, one validator, one place where
 * an IBAN's checksum is checked. What this adds is the sheet around it.
 *
 * Confirmations are silenced here. A toast raised under an open sheet is
 * painted behind it and its Undo takes no taps, so the sheet's own dismissal
 * is the confirmation instead.
 */
export function PayoutsSheet({
  open,
  onOpenChange,
  entries,
  onChange,
  persist,
  title,
  description,
  doneLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: readonly PayoutEntry[];
  onChange: (entries: readonly PayoutEntry[]) => void;
  /** False for a guest: there is no account to store a bank account on. */
  persist: boolean;
  title?: string;
  description?: string;
  doneLabel?: string;
}) {
  const t = useTranslations("payouts");
  const tSheet = useTranslations("onboarding.sheets.payouts");

  return (
    <SheetShell
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? t("title")}
      description={description ?? t("sub")}
      footer={
        <Button size="lg" className={DONE} onClick={() => onOpenChange(false)}>
          {doneLabel ?? tSheet("done")}
        </Button>
      }
    >
      <div className="flex max-h-80 flex-col overflow-y-auto">
        <PayoutMethodsForm
          initial={entries}
          onChange={onChange}
          persist={persist}
          confirmations="silent"
        />
      </div>
    </SheetShell>
  );
}

/**
 * Somebody wants to settle up, and needs to be told how.
 *
 * This is the argument for asking about payout details here rather than in
 * onboarding: the detail gets entered because there is money on the table, by
 * somebody who wants it. What is saved is the reader's own list, which is why
 * it ticks the checklist's payout row too — it is the same answer to the same
 * question, asked at the moment it pays off.
 */
export function SettleUpSheet({
  open,
  onOpenChange,
  request,
  entries,
  onChange,
  persist,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: SettleRequestView;
  entries: readonly PayoutEntry[];
  onChange: (entries: readonly PayoutEntry[]) => void;
  persist: boolean;
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

        <div className="flex max-h-70 flex-col overflow-y-auto">
          <PayoutMethodsForm
            initial={entries}
            onChange={onChange}
            persist={persist}
            confirmations="silent"
          />
        </div>

        <Button size="lg" className={DONE} onClick={() => onOpenChange(false)}>
          {t("save", { name: request.name })}
        </Button>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Name and photo, from the checklist.
 *
 * The row used to be the one on the list that opened nothing: a photo could
 * only be added from the profile page, which the list never mentioned. This is
 * the profile screen's circle and field again, in a sheet — the photo uploads
 * on pick, the name saves on Done, and the row's receipt follows both.
 */
export function ProfileSheet({
  open,
  onOpenChange,
  name,
  onNameChange,
  onPhotoChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  /** Called with the saved name, once the sheet has written it. */
  onNameChange: (name: string) => void;
  /** Called once a photo is on the account. */
  onPhotoChange: () => void;
}) {
  const t = useTranslations("onboarding.sheets.profile");
  const tSettings = useTranslations("userSettings");
  const tProfile = useTranslations("onboarding.profile");
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(name);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmed = draft.trim();

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", await squareToWebp(file), "avatar.webp");
      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        body,
      });
      if (!response.ok) {
        toast.error(tSettings("photoFailed"));
        return;
      }
      setPhoto(URL.createObjectURL(file));
      onPhotoChange();
    } catch (uploadError) {
      toast.error(
        uploadError instanceof ImageDecodeError
          ? tSettings("photoUnreadable")
          : tSettings("photoFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const done = async () => {
    if (trimmed.length > 0 && trimmed !== name) {
      setBusy(true);
      const result = await setDisplayNameAction(trimmed);
      setBusy(false);
      if (!result.ok) {
        toast.error(result.error ?? tProfile("nameFailed"));
        return;
      }
      onNameChange(trimmed);
    }
    onOpenChange(false);
  };

  return (
    <SheetShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("sub")}
      footer={
        <Button
          size="lg"
          className={DONE}
          disabled={busy || trimmed.length === 0}
          onClick={() => void done()}
        >
          {busy && (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          )}
          {t("done")}
        </Button>
      }
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            aria-label={tProfile("photoAdd")}
            className="flex size-19 items-center justify-center overflow-hidden rounded-full bg-accent text-xl font-semibold text-accent-foreground disabled:opacity-60"
          >
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" className="size-full object-cover" />
            ) : (
              initialsOf(trimmed || "?")
            )}
          </button>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-0 bottom-0 flex size-7 items-center justify-center rounded-full bg-primary ring-[3px] ring-background"
          >
            <Camera className="size-3.5 text-primary-foreground" />
          </span>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <Label className="sr-only" htmlFor="checklist-name">
            {t("nameLabel")}
          </Label>
          <Input
            id="checklist-name"
            className="h-14 rounded-xl"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="name"
            maxLength={120}
            disabled={busy}
          />
        </div>
      </div>
    </SheetShell>
  );
}

export type { PayoutEntry };
export { ChoiceRow, DONE, SheetShell };
