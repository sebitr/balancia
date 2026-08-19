"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, ChevronRight, Info, Plus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/brand/wordmark";
import { Amount, BalanceAmount } from "@/components/money/amount";
import { cn } from "@/lib/utils";
import {
  firstNameOf,
  initialsOf,
  type JoinMemberView,
  type JoinSummaryView,
} from "./types";

/**
 * The individual join screens.
 *
 * Each is a leaf: it takes what it shows and the callbacks it can fire, and
 * holds no state of its own. The state machine is one level up, in
 * `join-flow.tsx`, so the whole flow can be read in one place.
 *
 * Sizing note: primary buttons and inputs carry explicit heights here rather
 * than taking the component defaults, because this flow is a phone-first
 * onboarding where the design fixes 46px and 44px targets. Font sizes are left
 * alone — `Input` already ships `text-base md:text-sm`, which is what keeps
 * Safari from zooming the page on focus.
 */

/** 46px, the design's primary hit target. */
const PRIMARY = "h-[2.875rem] w-full";

/** 44px. */
const FIELD = "h-11";

export function InviteScreen({
  summary,
  inviterName,
  onStart,
}: {
  summary: JoinSummaryView;
  inviterName: string | null;
  onStart: () => void;
}) {
  const t = useTranslations("joinGroup.invite");
  const tGroup = useTranslations("group");

  const meta = [
    tGroup("metaPeople", { count: summary.participantCount }),
    tGroup("metaExpenses", { count: summary.expenseCount }),
    summary.since ? t("since", { date: summary.since }) : null,
  ].filter((part): part is string => part !== null);

  const hidden = summary.participantCount - summary.faces.length;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Wordmark />

      <div className="flex flex-col gap-2.5">
        <Badge variant="secondary" className="w-fit">
          {t("badge")}
        </Badge>
        <h1 className="font-heading text-2xl leading-tight font-semibold tracking-[-0.02em] text-pretty">
          {t("title", { group: summary.groupName })}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {inviterName ? t("ledeFrom", { inviter: inviterName }) : t("lede")}
        </p>
      </div>

      <Card className="gap-3.5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium">{summary.groupName}</span>
            <span className="text-xs text-muted-foreground">
              {meta.join(" · ")}
            </span>
          </div>
          {/*
            `lg` rather than the default: the group overlaps each avatar by
            8px, which eats the right edge of two-letter initials at 32px and
            leaves "MR" reading as "MF". At 40px they clear it — and it is the
            size nearest the 2.25rem the design asks for.
          */}
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

        {summary.totals.length > 0 && (
          <div className="flex w-fit flex-wrap items-baseline gap-2 rounded-lg bg-muted px-3 py-2 font-semibold">
            {summary.totals.map((total) => (
              <Amount
                key={total.currency}
                minorUnits={total.minorUnits}
                currency={total.currency}
              />
            ))}
            <span className="text-xs font-normal text-muted-foreground">
              {t("trackedSoFar")}
            </span>
          </div>
        )}
      </Card>

      <Alert>
        <Info aria-hidden="true" />
        <AlertTitle>{t("alertTitle")}</AlertTitle>
        <AlertDescription>{t("alertBody")}</AlertDescription>
      </Alert>

      <div className="mt-auto flex flex-col gap-2.5">
        <Button className={PRIMARY} onClick={onStart}>
          {t("start")}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {t("footnote")}
        </p>
      </div>
    </div>
  );
}

export function NameScreen({
  groupName,
  value,
  onChange,
  onContinue,
}: {
  groupName: string;
  value: string;
  onChange: (value: string) => void;
  onContinue: () => void;
}) {
  const t = useTranslations("joinGroup.name");
  const ready = value.trim().length >= 2;

  return (
    <form
      className="flex flex-1 flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onContinue();
      }}
    >
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-xl leading-tight font-semibold tracking-[-0.02em] text-pretty">
          {t("title")}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {t("lede", { group: groupName })}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="join-name">{t("label")}</Label>
        <Input
          id="join-name"
          name="name"
          autoComplete="name"
          autoFocus
          className={FIELD}
          placeholder={t("placeholder")}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t("help")}</p>
      </div>

      <div className="mt-auto">
        <Button type="submit" className={PRIMARY} disabled={!ready}>
          {t("continue")}
        </Button>
      </div>
    </form>
  );
}

/** One selectable person. Tinted when it is the suggested match. */
function MemberRow({
  member,
  highlighted = false,
  onSelect,
}: {
  member: JoinMemberView;
  highlighted?: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("joinGroup.match");

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex min-h-[3.75rem] w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
        highlighted
          ? "border-primary/35 bg-primary/6 hover:bg-primary/12"
          : "border-border bg-card hover:bg-muted",
      )}
    >
      <Avatar>
        <AvatarFallback className="bg-accent text-accent-foreground">
          {initialsOf(member.displayName)}
        </AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">
          {member.displayName}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {t("expenseCount", { count: member.expenseCount })}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </button>
  );
}

