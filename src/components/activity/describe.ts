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
  /**
   * The language the screen is in, for joining a list the way it joins one.
   * The number notation is no help: somebody can read French with English
   * numbers, and "the amount, the date and who paid" is not French.
   */
  readonly language?: string;
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

  const converted = describeConversion(entry, t, reader);
  if (converted !== null) return converted;

  const link = describeLinkEvent(entry, t, reader.you);
  if (link !== null) return link;

  const joined = describeJoin(entry, t);
  if (joined !== null) return joined;

  const repayment = describeRepayment(entry, t, reader);
  if (repayment !== null) return repayment;

  const edit = describeExpenseEdit(entry, t, reader);
  if (edit !== null) return edit;

  const group = describeGroupEvent(entry, t, reader);
  if (group !== null) return group;

  const person = describePersonEvent(entry, t, reader);
  if (person !== null) return person;

  if (entry.action === "import.completed") {
    const imported = describeImport(entry, t);
    if (imported !== null) return imported;
  }

  const metadata = entry.metadata ?? {};
  const base = phraseFor(entry, t);

  /*
   * The entry an event was about, when it is about an entry: what it was
   * called and what it came to. The description alone left two edits of one
   * expense reading the same, and said nothing of a deletion's size.
   */
  const description = metadata.description;
  if (typeof description === "string" && description.length > 0) {
    const amount = amountOf(metadata, reader.locale);
    return amount
      ? t("withAmount", { action: base, description, amount })
      : t("withDescription", { action: base, description });
  }
  return base;
}

/**
 * The plain phrase for an event: what the action id says, said for what the
 * event actually was.
 *
 * Several events share one action id and mean different things. Pausing and
 * resuming a recurring expense are both `recurring.updated`; taking a group
 * out of the archive is `group.archived` with `archived: false`, and was
 * printed as "archived the group"; an income is an expense row with another
 * direction, and was printed as "an expense". The id is a database enum, which
 * a new value would need a migration for, so what tells them apart is read
 * from the metadata and gets a phrase of its own here.
 */
function phraseFor(entry: ActivityEntry, t: ActivityTranslate): string {
  const key = phraseKey(entry);
  return t.has(`actions.${key}`) ? t(`actions.${key}`) : entry.action;
}

function phraseKey(entry: ActivityEntry): string {
  const metadata = entry.metadata ?? {};

  if (
    entry.action === "recurring.updated" &&
    typeof metadata.paused === "boolean"
  ) {
    return metadata.paused ? "recurring.paused" : "recurring.resumed";
  }
  if (entry.action === "group.archived" && metadata.archived === false) {
    return "group.unarchived";
  }
  if (metadata.direction === "in") {
    const verb = /^expense\.(created|updated|deleted|restored)$/.exec(
      entry.action,
    )?.[1];
    if (verb) return `income.${verb}`;
    if (entry.action === "recurring.generated") return "income.generated";
  }
  return entry.action;
}

/** A non-empty string, or null. Metadata is free-form JSON. */
function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The record under `key`, or null. */
function recordOf(value: unknown): ActivityMetadata | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ActivityMetadata)
    : null;
}

/** Joins words the way the screen's own language joins a list. */
function listOf(
  items: readonly string[],
  language: string | undefined,
): string {
  try {
    return new Intl.ListFormat(language ?? "en", {
      style: "long",
      type: "conjunction",
    }).format(items);
  } catch {
    return items.join(", ");
  }
}

/**
 * Which way a repayment line is told, and who and what it names.
 *
 * "you" where the reader is one of the two people, as every other repayment in
 * the app says it since #427; and "their repayment" where the person named in
 * front of the line is the one who paid, so the line does not repeat them —
 * "Sam recorded Sam's repayment" is the sentence this avoids. That holds when
 * the reader recorded their own, since the feed names the reader in that place
 * too.
 */
type Shape = "between" | "toYou" | "yours" | "theirs" | "theirsToYou";

interface Repayment {
  readonly shape: Shape;
  readonly amount: string;
  readonly from: string;
  readonly to: string;
}

/**
 * The repayment an event is about, or null when it cannot be said: a name this
 * group no longer resolves, or an amount that will not read.
 */
