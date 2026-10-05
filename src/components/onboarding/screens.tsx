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
import { TONE, toneFor } from "@/components/money/balance-tone";
import {
  ImageDecodeError,
  squareToWebp,
} from "@/components/settings/square-image";
import { useNumberLocale } from "@/i18n/format-context";
import { cn } from "@/lib/utils";
import { formatMoney, money } from "@/modules/currencies/money";
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
function GuestChoice({
  busy = false,
  label,
  note,
  onSelect,
}: {
  busy?: boolean;
  /** The proposition. Defaults to joining as a guest. */
  label?: string;
  note?: string;
  onSelect: () => void;
}) {
  const t = useTranslations("onboarding.welcome");
  const title = label ?? t("guest");
  const detail = note ?? t("guestNote");

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={busy}
      aria-label={`${title} — ${detail}`}
      className="flex min-h-[3.375rem] w-full items-center gap-3 rounded-xl border border-dashed border-input bg-card px-4 py-3 text-left transition-colors hover:bg-muted disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-pretty text-muted-foreground">
          {detail}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </button>
  );
}

/**
 * The first screen of a personal invitation and of a cold arrival.
 *
 * A shared link has no welcome: it opens on the list, which is the only
 * question it has to ask first — see `WhichOneScreen`.
 */
