export function fromKysely(trx) {
    return {
        async executeSql(text, values) {
            const result = await trx.executeQuery({
                sql: text,
                parameters: values ?? [],
                query: { kind: 'RawNode' },
                queryId: { queryId: 'pgboss' }
            });
            return { rows: [...result.rows] };
        }
    };
}
