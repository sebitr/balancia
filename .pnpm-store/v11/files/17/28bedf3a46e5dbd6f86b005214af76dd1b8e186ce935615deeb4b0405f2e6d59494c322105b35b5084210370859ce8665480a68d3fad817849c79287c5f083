import EventEmitter from 'node:events';
import type Manager from './manager.ts';
import * as types from './types.ts';
declare class Boss extends EventEmitter implements types.EventsMixin {
    #private;
    events: {
        error: string;
        warning: string;
    };
    constructor(db: types.IDatabase, manager: Manager, config: types.ResolvedConstructorOptions);
    get maintaining(): boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
    supervise(value?: string | types.QueueResult[]): Promise<void>;
}
export default Boss;
//# sourceMappingURL=boss.d.ts.map