function readRepayment(
  entry: ActivityEntry,
  metadata: ActivityMetadata,
  reader: ActivityReader,
): Repayment | null {
  const { from, to } = metadata;
  if (typeof from !== "string" || typeof to !== "string") return null;

  const amount = amountOf(metadata, reader.locale);
  const fromName = reader.names.get(from);
  const toName = reader.names.get(to);
  if (!amount || fromName === undefined || toName === undefined) return null;

  const { you } = reader;
  const toYou = you !== null && to === you;

  let shape: Shape;
  if (entry.actorParticipantId !== null && from === entry.actorParticipantId) {
    shape = toYou ? "theirsToYou" : "theirs";
  } else if (you !== null && from === you) {
    shape = "yours";
  } else {
    shape = toYou ? "toYou" : "between";
  }
  return { shape, amount, from: fromName, to: toName };
}

const REPAYMENT_LINES = {
  "settlement.created": "repaymentRecorded",
  "settlement.updated": "repaymentEdited",
  "settlement.deleted": "repaymentDeleted",
  "settlement.restored": "repaymentRestored",
} as const;

/**
 * A repayment's event, said as who paid whom and how much.
 *
 * "recorded a repayment" sat next to "added an expense: Groceries" and said
 * nothing a reader could use, and "deleted a repayment" said less. The
 * service fills in the two people even for the events that never recorded
 * them (`listGroupActivity`), so every kind of repayment event can name them.
 *
 * Each combination is a whole message: French cannot build "le remboursement
 * de Sam" out of parts without meeting "de Anna", and it agrees nothing the
 * same way English does.
 *
 * An edit that moved the figure says what it was — "(was €10.00)" — since the
 * new amount alone cannot tell the reader anything changed.
 *
 * Null — and the plain phrase — when the event cannot say it.
 */
function describeRepayment(
  entry: ActivityEntry,
  t: ActivityTranslate,
  reader: ActivityReader,
): string | null {
  const group = REPAYMENT_LINES[entry.action as keyof typeof REPAYMENT_LINES];
  if (!group || entry.entityType !== "settlement") return null;

  const metadata = entry.metadata ?? {};
  const repayment = readRepayment(entry, metadata, reader);
  if (!repayment) return null;

  const line = t(`${group}.${repayment.shape}`, {
    amount: repayment.amount,
    from: repayment.from,
    to: repayment.to,
  });

  if (entry.action !== "settlement.updated") return line;
  const before = recordOf(metadata.before);
  const was = before ? amountOf(before, reader.locale) : null;
  return was && was !== repayment.amount
    ? t("repaymentWas", { line, before: was })
    : line;
}

/**
 * A change of type, told as the one thing it was.
 *
 * `listGroupActivity` folds the repayment that was created and the expense
 * that was deleted into one entry, with the deleted one as `replaces`. Said
 * from the new row's side, since that is the one still standing: what it was,
 * and what it is now.
 *
 * The old row is named by its description rather than as "an expense": an
 * income converts as well, and "turned the expense Salary" would be wrong.
 */
function describeConversion(
  entry: ActivityEntry,
  t: ActivityTranslate,
  reader: ActivityReader,
): string | null {
  const { replaces } = entry;
  if (!replaces) return null;
  const metadata = entry.metadata ?? {};
  const before = replaces.metadata ?? {};

  if (entry.action === "settlement.created") {
    const description = textOf(before.description);
    if (!description) return null;
    const repayment = readRepayment(entry, metadata, reader);
    return repayment
      ? t(`convertedToRepayment.${repayment.shape}`, {
          description,
          amount: repayment.amount,
          from: repayment.from,
          to: repayment.to,
        })
      : t("convertedToRepayment.plain", { description });
  }

  if (entry.action === "expense.created") {
    const description = textOf(metadata.description);
    if (!description) return null;
    const amount = amountOf(metadata, reader.locale);
    const was = amountOf(before, reader.locale);
    return amount && was
      ? t("convertedToExpense.full", { description, amount, before: was })
      : t("convertedToExpense.plain", { description });
  }

  return null;
}

/**
 * An edit of an expense, said by what it changed.
 *
 * The edit event records which parts of the entry moved, and the description
 * and amount it had before. One change that is worth a sentence of its own —
 * the figure, the name — gets it; several are listed by field, without values,
 * which are the entry's own business. An event written before any of this was
 * recorded has no list and falls back to the plain "edited an expense".
 */
