import { SPLIT_METHODS, type SplitMethod } from "@/modules/expenses/split";
import { RECURRENCE_FREQUENCIES } from "@/modules/recurring/schedule";
import type { EntryType } from "./entry-logic";
import type { RecurrenceState } from "./recurrence-sheet";

/**
 * A half-written entry, as fields.
 *
 * The drawer's state is a couple of dozen `useState`s; this is the subset
 * worth carrying across a dismissal, and it is a *separate* shape on purpose.
 * A draft can outlive the version of the form that wrote it — it sits in the
 * browser for a week — so what comes back is validated rather than spread,
 * and a field the form has since dropped is simply not read.
 *
 * What is deliberately not here: the settlement pair and payment method. A
 * repayment starts from a balance the drawer looks up fresh every time, and a
 * week-old idea of who owed whom is exactly the thing not to restore.
 */
export interface EntryDraftFields {
  readonly type: EntryType;
  readonly amountText: string;
  readonly currency: string;
  readonly description: string;
  readonly notes: string;
  readonly category: string;
  readonly subcategory: string;
  /** Whether the category was chosen rather than detected. */
  readonly categoryChosen: boolean;
  readonly date: string;
  readonly payerId: string;
  readonly includedIds: readonly string[];
  readonly splitMethod: SplitMethod;
  readonly splitValues: Readonly<Record<string, string>>;
  readonly recurrence: RecurrenceState;
  readonly attachmentIds: readonly string[];
}

/** Whether there is anything in the form worth keeping. */
export function worthDrafting(fields: {
  amountText: string;
  description: string;
  attachmentIds: readonly string[];
}): boolean {
  // An amount of "0.00" is what the field shows when nobody has typed: it is
  // a placeholder that happens to parse, not something somebody entered.
  const amount = fields.amountText.trim();
  const typedAmount = amount !== "" && Number(amount.replace(",", ".")) > 0;
  return (
    typedAmount ||
    fields.description.trim() !== "" ||
    fields.attachmentIds.length > 0
  );
}

const TYPES: readonly EntryType[] = ["expense", "income", "settle"];

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * A stored draft as fields the form can seed from, or null.
 *
 * Members it names are checked against the real roster for the same reason
 * the group's saved split is: a draft written last Tuesday may name somebody
 * who left on Wednesday, and seeding a split with a participant the server
 * refuses would break an entry nobody had touched.
 *
 * A draft that loses its payer that way is dropped whole rather than repaired.
 * Guessing a different payer is putting words in somebody's mouth about the
 * one fact people most often need to correct.
 */
export function draftFields(
  stored: unknown,
  memberIds: readonly string[],
): EntryDraftFields | null {
  if (typeof stored !== "object" || stored === null) return null;
  const raw = stored as Record<string, unknown>;

  const type = TYPES.includes(raw.type as EntryType)
    ? (raw.type as EntryType)
    : "expense";

  // A settlement's pair is not carried, so a drafted one has nothing left to
  // restore but an amount. It is not worth a row on the group screen.
  if (type === "settle") return null;

  const live = new Set(memberIds);
  const payerId = str(raw.payerId);
  if (!live.has(payerId)) return null;

  const includedIds = strings(raw.includedIds).filter((id) => live.has(id));
  if (includedIds.length === 0) return null;

  const splitMethod = SPLIT_METHODS.includes(raw.splitMethod as SplitMethod)
    ? (raw.splitMethod as SplitMethod)
    : "equal";

  const splitValues: Record<string, string> = {};
  if (typeof raw.splitValues === "object" && raw.splitValues !== null) {
    for (const [id, value] of Object.entries(
      raw.splitValues as Record<string, unknown>,
    )) {
      if (live.has(id) && typeof value === "string") splitValues[id] = value;
    }
  }

  return {
    type,
    amountText: str(raw.amountText),
    currency: str(raw.currency),
    description: str(raw.description),
    notes: str(raw.notes),
    category: str(raw.category),
    subcategory: str(raw.subcategory),
    categoryChosen: raw.categoryChosen === true,
    date: str(raw.date),
    payerId,
    includedIds,
    splitMethod,
    splitValues,
    recurrence: recurrenceFrom(raw.recurrence),
    attachmentIds: strings(raw.attachmentIds),
  };
}

/**
 * The recurrence half, or a rule that does nothing.
 *
 * Repeats-off is the honest fallback for anything unreadable: a draft is a
 * convenience, and the one outcome worth ruling out is silently scheduling
 * something nobody asked for.
 */
function recurrenceFrom(stored: unknown): RecurrenceState {
  const off: RecurrenceState = {
    enabled: false,
    frequency: "monthly",
    interval: 1,
    weekday: 1,
    dayOfMonth: 1,
    weekOfMonth: null,
    endDate: null,
    count: null,
  };
  if (typeof stored !== "object" || stored === null) return off;
  const raw = stored as Record<string, unknown>;
  if (raw.enabled !== true) return off;

  const frequency = RECURRENCE_FREQUENCIES.includes(
    raw.frequency as (typeof RECURRENCE_FREQUENCIES)[number],
  )
    ? (raw.frequency as (typeof RECURRENCE_FREQUENCIES)[number])
    : "monthly";

  const whole = (value: unknown, fallback: number, max: number): number =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= max
      ? value
      : fallback;

  return {
    enabled: true,
    frequency,
    interval: whole(raw.interval, 1, 12),
    weekday: whole(raw.weekday, 1, 7),
    dayOfMonth: whole(raw.dayOfMonth, 1, 31),
    weekOfMonth:
      raw.weekOfMonth === "last" ||
      (typeof raw.weekOfMonth === "number" &&
        raw.weekOfMonth >= 1 &&
        raw.weekOfMonth <= 4)
        ? (raw.weekOfMonth as RecurrenceState["weekOfMonth"])
        : null,
    endDate: typeof raw.endDate === "string" ? raw.endDate : null,
    count:
      typeof raw.count === "number" && Number.isInteger(raw.count)
        ? raw.count
        : null,
  };
}