export function WelcomeScreen({
  arrival,
  group,
  inviterName,
  registrationAllowed,
  guestOffered = true,
  onChoose,
}: {
  arrival: Exclude<Arrival, "shared">;
  group: OnboardingGroupView | null;
  inviterName: string | null;
  registrationAllowed: boolean;
  /** False for somebody who is already a guest of this group. */
  guestOffered?: boolean;
  onChoose: (intent: Intent) => void;
}) {
  const t = useTranslations("onboarding.welcome");

  /*
   * Which of the two welcomes this is, decided once, from `arrival` alone.
   *
   * The prototype tested the arrival in two places and got two different
   * answers, which is how it ended up painting one tab while rendering
   * another's buttons. One comparison, read throughout.
   */
  const cold = arrival === "cold";

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Wordmark />

      {group && <GroupCard group={group} />}

      <div className="flex flex-col gap-2">
        <Headline>
          {cold
            ? t("coldTitle")
            : inviterName
              ? t("personalTitle", {
                  inviter: inviterName,
                  group: group?.summary.groupName ?? "",
                })
              : t("personalTitleNoInviter", {
                  group: group?.summary.groupName ?? "",
                })}
        </Headline>
        <Sub>{cold ? t("coldSub") : t("personalSub")}</Sub>
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

        {/*
          The third door. On a personal invitation it is the guest session the
          invitation minted; on a cold arrival there is no group to be a guest
          of yet, so the offer is a group of their own — the same guest,
          arriving through a group they start, on the same terms as
          registration.
        */}
        {((!cold && guestOffered) || (cold && registrationAllowed)) && (
          <>
            <Divider label={t("or")} />
            <GuestChoice
              label={cold ? t("startGroup") : undefined}
              note={cold ? t("startGroupNote") : undefined}
              onSelect={() => onChoose("guest")}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** A rule with a word in it, between the account doors and the guest one. */
function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-border" />
      <span className="text-2xs font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Which of these is you — the first and only question a shared link opens on.
 *
 * The link is the same for everybody it was sent to, so it cannot know who
 * opened it; the subtitle says so, which is the one thing the welcome that
 * used to stand in front of this list had to say. The group card goes first,
 * so the reader knows what they were invited to before being asked anything.
 *
 * Each row carries what comes with the name — what it owes or gets back, and
 * how many expenses it has a share in — because that is what makes the choice
 * checkable rather than a guess at spelling. The word and the amount travel
 * together in the balance's own tone, so the colour never says it alone.
 *
 * Picking a row commits nothing. The next screen names the person, shows the
 * balance again as theirs, and offers the way back.
 */
export function WhichOneScreen({
  group,
  inviterName,
  accountName,
  members,
  typedName,
  onPick,
  onNewHere,
}: {
  group: OnboardingGroupView;
  inviterName: string | null;
  /**
   * The account already signed in, when there is one.
   *
   * Named before anybody picks, not after: a link opened on a borrowed laptop
   * is the case where somebody is about to take a balance as the wrong person.
   */
  accountName: string | null;
  members: readonly JoinMemberView[];
  typedName: string;
  onPick: (member: JoinMemberView) => void;
  onNewHere: () => void;
}) {
  const t = useTranslations("onboarding.whichOne");
  const groupName = group.summary.groupName;

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Wordmark />

      <GroupCard group={group} />

      <div className="flex flex-col gap-2">
        <Headline>
          {inviterName
            ? t("titleInviter", { inviter: inviterName, group: groupName })
            : t("title", { group: groupName })}
        </Headline>
        <Sub>
          {accountName ? t("subSignedIn", { name: accountName }) : t("sub")}
        </Sub>
      </div>

      <ul className="flex flex-col gap-2">
        {members.map((member) => (
          <li key={member.id}>
            <MemberRow member={member} onPick={() => onPick(member)} />
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

/**
 * One name on the list: "Alex", then "owes €60.00 · 2 expenses".
 *
 * Only the first currency is shown, as before: a row is a line, and the
 * person picking it needs to recognise a figure, not audit one.
 */
function MemberRow({
  member,
  onPick,
}: {
  member: JoinMemberView;
  onPick: () => void;
}) {
  const t = useTranslations("onboarding.whichOne");
  const locale = useNumberLocale();
  const balance = member.balances[0] ?? null;
  const tone = balance ? toneFor(balance.minorUnits) : "neutral";
  const values = {
    count: member.expenseCount,
    amount: balance ? magnitudeOf(balance, locale) : "",
  };
  const key =
    tone === "negative"
      ? "rowOwes"
      : tone === "positive"
        ? "rowGetsBack"
        : "rowSettled";

  return (
    <button
      type="button"
      onClick={onPick}
      // Two stacked lines run together into one word for a screen reader, so
      // the name and the line under it are said as a pair.
      aria-label={`${member.displayName} — ${t.markup(key, {
        ...values,
        money: (chunks) => chunks,
      })}`}
      className="flex min-h-[4.25rem] w-full items-center gap-3 rounded-xl bg-card px-4 py-3 text-left ring-1 ring-foreground/10 transition-colors hover:bg-muted"
    >
      <Avatar size="lg">
        <AvatarFallback className="bg-accent text-sm text-accent-foreground">
          {initialsOf(member.displayName)}
        </AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{member.displayName}</span>
        <span className="text-sm text-muted-foreground">
          {t.rich(key, {
            ...values,
            money: (chunks) => (
              <span className={cn("font-medium tabular-nums", TONE[tone].ink)}>
                {chunks}
              </span>
            ),
          })}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </button>
  );
}

/**
 * How this person comes in — and, for somebody new, what they are called.
 *
 * Asked here rather than at the door because only now is there somebody
 * concrete to keep: a name, and the balance under it, said to them as theirs
 * ("You owe €60.00"). It is also the screen that replaced "Is this you?": the
 * name and the balance are on it, nothing is committed until one of its
 * buttons is pressed, and "Not you?" goes back to the list un-choosing it.
 *
 * Three shapes, from two facts:
 *
 *  - Signed out: an account, a sign-in, or a guest. The guest option is the
 *    join itself — there is no screen after it to carry the work — so these
 *    can be in flight, and a refusal lands here.
 *  - Signed in: one button, which is the join. The account is named above it
 *    for the same reason the list names it.
 *  - Nobody on the list: the name field comes first, and every button waits
 *    for it, because each of them files the person under it.
 *
 * Note the comma after the name in the headline — several member names end in
 * a full stop, so the name must not be sentence-final.
 */
export function KeepItScreen({
  groupName,
  member,
  name,
  onNameChange,
  accountName,
  registrationAllowed,
  busy = false,
  error = null,
  onChoose,
  onJoin,
  onBackToList,
}: {
  groupName: string;
  /** The listed name they picked, or null for somebody new. */
  member: JoinMemberView | null;
  name: string;
  onNameChange: (name: string) => void;
  /** The account already signed in, when there is one. */
  accountName: string | null;
  registrationAllowed: boolean;
  busy?: boolean;
  error?: string | null;
  /** Signed out: which of the three ways in. */
  onChoose: (intent: Intent) => void;
  /** Signed in: the join, as that account. */
  onJoin: () => void;
  onBackToList: () => void;
}) {
  const t = useTranslations("onboarding.keepIt");
  const signedIn = accountName !== null;
  const trimmed = name.trim();
  // Somebody new is filed under what they type, whichever way they come in.
  const ready = !busy && (member !== null || trimmed.length > 0);
  const count = member?.expenseCount ?? 0;

  return (
    <div className="flex flex-1 flex-col gap-5">
      {member && <YouRow member={member} />}

      <div className="flex flex-col gap-2">
        <Headline>
          {member
            ? signedIn
              ? t("titleSignedIn", {
                  name: member.displayName,
                  group: groupName,
                })
              : t("title", { name: member.displayName, group: groupName })
            : t("titleNew", { group: groupName })}
        </Headline>
        <Sub>
          {member
            ? signedIn
              ? t("subSignedIn", { account: accountName, count })
              : t("sub", { group: groupName, count })
            : signedIn
              ? t("subNewSignedIn", { account: accountName })
              : t("subNew", { group: groupName })}
        </Sub>
      </div>

      {!member && (
        <div>
          <Label className="sr-only" htmlFor="onboarding-join-name">
            {t("nameLabel")}
          </Label>
          <Input
            id="onboarding-join-name"
            className="h-14 rounded-xl"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={t("namePlaceholder")}
            autoComplete="name"
            autoFocus
            maxLength={120}
            disabled={busy}
          />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Spacer />

      <div className="flex flex-col gap-2.5">
        {signedIn ? (
          <Button
            size="lg"
            className={PRIMARY}
            disabled={!ready}
            onClick={onJoin}
          >
            {busy && (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            )}
            {t("join", { group: groupName })}
          </Button>
        ) : (
          <>
            {registrationAllowed && (
              <Button
                size="lg"
                className={PRIMARY}
                disabled={!ready}
                onClick={() => onChoose("account")}
              >
                {t("createAccount")}
              </Button>
            )}
            <Button
              size="lg"
              variant="outline"
              className={SECONDARY}
              disabled={!ready}
              onClick={() => onChoose("signin")}
            >
              {t("haveAccount")}
            </Button>
            <GuestChoice
              busy={!ready}
              note={t("guestNote")}
              onSelect={() => onChoose("guest")}
            />
          </>
        )}

        <Button
          variant="link"
          className="self-center"
          disabled={busy}
          onClick={onBackToList}
        >
          {member ? t("notYou") : t("backToList")}
        </Button>
      </div>
    </div>
  );
}

/** The person they just said they are, and where they stand — as "you". */
function YouRow({ member }: { member: JoinMemberView }) {
  return (
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
        <YourBalance
          balance={member.balances[0] ?? null}
          className="text-sm font-medium"
        />
      </div>
    </div>
  );
}

/** The figure without its sign: the sentence around it says the direction. */
function magnitudeOf(
  balance: { minorUnits: string; currency: string },
  locale: string,
): string {
  const value = BigInt(balance.minorUnits);
  return formatMoney(money(value < 0n ? -value : value, balance.currency), {
    locale,
  });
}

/**
 * Name, and a photo if they feel like it.
 *
 * Reached from two places and worded differently in each: a new account is
 * being asked its name, and a guest is being asked what the group should call
 * them. Somebody new on a shared link types theirs on "keep it" instead, where
 * every way in files them under it.
 *
 * The photo only uploads once an account exists to hang it on. For a guest it
 * is not offered at all rather than offered and then refused — there is no
 * per-participant photo to upload to.
 */
export function ProfileScreen({
  intent,
  name,
  onNameChange,
  hasAccount,
  onDone,
}: {
  intent: Intent;
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
        <Headline>{guest ? t("guestTitle") : t("title")}</Headline>
        <Sub>{guest ? t("guestSub") : t("sub")}</Sub>
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
 * You're in — for an account that came in through a personal invitation.
 *
 * Nobody else reaches it. A shared link and a personal invitation's guest go
 * straight to the group and say "you're in" there, in a toast; an account
 * stops here because it has a checklist whose rows it can actually save, and
 * because this screen is what gives the page time to hand down the account's
 * own setup before the checklist is seeded from it.
 *
 * Each button says what it does. When there is something left to set up, the
 * primary opens the checklist and says so, and "Go to the group" sits under
 * it; when there is nothing, "Go to the group" is the only button. It used to
 * be one button reading "See the group" that opened the checklist.
 */
export function ArrivalScreen({
  intent,
  name,
  group,
  onFinishSetup,
  onLeave,
}: {
  intent: Intent;
  name: string;
  group: OnboardingGroupView | null;
  /** Opens the checklist; null when there is nothing left on it. */
  onFinishSetup: (() => void) | null;
  onLeave: () => void;
}) {
  const t = useTranslations("onboarding.arrival");
  const position = group?.position ?? null;

  return (
    <div className="flex flex-1 flex-col gap-5">
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-full bg-positive/15"
      >
        <Check className="size-5 text-positive-ink" />
      </span>

      <div className="flex flex-col gap-2">
        <Headline>
          {intent === "signin"
            ? t("welcomeBackTitle", { name })
            : t("title", { name })}
        </Headline>
        <Sub>{intent === "signin" ? t("welcomeBackSub") : t("sub")}</Sub>
      </div>

      {position && group && (
        <div className="flex flex-col gap-1 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <span className="text-xs text-muted-foreground">
            {group.summary.groupName}
          </span>
          <YourBalance balance={position} className="text-xl font-semibold" />
        </div>
      )}

      <Spacer />

      <div className="flex flex-col gap-2.5">
        {onFinishSetup ? (
          <>
            <Button size="lg" className={PRIMARY} onClick={onFinishSetup}>
              {t("finishSetup")}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className={SECONDARY}
              onClick={onLeave}
            >
              {t("goToGroup")}
            </Button>
          </>
        ) : (
          <Button size="lg" className={PRIMARY} onClick={onLeave}>
            {t("goToGroup")}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Where the reader stands, said to them: "You owe €60.00".
 *
 * For a balance that is theirs — once they have said who they are, or been
 * let in as somebody. The word carries the direction, so the figure goes
 * unsigned, and the phrase takes the balance's own tone from `TONE`, which is
 * never the only cue.
 */
export function YourBalance({
  balance,
  className,
}: {
  balance: { minorUnits: string; currency: string } | null;
  className?: string;
}) {
  const t = useTranslations("onboarding.yourBalance");
  const locale = useNumberLocale();
  const tone = balance ? toneFor(balance.minorUnits) : "neutral";
  const amount = balance ? magnitudeOf(balance, locale) : "";

  return (
    <span className={cn("tabular-nums", TONE[tone].ink, className)}>
      {tone === "negative"
        ? t("owe", { amount })
        : tone === "positive"
          ? t("getBack", { amount })
          : t("settled")}
    </span>
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

/**
 * A group and a name, from somebody with no account.
 *
 * Two fields, because two things have to exist before there is anything to
 * share: the group, and the person it is being started by. The currency and
 * the time zone come from the browser, the way the create sheet guesses them.
 * The zone is the group's to change once it exists; the currency, as for every
 * group, is not.
 */
export function StartGroupScreen({
  name,
  onNameChange,
  busy = false,
  error = null,
  onSubmit,
}: {
  name: string;
  onNameChange: (name: string) => void;
  busy?: boolean;
  error?: string | null;
  onSubmit: (groupName: string) => void;
}) {
  const t = useTranslations("onboarding.startGroup");
  const [groupName, setGroupName] = useState("");
  const ready = groupName.trim().length > 0 && name.trim().length > 0;

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Headline>{t("title")}</Headline>
        <Sub>{t("sub")}</Sub>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="start-group-name">{t("groupNameLabel")}</Label>
          <Input
            id="start-group-name"
            className="h-14 rounded-xl"
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder={t("groupNamePlaceholder")}
            autoComplete="off"
            autoFocus
            maxLength={120}
            disabled={busy}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="start-group-your-name">{t("nameLabel")}</Label>
          <Input
            id="start-group-your-name"
            className="h-14 rounded-xl"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={t("namePlaceholder")}
            autoComplete="name"
            maxLength={120}
            disabled={busy}
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Spacer />

      <Button
        size="lg"
        className={PRIMARY}
        disabled={!ready || busy}
        onClick={() => onSubmit(groupName.trim())}
      >
        {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
        {t("create")}
      </Button>
    </div>
  );
}

export { PRIMARY, SECONDARY, Headline, Spacer, Sub };
