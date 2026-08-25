"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { firstNameOf } from "@/components/join/types";
import {
  previousScreen,
  progressOf,
  routeFor,
  STEP_LABEL_KEYS,
  type Arrival,
  type Intent,
  type ScreenId,
} from "./route";
import { DeadLinkScreen } from "./dead-link-screen";
import { IdentityScreen } from "./identity-screen";
import { ChecklistScreen } from "./checklist-screen";
import {
  ArrivalScreen,
  ConfirmScreen,
  FirstGroupScreen,
  KeepItScreen,
  ProfileScreen,
  WelcomeScreen,
  WhichOneScreen,
} from "./screens";
import type { JoinMemberView, OnboardingGroupView } from "./types";

/**
 * Everything between arriving at Balancia and standing on a group screen with
 * a balance on it.
 *
 * One state machine over three arrivals, mounted at three URLs: the invitation
 * screen, the shared-link screen, and registration. What differs between them
 * is what the server could load, which is why every piece of group data here
 * is nullable and why `arrival` is a prop rather than something inferred.
 *
 * The order of the screens is not kept here — `route.ts` derives it, and the
 * back button is that list read backwards. What is kept here is what the
 * reader has said, and it is deliberately flat: nine pieces of state, none of
 * them a screen name, so no two of them can disagree about where somebody is.
 *
 * Only identity blocks the door. Currencies, notifications, payout details and
 * everything else that used to be asked before an account existed are asked
 * from the checklist at the end, or from the moment they pay off.
 */
