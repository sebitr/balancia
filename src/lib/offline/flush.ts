import {
  listQueued,
  recordAttempt,
  removeQueued,
  type QueuedEntry,
} from "./outbox";
import { classifyStatus, isDue, type ReplayVerdict } from "./replay";

/**
 * Sending what was typed offline, once there is somewhere to send it.
 *
 * The queue is drained through the same HTTP endpoint a native client writes
 * through — `POST /api/groups/:id/expenses`, `expenseInputSchema` as the body —
 * rather than through the Server Action the form calls when it is online. A
 * Server Action is addressed by an id that changes on every build, and an entry
 * queued before a deploy has to survive one; a URL does not move.
 *
 * Entries go one at a time, in the order they were typed. Four expenses from
 * one dinner are four writes against one group's balances, and sending them
 * together only invites the database to serialise them anyway — with the
 * entries in whatever order the requests happened to land.
 */

export interface FlushSummary {
  readonly written: number;
  readonly retrying: number;
  readonly blocked: number;
}

const NOTHING: FlushSummary = { written: 0, retrying: 0, blocked: 0 };

/**
 * One attempt at one entry.
 *
 * A thrown `fetch` is a retry and not a failure: offline, DNS, a captive
 * portal, a server that closed the connection mid-request. None of those say
 * anything about whether the expense is any good, and the last of them may
 * even have written it — which is exactly the case the idempotency key is
 * carried for. The next attempt sends the same key and the server answers with
 * the entry it already made.
 */
async function send(entry: QueuedEntry): Promise<ReplayVerdict> {
  let response: Response;
  try {
    response = await fetch(`/api/groups/${entry.groupId}/expenses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": entry.clientKey,
      },
      // The session cookie is what authorizes this; it is a same-origin
      // request, but say so rather than rely on the default.
      credentials: "same-origin",
      body: JSON.stringify(entry.payload),
    });
  } catch {
    return { kind: "retry" };
  }
  return classifyStatus(response.status);
}

/**
 * Whether a flush is already running.
 *
 * Module-level, because the triggers overlap by nature: coming back online
 * fires `online`, and it usually fires alongside the tab becoming visible
 * again. Two concurrent drains would each read the same queue and send every
 * entry twice — which the idempotency key would survive, but there is no
 * reason to make it do that work.
 */
let running = false;

/**
 * Drains the queue, and answers with what happened.
 *
 * Never throws: a caller is a lifecycle event — a mount, an `online` event —
 * and there is nothing at either of those to catch. Anything that goes wrong
 * leaves the entry queued, which is the safe direction.
 */
export async function flushOutbox(
  options: { now?: number } = {},
): Promise<FlushSummary> {
  if (running) return NOTHING;
  running = true;

  let written = 0;
  let retrying = 0;
  let blocked = 0;

  try {
    const now = options.now ?? Date.now();
    for (const entry of await listQueued()) {
      // A blocked entry is waiting on a person, not on the network. Retrying
      // it would only re-earn the refusal it already carries.
      if (entry.status === "blocked") {
        blocked += 1;
        continue;
      }
      if (!isDue(entry, now)) {
        retrying += 1;
        continue;
      }

      const verdict = await send(entry);
      if (verdict.kind === "written") {
        await removeQueued(entry.clientKey);
        written += 1;
        continue;
      }
      if (verdict.kind === "blocked") {
        await recordAttempt(entry, {
          status: "blocked",
          blockedFor: verdict.reason,
        });
        blocked += 1;
        continue;
      }
      await recordAttempt(entry, { status: "queued", blockedFor: null });
      retrying += 1;
      /*
       * Stop at the first entry that could not be sent.
       *
       * Whatever stopped it — no network, a server that is down, a session
       * that has expired — is about to stop every entry behind it too, and
       * marching through the rest only burns their backoff for nothing. The
       * next trigger starts again from the front.
       */
      break;
    }
  } finally {
    running = false;
  }

  return { written, retrying, blocked };
}
