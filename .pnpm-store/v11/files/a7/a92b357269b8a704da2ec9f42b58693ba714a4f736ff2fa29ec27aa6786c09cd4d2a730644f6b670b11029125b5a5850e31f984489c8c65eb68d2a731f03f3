import type * as types from './types.ts';
interface WorkerOptions<T> {
    id: string;
    workId: string;
    name: string;
    options: types.WorkOptions;
    resolveInterval: (lastFetchCount: number) => number;
    fetch: () => Promise<types.Job<T>[]>;
    onFetch: (jobs: types.Job<T>[]) => Promise<void>;
    onError: (err: any) => void;
}
declare class Worker<T = unknown> {
    readonly id: string;
    readonly workId: string;
    readonly name: string;
    readonly options: types.WorkOptions;
    readonly fetch: () => Promise<types.Job<T>[]>;
    readonly onFetch: (jobs: types.Job<T>[]) => Promise<void>;
    readonly onError: (err: any) => void;
    readonly resolveInterval: (lastFetchCount: number) => number;
    jobs: types.Job<T>[];
    createdOn: number;
    state: types.WorkerState;
    lastFetchedOn: number | null;
    lastJobStartedOn: number | null;
    lastJobEndedOn: number | null;
    lastJobDuration: number | null;
    lastError: any;
    lastErrorOn: number | null;
    stopping: boolean;
    stopped: boolean;
    abortController: AbortController | null;
    private loopDelayPromise;
    private beenNotified;
    private runPromise;
    constructor({ id, workId, name, options, resolveInterval, fetch, onFetch, onError }: WorkerOptions<T>);
    start(): void;
    private run;
    notify(): void;
    stop(): Promise<void>;
    abort(): void;
    toWipData(): types.WipData;
}
export default Worker;
//# sourceMappingURL=worker.d.ts.map