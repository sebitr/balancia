import { Serwist } from "@serwist/window";
import { isCurrentPageOutOfScope } from "@serwist/window/internal";
//#region src/sw-entry.ts
if (typeof window !== "undefined" && "serviceWorker" in navigator && typeof caches !== "undefined") {
	const scope = self.__SERWIST_SW_ENTRY.scope;
	let swEntryWorker;
	if (self.__SERWIST_SW_ENTRY.swEntryWorker) swEntryWorker = new Worker(self.__SERWIST_SW_ENTRY.swEntryWorker);
	window.serwist = new Serwist(window.location.origin + self.__SERWIST_SW_ENTRY.sw, { scope });
	if (self.__SERWIST_SW_ENTRY.register && !isCurrentPageOutOfScope(scope)) window.serwist.register();
	if (self.__SERWIST_SW_ENTRY.cacheOnNavigation) {
		const cacheOnNavigation = async (url) => {
			if (!window.navigator.onLine || !url) return;
			swEntryWorker?.postMessage({
				type: "__FRONTEND_NAV_CACHE__",
				url
			});
		};
		const pushState = history.pushState;
		history.pushState = (...args) => {
			pushState.apply(history, args);
			cacheOnNavigation(args[2]);
		};
		const replaceState = history.replaceState;
		history.replaceState = (...args) => {
			replaceState.apply(history, args);
			cacheOnNavigation(args[2]);
		};
		window.addEventListener("online", () => {
			cacheOnNavigation(window.location.pathname);
		});
	}
	if (self.__SERWIST_SW_ENTRY.reloadOnOnline) window.addEventListener("online", () => location.reload());
}
//#endregion
export {};

//# sourceMappingURL=sw-entry.mjs.map