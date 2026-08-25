//#region src/non-nullable.ts
const nonNullable = (value) => value !== null && value !== void 0;
//#endregion
//#region src/parallel.ts
/**
* Executes many async functions in parallel. Returns the
* results from all functions as an array. Does not handle
* any error.
*/
const parallel = async (limit, array, func) => {
	const work = array.map((item, index) => ({
		index,
		item
	}));
	const processor = async (res) => {
		const results = [];
		while (true) {
			const next = work.pop();
			if (!next) return res(results);
			const result = await func(next.item);
			results.push({
				result,
				index: next.index
			});
		}
	};
	const queues = Array.from({ length: limit }, () => new Promise(processor));
	return (await Promise.all(queues)).flat().sort((a, b) => a.index < b.index ? -1 : 1).map((res) => res.result);
};
//#endregion
//#region src/to-unix.ts
const toUnix = (p) => p.replace(/\\/g, "/").replace(/(?<!^)\/+/g, "/");
//#endregion
//#region src/compare.ts
const compare = (a, b) => {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
};
//#endregion
//#region src/constants.ts
/** @see https://esbuild.github.io/api/#target */
const SUPPORTED_ESBUILD_TARGETS = [
	"chrome",
	"deno",
	"edge",
	"firefox",
	"hermes",
	"ie",
	"ios",
	"node",
	"opera",
	"rhino",
	"safari"
];
const UNSUPPORTED_BROWSERLIST_TARGETS = [
	"android 4",
	"android 3",
	"android 2"
];
//#endregion
//#region src/semver.ts
const compareSemver = (a, b) => {
	return compare(Number.parseInt(a[0], 10), Number.parseInt(b[0], 10)) || compare(Number.parseInt(a[1] || "0", 10), Number.parseInt(b[1] || "0", 10)) || compare(Number.parseInt(a[2] || "0", 10), Number.parseInt(b[2] || "0", 10));
};
//#endregion
//#region src/browserslist.ts
/**
* Loads and converts Browserslist into esbuild's `target` option.
*
* @param cwd
* @returns
*/
const browserslistToEsbuild = (browserslist, cwd, defaultBrowserslist) => {
	return browserslist(browserslist.loadConfig({ path: cwd }) ?? defaultBrowserslist).filter((query) => !UNSUPPORTED_BROWSERLIST_TARGETS.some((target) => query.startsWith(target))).map((query) => {
		const split = (query === "safari TP" ? browserslist("last 1 safari version")[0] : query).split(" ");
		if (split[0] === "android" || split[0] === "and_chr") split[0] = "chrome";
		if (split[0] === "and_ff") split[0] = "firefox";
		if (split[0] === "ios_saf" || split[0] === "ios") split[0] = "safari";
		if (split[1].includes("-")) split[1] = split[1].slice(0, split[1].indexOf("-"));
		if (split[1].endsWith(".0")) split[1] = split[1].slice(0, -2);
		return split;
	}).filter((split) => SUPPORTED_ESBUILD_TARGETS.includes(split[0]) && /^\d+(\.\d+)*$/.test(split[1])).sort((a, b) => {
		if (a[0] === b[0]) return compareSemver(b[1].split("."), a[1].split("."));
		else return compare(a[0], b[0]);
	}).reduce((acc, browser) => {
		const existingIndex = acc.findIndex((br) => br[0] === browser[0]);
		if (existingIndex !== -1) acc[existingIndex][1] = browser[1];
		else acc.push(browser);
		return acc;
	}, []).map((split) => split.join(""));
};
//#endregion
export { SUPPORTED_ESBUILD_TARGETS, UNSUPPORTED_BROWSERLIST_TARGETS, browserslistToEsbuild, compare, compareSemver, nonNullable, parallel, toUnix };

//# sourceMappingURL=index.mjs.map