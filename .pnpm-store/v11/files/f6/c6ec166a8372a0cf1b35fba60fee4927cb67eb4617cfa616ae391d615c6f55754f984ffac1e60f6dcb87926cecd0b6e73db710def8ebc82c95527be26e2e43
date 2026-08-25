export type JobSpyState = 'created' | 'active' | 'completed' | 'failed';
export type JobDataSelector<T = object> = (jobData: T) => boolean;
export type JobSelector<T = object> = (job: SpyJob<T>) => boolean;
export interface SpyJob<T = object> {
    id: string;
    name: string;
    data: T;
    state: JobSpyState;
    output?: object;
}
export interface JobSpyInterface<T = object> {
    clear(): void;
    waitForJob(selector: JobDataSelector<T>, state: JobSpyState): Promise<SpyJob<T>>;
    waitForJobWithId(id: string, state: JobSpyState): Promise<SpyJob<T>>;
}
export declare class JobSpy<T = object> implements JobSpyInterface<T> {
    #private;
    clear(): void;
    waitForJobWithId(id: string, awaitedState: JobSpyState): Promise<SpyJob<T>>;
    waitForJob(dataSelector: JobDataSelector<T>, awaitedState: JobSpyState, specificId?: string): Promise<SpyJob<T>>;
    addJob(id: string, name: string, data: T, state: JobSpyState, output?: object): void;
}
//# sourceMappingURL=spy.d.ts.map