import "server-only";
import { enforceSignUpLimits } from "./rate-limit";
import { assertProofOfWork, type ProofOfWorkSolution } from "./proof-of-work";

/**
 * Everything that stands between a stranger and a new account.
 *
 * Four doors reach this — the web form, the emailed code, the passkey ceremony
 * and the mobile API — and the failure this exists to prevent is one of them
 * being given a defence the others did not get. There has been a version of
 * that bug already: for a while only the per-IP limit was in front of signup,
 * and it was in front of all four, which is the only reason it was not worse.
 *
 * ## The order is the interesting part
 *
 * Proof of work first, limits second, and not the other way round.
 *
 * `signUpTotal` is an instance-wide ceiling: fifty attempts an hour across
 * everybody. Spent by whoever asks, it is not a defence so much as a switch an
 * attacker can flip — fifty junk requests a minute past the hour and nobody
 * else can register until the next window. Putting the proof of work in front
 * means the only requests that can reach that ceiling are ones that paid a
 * second of CPU to get there, so exhausting it costs more than the accounts
 * would have been worth.
 *
 * When the proof of work is off, which is the default, this is exactly the
 * three limits and nothing else.
 */
export async function guardSignUp(request: {
  readonly ipAddress: string;
  readonly email: string;
  readonly proofOfWork?: ProofOfWorkSolution | null;
}): Promise<void> {
  await assertProofOfWork(request.proofOfWork ?? null);
  await enforceSignUpLimits(request.ipAddress, request.email);
}
