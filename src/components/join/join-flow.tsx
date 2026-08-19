"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { finishJoinAction, type JoinResult } from "@/modules/join/actions";
import { suggestMatch } from "@/modules/join/matching";
import { cn } from "@/lib/utils";
import {
  AccountScreen,
  ConfirmScreen,
  DeadLinkScreen,
  DoneScreen,
  InviteScreen,
  MatchScreen,
  NameScreen,
  TakenScreen,
} from "./screens";
import type { JoinMemberView, JoinScreen, JoinSummaryView } from "./types";

/**
 * The join flow.
 *
 * One decision, spread over six screens: is this person a name the group
 * already carries, or somebody new? Everything before the last screen is local
 * — no request is made while the reader types their name or browses the list,
 * because the whole candidate list came down with the page and the matching
 * runs here.
 *
 * The steps are numbered 1–3 rather than 1–6 because `match` and `confirm` are
 * one decision seen twice, and `account` is reached from either side of it.
 * That is why `step` is a lookup rather than an index into the screen order.
 */

const STEPS: Record<JoinScreen, number> = {
  invite: 0,
  name: 1,
  match: 2,
  confirm: 2,
  account: 3,
  done: 3,
};

const TOTAL_STEPS = 3;

/** Stable empty list, so the memos below do not see a new array each render. */
const NO_MEMBERS: readonly JoinMemberView[] = [];

export function JoinFlow({
  summary,
  inviterName = null,
  members = [],
  linkGone = false,
}: {
  summary?: JoinSummaryView;
  inviterName?: string | null;
  members?: readonly JoinMemberView[];
  /**
   * The cookie no longer resolves to a live link. On a fresh arrival that is
   * a dead link; after a successful join it is simply the spent cookie, and
   * the state below has already moved past caring.
   */
  linkGone?: boolean;
}) {
  const t = useTranslations("joinGroup.header");
  const tErrors = useTranslations("serverErrors");
  const [screen, setScreen] = useState<JoinScreen>("invite");
  const [name, setName] = useState("");
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JoinResult | null>(null);
  const [pending, startTransition] = useTransition();

  /*
   * The group's facts, captured once and then held.
   *
   * Finishing the flow spends the join cookie, so the re-render that a Server
   * Action triggers arrives with no group to describe. Keeping the first
   * render's copy in state is what lets the last screen still name the group
   * the reader just joined. It also means a link that dies mid-flow does not
   * yank the screens out from under somebody halfway through a decision.
   */
  const [initial] = useState(() =>
    summary && !linkGone ? { summary, inviterName, members } : null,
  );

  const candidates = initial?.members ?? NO_MEMBERS;

  const suggestion = useMemo(() => {
    if (candidates.length === 0) return null;
    const match = suggestMatch(
      name,
      candidates.map((member) => ({ id: member.id, name: member.displayName })),
    );
    return match
      ? (candidates.find((member) => member.id === match.candidate.id) ?? null)
      : null;
  }, [name, candidates]);

  const others = useMemo(
    () => candidates.filter((member) => member.id !== suggestion?.id),
    [candidates, suggestion],
  );

  const chosen = candidates.find((member) => member.id === chosenId) ?? null;

  // Back is a map rather than a history stack: `account` is reached from two
  // places and has to return to the one it came from, which a stack of screens
  // would get right only by accident.
  const back: Partial<Record<JoinScreen, JoinScreen>> = {
    name: "invite",
    match: "name",
    confirm: "match",
    account: isNew ? "match" : "confirm",
  };
  const previous = back[screen];
  const step = STEPS[screen];
  const finished = screen === "done";

  // Nothing was ever loaded, so there is no flow to run — a link that was
  // revoked, expired, or never existed. Every hook above has already run, so
  // returning here keeps their order stable.
  if (!initial) return <DeadLinkScreen />;
  const { summary: group, inviterName: inviter } = initial;

  function goBack() {
    if (!previous) return;
    setError(null);
    // Stepping back off the account screen un-decides what it was about to do,
    // so the next arrival there cannot inherit a stale choice.
    if (screen === "account") setIsNew(false);
    if (screen === "confirm") setChosenId(null);
    setScreen(previous);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const outcome = await finishJoinAction({
        email: email.trim(),
        password,
        name: chosen ? chosen.displayName : name.trim(),
        participantId: chosen?.id ?? null,
      });
      if (!outcome.ok || !outcome.data) {
        setError(outcome.error ?? tErrors("generic"));
        return;
      }
      setResult(outcome.data);
      setScreen("done");
    });
  }

  const identityName = chosen ? chosen.displayName : name.trim();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-6">
      <header className="flex items-center gap-3 pt-4 pb-3.5">
        {previous && !finished ? (
          <button
            type="button"
            onClick={goBack}
            aria-label={t("back")}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-muted"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div
            className="h-1 overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={TOTAL_STEPS}
            aria-valuenow={step}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
              style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>
        <span className="text-[0.6875rem] font-semibold tracking-[0.06em] whitespace-nowrap text-muted-foreground uppercase">
          {screen === "invite"
            ? t("stepInvitation")
            : finished
              ? t("stepDone")
              : t("stepOf", { step, total: TOTAL_STEPS })}
        </span>
      </header>

      {/*
        Keyed on the screen so each entry animates, and so React discards the
        previous screen's DOM rather than reconciling two different forms into
        one another.
      */}
      <main
        key={screen}
        className={cn(
          "flex flex-1 flex-col pt-2",
          "motion-safe:slide-in-from-bottom-1.5 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in",
        )}
      >
        {screen === "invite" && (
          <InviteScreen
            summary={group}
            inviterName={inviter}
            onStart={() => setScreen("name")}
          />
        )}

        {screen === "name" && (
          <NameScreen
            groupName={group.groupName}
            value={name}
            onChange={setName}
            onContinue={() => setScreen("match")}
          />
        )}

        {screen === "match" && (
          <MatchScreen
            suggestion={suggestion}
            others={others}
            onPick={(member) => {
              setChosenId(member.id);
              setIsNew(false);
              setScreen("confirm");
            }}
            onAddMe={() => {
              setChosenId(null);
              setIsNew(true);
              setScreen("account");
            }}
          />
        )}

        {screen === "confirm" && chosen && (
          <ConfirmScreen
            member={chosen}
            onConfirm={() => setScreen("account")}
            onReject={() => {
              setChosenId(null);
              setScreen("match");
            }}
          />
        )}

        {screen === "account" && (
          <AccountScreen
            groupName={group.groupName}
            inviterName={inviter}
            claiming={!isNew && chosen !== null}
            identityName={identityName}
            email={email}
            password={password}
            error={error}
            pending={pending}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onSubmit={submit}
          />
        )}

        {finished &&
          result &&
          (result.taken ? (
            <TakenScreen />
          ) : (
            <DoneScreen
              groupId={result.groupId}
              groupName={group.groupName}
              claimed={result.claimed}
              identityName={identityName}
              balances={chosen?.balances ?? []}
              verificationRequired={result.verificationRequired}
              email={email.trim()}
            />
          ))}
      </main>
    </div>
  );
}
