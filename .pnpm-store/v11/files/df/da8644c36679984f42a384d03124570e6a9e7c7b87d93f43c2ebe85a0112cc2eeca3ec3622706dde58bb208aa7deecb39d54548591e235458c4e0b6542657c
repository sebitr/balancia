import type { IDatabase } from '../types.ts';
export interface KyselyTransactionLike {
    executeQuery<R>(query: {
        readonly sql: string;
        readonly parameters: ReadonlyArray<unknown>;
        readonly query: any;
        readonly queryId: {
            readonly queryId: string;
        };
    }, queryId?: unknown): Promise<{
        readonly rows: R[];
    }>;
}
export declare function fromKysely(trx: KyselyTransactionLike): IDatabase;
//# sourceMappingURL=kysely.d.ts.map