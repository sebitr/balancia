import type { JobMatchStrategy, UpdateQueueOptions, ManagedIndex, ManagedFunction } from './types.ts';
import type { ExpectedColumns, ExpectedConstraints } from './drifter.ts';
export interface SqlQuery {
    text: string;
    values: unknown[];
}
export declare const PG_ERROR: {
    divisionByZero: string;
};
export declare const DEFAULT_SCHEMA = "pgboss";
export declare const MIGRATE_RACE_MESSAGE = "division by zero";
export declare const CREATE_RACE_MESSAGE = "already exists";
export declare const SINGLE_QUOTE_REGEX: RegExp;
export declare const JOB_STATES: Readonly<{
    created: "created";
    retry: "retry";
    active: "active";
    completed: "completed";
    cancelled: "cancelled";
    failed: "failed";
}>;
export declare const QUEUE_POLICIES: Readonly<{
    standard: "standard";
    short: "short";
    singleton: "singleton";
    stately: "stately";
    exclusive: "exclusive";
    key_strict_fifo: "key_strict_fifo";
}>;
export declare const COMMON_JOB_TABLE = "job_common";
interface CreateOptions {
    createSchema?: boolean;
    noTablePartitioning?: boolean;
    noDeferrableConstraints?: boolean;
    noAdvisoryLocks?: boolean;
    noCoveringIndexes?: boolean;
}
export declare function create(schema: string, version: number, options?: CreateOptions): string;
export declare function createTableWarning(schema: string): string;
export declare function createIndexWarning(schema: string): string;
export declare function createTableJobDependency(schema: string): string;
export declare function createIndexJobDependencyParent(schema: string): string;
export declare function jobTableFormatFunction(schema: string): string;
export declare function createQueue(schema: string, name: string, options: unknown, noAdvisoryLocks?: boolean): string;
export declare function notifyChannelSql(schema: string): string;
export declare function notifyQueue(schema: string, name: string): string;
export declare function deleteQueue(schema: string, name: string, noAdvisoryLocks?: boolean): string;
export declare function trySetQueueMonitorTime(schema: string, queues: string[], seconds: number): SqlQuery;
export declare function trySetQueueDeletionTime(schema: string, queues: string[], seconds: number): SqlQuery;
export declare function trySetCronTime(schema: string, seconds: number): string;
export declare function trySetBamTime(schema: string, seconds: number): string;
export declare function trySetFlowTime(schema: string, seconds: number): string;
export declare function updateQueue(schema: string, { deadLetter }?: UpdateQueueOptions): string;
export declare function getQueues(schema: string, names?: string[]): SqlQuery;
export declare function deleteJobsById(schema: string, table: string): string;
export declare function deleteQueuedJobs(schema: string, table: string): string;
export declare function deleteStoredJobs(schema: string, table: string): string;
export declare function truncateTable(schema: string, table: string): string;
export declare function deleteAllJobs(schema: string, table: string): string;
export declare function getSchedules(schema: string): string;
export declare function getSchedulesByQueue(schema: string): string;
export declare function getSchedulesByQueueAndKey(schema: string): string;
export declare function schedule(schema: string): string;
export declare function unschedule(schema: string): string;
export declare function subscribe(schema: string): string;
export declare function unsubscribe(schema: string): string;
export declare function getQueuesForEvent(schema: string): string;
export declare function getTime(): string;
export declare function insertWarning(schema: string): string;
export declare function getWarnings(schema: string): string;
export declare function getWarningsCount(schema: string): string;
export declare function deleteOldWarnings(schema: string, days: number): string;
export declare function createTableQueueStats(schema: string, noPartitioning?: boolean): string;
export declare function createIndexQueueStats(schema: string, noCoveringIndex?: boolean): string;
export declare function ensureQueueStatsPartitions(schema: string): string;
export declare function dropOldQueueStatsPartitions(schema: string, days: number): string;
export declare function deleteOldQueueStats(schema: string, days: number): string;
export declare function insertQueueStats(schema: string, queues: string[], noAdvisoryLocks?: boolean): string;
export declare function getQueueStatsCache(schema: string): string;
export declare function getQueueStatsHistory(schema: string): string;
export declare function getQueueStatsHistoryBucketed(schema: string, aggregate: 'max' | 'min' | 'avg', mode: 'bucket' | 'auto'): string;
export declare function getVersion(schema: string): string;
export declare function setVersion(schema: string, version: number): string;
export declare function versionTableExists(schema: string): string;
export declare function getSchemaCaseVariants(schema: string): string;
export declare function getPartitionedQueueTables(schema: string): string;
export declare function insertVersion(schema: string, version: number): string;
interface GroupConcurrencyConfig {
    default: number;
    tiers?: Record<string, number>;
}
interface FetchJobOptions {
    schema: string;
    table: string;
    name: string;
    policy: string | undefined;
    limit: number;
    includeMetadata?: boolean;
    priority?: boolean;
    orderByCreatedOn?: boolean;
    ignoreStartAfter?: boolean;
    ignoreSingletons: string[] | null;
    ignoreGroups?: string[] | null;
    groupConcurrency?: number | GroupConcurrencyConfig;
    minPriority?: number;
    maxPriority?: number;
}
/**
 * Builds the fetch query for claiming jobs from the queue.
 *
 * With SKIP LOCKED (noSkipLocked=false, the default), uses SELECT FOR UPDATE SKIP
 * LOCKED, which lets multiple workers efficiently fetch different jobs simultaneously.
 *
 * With noSkipLocked=true, omits FOR UPDATE SKIP LOCKED and adds an additional state
 * check in the WHERE clause. This pattern works better with distributed databases like
 * CockroachDB where SKIP LOCKED has performance issues and can unexpectedly skip
 * unlocked rows.
 *
 * Trade-off when noSkipLocked is set: under high contention, workers may receive fewer
 * jobs per fetch as concurrent updates to the same rows will result in some workers
 * getting empty results. This is acceptable for job queues where processing time
 * exceeds fetch time.
 */
