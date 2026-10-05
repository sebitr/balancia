/**
 * Which screens this person sees, and in what order.
 *
 * Three arrivals and six routes through them, and the whole thing is derived
 * rather than stored: give it how somebody got here and what they have chosen
 * so far, and it returns the list. Nothing appends to a screen list as the
 * flow runs, and no screen knows what follows it.
 *
 * That is not tidiness. A hand-maintained order is where this goes wrong —
 * a condition tested in one place and forgotten in another paints the wrong
 * step label, or renders two sets of buttons at once, and both bugs look like
 * rendering bugs rather than the state bug they are. Every branch below is one
 * comparison against `arrival`, and the back button is the list read backwards,
 * which is what makes a screen reachable from two places return to the one it
 * came from without a history stack.
 */

/** How this person got here, which decides everything else. */
export type Arrival =
  /** A link addressed to them: the group already knows a name for them. */
  | "personal"
  /** A link the whole group shares. It carries no identity at all. */
  | "shared"
  /** No link. Somebody who found Balancia and wants an account. */
  | "cold";

/** What they chose to be — at the welcome screen, or at "keep it". */
export type Intent = "account" | "signin" | "guest";

export type ScreenId =
  | "welcome"
  /** A shared link's first screen: the group, and which of its names is you. */
  | "whichOne"
  /** How that person comes in: an account, a sign-in, or a guest. */
  | "keepIt"
  | "identity"
  | "profile"
  | "arrival"
  | "checklist"
  | "firstGroup"
  /** A cold arrival naming a group and themselves, with no account. */
  | "startGroup"
  /** That group's link, handed over while the intent is warm. */
  | "groupLink";

export interface OnboardingRouteState {
  readonly arrival: Arrival;
  readonly intent: Intent;
  /**
   * An account was already signed in when this flow started.
   *
   * Only a shared link reaches the screens in that state — the other two
   * arrivals turn a signed-in reader away — and what it removes is the whole
   * credential half of the route: there is nothing to keep and nothing to
   * prove, only which of the listed names is theirs.
   */
  readonly signedIn: boolean;
  /**
   * There is nothing left on the setup checklist.
   *
   * Only an account that arrived with a photo, starred currencies, a payout
   * method and a device registered for push can be in this state — one who has
   * done all this before. The screen is dropped rather than shown with five
   * green ticks, because a list that exists only to be dismissed is a tap for
   * nothing. A shared link has no checklist to drop, so it ignores this.
   */
  readonly setupComplete: boolean;
}

/**
 * The screens, in order, for one state.
 *
 * Reading the three arrivals in turn:
 *
 *  - **Personal.** The identity question is asked first, because the link
 *    already says who this is; what is missing is only how they want to be
 *    kept. Signing in skips the profile screen — the account has a name — and
 *    a guest skips the account screen, having chosen not to have one.
 *
 *    A guest then ends the way a shared link's guest does: in the group, with
 *    "you're in" said there. The arrival screen and the checklist were nothing
 *    to a guest that the group's guest card does not already say — of the
 *    checklist's rows only the account could be kept without one. An account
 *    keeps both, because it can save every row of the checklist there, and
 *    because the arrival screen is what gives the page time to hand down the
 *    account's own setup before the checklist reads it. Its buttons say which
 *    of the two they do; see `ArrivalScreen`.
 *
 *  - **Shared.** Nobody knows who this is, so that is the first question, and
 *    the link opens straight onto it: the group, and which of its names is
 *    you. Only once there is a person on the screen — with a balance under the
 *    name — is the account question worth asking, which is what "keep it" is
 *    for; it is also where somebody new types the name they will go by, and
 *    where a reader already signed in says yes. Then the group itself, and
 *    nothing in between: the flow leaves for it the moment the join commits.
 *
 *    Two screens left on the way, and why each was safe to lose. The welcome
 *    only said that the link could not know who had opened it, which is one
 *    sentence, and the list now says it. "Is this you?" repeated the name and
 *    balance the list row had just shown, and committed nothing anybody could
 *    not undo from "keep it", which names the person, shows the balance and
 *    offers the way back to the list — nothing is claimed until a choice
 *    there. The arrival screen and the checklist after it were a receipt in
 *    front of the group: the group now says "you're in" itself, and for a
 *    guest the checklist's only row that could be done at all — an account —
 *    is the guest card on the overview. Payouts, currencies and push all need
 *    an account to be kept.
 *
 *  - **Cold.** No group exists, so there is no arrival screen to land on. A
 *    new account ends at the empty state; a sign-in ends on the credential
 *    itself, and the dashboard is its welcome; and somebody who wants no
 *    account yet names a group and themselves, and leaves with its link.
 *
 * The checklist is the one screen a personal invitation's account can lose. It
 * is a receipt of what is set up and what is not, so an account that has all
 * of it already ends on the arrival screen and goes straight to the group from
 * there.
 */
