export function fromPrisma(tx) {
    return {
        async executeSql(text, values) {
            const rows = await tx.$queryRawUnsafe(text, ...(values ?? []));
            // v8 ignore next
            return { rows: Array.isArray(rows) ? rows : [] };
        }
    };
}
