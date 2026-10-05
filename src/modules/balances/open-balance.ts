/**
 * A refusal about money somebody still has outstanding.
 *
 * Two services raise it, over the same fact — a person's net position is not
 * zero. Removing somebody from a group is refused until it is, and a repayment
 * that names somebody already removed is allowed only to bring it there. The
 * class lives apart from both so that the funnels answering it, the Server
 * Action one in `lib/actions.ts` and the mobile API's in `app/api/mobile.ts`,
 * need import neither.
 */

type OpenBalanceCode = "participantHasBalance" | "removedParticipantSettlement";

const MESSAGES: Record<OpenBalanceCode, (name: string) => string> = {
  participantHasBalance: (name) =>
    `${name} still has money outstanding in this group. Settle up first, then remove them.`,
  removedParticipantSettlement: (name) =>
    `${name} is no longer in this group. A repayment can include them only to settle what is still outstanding, and for no more than that.`,
};

export class OpenBalanceError extends Error {
  /** Translated by the Server Action funnel; see `lib/actions.ts`. */
  readonly code: OpenBalanceCode;
  readonly params: { readonly name: string };

  constructor(code: OpenBalanceCode, name: string) {
    super(MESSAGES[code](name));
    this.name = "OpenBalanceError";
    this.code = code;
    this.params = { name };
  }
}
