import EventEmitter from 'node:events';
import type Manager from './manager.ts';
import * as types from './types.ts';
export declare const QUEUES: {
    SEND_IT: string;
};
declare class Timekeeper extends EventEmitter implements types.EventsMixin {
    db: types.IDatabase;
    config: types.ResolvedConstructorOptions;
    manager: Manager;
    private stopped;
    private cronMonitorInterval;
    private skewMonitorInterval;
    private timekeeping;
    private _checkingSkew;
    clockSkew: number;
    events: {
        error: string;
        schedule: string;
        warning: string;
    };
    constructor(db: types.IDatabase, manager: Manager, config: types.ResolvedConstructorOptions);
    get checkingSkew(): boolean;
    private get warningContext();
    start(): Promise<void>;
    stop(): Promise<void>;
    cacheClockSkew(): Promise<void>;
    onCron(): Promise<void>;
    cron(): Promise<void>;
    shouldSendIt(cron: string, tz: string): boolean;
    private onSendIt;
    getSchedules(name?: string, key?: string): Promise<types.Schedule[]>;
    schedule(name: string, cron: string, data?: unknown, options?: types.ScheduleOptions): Promise<void>;
    unschedule(name: string, key?: string): Promise<void>;
}
export default Timekeeper;
//# sourceMappingURL=timekeeper.d.ts.map