function describeExpenseEdit(
  entry: ActivityEntry,
  t: ActivityTranslate,
  reader: ActivityReader,
): string | null {
  if (entry.action !== "expense.updated") return null;
  const metadata = entry.metadata ?? {};
  const description = textOf(metadata.description);
  const changed = Array.isArray(metadata.changed)
    ? metadata.changed.filter(
        (field): field is string =>
          typeof field === "string" && t.has(`expenseFields.${field}`),
      )
    : [];
  if (!description || changed.length === 0) return null;

  const before = recordOf(metadata.before);

  if (changed.length === 1 && changed[0] === "description") {
    const was = textOf(before?.description);
    if (was) return t("expenseChanged.renamed", { before: was, description });
  }
  if (changed.length === 1 && changed[0] === "amount" && before) {
    const was = amountOf(before, reader.locale);
    const now = amountOf(metadata, reader.locale);
    if (was && now) {
      return t("expenseChanged.amount", {
        description,
        before: was,
        after: now,
      });
    }
  }

  return t("expenseChanged.fields", {
    description,
    fields: listOf(
      changed.map((field) => t(`expenseFields.${field}`)),
      reader.language,
    ),
  });
}

/**
 * The group itself: made, changed, or taken out of the archive.
 *
 * A change of the group's settings is told by what moved — a rename says from
 * what to what — rather than "updated the group", which was all the log could
 * say of a save that had changed the name, nothing at all, or the time zone.
 */
function describeGroupEvent(
  entry: ActivityEntry,
  t: ActivityTranslate,
  reader: ActivityReader,
): string | null {
  const metadata = entry.metadata ?? {};

  if (entry.action === "group.created") {
    const name = textOf(metadata.name);
    return name ? t("groupCreated", { name }) : null;
  }
  if (entry.action !== "group.updated") return null;

  const changed = Array.isArray(metadata.changed)
    ? metadata.changed.filter(
        (field): field is string =>
          typeof field === "string" && t.has(`groupFields.${field}`),
      )
    : [];
  if (changed.length === 0) return null;

  const name = textOf(metadata.name);
  const was = textOf(metadata.previousName);
  if (changed.length === 1 && changed[0] === "name" && name && was) {
    return t("groupChanged.renamed", { before: was, name });
  }
  const timezone = textOf(metadata.timezone);
  if (changed.length === 1 && changed[0] === "timezone" && timezone) {
    return t("groupChanged.timezone", { timezone });
  }
  return t("groupChanged.fields", {
    fields: listOf(
      changed.map((field) => t(`groupFields.${field}`)),
      reader.language,
    ),
  });
}

/**
 * A person's line: a rename, a reminder, and the lines that name them.
 *
 * Every `participant.*` event has recorded a `displayName` since it was
 * written, and nothing ever read it: the feed said "added someone to the
 * group" twice in a row, which is the one fact those lines carry and the one
 * they left out. `actionsNamed` is a parallel to `actions` rather than more
 * keys inside it, so an id still maps onto exactly one action phrase and the
 * named form is a rendering choice made here.
 */
function describePersonEvent(
  entry: ActivityEntry,
  t: ActivityTranslate,
  reader: ActivityReader,
): string | null {
  const metadata = entry.metadata ?? {};

  if (entry.action === "reminder.sent") {
    // Who was reminded: the person as the group knows them now, else the name
    // the event kept. Never what the reminder said.
    const recipient =
      (entry.entityId ? reader.names.get(entry.entityId) : undefined) ??
      textOf(metadata.recipient);
    if (reader.you !== null && entry.entityId === reader.you) {
      return t("actionsYou.reminder.sent");
    }
    return recipient
      ? t("actionsNamed.reminder.sent", { name: recipient })
      : null;
  }

  if (!entry.action.startsWith("participant.")) return null;
  const name = textOf(metadata.displayName);
  if (!name) return null;

  const was = textOf(metadata.previousName);
  if (entry.action === "participant.updated" && was && was !== name) {
    return t("participantRenamed", { before: was, name });
  }
  return t.has(`actionsNamed.${entry.action}`)
    ? t(`actionsNamed.${entry.action}`, { name })
    : null;
}

/**
 * An import, said by what it did: how many entries came in, and from what.
 *
 * Null for one that did not record its file, which keeps the plain "completed
 * an import".
 */
