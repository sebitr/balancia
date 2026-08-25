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
  | "whichOne"
  | "confirm"
  | "keepIt"
  | "identity"
  | "profile"
  | "arrival"
  | "checklist"
  | "firstGroup";

export interface OnboardingRouteState {
  readonly arrival: Arrival;
  readonly intent: Intent;
  /** True once "none of these — I'm new here" has been taken. */
  readonly isNewMember: boolean;
  /**
   * An account was already signed in when this flow started.
   *
   * Only a shared link reaches the screens in that state — the other two
   * arrivals turn a signed-in reader away — and what it removes is the whole
   * credential half of the route: there is nothing to keep and nothing to
   * prove, only which of the listed names is theirs.
   */
  readonly signedIn: boolean;
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
 *  - **Shared.** Nobody knows who this is, so that is the first question:
 *    which of the listed names, or none of them. Only once there is a person
 *    on the screen — with a balance and expenses filed against it — is the
 *    account question worth asking, which is what "keep it" is for. A reader
 *    who is already signed in has answered it before arriving: they skip both
 *    "keep it" and the account screen, and claiming the name *is* the join.
 *
 *  - **Cold.** No group exists, so there is no arrival screen to land on and
 *    nothing to be a guest of. It ends at the empty state instead.
 */
export function routeFor(state: OnboardingRouteState): readonly ScreenId[] {
  if (state.arrival === "cold") {
    return ["welcome", "identity", "profile", "firstGroup"];
  }

  if (state.arrival === "shared") {
    return [
      "welcome",
      "whichOne",
      // Claiming a listed name confirms it; being new types it instead.
      state.isNewMember ? "profile" : "confirm",
      // An account that walked in already signed in has nothing to decide
      // here and nothing to prove: the screen it just committed on is what
      // put it in the group.
      ...(state.signedIn
        ? []
        : ([
            "keepIt",
            // A guest has just declined the account, so nothing to verify.
            ...(state.intent === "guest" ? [] : (["identity"] as const)),
          ] as const)),
      "arrival",
      "checklist",
    ];
  }

  return [
    "welcome",
    // A guest gives a name and nothing else; everybody else proves an address
    // first, and only a new account is then asked what to call itself.
    ...(state.intent === "guest"
      ? (["profile"] as const)
      : state.intent === "signin"
        ? (["identity"] as const)
        : (["identity", "profile"] as const)),
    "arrival",
    "checklist",
  ];
}

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
 * total, because the routes are three, five and seven screens long and a bar
 * that promised six would be lying to two of them.
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
  confirm: "stepConfirm",
  keepIt: "stepKeepIt",
  identity: "stepAccount",
  profile: "stepProfile",
  arrival: "stepDone",
  checklist: "stepGroup",
  firstGroup: "stepFirstGroup",
};
