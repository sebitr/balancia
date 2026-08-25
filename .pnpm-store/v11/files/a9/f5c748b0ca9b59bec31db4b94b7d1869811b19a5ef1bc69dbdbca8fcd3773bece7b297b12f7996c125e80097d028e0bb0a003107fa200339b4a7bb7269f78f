import EventEmitter from 'node:events';
import * as types from './types.ts';
declare class Bam extends EventEmitter implements types.EventsMixin {
    #private;
    events: {
        error: string;
        bam: string;
    };
    constructor(db: types.IDatabase, config: types.ResolvedConstructorOptions);
    get working(): boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
}
export default Bam;
//# sourceMappingURL=bam.d.ts.map