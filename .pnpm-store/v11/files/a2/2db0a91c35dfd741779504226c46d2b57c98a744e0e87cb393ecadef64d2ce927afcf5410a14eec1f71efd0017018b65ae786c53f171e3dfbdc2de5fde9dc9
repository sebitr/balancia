import * as types from './types.ts';
interface MigrateOptions {
    inlineAsync?: boolean;
    partitionTables?: string[];
}
interface MigrationCommands {
    sql: string;
    concurrent: string[];
}
declare function rollback(schema: string, version: number, migrations?: types.Migration[], noAdvisoryLocks?: boolean): string;
declare function next(schema: string, version: number, migrations?: types.Migration[], noAdvisoryLocks?: boolean): string;
declare function migrateCommands(schema: string, version: number, migrations?: types.Migration[], noAdvisoryLocks?: boolean, options?: MigrateOptions): MigrationCommands;
declare function migrate(schema: string, version: number, migrations?: types.Migration[], noAdvisoryLocks?: boolean, options?: MigrateOptions): string;
declare function getMinVersion(schema: string): number;
declare function getAll(schema: string, noPartitioning?: boolean, noCovering?: boolean): types.Migration[];
export { rollback, next, migrate, migrateCommands, getAll, getMinVersion, };
//# sourceMappingURL=migrationStore.d.ts.map