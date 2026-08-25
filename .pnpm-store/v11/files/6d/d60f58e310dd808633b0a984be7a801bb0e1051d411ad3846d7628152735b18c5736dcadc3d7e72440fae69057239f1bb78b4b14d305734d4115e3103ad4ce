import type { IDatabase } from '../types.ts';
export interface PGliteLike {
    query<T = any>(query: string, params?: unknown[]): Promise<{
        rows: T[];
    }>;
    exec(query: string): Promise<Array<{
        rows: any[];
    }>>;
    listen?(channel: string, callback: (payload: string) => void): Promise<() => Promise<void>>;
}
export declare function fromPglite(pglite: PGliteLike): IDatabase;
//# sourceMappingURL=pglite.d.ts.map