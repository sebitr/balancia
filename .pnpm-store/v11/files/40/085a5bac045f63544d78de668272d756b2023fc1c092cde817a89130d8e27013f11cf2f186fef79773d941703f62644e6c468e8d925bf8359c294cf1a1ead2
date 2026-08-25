/**
 * Parses a SQL string with PostgreSQL-style `$N` placeholders into the
 * literal segments between placeholders and the values in textual order.
 *
 * Handles repeated indexes (e.g. `$2` appearing twice) by duplicating the
 * value at each occurrence, so adapters that target positional `?`-style
 * binders or tagged-template SQL builders stay consistent with what
 * postgres would have produced from the original `$N` form.
 */
export declare function parsePlaceholders(text: string, values?: readonly unknown[]): {
    parts: string[];
    reordered: unknown[];
};
//# sourceMappingURL=placeholders.d.ts.map