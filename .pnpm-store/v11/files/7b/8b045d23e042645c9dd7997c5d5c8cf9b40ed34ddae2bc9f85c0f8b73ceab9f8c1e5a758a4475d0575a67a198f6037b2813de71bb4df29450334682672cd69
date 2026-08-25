"use client";
import { c } from "react/compiler-runtime";
import { Serwist } from "@serwist/window";
import { isCurrentPageOutOfScope } from "@serwist/window/internal";
import { createContext, useContext, useEffect, useState } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/lib/context.ts
const SerwistContext = createContext(null);
const useSerwist = () => {
	const context = useContext(SerwistContext);
	if (!context) throw new Error("[useSerwist]: 'SerwistContext' is not available.");
	return context;
};
//#endregion
//#region src/index.react.tsx
/**
* `@serwist/window` provider for Next.js apps.
* @param options
* @returns
*/
function SerwistProvider(t0) {
	const $ = c(19);
	const { swUrl, disable: t1, register: t2, cacheOnNavigation: t3, reloadOnOnline: t4, options, children } = t0;
	const disable = t1 === void 0 ? false : t1;
	const register = t2 === void 0 ? true : t2;
	const cacheOnNavigation = t3 === void 0 ? true : t3;
	const reloadOnOnline = t4 === void 0 ? true : t4;
	let t5;
	if ($[0] !== disable || $[1] !== options || $[2] !== register || $[3] !== swUrl) {
		t5 = () => {
			if (typeof window === "undefined") return null;
			if (disable) return null;
			const scope = options?.scope || "/";
			if (!(window.serwist && window.serwist instanceof Serwist) && "serviceWorker" in navigator) {
				window.serwist = new Serwist(swUrl, {
					...options,
					scope,
					type: options?.type || "module"
				});
				if (register && !isCurrentPageOutOfScope(scope)) window.serwist.register();
			}
			return window.serwist ?? null;
		};
		$[0] = disable;
		$[1] = options;
		$[2] = register;
		$[3] = swUrl;
		$[4] = t5;
	} else t5 = $[4];
	const [serwist] = useState(t5);
	let t6;
	if ($[5] !== cacheOnNavigation || $[6] !== serwist) {
		t6 = () => {
			const cacheUrls = async (url) => {
				if (!window.navigator.onLine || !url) return;
				serwist?.messageSW({
					type: "CACHE_URLS",
					payload: { urlsToCache: [url] }
				});
			};
			const cacheCurrentPathname = () => cacheUrls(window.location.pathname);
			const pushState = history.pushState;
			const replaceState = history.replaceState;
			if (cacheOnNavigation) {
				history.pushState = (...t7) => {
					const args = t7;
					pushState.apply(history, args);
					cacheUrls(args[2]);
				};
				history.replaceState = (...t8) => {
					const args_0 = t8;
					replaceState.apply(history, args_0);
					cacheUrls(args_0[2]);
				};
				window.addEventListener("online", cacheCurrentPathname);
			}
			return () => {
				history.pushState = pushState;
				history.replaceState = replaceState;
				window.removeEventListener("online", cacheCurrentPathname);
			};
		};
		$[5] = cacheOnNavigation;
		$[6] = serwist;
		$[7] = t6;
	} else t6 = $[7];
	const t7 = serwist?.messageSW;
	let t8;
	if ($[8] !== cacheOnNavigation || $[9] !== t7) {
		t8 = [t7, cacheOnNavigation];
		$[8] = cacheOnNavigation;
		$[9] = t7;
		$[10] = t8;
	} else t8 = $[10];
	useEffect(t6, t8);
	let t10;
	let t9;
	if ($[11] !== reloadOnOnline) {
		t9 = () => {
			const reload = _temp;
			if (reloadOnOnline) window.addEventListener("online", reload);
			return () => {
				window.removeEventListener("online", reload);
			};
		};
		t10 = [reloadOnOnline];
		$[11] = reloadOnOnline;
		$[12] = t10;
		$[13] = t9;
	} else {
		t10 = $[12];
		t9 = $[13];
	}
	useEffect(t9, t10);
	let t11;
	if ($[14] !== serwist) {
		t11 = { serwist };
		$[14] = serwist;
		$[15] = t11;
	} else t11 = $[15];
	let t12;
	if ($[16] !== children || $[17] !== t11) {
		t12 = /* @__PURE__ */ jsx(SerwistContext.Provider, {
			value: t11,
			children
		});
		$[16] = children;
		$[17] = t11;
		$[18] = t12;
	} else t12 = $[18];
	return t12;
}
function _temp() {
	return location.reload();
}
//#endregion
export { SerwistProvider, useSerwist };

//# sourceMappingURL=index.react.mjs.map