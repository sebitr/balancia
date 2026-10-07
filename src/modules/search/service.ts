import "server-only";
import { and, asc, desc, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { participants } from "@/lib/db/schema";
import type { Actor, GroupAccess } from "@/lib/security/authorization";
import {
  NO_FILTER,
  searchNeedle,
  type RowView,
} from "@/components/expenses/list-filter";
import {
  loadNavigationGroups,
  type NavigationGroup,
} from "@/modules/balances/navigation";
import { loadTransactionPage } from "@/modules/expenses/transactions";

/**
 * "Search or jump to": the reader's groups, the people in them and the
 * transactions of the group they are in, answered at once for the command
 * palette.
 *
 * Nothing here is a second read model. The groups are the sidebar's own list
 * (`loadNavigationGroups`), so a group reads the same in the palette as in the
 * column beside it, position words and all. The transactions are a page of the
 * transactions list (`loadTransactionPage`) with the search field filled in,
 * so the palette finds exactly what that screen's search would find — a
 * title, a repayment's sentence, a date as the reader writes it — and in the
 * same order. Only the people are read here, because no screen searches them
 * across groups.
 *
 * Matching is the list's: the query trimmed and lowered, found anywhere in
 * the name, accents kept ("hotel" does not find "Hôtel"), on both sides of the
 * wire — see `searchNeedle` and `transaction-filter.ts`.
 *
 * Transactions come from the group the reader is in and from no other. A
 * search from Home would be a page of the list per group the reader belongs
 * to, on every keystroke, to answer what typing the group's name and opening
 * it answers in two.
 */

/**
 * How many of each the palette lists: enough to pick from, few enough to read
 * at a glance and to keep every answer one short page of each query.
 */
export const PALETTE_LIMITS = {
  groups: 6,
  people: 5,
  entries: 5,
} as const;

/** Longer than any group's or person's name; a search, not a payload. */
export const PALETTE_QUERY_MAX = 100;

/** Somebody in one of the reader's groups, and which group. */
export interface PalettePerson {
  /** The participant, which their page in that group is addressed by. */
  readonly id: string;
  readonly name: string;
  readonly groupId: string;
  readonly groupName: string;
}

/** The current group's transactions that match, as the list draws them. */
export interface PaletteEntries {
  readonly groupId: string;
  readonly groupName: string;
  /** The reader's own participant, so a row can say "You paid". */
  readonly self: string | null;
  readonly rows: readonly RowView[];
}

export interface PaletteResults {
  readonly groups: readonly NavigationGroup[];
  readonly people: readonly PalettePerson[];
  /** Null outside a group, and for an empty query. */
  readonly entries: PaletteEntries | null;
}

export interface PaletteSearchOptions {
  readonly db?: Database;
  /** A day as the reader writes it; the request's own notation when absent. */
  readonly dateText?: (date: string) => string;
}

/**
 * What the palette shows for `query`.
 *
 * `access` is the group the screen belongs to, already verified by the caller
 * through `authorizeGroup` — the one group whose transactions are searched,
 * and whose people come first. Null outside a group.
 *
 * An empty query lists the groups and nothing else: people and transactions
 * are too many to offer before anything has been typed, and the actions the
 * palette always offers are the browser's to draw.
 */
export async function searchPalette(
  actor: Actor,
  access: GroupAccess | null,
  query: string,
  options: PaletteSearchOptions = {},
): Promise<PaletteResults> {
  const needle = searchNeedle({ ...NO_FILTER, query });

  // A guest has one group and no list of them; their palette searches the
  // group they are in.
  const groups =
    actor.kind === "user" ? await loadNavigationGroups(actor.userId) : [];
  const matching = groups
    .filter(
      (group) => needle === "" || group.name.toLowerCase().includes(needle),
    )
    .slice(0, PALETTE_LIMITS.groups);

  if (needle === "") {
    return { groups: matching, people: [], entries: null };
  }

  const [people, page] = await Promise.all([
    findPeople(actor, access, groups, needle, options.db ?? getDb()),
    access
      ? loadTransactionPage(access, {
          filter: { ...NO_FILTER, query },
          limit: PALETTE_LIMITS.entries,
          dateText: options.dateText,
          db: options.db,
        })
      : null,
  ]);

  return {
    groups: matching,
    people,
    entries:
      access && page
        ? {
            groupId: access.groupId,
            groupName: access.group.name,
            self: access.participantId,
            rows: page.rows,
          }
        : null,
  };
}

/**
 * The people whose name holds `needle`, in any group the reader is in.
 *
 * The groups are the ones the reader was just listed — their memberships, read
 * by `loadNavigationGroups` — plus the group the screen belongs to, which the
 * caller authorized and which may be archived and so missing from that list.
 * Nobody is found in a group the reader is not in.
 *
 * The reader is left out of their own search, and so is anybody removed from
 * a group. People in the current group come first: they are the ones a reader
 * typing a name inside a group is most likely looking for.
 */
async function findPeople(
  actor: Actor,
  access: GroupAccess | null,
  groups: readonly NavigationGroup[],
  needle: string,
  db: Database,
): Promise<PalettePerson[]> {
  const names = new Map<string, string>();
  for (const group of groups) names.set(group.id, group.name);
  if (access) names.set(access.groupId, access.group.name);
  if (names.size === 0) return [];

  const notSelf =
    actor.kind === "user"
      ? or(isNull(participants.userId), ne(participants.userId, actor.userId))
      : ne(participants.id, actor.participantId);

  const rows = await db
    .select({
      id: participants.id,
      name: participants.displayName,
      groupId: participants.groupId,
    })
    .from(participants)
    .where(
      and(
        inArray(participants.groupId, [...names.keys()]),
        isNull(participants.removedAt),
        notSelf,
        // As the transactions search lowers a title: full Unicode case
        // mapping, so "ÉLODIE" finds "élodie" — see `transaction-filter.ts`.
        sql`strpos(lower(${participants.displayName} COLLATE pg_unicode_fast), ${needle}) > 0`,
      ),
    )
    .orderBy(
      ...(access
        ? [desc(sql`${participants.groupId} = ${access.groupId}`)]
        : []),
      asc(participants.displayName),
      asc(participants.id),
    )
    .limit(PALETTE_LIMITS.people);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    groupId: row.groupId,
    groupName: names.get(row.groupId) ?? "",
  }));
}
