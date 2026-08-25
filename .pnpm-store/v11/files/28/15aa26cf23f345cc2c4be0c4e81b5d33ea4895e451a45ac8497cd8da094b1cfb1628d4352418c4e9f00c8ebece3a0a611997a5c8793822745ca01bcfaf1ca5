import { c as timeout, d as finalAssertExports, f as SerwistError, l as logger, m as cacheNames$1, n as clientsClaim, r as cleanupOutdatedCaches, s as quotaErrorCallbacks, t as waitUntil, u as getFriendlyURL } from "./chunks/waitUntil-BDu76Zx7.js";
import { C as BackgroundSyncQueue, D as copyResponse, E as disableDevLogs, S as BackgroundSyncPlugin, T as BackgroundSyncQueueStore, _ as NetworkFirst, a as createCacheKey, b as StrategyHandler, c as generateURLVariations, d as isNavigationPreloadSupported, f as NavigationRoute, g as NetworkOnly, h as normalizeHandler, i as PrecacheInstallReportPlugin, l as disableNavigationPreload, m as Route, n as printCleanupDetails, o as setCacheNameDetails, p as PrecacheStrategy, r as parseRoute, s as RegExpRoute, t as printInstallDetails, u as enableNavigationPreload, v as messages, w as StorableRequest, x as cacheOkAndOpaquePlugin, y as Strategy } from "./chunks/printInstallDetails-ESDOoMBE.js";
import { r as resultingClientExists } from "./chunks/index.internal-l2fDxYdE.js";
import { deleteDB, openDB } from "idb";
import { parallel } from "@serwist/utils";
//#region src/cacheNames.ts
/**
* Get the current cache names and prefix/suffix used by Serwist.
*
* `cacheNames.precache` is used for precached assets,
* `cacheNames.googleAnalytics` is used by `@serwist/google-analytics` to
* store `analytics.js`, and `cacheNames.runtime` is used for everything else.
*
* `cacheNames.prefix` can be used to retrieve just the current prefix value.
* `cacheNames.suffix` can be used to retrieve just the current suffix value.
*
* @returns An object with `precache`, `runtime`, `prefix`, and `googleAnalytics` properties.
*/
const cacheNames = {
	get googleAnalytics() {
		return cacheNames$1.getGoogleAnalyticsName();
	},
	get precache() {
		return cacheNames$1.getPrecacheName();
	},
	get prefix() {
		return cacheNames$1.getPrefix();
	},
	get runtime() {
		return cacheNames$1.getRuntimeName();
	},
	get suffix() {
		return cacheNames$1.getSuffix();
	}
};
//#endregion
//#region src/lib/broadcastUpdate/constants.ts
const BROADCAST_UPDATE_MESSAGE_TYPE = "CACHE_UPDATED";
const BROADCAST_UPDATE_MESSAGE_META = "serwist-broadcast-update";
const BROADCAST_UPDATE_DEFAULT_HEADERS = [
	"content-length",
	"etag",
	"last-modified"
];
//#endregion
//#region src/lib/broadcastUpdate/responsesAreSame.ts
/**
* Given two responses, compares several header values to see if they are
* the same or not.
*
* @param firstResponse The first response.
* @param secondResponse The second response.
* @param headersToCheck A list of headers to check.
* @returns
*/
const responsesAreSame = (firstResponse, secondResponse, headersToCheck) => {
	if (process.env.NODE_ENV !== "production") {
		if (!(firstResponse instanceof Response && secondResponse instanceof Response)) throw new SerwistError("invalid-responses-are-same-args");
	}
	if (!headersToCheck.some((header) => {
		return firstResponse.headers.has(header) && secondResponse.headers.has(header);
	})) {
		if (process.env.NODE_ENV !== "production") {
			logger.warn("Unable to determine where the response has been updated because none of the headers that would be checked are present.");
			logger.debug("Attempting to compare the following: ", firstResponse, secondResponse, headersToCheck);
		}
		return true;
	}
	return headersToCheck.every((header) => {
		const headerStateComparison = firstResponse.headers.has(header) === secondResponse.headers.has(header);
		const headerValueComparison = firstResponse.headers.get(header) === secondResponse.headers.get(header);
		return headerStateComparison && headerValueComparison;
	});
};
//#endregion
//#region src/lib/broadcastUpdate/BroadcastCacheUpdate.ts
const isSafari = typeof navigator !== "undefined" && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
/**
* Generates the default payload used in update messages. By default the
* payload includes the `cacheName` and `updatedURL` fields.
*
* @returns
* @private
*/
const defaultPayloadGenerator = (data) => {
	return {
		cacheName: data.cacheName,
		updatedURL: data.request.url
	};
};
/**
* A class that uses the `postMessage()` API to inform any open windows/tabs when
* a cached response has been updated.
*
* For efficiency's sake, the underlying response bodies are not compared;
* only specific response headers are checked.
*/
var BroadcastCacheUpdate = class {
	_headersToCheck;
	_generatePayload;
	_notifyAllClients;
	/**
	* Construct an instance of `BroadcastCacheUpdate`.
	*
	* @param options
	*/
	constructor({ generatePayload, headersToCheck, notifyAllClients } = {}) {
		this._headersToCheck = headersToCheck || BROADCAST_UPDATE_DEFAULT_HEADERS;
		this._generatePayload = generatePayload || defaultPayloadGenerator;
		this._notifyAllClients = notifyAllClients ?? true;
	}
	/**
	* Compares two responses and sends a message (via `postMessage()`) to all window clients if the
	* responses differ. Neither of the Responses can be opaque.
	*
	* The message that's posted has the following format (where `payload` can
	* be customized via the `generatePayload` option the instance is created
	* with):
	*
	* ```
	* {
	*   type: 'CACHE_UPDATED',
	*   meta: 'workbox-broadcast-update',
	*   payload: {
	*     cacheName: 'the-cache-name',
	*     updatedURL: 'https://example.com/'
	*   }
	* }
	* ```
	*
	* @param options
	* @returns Resolves once the update is sent.
	*/
	async notifyIfUpdated(options) {
		if (process.env.NODE_ENV !== "production") {
			finalAssertExports.isType(options.cacheName, "string", {
				moduleName: "serwist",
				className: "BroadcastCacheUpdate",
				funcName: "notifyIfUpdated",
				paramName: "cacheName"
			});
			finalAssertExports.isInstance(options.newResponse, Response, {
				moduleName: "serwist",
				className: "BroadcastCacheUpdate",
				funcName: "notifyIfUpdated",
				paramName: "newResponse"
			});
			finalAssertExports.isInstance(options.request, Request, {
				moduleName: "serwist",
				className: "BroadcastCacheUpdate",
				funcName: "notifyIfUpdated",
				paramName: "request"
			});
		}
		if (!options.oldResponse) return;
		if (!responsesAreSame(options.oldResponse, options.newResponse, this._headersToCheck)) {
			if (process.env.NODE_ENV !== "production") logger.log("Newer response found (and cached) for:", options.request.url);
			const messageData = {
				type: BROADCAST_UPDATE_MESSAGE_TYPE,
				meta: BROADCAST_UPDATE_MESSAGE_META,
				payload: this._generatePayload(options)
			};
			if (options.request.mode === "navigate") {
				let resultingClientId;
				if (options.event instanceof FetchEvent) resultingClientId = options.event.resultingClientId;
				if (!await resultingClientExists(resultingClientId) || isSafari) await timeout(3500);
			}
			if (this._notifyAllClients) {
				const windows = await self.clients.matchAll({ type: "window" });
				for (const win of windows) win.postMessage(messageData);
			} else if (options.event instanceof FetchEvent) (await self.clients.get(options.event.clientId))?.postMessage(messageData);
		}
	}
};
//#endregion
//#region src/lib/broadcastUpdate/BroadcastUpdatePlugin.ts
/**
* A class implementing the `cacheDidUpdate` lifecycle callback. It will automatically
* broadcast a message whenever a cached response is updated.
*/
var BroadcastUpdatePlugin = class {
	_broadcastUpdate;
	/**
	* Construct a {@linkcode BroadcastCacheUpdate} instance with
	* the passed options and calls its {@linkcode BroadcastCacheUpdate.notifyIfUpdated}
	* method whenever the plugin's {@linkcode BroadcastUpdatePlugin.cacheDidUpdate} callback
	* is invoked.
	*
	* @param options
	*/
	constructor(options) {
		this._broadcastUpdate = new BroadcastCacheUpdate(options);
	}
	/**
	* @private
	* @param options The input object to this function.
	*/
	cacheDidUpdate(options) {
		this._broadcastUpdate.notifyIfUpdated(options);
	}
};
//#endregion
//#region src/lib/cacheableResponse/CacheableResponse.ts
/**
* Allows you to set up rules determining what status codes and/or headers need
* to be present in order for a [response](https://developer.mozilla.org/en-US/docs/Web/API/Response)
* to be considered cacheable.
*/
var CacheableResponse = class {
	_statuses;
	_headers;
	/**
	* To construct a new `CacheableResponse` instance you must provide at least
	* one of the `config` properties.
	*
	* If both `statuses` and `headers` are specified, then both conditions must
	* be met for the response to be considered cacheable.
	*
	* @param config
	*/
	constructor(config = {}) {
		if (process.env.NODE_ENV !== "production") {
			if (!(config.statuses || config.headers)) throw new SerwistError("statuses-or-headers-required", {
				moduleName: "serwist",
				className: "CacheableResponse",
				funcName: "constructor"
			});
			if (config.statuses) finalAssertExports.isArray(config.statuses, {
				moduleName: "serwist",
				className: "CacheableResponse",
				funcName: "constructor",
				paramName: "config.statuses"
			});
			if (config.headers) finalAssertExports.isType(config.headers, "object", {
				moduleName: "serwist",
				className: "CacheableResponse",
				funcName: "constructor",
				paramName: "config.headers"
			});
		}
		this._statuses = config.statuses;
		if (config.headers) this._headers = new Headers(config.headers);
	}
	/**
	* Checks a response to see whether it's cacheable or not.
	*
	* @param response The response whose cacheability is being
	* checked.
	* @returns `true` if the response is cacheable, and `false`
	* otherwise.
	*/
	isResponseCacheable(response) {
		if (process.env.NODE_ENV !== "production") finalAssertExports.isInstance(response, Response, {
			moduleName: "serwist",
			className: "CacheableResponse",
			funcName: "isResponseCacheable",
			paramName: "response"
		});
		let cacheable = true;
		if (this._statuses) cacheable = this._statuses.includes(response.status);
		if (this._headers && cacheable) {
			for (const [headerName, headerValue] of this._headers.entries()) if (response.headers.get(headerName) !== headerValue) {
				cacheable = false;
				break;
			}
		}
		if (process.env.NODE_ENV !== "production") {
			if (!cacheable) {
				logger.groupCollapsed(`The request for '${getFriendlyURL(response.url)}' returned a response that does not meet the criteria for being cached.`);
				logger.groupCollapsed("View cacheability criteria here.");
				logger.log(`Cacheable statuses: ${JSON.stringify(this._statuses)}`);
				logger.log(`Cacheable headers: ${JSON.stringify(this._headers, null, 2)}`);
				logger.groupEnd();
				const logFriendlyHeaders = {};
				response.headers.forEach((value, key) => {
					logFriendlyHeaders[key] = value;
				});
				logger.groupCollapsed("View response status and headers here.");
				logger.log(`Response status: ${response.status}`);
				logger.log(`Response headers: ${JSON.stringify(logFriendlyHeaders, null, 2)}`);
				logger.groupEnd();
				logger.groupCollapsed("View full response details here.");
				logger.log(response.headers);
				logger.log(response);
				logger.groupEnd();
				logger.groupEnd();
			}
		}
		return cacheable;
	}
};
//#endregion
//#region src/lib/cacheableResponse/CacheableResponsePlugin.ts
/**
* A class implementing the `cacheWillUpdate` lifecycle callback. This makes it
* easier to add in cacheability checks to requests made via Serwist's built-in
* strategies.
*/
var CacheableResponsePlugin = class {
	_cacheableResponse;
	/**
	* To construct a new `CacheableResponsePlugin` instance you must provide at
	* least one of the `config` properties.
	*
	* If both `statuses` and `headers` are specified, then both conditions must
	* be met for the response to be considered cacheable.
	*
	* @param config
	*/
	constructor(config) {
		this._cacheableResponse = new CacheableResponse(config);
	}
	/**
	* @param options
	* @returns
	* @private
	*/
	cacheWillUpdate = async ({ response }) => {
		if (this._cacheableResponse.isResponseCacheable(response)) return response;
		return null;
	};
};
//#endregion
//#region src/lib/expiration/models/CacheTimestampsModel.ts
const DB_NAME = "serwist-expiration";
const CACHE_OBJECT_STORE = "cache-entries";
const normalizeURL = (unNormalizedUrl) => {
	const url = new URL(unNormalizedUrl, location.href);
	url.hash = "";
	return url.href;
};
/**
* Returns the timestamp model.
*
* @private
*/
var CacheTimestampsModel = class {
	_cacheName;
	_db = null;
	/**
	*
	* @param cacheName
	*
	* @private
	*/
	constructor(cacheName) {
		this._cacheName = cacheName;
	}
	/**
	* Takes a URL and returns an ID that will be unique in the object store.
	*
	* @param url
	* @returns
	* @private
	*/
	_getId(url) {
		return `${this._cacheName}|${normalizeURL(url)}`;
	}
	/**
	* Performs an upgrade of indexedDB.
	*
	* @param db
	*
	* @private
	*/
	_upgradeDb(db) {
		const objStore = db.createObjectStore(CACHE_OBJECT_STORE, { keyPath: "id" });
		objStore.createIndex("cacheName", "cacheName", { unique: false });
		objStore.createIndex("timestamp", "timestamp", { unique: false });
	}
	/**
	* Performs an upgrade of indexedDB and deletes deprecated DBs.
	*
	* @param db
	*
	* @private
	*/
	_upgradeDbAndDeleteOldDbs(db) {
		this._upgradeDb(db);
		if (this._cacheName) deleteDB(this._cacheName);
	}
	/**
	* @param url
	* @param timestamp
	*
	* @private
	*/
	async setTimestamp(url, timestamp) {
		url = normalizeURL(url);
		const entry = {
			id: this._getId(url),
			cacheName: this._cacheName,
			url,
			timestamp
		};
		const tx = (await this.getDb()).transaction(CACHE_OBJECT_STORE, "readwrite", { durability: "relaxed" });
		await tx.store.put(entry);
		await tx.done;
	}
	/**
	* Returns the timestamp stored for a given URL.
	*
	* @param url
	* @returns
	* @private
	*/
	async getTimestamp(url) {
		return (await (await this.getDb()).get(CACHE_OBJECT_STORE, this._getId(url)))?.timestamp;
	}
	/**
	* Iterates through all the entries in the object store (from newest to
	* oldest) and removes entries once either `maxCount` is reached or the
	* entry's timestamp is less than `minTimestamp`.
	*
	* @param minTimestamp
	* @param maxCount
	* @returns
	* @private
	*/
	async expireEntries(minTimestamp, maxCount) {
		let cursor = await (await this.getDb()).transaction(CACHE_OBJECT_STORE, "readwrite").store.index("timestamp").openCursor(null, "prev");
		const urlsDeleted = [];
		let entriesNotDeletedCount = 0;
		while (cursor) {
			const result = cursor.value;
			if (result.cacheName === this._cacheName) if (minTimestamp && result.timestamp < minTimestamp || maxCount && entriesNotDeletedCount >= maxCount) {
				cursor.delete();
				urlsDeleted.push(result.url);
			} else entriesNotDeletedCount++;
			cursor = await cursor.continue();
		}
		return urlsDeleted;
	}
	/**
	* Returns an open connection to the database.
	*
	* @private
	*/
	async getDb() {
		if (!this._db) this._db = await openDB(DB_NAME, 1, { upgrade: this._upgradeDbAndDeleteOldDbs.bind(this) });
		return this._db;
	}
};
//#endregion
//#region src/lib/expiration/CacheExpiration.ts
/**
* Allows you to expires cached responses based on age or maximum number of entries.
* @see https://serwist.pages.dev/docs/serwist/core/cache-expiration
*/
var CacheExpiration = class {
	_isRunning = false;
	_rerunRequested = false;
	_maxEntries;
	_maxAgeSeconds;
	_matchOptions;
	_cacheName;
	_timestampModel;
	/**
	* To construct a new `CacheExpiration` instance you must provide at least
	* one of the `config` properties.
	*
	* @param cacheName Name of the cache to apply restrictions to.
	* @param config
	*/
	constructor(cacheName, config = {}) {
		if (process.env.NODE_ENV !== "production") {
			finalAssertExports.isType(cacheName, "string", {
				moduleName: "serwist",
				className: "CacheExpiration",
				funcName: "constructor",
				paramName: "cacheName"
			});
			if (!(config.maxEntries || config.maxAgeSeconds)) throw new SerwistError("max-entries-or-age-required", {
				moduleName: "serwist",
				className: "CacheExpiration",
				funcName: "constructor"
			});
			if (config.maxEntries) finalAssertExports.isType(config.maxEntries, "number", {
				moduleName: "serwist",
				className: "CacheExpiration",
				funcName: "constructor",
				paramName: "config.maxEntries"
			});
			if (config.maxAgeSeconds) finalAssertExports.isType(config.maxAgeSeconds, "number", {
				moduleName: "serwist",
				className: "CacheExpiration",
				funcName: "constructor",
				paramName: "config.maxAgeSeconds"
			});
		}
		this._maxEntries = config.maxEntries;
		this._maxAgeSeconds = config.maxAgeSeconds;
		this._matchOptions = config.matchOptions;
		this._cacheName = cacheName;
		this._timestampModel = new CacheTimestampsModel(cacheName);
	}
	/**
	* Expires entries for the given cache and given criteria.
	*/
	async expireEntries() {
		if (this._isRunning) {
			this._rerunRequested = true;
			return;
		}
		this._isRunning = true;
		const minTimestamp = this._maxAgeSeconds ? Date.now() - this._maxAgeSeconds * 1e3 : 0;
		const urlsExpired = await this._timestampModel.expireEntries(minTimestamp, this._maxEntries);
		const cache = await self.caches.open(this._cacheName);
		for (const url of urlsExpired) await cache.delete(url, this._matchOptions);
		if (process.env.NODE_ENV !== "production") if (urlsExpired.length > 0) {
			logger.groupCollapsed(`Expired ${urlsExpired.length} ${urlsExpired.length === 1 ? "entry" : "entries"} and removed ${urlsExpired.length === 1 ? "it" : "them"} from the '${this._cacheName}' cache.`);
			logger.log(`Expired the following ${urlsExpired.length === 1 ? "URL" : "URLs"}:`);
			for (const url of urlsExpired) logger.log(`    ${url}`);
			logger.groupEnd();
		} else logger.debug("Cache expiration ran and found no entries to remove.");
		this._isRunning = false;
		if (this._rerunRequested) {
			this._rerunRequested = false;
			this.expireEntries();
		}
	}
	/**
	* Updates the timestamp for the given URL, allowing it to be correctly
	* tracked by the class.
	*
	* @param url
	*/
	async updateTimestamp(url) {
		if (process.env.NODE_ENV !== "production") finalAssertExports.isType(url, "string", {
			moduleName: "serwist",
			className: "CacheExpiration",
			funcName: "updateTimestamp",
			paramName: "url"
		});
		await this._timestampModel.setTimestamp(url, Date.now());
	}
	/**
	* Checks if a URL has expired or not before it's used.
	*
	* This looks the timestamp up in IndexedDB and can be slow.
	*
	* Note: This method does not remove an expired entry, call
	* `expireEntries()` to remove such entries instead.
	*
	* @param url
	* @returns
	*/
	async isURLExpired(url) {
		if (!this._maxAgeSeconds) {
			if (process.env.NODE_ENV !== "production") throw new SerwistError("expired-test-without-max-age", {
				methodName: "isURLExpired",
				paramName: "maxAgeSeconds"
			});
			return false;
		}
		const timestamp = await this._timestampModel.getTimestamp(url);
		const expireOlderThan = Date.now() - this._maxAgeSeconds * 1e3;
		return timestamp !== void 0 ? timestamp < expireOlderThan : true;
	}
	/**
	* Removes the IndexedDB used to keep track of cache expiration metadata.
	*/
	async delete() {
		this._rerunRequested = false;
		await this._timestampModel.expireEntries(Number.POSITIVE_INFINITY);
	}
};
//#endregion
//#region src/registerQuotaErrorCallback.ts
/**
* Adds a function to the set of quotaErrorCallbacks that will be executed if
* there's a quota error.
*
* @param callback
*/
const registerQuotaErrorCallback = (callback) => {
	if (process.env.NODE_ENV !== "production") finalAssertExports.isType(callback, "function", {
		moduleName: "@serwist/core",
		funcName: "register",
		paramName: "callback"
	});
	quotaErrorCallbacks.add(callback);
	if (process.env.NODE_ENV !== "production") logger.log("Registered a callback to respond to quota errors.", callback);
};
//#endregion
//#region src/lib/expiration/ExpirationPlugin.ts
/**
* This plugin can be used in a {@linkcode Strategy} to regularly enforce a
* limit on the age and/or the number of cached requests.
*
* It can only be used with {@linkcode Strategy} instances that have a custom `cacheName` property set.
* In other words, it can't be used to expire entries in strategies that use the default runtime
* cache name.
*
* Whenever a cached response is used or updated, this plugin will look
* at the associated cache and remove any old or extra responses.
*
* When using `maxAgeSeconds`, responses may be used *once* after expiring
* because the expiration clean up will not have occurred until *after* the
* cached response has been used. If the response has a "Date" header, then a lightweight expiration
* check is performed, and the response will not be used immediately.
*
* When using `maxEntries`, the least recently requested entry will be removed
* from the cache.
*
* @see https://serwist.pages.dev/docs/serwist/runtime-caching/plugins/expiration-plugin
*/
var ExpirationPlugin = class {
	_config;
	_cacheExpirations;
	/**
	* @param config
	*/
	constructor(config = {}) {
		if (process.env.NODE_ENV !== "production") {
			if (!(config.maxEntries || config.maxAgeSeconds)) throw new SerwistError("max-entries-or-age-required", {
				moduleName: "serwist",
				className: "ExpirationPlugin",
				funcName: "constructor"
			});
			if (config.maxEntries) finalAssertExports.isType(config.maxEntries, "number", {
				moduleName: "serwist",
				className: "ExpirationPlugin",
				funcName: "constructor",
				paramName: "config.maxEntries"
			});
			if (config.maxAgeSeconds) finalAssertExports.isType(config.maxAgeSeconds, "number", {
				moduleName: "serwist",
				className: "ExpirationPlugin",
				funcName: "constructor",
				paramName: "config.maxAgeSeconds"
			});
			if (config.maxAgeFrom) finalAssertExports.isType(config.maxAgeFrom, "string", {
				moduleName: "serwist",
				className: "ExpirationPlugin",
				funcName: "constructor",
				paramName: "config.maxAgeFrom"
			});
		}
		this._config = config;
		this._cacheExpirations = /* @__PURE__ */ new Map();
		if (!this._config.maxAgeFrom) this._config.maxAgeFrom = "last-fetched";
		if (this._config.purgeOnQuotaError) registerQuotaErrorCallback(() => this.deleteCacheAndMetadata());
	}
	/**
	* A simple helper method to return a CacheExpiration instance for a given
	* cache name.
	*
	* @param cacheName
	* @returns
	* @private
	*/
	_getCacheExpiration(cacheName) {
		if (cacheName === cacheNames$1.getRuntimeName()) throw new SerwistError("expire-custom-caches-only");
		let cacheExpiration = this._cacheExpirations.get(cacheName);
		if (!cacheExpiration) {
			cacheExpiration = new CacheExpiration(cacheName, this._config);
			this._cacheExpirations.set(cacheName, cacheExpiration);
		}
		return cacheExpiration;
	}
	/**
	* A lifecycle callback that will be triggered automatically when a
	* response is about to be returned from a [`Cache`](https://developer.mozilla.org/en-US/docs/Web/API/Cache).
	* It allows the response to be inspected for freshness and
	* prevents it from being used if the response's `Date` header value is
	* older than the configured `maxAgeSeconds`.
	*
	* @param options
	* @returns `cachedResponse` if it is fresh and `null` if it is stale or
	* not available.
	* @private
	*/
	cachedResponseWillBeUsed({ event, cacheName, request, cachedResponse }) {
		if (!cachedResponse) return null;
		const isFresh = this._isResponseDateFresh(cachedResponse);
		const cacheExpiration = this._getCacheExpiration(cacheName);
		const isMaxAgeFromLastUsed = this._config.maxAgeFrom === "last-used";
		const done = (async () => {
			if (isMaxAgeFromLastUsed) await cacheExpiration.updateTimestamp(request.url);
			await cacheExpiration.expireEntries();
		})();
		try {
			event.waitUntil(done);
		} catch {
			if (process.env.NODE_ENV !== "production") {
				if (event instanceof FetchEvent) logger.warn(`Unable to ensure service worker stays alive when updating cache entry for '${getFriendlyURL(event.request.url)}'.`);
			}
		}
		return isFresh ? cachedResponse : null;
	}
	/**
	* @param cachedResponse
	* @returns
	* @private
	*/
	_isResponseDateFresh(cachedResponse) {
		if (this._config.maxAgeFrom === "last-used") return true;
		const now = Date.now();
		if (!this._config.maxAgeSeconds) return true;
		const dateHeaderTimestamp = this._getDateHeaderTimestamp(cachedResponse);
		if (dateHeaderTimestamp === null) return true;
		return dateHeaderTimestamp >= now - this._config.maxAgeSeconds * 1e3;
	}
	/**
	* Extracts the `Date` header and parse it into an useful value.
	*
	* @param cachedResponse
	* @returns
	* @private
	*/
	_getDateHeaderTimestamp(cachedResponse) {
		if (!cachedResponse.headers.has("date")) return null;
		const dateHeader = cachedResponse.headers.get("date");
		const headerTime = new Date(dateHeader).getTime();
		if (Number.isNaN(headerTime)) return null;
		return headerTime;
	}
	/**
	* A lifecycle callback that will be triggered automatically when an entry is added
	* to a cache.
	*
	* @param options
	* @private
	*/
	async cacheDidUpdate({ cacheName, request }) {
		if (process.env.NODE_ENV !== "production") {
			finalAssertExports.isType(cacheName, "string", {
				moduleName: "serwist",
				className: "Plugin",
				funcName: "cacheDidUpdate",
				paramName: "cacheName"
			});
			finalAssertExports.isInstance(request, Request, {
				moduleName: "serwist",
				className: "Plugin",
				funcName: "cacheDidUpdate",
				paramName: "request"
			});
		}
		const cacheExpiration = this._getCacheExpiration(cacheName);
		await cacheExpiration.updateTimestamp(request.url);
		await cacheExpiration.expireEntries();
	}
	/**
	* Deletes the underlying `Cache` instance associated with this instance and the metadata
	* from IndexedDB used to keep track of expiration details for each `Cache` instance.
	*
	* When using cache expiration, calling this method is preferable to calling
	* `caches.delete()` directly, since this will ensure that the IndexedDB
	* metadata is also cleanly removed and that open IndexedDB instances are deleted.
	*
	* Note that if you're *not* using cache expiration for a given cache, calling
	* `caches.delete()` and passing in the cache's name should be sufficient.
	* There is no Serwist-specific method needed for cleanup in that case.
	*/
	async deleteCacheAndMetadata() {
		for (const [cacheName, cacheExpiration] of this._cacheExpirations) {
			await self.caches.delete(cacheName);
			await cacheExpiration.delete();
		}
		this._cacheExpirations = /* @__PURE__ */ new Map();
	}
};
//#endregion
//#region src/lib/googleAnalytics/constants.ts
const QUEUE_NAME = "serwist-google-analytics";
const MAX_RETENTION_TIME = 2880;
const COLLECT_PATHS_REGEX = /^\/(\w+\/)?collect/;
//#endregion
//#region src/lib/googleAnalytics/initializeGoogleAnalytics.ts
/**
* Creates the requestWillDequeue callback to be used with the background
* sync plugin. The callback takes the failed request and adds the
* `qt` param based on the current time, as well as applies any other
* user-defined hit modifications.
*
* @param config
* @returns The requestWillDequeue callback function.
* @private
*/
const createOnSyncCallback = (config) => {
	return async ({ queue }) => {
		let entry;
		while (entry = await queue.shiftRequest()) {
			const { request, timestamp } = entry;
			const url = new URL(request.url);
			try {
				const params = request.method === "POST" ? new URLSearchParams(await request.clone().text()) : url.searchParams;
				const originalHitTime = timestamp - (Number(params.get("qt")) || 0);
				const queueTime = Date.now() - originalHitTime;
				params.set("qt", String(queueTime));
				if (config.parameterOverrides) for (const param of Object.keys(config.parameterOverrides)) {
					const value = config.parameterOverrides[param];
					params.set(param, value);
				}
				if (typeof config.hitFilter === "function") config.hitFilter.call(null, params);
				await fetch(new Request(url.origin + url.pathname, {
					body: params.toString(),
					method: "POST",
					mode: "cors",
					credentials: "omit",
					headers: { "Content-Type": "text/plain" }
				}));
				if (process.env.NODE_ENV !== "production") logger.log(`Request for '${getFriendlyURL(url.href)}' has been replayed`);
			} catch (err) {
				await queue.unshiftRequest(entry);
				if (process.env.NODE_ENV !== "production") logger.log(`Request for '${getFriendlyURL(url.href)}' failed to replay, putting it back in the queue.`);
				throw err;
			}
		}
		if (process.env.NODE_ENV !== "production") logger.log("All Google Analytics request successfully replayed; the queue is now empty!");
	};
};
/**
* Creates GET and POST routes to catch failed Measurement Protocol hits.
*
* @param bgSyncPlugin
* @returns The created routes.
* @private
*/
const createCollectRoutes = (bgSyncPlugin) => {
	const match = ({ url }) => url.hostname === "www.google-analytics.com" && COLLECT_PATHS_REGEX.test(url.pathname);
	const handler = new NetworkOnly({ plugins: [bgSyncPlugin] });
	return [new Route(match, handler, "GET"), new Route(match, handler, "POST")];
};
/**
* Creates a route with a network first strategy for the analytics.js script.
*
* @param cacheName
* @returns The created route.
* @private
*/
const createAnalyticsJsRoute = (cacheName) => {
	const match = ({ url }) => url.hostname === "www.google-analytics.com" && url.pathname === "/analytics.js";
	return new Route(match, new NetworkFirst({ cacheName }), "GET");
};
/**
* Creates a route with a network first strategy for the gtag.js script.
*
* @param cacheName
* @returns The created route.
* @private
*/
const createGtagJsRoute = (cacheName) => {
	const match = ({ url }) => url.hostname === "www.googletagmanager.com" && url.pathname === "/gtag/js";
	return new Route(match, new NetworkFirst({ cacheName }), "GET");
};
/**
* Creates a route with a network first strategy for the gtm.js script.
*
* @param cacheName
* @returns The created route.
* @private
*/
const createGtmJsRoute = (cacheName) => {
	const match = ({ url }) => url.hostname === "www.googletagmanager.com" && url.pathname === "/gtm.js";
	return new Route(match, new NetworkFirst({ cacheName }), "GET");
};
/**
* Initialize Serwist's offline Google Analytics v3 support.
*
* @param options
*/
const initializeGoogleAnalytics = ({ serwist, cacheName, ...options }) => {
	const resolvedCacheName = cacheNames$1.getGoogleAnalyticsName(cacheName);
	const bgSyncPlugin = new BackgroundSyncPlugin(QUEUE_NAME, {
		maxRetentionTime: MAX_RETENTION_TIME,
		onSync: createOnSyncCallback(options)
	});
	const routes = [
		createGtmJsRoute(resolvedCacheName),
		createAnalyticsJsRoute(resolvedCacheName),
		createGtagJsRoute(resolvedCacheName),
		...createCollectRoutes(bgSyncPlugin)
	];
	for (const route of routes) serwist.registerRoute(route);
};
//#endregion
//#region src/lib/precaching/PrecacheFallbackPlugin.ts
/**
* Allows you to specify offline fallbacks to be used when a given strategy
* is unable to generate a response.
*
* It does this by intercepting the `handlerDidError` plugin callback
* and returning a precached response, taking the expected revision parameter
* into account automatically.
*/
var PrecacheFallbackPlugin = class {
	_fallbackUrls;
	_serwist;
	/**
	* Constructs a new instance with the associated `fallbackUrls`.
	*
	* @param config
	*/
	constructor({ fallbackUrls, serwist }) {
		this._fallbackUrls = fallbackUrls;
		this._serwist = serwist;
	}
	/**
	* @returns The precache response for one of the fallback URLs, or `undefined` if
	* nothing satisfies the conditions.
	* @private
	*/
	async handlerDidError(param) {
		for (const fallback of this._fallbackUrls) if (typeof fallback === "string") {
			const fallbackResponse = await this._serwist.matchPrecache(fallback);
			if (fallbackResponse !== void 0) return fallbackResponse;
		} else if (fallback.matcher(param)) {
			const fallbackResponse = await this._serwist.matchPrecache(fallback.url);
			if (fallbackResponse !== void 0) return fallbackResponse;
		}
	}
};
//#endregion
//#region src/lib/rangeRequests/utils/calculateEffectiveBoundaries.ts
/**
* @param blob A source blob.
* @param start The offset to use as the start of the
* slice.
* @param end The offset to use as the end of the slice.
* @returns An object with `start` and `end` properties, reflecting
* the effective boundaries to use given the size of the blob.
* @private
*/
const calculateEffectiveBoundaries = (blob, start, end) => {
	if (process.env.NODE_ENV !== "production") finalAssertExports.isInstance(blob, Blob, {
		moduleName: "@serwist/range-requests",
		funcName: "calculateEffectiveBoundaries",
		paramName: "blob"
	});
	const blobSize = blob.size;
	if (end && end > blobSize || start && start < 0) throw new SerwistError("range-not-satisfiable", {
		size: blobSize,
		end,
		start
	});
	let effectiveStart;
	let effectiveEnd;
	if (start !== void 0 && end !== void 0) {
		effectiveStart = start;
		effectiveEnd = end + 1;
	} else if (start !== void 0 && end === void 0) {
		effectiveStart = start;
		effectiveEnd = blobSize;
	} else if (end !== void 0 && start === void 0) {
		effectiveStart = blobSize - end;
		effectiveEnd = blobSize;
	}
	return {
		start: effectiveStart,
		end: effectiveEnd
	};
};
//#endregion
//#region src/lib/rangeRequests/utils/parseRangeHeader.ts
/**
* @param rangeHeader A `Range` header value.
* @returns An object with `start` and `end` properties, reflecting
* the parsed value of the `Range` header. If either the `start` or `end` are
* omitted, then `null` will be returned.
* @private
*/
const parseRangeHeader = (rangeHeader) => {
	if (process.env.NODE_ENV !== "production") finalAssertExports.isType(rangeHeader, "string", {
		moduleName: "@serwist/range-requests",
		funcName: "parseRangeHeader",
		paramName: "rangeHeader"
	});
	const normalizedRangeHeader = rangeHeader.trim().toLowerCase();
	if (!normalizedRangeHeader.startsWith("bytes=")) throw new SerwistError("unit-must-be-bytes", { normalizedRangeHeader });
	if (normalizedRangeHeader.includes(",")) throw new SerwistError("single-range-only", { normalizedRangeHeader });
	const rangeParts = /(\d*)-(\d*)/.exec(normalizedRangeHeader);
	if (!rangeParts || !(rangeParts[1] || rangeParts[2])) throw new SerwistError("invalid-range-values", { normalizedRangeHeader });
	return {
		start: rangeParts[1] === "" ? void 0 : Number(rangeParts[1]),
		end: rangeParts[2] === "" ? void 0 : Number(rangeParts[2])
	};
};
//#endregion
//#region src/lib/rangeRequests/createPartialResponse.ts
/**
* Given a request and a response, this will return a
* promise that resolves to a partial response.
*
* If the original response already contains partial content (i.e. it has
* a status of 206), then this assumes it already fulfills the `Range`
* requirements, and will return it as-is.
*
* @param request A request, which should contain a `Range`
* header.
* @param originalResponse A response.
* @returns Either a `206 Partial Content` response, with
* the response body set to the slice of content specified by the request's
* `Range` header, or a `416 Range Not Satisfiable` response if the
* conditions of the `Range` header can't be met.
*/
const createPartialResponse = async (request, originalResponse) => {
	try {
		if (process.env.NODE_ENV !== "production") {
			finalAssertExports.isInstance(request, Request, {
				moduleName: "@serwist/range-requests",
				funcName: "createPartialResponse",
				paramName: "request"
			});
			finalAssertExports.isInstance(originalResponse, Response, {
				moduleName: "@serwist/range-requests",
				funcName: "createPartialResponse",
				paramName: "originalResponse"
			});
		}
		if (originalResponse.status === 206) return originalResponse;
		const rangeHeader = request.headers.get("range");
		if (!rangeHeader) throw new SerwistError("no-range-header");
		const boundaries = parseRangeHeader(rangeHeader);
		const originalBlob = await originalResponse.blob();
		const effectiveBoundaries = calculateEffectiveBoundaries(originalBlob, boundaries.start, boundaries.end);
		const slicedBlob = originalBlob.slice(effectiveBoundaries.start, effectiveBoundaries.end);
		const slicedBlobSize = slicedBlob.size;
		const slicedResponse = new Response(slicedBlob, {
			status: 206,
			statusText: "Partial Content",
			headers: originalResponse.headers
		});
		slicedResponse.headers.set("Content-Length", String(slicedBlobSize));
		slicedResponse.headers.set("Content-Range", `bytes ${effectiveBoundaries.start}-${effectiveBoundaries.end - 1}/${originalBlob.size}`);
		return slicedResponse;
	} catch (error) {
		if (process.env.NODE_ENV !== "production") {
			logger.warn("Unable to construct a partial response; returning a 416 Range Not Satisfiable response instead.");
			logger.groupCollapsed("View details here.");
			logger.log(error);
			logger.log(request);
			logger.log(originalResponse);
			logger.groupEnd();
		}
		return new Response("", {
			status: 416,
			statusText: "Range Not Satisfiable"
		});
	}
};
//#endregion
//#region src/lib/rangeRequests/RangeRequestsPlugin.ts
/**
* Makes it easy for a request with a `Range` header to be fulfilled by a cached response.
*
* It does this by intercepting the `cachedResponseWillBeUsed` plugin callback
* and returning the appropriate subset of the cached response body.
*/
var RangeRequestsPlugin = class {
	/**
	* @param options
	* @returns If request contains a `Range` header, then a
	* partial response whose body is a subset of `cachedResponse` is
	* returned. Otherwise, `cachedResponse` is returned as-is.
	* @private
	*/
	cachedResponseWillBeUsed = async ({ request, cachedResponse }) => {
		if (cachedResponse && request.headers.has("range")) return await createPartialResponse(request, cachedResponse);
		return cachedResponse;
	};
};
//#endregion
//#region src/lib/strategies/CacheFirst.ts
/**
* An implementation of the [cache first](https://developer.chrome.com/docs/workbox/caching-strategies-overview/#cache_first_falling_back_to_network)
* request strategy.
*
* A cache first strategy is useful for assets that have been revisioned,
* such as URLs like "/styles/example.a8f5f1.css", since they
* can be cached for long periods of time.
*
* If the network request fails, and there is no cache match, this will throw
* a {@linkcode SerwistError} exception.
*/
var CacheFirst = class extends Strategy {
	/**
	* @private
	* @param request A request to run this strategy for.
	* @param handler The event that triggered the request.
	* @returns
	*/
	async _handle(request, handler) {
		const logs = [];
		if (process.env.NODE_ENV !== "production") finalAssertExports.isInstance(request, Request, {
			moduleName: "serwist",
			className: this.constructor.name,
			funcName: "makeRequest",
			paramName: "request"
		});
		let response = await handler.cacheMatch(request);
		let error;
		if (!response) {
			if (process.env.NODE_ENV !== "production") logs.push(`No response found in the '${this.cacheName}' cache. Will respond with a network request.`);
			try {
				response = await handler.fetchAndCachePut(request);
			} catch (err) {
				if (err instanceof Error) error = err;
			}
			if (process.env.NODE_ENV !== "production") if (response) logs.push("Got response from network.");
			else logs.push("Unable to get a response from the network.");
		} else if (process.env.NODE_ENV !== "production") logs.push(`Found a cached response in the '${this.cacheName}' cache.`);
		if (process.env.NODE_ENV !== "production") {
			logger.groupCollapsed(messages.strategyStart(this.constructor.name, request));
			for (const log of logs) logger.log(log);
			messages.printFinalResponse(response);
			logger.groupEnd();
		}
		if (!response) throw new SerwistError("no-response", {
			url: request.url,
			error
		});
		return response;
	}
};
//#endregion
//#region src/lib/strategies/CacheOnly.ts
/**
* An implementation of the [cache only](https://developer.chrome.com/docs/workbox/caching-strategies-overview/#cache_only)
* request strategy.
*
* This class is useful if you already have your own precaching step.
*
* If there is no cache match, this will throw a {@linkcode SerwistError} exception.
*/
var CacheOnly = class extends Strategy {
	/**
	* @private
	* @param request A request to run this strategy for.
	* @param handler The event that triggered the request.
	* @returns
	*/
	async _handle(request, handler) {
		if (process.env.NODE_ENV !== "production") finalAssertExports.isInstance(request, Request, {
			moduleName: "serwist",
			className: this.constructor.name,
			funcName: "makeRequest",
			paramName: "request"
		});
		const response = await handler.cacheMatch(request);
		if (process.env.NODE_ENV !== "production") {
			logger.groupCollapsed(messages.strategyStart(this.constructor.name, request));
			if (response) {
				logger.log(`Found a cached response in the '${this.cacheName}' cache.`);
				messages.printFinalResponse(response);
			} else logger.log(`No response found in the '${this.cacheName}' cache.`);
			logger.groupEnd();
		}
		if (!response) throw new SerwistError("no-response", { url: request.url });
		return response;
	}
};
//#endregion
//#region src/lib/strategies/StaleWhileRevalidate.ts
/**
* An implementation of the
* [stale-while-revalidate](https://developer.chrome.com/docs/workbox/caching-strategies-overview/#stale_while_revalidate)
* request strategy.
*
* Resources are requested from both the cache and the network in parallel.
* The strategy will respond with the cached version if available, otherwise
* wait for the network response. The cache is updated with the network response
* with each successful request.
*
* By default, this strategy will cache responses with a 200 status code as
* well as [opaque responses](https://developer.chrome.com/docs/workbox/caching-resources-during-runtime/#opaque-responses).
* Opaque responses are cross-origin requests where the response doesn't
* support [CORS](https://enable-cors.org/).
*
* If the network request fails, and there is no cache match, this will throw
* a {@linkcode SerwistError} exception.
*/
var StaleWhileRevalidate = class extends Strategy {
	/**
	* @param options
	*/
	constructor(options = {}) {
		super(options);
		if (!this.plugins.some((p) => "cacheWillUpdate" in p)) this.plugins.unshift(cacheOkAndOpaquePlugin);
	}
	/**
	* @private
	* @param request A request to run this strategy for.
	* @param handler The event that triggered the request.
	* @returns
	*/
	async _handle(request, handler) {
		const logs = [];
		if (process.env.NODE_ENV !== "production") finalAssertExports.isInstance(request, Request, {
			moduleName: "serwist",
			className: this.constructor.name,
			funcName: "handle",
			paramName: "request"
		});
		const fetchAndCachePromise = handler.fetchAndCachePut(request).catch(() => {});
		handler.waitUntil(fetchAndCachePromise);
		let response = await handler.cacheMatch(request);
		let error;
		if (response) {
			if (process.env.NODE_ENV !== "production") logs.push(`Found a cached response in the '${this.cacheName}' cache. Will update with the network response in the background.`);
		} else {
			if (process.env.NODE_ENV !== "production") logs.push(`No response found in the '${this.cacheName}' cache. Will wait for the network response.`);
			try {
				response = await fetchAndCachePromise;
			} catch (err) {
				if (err instanceof Error) error = err;
			}
		}
		if (process.env.NODE_ENV !== "production") {
			logger.groupCollapsed(messages.strategyStart(this.constructor.name, request));
			for (const log of logs) logger.log(log);
			messages.printFinalResponse(response);
			logger.groupEnd();
		}
		if (!response) throw new SerwistError("no-response", {
			url: request.url,
			error
		});
		return response;
	}
};
//#endregion
//#region src/PrecacheRoute.ts
/**
* A subclass of {@linkcode Route} that takes a {@linkcode Serwist} instance and uses it to match
* incoming requests and handle fetching responses from the precache.
*/
var PrecacheRoute = class extends Route {
	/**
	* @param serwist A {@linkcode Serwist} instance.
	* @param options Options to control how requests are matched
	* against the list of precached URLs.
	*/
	constructor(serwist, options) {
		const match = ({ request }) => {
			const urlsToCacheKeys = serwist.getUrlsToPrecacheKeys();
			for (const possibleURL of generateURLVariations(request.url, options)) {
				const cacheKey = urlsToCacheKeys.get(possibleURL);
				if (cacheKey) return {
					cacheKey,
					integrity: serwist.getIntegrityForPrecacheKey(cacheKey)
				};
			}
			if (process.env.NODE_ENV !== "production") logger.debug(`Precaching did not find a match for ${getFriendlyURL(request.url)}.`);
		};
		super(match, serwist.precacheStrategy);
	}
};
//#endregion
//#region src/utils/PrecacheCacheKeyPlugin.ts
/**
* A plugin, designed to be used with PrecacheController, to translate URLs into
* the corresponding cache key, based on the current revision info.
*
* @private
*/
var PrecacheCacheKeyPlugin = class {
	_precacheController;
	constructor({ precacheController }) {
		this._precacheController = precacheController;
	}
	cacheKeyWillBeUsed = async ({ request, params }) => {
		const cacheKey = params?.cacheKey || this._precacheController.getPrecacheKeyForUrl(request.url);
		return cacheKey ? new Request(cacheKey, { headers: request.headers }) : request;
	};
};
//#endregion
//#region src/utils/parsePrecacheOptions.ts
const parsePrecacheOptions = (serwist, precacheOptions = {}) => {
	const { cacheName: precacheCacheName, plugins: precachePlugins = [], fetchOptions: precacheFetchOptions, matchOptions: precacheMatchOptions, fallbackToNetwork: precacheFallbackToNetwork, directoryIndex: precacheDirectoryIndex, ignoreURLParametersMatching: precacheIgnoreUrls, cleanURLs: precacheCleanUrls, urlManipulation: precacheUrlManipulation, cleanupOutdatedCaches, concurrency = 10, navigateFallback, navigateFallbackAllowlist, navigateFallbackDenylist } = precacheOptions ?? {};
	return {
		precacheStrategyOptions: {
			cacheName: cacheNames$1.getPrecacheName(precacheCacheName),
			plugins: [...precachePlugins, new PrecacheCacheKeyPlugin({ precacheController: serwist })],
			fetchOptions: precacheFetchOptions,
			matchOptions: precacheMatchOptions,
			fallbackToNetwork: precacheFallbackToNetwork
		},
		precacheRouteOptions: {
			directoryIndex: precacheDirectoryIndex,
			ignoreURLParametersMatching: precacheIgnoreUrls,
			cleanURLs: precacheCleanUrls,
			urlManipulation: precacheUrlManipulation
		},
		precacheMiscOptions: {
			cleanupOutdatedCaches,
			concurrency,
			navigateFallback,
			navigateFallbackAllowlist,
			navigateFallbackDenylist
		}
	};
};
//#endregion
//#region src/Serwist.ts
/**
* A class that helps bootstrap the service worker.
*
* @see https://serwist.pages.dev/docs/serwist/core/serwist
*/
var Serwist = class {
	_urlsToCacheKeys = /* @__PURE__ */ new Map();
	_urlsToCacheModes = /* @__PURE__ */ new Map();
	_cacheKeysToIntegrities = /* @__PURE__ */ new Map();
	_concurrentPrecaching;
	_precacheStrategy;
	_routes;
	_defaultHandlerMap;
	_catchHandler;
	_requestRules;
	constructor({ precacheEntries, precacheOptions, skipWaiting = false, importScripts, navigationPreload = false, cacheId, clientsClaim: clientsClaim$1 = false, runtimeCaching, offlineAnalyticsConfig, disableDevLogs: disableDevLogs$1 = false, fallbacks, requestRules } = {}) {
		const { precacheStrategyOptions, precacheRouteOptions, precacheMiscOptions } = parsePrecacheOptions(this, precacheOptions);
		this._concurrentPrecaching = precacheMiscOptions.concurrency;
		this._precacheStrategy = new PrecacheStrategy(precacheStrategyOptions);
		this._routes = /* @__PURE__ */ new Map();
		this._defaultHandlerMap = /* @__PURE__ */ new Map();
		this._requestRules = requestRules;
		this.handleInstall = this.handleInstall.bind(this);
		this.handleActivate = this.handleActivate.bind(this);
		this.handleFetch = this.handleFetch.bind(this);
		this.handleCache = this.handleCache.bind(this);
		if (!!importScripts && importScripts.length > 0) self.importScripts(...importScripts);
		if (navigationPreload) enableNavigationPreload();
		if (cacheId !== void 0) setCacheNameDetails({ prefix: cacheId });
		if (skipWaiting) self.skipWaiting();
		else self.addEventListener("message", (event) => {
			if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
		});
		if (clientsClaim$1) clientsClaim();
		if (!!precacheEntries && precacheEntries.length > 0) this.addToPrecacheList(precacheEntries);
		if (precacheMiscOptions.cleanupOutdatedCaches) cleanupOutdatedCaches(precacheStrategyOptions.cacheName);
		this.registerRoute(new PrecacheRoute(this, precacheRouteOptions));
		if (precacheMiscOptions.navigateFallback) this.registerRoute(new NavigationRoute(this.createHandlerBoundToUrl(precacheMiscOptions.navigateFallback), {
			allowlist: precacheMiscOptions.navigateFallbackAllowlist,
			denylist: precacheMiscOptions.navigateFallbackDenylist
		}));
		if (offlineAnalyticsConfig !== void 0) if (typeof offlineAnalyticsConfig === "boolean") offlineAnalyticsConfig && initializeGoogleAnalytics({ serwist: this });
		else initializeGoogleAnalytics({
			...offlineAnalyticsConfig,
			serwist: this
		});
		if (runtimeCaching !== void 0) {
			if (fallbacks !== void 0) {
				const fallbackPlugin = new PrecacheFallbackPlugin({
					fallbackUrls: fallbacks.entries,
					serwist: this
				});
				runtimeCaching.forEach((cacheEntry) => {
					if (cacheEntry.handler instanceof Strategy && !cacheEntry.handler.plugins.some((plugin) => "handlerDidError" in plugin)) cacheEntry.handler.plugins.push(fallbackPlugin);
				});
			}
			for (const entry of runtimeCaching) this.registerCapture(entry.matcher, entry.handler, entry.method);
		}
		if (disableDevLogs$1) disableDevLogs();
	}
	/**
	* The strategy used to precache assets and respond to `fetch` events.
	*/
	get precacheStrategy() {
		return this._precacheStrategy;
	}
	/**
	* A `Map` of HTTP method name (`'GET'`, etc.) to an array of all corresponding registered {@linkcode Route}
	* instances.
	*/
	get routes() {
		return this._routes;
	}
	/**
	* Adds Serwist's event listeners for you. Before calling it, add your own listeners should you need to.
	*/
	addEventListeners() {
		self.addEventListener("install", this.handleInstall);
		self.addEventListener("activate", this.handleActivate);
		self.addEventListener("fetch", this.handleFetch);
		self.addEventListener("message", this.handleCache);
	}
	/**
	* Adds items to the precache list, removing duplicates and ensuring the information is valid.
	*
	* @param entries Array of entries to precache.
	*/
	addToPrecacheList(entries) {
		if (process.env.NODE_ENV !== "production") finalAssertExports.isArray(entries, {
			moduleName: "serwist",
			className: "Serwist",
			funcName: "addToCacheList",
			paramName: "entries"
		});
		const urlsToWarnAbout = [];
		for (const entry of entries) {
			if (typeof entry === "string") urlsToWarnAbout.push(entry);
			else if (entry && !entry.integrity && entry.revision === void 0) urlsToWarnAbout.push(entry.url);
			const { cacheKey, url } = createCacheKey(entry);
			const cacheMode = typeof entry !== "string" && entry.revision ? "reload" : "default";
			if (this._urlsToCacheKeys.has(url) && this._urlsToCacheKeys.get(url) !== cacheKey) throw new SerwistError("add-to-cache-list-conflicting-entries", {
				firstEntry: this._urlsToCacheKeys.get(url),
				secondEntry: cacheKey
			});
			if (typeof entry !== "string" && entry.integrity) {
				if (this._cacheKeysToIntegrities.has(cacheKey) && this._cacheKeysToIntegrities.get(cacheKey) !== entry.integrity) throw new SerwistError("add-to-cache-list-conflicting-integrities", { url });
				this._cacheKeysToIntegrities.set(cacheKey, entry.integrity);
			}
			this._urlsToCacheKeys.set(url, cacheKey);
			this._urlsToCacheModes.set(url, cacheMode);
		}
		if (urlsToWarnAbout.length > 0) {
			const warningMessage = `Serwist is precaching URLs without revision info: ${urlsToWarnAbout.join(", ")}\nThis is generally NOT safe. Learn more at https://bit.ly/wb-precache`;
			if (process.env.NODE_ENV === "production") console.warn(warningMessage);
			else logger.warn(warningMessage);
		}
	}
	/**
	* Precaches new and updated assets. Call this method from the service worker's
	* `install` event.
	*
	* Note: this method calls `event.waitUntil()` for you, so you do not need
	* to call it yourself in your event handlers.
	*
	* @param event
	* @returns
	*/
	handleInstall(event) {
		this.registerRequestRules(event);
		return waitUntil(event, async () => {
			const installReportPlugin = new PrecacheInstallReportPlugin();
			this.precacheStrategy.plugins.push(installReportPlugin);
			await parallel(this._concurrentPrecaching, Array.from(this._urlsToCacheKeys.entries()), async ([url, cacheKey]) => {
				const integrity = this._cacheKeysToIntegrities.get(cacheKey);
				const cacheMode = this._urlsToCacheModes.get(url);
				const request = new Request(url, {
					integrity,
					cache: cacheMode,
					credentials: "same-origin"
				});
				await Promise.all(this.precacheStrategy.handleAll({
					event,
					request,
					url: new URL(request.url),
					params: { cacheKey }
				}));
			});
			const { updatedURLs, notUpdatedURLs } = installReportPlugin;
			if (process.env.NODE_ENV !== "production") printInstallDetails(updatedURLs, notUpdatedURLs);
			return {
				updatedURLs,
				notUpdatedURLs
			};
		});
	}
	/**
	* Registers request rules using the experimental `InstallEvent.addRoutes()` API.
	* These rules allow bypassing the service worker for specific requests to improve performance.
	*
	* @param event The event object of an `install` event handler.
	* @throws {Error} When the route rules are invalid
	*/
	async registerRequestRules(event) {
		if (!this._requestRules) return;
		if (!event?.addRoutes) {
			if (process.env.NODE_ENV !== "production") logger.warn("Request rules ignored as the Static Routing API is not supported in this browser. See https://caniuse.com/mdn-api_installevent_addroutes for more information.");
			return;
		}
		try {
			if (process.env.NODE_ENV !== "production") logger.warn("Request rules may not be supported in all browsers as the Static Routing API is experimental. This feature allows bypassing the service worker for specific requests to improve performance. See https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes for more information.");
			await event.addRoutes(this._requestRules);
			this._requestRules = void 0;
		} catch (error) {
			if (process.env.NODE_ENV !== "production") logger.error(`Failed to register request rules: ${error instanceof Error ? error.message : String(error)}. This may occur if the browser doesn't support the Static Routing API or if the request rules are invalid.`);
			throw error;
		}
	}
	/**
	* Deletes assets that are no longer present in the current precache manifest.
	* Call this method from the service worker's `activate` event.
	*
	* Note: this method calls `event.waitUntil()` for you, so you do not need
	* to call it yourself in your event handlers.
	*
	* @param event
	* @returns
	*/
	handleActivate(event) {
		return waitUntil(event, async () => {
			const cache = await self.caches.open(this.precacheStrategy.cacheName);
			const currentlyCachedRequests = await cache.keys();
			const expectedCacheKeys = new Set(this._urlsToCacheKeys.values());
			const deletedCacheRequests = [];
			for (const request of currentlyCachedRequests) if (!expectedCacheKeys.has(request.url)) {
				await cache.delete(request);
				deletedCacheRequests.push(request.url);
			}
			if (process.env.NODE_ENV !== "production") printCleanupDetails(deletedCacheRequests);
			return { deletedCacheRequests };
		});
	}
	/**
	* Gets a `Response` from an appropriate `Route`'s handler. Call this method
	* from the service worker's `fetch` event.
	* @param event
	*/
	handleFetch(event) {
		const { request } = event;
		const responsePromise = this.handleRequest({
			request,
			event
		});
		if (responsePromise) event.respondWith(responsePromise);
	}
	/**
	* Caches new URLs on demand. Call this method from the service worker's
	* `message` event. To trigger the handler, send a message of type `"CACHE_URLS"`
	* alongside a list of URLs that should be cached as `urlsToCache`.
	* @param event
	*/
	handleCache(event) {
		if (event.data && event.data.type === "CACHE_URLS") {
			const { payload } = event.data;
			if (process.env.NODE_ENV !== "production") logger.debug("Caching URLs from the window", payload.urlsToCache);
			const requestPromises = Promise.all(payload.urlsToCache.map((entry) => {
				let request;
				if (typeof entry === "string") request = new Request(entry);
				else request = new Request(...entry);
				return this.handleRequest({
					request,
					event
				});
			}));
			event.waitUntil(requestPromises);
			if (event.ports?.[0]) requestPromises.then(() => event.ports[0].postMessage(true));
		}
	}
	/**
	* Define a default handler that's called when no routes explicitly
	* match the incoming request.
	*
	* Each HTTP method (`'GET'`, `'POST'`, etc.) gets its own default handler.
	*
	* Without a default handler, unmatched requests will go against the
	* network as if there were no service worker present.
	*
	* @param handler A callback function that returns a `Promise` resulting in a `Response`.
	* @param method The HTTP method to associate with this default handler. Each method
	* has its own default. Defaults to `'GET'`.
	*/
	setDefaultHandler(handler, method = "GET") {
		this._defaultHandlerMap.set(method, normalizeHandler(handler));
	}
	/**
	* If a {@linkcode Route} throws an error while handling a request, this handler
	* will be called and given a chance to provide a response.
	*
	* @param handler A callback function that returns a `Promise` resulting
	* in a `Response`.
	*/
	setCatchHandler(handler) {
		this._catchHandler = normalizeHandler(handler);
	}
	/**
	* Registers a `RegExp`, string, or function with a caching
	* strategy to the router.
	*
	* @param capture If the capture param is a {@linkcode Route} object, all other arguments will be ignored.
	* @param handler A callback function that returns a `Promise` resulting in a `Response`.
	* This parameter is required if `capture` is not a {@linkcode Route} object.
	* @param method The HTTP method to match the route against. Defaults to `'GET'`.
	* @returns The generated {@linkcode Route} object.
	*/
	registerCapture(capture, handler, method) {
		const route = parseRoute(capture, handler, method);
		this.registerRoute(route);
		return route;
	}
	/**
	* Registers a {@linkcode Route} with the router.
	*
	* @param route The {@linkcode Route} to register.
	*/
	registerRoute(route) {
		if (process.env.NODE_ENV !== "production") {
			finalAssertExports.isType(route, "object", {
				moduleName: "serwist",
				className: "Serwist",
				funcName: "registerRoute",
				paramName: "route"
			});
			finalAssertExports.hasMethod(route, "match", {
				moduleName: "serwist",
				className: "Serwist",
				funcName: "registerRoute",
				paramName: "route"
			});
			finalAssertExports.isType(route.handler, "object", {
				moduleName: "serwist",
				className: "Serwist",
				funcName: "registerRoute",
				paramName: "route"
			});
			finalAssertExports.hasMethod(route.handler, "handle", {
				moduleName: "serwist",
				className: "Serwist",
				funcName: "registerRoute",
				paramName: "route.handler"
			});
			finalAssertExports.isType(route.method, "string", {
				moduleName: "serwist",
				className: "Serwist",
				funcName: "registerRoute",
				paramName: "route.method"
			});
		}
		if (!this._routes.has(route.method)) this._routes.set(route.method, []);
		this._routes.get(route.method).push(route);
	}
	/**
	* Unregisters a route from the router.
	*
	* @param route The {@linkcode Route} object to unregister.
	*/
	unregisterRoute(route) {
		if (!this._routes.has(route.method)) throw new SerwistError("unregister-route-but-not-found-with-method", { method: route.method });
		const routeIndex = this._routes.get(route.method).indexOf(route);
		if (routeIndex > -1) this._routes.get(route.method).splice(routeIndex, 1);
		else throw new SerwistError("unregister-route-route-not-registered");
	}
	/**
	* Returns a mapping of a precached URL to the corresponding cache key, taking
	* into account the revision information for the URL.
	*
	* @returns A URL to cache key mapping.
	*/
	getUrlsToPrecacheKeys() {
		return this._urlsToCacheKeys;
	}
	/**
	* Returns a list of all the URLs that have been precached by the current
	* service worker.
	*
	* @returns The precached URLs.
	*/
	getPrecachedUrls() {
		return [...this._urlsToCacheKeys.keys()];
	}
	/**
	* Returns the cache key used for storing a given URL. If that URL is
	* unversioned, like "/index.html", then the cache key will be the original
	* URL with a search parameter appended to it.
	*
	* @param url A URL whose cache key you want to look up.
	* @returns The versioned URL that corresponds to a cache key
	* for the original URL, or undefined if that URL isn't precached.
	*/
	getPrecacheKeyForUrl(url) {
		const urlObject = new URL(url, location.href);
		return this._urlsToCacheKeys.get(urlObject.href);
	}
	/**
	* @param url A cache key whose SRI you want to look up.
	* @returns The subresource integrity associated with the cache key,
	* or undefined if it's not set.
	*/
	getIntegrityForPrecacheKey(cacheKey) {
		return this._cacheKeysToIntegrities.get(cacheKey);
	}
	/**
	* This acts as a drop-in replacement for
	* [`cache.match()`](https://developer.mozilla.org/en-US/docs/Web/API/Cache/match)
	* with the following differences:
	*
	* - It knows what the name of the precache is, and only checks in that cache.
	* - It allows you to pass in an "original" URL without versioning parameters,
	* and it will automatically look up the correct cache key for the currently
	* active revision of that URL.
	*
	* E.g., `matchPrecache('index.html')` will find the correct precached
	* response for the currently active service worker, even if the actual cache
	* key is `'/index.html?__WB_REVISION__=1234abcd'`.
	*
	* @param request The key (without revisioning parameters)
	* to look up in the precache.
	* @returns
	*/
	async matchPrecache(request) {
		const url = request instanceof Request ? request.url : request;
		const cacheKey = this.getPrecacheKeyForUrl(url);
		if (cacheKey) return (await self.caches.open(this.precacheStrategy.cacheName)).match(cacheKey);
	}
	/**
	* Returns a function that looks up `url` in the precache (taking into
	* account revision information), and returns the corresponding `Response`.
	*
	* @param url The precached URL which will be used to lookup the response.
	* @return
	*/
	createHandlerBoundToUrl(url) {
		const cacheKey = this.getPrecacheKeyForUrl(url);
		if (!cacheKey) throw new SerwistError("non-precached-url", { url });
		return (options) => {
			options.request = new Request(url);
			options.params = {
				cacheKey,
				...options.params
			};
			return this.precacheStrategy.handle(options);
		};
	}
	/**
	* Applies the routing rules to a `FetchEvent` object to get a response from an
	* appropriate route.
	*
	* @param options
	* @returns A promise is returned if a registered route can handle the request.
	* If there is no matching route and there's no default handler, `undefined`
	* is returned.
	*/
	handleRequest({ request, event }) {
		if (process.env.NODE_ENV !== "production") finalAssertExports.isInstance(request, Request, {
			moduleName: "serwist",
			className: "Serwist",
			funcName: "handleRequest",
			paramName: "options.request"
		});
		const url = new URL(request.url, location.href);
		if (!url.protocol.startsWith("http")) {
			if (process.env.NODE_ENV !== "production") logger.debug("Router only supports URLs that start with 'http'.");
			return;
		}
		const sameOrigin = url.origin === location.origin;
		const { params, route } = this.findMatchingRoute({
			event,
			request,
			sameOrigin,
			url
		});
		let handler = route?.handler;
		const debugMessages = [];
		if (process.env.NODE_ENV !== "production") {
			if (handler) {
				debugMessages.push(["Found a route to handle this request:", route]);
				if (params) debugMessages.push([`Passing the following params to the route's handler:`, params]);
			}
		}
		const method = request.method;
		if (!handler && this._defaultHandlerMap.has(method)) {
			if (process.env.NODE_ENV !== "production") debugMessages.push(`Failed to find a matching route. Falling back to the default handler for ${method}.`);
			handler = this._defaultHandlerMap.get(method);
		}
		if (!handler) {
			if (process.env.NODE_ENV !== "production") logger.debug(`No route found for: ${getFriendlyURL(url)}`);
			return;
		}
		if (process.env.NODE_ENV !== "production") {
			logger.groupCollapsed(`Router is responding to: ${getFriendlyURL(url)}`);
			for (const msg of debugMessages) if (Array.isArray(msg)) logger.log(...msg);
			else logger.log(msg);
			logger.groupEnd();
		}
		let responsePromise;
		try {
			responsePromise = handler.handle({
				url,
				request,
				event,
				params
			});
		} catch (err) {
			responsePromise = Promise.reject(err);
		}
		const catchHandler = route?.catchHandler;
		if (responsePromise instanceof Promise && (this._catchHandler || catchHandler)) responsePromise = responsePromise.catch(async (err) => {
			if (catchHandler) {
				if (process.env.NODE_ENV !== "production") {
					logger.groupCollapsed(`Error thrown when responding to:  ${getFriendlyURL(url)}. Falling back to route's Catch Handler.`);
					logger.error("Error thrown by:", route);
					logger.error(err);
					logger.groupEnd();
				}
				try {
					return await catchHandler.handle({
						url,
						request,
						event,
						params
					});
				} catch (catchErr) {
					if (catchErr instanceof Error) err = catchErr;
				}
			}
			if (this._catchHandler) {
				if (process.env.NODE_ENV !== "production") {
					logger.groupCollapsed(`Error thrown when responding to:  ${getFriendlyURL(url)}. Falling back to global Catch Handler.`);
					logger.error("Error thrown by:", route);
					logger.error(err);
					logger.groupEnd();
				}
				return this._catchHandler.handle({
					url,
					request,
					event
				});
			}
			throw err;
		});
		return responsePromise;
	}
	/**
	* Checks a request and URL (and optionally an event) against the list of
	* registered routes, and if there's a match, returns the corresponding
	* route along with any params generated by the match.
	*
	* @param options
	* @returns An object with `route` and `params` properties. They are populated
	* if a matching route was found or `undefined` otherwise.
	*/
	findMatchingRoute({ url, sameOrigin, request, event }) {
		const routes = this._routes.get(request.method) || [];
		for (const route of routes) {
			let params;
			const matchResult = route.match({
				url,
				sameOrigin,
				request,
				event
			});
			if (matchResult) {
				if (process.env.NODE_ENV !== "production") {
					if (matchResult instanceof Promise) logger.warn(`While routing ${getFriendlyURL(url)}, an async matchCallback function was used. Please convert the following route to use a synchronous matchCallback function:`, route);
				}
				params = matchResult;
				if (Array.isArray(params) && params.length === 0) params = void 0;
				else if (matchResult.constructor === Object && Object.keys(matchResult).length === 0) params = void 0;
				else if (typeof matchResult === "boolean") params = void 0;
				return {
					route,
					params
				};
			}
		}
		return {};
	}
};
//#endregion
export { BROADCAST_UPDATE_DEFAULT_HEADERS, BackgroundSyncPlugin, BackgroundSyncQueue, BackgroundSyncQueueStore, BroadcastCacheUpdate, BroadcastUpdatePlugin, CacheExpiration, CacheFirst, CacheOnly, CacheableResponse, CacheableResponsePlugin, ExpirationPlugin, NavigationRoute, NetworkFirst, NetworkOnly, PrecacheFallbackPlugin, PrecacheRoute, PrecacheStrategy, RangeRequestsPlugin, RegExpRoute, Route, Serwist, StaleWhileRevalidate, StorableRequest, Strategy, StrategyHandler, cacheNames, copyResponse, createPartialResponse, disableDevLogs, disableNavigationPreload, enableNavigationPreload, initializeGoogleAnalytics, isNavigationPreloadSupported, registerQuotaErrorCallback, responsesAreSame, setCacheNameDetails };

//# sourceMappingURL=index.mjs.map