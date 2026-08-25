import type { JoinMemberView, JoinSummaryView } from "@/components/join/types";

/**
 * What the onboarding screens are given.
 *
 * Amounts cross from the server as decimal strings of minor units, never as
 * numbers — the rule the money components state, and the reason a balance can
 * be shown before anything has been rounded.
 */

export interface OnboardingMoney {
  readonly currency: string;
  readonly minorUnits: string;
}

/** Somebody asking to be paid back, which is the one thing that interrupts. */
export interface SettleRequestView {
  readonly name: string;
  readonly amount: OnboardingMoney;
}

export interface OnboardingGroupView {
  /**
   * Null on a shared link until the account is in the group, and on a cold
   * arrival for good — there is no group to be looking at.
   */
  readonly groupId: string | null;
  readonly summary: JoinSummaryView;
  /** The reader's own position, once they have one. */
  readonly position: OnboardingMoney | null;
  readonly settleRequest: SettleRequestView | null;
}

export type { JoinMemberView, JoinSummaryView };
