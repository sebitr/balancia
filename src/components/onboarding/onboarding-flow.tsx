"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { firstNameOf } from "@/components/join/types";
import {
  joinAsGuestAction,
  joinWithAccountAction,
} from "@/modules/join/actions";
import {
  nextScreen,
  previousScreen,
  progressOf,
  routeFor,
  STEP_LABEL_KEYS,
  type Arrival,
  type Intent,
  type ScreenId,
} from "./route";
import { checklistIsComplete } from "./checklist";
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
import type {
  JoinMemberView,
  OnboardingGroupView,
  OnboardingProfileView,
} from "./types";

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
  arrival: arrivalProp,
  group,
  members = [],
  inviterName = null,
  knownName = "",
  registrationAllowed = true,
  codeSignupAvailable = true,
  linkGone = false,
  account = null,
  profile = null,
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
   * The account already signed in in this browser, if there is one.
   *
   * Which is three different situations wearing one prop, and what to do about
   * it is `arrival`'s to say. On a **shared** link it is the good case: this is
   * the person the link was sent to, holding an account already, so the flow
   * uses it and skips asking for one. On a **personal** invitation it is either
   * somebody who arrived signed in — nothing here is for them — or somebody who
   * signed in *during* the flow and is still standing on it. The difference
   * between those last two is only *when* it became true, so it is acted on
   * once, on mount, and never again — see below.
   */
  account?: { readonly name: string; readonly email: string } | null;
  /**
   * What that account has already set up: a photo, currencies, a payout
   * method, a device registered for push.
   *
   * Null when there is nothing to read it from — a guest, or an account this
   * flow is about to create. The checklist is seeded from it rather than from
   * zero, and a reader with all four already done never sees that screen.
   */
  profile?: OnboardingProfileView | null;
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

  /*
   * The account this browser walked in with, captured on the first render.
   *
   * Held rather than read, for the same reason `initialGroup` below is: every
   * Server Action re-renders the page this flow is mounted on, and the pages
   * resolve the account from a cookie that the flow itself may have just
   * spent. A prop that flips mid-flow would change the *route* under somebody
   * standing on it. When it became true is the whole question, so it is
   * answered once.
   */
  const [arrivedWith] = useState(account);
  const signedIn = arrivedWith !== null;

  /*
   * How this person got here, captured on the first render for the same
   * reason, and the one that decides the whole route.
   *
   * `/register` is the page that can change its mind: it reads the actor to
   * choose between the personal arrival — a guest, with the group they are a
   * guest of behind them — and the cold one. Claiming the account is exactly
   * what turns the first into the second, and the profile screen's rename is
   * a Server Action, so the page re-renders with the new answer while the
   * reader is still standing on the flow.
   *
   * Read live, that pulled the last two screens out of the route from under
   * them: a cold arrival has no arrival screen and no checklist, so "See the
   * group" stopped leading to the list that says the account now exists and
   * left for the group instead. How somebody arrived is a fact about the past
   * and cannot stop being true halfway along.
   *
   * The prop is shadowed rather than renamed throughout on purpose: nothing
   * below can reach the live one by accident, and a use added later reads the
   * held copy without anybody having to know this paragraph exists.
   */
  const [arrival] = useState(arrivalProp);

  const [intent, setIntent] = useState<Intent>(
    // Somebody holding an account has already answered this, whatever the
    // instance allows. Nothing asks them again.
    signedIn ? "signin" : registrationAllowed ? "account" : "signin",
  );
  const [screen, setScreen] = useState<ScreenId>("welcome");
  const [name, setName] = useState(knownName || (arrivedWith?.name ?? ""));
  const [claimed, setClaimed] = useState<JoinMemberView | null>(null);
  const [isNewMember, setIsNewMember] = useState(false);
  /** Which way in was actually taken, for the checklist's first receipt. */
  const [credential, setCredential] = useState<"passkey" | "code" | null>(null);
  const [email, setEmail] = useState(arrivedWith?.email ?? "");
  /** The group joined at the end of a shared link, once it is known. */
  const [joinedGroupId, setJoinedGroupId] = useState<string | null>(null);
  /** The join a signed-in account commits, while it is in flight. */
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

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

  /*
   * The account's existing setup, from whichever render could see it.
   *
   * It goes both ways, which is why neither the prop nor a captured copy is
   * enough on its own. A shared link is read on the first render and gone by
   * the second: finishing spends the cookie, and the page that re-renders has
   * no session to load a profile from. A personal invitation is the mirror —
   * there is no account at all until somebody signs in halfway through, and
   * only then can it be read. Preferring the live one and falling back on the
   * first answers both, and the pair cannot disagree: a profile is only ever
   * null-then-present or present-then-null, never one account then another.
   */
  const [profileAtArrival] = useState(profile);
  const initialProfile = profile ?? profileAtArrival;

  /*
   * Whether the checklist has anything left to say.
   *
   * Computed from the same rows the screen would draw, so the question and
   * the answer cannot drift apart. A guest is never complete — their account
   * row is urgent, not done — which is why `intent` is part of it.
   */
  const profileIsComplete = useMemo(
    () =>
      initialProfile !== null &&
      checklistIsComplete({
        isGuest: intent === "guest",
        credential,
        email: email || null,
        hasPhoto: initialProfile.hasPhoto,
        name,
        currencies: initialProfile.currencies,
        payouts: initialProfile.payouts.map((payout) => payout.method),
        notificationsOn: 5,
        notificationCount: 5,
        pushEnabled: initialProfile.pushEnabled,
      }),
    [initialProfile, intent, credential, email, name],
  );

  /*
   * A screen somebody is standing on is never dropped from under them.
   *
   * The route says what comes *next*, and finishing the rows from inside the
   * checklist is exactly how somebody on it becomes complete. Without this,
   * ticking the last one would take the screen out of its own route — leaving
   * the progress bar measuring against a list that no longer contains it.
   */
  const setupComplete = screen !== "checklist" && profileIsComplete;

  const route = useMemo(
    () => routeFor({ arrival, intent, isNewMember, signedIn, setupComplete }),
    [arrival, intent, isNewMember, signedIn, setupComplete],
  );

  const previous = previousScreen(route, screen);
  /*
   * The last screen of whichever route this is, rather than a named one.
   *
   * It used to name `checklist` and `firstGroup`, which stopped being the
   * whole answer when a finished checklist started dropping out: the arrival
   * screen is the end of the road for somebody who has nothing left to set
   * up, and offering them a back button to un-claim a name they have already
   * claimed is not a place to return to.
   *
   * The one last screen that is not an ending is the identity screen, where a
   * cold sign-in's route stops: nothing has been committed there until the
   * credential lands, so the way back to the welcome stays open.
   */
  const finished = nextScreen(route, screen) === null && screen !== "identity";
  const groupId = joinedGroupId ?? initialGroup?.groupId ?? null;
  /** A shared link finished by an account that already existed. */
  const joinsWithAccount = signedIn && arrival === "shared";

  /*
   * Turning away a reader who was already signed in when they arrived.
   *
   * This cannot be the page's job, and the attempt is what made it necessary.
   * Every Server Action re-renders the page it was called from, so a
   * `redirect()` on the server would fire the moment anything in this flow
   * created a session — throwing somebody to the dashboard from the middle of
   * their own signup, one screen short of their balance. The pages therefore
   * hand the account down and this decides, on mount and only on mount: by the
   * time an action has run, the effect below has long since not fired.
   *
   * A shared link is the exception, and the only one. Its screens are exactly
   * what a signed-in reader needs — which of these names is you — so they run
   * the flow rather than being bounced to a dashboard that says nothing about
   * the group they were just invited to.
   */
  useEffect(() => {
    if (signedIn && arrival !== "shared") router.replace("/dashboard");
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
    if (screen === "confirm") setClaimed(null);
    if (screen === "profile" && arrival === "shared") setIsNewMember(false);
    setJoinError(null);
    advance(previous);
  };

  /**
   * Joining as the account already in this browser, which is the whole of the
   * flow for somebody who arrived signed in.
   *
   * Returns the sentence to show, or null when it worked — the two screens
   * that commit report it differently, and neither of them should have to know
   * what the other does. Nothing advances from here: the caller does, because
   * only the caller knows which screen it is leaving.
   */
  const joinWithAccount = async (member: {
    participantId: string | null;
    displayName: string;
  }): Promise<string | null> => {
    setJoinError(null);
    setJoining(true);
    const result = await joinWithAccountAction(member);
    setJoining(false);
    if (!result.ok || !result.data) {
      const message = result.error ?? t("joinFailed");
      setJoinError(message);
      return message;
    }
    setJoinedGroupId(result.data.groupId);
    return null;
  };

  /**
   * Joining as a guest, which on a shared link is the whole of the join.
   *
   * A personal invitation has already spent its token into a guest session
   * by the time its flow starts, so its guest has nothing to commit here. A
   * shared link carries no identity at all: choosing "guest" on it is the
   * moment the participant, the invitation and the session come to exist —
   * and until this ran, they never did, which is how "Go to the group" used
   * to open the sign-in page.
   */
  const joinAsGuest = async (): Promise<boolean> => {
    setJoinError(null);
    setJoining(true);
    const result = await joinAsGuestAction({
      participantId: claimed?.id ?? null,
      displayName: name,
    });
    setJoining(false);
    if (!result.ok || !result.data) {
      setJoinError(result.error ?? t("joinFailed"));
      return false;
    }
    setJoinedGroupId(result.data.groupId);
    return true;
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
            className="tap-target flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-muted"
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
            accountName={arrivedWith?.name ?? null}
            registrationAllowed={registrationAllowed}
            guestOffered={!alreadyGuest}
            onChoose={(chosen) => {
              setIntent(chosen);
              advance(
                routeFor({
                  arrival,
                  intent: chosen,
                  isNewMember,
                  signedIn,
                  setupComplete,
                })[1] ?? "arrival",
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
              // Held whole rather than by id. The list is a prop, and every
              // Server Action re-renders the page that supplied it — by which
              // time the join cookie is spent and the list comes back empty.
              // A screen that names the person they just claimed cannot be
              // looking them up in it.
              setClaimed(member);
              setIsNewMember(false);
              setName(member.displayName);
              advance("confirm");
            }}
            onNewHere={() => {
              setClaimed(null);
              setIsNewMember(true);
              // Back to whatever was known before a name was picked, which is
              // the account's own for somebody signed in and nothing at all
              // for everybody else.
              setName(knownName || (arrivedWith?.name ?? ""));
              advance("profile");
            }}
          />
        )}

        {screen === "confirm" && claimed && (
          <ConfirmScreen
            member={claimed}
            inviterName={inviterName}
            busy={joining}
            error={joinError}
            onConfirm={() => {
              // For everybody else this only says "yes"; for an account that
              // is already signed in it is the join itself, because there is
              // no credential screen left to carry it.
              if (!joinsWithAccount) {
                advance("keepIt");
                return;
              }
              void joinWithAccount({
                participantId: claimed.id,
                displayName: claimed.displayName,
              }).then((failed) => {
                if (!failed) advance("arrival");
              });
            }}
            onReject={() => {
              setClaimed(null);
              setJoinError(null);
              advance("whichOne");
            }}
          />
        )}

        {screen === "keepIt" && (
          <KeepItScreen
            name={name}
            expenseCount={claimed?.expenseCount ?? 0}
            registrationAllowed={registrationAllowed}
            busy={joining}
            error={joinError}
            onChoose={(chosen) => {
              setIntent(chosen);
              if (chosen !== "guest") {
                advance("identity");
                return;
              }
              // The guest option commits here: there is no credential screen
              // after it to carry the join, so the join is this tap.
              void joinAsGuest().then((joined) => {
                if (joined) advance("arrival");
              });
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
                ? { participantId: claimed?.id ?? null, displayName: name }
                : undefined
            }
            onDone={(outcome) => {
              setCredential(outcome.credential);
              if (outcome.joinedGroupId)
                setJoinedGroupId(outcome.joinedGroupId);
              if (outcome.claimedGroupId) {
                setJoinedGroupId(outcome.claimedGroupId);
              }
              const next = routeFor({
                arrival,
                intent,
                isNewMember,
                signedIn,
                setupComplete,
              });
              const index = next.indexOf("identity");
              const following = next[index + 1];
              // A cold sign-in's route ends here: the account exists, its
              // groups are on the dashboard, and that is the welcome.
              if (following) advance(following);
              else leave();
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
            /**
             * An account exists by now on every route but the guest ones —
             * either this flow just made one, or the reader walked in with it.
             */
            hasAccount={credential !== null || signedIn}
            /*
              A signed-in reader who was on nobody's list types the name the
              *group* will know them by, so the primary files a new member
              under it rather than renaming their account. Everybody else has
              no group to be added to yet, and the plain path applies.
            */
            onSubmit={
              joinsWithAccount
                ? (typed) =>
                    joinWithAccount({
                      participantId: null,
                      displayName: typed,
                    })
                : undefined
            }
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
            joinedWithAccount={joinsWithAccount}
            name={firstNameOf(name)}
            group={initialGroup}
            /*
              The checklist, or the group itself when there is no checklist
              left to show. Read off the route rather than named, so the two
              cannot disagree about which screen comes after this one.
            */
            onContinue={() => {
              const next = nextScreen(route, "arrival");
              if (next) advance(next);
              else leave();
            }}
          />
        )}

        {screen === "checklist" && (
          <ChecklistScreen
            group={initialGroup}
            profile={initialProfile}
            isGuest={intent === "guest"}
            credential={credential}
            email={email}
            name={name}
            onLeave={leave}
          />
        )}

        {screen === "firstGroup" && (
          <FirstGroupScreen
            name={firstNameOf(name)}
            /*
              Straight into the sheet, not onto a dashboard that says "No
              groups yet" a second time with the same button under it. The
              dashboard opens its create sheet for `?new`, so the first thing
              on screen is the one field that matters.
            */
            onLeave={() => {
              router.push("/dashboard?new");
              router.refresh();
            }}
          />
        )}
      </main>
    </div>
  );
}
