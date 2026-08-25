import EventEmitter from 'node:events';
import type Manager from './manager.ts';
import * as types from './types.ts';
declare class Navigator extends EventEmitter implements types.EventsMixin {
    #private;
    events: {
        error: string;
        flow: string;
    };
    constructor(db: types.IDatabase, manager: Manager, config: types.ResolvedConstructorOptions);
    get working(): boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
    resolveNow(): Promise<void>;
}
export default Navigator;
//# sourceMappingURL=navigator.d.ts.map