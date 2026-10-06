"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { firstNameOf } from "@/components/join/types";
import {
  joinAsGuestAction,
  joinWithAccountAction,
} from "@/modules/join/actions";
import { recordOnboardingStep } from "./funnel";
import { startGroupAsGuestAction } from "@/modules/groups/actions";
import { usePasskeySupport } from "@/components/auth/use-passkey-support";
import { GroupReady } from "@/components/groups/group-ready";
import { useDetectedTimezone } from "@/components/groups/use-detected-timezone";
import { defaultCurrency } from "@/modules/currencies/default-currency";
import { currencyOfTimezone } from "@/modules/currencies/device-currency";
import {
  ENDINGS,
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
  FirstGroupScreen,
  KeepItScreen,
  ProfileScreen,
  StartGroupScreen,
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
 * reader has said, and it is deliberately flat: none of it is a screen name,
 * so no two pieces of it can disagree about where somebody is.
 *
 * Only identity blocks the door. Currencies, notifications, payout details and
 * everything else that used to be asked before an account existed are asked
 * from the checklist at the end of a personal invitation taken with an
 * account, from settings, or from the moment they pay off. A shared link and a
 * guest ask none of them: they end in the group, the moment the join commits.
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
  // A shared link opens straight onto its list; everybody else on a welcome.
  const [screen, setScreen] = useState<ScreenId>(
    arrival === "shared" ? "whichOne" : "welcome",
  );
  const [name, setName] = useState(knownName || (arrivedWith?.name ?? ""));
  /** The listed name picked on a shared link; null for somebody new. */
  const [claimed, setClaimed] = useState<JoinMemberView | null>(null);
  /** Which way in was actually taken, for the checklist's first receipt. */
  const [credential, setCredential] = useState<
    "passkey" | "code" | "password" | null
  >(null);
  const [email, setEmail] = useState(arrivedWith?.email ?? "");
  /** The group the flow produced, once it is known. */
  const [joinedGroupId, setJoinedGroupId] = useState<string | null>(null);
  /** A join or a group start, while it is in flight. */
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  /*
   * The group's facts, captured on the first render and then held.
   *
   * Finishing spends the link, so the re-render a Server Action triggers
   * arrives with no group left to describe. Holding the first copy is what
   * lets the flow still name the group somebody just joined — and it means a
   * link that dies mid-flow does not yank the screens out from under somebody
   * halfway through a decision.
   */
  const [initialGroup] = useState(linkGone ? null : group);

  /*
   * The account's existing setup, from whichever render could see it.
   *
   * On a personal invitation there is no account at all until somebody signs
   * in halfway through, and only then can it be read — so the live prop is
   * preferred, and the first one kept for a render that has lost it. The pair
   * cannot disagree: a profile is only ever null-then-present or
   * present-then-null, never one account then another.
   */
  const [profileAtArrival] = useState(profile);
  const initialProfile = profile ?? profileAtArrival;

  /*
   * Whether the checklist has anything left to say.
   *
   * Computed from the same rows the screen would draw, so the question and
   * the answer cannot drift apart. Only an account ever reaches the list, so
   * nothing here has to speak for a guest.
   */
  const passkeysSupported = usePasskeySupport();
  const profileIsComplete = useMemo(
    () =>
      initialProfile !== null &&
      checklistIsComplete({
        credential,
        email: email || null,
        hasPhoto: initialProfile.hasPhoto,
        hasPasskey: initialProfile.hasPasskey,
        passkeyAdded: false,
        passkeysSupported,
        name,
        currencies: initialProfile.currencies,
        payouts: initialProfile.payouts.map((payout) => payout.method),
        notificationsOn: 5,
        notificationCount: 5,
        pushEnabled: initialProfile.pushEnabled,
      }),
    [initialProfile, credential, email, name, passkeysSupported],
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
    () => routeFor({ arrival, intent, signedIn, setupComplete }),
    [arrival, intent, signedIn, setupComplete],
  );

  const previous = previousScreen(route, screen);
  /*
   * The last screen of whichever route this is, when that screen is an ending.
   *
   * Being last used to be enough, until a finished checklist started dropping
   * out: the arrival screen is the end of the road for somebody who has
   * nothing left to set up, and offering them a back button to un-claim a
   * name they have already claimed is not a place to return to. Several
   * routes now stop on a screen where nothing is committed until the reader
   * acts — see `ENDINGS` — and those keep the way back.
   */
  const finished = nextScreen(route, screen) === null && ENDINGS.has(screen);
  const groupId = joinedGroupId ?? initialGroup?.groupId ?? null;
  const groupName = initialGroup?.summary.groupName ?? "";

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

  /*
   * The funnel, one count per screen reached.
   *
   * The first screen is counted once on mount, every later screen from
   * `advance`, and the exit from `leave`. Nothing waits on it and nothing
   * hears back: the operator's metrics endpoint is the only reader, and a
   * screen that could not be counted is still a screen.
   */
  useEffect(() => {
    recordOnboardingStep(arrival, screen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advance = useCallback(
    (to: ScreenId) => {
      setScreen(to);
      recordOnboardingStep(arrival, to);
      // A new screen is a new first field, and the header may have gained a
      // back button. Both are below the fold on a short phone otherwise.
      if (typeof window !== "undefined") window.scrollTo(0, 0);
    },
    [arrival],
  );

  /** The name somebody starts with before picking one off the list. */
  const unpickedName = knownName || (arrivedWith?.name ?? "");

  /**
   * Back to a shared link's list, having un-chosen the name.
   *
   * The name picked from the list goes with it, so the "none of these" row
   * does not offer the reader the name they have just said was not theirs. A
   * name somebody new typed is kept: it is theirs, and the row can say it.
   */
  const backToList = () => {
    if (claimed) setName(unpickedName);
    setClaimed(null);
    setJoinError(null);
    advance("whichOne");
  };

  /*
   * A shared link's two screens side by side, from `lg`.
   *
   * The desktop board "22 · Signed out on the group link" draws the list
   * beside "how do you want to join" once a name is picked, so a desk can see
   * what it chose from while it chooses how to come in. Nothing about the
   * route changes: the list opens alone, picking a name is still the step to
   * the second screen, and "Not you?" still goes back to the list alone.
   * Below `lg` the list beside it is `display: none`, so a phone renders the
   * second screen by itself, exactly as before.
   */
  const sideBySide =
    arrival === "shared" && screen === "keepIt" && initialGroup !== null;

  /**
   * Another name picked from the list beside the second screen: the screen
   * follows it in place. Still nothing committed, and no step counted — the
   * reader has not moved on, only changed their answer. Held while a join is
   * in flight, which has already named who it is joining.
   */
  const pickBeside = (member: JoinMemberView | null) => {
    if (joining) return;
    setName(member ? member.displayName : claimed ? unpickedName : name);
    setClaimed(member);
    setJoinError(null);
  };

  const goBack = () => {
    if (!previous) return;
    if (screen === "keepIt") {
      backToList();
      return;
    }
    setJoinError(null);
    advance(previous);
  };

  /** Where a route ends: the group it produced, or the dashboard. */
  const leaveFor = (to: string | null) => {
    recordOnboardingStep(arrival, "left");
    router.push(to ? `/groups/${to}` : "/dashboard");
    router.refresh();
  };
  const leave = () => leaveFor(groupId);

  /**
   * The end of a shared link, and of a personal invitation's guest: the group
   * itself, saying "you're in".
   *
   * A toast rather than a screen. The arrival screen and the checklist that
   * used to stand here were a receipt in front of the thing it was a receipt
   * for, and the group says the rest — the balance is its first line, and a
   * guest's card at the foot of it is what is left of the checklist. The
   * toaster lives in the root layout, so this outlasts the navigation.
   */
  const arrive = (joined: string) => {
    toast.success(t("joined.title", { group: groupName }), {
      description:
        claimed && claimed.expenseCount > 0
          ? t("joined.claimed", { count: claimed.expenseCount })
          : undefined,
    });
    leaveFor(joined);
  };

  /** Who a shared link is putting in the group: a listed name, or a new one. */
  const joiner = () => ({
    participantId: claimed?.id ?? null,
    displayName: name.trim(),
  });

  /**
   * Joining as the account already in this browser, which is the whole of the
   * flow for somebody who arrived signed in.
   *
   * The group is never named here: it comes from the cookie on the server,
   * which is what stops a request naming any group it likes. A refusal stays
   * on the screen it was asked from, with the reason.
   */
  const joinWithAccount = async () => {
    setJoinError(null);
    setJoining(true);
    const result = await joinWithAccountAction(joiner());
    setJoining(false);
    if (!result.ok || !result.data) {
      setJoinError(result.error ?? t("joinFailed"));
      return;
    }
    arrive(result.data.groupId);
  };

  /**
   * Joining as a guest, which on a shared link is the whole of the join.
   *
   * A shared link carries no identity at all: choosing "guest" on it is the
   * moment the participant, the invitation and the session come to exist —
   * and until this ran, they never did, which is how "Go to the group" used
   * to open the sign-in page.
   */
  const joinAsGuest = async () => {
    setJoinError(null);
    setJoining(true);
    const result = await joinAsGuestAction(joiner());
    setJoining(false);
    if (!result.ok || !result.data) {
      setJoinError(result.error ?? t("joinFailed"));
      return;
    }
    arrive(result.data.groupId);
  };

  /**
   * After the credential, on a shared link.
   *
   * A passkey or code signup and a code sign-in carry the join with them and
   * say which group it put the account in. A passkey sign-in cannot: the
   * credential names the account on its own, through a route that has never
   * heard of the link, so the join follows it here — the account is signed in
   * by now, which makes it exactly the signed-in reader's join. A password
   * signup is the same case: `registerAction` was written for a page with no
   * link behind it and carries no join, but it leaves the new account signed
   * in. Any other way of coming back without a group means the name was taken
   * or the link died in the meantime; the account still exists, so the
   * dashboard is where it goes, and the reason is said rather than the group
   * pretended.
   */
  const finishOnSharedLink = async (outcome: {
    credential: "passkey" | "code" | "password";
    joinedGroupId: string | null;
  }) => {
    if (outcome.joinedGroupId) {
      arrive(outcome.joinedGroupId);
      return;
    }
    if (
      (outcome.credential === "passkey" && intent === "signin") ||
      outcome.credential === "password"
    ) {
      setJoining(true);
      const result = await joinWithAccountAction(joiner());
      setJoining(false);
      if (result.ok && result.data) {
        arrive(result.data.groupId);
        return;
      }
      toast.error(
        result.error ?? t("joined.signedInNotJoined", { group: groupName }),
      );
      leaveFor(null);
      return;
    }
    toast.error(t("joined.signedInNotJoined", { group: groupName }));
    leaveFor(null);
  };

  /**
   * A group started with no account, from the cold welcome.
   *
   * The action writes the group, the creator's seat and the link, and leaves
   * this browser holding a guest session for it — the same session an
   * invitation mints. What comes back is the link, for the screen that hands
   * it over.
   */
  const [startedGroup, setStartedGroup] = useState<{
    groupId: string;
    groupName: string;
    invite: { url: string; expiresAt: string | null };
  } | null>(null);
  const detectedTimezone = useDetectedTimezone();
  /*
   * The group's currency: where the device is, until the reader picks one.
   *
   * A guest has no preference to state, so the guess is the place (#420). It
   * is the one answer about a group that can never change, and this screen
   * used to keep it to itself — a phone abroad started a group in the wrong
   * currency with no way to see it until the first expense. So it is shown,
   * and can be changed, as the create sheet does for an account.
   *
   * Derived rather than stored, for the create sheet's reason: the zone
   * arrives at hydration, and a late answer may replace the guess but never
   * the reader's own choice.
   */
  const [pickedCurrency, setPickedCurrency] = useState<string | null>(null);
  const groupCurrency =
    pickedCurrency ??
    defaultCurrency({ device: currencyOfTimezone(detectedTimezone) });
  const startGroup = async (startedName: string) => {
    setJoinError(null);
    setJoining(true);
    const result = await startGroupAsGuestAction({
      groupName: startedName,
      displayName: name.trim(),
      timezone: detectedTimezone ?? "UTC",
      baseCurrency: groupCurrency,
    });
    setJoining(false);
    if (!result.ok || !result.data) {
      setJoinError(result.error ?? t("startGroup.failed"));
      return;
    }
    setStartedGroup({
      groupId: result.data.groupId,
      groupName: startedName,
      invite: result.data.invite,
    });
    setJoinedGroupId(result.data.groupId);
    advance("groupLink");
  };

  // "Invitation" is the welcome's word on a personal invitation. Nobody
  // invited a cold arrival, so its welcome is called what it is.
  const stepLabel =
    screen === "welcome" && arrival === "cold"
      ? t("stepStart")
      : t(STEP_LABEL_KEYS[screen] as Parameters<typeof t>[0]);

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
    <div
      className={cn(
        "mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-6",
        sideBySide && "lg:max-w-5xl lg:px-8",
      )}
    >
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
          sideBySide &&
            "lg:grid lg:grid-cols-2 lg:items-start lg:gap-8 lg:pt-6",
        )}
      >
        {sideBySide && (
          <div className="hidden lg:flex lg:flex-col">
            <WhichOneScreen
              group={initialGroup}
              inviterName={inviterName}
              accountName={arrivedWith?.name ?? null}
              members={members}
              typedName={unpickedName}
              heading="h2"
              picked={claimed?.id ?? "new"}
              onPick={pickBeside}
              onNewHere={() => pickBeside(null)}
            />
          </div>
        )}

        {screen === "welcome" && arrival !== "shared" && (
          <WelcomeScreen
            arrival={arrival}
            group={initialGroup}
            inviterName={inviterName}
            registrationAllowed={registrationAllowed}
            guestOffered={!alreadyGuest}
            onChoose={(chosen) => {
              setIntent(chosen);
              advance(
                routeFor({
                  arrival,
                  intent: chosen,
                  signedIn,
                  setupComplete,
                })[1] ?? "arrival",
              );
            }}
          />
        )}

        {screen === "whichOne" && initialGroup && (
          <WhichOneScreen
            group={initialGroup}
            inviterName={inviterName}
            accountName={arrivedWith?.name ?? null}
            members={members}
            typedName={name}
            onPick={(member) => {
              // Held whole rather than by id. The list is a prop, and every
              // Server Action re-renders the page that supplied it — by which
              // time the join cookie is spent and the list comes back empty.
              // A screen that names the person they just picked cannot be
              // looking them up in it.
              setClaimed(member);
              setName(member.displayName);
              advance("keepIt");
            }}
            onNewHere={() => {
              setClaimed(null);
              advance("keepIt");
            }}
          />
        )}

        {screen === "keepIt" && (
          // A card beside the list from `lg`; below it, a plain column that
          // hands its height on to the screen inside, as `main` does.
          <div
            className={cn(
              "flex flex-1 flex-col",
              sideBySide &&
                "lg:rounded-2xl lg:bg-card lg:p-6 lg:ring-1 lg:ring-foreground/10",
            )}
          >
            <KeepItScreen
              groupName={groupName}
              member={claimed}
              name={name}
              onNameChange={setName}
              accountName={arrivedWith?.name ?? null}
              registrationAllowed={registrationAllowed}
              busy={joining}
              error={joinError}
              onJoin={() => void joinWithAccount()}
              onChoose={(chosen) => {
                setIntent(chosen);
                if (chosen !== "guest") {
                  advance("identity");
                  return;
                }
                // The guest option commits here: there is no credential screen
                // after it to carry the join, so the join is this tap.
                void joinAsGuest();
              }}
              onBackToList={backToList}
            />
          </div>
        )}

        {screen === "identity" && (
          <IdentityScreen
            intent={intent}
            name={name}
            onNameChange={setName}
            email={email}
            onEmailChange={setEmail}
            codeSignupAvailable={codeSignupAvailable}
            join={arrival === "shared" ? joiner() : undefined}
            onDone={(outcome) => {
              setCredential(outcome.credential);
              if (arrival === "shared") {
                void finishOnSharedLink(outcome);
                return;
              }
              if (outcome.joinedGroupId)
                setJoinedGroupId(outcome.joinedGroupId);
              if (outcome.claimedGroupId) {
                setJoinedGroupId(outcome.claimedGroupId);
              }
              const index = route.indexOf("identity");
              const following = route[index + 1];
              // A cold sign-in's route ends here: the account exists, its
              // groups are on the dashboard, and that is the welcome.
              if (following) advance(following);
              else leave();
            }}
          />
        )}

        {screen === "profile" && (
          <ProfileScreen
            intent={intent}
            name={name}
            onNameChange={setName}
            /**
             * An account exists by now on every route but the guest ones —
             * either this flow just made one, or the reader walked in with it.
             */
            hasAccount={credential !== null || signedIn}
            onDone={() => {
              const next = nextScreen(route, "profile");
              if (next) {
                advance(next);
                return;
              }
              // A personal invitation's guest: the session was minted when
              // the link was opened, so the group is already theirs to land
              // in, the same way a shared link's guest lands.
              if (groupId) arrive(groupId);
              else leave();
            }}
          />
        )}

        {screen === "arrival" && (
          <ArrivalScreen
            intent={intent}
            name={firstNameOf(name)}
            group={initialGroup}
            /*
              Whether the checklist is still to come. Read off the route rather
              than named, so the screen and the route cannot disagree about it
              — and so the buttons can say which of the two they do.
            */
            onFinishSetup={
              nextScreen(route, "arrival") === "checklist"
                ? () => advance("checklist")
                : null
            }
            onLeave={leave}
          />
        )}

        {screen === "checklist" && (
          <ChecklistScreen
            group={initialGroup}
            profile={initialProfile}
            credential={credential}
            email={email}
            name={name}
            onLeave={leave}
          />
        )}

        {screen === "startGroup" && (
          <StartGroupScreen
            name={name}
            onNameChange={setName}
            currency={groupCurrency}
            onCurrencyChange={setPickedCurrency}
            busy={joining}
            error={joinError}
            onSubmit={(startedName) => void startGroup(startedName)}
          />
        )}

        {screen === "groupLink" && startedGroup && (
          <GroupReady
            groupId={startedGroup.groupId}
            groupName={startedGroup.groupName}
            // Started from a name and a group name, with nobody else typed in.
            others={[]}
            invite={startedGroup.invite}
            onSkip={leave}
            heading="h1"
            // A guest may share the link, not move its expiry: that becomes
            // theirs with the group, once they claim it.
            canManage={false}
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
              recordOnboardingStep(arrival, "left");
              router.push("/dashboard?new");
              router.refresh();
            }}
          />
        )}
      </main>
    </div>
  );
}