export function routeFor(state: OnboardingRouteState): readonly ScreenId[] {
  if (state.arrival === "cold") {
    /*
     * An account that already exists has nothing left to name and no first
     * group to be shown: its groups are on the dashboard, so the route ends
     * the moment the credential lands and the flow leaves for it. Running the
     * profile screen here is how a returning member was met with an empty
     * name field, renamed by whatever they typed into it, and then told they
     * had no groups.
     */
    if (state.intent === "signin") return ["welcome", "identity"];
    // No account at all: a group of their own, and its link to share. The
    // guest session that results is the same one an invitation mints, and
    // the group page's claim is how it becomes an account later.
    if (state.intent === "guest") return ["welcome", "startGroup", "groupLink"];
    return ["welcome", "identity", "profile", "firstGroup"];
  }

  if (state.arrival === "shared") {
    return [
      "whichOne",
      "keepIt",
      // An account that walked in already signed in has nothing to prove, and
      // a guest has just declined the account: neither has anything to verify.
      // Everybody else proves an address, and the join rides on it.
      ...(state.signedIn || state.intent === "guest"
        ? []
        : (["identity"] as const)),
    ];
  }

  // A guest gives a name and nothing else, and goes from there to the group.
  if (state.intent === "guest") return ["welcome", "profile"];

  return [
    "welcome",
    // An account proves an address first, and only a new one is then asked
    // what to call itself.
    ...(state.intent === "signin"
      ? (["identity"] as const)
      : (["identity", "profile"] as const)),
    "arrival",
    ...(state.setupComplete ? [] : (["checklist"] as const)),
  ];
}

/**
 * The screens a route can end on that are endings: something has been
 * committed by the time the reader stands on them, so they offer no way back.
 *
 * A route can also stop on a screen that is not one — the identity screen of a
 * cold sign-in or a shared link's account, "keep it" for a shared link's guest
 * or signed-in reader, the name screen for a personal invitation's guest.
 * Nothing is committed on those until the reader acts, so their back button
 * stays.
 */
export const ENDINGS: ReadonlySet<ScreenId> = new Set<ScreenId>([
  "arrival",
  "checklist",
  "firstGroup",
  "groupLink",
]);

/** The screen a back button returns to, or null at the start of the route. */
export function previousScreen(
  route: readonly ScreenId[],
  current: ScreenId,
): ScreenId | null {
  const index = route.indexOf(current);
  return index > 0 ? route[index - 1] : null;
}

/** The screen a primary action moves on to, or null at the end. */
export function nextScreen(
  route: readonly ScreenId[],
  current: ScreenId,
): ScreenId | null {
  const index = route.indexOf(current);
  return index >= 0 && index < route.length - 1 ? route[index + 1] : null;
}

/**
 * How far along the bar is, as a fraction.
 *
 * Measured against the route this person is actually on rather than a fixed
 * total, because the routes run from two screens to five and a bar that
 * promised four would be lying to most of them.
 */
export function progressOf(
  route: readonly ScreenId[],
  current: ScreenId,
): number {
  const index = route.indexOf(current);
  if (index < 0 || route.length < 2) return 0;
  return index / (route.length - 1);
}

/**
 * The label above the bar — a word for where they are, never "Step 3 of 6".
 *
 * A count invites the reader to compare it with somebody else's, and the
 * counts differ by route. The word says the same thing without inviting it.
 */
export const STEP_LABEL_KEYS: Record<ScreenId, string> = {
  welcome: "stepWelcome",
  whichOne: "stepWhoYouAre",
  keepIt: "stepKeepIt",
  identity: "stepAccount",
  profile: "stepProfile",
  arrival: "stepDone",
  checklist: "stepGroup",
  firstGroup: "stepFirstGroup",
  startGroup: "stepStartGroup",
  groupLink: "stepShare",
};
