import * as plans from "./plans.js";
/**
 * Emits a warning event and optionally persists it to the database.
 * This is a shared utility to avoid duplicating warning persistence logic
 * across boss.ts and timekeeper.ts.
 */
export async function emitAndPersistWarning(ctx, type, message, data) {
    ctx.emitter.emit(ctx.warningEvent, { message, data });
    if (ctx.persistWarnings) {
        try {
            const sql = plans.insertWarning(ctx.schema);
            await ctx.db.executeSql(sql, [type, message, JSON.stringify(data)]);
        }
        catch (err) {
            ctx.emitter.emit(ctx.errorEvent, err);
        }
    }
}
