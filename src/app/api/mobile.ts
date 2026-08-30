import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthenticationRequiredError,
  AuthorizationError,
} from "@/lib/security/authorization";
import { RateLimitedError } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";
import { AllocationError } from "@/modules/expenses/allocation";
import { AuthError } from "@/modules/auth/service";
import { CurrencyConfigurationError } from "@/modules/currencies/conversion";
import {
  InvalidAmountError,
  serializeMoney,
  type Money,
} from "@/modules/currencies/money";
import type { ExpenseSummary } from "@/modules/expenses/service";
import type { SplitInput } from "@/modules/expenses/split";
import type { SettlementSummary } from "@/modules/settlements/service";
import type { ParticipantSummary } from "@/modules/groups/service";
import type { GroupOverview } from "@/modules/groups/overview";
import type { GroupPosition, HomeOverview } from "@/modules/balances/overview";
import type { GroupAccess } from "@/lib/security/authorization";
import type { ActivityEntry } from "@/modules/activity/service";
import type { PayoutHint } from "@/modules/payouts/hints";
import type { RecurringSummary } from "@/modules/recurring/service";
import type { NotificationEntry } from "@/modules/notifications/types";
import type { GroupStats } from "@/modules/groups/group-stats";
import type { MemberStats } from "@/modules/groups/member-stats";
import type {
  SettleUpTransfer,
  SettleUpView,
} from "@/modules/settlements/settle-up";

/**
 * The mobile API's wire format and error contract, in one place.
 *
 * The web app never needed these routes — Server Components read the domain
 * services directly and Server Actions write through them — but a native
 * client cannot speak the RSC protocol, whose action IDs change on every
 * build. These helpers let a thin `route.ts` expose the same service calls
 * over plain JSON without restating the house rules each time:
 *
 *  - Amounts cross as *strings* of minor units and rates as decimal strings,
 *    exactly as in `expenseInputSchema` and the group export — never as JSON
 *    numbers, which would round a large expense before it reached the money
 *    domain.
 *  - Calendar dates stay `YYYY-MM-DD` strings; instants are ISO 8601.
 *  - An authorization failure is a 404, indistinguishable from a group that
 *    does not exist, so group IDs are not probeable (same rule as the export
 *    route). Missing authentication is the one 401.
 *  - Everything is `Cache-Control: private, no-store`: each response is one
 *    person's financial data and must not sit in a shared cache.
 */