export declare function fetchNextJob(options: FetchJobOptions, noSkipLocked?: boolean): SqlQuery;
export declare function completeJobs(schema: string, table: string, includeQueued?: boolean): string;
export declare function completeJobsWithOutputs(schema: string, table: string): string;
export declare function completeJobsWithOutputsDistributed(schema: string, table: string): string;
export declare function cancelJobs(schema: string, table: string): string;
export declare function resumeJobs(schema: string, table: string): string;
export declare function restoreJobs(schema: string, table: string): string;
interface InsertJobsOptions {
    table: string;
    name: string;
    returnId?: boolean;
    notify?: boolean;
}
export declare function insertJobs(schema: string, { table, name, returnId, notify }: InsertJobsOptions): string;
export declare function insertFlowJobs(schema: string, { table, name }: {
    table: string;
    name: string;
}, jobs: unknown[]): string;
export declare function failJobsById(schema: string, table: string): string;
export declare function failJobsByTimeout(schema: string, table: string, queues: string[], noAdvisoryLocks?: boolean): string;
export declare function failJobsByHeartbeat(schema: string, table: string, queues: string[], noAdvisoryLocks?: boolean): string;
export declare function touchJobs(schema: string, table: string): string;
export declare function failJobsByIdWithOutputs(schema: string, table: string): string;
export declare function deadLetterJobsByIdWithOutputs(schema: string, table: string): string;
export declare function selectJobsToFailById(schema: string, table: string): SqlQuery;
export declare function deleteJobsToFail(schema: string, table: string): SqlQuery;
export declare function selectJobsToFailByTimeout(schema: string, table: string, queues: string[]): SqlQuery;
export declare function selectJobsToFailByHeartbeat(schema: string, table: string, queues: string[]): SqlQuery;
export declare function deleteJobsByIds(schema: string, table: string): SqlQuery;
export declare function completeJobsDistributed(schema: string, table: string, includeQueued?: boolean): string;
export declare function decrementDependents(schema: string): string;
export declare const FLOW_BATCH_SIZE = 1000;
export declare function resolveFlowJobs(schema: string, table: string, names: string[]): SqlQuery;
export declare function selectBlockingParents(schema: string, table: string, names: string[], noSkipLocked?: boolean): SqlQuery;
export declare function clearBlocking(schema: string): string;
export declare function insertRetryJob(schema: string, table: string): string;
export declare function insertDeadLetterJob(schema: string): string;
export declare function redriveJobs(schema: string, table: string): string;
export declare function deletion(schema: string, table: string, queues: string[], noAdvisoryLocks?: boolean): string;
export declare function retryJobs(schema: string, table: string): string;
export declare function updateJob(schema: string, table: string, name: string, by: 'id' | 'singletonKey', match: JobMatchStrategy, notify?: boolean): string;
export declare function getQueueStats(schema: string, table: string, queues: string[]): SqlQuery;
export declare const READY_HISTORY_SIZE = 60;
export declare function cacheQueueStats(schema: string, table: string, queues: string[], noAdvisoryLocks?: boolean): string;
export declare function refreshQueueStats(schema: string, table: string, name: string): string;
export declare function serializeArrayParam(values: string[]): string;
export declare function serializeJsonParam(value: unknown): string;
export declare function transaction(query: string | string[]): string;
export declare function locked(schema: string, query: string | string[], key?: string, noAdvisoryLocks?: boolean): string;
export declare function assertMigration(schema: string, version: number): string;
export declare function findJobs(schema: string, table: string, options: {
    queued: boolean;
    byKey: boolean;
    byData: boolean;
    byId: boolean;
}): string;
export declare function getJobById(schema: string, table: string): string;
export declare function insertDependencies(schema: string, deps?: unknown[]): string;
export declare function getDependencies(schema: string): string;
export declare function getDependents(schema: string): string;
export declare function cleanupDependencies(schema: string, table: string, queues: string[], noAdvisoryLocks?: boolean): string;
export declare function getBlockedKeys(schema: string, table: string): string;
export declare function getNextBamCommand(schema: string, { useLiveness }?: {
    useLiveness?: boolean;
}): string;
export declare function bamHealDrop(schema: string, command: string): string | null;
export declare function bamHealProbe(schema: string, command: string): string | null;
export declare function setBamCompleted(schema: string, id: string): string;
export declare function setBamFailed(schema: string, id: string, error: string): string;
export declare function getBamStatus(schema: string): string;
export declare function getBamEntries(schema: string): string;
export declare function jobCommonExists(schema: string): string;
export declare function getManagedQueuePartitions(schema: string): string;
export declare function getIncompleteBamCommands(schema: string): string;
export declare function bamCommandIndexName(command: string): string | null;
interface QueuePartition {
    table: string;
    policy?: string | null;
}
export declare const EXPECTED_JOB_STATES: readonly string[];
export declare function expectedManagedTables(schema: string, partitioned: boolean, partitions?: QueuePartition[]): string[];
export declare function expectedManagedColumns(schema: string, partitioned: boolean, partitions?: QueuePartition[]): ExpectedColumns[];
export declare function expectedManagedConstraints(schema: string, partitioned: boolean): ExpectedConstraints[];
export declare function expectedManagedFunctions(schema: string, partitioned: boolean): ManagedFunction[];
export declare function expectedManagedIndexes(schema: string, partitioned: boolean, partitions?: QueuePartition[]): ManagedIndex[];
export {};
//# sourceMappingURL=plans.d.ts.map