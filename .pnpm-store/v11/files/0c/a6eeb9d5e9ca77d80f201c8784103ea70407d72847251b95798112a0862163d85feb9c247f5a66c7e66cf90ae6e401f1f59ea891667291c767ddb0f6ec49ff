import { c as timeout } from "./waitUntil-BDu76Zx7.js";
//#region src/utils/resultingClientExists.ts
const MAX_RETRY_TIME = 2e3;
/**
* Returns a promise that resolves to a window client matching the passed
* `resultingClientId`. For browsers that don't support `resultingClientId`
* or if waiting for the resulting client to apper takes too long, resolve to
* `undefined`.
*
* @param resultingClientId
* @returns
* @private
*/
async function resultingClientExists(resultingClientId) {
	if (!resultingClientId) return;
	let existingWindows = await self.clients.matchAll({ type: "window" });
	const existingWindowIds = new Set(existingWindows.map((w) => w.id));
	let resultingWindow;
	const startTime = performance.now();
	while (performance.now() - startTime < MAX_RETRY_TIME) {
		existingWindows = await self.clients.matchAll({ type: "window" });
		resultingWindow = existingWindows.find((w) => {
			if (resultingClientId) return w.id === resultingClientId;
			return !existingWindowIds.has(w.id);
		});
		if (resultingWindow) break;
		await timeout(100);
	}
	return resultingWindow;
}
//#endregion
//#region src/utils/canConstructReadableStream.ts
let supportStatus;
/**
* A utility function that determines whether the current browser supports
* constructing a [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/ReadableStream)
* object.
*
* @returns `true`, if the current browser can successfully construct a `ReadableStream`, `false` otherwise.
*
* @private
*/
function canConstructReadableStream() {
	if (supportStatus === void 0) try {
		new ReadableStream({ start() {} });
		supportStatus = true;
	} catch {
		supportStatus = false;
	}
	return supportStatus;
}
//#endregion
//#region src/utils/dontWaitFor.ts
/**
* A helper function that prevents a promise from being flagged as unused.
*
* @private
*/
function dontWaitFor(promise) {
	promise.then(() => {});
}
//#endregion
export { canConstructReadableStream as n, resultingClientExists as r, dontWaitFor as t };

//# sourceMappingURL=index.internal-l2fDxYdE.js.map