export function MatchScreen({
  suggestion,
  others,
  onPick,
  onAddMe,
}: {
  suggestion: JoinMemberView | null;
  others: readonly JoinMemberView[];
  onPick: (member: JoinMemberView) => void;
  onAddMe: () => void;
}) {
  const t = useTranslations("joinGroup.match");
  const empty = !suggestion && others.length === 0;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-xl leading-tight font-semibold tracking-[-0.02em] text-pretty">
          {t("title")}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {empty
            ? t("ledeEmpty")
            : suggestion
              ? t("ledeSuggestion")
              : t("ledePlain")}
        </p>
      </div>

      {suggestion && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium tracking-[0.05em] text-muted-foreground uppercase">
            {t("likelyYou")}
          </span>
          <MemberRow
            member={suggestion}
            highlighted
            onSelect={() => onPick(suggestion)}
          />
        </div>
      )}

      {others.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium tracking-[0.05em] text-muted-foreground uppercase">
            {suggestion ? t("othersWithSuggestion") : t("othersPlain")}
          </span>
          <div className="flex flex-col gap-2">
            {others.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                onSelect={() => onPick(member)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2.5">
        <Button variant="outline" className={PRIMARY} onClick={onAddMe}>
          <Plus aria-hidden="true" />
          {empty ? t("addMeEmpty") : t("addMe")}
        </Button>
        {!empty && (
          <p className="text-center text-xs text-muted-foreground">
            {t("footnote")}
          </p>
        )}
      </div>
    </div>
  );
}

export function ConfirmScreen({
  member,
  onConfirm,
  onReject,
}: {
  member: JoinMemberView;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const t = useTranslations("joinGroup.confirm");
  const tMatch = useTranslations("joinGroup.match");

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-xl leading-tight font-semibold tracking-[-0.02em] text-pretty">
          {t("title")}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">{t("lede")}</p>
      </div>

      <Card className="gap-0 p-4">
        <div className="flex items-center gap-3">
          <Avatar size="lg">
            <AvatarFallback className="bg-accent text-accent-foreground">
              {initialsOf(member.displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-base font-medium">
              {member.displayName}
            </span>
            <span className="text-xs text-muted-foreground">
              {tMatch("expenseCount", { count: member.expenseCount })}
            </span>
          </div>
        </div>

        <div className="my-4 border-t border-border" />

        {member.balances.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settled")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {member.balances.map((balance) => (
              <div key={balance.currency} className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground">
                  {t("position", { currency: balance.currency })}
                </p>
                {/*
                  Words off, so the amount reads as the design draws it — a
                  sign glyph and a colour. `BalanceAmount` keeps an `sr-only`
                  "owes"/"gets back" in that mode, which is what stops the
                  direction from being carried by colour alone.
                */}
                <BalanceAmount
                  minorUnits={balance.minorUnits}
                  currency={balance.currency}
                  size="large"
                  showLabel={false}
                />
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {member.recentExpenses.length > 0 ? t("recent") : t("noRecent")}
          </p>
          {member.recentExpenses.map((expense) => (
            <div
              key={expense.id}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <span className="min-w-0 truncate">{expense.description}</span>
              <Amount
                className="shrink-0 font-medium"
                minorUnits={expense.minorUnits}
                currency={expense.currency}
              />
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-auto flex flex-col gap-2">
        <Button className={PRIMARY} onClick={onConfirm}>
          {t("yes")}
        </Button>
        <Button variant="ghost" className={PRIMARY} onClick={onReject}>
          {t("no")}
        </Button>
      </div>
    </div>
  );
}

export function AccountScreen({
  groupName,
  inviterName,
  claiming,
  identityName,
  email,
  password,
  error,
  pending,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: {
  groupName: string;
  inviterName: string | null;
  claiming: boolean;
  identityName: string;
  email: string;
  password: string;
  error: string | null;
  pending: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const t = useTranslations("joinGroup.account");
  const ready = email.includes("@") && password.length >= 8;

  return (
    <form
      className="flex flex-1 flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !pending) onSubmit();
      }}
    >
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-xl leading-tight font-semibold tracking-[-0.02em] text-pretty">
          {claiming ? t("titleClaim") : t("titleNew")}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {claiming ? t("ledeClaim") : t("ledeNew")}
        </p>
      </div>

      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
        <Avatar size="sm">
          <AvatarFallback className="bg-accent text-accent-foreground">
            {initialsOf(identityName)}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {identityName}
        </span>
        <Badge variant="secondary">
          {claiming ? t("badgeClaim") : t("badgeNew")}
        </Badge>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="join-email">{t("email")}</Label>
          <Input
            id="join-email"
            name="email"
            type="email"
            autoComplete="email"
            className={FIELD}
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="join-password">{t("password")}</Label>
          <Input
            id="join-password"
            name="password"
            type="password"
            autoComplete="new-password"
            className={FIELD}
            placeholder={t("passwordPlaceholder")}
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t("passwordHelp")}</p>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-2.5">
        <Button
          type="submit"
          className={PRIMARY}
          disabled={!ready || pending}
          aria-busy={pending}
        >
          {claiming ? t("submitClaim") : t("submitNew", { group: groupName })}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {claiming
            ? inviterName
              ? t("footnoteClaimFrom", {
                  inviter: inviterName,
                  member: identityName,
                })
              : t("footnoteClaim", { member: identityName })
            : t("footnoteNew")}
        </p>
      </div>
    </form>
  );
}

export function DoneScreen({
  groupId,
  groupName,
  claimed,
  identityName,
  balances,
  verificationRequired,
  email,
}: {
  groupId: string;
  groupName: string;
  claimed: boolean;
  identityName: string;
  balances: readonly { currency: string; minorUnits: string }[];
  verificationRequired: boolean;
  email: string;
}) {
  const t = useTranslations("joinGroup.done");

  return (
    <div className="flex flex-1 flex-col items-center gap-5 pt-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-positive/15 text-positive">
        <Check aria-hidden="true" className="size-6" />
      </span>

      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl leading-tight font-semibold tracking-[-0.02em] text-pretty">
          {claimed
            ? t("titleClaim", { name: firstNameOf(identityName) })
            : t("titleNew")}
        </h1>
        <p className="max-w-[26ch] text-sm text-pretty text-muted-foreground">
          {claimed ? t("ledeClaim") : t("ledeNew", { group: groupName })}
        </p>
      </div>

      {/*
        Only on the claim path. A brand-new member has nothing to show, and a
        card reading "settled up" would be an answer to a question nobody
        asked — so it is omitted rather than rendered empty.
      */}
      {claimed && balances.length > 0 && (
        <Card className="w-full gap-1.5 p-4 text-left">
          {balances.map((balance) => (
            <div key={balance.currency} className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">
                {t("balanceLabel", { currency: balance.currency })}
              </p>
              <BalanceAmount
                minorUnits={balance.minorUnits}
                currency={balance.currency}
                size="large"
                showLabel={false}
              />
            </div>
          ))}
        </Card>
      )}

      {verificationRequired && (
        <Alert className="text-left">
          <Info aria-hidden="true" />
          <AlertTitle>{t("verifyTitle")}</AlertTitle>
          <AlertDescription>
            {t("verifyBody", { email, group: groupName })}
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-auto w-full">
        {/*
          A full page load rather than a client navigation: the session cookie
          was set by the action that just ran, and the group's layout has to be
          rendered by a request that carries it.
        */}
        <Button asChild className={PRIMARY} disabled={verificationRequired}>
          <a href={verificationRequired ? "/sign-in" : `/groups/${groupId}`}>
            {t("open", { group: groupName })}
          </a>
        </Button>
      </div>
    </div>
  );
}

/**
 * A link that was revoked, expired, or never existed.
 *
 * Shares its wording with `/join/error`, which is where the entry route sends
 * a bad token. This one exists because reaching `/join/start` with no usable
 * cookie has to be answered in place — that page cannot redirect without
 * clobbering a finished flow, as it explains at length.
 */
export function DeadLinkScreen() {
  const t = useTranslations("joinError");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-5 px-5 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Info aria-hidden="true" className="size-6" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl leading-tight font-semibold tracking-[-0.02em] text-pretty">
          {t("reasons.invalid.title")}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {t("reasons.invalid.body")}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild variant="outline">
          <Link href="/">{t("home")}</Link>
        </Button>
        <Button asChild>
          <Link href="/sign-in">{t("signIn")}</Link>
        </Button>
      </div>
    </div>
  );
}

export function TakenScreen() {
  const t = useTranslations("joinGroup.taken");

  return (
    <div className="flex flex-1 flex-col items-center gap-5 pt-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Info aria-hidden="true" className="size-6" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl leading-tight font-semibold tracking-[-0.02em] text-pretty">
          {t("title")}
        </h1>
        <p className="max-w-[30ch] text-sm text-pretty text-muted-foreground">
          {t("body")}
        </p>
      </div>
      <div className="mt-auto w-full">
        <Button asChild className={PRIMARY}>
          <a href="/sign-in">{t("signIn")}</a>
        </Button>
      </div>
    </div>
  );
}
