import EventEmitter from 'node:events';
import type * as types from './types.ts';
declare class Db extends EventEmitter implements types.IDatabase, types.EventsMixin {
    private pool;
    private config;
    opened: boolean;
    constructor(config: types.DatabaseOptions);
    events: {
        error: string;
    };
    open(): Promise<void>;
    close(): Promise<void>;
    executeSql(text: string, values?: unknown[]): Promise<import("pg").QueryResult<any>>;
    listen(channel: string, onNotification: (payload: string) => void, onReconnect: () => void): Promise<types.ListenHandle>;
    withTransaction<T>(fn: (db: types.IDatabase) => Promise<T>): Promise<T>;
}
export default Db;
//# sourceMappingURL=db.d.ts.map