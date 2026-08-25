import { requiredSwDestPartial } from "@serwist/build/schema";
import { z } from "zod";
import { injectManifestOptions } from "@serwist/webpack-plugin/schema";
//#region src/lib/schema.ts
const injectPartial = z.strictObject({
	cacheOnNavigation: z.boolean().default(false),
	disable: z.boolean().default(false),
	register: z.boolean().default(true),
	reloadOnOnline: z.boolean().default(true),
	scope: z.string().optional(),
	swUrl: z.string().default("/sw.js"),
	globPublicPatterns: z.array(z.string()).default(["**/*"])
});
const injectManifestOptions$1 = z.strictObject({
	...injectManifestOptions.shape,
	...requiredSwDestPartial.shape,
	...injectPartial.shape
}).omit({ disablePrecacheManifest: true });
//#endregion
export { injectPartial as n, injectManifestOptions$1 as t };

//# sourceMappingURL=schema-BHBmKqX3.js.map