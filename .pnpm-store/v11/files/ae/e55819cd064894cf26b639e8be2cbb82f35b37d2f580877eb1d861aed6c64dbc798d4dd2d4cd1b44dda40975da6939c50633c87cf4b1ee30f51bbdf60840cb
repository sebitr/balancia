import { parsePlaceholders } from "./placeholders.js";
import { unwrapSQLResult } from "../tools.js";
/**
 * Wraps a drizzle-orm transaction as an {@link IDatabase}.
 *
 * Accepts the `sql` tagged-template function from `drizzle-orm` as the
 * second argument so the adapter can construct parameterised queries
 * without a runtime dependency on `drizzle-orm`.
 *
 * @example
 * ```ts
 * import { sql } from 'drizzle-orm'
 * import { fromDrizzle } from 'pg-boss'
 *
 * await db.transaction(async (tx) => {
 *   await boss.send('my-queue', data, { db: fromDrizzle(tx, sql) })
 * })
 * ```
 */
export function fromDrizzle(tx, sql) {
    return {
        async executeSql(text, values) {
            const { parts, reordered } = parsePlaceholders(text, values);
            const strings = Object.assign([...parts], { raw: [...parts] });
            // Bind each value through sql.param so drizzle emits exactly one placeholder
            // per value. A bare array would otherwise be expanded into a parameter list
            // ($2, $3, ...) instead of a single array-typed parameter, breaking any query
            // with `= ANY($N::uuid[])` (deleteJob/complete/fail/cancel/resume/retry).
            const params = reordered.map(value => sql.param(value));
            return unwrapSQLResult(await tx.execute(sql(strings, ...params)));
        }
    };
}
