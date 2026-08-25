import type { IDatabase } from '../types.ts';
export interface KnexTransactionLike {
    raw<T = any>(sql: string, bindings?: readonly unknown[]): Promise<{
        rows: T[];
    } | {
        rows: any[];
    }[]>;
}
export declare function fromKnex(trx: KnexTransactionLike): IDatabase;
//# sourceMappingURL=knex.d.ts.map