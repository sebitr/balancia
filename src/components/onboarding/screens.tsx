"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowRight,
  Camera,
  Check,
  ChevronRight,
  Loader2,
  Users,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/brand/wordmark";
import { Amount, BalanceAmount } from "@/components/money/amount";
import {
  ImageDecodeError,
  squareToWebp,
} from "@/components/settings/square-image";
import { setDisplayNameAction } from "@/modules/profile/actions";
import { initialsOf } from "@/components/join/types";
import type { Arrival, Intent } from "./route";
import type { JoinMemberView, OnboardingGroupView } from "./types";

/**
 * The onboarding screens, each a leaf.
 *
 * A screen takes what it shows and the callbacks it can fire, and holds no
 * state beyond what its own fields need while they are being typed. The state
 * machine is one level up in `onboarding-flow.tsx`, so the whole flow reads in
 * one place rather than being reconstructed from nine files.
 *
 * Sizing note: primaries and rows carry explicit heights rather than the
 * `Button` defaults, which are 32px and 36px — desk sizes. Everything here is
 * a phone's primary action, so the design fixes 54px for a primary, 50px for a
 * secondary and at least 44px for a row. Font sizes are never overridden
 * downwards: `Input` ships `text-base md:text-sm`, which is what stops Safari
 * zooming the page in the moment a field takes focus.
 */

/** 54px. The one action next, at the bottom of the screen. */
const PRIMARY = "h-[3.375rem] w-full text-base";

/** 50px. */
const SECONDARY = "h-[3.125rem] w-full text-base";

/** Pins the primary to the bottom however short the content above it is. */
function Spacer() {
  return <div className="flex-1" />;
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="font-heading text-2xl leading-tight font-semibold tracking-[-0.025em] text-pretty">
      {children}
    </h1>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-pretty text-muted-foreground">{children}</p>
  );
}

/**
 * The group, as a card: who is in it, how much has gone through it, since when.
 *
 * Shown on both linked arrivals and on neither cold one — there is nothing to
 * describe before a group exists, and a card drawn around nothing reads as a
 * loading state that never resolves.
 */
function GroupCard({ group }: { group: OnboardingGroupView }) {
  const t = useTranslations("group");
  const tOnboarding = useTranslations("onboarding");
  const { summary } = group;

  const meta = [
    t("metaPeople", { count: summary.participantCount }),
    t("metaExpenses", { count: summary.expenseCount }),
    summary.since ? tOnboarding("since", { date: summary.since }) : null,
  ].filter((part): part is string => part !== null);

  const hidden = summary.participantCount - summary.faces.length;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-semibold">{summary.groupName}</span>
        <span className="text-xs text-muted-foreground">
          {meta.join(" · ")}
        </span>
      </div>
      <AvatarGroup>
        {summary.faces.map((face, index) => (
          <Avatar key={`${face}-${index}`} size="lg">
            <AvatarFallback className="bg-accent text-sm text-accent-foreground">
              {initialsOf(face)}
            </AvatarFallback>
          </Avatar>
        ))}
        {hidden > 0 && <AvatarGroupCount>+{hidden}</AvatarGroupCount>}
      </AvatarGroup>
    </div>
  );
}

/**
 * The guest option, which is a proposition rather than a button.
 *
 * Two lines inside one control, and a dashed border because what it offers is
 * provisional. The `aria-label` is not decoration: stacked lines run together
 * into one word for a screen reader — and in jsdom — so the accessible name is
 * stated rather than inferred.
 */
