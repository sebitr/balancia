import type { DestinationView, RunView } from "@/modules/backup/service";

/**
 * A destination and its runs, as the overview tests find them.
 *
 * One fixed morning, so "Today" and "Tomorrow" mean the same thing on the day
 * the tests are written and the day they are run: the server's clock for the
 * render is passed in as `NOW`, and every date here is placed relative to it.
 * Written in UTC, which is the zone the component tests format in.
 */

/** Friday 9 October 2026, 15:30 UTC. */
export const NOW = "2026-10-09T15:30:00.000Z";

export function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "r1",
    trigger: "schedule",
    status: "succeeded",
    startedAt: new Date("2026-10-09T03:30:00.000Z"),
    finishedAt: new Date("2026-10-09T03:30:12.000Z"),
    groupCount: 3,
    bytes: 212_000,
    objectName: "balancia-backup-20261009T033000Z.json.gz.age",
    receiptsWritten: 0,
    receiptsPending: 0,
    errorCode: null,
    errorDetail: null,
    ...overrides,
  };
}

export function destination(
  overrides: Partial<DestinationView> = {},
): DestinationView {
  const good = run();
  return {
    id: "d1",
    provider: "google_drive",
    label: "Google Drive · ada@example.com",
    frequency: "daily",
    keepLast: 10,
    excludedGroupIds: [],
    includeReceipts: false,
    status: "active",
    nextRunAt: new Date("2026-10-10T03:30:00.000Z"),
    lastRunAt: good.startedAt,
    lastSuccessAt: good.finishedAt,
    consecutiveFailures: 0,
    createdAt: new Date("2026-09-01T09:00:00.000Z"),
    attention: null,
    latestRun: good,
    latestSuccess: good,
    ...overrides,
  };
}

/** Six groups, so the lists that fold have something to fold. */
export const GROUPS = [
  {
    id: "g1",
    name: "Flat",
    participantCount: 3,
    lastActivityAt: new Date("2026-10-08T18:00:00.000Z"),
  },
  {
    id: "g2",
    name: "Lisbon, March",
    participantCount: 5,
    lastActivityAt: new Date("2026-10-07T09:00:00.000Z"),
  },
  { id: "g3", name: "Ski week", participantCount: 8, lastActivityAt: null },
  { id: "g4", name: "Book club", participantCount: 1, lastActivityAt: null },
  {
    id: "g5",
    name: "Office lunches",
    participantCount: 12,
    lastActivityAt: null,
  },
  { id: "g6", name: "Wedding", participantCount: 2, lastActivityAt: null },
] as const;
