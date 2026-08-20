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
import type { RecurringSummary } from "@/modules/recurring/service";
import type { NotificationEntry } from "@/modules/notifications/types";

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
