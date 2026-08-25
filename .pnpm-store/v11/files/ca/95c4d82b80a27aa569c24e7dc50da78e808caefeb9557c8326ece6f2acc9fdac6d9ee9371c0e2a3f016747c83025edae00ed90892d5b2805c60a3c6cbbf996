import EventEmitter from 'node:events';
import type Manager from './manager.ts';
import type * as types from './types.ts';
declare class Notifier extends EventEmitter implements types.EventsMixin {
    #private;
    events: {
        error: string;
        warning: string;
    };
    constructor(db: types.IDatabase, manager: Manager, config: types.ResolvedConstructorOptions);
    get available(): boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
}
export default Notifier;
//# sourceMappingURL=notifier.d.ts.map