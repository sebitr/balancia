import Browserslist from "browserslist";
//#region src/non-nullable.d.ts
declare const nonNullable: <T>(value: T) => value is NonNullable<T>;
//#endregion
//#region src/parallel.d.ts
/**
 * Executes many async functions in parallel. Returns the
 * results from all functions as an array. Does not handle
 * any error.
 */
declare const parallel: <T, K>(limit: number, array: readonly T[], func: (item: T) => Promise<K>) => Promise<K[]>;
//#endregion
//#region src/to-unix.d.ts
declare const toUnix: (p: string) => string;
//#endregion
//#region src/browserslist.d.ts
/**
 * Loads and converts Browserslist into esbuild's `target` option.
 *
 * @param cwd
 * @returns
 */
declare const browserslistToEsbuild: (browserslist: typeof Browserslist, cwd: string, defaultBrowserslist: string[]) => string[];
//#endregion
//#region src/compare.d.ts
declare const compare: <T extends string | number>(a: T, b: T) => -1 | 0 | 1;
//#endregion
//#region src/constants.d.ts
/** @see https://esbuild.github.io/api/#target */
declare const SUPPORTED_ESBUILD_TARGETS: string[];
declare const UNSUPPORTED_BROWSERLIST_TARGETS: string[];
//#endregion
//#region src/semver.d.ts
declare const compareSemver: (a: string[], b: string[]) => -1 | 0 | 1;
//#endregion
//#region src/types.d.ts
/**
 * Make certain fields in a object type required
 *
 * @example
 *     interface A {
 *         a?: string;
 *         b?: string;
 *         c?: string;
 *     }
 *     type B = RequiredFields<A, "b" | "c">;
 *     const b: B = {
 *         b: "hehe",
 *         c: "hehe",
 *     }; //valid
 *     const b: B = { a: "hehe" }; //invalid
 *     const c: B = { a: "hehe", b: "hehe" }; //invalid
 */
type Require<T, U extends keyof T> = T & Required<Pick<T, U>>;
/**
 * Make certain fields in a object type optional
 *
 * @example
 *     interface A {
 *         a: string;
 *         b: string;
 *         c: string;
 *     }
 *     type B = Optional<A, "b" | "c">;
 *     const b: B = { a: "hehe" }; //valid
 *     const b: B = {}; //invalid
 */
type Optional<T, U extends keyof T> = Omit<T, U> & Partial<Pick<T, U>>;
/**
 * Makes an object type's hover overlay more readable
 *
 * @example
 *
 * interface A {
 *   b: string;
 *   c: boolean;
 * }
 *
 * interface B {
 *   c: number;
 * }
 *
 * type D = A | B; // Displayed as is written
 *
 * type C = Prettify<A | B>; // { b: string; c: boolean; } | { c: number; }
 */
type Prettify<T> = { [K in keyof T]: T[K]; } & {};
type MaybePromise<T> = T | Promise<T>;
//#endregion
export { type MaybePromise, type Optional, type Prettify, type Require, SUPPORTED_ESBUILD_TARGETS, UNSUPPORTED_BROWSERLIST_TARGETS, browserslistToEsbuild, compare, compareSemver, nonNullable, parallel, toUnix };
//# sourceMappingURL=index.d.mts.map