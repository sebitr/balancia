"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Check, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BalanceAmount } from "@/components/money/amount";
import {
  startCodeSignupAction,
  verifySignupCodeAction,
} from "@/modules/auth/actions";
import { CODE_LENGTH } from "@/modules/auth/code-format";
import { initialsOf } from "@/components/join/types";
import { cn } from "@/lib/utils";
import { CodeInput } from "./code-input";
import {
  checklistProgress,
  checklistRows,
  type ChecklistMarker,
  type ChecklistSheet,
} from "./checklist";
import {
  CurrenciesSheet,
  NotificationsSheet,
  PayoutsSheet,
  SettleUpSheet,
  SheetShell,
  DONE,
  type PayoutEntry,
} from "./sheets";
import { PRIMARY } from "./screens";
import type { OnboardingGroupView } from "./types";

/**
 * The group, and what is left to set up.
 *
 * This is where the nine-screen questionnaire went. Everything it used to ask
 * before the door — currencies, notation, notifications, payout details — is
 * on this list instead, *behind* the balance rather than in front of it, and
 * every row of it is skippable. The list is a standalone screen shown once at
 * the end of the flow rather than a permanent fixture of the group page, which
 * already carries the position, the balances, the settlements and the activity.
 *
 * One row can be urgent, and only one ever is: a guest's unclaimed account,
 * which is the single item here that is lost by closing the browser. It is
 * drawn as a hollow ring with an arrow rather than a coral check — a filled
 * check would read as complete-and-important, and in greyscale would be
 * indistinguishable from done.
 */