function GuestChoice({ onSelect }: { onSelect: () => void }) {
  const t = useTranslations("onboarding.welcome");

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${t("guest")} — ${t("guestNote")}`}
      className="flex min-h-[3.375rem] w-full items-center gap-3 rounded-xl border border-dashed border-input bg-card px-4 py-3 text-left transition-colors hover:bg-muted"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{t("guest")}</span>
        <span className="block text-xs text-pretty text-muted-foreground">
          {t("guestNote")}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </button>
  );
}

export function WelcomeScreen({
  arrival,
  group,
  inviterName,
  registrationAllowed,
  guestOffered = true,
  onChoose,
  onFindMyself,
}: {
  arrival: Arrival;
  group: OnboardingGroupView | null;
  inviterName: string | null;
  registrationAllowed: boolean;
  /** False for somebody who is already a guest of this group. */
  guestOffered?: boolean;
  onChoose: (intent: Intent) => void;
  onFindMyself: () => void;
}) {
  const t = useTranslations("onboarding.welcome");

  /*
   * Which of the three welcomes this is, decided once, from `arrival` alone.
   *
   * The prototype tested `!isShared` in two places and got two different
   * answers, which is how it ended up painting one tab while rendering
   * another's buttons. One comparison, read three times.
   */
  const shared = arrival === "shared";
  const cold = arrival === "cold";

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Wordmark />

      {group && <GroupCard group={group} />}

      <div className="flex flex-col gap-2">
        <Headline>
          {cold
            ? t("coldTitle")
            : shared
              ? t("sharedTitle", { group: group?.summary.groupName ?? "" })
              : inviterName
                ? t("personalTitle", {
                    inviter: inviterName,
                    group: group?.summary.groupName ?? "",
                  })
                : t("personalTitleNoInviter", {
                    group: group?.summary.groupName ?? "",
                  })}
        </Headline>
        <Sub>
          {cold ? t("coldSub") : shared ? t("sharedSub") : t("personalSub")}
        </Sub>
      </div>

      <Spacer />

      {shared ? (
        <div className="flex flex-col gap-3">
          <p className="text-center text-xs text-pretty text-muted-foreground">
            {t("sharedNote")}
          </p>
          <Button size="lg" className={PRIMARY} onClick={onFindMyself}>
            {t("findMyself")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {registrationAllowed && (
            <Button
              size="lg"
              className={PRIMARY}
              onClick={() => onChoose("account")}
            >
              {t("createAccount")}
            </Button>
          )}
          <Button
            size="lg"
            variant="outline"
            className={SECONDARY}
            onClick={() => onChoose("signin")}
          >
            {t("haveAccount")}
          </Button>

          {/*
            No guest option on a cold arrival, and this is not a styling
            choice: a guest session is created by spending an invitation token
            and belongs to the group that token came from. With no group there
            is nothing to be a guest of.
          */}
          {!cold && guestOffered && (
            <>
              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-border" />
                <span className="text-2xs font-semibold tracking-[0.07em] text-muted-foreground uppercase">
                  {t("or")}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <GuestChoice onSelect={() => onChoose("guest")} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Which of these is you.
 *
 * The unclaimed names the group's creator typed while spending money. Each row
 * carries the position that comes with the name, because that is what makes
 * the choice checkable rather than a guess at spelling.
 */
export function WhichOneScreen({
  members,
  typedName,
  onPick,
  onNewHere,
}: {
  members: readonly JoinMemberView[];
  typedName: string;
  onPick: (member: JoinMemberView) => void;
  onNewHere: () => void;
}) {
  const t = useTranslations("onboarding.whichOne");

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Headline>{t("title")}</Headline>
        <Sub>{t("sub")}</Sub>
      </div>

      <ul className="flex flex-col gap-2">
        {members.map((member) => (
          <li key={member.id}>
            <button
              type="button"
              onClick={() => onPick(member)}
              aria-label={`${member.displayName} — ${t("filed", { count: member.expenseCount })}`}
              className="flex min-h-[4.25rem] w-full items-center gap-3 rounded-xl bg-card px-4 py-3 text-left ring-1 ring-foreground/10 transition-colors hover:bg-muted"
            >
              <Avatar size="lg">
                <AvatarFallback className="bg-accent text-sm text-accent-foreground">
                  {initialsOf(member.displayName)}
                </AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">
                  {member.displayName}
                </span>
                {member.balances[0] ? (
                  <BalanceAmount
                    minorUnits={member.balances[0].minorUnits}
                    currency={member.balances[0].currency}
                    size="small"
                  />
                ) : null}
                <span className="text-2xs text-muted-foreground">
                  {t("filed", { count: member.expenseCount })}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            </button>
          </li>
        ))}
      </ul>

      <Spacer />

      <button
        type="button"
        onClick={onNewHere}
        className="flex min-h-[3.125rem] w-full items-center justify-center rounded-xl border border-dashed border-input bg-card px-4 text-sm font-medium transition-colors hover:bg-muted"
      >
        {typedName ? t("newHereNamed", { name: typedName }) : t("newHere")}
      </button>
    </div>
  );
}

/** Is this you — with the balance and the expenses that come with saying yes. */
export function ConfirmScreen({
  member,
  inviterName,
  onConfirm,
  onReject,
}: {
  member: JoinMemberView;
  inviterName: string | null;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const t = useTranslations("onboarding.confirm");

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex items-center gap-3">
        <Avatar className="size-13">
          <AvatarFallback className="bg-accent text-lg text-accent-foreground">
            {initialsOf(member.displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-base font-semibold">
            {member.displayName}
          </span>
          <span className="text-xs text-muted-foreground">
            {inviterName
              ? t("filedBy", {
                  count: member.expenseCount,
                  inviter: inviterName,
                })
              : t("filed", { count: member.expenseCount })}
          </span>
        </div>
      </div>

      <Headline>{t("title")}</Headline>

      {member.balances[0] && (
        <div className="flex flex-col gap-1 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <span className="text-xs text-muted-foreground">{t("position")}</span>
          <BalanceAmount
            minorUnits={member.balances[0].minorUnits}
            currency={member.balances[0].currency}
            size="large"
          />
        </div>
      )}

      {member.recentExpenses.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-xl bg-card px-4 ring-1 ring-foreground/10">
          {member.recentExpenses.map((expense) => (
            <li
              key={expense.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {expense.description}
              </span>
              <Amount
                minorUnits={expense.minorUnits}
                currency={expense.currency}
                className="text-sm text-muted-foreground"
              />
            </li>
          ))}
        </ul>
      )}

      <Spacer />

      <div className="flex flex-col gap-2.5">
        <Button size="lg" className={PRIMARY} onClick={onConfirm}>
          {t("yes")}
        </Button>
        <Button
          size="lg"
          variant="outline"
          className={SECONDARY}
          onClick={onReject}
        >
          {t("no")}
        </Button>
      </div>
    </div>
  );
}

/**
 * How should we keep it.
 *
 * Asked here rather than at the door because only now is there something
 * concrete to keep: a name, a balance, and the expenses already filed under
 * it. Note the em dash in the copy — several member names end in a full stop,
 * so the name must not be sentence-final.
 */
export function KeepItScreen({
  name,
  expenseCount,
  registrationAllowed,
  onChoose,
}: {
  name: string;
  expenseCount: number;
  registrationAllowed: boolean;
  onChoose: (intent: Intent) => void;
}) {
  const t = useTranslations("onboarding.keepIt");

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Headline>{t("title", { name })}</Headline>
        <Sub>{t("sub", { count: expenseCount })}</Sub>
      </div>

      <Spacer />

      <div className="flex flex-col gap-2.5">
        {registrationAllowed && (
          <Button
            size="lg"
            className={PRIMARY}
            onClick={() => onChoose("account")}
          >
            {t("createAccount")}
          </Button>
        )}
        <Button
          size="lg"
          variant="outline"
          className={SECONDARY}
          onClick={() => onChoose("signin")}
        >
          {t("haveAccount")}
        </Button>
        <GuestChoice onSelect={() => onChoose("guest")} />
      </div>
    </div>
  );
}

/**
 * Name, and a photo if they feel like it.
 *
 * Reached from three places and worded differently in each: a new account is
 * being asked its name, a guest is being asked what the group should call
 * them, and somebody who was not on the list is being added to it.
 *
 * The photo only uploads once an account exists to hang it on. For a guest it
 * is not offered at all rather than offered and then refused — there is no
 * per-participant photo to upload to.
 */
export function ProfileScreen({
  arrival,
  intent,
  isNewMember,
  name,
  onNameChange,
  hasAccount,
  onDone,
}: {
  arrival: Arrival;
  intent: Intent;
  isNewMember: boolean;
  name: string;
  onNameChange: (name: string) => void;
  hasAccount: boolean;
  onDone: () => void;
}) {
  const t = useTranslations("onboarding.profile");
  const tSettings = useTranslations("userSettings");
  const fileInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guest = intent === "guest";
  const trimmed = name.trim();

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
      // Shown from the local file rather than re-fetched: the bytes are
      // already here, and a round trip to look at what was just chosen is a
      // second of blank circle for nothing.
      setPhoto(URL.createObjectURL(file));
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

  const submit = async () => {
    if (trimmed.length === 0) return;
    setError(null);
    if (!hasAccount) {
      // No account yet — the name travels with the signup that follows.
      onDone();
      return;
    }
    setBusy(true);
    const result = await setDisplayNameAction(trimmed);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t("nameFailed"));
      return;
    }
    onDone();
  };

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Headline>
          {guest
            ? t("guestTitle")
            : arrival === "shared" && isNewMember
              ? t("newMemberTitle")
              : t("title")}
        </Headline>
        <Sub>
          {guest
            ? t("guestSub")
            : arrival === "shared" && isNewMember
              ? t("newMemberSub")
              : t("sub")}
        </Sub>
      </div>

      <div className="flex items-center gap-3">
        {!guest && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busy || !hasAccount}
              aria-label={t("photoAdd")}
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
              {busy ? (
                <Loader2 className="size-3.5 animate-spin text-primary-foreground" />
              ) : (
                <Camera className="size-3.5 text-primary-foreground" />
              )}
            </span>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="sr-only"
              // Opened by the circle beside it, which already carries the
              // label — so this is not a second thing to tab to.
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = "";
              }}
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <Label className="sr-only" htmlFor="onboarding-name">
            {t("nameLabel")}
          </Label>
          <Input
            id="onboarding-name"
            className="h-14 rounded-xl"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={t("namePlaceholder")}
            autoComplete="name"
            autoFocus
            maxLength={120}
          />
        </div>
      </div>

      {guest && (
        <p className="rounded-xl bg-muted p-3 text-xs text-pretty text-muted-foreground">
          {t("guestNote")}
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Spacer />

      <Button
        size="lg"
        className={PRIMARY}
        disabled={trimmed.length === 0 || busy}
        onClick={() => void submit()}
      >
        {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
        {guest
          ? t("joinAsGuest")
          : hasAccount
            ? t("continue")
            : t("createAccount")}
      </Button>
    </div>
  );
}

/**
 * You're in.
 *
 * The balance is the point of the screen, and it says the same thing three
 * ways at once — the word, the arrow, the colour — because colour alone is
 * never the signal. `BalanceAmount` is what guarantees that.
 */
export function ArrivalScreen({
  intent,
  claimed,
  name,
  group,
  onContinue,
}: {
  intent: Intent;
  claimed: JoinMemberView | null;
  name: string;
  group: OnboardingGroupView | null;
  onContinue: () => void;
}) {
  const t = useTranslations("onboarding.arrival");
  const position = claimed?.balances[0] ?? group?.position ?? null;

  return (
    <div className="flex flex-1 flex-col gap-5">
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-full bg-positive/15"
      >
        <Check className="size-5 text-positive" />
      </span>

      <div className="flex flex-col gap-2">
        <Headline>
          {claimed
            ? t("claimedTitle", { name: claimed.displayName })
            : intent === "guest"
              ? t("guestTitle")
              : intent === "signin"
                ? t("welcomeBackTitle", { name })
                : t("title", { name })}
        </Headline>
        <Sub>
          {claimed
            ? t("claimedSub", { count: claimed.expenseCount })
            : intent === "guest"
              ? t("guestSub")
              : intent === "signin"
                ? t("welcomeBackSub")
                : t("sub")}
        </Sub>
      </div>

      {position && group && (
        <div className="flex flex-col gap-1 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <span className="text-xs text-muted-foreground">
            {group.summary.groupName}
          </span>
          <BalanceAmount
            minorUnits={position.minorUnits}
            currency={position.currency}
            size="large"
            showLabel={false}
          />
          <span className="text-xs text-muted-foreground">
            <BalanceLabel minorUnits={position.minorUnits} />
          </span>
        </div>
      )}

      <Spacer />

      <Button size="lg" className={PRIMARY} onClick={onContinue}>
        {t("seeGroup")}
      </Button>
    </div>
  );
}

/** The word under the amount — the third of the three redundant cues. */
function BalanceLabel({ minorUnits }: { minorUnits: string }) {
  const t = useTranslations("money");
  const value = BigInt(minorUnits);
  return (
    <>{value > 0n ? t("getsBack") : value < 0n ? t("owes") : t("settledUp")}</>
  );
}

/**
 * Where a cold signup lands: an account, and nothing to look at yet.
 *
 * Creating the group itself is out of scope here — `create-group-sheet.tsx`
 * owns it, from the dashboard this hands off to.
 */
export function FirstGroupScreen({
  name,
  onLeave,
}: {
  name: string;
  onLeave: () => void;
}) {
  const t = useTranslations("onboarding.firstGroup");

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Headline>{t("title", { name })}</Headline>
      </div>

      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-5 py-8 text-center">
        <span
          aria-hidden="true"
          className="flex size-11 items-center justify-center rounded-full bg-accent"
        >
          <Users className="size-5 text-accent-foreground" />
        </span>
        <span className="font-medium">{t("emptyTitle")}</span>
        <span className="text-xs text-pretty text-muted-foreground">
          {t("emptyBody")}
        </span>
      </div>

      <Spacer />

      <div className="flex flex-col gap-2.5">
        <Button size="lg" className={PRIMARY} onClick={onLeave}>
          {t("createGroup")}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export { PRIMARY, SECONDARY, Headline, Spacer, Sub };
