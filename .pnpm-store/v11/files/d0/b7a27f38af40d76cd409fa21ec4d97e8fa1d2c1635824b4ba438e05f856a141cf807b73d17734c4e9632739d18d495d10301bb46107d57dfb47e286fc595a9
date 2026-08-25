import { basePartial, fn, injectPartial, optionalSwDestPartial } from "@serwist/build/schema";
import { z } from "zod";
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region src/lib/schema.ts
var schema_exports = /* @__PURE__ */ __exportAll({
	injectManifestOptions: () => injectManifestOptions,
	injectPartial: () => injectPartial$1,
	webpackPartial: () => webpackPartial
});
const webpackConditionCallback = fn({
	input: [z.any()],
	output: z.boolean()
});
const webpackCondition = z.union([
	z.string(),
	z.instanceof(RegExp),
	webpackConditionCallback
]);
const webpackPartial = z.strictObject({
	chunks: z.array(z.string()).optional(),
	exclude: z.array(webpackCondition).default([/\.map$/, /^manifest.*\.js$/]),
	excludeChunks: z.array(z.string()).optional(),
	include: z.array(webpackCondition).optional()
});
const injectPartial$1 = z.strictObject({
	compileSrc: z.boolean().default(true),
	swDest: z.string().optional(),
	webpackCompilationPlugins: z.array(z.any()).optional()
});
const injectManifestOptions = z.strictObject({
	...basePartial.shape,
	...webpackPartial.shape,
	...injectPartial.shape,
	...optionalSwDestPartial.shape,
	...injectPartial$1.shape
});
//#endregion
export { webpackPartial as i, injectPartial$1 as n, schema_exports as r, injectManifestOptions as t };

//# sourceMappingURL=schema-Ika3DP7M.js.map