export function ChecklistScreen({
  group,
  isGuest,
  credential,
  email,
  name,
  onLeave,
}: {
  group: OnboardingGroupView | null;
  isGuest: boolean;
  credential: "passkey" | "code" | null;
  email: string;
  name: string;
  onLeave: () => void;
}) {
  const t = useTranslations("onboarding.checklist");

  const [open, setOpen] = useState<ChecklistSheet | null>(null);
  const [settling, setSettling] = useState(false);
  const [currencies, setCurrencies] = useState<readonly string[]>([]);
  const [payouts, setPayouts] = useState<readonly PayoutEntry[]>([]);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [claimedEmail, setClaimedEmail] = useState(email);

  const guest = isGuest && !claimed;
  const tMethods = useTranslations("paymentMethods");

  const rows = checklistRows({
    isGuest: guest,
    credential: claimed ? "code" : credential,
    email: claimedEmail || email || null,
    hasPhoto: false,
    name,
    currencies,
    payouts: payouts.map((entry) =>
      tMethods(entry.method as Parameters<typeof tMethods>[0]),
    ),
    notificationsOn: 5,
    notificationCount: 5,
    pushEnabled,
  });
  const progress = checklistProgress(rows);

  return (
    <div className="flex flex-1 flex-col gap-4">
      {group && (
        <div className="flex items-center gap-3">
          <h1 className="min-w-0 flex-1 truncate font-heading text-xl font-semibold tracking-[-0.02em]">
            {group.summary.groupName}
          </h1>
          {guest && <Badge variant="secondary">{t("guestBadge")}</Badge>}
          <Avatar>
            <AvatarFallback className="bg-accent text-xs text-accent-foreground">
              {initialsOf(name || "?")}
            </AvatarFallback>
          </Avatar>
        </div>
      )}

      {group?.position && (
        <div className="flex flex-col gap-1 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <span className="text-xs text-muted-foreground">{t("position")}</span>
          <BalanceAmount
            minorUnits={group.position.minorUnits}
            currency={group.position.currency}
            size="large"
          />
        </div>
      )}

      {group?.settleRequest && (
        <button
          type="button"
          onClick={() => setSettling(true)}
          aria-label={`${t("settleTitle", { name: group.settleRequest.name })} — ${t("settleNote")}`}
          className="flex min-h-14 items-center gap-3 rounded-xl bg-primary/6 px-4 py-3 text-left transition-colors hover:bg-primary/10"
        >
          <Avatar>
            <AvatarFallback className="bg-accent text-xs text-accent-foreground">
              {initialsOf(group.settleRequest.name)}
            </AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">
              {t("settleTitle", { name: group.settleRequest.name })}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("settleNote")}
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </button>
      )}

      <section className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-2xs font-semibold tracking-[0.07em] text-muted-foreground uppercase">
              {t("title")}
            </h2>
            <span className="text-2xs font-semibold text-primary">
              {t("count", { done: progress.done, total: progress.total })}
            </span>
          </div>
          <div
            className="h-1 overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-label={t("title")}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </div>

        <ul className="-mx-1 flex flex-col divide-y divide-border">
          {rows.map((row) => {
            const label = t(row.labelKey as Parameters<typeof t>[0]);
            const note = t(
              row.noteKey as Parameters<typeof t>[0],
              row.noteValues,
            );
            const content = (
              <>
                <Marker marker={row.marker} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{label}</span>
                  <span className="truncate text-2xs text-muted-foreground">
                    {note}
                  </span>
                </span>
                {row.sheet && (
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                )}
              </>
            );

            return (
              <li key={row.id}>
                {row.sheet ? (
                  <button
                    type="button"
                    onClick={() => setOpen(row.sheet)}
                    aria-label={`${label} — ${note}`}
                    className="flex min-h-14 w-full items-center gap-3 px-1 py-2.5 text-left"
                  >
                    {content}
                  </button>
                ) : (
                  // A finished row opens nothing, so it is not a control.
                  <div className="flex min-h-14 w-full items-center gap-3 px-1 py-2.5">
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex-1" />

      <Button size="lg" className={PRIMARY} onClick={onLeave}>
        {t("continue")}
        <ArrowRight aria-hidden="true" className="size-4" />
      </Button>

      <CurrenciesSheet
        open={open === "currencies"}
        onOpenChange={(next) => setOpen(next ? "currencies" : null)}
        chosen={currencies}
        onChange={setCurrencies}
        suggested={(group?.summary.totals ?? []).map((total) => total.currency)}
        persist={!guest}
      />

      <NotificationsSheet
        open={open === "notifications"}
        onOpenChange={(next) => setOpen(next ? "notifications" : null)}
        onPushChange={setPushEnabled}
      />

      <PayoutsSheet
        open={open === "payouts"}
        onOpenChange={(next) => setOpen(next ? "payouts" : null)}
        entries={payouts}
        onChange={setPayouts}
      />

      {group?.settleRequest && (
        <SettleUpSheet
          open={settling}
          onOpenChange={setSettling}
          request={group.settleRequest}
          entries={payouts}
          onChange={setPayouts}
        />
      )}

      <ClaimAccountSheet
        open={open === "claimAccount"}
        onOpenChange={(next) => setOpen(next ? "claimAccount" : null)}
        name={name}
        onClaimed={(address) => {
          setClaimed(true);
          setClaimedEmail(address);
          setOpen(null);
        }}
      />
    </div>
  );
}

/**
 * The three states, told apart by their glyph and not only by their colour.
 *
 * Principle 01 of the design system: colour is never the only carrier. Done is
 * a filled circle with a check in it, not-done is a pale circle with a check
 * barely visible inside it, and urgent is a hollow ring with an arrow — which
 * survives being printed in grey.
 */
function Marker({ marker }: { marker: ChecklistMarker }) {
  if (marker === "urgent") {
    return (
      <span
        aria-hidden="true"
        className="flex size-5.5 shrink-0 items-center justify-center rounded-full border-2 border-primary"
      >
        <ArrowRight className="size-3 text-primary" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5.5 shrink-0 items-center justify-center rounded-full",
        marker === "done" ? "bg-positive" : "bg-muted",
      )}
    >
      <Check
        className={cn(
          "size-3",
          marker === "done" ? "text-background" : "text-muted-foreground/40",
        )}
      />
    </span>
  );
}

/**
 * Claiming a guest session, from inside the checklist.
 *
 * The same six digits as the flow's own identity screen, in a sheet, because
 * this is the one row a guest cannot afford to postpone: everything they have
 * done lives in this browser's cookie until an account exists to hold it.
 * Claiming keeps the group, the balance and every expense they added.
 */
function ClaimAccountSheet({
  open,
  onOpenChange,
  name,
  onClaimed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onClaimed: (email: string) => void;
}) {
  const t = useTranslations("onboarding.sheets.claim");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = email.trim();
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address);

  const send = async () => {
    setError(null);
    setBusy(true);
    const result = await startCodeSignupAction({
      name: name.trim(),
      email: address,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t("failed"));
      return;
    }
    setSent(true);
  };

  const verify = async (value: string) => {
    setError(null);
    setBusy(true);
    const result = await verifySignupCodeAction({
      email: address,
      code: value,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t("failed"));
      setCode("");
      return;
    }
    onClaimed(address);
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
          disabled={busy || (sent ? code.length < CODE_LENGTH : !valid)}
          onClick={() => void (sent ? verify(code) : send())}
        >
          {busy && (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          )}
          {sent ? t("verify") : t("send")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Label className="sr-only" htmlFor="claim-email">
          {t("emailLabel")}
        </Label>
        <Input
          id="claim-email"
          type="email"
          className="h-14 rounded-xl"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (sent) {
              setSent(false);
              setCode("");
            }
          }}
          placeholder={t("emailPlaceholder")}
          autoComplete="email"
          inputMode="email"
          disabled={busy}
        />
        {sent && (
          <CodeInput
            value={code}
            onChange={setCode}
            onComplete={(value) => void verify(value)}
            label={t("codeLabel")}
            disabled={busy}
          />
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </SheetShell>
  );
}
