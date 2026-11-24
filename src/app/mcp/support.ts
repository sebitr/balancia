import "server-only";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z, ZodError } from "zod";
import { mobileApiError } from "@/app/api/mobile";
import { logger } from "@/lib/logger";
import type { UserActor } from "@/lib/security/authorization";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { actorOf, type Principal } from "@/modules/agent-access/principal";
import { money, toMajorString } from "@/modules/currencies/money";

/**
 * What every tool shares: how a result is shaped, and how a failure is told.
 *
 * ## Results
 *
 * Compact JSON in a single text block. The model reads it, a person sees it
 * only through the model, and tokens spent on indentation are tokens not spent
 * on the answer.
 *
 * Money is **a decimal string with its currency** — `"63.90 EUR"`, `"-5.00
 * USD"` — in every result and every argument. Never minor units, which a
 * model has to divide by a currency's exponent it may not know (JPY has none,
 * KWD has three), and never a JSON number, which is how `63.9` loses a digit.
 * A balance is signed: positive is money the person is owed, negative is money
 * they owe.
 *
 * ## Failures
 *
 * A tool that fails returns `isError: true` with a sentence the model can act
 * on — what was wrong and what would fix it — rather than a protocol error,
 * which the model cannot see past. The sentence comes from the same funnel the
 * REST API answers with (`mobileApiError`), so a refusal means the same thing
 * on both doors: a group that is out of reach is "not found", never a hint
 * that it exists, and a person in the group is told what stopped them.
 */

/** A failure whose message is meant for the model, as written. */
export class ToolFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolFailure";
  }
}

/**
 * A name as it is repeated back to the model: one that somebody else typed, so
 * cut to a length a sentence can carry. The names of groups and members are
 * edited by other people, and what comes back in an error is read by a model
 * that has not been told to distrust it.
 */
export function shown(name: string): string {
  return name.length > 60 ? `${name.slice(0, 60)}…` : name;
}

/**
 * The start of a long piece of somebody else's text, with a mark when it was
 * cut so the model knows there is more and where to ask for it.
 */
export function excerpt(text: string | null, max = 200): string | null {
  if (text === null || text.length <= max) return text;
  return `${text.slice(0, max)}… [cut; ${text.length - max} more characters]`;
}

/**
 * Which group a result is about, in every result that is about one.
 *
 * A model resolves "Lisbon" to a group and then says "done" — and the person
 * has no way to know which group that was. Naming it in the result puts it in
 * front of the model's own answer, where a wrong one can be caught.
 */
export function groupRef(access: { groupId: string; group: { name: string } }) {
  return { id: access.groupId, name: shown(access.group.name) };
}

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function failureResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/**
 * A decimal somebody said, as the string every money function reads.
 *
 * Asked for as text, because a JSON number is a binary float and `63.9` is the
 * only amount of that size it can hold without drifting. Accepted as a number
 * too, because models send one about as often as they are asked not to, and
 * refusing a perfectly representable `63.9` only makes the assistant retry. A
 * number is turned into the shortest decimal that reads back as itself, which
 * is what `String` does, before anything here sees it — and one that does not
 * come out as a plain decimal (`1e21`, `NaN`) fails the same checks as any
 * other text that is not an amount.
 */
export const decimalText = z.union([
  z.string().trim().min(1).max(40),
  z
    .number()
    .finite()
    .transform((value) => String(value)),
]);

/** `63.90 EUR`, or `-5.00 EUR` when the figure is negative. */
export function amountText(minor: bigint, currency: string): string {
  return `${toMajorString(money(minor, currency))} ${currency}`;
}

/** A balance: `+12.50 EUR` is owed to the person, `-5.00 EUR` is owed by them. */
export function balanceText(minor: bigint, currency: string): string {
  const text = amountText(minor, currency);
  return minor > 0n ? `+${text}` : text;
}

const NOT_FOUND =
  "Not found. The group or entry does not exist, or this connection is not allowed to see it.";

/** The sentence a failed tool call tells the model. */
export async function describeFailure(
  error: unknown,
  tool: string,
): Promise<string> {
  if (error instanceof ToolFailure) return error.message;
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "Check the arguments.";
  }

  const response = mobileApiError(error, `mcp ${tool}`);
  const body = (await response.json()) as { error?: string };
  switch (response.status) {
    case 404:
      return NOT_FOUND;
    case 401:
      return "This connection is no longer valid. Reconnect Balancia and try again.";
    case 429:
      return `${body.error ?? "Too many requests."} Wait ${response.headers.get("Retry-After") ?? "a moment"} seconds and try again.`;
    case 500:
      return "Balancia could not complete that. Try again; if it keeps failing, tell the person.";
    default:
      return body.error ?? "Balancia refused that.";
  }
}

/** Runs one tool as the principal's actor and turns the outcome into a result. */
export async function runTool(
  tool: string,
  principal: Principal,
  body: (actor: UserActor) => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const data = await body(actorOf(principal));
    logger.debug({ tool, credential: principal.kind }, "MCP tool called");
    return jsonResult(data);
  } catch (error) {
    return failureResult(await describeFailure(error, tool));
  }
}

/**
 * The second lock on a write tool.
 *
 * A read-only credential is never shown the write tools, so reaching one means
 * a client called a tool it was not told about. Refused all the same: what a
 * credential may do is decided here and in `authorizeGroup`, not by what the
 * tool list happened to say.
 */
export function requireWrite(principal: Principal): void {
  if (principal.scope !== "write") {
    throw new ToolFailure(
      "This connection is read-only. Disconnect and reconnect Balancia with permission to make changes.",
    );
  }
}

/**
 * Runs a tool that changes something: `runTool`, behind both locks a write has.
 *
 * The scope is checked first and the allowance second, in the one place, so that
 * a write tool added next year cannot forget either. The allowance is what a
 * connection that has been steered into writing runs into: every change tells
 * the other members of a group, and an hour's worth is bounded.
 */
export async function runWriteTool(
  tool: string,
  principal: Principal,
  body: (actor: UserActor) => Promise<unknown>,
): Promise<CallToolResult> {
  return runTool(tool, principal, async (actor) => {
    requireWrite(principal);
    const allowance = await consumeRateLimit(
      "agentWrite",
      principal.credentialId,
    );
    if (!allowance.allowed) {
      throw new ToolFailure(
        `This connection has made as many changes as it may for now. Nothing was changed. Tell the person, and try again in ${Math.ceil(allowance.retryAfterSeconds / 60)} minutes.`,
      );
    }
    return body(actor);
  });
}
