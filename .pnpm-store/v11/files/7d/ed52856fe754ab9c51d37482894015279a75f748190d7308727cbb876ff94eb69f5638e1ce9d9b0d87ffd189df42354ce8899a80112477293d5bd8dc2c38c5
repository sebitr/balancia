import type * as types from './types.ts';
declare const POLICY: {
    MAX_EXPIRATION_HOURS: number;
    MIN_POLLING_INTERVAL_MS: number;
    MAX_RETENTION_DAYS: number;
};
declare function validateQueueArgs(config?: any): void;
declare function checkSendArgs(args: any): types.Request;
declare function checkUpdateArgs(args: any, { upsert }?: {
    upsert?: boolean | undefined;
}): types.Request;
declare function validateGroupConfig(config: any): void;
declare function validateFlowJobs(jobs: types.FlowJob[]): void;
declare function checkWorkArgs(name: string, args: any[]): {
    options: types.ResolvedWorkOptions;
    callback: types.WorkHandler<any>;
};
declare function checkFetchArgs(name: string, options: any): void;
declare function getConfig(value: string | types.ConstructorOptions): types.ResolvedConstructorOptions;
declare function assertPostgresObjectName(name: string): void;
declare function assertQueueName(name: string): void;
declare function assertKey(key: string): void;
export { assertKey, assertPostgresObjectName, assertQueueName, checkFetchArgs, checkSendArgs, checkUpdateArgs, checkWorkArgs, getConfig, POLICY, validateFlowJobs, validateGroupConfig, validateQueueArgs };
//# sourceMappingURL=attorney.d.ts.map