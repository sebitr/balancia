import type { ManagedIndex, ManagedFunction, TableColumnDrift, ConstraintDrift, SchemaDriftReport } from './types.ts';
export declare function indexKeys(ddl: string): string;
export declare function indexPredicate(ddl: string): string;
export declare function indexKeysRaw(ddl: string): string;
export declare function indexPredicateRaw(ddl: string): string;
export declare function displayIndexDefinition(def: string): string;
export declare function extractFunctionBody(def: string): string;
export declare function normalizeFunctionBody(body: string): string;
export declare function normalizeDefault(expr: string): string;
export declare function normalizeConstraintDef(def: string): string;
export declare function getSchemaIndexes(schema: string): string;
export declare function getSchemaFunctions(schema: string): string;
export declare function getEnumDefinition(schema: string, typeName?: string): string;
export declare function getSchemaColumns(schema: string): string;
export declare function getSchemaTables(schema: string): string;
export declare function getSchemaConstraints(schema: string): string;
export declare function functionName(def: string): string;
export interface LiveIndex {
    name: string;
    table: string;
    valid: boolean;
    def?: string;
    /** True when the index backs a constraint (primary key / unique), so it is not a standalone index. */
    constraintBacked?: boolean;
}
export interface LiveFunction {
    name: string;
    def?: string;
}
export interface LiveColumn {
    table: string;
    column: string;
    default?: string | null;
    type?: string;
    notNull?: boolean;
}
export interface ExpectedColumns {
    table: string;
    columns: string[];
    defaults?: Record<string, string>;
    types?: Record<string, {
        type: string;
        notNull: boolean;
    }>;
}
export interface LiveConstraint {
    table: string;
    def: string;
}
export interface ExpectedConstraints {
    table: string;
    constraints: string[];
}
export declare function computeColumnDrift(expected: ExpectedColumns[], live: LiveColumn[]): TableColumnDrift[];
export declare function computeConstraintDrift(expected: ExpectedConstraints[], live: LiveConstraint[]): ConstraintDrift[];
export declare function computeSchemaDrift(opts?: {
    indexes?: {
        expected: ManagedIndex[];
        live: LiveIndex[];
        building?: ReadonlySet<string>;
    };
    tables?: {
        expected: string[];
        live: string[];
    };
    functions?: {
        expected: ManagedFunction[];
        live: LiveFunction[];
    };
    columns?: {
        expected: ExpectedColumns[];
        live: LiveColumn[];
    };
    enum?: {
        name: string;
        expected: readonly string[];
        actual: string[];
    };
    constraints?: {
        expected: ExpectedConstraints[];
        live: LiveConstraint[];
    };
}): SchemaDriftReport;
//# sourceMappingURL=drifter.d.ts.map