function describeImport(
  entry: ActivityEntry,
  t: ActivityTranslate,
): string | null {
  const metadata = entry.metadata ?? {};
  const file = textOf(metadata.fileName);
  const { imported, failed } = metadata;
  if (!file || typeof imported !== "number") return null;
  return t("importCompleted", {
    file,
    imported,
    failed: typeof failed === "number" ? failed : 0,
  });
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

/**
 * A personal link: sent to somebody, revoked, or opened by them.
 *
 * The events are named `guest_link.*` in the database, and the feed used to
 * call them that — "created a guest link" — while the People screen called the
 * same thing an invite link and the group's own link was an invite link too.
 * Three names for two links, so nobody could tell which one a line was about.
 * Here, as on the People screen, the one that belongs to a person is their
 * personal link and the one the whole group shares is the group link.
 *
 * Joining through the group link writes `guest_link.created` as well, with
 * the newcomer as their own actor and `via: "join_link"` beside it, because
 * the join mints a personal link behind the scenes. Nobody sent anybody
 * anything, so it is told as the join it was.
 *
 * Whom a link was for is in the metadata — `participantName` always, and
 * `participantId` on events written since the feed started reading it. Older
 * rows lack one or the other and fall back to the phrase without them.
 */
function describeLinkEvent(
  entry: ActivityEntry,
  t: ActivityTranslate,
  viewerId: string | null,
): string | null {
  if (!entry.action.startsWith("guest_link.")) return null;
  const metadata = entry.metadata ?? {};

  if (entry.action === "guest_link.created" && metadata.via === "join_link") {
    return t("joinedWithGroupLink");
  }

  const personId = metadata.participantId;
  if (
    viewerId !== null &&
    personId === viewerId &&
    // Their own link opened by themselves is not news about "you" twice.
    entry.actorParticipantId !== viewerId &&
    t.has(`actionsYou.${entry.action}`)
  ) {
    return t(`actionsYou.${entry.action}`);
  }

  const name = metadata.participantName;
  if (
    typeof name === "string" &&
    name.length > 0 &&
    t.has(`actionsNamed.${entry.action}`)
  ) {
    return t(`actionsNamed.${entry.action}`, { name });
  }
  return null;
}

/**
 * Somebody coming into the group with an account of their own.
 *
 * Both ways in write `member.added` with the newcomer as their own actor, and
 * the event's plain phrase — "added someone to the group", once "added a
 * member" — then read as if they had brought somebody else in: "Ada added a
 * member", about Ada arriving. `via` says which way it was. Through the group
 * link it is the same join a guest's own line already tells; through their
 * personal link it is a guest who has just made an account of it.
 *
 * An event with neither keeps the plain phrase.
 */
function describeJoin(
  entry: ActivityEntry,
  t: ActivityTranslate,
): string | null {
  if (entry.action !== "member.added") return null;
  const via = entry.metadata?.via;
  if (via === "join_link") return t("joinedWithGroupLink");
  if (via === "guest_link") return t("claimedPersonalLink");
  return null;
}

/**
 * Work the app does on its own, though the event stores a label for it.
 *
 * The scheduler writes "Scheduled" where a person's name goes, in English, and
 * the feed printed it as written: "Scheduled generated a recurring expense",
 * in French as much as in English. It is nobody.
 */
const DONE_BY_BALANCIA: ReadonlySet<string> = new Set(["recurring.generated"]);

/**
 * Who did it.
 *
 * The person as the group knows them *now* — the name on their row in this
 * group, which is the one every other screen prints — and only failing that the
 * label the event kept. The label is the name on their account at the time,
 * which is not always the one they go by here, and is empty for somebody whose
 * account never had one; the feed used to print it and called the same person
 * two things on two screens, or "Someone".
 *
 * An import is the one event the worker finishes minutes after its author left
 * the page. It records their account and not their seat, so the service looks
 * the seat up (`listGroupActivity`); when there is none — the person is gone,
 * or the import was nobody's — it is Balancia's.
 */
export function actorOf(
  entry: ActivityEntry,
  t: ActivityTranslate,
  names: ReadonlyMap<string, string> = new Map(),
): string {
  if (entry.actorType === "system" || DONE_BY_BALANCIA.has(entry.action)) {
    return "Balancia";
  }
  const seat = entry.actorParticipantId
    ? names.get(entry.actorParticipantId)
    : undefined;
  if (seat) return seat;
  if (entry.action === "import.completed") return "Balancia";
  return entry.actorLabel || t("someone");
}
