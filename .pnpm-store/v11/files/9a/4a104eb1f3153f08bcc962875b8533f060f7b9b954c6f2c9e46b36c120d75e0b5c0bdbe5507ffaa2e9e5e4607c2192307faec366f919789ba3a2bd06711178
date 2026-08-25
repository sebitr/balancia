import type EventEmitter from 'node:events';
import type * as types from './types.ts';
export interface WarningContext {
    emitter: EventEmitter;
    db: types.IDatabase;
    schema: string;
    persistWarnings?: boolean;
    warningEvent: string;
    errorEvent: string;
}
/**
 * Emits a warning event and optionally persists it to the database.
 * This is a shared utility to avoid duplicating warning persistence logic
 * across boss.ts and timekeeper.ts.
 */
export declare function emitAndPersistWarning(ctx: WarningContext, type: string, message: string, data: object): Promise<void>;
//# sourceMappingURL=warning.d.ts.map