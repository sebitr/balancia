"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initialsOf } from "@/components/join/types";
import { isKnownPayoutMethod } from "@/modules/payouts/fields";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { usePasskeySupport } from "@/components/auth/use-passkey-support";
import { registerPasskey } from "@/modules/auth/passkey-client";
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
  ProfileSheet,
  SettleUpSheet,
  type PayoutEntry,
} from "./sheets";
import { PRIMARY, YourBalance } from "./screens";
import type { OnboardingGroupView, OnboardingProfileView } from "./types";

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
 * Only an account reaches it — the end of a personal invitation taken with
 * one, or of a guest creating theirs from `/register`. A guest goes straight
 * to the group, whose guest card carries the one row a guest could ever do.
 *
 * Every row starts from what the account already has rather than from zero.
 * That was the bug: somebody who opened a group link already signed in was
 * shown their own photo, their own payout method and their own starred
 * currencies as four things still to do. A receipt that cannot read the past
 * is not a receipt. Where the whole list is already ticked the flow does not
 * reach this screen at all — see `checklistIsComplete` in `checklist.ts`.
 */
export function ChecklistScreen({
  group,
  profile = null,
  credential,
  email,
  name,
  onLeave,
}: {
  group: OnboardingGroupView | null;
  /**
   * What the account had before this flow started. Null for an account
   * created a screen ago, which genuinely has none of it.
   */
  profile?: OnboardingProfileView | null;
  credential: "passkey" | "code" | "password" | null;
  email: string;
  name: string;
  onLeave: () => void;
}) {
  const t = useTranslations("onboarding.checklist");

  const [open, setOpen] = useState<ChecklistSheet | null>(null);
  const [settling, setSettling] = useState(false);
  /*
   * Seeded from the account, then owned here.
   *
   * The sheets write on tap and report back through these, so what the screen
   * shows is the account's state plus whatever has been changed since it was
   * read — without a second round trip after every sheet dismissal.
   */
  const [currencies, setCurrencies] = useState<readonly string[]>(
    profile?.currencies ?? [],
  );
  const [payouts, setPayouts] = useState<readonly PayoutEntry[]>(
    profile?.payouts ?? [],
  );
  const [pushEnabled, setPushEnabled] = useState(profile?.pushEnabled ?? false);
  const [hasPhoto, setHasPhoto] = useState(profile?.hasPhoto ?? false);
  const [shownName, setShownName] = useState(name);
  const [hasPasskey, setHasPasskey] = useState(profile?.hasPasskey ?? false);
  const [passkeyAdded, setPasskeyAdded] = useState(false);
  const [registering, setRegistering] = useState(false);
  const passkeysSupported = usePasskeySupport();

  const tMethods = useTranslations("paymentMethods");

  /**
   * The passkey row is an action, not a sheet: tapping it runs the browser's
   * own ceremony, and there is nothing of ours to draw around that.
   */
  const addPasskey = async () => {
    setRegistering(true);
    try {
      await registerPasskey();
      setHasPasskey(true);
      setPasskeyAdded(true);
      toast.success(t("passkeyAdded"));
    } catch (error) {
      // Dismissing the system sheet is a decision, not a failure.
      if (error instanceof Error && error.name === "NotAllowedError") return;
      toast.error(
        (error instanceof Error ? error.message : "") || t("passkeyFailed"),
      );
    } finally {
      setRegistering(false);
    }
  };

  const rows = checklistRows({
    credential,
    email: email || null,
    hasPhoto,
    hasPasskey,
    passkeyAdded,
    passkeysSupported,
    name: shownName,
    currencies,
    // Guarded rather than cast, now that this list can come from the database
    // as well as from the sheet: a method stored by an older version, or by
    // the mobile client, has no label here and must not take the screen down
    // on its way past. Its own code is a poor label but a truthful one.
    payouts: payouts.map((entry) =>
      isKnownPayoutMethod(entry.method) ? tMethods(entry.method) : entry.method,
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
          <Avatar>
            <AvatarFallback className="bg-accent text-xs text-accent-foreground">
              {initialsOf(name || "?")}
            </AvatarFallback>
          </Avatar>
        </div>
      )}

      {group?.position && (
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <YourBalance
            balance={group.position}
            className="text-xl font-semibold"
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
            <span className="text-2xs font-semibold text-primary-ink">
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
                    disabled={registering}
                    onClick={() =>
                      row.sheet === "passkey"
                        ? void addPasskey()
                        : setOpen(row.sheet)
                    }
                    aria-label={`${label} — ${note}`}
                    className="flex min-h-14 w-full items-center gap-3 px-1 py-2.5 text-left disabled:opacity-60"
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

      <ProfileSheet
        open={open === "profile"}
        onOpenChange={(next) => setOpen(next ? "profile" : null)}
        name={shownName}
        onNameChange={setShownName}
        onPhotoChange={() => setHasPhoto(true)}
      />
    </div>
  );
}

/**
 * The two states, told apart by their glyph and not only by their colour.
 *
 * Principle 01 of the design system: colour is never the only carrier. Done is
 * a filled circle with a check in it, and not-done is a pale circle with a
 * check barely visible inside it — which survives being printed in grey.
 */
function Marker({ marker }: { marker: ChecklistMarker }) {
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