export function OnboardingFlow({
  arrival,
  group,
  members = [],
  inviterName = null,
  knownName = "",
  registrationAllowed = true,
  codeSignupAvailable = true,
  linkGone = false,
  signedIn = false,
  alreadyGuest = false,
}: {
  arrival: Arrival;
  /** Null for a cold arrival, which has no group behind it. */
  group: OnboardingGroupView | null;
  /** The unclaimed names a shared link offers. Empty for the other arrivals. */
  members?: readonly JoinMemberView[];
  inviterName?: string | null;
  /** The name the group already knows this person by, on a personal invite. */
  knownName?: string;
  /** False on an instance that has closed registration. */
  registrationAllowed?: boolean;
  /** False without a mail server: no code can be sent, so none is offered. */
  codeSignupAvailable?: boolean;
  /**
   * The cookie no longer resolves to a live link.
   *
   * On a fresh arrival that is a dead link; after a finished flow it is simply
   * the spent cookie, and the state below has already moved past caring.
   */
  linkGone?: boolean;
  /**
   * There is already a signed-in account in this browser.
   *
   * Which is two different situations wearing one prop, and only the first is
   * a reason to leave: somebody who arrived signed in has no onboarding to do,
   * while somebody who signed in *during* the flow is still standing on it.
   * The difference is when it became true, so it is acted on once, on mount,
   * and never again — see below.
   */
  signedIn?: boolean;
  /**
   * This browser is already holding a guest session for the group below.
   *
   * They came here to stop being a guest, so the third option is not offered —
   * it is what they already have, and a button that changes nothing is worse
   * than no button.
   */
  alreadyGuest?: boolean;
}) {
  const t = useTranslations("onboarding");
  const router = useRouter();

  const [intent, setIntent] = useState<Intent>(
    registrationAllowed ? "account" : "signin",
  );
  const [screen, setScreen] = useState<ScreenId>("welcome");
  const [name, setName] = useState(knownName);
  const [claimedId, setClaimedId] = useState<string | null>(null);
  const [isNewMember, setIsNewMember] = useState(false);
  /** Which way in was actually taken, for the checklist's first receipt. */
  const [credential, setCredential] = useState<"passkey" | "code" | null>(null);
  const [email, setEmail] = useState("");
  /** The group joined at the end of a shared link, once it is known. */
  const [joinedGroupId, setJoinedGroupId] = useState<string | null>(null);

  /*
   * The group's facts, captured on the first render and then held.
   *
   * Finishing spends the link, so the re-render a Server Action triggers
   * arrives with no group left to describe. Holding the first copy is what
   * lets the last screens still name the group somebody just joined — and it
   * means a link that dies mid-flow does not yank the screens out from under
   * somebody halfway through a decision.
   */
  const [initialGroup] = useState(linkGone ? null : group);

  const route = useMemo(
    () => routeFor({ arrival, intent, isNewMember }),
    [arrival, intent, isNewMember],
  );

  const previous = previousScreen(route, screen);
  const finished = screen === "checklist" || screen === "firstGroup";
  const claimed = members.find((member) => member.id === claimedId) ?? null;
  const groupId = joinedGroupId ?? initialGroup?.groupId ?? null;

  /*
   * Turning away a reader who was already signed in when they arrived.
   *
   * This cannot be the page's job, and the attempt is what made it necessary.
   * Every Server Action re-renders the page it was called from, so a
   * `redirect()` on the server would fire the moment anything in this flow
   * created a session — throwing somebody to the dashboard from the middle of
   * their own signup, one screen short of their balance. The pages therefore
   * hand the fact down and this decides, on mount and only on mount: by the
   * time an action has run, the effect below has long since not fired.
   */
  const arrivedSignedIn = useRef(signedIn);
  useEffect(() => {
    if (arrivedSignedIn.current) router.replace("/dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advance = useCallback((to: ScreenId) => {
    setScreen(to);
    // A new screen is a new first field, and the header may have gained a
    // back button. Both are below the fold on a short phone otherwise.
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  }, []);

  const goBack = () => {
    if (!previous) return;
    // Stepping back off a screen un-decides what it was about to do, so the
    // next arrival cannot inherit a stale choice from the last one.
    if (screen === "confirm") setClaimedId(null);
    if (screen === "profile" && arrival === "shared") setIsNewMember(false);
    advance(previous);
  };

  /** Where a route ends: the group it produced, or the dashboard. */
  const leave = () => {
    router.push(groupId ? `/groups/${groupId}` : "/dashboard");
    router.refresh();
  };

  const stepLabel = t(STEP_LABEL_KEYS[screen] as Parameters<typeof t>[0]);

  /*
   * Nothing was ever loaded, so there is no flow to run.
   *
   * Every hook above has already run, which is what keeps their order stable
   * across this return. A link that dies *during* the flow does not land here:
   * `initialGroup` was captured on the first render and is held, so finishing
   * the flow — which spends the cookie — cannot pull the screens out from
   * under somebody who has already arrived.
   */
  if (arrival === "shared" && !initialGroup) return <DeadLinkScreen />;

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
            aria-valuemax={100}
            aria-valuenow={Math.round(progressOf(route, screen) * 100)}
            aria-label={stepLabel}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
              style={{ width: `${progressOf(route, screen) * 100}%` }}
            />
          </div>
        </div>
        <span className="text-2xs font-semibold tracking-[0.07em] whitespace-nowrap text-muted-foreground uppercase">
          {stepLabel}
        </span>
      </header>

      {/*
        Keyed on the screen so React discards the previous screen's DOM rather
        than reconciling two different forms into one another — a name field
        and an email field are not the same field with different labels.
      */}
      <main
        key={screen}
        className={cn(
          "flex flex-1 flex-col pt-2",
          "motion-safe:slide-in-from-bottom-1.5 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in",
        )}
      >
        {screen === "welcome" && (
          <WelcomeScreen
            arrival={arrival}
            group={initialGroup}
            inviterName={inviterName}
            registrationAllowed={registrationAllowed}
            guestOffered={!alreadyGuest}
            onChoose={(chosen) => {
              setIntent(chosen);
              advance(
                routeFor({ arrival, intent: chosen, isNewMember })[1] ??
                  "arrival",
              );
            }}
            onFindMyself={() => advance("whichOne")}
          />
        )}

        {screen === "whichOne" && (
          <WhichOneScreen
            members={members}
            typedName={name}
            onPick={(member) => {
              setClaimedId(member.id);
              setIsNewMember(false);
              setName(member.displayName);
              advance("confirm");
            }}
            onNewHere={() => {
              setClaimedId(null);
              setIsNewMember(true);
              setName("");
              advance("profile");
            }}
          />
        )}

        {screen === "confirm" && claimed && (
          <ConfirmScreen
            member={claimed}
            inviterName={inviterName}
            onConfirm={() => advance("keepIt")}
            onReject={() => {
              setClaimedId(null);
              advance("whichOne");
            }}
          />
        )}

        {screen === "keepIt" && (
          <KeepItScreen
            name={name}
            expenseCount={claimed?.expenseCount ?? 0}
            registrationAllowed={registrationAllowed}
            onChoose={(chosen) => {
              setIntent(chosen);
              advance(chosen === "guest" ? "arrival" : "identity");
            }}
          />
        )}

        {screen === "identity" && (
          <IdentityScreen
            intent={intent}
            name={name}
            email={email}
            onEmailChange={setEmail}
            codeSignupAvailable={codeSignupAvailable}
            join={
              arrival === "shared"
                ? { participantId: claimedId, displayName: name }
                : undefined
            }
            onDone={(outcome) => {
              setCredential(outcome.credential);
              if (outcome.joinedGroupId)
                setJoinedGroupId(outcome.joinedGroupId);
              if (outcome.claimedGroupId) {
                setJoinedGroupId(outcome.claimedGroupId);
              }
              const next = routeFor({ arrival, intent, isNewMember });
              const index = next.indexOf("identity");
              advance(next[index + 1] ?? "arrival");
            }}
          />
        )}

        {screen === "profile" && (
          <ProfileScreen
            arrival={arrival}
            intent={intent}
            isNewMember={isNewMember}
            name={name}
            onNameChange={setName}
            /** An account exists by now on every route but the guest ones. */
            hasAccount={credential !== null}
            onDone={() => {
              const index = route.indexOf("profile");
              advance(route[index + 1] ?? "arrival");
            }}
          />
        )}

        {screen === "arrival" && (
          <ArrivalScreen
            intent={intent}
            claimed={claimed}
            name={firstNameOf(name)}
            group={initialGroup}
            onContinue={() => advance("checklist")}
          />
        )}

        {screen === "checklist" && (
          <ChecklistScreen
            group={initialGroup}
            isGuest={intent === "guest"}
            credential={credential}
            email={email}
            name={name}
            onLeave={leave}
          />
        )}

        {screen === "firstGroup" && (
          <FirstGroupScreen name={firstNameOf(name)} onLeave={leave} />
        )}
      </main>
    </div>
  );
}