/** JSON response that no shared cache may keep. */
export function noStore(data: unknown, init: { status?: number } = {}) {
  return NextResponse.json(data, {
    status: init.status ?? 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/**
 * The refusals a caller is meant to see, mapped to statuses; anything else is
 * logged in full and reported as an anonymous 500. Mirrors the Server Action
 * funnel in `lib/actions.ts`, minus translation — this API answers in English
 * and leaves presentation to the client.
 */
export function mobileApiError(
  error: unknown,
  route: string,
  context: Record<string, unknown> = {},
): NextResponse {
  if (error instanceof RateLimitedError) {
    return NextResponse.json(
      { error: error.message },
      {
        status: 429,
        headers: {
          "Retry-After": String(error.retryAfterSeconds),
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
  if (error instanceof AuthenticationRequiredError) {
    return noStore({ error: "Sign in to continue." }, { status: 401 });
  }
  if (error instanceof AuthorizationError) {
    return noStore({ error: "Not found." }, { status: 404 });
  }
  // Credential refusals carry deliberately non-enumerating messages, so they
  // are safe to pass through; see the note on SAFE_ERRORS in lib/actions.ts.
  if (error instanceof AuthError) {
    return noStore({ error: error.message }, { status: 401 });
  }
  if (
    error instanceof AllocationError ||
    error instanceof InvalidAmountError ||
    error instanceof CurrencyConfigurationError
  ) {
    return noStore({ error: error.message }, { status: 422 });
  }

  logger.error(
    {
      err:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ...context,
    },
    `${route} failed`,
  );
  return noStore({ error: "Unavailable." }, { status: 500 });
}

/** 422 with the schema's own message — they are written as user-facing prose. */
export function invalidInput(error: z.ZodError): NextResponse {
  return noStore(
    { error: error.issues[0]?.message ?? "Check the request." },
    { status: 422 },
  );
}

/**
 * Body reader that treats malformed JSON as input, not as a crash: the caller
 * gets `undefined` and answers 400 instead of tripping the 500 funnel.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

const uuidSchema = z.uuid();

/**
 * Path segments become SQL parameters, and PostgreSQL throws on a malformed
 * UUID before any row is consulted. Refusing here keeps garbage IDs on the
 * 404 path, where they belong, rather than the 500 one.
 */
export function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

/**
 * The `Idempotency-Key` header, when the caller sent a usable one.
 *
 * A key makes a write safe to repeat: the second call answers with what the
 * first one created rather than creating a second. The browser's offline
 * outbox mints one per queued entry and replays under it, and a native client
 * with a queue of its own should do the same.
 *
 * A UUID is required rather than any opaque token, and a malformed header is
 * ignored rather than refused. Both follow from what the key is for: it is a
 * safety net, and a client that sends a key this route cannot store is better
 * served by its write landing once than by a 400 it will retry forever. The
 * length ceiling is the only thing standing between a header and an unbounded
 * unique index, and a UUID gives it for free.
 */
export function idempotencyKey(request: Request): string | undefined {
  const header = request.headers.get("Idempotency-Key")?.trim();
  return header && isUuid(header) ? header : undefined;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function minor(value: bigint): string {
  return value.toString();
}

function minorOrNull(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

/** `GroupAccess` as the client sees it: the group, who I am in it, my powers. */
export function serializeAccess(access: GroupAccess) {
  return {
    group: {
      id: access.group.id,
      name: access.group.name,
      currencyMode: access.group.currencyMode,
      baseCurrency: access.group.baseCurrency,
      timezone: access.group.timezone,
      archivedAt: iso(access.group.archivedAt),
    },
    role: access.role,
    participantId: access.participantId,
    permissions: access.permissions,
  };
}

export function serializeParticipant(participant: ParticipantSummary) {
  return {
    id: participant.id,
    displayName: participant.displayName,
    email: participant.email,
    userId: participant.userId,
    role: participant.role,
    createdAt: participant.createdAt.toISOString(),
    hasActiveInvitation: participant.hasActiveInvitation,
    invitationCreatedAt: iso(participant.invitationCreatedAt),
    invitationExpiresAt: iso(participant.invitationExpiresAt),
    invitationLastUsedAt: iso(participant.invitationLastUsedAt),
  };
}

export function serializeActivity(entry: ActivityEntry) {
  return {
    id: entry.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata,
    actorLabel: entry.actorLabel,
    actorType: entry.actorType,
    createdAt: entry.createdAt.toISOString(),
  };
}

export function serializeRecurring(template: RecurringSummary) {
  return {
    id: template.id,
    direction: template.direction,
    description: template.description,
    category: template.category,
    subcategory: template.subcategory,
    amount: minor(template.amount),
    currency: template.currency,
    frequency: template.frequency,
    interval: template.interval,
    weekday: template.weekday,
    dayOfMonth: template.dayOfMonth,
    monthOfYear: template.monthOfYear,
    startDate: template.startDate,
    endDate: template.endDate,
    nextRunAt: iso(template.nextRunAt),
    lastRunAt: iso(template.lastRunAt),
    pausedAt: iso(template.pausedAt),
    timezone: template.timezone,
    generatedCount: template.generatedCount,
  };
}

export function serializeNotification(entry: NotificationEntry) {
  return {
    id: entry.id,
    groupId: entry.groupId,
    type: entry.type,
    category: entry.category,
    entityType: entry.entityType,
    entityId: entry.entityId,
    actorLabel: entry.actorLabel,
    payload: entry.payload,
    createdAt: entry.createdAt.toISOString(),
    readAt: iso(entry.readAt),
  };
}

export function serializeExpense(expense: ExpenseSummary) {
  return {
    id: expense.id,
    direction: expense.direction,
    description: expense.description,
    notes: expense.notes,
    category: expense.category,
    subcategory: expense.subcategory,
    amount: minor(expense.amount),
    currency: expense.currency,
    convertedAmount: minorOrNull(expense.convertedAmount),
    convertedCurrency: expense.convertedCurrency,
    exchangeRate: expense.exchangeRate,
    splitMethod: expense.splitMethod,
    expenseDate: expense.expenseDate,
    createdAt: expense.createdAt.toISOString(),
    attachmentCount: expense.attachmentCount,
    recurringExpenseId: expense.recurringExpenseId,
    payers: expense.payers.map((payer) => ({
      participantId: payer.participantId,
      displayName: payer.displayName,
      amount: minor(payer.amount),
      convertedAmount: minorOrNull(payer.convertedAmount),
    })),
    shares: expense.shares.map((share) => ({
      participantId: share.participantId,
      displayName: share.displayName,
      amount: minor(share.amount),
      convertedAmount: minorOrNull(share.convertedAmount),
    })),
  };
}

/** The raw split inputs, so an edit screen reopens at what was typed. */
export function serializeSplitInput(splitInput: SplitInput | null) {
  if (!splitInput) return null;
  return {
    method: splitInput.method,
    entries: splitInput.entries.map((entry) => ({
      participantId: entry.participantId,
      value: entry.value ?? null,
    })),
  };
}

export function serializeSettlement(settlement: SettlementSummary) {
  return {
    id: settlement.id,
    fromParticipantId: settlement.fromParticipantId,
    fromName: settlement.fromName,
    toParticipantId: settlement.toParticipantId,
    toName: settlement.toName,
    amount: minor(settlement.amount),
    currency: settlement.currency,
    convertedAmount: minorOrNull(settlement.convertedAmount),
    convertedCurrency: settlement.convertedCurrency,
    exchangeRate: settlement.exchangeRate,
    settledOn: settlement.settledOn,
    notes: settlement.notes,
    createdAt: settlement.createdAt.toISOString(),
  };
}

export function serializeGroupOverview(overview: GroupOverview) {
  return {
    participantCount: overview.participantCount,
    expenseCount: overview.expenseCount,
    span: overview.span,
    lastOpenedAt: iso(overview.lastOpenedAt),
    positions: overview.positions.map((position) => ({
      currency: position.currency,
      amount: minor(position.amount),
      counterparties: position.counterparties.map((counterparty) => ({
        participantId: counterparty.participantId,
        name: counterparty.name,
        amount: minor(counterparty.amount),
      })),
      breakdown: {
        paid: minor(position.breakdown.paid),
        share: minor(position.breakdown.share),
        revenueReceived: minor(position.breakdown.revenueReceived),
        revenueCredited: minor(position.breakdown.revenueCredited),
        settlementsPaid: minor(position.breakdown.settlementsPaid),
        settlementsReceived: minor(position.breakdown.settlementsReceived),
        otherAdjustments: minor(position.breakdown.otherAdjustments),
      },
    })),
    spendingPeriods: overview.spendingPeriods.map((period) => ({
      key: period.key,
      stats: period.stats.map((stat) => ({
        currency: stat.currency,
        groupSpent: minor(stat.groupSpent),
        youPaid: minor(stat.youPaid),
        yourShare: minor(stat.yourShare),
      })),
    })),
    // Every currency with activity, each carrying its own balances and the
    // transfers that clear it. `rows` and `suggestions` below are the same
    // figures flattened across currencies, which is what the one-currency
    // screen reads; a group with two of them needs them kept apart, and
    // regrouping the flat lists on the client would mean the client deciding
    // an ordering the server has already decided.
    //
    // The count is also the rule for which of the two overviews a group gets:
    // more than one currency here and the screen collapses per currency.
    currencies: overview.currencies.map((entry) => ({
      currency: entry.currency,
      totalSpent: minor(entry.totalSpent),
      expenseCount: entry.expenseCount,
      position: minor(entry.position),
      members: entry.members.map((member) => ({
        participantId: member.participantId,
        name: member.name,
        currency: member.currency,
        amount: minor(member.amount),
        isSelf: member.isSelf,
      })),
      transfers: entry.transfers.map((transfer) => ({
        fromParticipantId: transfer.fromParticipantId,
        fromName: transfer.fromName,
        toParticipantId: transfer.toParticipantId,
        toName: transfer.toName,
        currency: transfer.currency,
        amount: minor(transfer.amount),
        fromIsSelf: transfer.fromIsSelf,
        toIsSelf: transfer.toIsSelf,
      })),
    })),
    rows: overview.rows.map((row) => ({
      participantId: row.participantId,
      name: row.name,
      currency: row.currency,
      amount: minor(row.amount),
      isSelf: row.isSelf,
    })),
    suggestions: overview.suggestions.map((suggestion) => ({
      fromParticipantId: suggestion.fromParticipantId,
      fromName: suggestion.fromName,
      toParticipantId: suggestion.toParticipantId,
      toName: suggestion.toName,
      currency: suggestion.currency,
      amount: minor(suggestion.amount),
      fromIsSelf: suggestion.fromIsSelf,
      toIsSelf: suggestion.toIsSelf,
    })),
  };
}

function serializeMoneyOrNull(value: Money | null) {
  return value ? serializeMoney(value) : null;
}

function serializeGroupPosition(position: GroupPosition) {
  return {
    group: {
      id: position.group.id,
      name: position.group.name,
      description: position.group.description,
      icon: position.group.icon,
      iconColor: position.group.iconColor,
      currencyMode: position.group.currencyMode,
      baseCurrency: position.group.baseCurrency,
      timezone: position.group.timezone,
      archivedAt: iso(position.group.archivedAt),
      role: position.group.role,
      participantCount: position.group.participantCount,
      participantId: position.group.participantId,
      lastActivityAt: position.group.lastActivityAt.toISOString(),
      memberNames: position.group.memberNames,
    },
    amounts: position.amounts.map(serializeMoney),
    net: serializeMoneyOrNull(position.net),
    owedTo: position.owedTo,
  };
}

export function serializeHomeOverview(overview: HomeOverview) {
  return {
    displayCurrency: overview.displayCurrency,
    netPosition: overview.netPosition
      ? {
          owedToYou: serializeMoney(overview.netPosition.owedToYou),
          youOwe: serializeMoney(overview.netPosition.youOwe),
          net: serializeMoney(overview.netPosition.net),
          owedGroupCount: overview.netPosition.owedGroupCount,
          owingGroupCount: overview.netPosition.owingGroupCount,
        }
      : null,
    currencyTotals: overview.currencyTotals.map((total) => ({
      currency: total.currency,
      owedToYou: serializeMoney(total.owedToYou),
      youOwe: serializeMoney(total.youOwe),
    })),
    ratesAsOf: overview.ratesAsOf,
    converted: overview.converted,
    groupCount: overview.groupCount,
    lastCleared: overview.lastCleared
      ? {
          at: overview.lastCleared.at.toISOString(),
          groupName: overview.lastCleared.groupName,
        }
      : null,
    buckets: {
      needsYou: overview.buckets.needsYou.map(serializeGroupPosition),
      youAreOwed: overview.buckets.youAreOwed.map(serializeGroupPosition),
      settled: overview.buckets.settled.map(serializeGroupPosition),
      archived: overview.buckets.archived.map(serializeGroupPosition),
    },
  };
}

/**
 * A group's statistics, whole.
 *
 * One payload for the whole screen, exactly as the web page reads it: three
 * windows, every currency and the all-time records come out of one call, so a
 * client's range switcher costs no round trip and cannot show two blocks read
 * at different instants.
 *
 * Percentages stay JSON numbers. They are ratios the server has already
 * rounded to the one decimal the screens print — not money, and nothing
 * downstream does arithmetic on them.
 */
export function serializeGroupStats(stats: GroupStats) {
  return {
    ranges: stats.ranges.map((range) => ({
      key: range.key,
      granularity: range.granularity,
      months: range.months,
      currencies: range.currencies.map((entry) => ({
        currency: entry.currency,
        totalSpent: minor(entry.totalSpent),
        netTotalSpent: minor(entry.netTotalSpent),
        entryCount: entry.entryCount,
        medianEntry: minor(entry.medianEntry),
        perPersonMonth: minor(entry.perPersonMonth),
        netPerPersonMonth: minor(entry.netPerPersonMonth),
        flows: {
          spent: minor(entry.flows.spent),
          spentCount: entry.flows.spentCount,
          revenue: minor(entry.flows.revenue),
          revenueCount: entry.flows.revenueCount,
          settled: minor(entry.flows.settled),
          settledCount: entry.flows.settledCount,
        },
        buckets: entry.buckets.map((bucket) => ({
          start: bucket.start,
          amount: minor(bucket.amount),
          entryCount: bucket.entryCount,
        })),
        bucketMean: minor(entry.bucketMean),
        trendPercent: entry.trendPercent,
        members: entry.members.map((member) => ({
          participantId: member.participantId,
          name: member.name,
          isSelf: member.isSelf,
          paid: minor(member.paid),
          share: minor(member.share),
          net: minor(member.net),
          open: minor(member.open),
        })),
        categories: entry.categories.map((slice) => ({
          category: slice.category,
          known: slice.known,
          amount: minor(slice.amount),
          percent: slice.percent,
          remainder: minor(slice.remainder),
          children: slice.children.map((child) => ({
            subcategory: child.subcategory,
            amount: minor(child.amount),
            percent: child.percent,
          })),
        })),
        topThreePercent: entry.topThreePercent,
        weekdays: entry.weekdays.map((day) => ({
          weekday: day.weekday,
          entryCount: day.entryCount,
          amount: minor(day.amount),
        })),
      })),
    })),
    records: stats.records.map((records) => ({
      currency: records.currency,
      biggestEntry: records.biggestEntry
        ? {
            description: records.biggestEntry.description,
            category: records.biggestEntry.category,
            subcategory: records.biggestEntry.subcategory,
            date: records.biggestEntry.date,
            amount: minor(records.biggestEntry.amount),
            paidBy: records.biggestEntry.paidBy,
          }
        : null,
      longestOpen: records.longestOpen,
      longestSquare: records.longestSquare,
      busiestWeek: records.busiestWeek
        ? {
            start: records.busiestWeek.start,
            entryCount: records.busiestWeek.entryCount,
            amount: minor(records.busiestWeek.amount),
          }
        : null,
      quietestMonth: records.quietestMonth
        ? {
            month: records.quietestMonth.month,
            entryCount: records.quietestMonth.entryCount,
            amount: minor(records.quietestMonth.amount),
          }
        : null,
    })),
    currencies: stats.currencies,
    firstEntry: stats.firstEntry,
    memberCount: stats.memberCount,
  };
}

/**
 * One member's statistics, whole — the same shape rule as the group's.
 *
 * The activity heatmap crosses in full rather than as a sparse map: it is
 * always `ACTIVITY_DAYS` long with the quiet days filled in, and a client that
 * had to fill them itself would be re-deciding where the window starts.
 */
export function serializeMemberStats(stats: MemberStats) {
  return {
    ranges: stats.ranges.map((range) => ({
      key: range.key,
      granularity: range.granularity,
      months: range.months,
      currencies: range.currencies.map((entry) => ({
        currency: entry.currency,
        paid: minor(entry.paid),
        share: minor(entry.share),
        entryCount: entry.entryCount,
        groupSpent: minor(entry.groupSpent),
        payerIndex: entry.payerIndex,
        sharePercent: entry.sharePercent,
        rank: entry.rank,
        evenPercent: entry.evenPercent,
        medianPercent: entry.medianPercent,
        members: entry.members.map((member) => ({
          participantId: member.participantId,
          name: member.name,
          percent: member.percent,
          isSubject: member.isSubject,
        })),
        buckets: entry.buckets.map((bucket) => ({
          start: bucket.start,
          paid: minor(bucket.paid),
          share: minor(bucket.share),
        })),
        categories: entry.categories.map((slice) => ({
          category: slice.category,
          amount: minor(slice.amount),
          percent: slice.percent,
        })),
        partners: entry.partners.map((partner) => ({
          participantId: partner.participantId,
          name: partner.name,
          entryCount: partner.entryCount,
          amount: minor(partner.amount),
        })),
        topPartnerPercent: entry.topPartnerPercent,
      })),
    })),
    activity: {
      days: stats.activity.days.map((day) => ({
        date: day.date,
        count: day.count,
        amounts: day.amounts.map((amount) => ({
          currency: amount.currency,
          amount: minor(amount.amount),
        })),
      })),
      longestRun: stats.activity.longestRun,
      currentRun: stats.activity.currentRun,
    },
    records: stats.records.map((records) => ({
      currency: records.currency,
      biggestBill: records.biggestBill
        ? {
            description: records.biggestBill.description,
            category: records.biggestBill.category,
            date: records.biggestBill.date,
            amount: minor(records.biggestBill.amount),
          }
        : null,
      longestDebt: records.longestDebt,
      fastestSettle: records.fastestSettle,
      quietestMonth: records.quietestMonth
        ? {
            month: records.quietestMonth.month,
            entryCount: records.quietestMonth.entryCount,
            amount: minor(records.quietestMonth.amount),
          }
        : null,
    })),
    firstEntry: stats.firstEntry,
    currencies: stats.currencies,
  };
}

/** One suggested transfer, as both settle-up blocks write it. */
function serializeTransfer(transfer: SettleUpTransfer) {
  return {
    fromParticipantId: transfer.fromParticipantId,
    fromName: transfer.fromName,
    toParticipantId: transfer.toParticipantId,
    toName: transfer.toName,
    currency: transfer.currency,
    amount: minor(transfer.amount),
    fromIsSelf: transfer.fromIsSelf,
    toIsSelf: transfer.toIsSelf,
  };
}

/**
 * The shortest set of transfers that clears the group.
 *
 * `yours` and `others` stay apart on the wire because the split is the
 * screen's whole point: one is a list of things the reader can do, the other
 * is there so the figures add up. `lastSettled` is only populated when nothing
 * is left to settle, and a client should read an empty list as "no room for
 * it" rather than "no repayments have ever happened".
 */
export function serializeSettleUp(
  view: SettleUpView,
  /**
   * How to pay each debt, when the caller has looked them up.
   *
   * Passed in rather than read here: this file serializes, and reaching into
   * the payouts tables from a serializer would put a second permission
   * decision somewhere nobody looks for one.
   */
  payoutHints: readonly PayoutHint[] = [],
) {
  return {
    currencies: view.currencies.map((entry) => ({
      currency: entry.currency,
      yours: entry.yours.map(serializeTransfer),
      others: entry.others.map(serializeTransfer),
    })),
    transferCount: view.transferCount,
    payoutHints: payoutHints.map((hint) => ({
      participantId: hint.participantId,
      currency: hint.currency,
      methods: hint.methods.map((entry) => ({
        method: entry.method,
        detail: entry.detail,
        // Per method, because a code is no longer only ever the bank's: Pix
        // and Swish each have one of their own. Added beside the pair below
        // rather than replacing it, so a client built against the old shape
        // keeps reading the leading code exactly where it always was.
        qr: entry.qr
          ? { standard: entry.qr.standard, payload: entry.qr.payload }
          : null,
        qrMissing: entry.qrMissing,
      })),
      qr: hint.qr
        ? { standard: hint.qr.standard, payload: hint.qr.payload }
        : null,
      qrMissing: hint.qrMissing,
    })),
    lastSettled: view.lastSettled.map((repayment) => ({
      id: repayment.id,
      fromName: repayment.fromName,
      toName: repayment.toName,
      amount: minor(repayment.amount),
      currency: repayment.currency,
      settledOn: repayment.settledOn,
      paymentMethod: repayment.paymentMethod,
    })),
  };
}
