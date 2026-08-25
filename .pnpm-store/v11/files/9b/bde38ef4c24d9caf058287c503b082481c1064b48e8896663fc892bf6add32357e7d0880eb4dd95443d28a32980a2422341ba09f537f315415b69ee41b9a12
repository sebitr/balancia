//#region src/sw-entry-worker.ts
self.onmessage = async (ev) => {
	switch (ev.data.type) {
		case "__START_URL_CACHE__": {
			const url = ev.data.url;
			const response = await fetch(url);
			if (!response.redirected) return (await caches.open("start-url")).put(url, response);
			return Promise.resolve();
		}
		case "__FRONTEND_NAV_CACHE__": {
			const url = ev.data.url;
			const pagesCache = await caches.open("pages");
			if (!!await pagesCache.match(url, { ignoreSearch: true })) return;
			const page = await fetch(url);
			if (!page.ok) return;
			pagesCache.put(url, page.clone());
			return Promise.resolve();
		}
		default: return Promise.resolve();
	}
};
//#endregion
export {};

//# sourceMappingURL=sw-entry-worker.mjs.map