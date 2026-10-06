import type {
  ActivityEntry,
  ActivityMetadata,
} from "@/modules/activity/service";
import { formatMoney, money } from "@/modules/currencies/money";

/**
 * The wording of one activity event.
 *
 * Action ids are dotted ("expense.created"), which is also how next-intl
 * addresses nested keys, so an id maps straight onto `actions.expense.created`.
 * An id with no entry falls back to the raw value: an event written by a newer
 * version should still show something rather than break the page.
 *
 * Shared by the full feed and the overview's "since you last opened" list, so
 * the same event cannot be described two different ways on two screens.
 */

/** Just enough of next-intl's translator to look an action up. */
export interface ActivityTranslate {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
}

/**
 * Who is reading, and the names the events point at.
 *
 * An event that is about people records them by participant id, never by
 * name — a name changes, an id does not — so the screen that lists events
 * looks the names up once for the page (`namesInActivity`) and hands them in
 * here, beside the reader's own id for the lines that say "you".
 */
export interface ActivityPeople {
  /** The reader's own participant row; null for nobody in particular. */
  readonly you: string | null;
  readonly names: ReadonlyMap<string, string>;
}

export interface ActivityReader extends ActivityPeople {
  /** The reader's number notation, for amounts. */
  readonly locale: string;
}

/** Nobody named and nobody reading: every line in its short form. */
export const NOBODY: ActivityPeople = { you: null, names: new Map() };

/**
 * `reader` may be left out by a caller with no names to hand — a test about
 * some other line, say. A repayment then keeps its short form, since there is
 * nobody it could name.
 */
export function describeActivity(
  entry: ActivityEntry,
  t: ActivityTranslate,
  reader: ActivityReader = { ...NOBODY, locale: "en" },
): string {
  /*
   * Somebody who left. Leaving writes the removal event, because the action
   * is a database enum and a new kind would need a migration; what tells the
   * two apart is that a person who leaves is their own actor. The feed puts
   * the actor's name in front, so this reads "Ada left the group", not "Ada
   * removed Ada from the group".
   */
  if (
    entry.action === "participant.removed" &&
    entry.actorParticipantId !== null &&
    entry.actorParticipantId === entry.entityId
  ) {
    return t("left");
  }

  const base = t.has(`actions.${entry.action}`)
    ? t(`actions.${entry.action}`)
    : entry.action;

  if (entry.action === "settlement.created") {
    return repaymentLine(entry, t, reader) ?? base;
  }

  /*
   * The person an event was about, when the event is about a person.
   *
   * Every `participant.*` event has recorded a `displayName` since it was
   * written, and nothing ever read it: the feed said "added someone to the
   * group" twice in a row, which is the one fact those lines carry and the
   * one they left out. `actionsNamed` is a parallel to `actions` rather than
   * more keys inside it, so an id still maps onto exactly one action phrase
   * and the named form is a rendering choice made here.
   */
  const name = entry.metadata?.displayName;
  if (
    typeof name === "string" &&
    name.length > 0 &&
    t.has(`actionsNamed.${entry.action}`)
  ) {
    return t(`actionsNamed.${entry.action}`, { name });
  }

  const description = entry.metadata?.description;
  if (typeof description === "string" && description.length > 0) {
    return t("withDescription", { action: base, description });
  }
  return base;
}

/**
 * A recorded repayment, said as who paid whom and how much.
 *
 * "recorded a repayment" sat next to "added an expense: Groceries" and said
 * nothing a reader could use. The event has carried the two people and the
 * amount since it was first written, so the line names them now — and says
 * "you" where the reader is one of them, as every other repayment in the app
 * does since #427.
 *
 * The person who recorded it is named in front of the line already. When they
 * are also the one who paid, the line says "their repayment" rather than
 * repeating the name — "Sam recorded Sam's repayment" is the sentence this
 * avoids — and that holds when the reader recorded their own, since the feed
 * names the reader in that place too.
 *
 * Each combination is a whole message: French cannot build "le remboursement
 * de Sam" out of parts without meeting "de Anna", and it agrees nothing the
 * same way English does.
 *
 * Null — and the plain "recorded a repayment" — when the event cannot say it:
 * a name this group no longer resolves, or an amount that will not read.
 */
function repaymentLine(
  entry: ActivityEntry,
  t: ActivityTranslate,
  reader: ActivityReader,
): string | null {
  const metadata = entry.metadata ?? {};
  const { from, to } = metadata;
  if (typeof from !== "string" || typeof to !== "string") return null;

  const amount = amountOf(metadata, reader.locale);
  const fromName = reader.names.get(from);
  const toName = reader.names.get(to);
  if (!amount || fromName === undefined || toName === undefined) return null;

  const { you } = reader;
  const toYou = you !== null && to === you;

  if (entry.actorParticipantId !== null && from === entry.actorParticipantId) {
    return toYou
      ? t("repaymentRecorded.theirsToYou", { amount })
      : t("repaymentRecorded.theirs", { amount, to: toName });
  }
  if (you !== null && from === you) {
    return t("repaymentRecorded.yours", { amount, to: toName });
  }
  return toYou
    ? t("repaymentRecorded.toYou", { amount, from: fromName })
    : t("repaymentRecorded.between", { amount, from: fromName, to: toName });
}

/** The amount an event recorded, formatted, or null if it cannot be read. */
export function amountOf(
  metadata: ActivityMetadata,
  locale: string,
): string | null {
  const { amount, currency } = metadata;
  if (
    typeof amount !== "string" ||
    !/^-?\d+$/.test(amount) ||
    typeof currency !== "string"
  ) {
    return null;
  }
  try {
    return formatMoney(money(BigInt(amount), currency), { locale });
  } catch {
    // A currency this build no longer knows. The line keeps its words; only
    // the figure goes.
    return null;
  }
}

/** Who did it, with the two stand-ins for "nobody in particular". */
export function actorOf(entry: ActivityEntry, t: ActivityTranslate): string {
  if (entry.actorLabel) return entry.actorLabel;
  return entry.actorType === "system" ? "Balancia" : t("someone");
}
