import { a as Deferred, c as timeout, d as finalAssertExports, f as SerwistError, i as executeQuotaErrorCallbacks, l as logger, m as cacheNames, o as cacheMatchIgnoreParams, p as canConstructResponseFromBodyStream, u as getFriendlyURL } from "./waitUntil-BDu76Zx7.js";
import { openDB } from "idb";
//#region src/copyResponse.ts
/**
* Allows developers to copy a response and modify its `headers`, `status`,
* or `statusText` values (the [valid options](https://developer.mozilla.org/en-US/docs/Web/API/Response/Response#options)
* when constructing a `Response` object).
* To modify these values, pass a function as the second argument. That
* function will be invoked with the options of the initial `Response` object.
* The return value of this function will be used as the options for the new `Response` object.
* To change the values either modify the passed parameter(s) and return it or return a totally
* new object.
*
* This method is intentionally limited to same-origin responses, regardless of
* whether CORS was used or not.
*
* @param response The initial response.
* @param modifier The function used to modify the options of the `Response` object.
*/
const copyResponse = async (response, modifier) => {
	let origin = null;
	if (response.url) origin = new URL(response.url).origin;
	if (origin !== self.location.origin) throw new SerwistError("cross-origin-copy-response", { origin });
	const clonedResponse = response.clone();
	const responseInit = {
		headers: new Headers(clonedResponse.headers),
		status: clonedResponse.status,
		statusText: clonedResponse.statusText
	};
	const modifiedResponseInit = modifier ? modifier(responseInit) : responseInit;
	const body = canConstructResponseFromBodyStream() ? clonedResponse.body : await clonedResponse.blob();
	return new Response(body, modifiedResponseInit);
};
//#endregion
//#region src/disableDevLogs.ts
/**
* Disables Serwist's logging in development mode.
*
* @see https://serwist.pages.dev/docs/serwist/core/disable-dev-logs
*/
const disableDevLogs = () => {
	self.__WB_DISABLE_DEV_LOGS = true;
};
//#endregion
//#region src/lib/backgroundSync/BackgroundSyncQueueDb.ts
const BACKGROUND_SYNC_DB_VERSION = 3;
const BACKGROUND_SYNC_DB_NAME = "serwist-background-sync";
const REQUEST_OBJECT_STORE_NAME = "requests";
const QUEUE_NAME_INDEX = "queueName";
/**
* A class to interact directly an IndexedDB created specifically to save and
* retrieve QueueStoreEntries. This class encapsulates all the schema details
* to store the representation of a Queue.
*
* @private
*/
var BackgroundSyncQueueDb = class {
	_db = null;
	/**
	* Add QueueStoreEntry to underlying db.
	*
	* @param entry
	*/
	async addEntry(entry) {
		const tx = (await this.getDb()).transaction(REQUEST_OBJECT_STORE_NAME, "readwrite", { durability: "relaxed" });
		await tx.store.add(entry);
		await tx.done;
	}
	/**
	* Returns the first entry id in the ObjectStore.
	*
	* @returns
	*/
	async getFirstEntryId() {
		return (await (await this.getDb()).transaction(REQUEST_OBJECT_STORE_NAME).store.openCursor())?.value.id;
	}
	/**
	* Get all the entries filtered by index
	*
	* @param queueName
	* @returns
	*/
	async getAllEntriesByQueueName(queueName) {
		const results = await (await this.getDb()).getAllFromIndex(REQUEST_OBJECT_STORE_NAME, QUEUE_NAME_INDEX, IDBKeyRange.only(queueName));
		return results ? results : [];
	}
	/**
	* Returns the number of entries filtered by index
	*
	* @param queueName
	* @returns
	*/
	async getEntryCountByQueueName(queueName) {
		return (await this.getDb()).countFromIndex(REQUEST_OBJECT_STORE_NAME, QUEUE_NAME_INDEX, IDBKeyRange.only(queueName));
	}
	/**
	* Deletes a single entry by id.
	*
	* @param id the id of the entry to be deleted
	*/
	async deleteEntry(id) {
		await (await this.getDb()).delete(REQUEST_OBJECT_STORE_NAME, id);
	}
	/**
	*
	* @param queueName
	* @returns
	*/
	async getFirstEntryByQueueName(queueName) {
		return await this.getEndEntryFromIndex(IDBKeyRange.only(queueName), "next");
	}
	/**
	*
	* @param queueName
	* @returns
	*/
	async getLastEntryByQueueName(queueName) {
		return await this.getEndEntryFromIndex(IDBKeyRange.only(queueName), "prev");
	}
	/**
	* Returns either the first or the last entries, depending on direction.
	* Filtered by index.
	*
	* @param direction
	* @param query
	* @returns
	* @private
	*/
	async getEndEntryFromIndex(query, direction) {
		return (await (await this.getDb()).transaction(REQUEST_OBJECT_STORE_NAME).store.index(QUEUE_NAME_INDEX).openCursor(query, direction))?.value;
	}
	/**
	* Returns an open connection to the database.
	*
	* @private
	*/
	async getDb() {
		if (!this._db) this._db = await openDB(BACKGROUND_SYNC_DB_NAME, BACKGROUND_SYNC_DB_VERSION, { upgrade: this._upgradeDb });
		return this._db;
	}
	/**
	* Upgrades QueueDB
	*
	* @param db
	* @param oldVersion
	* @private
	*/
	_upgradeDb(db, oldVersion) {
		if (oldVersion > 0 && oldVersion < BACKGROUND_SYNC_DB_VERSION) {
			if (db.objectStoreNames.contains(REQUEST_OBJECT_STORE_NAME)) db.deleteObjectStore(REQUEST_OBJECT_STORE_NAME);
		}
		db.createObjectStore(REQUEST_OBJECT_STORE_NAME, {
			autoIncrement: true,
			keyPath: "id"
		}).createIndex(QUEUE_NAME_INDEX, QUEUE_NAME_INDEX, { unique: false });
	}
};
//#endregion
//#region src/lib/backgroundSync/BackgroundSyncQueueStore.ts
/**
* A class to manage storing requests from a Queue in IndexedDB,
* indexed by their queue name for easier access.
*
* Most developers will not need to access this class directly;
* it is exposed for advanced use cases.
*/
var BackgroundSyncQueueStore = class {
	_queueName;
	_queueDb;
	/**
	* Associates this instance with a Queue instance, so entries added can be
	* identified by their queue name.
	*
	* @param queueName
	*/
	constructor(queueName) {
		this._queueName = queueName;
		this._queueDb = new BackgroundSyncQueueDb();
	}
	/**
	* Append an entry last in the queue.
	*
	* @param entry
	*/
	async pushEntry(entry) {
		if (process.env.NODE_ENV !== "production") {
			finalAssertExports.isType(entry, "object", {
				moduleName: "serwist",
				className: "BackgroundSyncQueueStore",
				funcName: "pushEntry",
				paramName: "entry"
			});
			finalAssertExports.isType(entry.requestData, "object", {
				moduleName: "serwist",
				className: "BackgroundSyncQueueStore",
				funcName: "pushEntry",
				paramName: "entry.requestData"
			});
		}
		delete entry.id;
		entry.queueName = this._queueName;
		await this._queueDb.addEntry(entry);
	}
	/**
	* Prepend an entry first in the queue.
	*
	* @param entry
	*/
	async unshiftEntry(entry) {
		if (process.env.NODE_ENV !== "production") {
			finalAssertExports.isType(entry, "object", {
				moduleName: "serwist",
				className: "BackgroundSyncQueueStore",
				funcName: "unshiftEntry",
				paramName: "entry"
			});
			finalAssertExports.isType(entry.requestData, "object", {
				moduleName: "serwist",
				className: "BackgroundSyncQueueStore",
				funcName: "unshiftEntry",
				paramName: "entry.requestData"
			});
		}
		const firstId = await this._queueDb.getFirstEntryId();
		if (firstId) entry.id = firstId - 1;
		else delete entry.id;
		entry.queueName = this._queueName;
		await this._queueDb.addEntry(entry);
	}
	/**
	* Removes and returns the last entry in the queue matching the `queueName`.
	*
	* @returns
	*/
	async popEntry() {
		return this._removeEntry(await this._queueDb.getLastEntryByQueueName(this._queueName));
	}
	/**
	* Removes and returns the first entry in the queue matching the `queueName`.
	*
	* @returns
	*/
	async shiftEntry() {
		return this._removeEntry(await this._queueDb.getFirstEntryByQueueName(this._queueName));
	}
	/**
	* Returns all entries in the store matching the `queueName`.
	*
	* @returns
	*/
	async getAll() {
		return await this._queueDb.getAllEntriesByQueueName(this._queueName);
	}
	/**
	* Returns the number of entries in the store matching the `queueName`.
	*
	* @returns
	*/
	async size() {
		return await this._queueDb.getEntryCountByQueueName(this._queueName);
	}
	/**
	* Deletes the entry for the given ID.
	*
	* WARNING: this method does not ensure the deleted entry belongs to this
	* queue (i.e. matches the `queueName`). But this limitation is acceptable
	* as this class is not publicly exposed. An additional check would make
	* this method slower than it needs to be.
	*
	* @param id
	*/
	async deleteEntry(id) {
		await this._queueDb.deleteEntry(id);
	}
	/**
	* Removes and returns the first or last entry in the queue (based on the
	* `direction` argument) matching the `queueName`.
	*
	* @returns
	* @private
	*/
	async _removeEntry(entry) {
		if (entry) await this.deleteEntry(entry.id);
		return entry;
	}
};
//#endregion
//#region src/lib/backgroundSync/StorableRequest.ts
const serializableProperties = [
	"method",
	"referrer",
	"referrerPolicy",
	"mode",
	"credentials",
	"cache",
	"redirect",
	"integrity",
	"keepalive"
];
/**
* A class to make it easier to serialize and de-serialize requests so they
* can be stored in IndexedDB.
*
* Most developers will not need to access this class directly;
* it is exposed for advanced use cases.
*/
var StorableRequest = class StorableRequest {
	_requestData;
	/**
	* Converts a Request object to a plain object that can be structured
	* cloned or stringified to JSON.
	*
	* @param request
	* @returns
	*/
	static async fromRequest(request) {
		const requestData = {
			url: request.url,
			headers: {}
		};
		if (request.method !== "GET") requestData.body = await request.clone().arrayBuffer();
		request.headers.forEach((value, key) => {
			requestData.headers[key] = value;
		});
		for (const prop of serializableProperties) if (request[prop] !== void 0) requestData[prop] = request[prop];
		return new StorableRequest(requestData);
	}
	/**
	* Accepts an object of request data that can be used to construct a
	* `Request` object but can also be stored in IndexedDB.
	*
	* @param requestData An object of request data that includes the `url` plus any relevant property of
	* [`requestInit`](https://fetch.spec.whatwg.org/#requestinit).
	*/
	constructor(requestData) {
		if (process.env.NODE_ENV !== "production") {
			finalAssertExports.isType(requestData, "object", {
				moduleName: "serwist",
				className: "StorableRequest",
				funcName: "constructor",
				paramName: "requestData"
			});
			finalAssertExports.isType(requestData.url, "string", {
				moduleName: "serwist",
				className: "StorableRequest",
				funcName: "constructor",
				paramName: "requestData.url"
			});
		}
		if (requestData.mode === "navigate") requestData.mode = "same-origin";
		this._requestData = requestData;
	}
	/**
	* Returns a deep clone of the instance's `requestData` object.
	*
	* @returns
	*/
	toObject() {
		const requestData = Object.assign({}, this._requestData);
		requestData.headers = Object.assign({}, this._requestData.headers);
		if (requestData.body) requestData.body = requestData.body.slice(0);
		return requestData;
	}
	/**
	* Converts this instance to a Request.
	*
	* @returns
	*/
	toRequest() {
		return new Request(this._requestData.url, this._requestData);
	}
	/**
	* Creates and returns a deep clone of the instance.
	*
	* @returns
	*/
	clone() {
		return new StorableRequest(this.toObject());
	}
};
//#endregion
//#region src/lib/backgroundSync/BackgroundSyncQueue.ts
const TAG_PREFIX = "serwist-background-sync";
const MAX_RETENTION_TIME = 1440 * 7;
const queueNames = /* @__PURE__ */ new Set();
/**
* Converts a QueueStore entry into the format exposed by Queue. This entails
* converting the request data into a real request and omitting the `id` and
* `queueName` properties.
*
* @param queueStoreEntry
* @returns
* @private
*/
const convertEntry = (queueStoreEntry) => {
	const queueEntry = {
		request: new StorableRequest(queueStoreEntry.requestData).toRequest(),
		timestamp: queueStoreEntry.timestamp
	};
	if (queueStoreEntry.metadata) queueEntry.metadata = queueStoreEntry.metadata;
	return queueEntry;
};
/**
* A class to manage storing failed requests in IndexedDB and retrying them
* later. All parts of the storing and replaying process are observable via
* callbacks.
*/
var BackgroundSyncQueue = class {
	_name;
	_onSync;
	_maxRetentionTime;
	_queueStore;
	_forceSyncFallback;
	_syncInProgress = false;
	_requestsAddedDuringSync = false;
	/**
	* Creates an instance of Queue with the given options
	*
	* @param name The unique name for this queue. This name must be
	* unique as it's used to register sync events and store requests
	* in IndexedDB specific to this instance. An error will be thrown if
	* a duplicate name is detected.
	* @param options
	*/
	constructor(name, { forceSyncFallback, onSync, maxRetentionTime } = {}) {
		if (queueNames.has(name)) throw new SerwistError("duplicate-queue-name", { name });
		queueNames.add(name);
		this._name = name;
		this._onSync = onSync || this.replayRequests;
		this._maxRetentionTime = maxRetentionTime || MAX_RETENTION_TIME;
		this._forceSyncFallback = Boolean(forceSyncFallback);
		this._queueStore = new BackgroundSyncQueueStore(this._name);
		this._addSyncListener();
	}
	/**
	* @returns
	*/
	get name() {
		return this._name;
	}
	/**
	* Stores the passed request in IndexedDB (with its timestamp and any
	* metadata) at the end of the queue.
	*
	* @param entry
	*/
	async pushRequest(entry) {
		if (process.env.NODE_ENV !== "production") {
			finalAssertExports.isType(entry, "object", {
				moduleName: "serwist",
				className: "BackgroundSyncQueue",
				funcName: "pushRequest",
				paramName: "entry"
			});
			finalAssertExports.isInstance(entry.request, Request, {
				moduleName: "serwist",
				className: "BackgroundSyncQueue",
				funcName: "pushRequest",
				paramName: "entry.request"
			});
		}
		await this._addRequest(entry, "push");
	}
	/**
	* Stores the passed request in IndexedDB (with its timestamp and any
	* metadata) at the beginning of the queue.
	*
	* @param entry
	*/
	async unshiftRequest(entry) {
		if (process.env.NODE_ENV !== "production") {
			finalAssertExports.isType(entry, "object", {
				moduleName: "serwist",
				className: "BackgroundSyncQueue",
				funcName: "unshiftRequest",
				paramName: "entry"
			});
			finalAssertExports.isInstance(entry.request, Request, {
				moduleName: "serwist",
				className: "BackgroundSyncQueue",
				funcName: "unshiftRequest",
				paramName: "entry.request"
			});
		}
		await this._addRequest(entry, "unshift");
	}
	/**
	* Removes and returns the last request in the queue (along with its
	* timestamp and any metadata).
	*
	* @returns
	*/
	async popRequest() {
		return this._removeRequest("pop");
	}
	/**
	* Removes and returns the first request in the queue (along with its
	* timestamp and any metadata).
	*
	* @returns
	*/
	async shiftRequest() {
		return this._removeRequest("shift");
	}
	/**
	* Returns all the entries that have not expired (per `maxRetentionTime`).
	* Any expired entries are removed from the queue.
	*
	* @returns
	*/
	async getAll() {
		const allEntries = await this._queueStore.getAll();
		const now = Date.now();
		const unexpiredEntries = [];
		for (const entry of allEntries) {
			const maxRetentionTimeInMs = this._maxRetentionTime * 60 * 1e3;
			if (now - entry.timestamp > maxRetentionTimeInMs) await this._queueStore.deleteEntry(entry.id);
			else unexpiredEntries.push(convertEntry(entry));
		}
		return unexpiredEntries;
	}
	/**
	* Returns the number of entries present in the queue.
	* Note that expired entries (per `maxRetentionTime`) are also included in this count.
	*
	* @returns
	*/
	async size() {
		return await this._queueStore.size();
	}
	/**
	* Adds the entry to the QueueStore and registers for a sync event.
	*
	* @param entry
	* @param operation
	* @private
	*/
	async _addRequest({ request, metadata, timestamp = Date.now() }, operation) {
		const entry = {
			requestData: (await StorableRequest.fromRequest(request.clone())).toObject(),
			timestamp
		};
		if (metadata) entry.metadata = metadata;
		switch (operation) {
			case "push":
				await this._queueStore.pushEntry(entry);
				break;
			case "unshift":
				await this._queueStore.unshiftEntry(entry);
				break;
		}
		if (process.env.NODE_ENV !== "production") logger.log(`Request for '${getFriendlyURL(request.url)}' has been added to background sync queue '${this._name}'.`);
		if (this._syncInProgress) this._requestsAddedDuringSync = true;
		else await this.registerSync();
	}
	/**
	* Removes and returns the first or last (depending on `operation`) entry
	* from the {@linkcode BackgroundSyncQueueStore} that's not older than the `maxRetentionTime`.
	*
	* @param operation
	* @returns
	* @private
	*/
	async _removeRequest(operation) {
		const now = Date.now();
		let entry;
		switch (operation) {
			case "pop":
				entry = await this._queueStore.popEntry();
				break;
			case "shift":
				entry = await this._queueStore.shiftEntry();
				break;
		}
		if (entry) {
			const maxRetentionTimeInMs = this._maxRetentionTime * 60 * 1e3;
			if (now - entry.timestamp > maxRetentionTimeInMs) return this._removeRequest(operation);
			return convertEntry(entry);
		}
	}
	/**
	* Loops through each request in the queue and attempts to re-fetch it.
	* If any request fails to re-fetch, it's put back in the same position in
	* the queue (which registers a retry for the next sync event).
	*/
	async replayRequests() {
		let entry;
		while (entry = await this.shiftRequest()) try {
			await fetch(entry.request.clone());
			if (process.env.NODE_ENV !== "production") logger.log(`Request for '${getFriendlyURL(entry.request.url)}' has been replayed in queue '${this._name}'`);
		} catch {
			await this.unshiftRequest(entry);
			if (process.env.NODE_ENV !== "production") logger.log(`Request for '${getFriendlyURL(entry.request.url)}' failed to replay, putting it back in queue '${this._name}'`);
			throw new SerwistError("queue-replay-failed", { name: this._name });
		}
		if (process.env.NODE_ENV !== "production") logger.log(`All requests in queue '${this.name}' have successfully replayed; the queue is now empty!`);
	}
	/**
	* Registers a sync event with a tag unique to this instance.
	*/
	async registerSync() {
		if ("sync" in self.registration && !this._forceSyncFallback) try {
			await self.registration.sync.register(`${TAG_PREFIX}:${this._name}`);
		} catch (err) {
			if (process.env.NODE_ENV !== "production") logger.warn(`Unable to register sync event for '${this._name}'.`, err);
		}
	}
	/**
	* In sync-supporting browsers, this adds a listener for the sync event.
	* In non-sync-supporting browsers, or if _forceSyncFallback is true, this
	* will retry the queue on service worker startup.
	*
	* @private
	*/
	_addSyncListener() {
		if ("sync" in self.registration && !this._forceSyncFallback) self.addEventListener("sync", (event) => {
			if (event.tag === `${TAG_PREFIX}:${this._name}`) {
				if (process.env.NODE_ENV !== "production") logger.log(`Background sync for tag '${event.tag}' has been received`);
				const syncComplete = async () => {
					this._syncInProgress = true;
					let syncError;
					try {
						await this._onSync({ queue: this });
					} catch (error) {
						if (error instanceof Error) {
							syncError = error;
							throw syncError;
						}
					} finally {
						if (this._requestsAddedDuringSync && !(syncError && !event.lastChance)) await this.registerSync();
						this._syncInProgress = false;
						this._requestsAddedDuringSync = false;
					}
				};
				event.waitUntil(syncComplete());
			}
		});
		else {
			if (process.env.NODE_ENV !== "production") logger.log("Background sync replaying without background sync event");
			this._onSync({ queue: this });
		}
	}
	/**
	* Returns the set of queue names. This is primarily used to reset the list
	* of queue names in tests.
	*
	* @returns
	* @private
	*/
	static get _queueNames() {
		return queueNames;
	}
};
//#endregion
//#region src/lib/backgroundSync/BackgroundSyncPlugin.ts
/**
* A class implementing the `fetchDidFail` lifecycle callback. This makes it
* easier to add failed requests to a {@linkcode BackgroundSyncQueue}.
*/
var BackgroundSyncPlugin = class {
	_queue;
	/**
	* @param name See the {@linkcode BackgroundSyncQueue}
	* documentation for parameter details.
	* @param options See the {@linkcode BackgroundSyncQueue}
	* documentation for parameter details.
	* @see https://serwist.pages.dev/docs/serwist/core/background-sync-queue
	*/
	constructor(name, options) {
		this._queue = new BackgroundSyncQueue(name, options);
	}
	/**
	* @param options
	* @private
	*/
	async fetchDidFail({ request }) {
		await this._queue.pushRequest({ request });
	}
};
//#endregion
//#region src/lib/strategies/plugins/cacheOkAndOpaquePlugin.ts
const cacheOkAndOpaquePlugin = { 
/**
* Returns a valid response (to allow caching) if the status is 200 (OK) or
* 0 (opaque).
*
* @param options
* @returns
* @private
*/
cacheWillUpdate: async ({ response }) => {
	if (response.status === 200 || response.status === 0) return response;
	return null;
} };
//#endregion
//#region src/lib/strategies/StrategyHandler.ts
function toRequest(input) {
	return typeof input === "string" ? new Request(input) : input;
}
/**
* A class created every time a {@linkcode Strategy} instance calls {@linkcode Strategy.handle} or
* {@linkcode Strategy.handleAll} that wraps all fetch and cache actions around plugin callbacks
* and keeps track of when the strategy is "done" (i.e. when all added `event.waitUntil()` promises
* have resolved).
*/
var StrategyHandler = class {
	/**
	* The event associated with this request.
	*/
	event;
	/**
	* The request the strategy is processing (passed to the strategy's
	* `handle()` or `handleAll()` method).
	*/
	request;
	/**
	* A `URL` instance of `request.url` (if passed to the strategy's
	* `handle()` or `handleAll()` method).
	* Note: the `url` param will be present if the strategy is invoked
	* from a {@linkcode Route} object.
	*/
	url;
	/**
	* Some additional params (if passed to the strategy's
	* `handle()` or `handleAll()` method).
	*
	* Note: the `params` param will be present if the strategy is invoked
	* from a {@linkcode Route} object and that route's matcher returned a truthy
	* value (it will be that value).
	*/
	params;
	_cacheKeys = {};
	_strategy;
	_handlerDeferred;
	_extendLifetimePromises;
	_plugins;
	_pluginStateMap;
	/**
	* Creates a new instance associated with the passed strategy and event
	* that's handling the request.
	*
	* The constructor also initializes the state that will be passed to each of
	* the plugins handling this request.
	*
	* @param strategy
	* @param options
	*/
	constructor(strategy, options) {
		if (process.env.NODE_ENV !== "production") {
			finalAssertExports.isInstance(options.event, ExtendableEvent, {
				moduleName: "serwist",
				className: "StrategyHandler",
				funcName: "constructor",
				paramName: "options.event"
			});
			finalAssertExports.isInstance(options.request, Request, {
				moduleName: "serwist",
				className: "StrategyHandler",
				funcName: "constructor",
				paramName: "options.request"
			});
		}
		this.event = options.event;
		this.request = options.request;
		if (options.url) {
			this.url = options.url;
			this.params = options.params;
		}
		this._strategy = strategy;
		this._handlerDeferred = new Deferred();
		this._extendLifetimePromises = [];
		this._plugins = [...strategy.plugins];
		this._pluginStateMap = /* @__PURE__ */ new Map();
		for (const plugin of this._plugins) this._pluginStateMap.set(plugin, {});
		this.event.waitUntil(this._handlerDeferred.promise);
	}
	/**
	* Fetches a given request (and invokes any applicable plugin callback
	* methods), taking the `fetchOptions` (for non-navigation requests) and
	* `plugins` provided to the {@linkcode Strategy} object into account.
	*
	* The following plugin lifecycle methods are invoked when using this method:
	* - `requestWillFetch()`
	* - `fetchDidSucceed()`
	* - `fetchDidFail()`
	*
	* @param input The URL or request to fetch.
	* @returns
	*/
	async fetch(input) {
		const { event } = this;
		let request = toRequest(input);
		const preloadResponse = await this.getPreloadResponse();
		if (preloadResponse) return preloadResponse;
		const originalRequest = this.hasCallback("fetchDidFail") ? request.clone() : null;
		try {
			for (const cb of this.iterateCallbacks("requestWillFetch")) request = await cb({
				request: request.clone(),
				event
			});
		} catch (err) {
			if (err instanceof Error) throw new SerwistError("plugin-error-request-will-fetch", { thrownErrorMessage: err.message });
		}
		const pluginFilteredRequest = request.clone();
		try {
			let fetchResponse;
			fetchResponse = await fetch(request, request.mode === "navigate" ? void 0 : this._strategy.fetchOptions);
			if (process.env.NODE_ENV !== "production") logger.debug(`Network request for '${getFriendlyURL(request.url)}' returned a response with status '${fetchResponse.status}'.`);
			for (const callback of this.iterateCallbacks("fetchDidSucceed")) fetchResponse = await callback({
				event,
				request: pluginFilteredRequest,
				response: fetchResponse
			});
			return fetchResponse;
		} catch (error) {
			if (process.env.NODE_ENV !== "production") logger.log(`Network request for '${getFriendlyURL(request.url)}' threw an error.`, error);
			if (originalRequest) await this.runCallbacks("fetchDidFail", {
				error,
				event,
				originalRequest: originalRequest.clone(),
				request: pluginFilteredRequest.clone()
			});
			throw error;
		}
	}
	/**
	* Calls `this.fetch()` and (in the background) caches the generated response.
	*
	* The call to `this.cachePut()` automatically invokes `this.waitUntil()`,
	* so you do not have to call `waitUntil()` yourself.
	*
	* @param input The request or URL to fetch and cache.
	* @returns
	*/
	async fetchAndCachePut(input) {
		const response = await this.fetch(input);
		const responseClone = response.clone();
		this.waitUntil(this.cachePut(input, responseClone));
		return response;
	}
	/**
	* Matches a request from the cache (and invokes any applicable plugin
	* callback method) using the `cacheName`, `matchOptions`, and `plugins`
	* provided to the `Strategy` object.
	*
	* The following lifecycle methods are invoked when using this method:
	* - `cacheKeyWillBeUsed`
	* - `cachedResponseWillBeUsed`
	*
	* @param key The `Request` or `URL` object to use as the cache key.
	* @returns A matching response, if found.
	*/
	async cacheMatch(key) {
		const request = toRequest(key);
		let cachedResponse;
		const { cacheName, matchOptions } = this._strategy;
		const effectiveRequest = await this.getCacheKey(request, "read");
		const multiMatchOptions = {
			...matchOptions,
			cacheName
		};
		cachedResponse = await caches.match(effectiveRequest, multiMatchOptions);
		if (process.env.NODE_ENV !== "production") if (cachedResponse) logger.debug(`Found a cached response in '${cacheName}'.`);
		else logger.debug(`No cached response found in '${cacheName}'.`);
		for (const callback of this.iterateCallbacks("cachedResponseWillBeUsed")) cachedResponse = await callback({
			cacheName,
			matchOptions,
			cachedResponse,
			request: effectiveRequest,
			event: this.event
		}) || void 0;
		return cachedResponse;
	}
	/**
	* Puts a request/response pair into the cache (and invokes any applicable
	* plugin callback method) using the `cacheName` and `plugins` provided to
	* the {@linkcode Strategy} object.
	*
	* The following plugin lifecycle methods are invoked when using this method:
	* - `cacheKeyWillBeUsed`
	* - `cacheWillUpdate`
	* - `cacheDidUpdate`
	*
	* @param key The request or URL to use as the cache key.
	* @param response The response to cache.
	* @returns `false` if a `cacheWillUpdate` caused the response to
	* not be cached, and `true` otherwise.
	*/
	async cachePut(key, response) {
		const request = toRequest(key);
		await timeout(0);
		const effectiveRequest = await this.getCacheKey(request, "write");
		if (process.env.NODE_ENV !== "production") {
			if (effectiveRequest.method && effectiveRequest.method !== "GET") throw new SerwistError("attempt-to-cache-non-get-request", {
				url: getFriendlyURL(effectiveRequest.url),
				method: effectiveRequest.method
			});
		}
		if (!response) {
			if (process.env.NODE_ENV !== "production") logger.error(`Cannot cache non-existent response for '${getFriendlyURL(effectiveRequest.url)}'.`);
			throw new SerwistError("cache-put-with-no-response", { url: getFriendlyURL(effectiveRequest.url) });
		}
		const responseToCache = await this._ensureResponseSafeToCache(response);
		if (!responseToCache) {
			if (process.env.NODE_ENV !== "production") logger.debug(`Response '${getFriendlyURL(effectiveRequest.url)}' will not be cached.`, responseToCache);
			return false;
		}
		const { cacheName, matchOptions } = this._strategy;
		const cache = await self.caches.open(cacheName);
		if (process.env.NODE_ENV !== "production") {
			const vary = response.headers.get("Vary");
			if (vary && matchOptions?.ignoreVary !== true) logger.debug(`The response for ${getFriendlyURL(effectiveRequest.url)} has a 'Vary: ${vary}' header. Consider setting the {ignoreVary: true} option on your strategy to ensure cache matching and deletion works as expected.`);
		}
		const hasCacheUpdateCallback = this.hasCallback("cacheDidUpdate");
		const oldResponse = hasCacheUpdateCallback ? await cacheMatchIgnoreParams(cache, effectiveRequest.clone(), ["__WB_REVISION__"], matchOptions) : null;
		if (process.env.NODE_ENV !== "production") logger.debug(`Updating the '${cacheName}' cache with a new Response for ${getFriendlyURL(effectiveRequest.url)}.`);
		try {
			await cache.put(effectiveRequest, hasCacheUpdateCallback ? responseToCache.clone() : responseToCache);
		} catch (error) {
			if (error instanceof Error) {
				if (error.name === "QuotaExceededError") await executeQuotaErrorCallbacks();
				throw error;
			}
		}
		for (const callback of this.iterateCallbacks("cacheDidUpdate")) await callback({
			cacheName,
			oldResponse,
			newResponse: responseToCache.clone(),
			request: effectiveRequest,
			event: this.event
		});
		return true;
	}
	/**
	* Checks the `plugins` provided to the {@linkcode Strategy} object for `cacheKeyWillBeUsed`
	* callbacks and executes found callbacks in sequence. The final `Request`
	* object returned by the last plugin is treated as the cache key for cache
	* reads and/or writes. If no `cacheKeyWillBeUsed` plugin callbacks have
	* been registered, the passed request is returned unmodified.
	*
	* @param request
	* @param mode
	* @returns
	*/
	async getCacheKey(request, mode) {
		const key = `${request.url} | ${mode}`;
		if (!this._cacheKeys[key]) {
			let effectiveRequest = request;
			for (const callback of this.iterateCallbacks("cacheKeyWillBeUsed")) effectiveRequest = toRequest(await callback({
				mode,
				request: effectiveRequest,
				event: this.event,
				params: this.params
			}));
			this._cacheKeys[key] = effectiveRequest;
		}
		return this._cacheKeys[key];
	}
	/**
	* Returns `true` if the strategy has at least one plugin with the given
	* callback.
	*
	* @param name The name of the callback to check for.
	* @returns
	*/
	hasCallback(name) {
		for (const plugin of this._strategy.plugins) if (name in plugin) return true;
		return false;
	}
	/**
	* Runs all plugin callbacks matching the given name, in order, passing the
	* given param object as the only argument.
	*
	* Note: since this method runs all plugins, it's not suitable for cases
	* where the return value of a callback needs to be applied prior to calling
	* the next callback. See {@linkcode StrategyHandler.iterateCallbacks} for how to handle that case.
	*
	* @param name The name of the callback to run within each plugin.
	* @param param The object to pass as the first (and only) param when executing each callback. This object will be merged with the
	* current plugin state prior to callback execution.
	*/
	async runCallbacks(name, param) {
		for (const callback of this.iterateCallbacks(name)) await callback(param);
	}
	/**
	* Accepts a callback name and returns an iterable of matching plugin callbacks.
	*
	* @param name The name fo the callback to run
	* @returns
	*/
	*iterateCallbacks(name) {
		for (const plugin of this._strategy.plugins) if (typeof plugin[name] === "function") {
			const state = this._pluginStateMap.get(plugin);
			const statefulCallback = (param) => {
				const statefulParam = {
					...param,
					state
				};
				return plugin[name](statefulParam);
			};
			yield statefulCallback;
		}
	}
	/**
	* Adds a promise to the
	* [extend lifetime promises](https://w3c.github.io/ServiceWorker/#extendableevent-extend-lifetime-promises)
	* of the event event associated with the request being handled (usually a `FetchEvent`).
	*
	* Note: you can await {@linkcode StrategyHandler.doneWaiting} to know when all added promises have settled.
	*
	* @param promise A promise to add to the extend lifetime promises of
	* the event that triggered the request.
	*/
	waitUntil(promise) {
		this._extendLifetimePromises.push(promise);
		return promise;
	}
	/**
	* Returns a promise that resolves once all promises passed to
	* `this.waitUntil()` have settled.
	*
	* Note: any work done after `doneWaiting()` settles should be manually
	* passed to an event's `waitUntil()` method (not `this.waitUntil()`), otherwise
	* the service worker thread may be killed prior to your work completing.
	*/
	async doneWaiting() {
		let promise;
		while (promise = this._extendLifetimePromises.shift()) await promise;
	}
	/**
	* Stops running the strategy and immediately resolves any pending
	* `waitUntil()` promise.
	*/
	destroy() {
		this._handlerDeferred.resolve(null);
	}
	/**
	* This method checks if the navigation preload `Response` is available.
	*
	* @param request
	* @param event
	* @returns
	*/
	async getPreloadResponse() {
		if (this.event instanceof FetchEvent && this.event.request.mode === "navigate" && "preloadResponse" in this.event) try {
			const possiblePreloadResponse = await this.event.preloadResponse;
			if (possiblePreloadResponse) {
				if (process.env.NODE_ENV !== "production") logger.log(`Using a preloaded navigation response for '${getFriendlyURL(this.event.request.url)}'`);
				return possiblePreloadResponse;
			}
		} catch (error) {
			if (process.env.NODE_ENV !== "production") logger.error(error);
			return;
		}
	}
	/**
	* This method will call `cacheWillUpdate` on the available plugins (or use
	* status === 200) to determine if the response is safe and valid to cache.
	*
	* @param response
	* @returns
	* @private
	*/
	async _ensureResponseSafeToCache(response) {
		let responseToCache = response;
		let pluginsUsed = false;
		for (const callback of this.iterateCallbacks("cacheWillUpdate")) {
			responseToCache = await callback({
				request: this.request,
				response: responseToCache,
				event: this.event
			}) || void 0;
			pluginsUsed = true;
			if (!responseToCache) break;
		}
		if (!pluginsUsed) {
			if (responseToCache && responseToCache.status !== 200) {
				if (process.env.NODE_ENV !== "production") if (responseToCache.status === 0) logger.warn(`The response for '${this.request.url}' is an opaque response. The caching strategy that you're using will not cache opaque responses by default.`);
				else logger.debug(`The response for '${this.request.url}' returned a status code of '${response.status}' and won't be cached as a result.`);
				responseToCache = void 0;
			}
		}
		return responseToCache;
	}
};
//#endregion
//#region src/lib/strategies/Strategy.ts
/**
* Abstract class for implementing runtime caching strategies.
*
* Custom strategies should extend this class and leverage `StrategyHandler`, which will ensure all relevant cache options,
* fetch options, and plugins are used (per the current strategy instance), to perform all fetching and caching logic.
*/
var Strategy = class {
	cacheName;
	plugins;
	fetchOptions;
	matchOptions;
	/**
	* Creates a new instance of the strategy and sets all documented option
	* properties as public instance properties.
	*
	* Note: if a custom strategy class extends the base Strategy class and does
	* not need more than these properties, it does not need to define its own
	* constructor.
	*
	* @param options
	*/
	constructor(options = {}) {
		this.cacheName = cacheNames.getRuntimeName(options.cacheName);
		this.plugins = options.plugins || [];
		this.fetchOptions = options.fetchOptions;
		this.matchOptions = options.matchOptions;
	}
	/**
	* Performs a request strategy and returns a promise that will resolve to
	* a response, invoking all relevant plugin callbacks.
	*
	* When a strategy instance is registered with a route, this method is automatically
	* called when the route matches.
	*
	* Alternatively, this method can be used in a standalone `fetch` event
	* listener by passing it to `event.respondWith()`.
	*
	* @param options A `FetchEvent` or an object with the properties listed below.
	* @param options.request A request to run this strategy for.
	* @param options.event The event associated with the request.
	* @param options.url
	* @param options.params
	*/
	handle(options) {
		const [responseDone] = this.handleAll(options);
		return responseDone;
	}
	/**
	* Similar to `handle()`, but instead of just returning a promise that
	* resolves to a response, it will return an tuple of `[response, done]` promises,
	* where `response` is equivalent to what `handle()` returns, and `done` is a
	* promise that will resolve once all promises added to `event.waitUntil()` as a part
	* of performing the strategy have completed.
	*
	* You can await the `done` promise to ensure any extra work performed by
	* the strategy (usually caching responses) completes successfully.
	*
	* @param options A `FetchEvent` or `HandlerCallbackOptions` object.
	* @returns A tuple of [response, done] promises that can be used to determine when the response resolves as
	* well as when the handler has completed all its work.
	*/
	handleAll(options) {
		if (options instanceof FetchEvent) options = {
			event: options,
			request: options.request
		};
		const event = options.event;
		const request = typeof options.request === "string" ? new Request(options.request) : options.request;
		const handler = new StrategyHandler(this, options.url ? {
			event,
			request,
			url: options.url,
			params: options.params
		} : {
			event,
			request
		});
		const responseDone = this._getResponse(handler, request, event);
		return [responseDone, this._awaitComplete(responseDone, handler, request, event)];
	}
	async _getResponse(handler, request, event) {
		await handler.runCallbacks("handlerWillStart", {
			event,
			request
		});
		let response;
		try {
			response = await this._handle(request, handler);
			if (response === void 0 || response.type === "error") throw new SerwistError("no-response", { url: request.url });
		} catch (error) {
			if (error instanceof Error) for (const callback of handler.iterateCallbacks("handlerDidError")) {
				response = await callback({
					error,
					event,
					request
				});
				if (response !== void 0) break;
			}
			if (!response) throw error;
			if (process.env.NODE_ENV !== "production") throw logger.log(`While responding to '${getFriendlyURL(request.url)}', an ${error instanceof Error ? error.toString() : ""} error occurred. Using a fallback response provided by a handlerDidError plugin.`);
		}
		for (const callback of handler.iterateCallbacks("handlerWillRespond")) response = await callback({
			event,
			request,
			response
		});
		return response;
	}
	async _awaitComplete(responseDone, handler, request, event) {
		let response;
		let error;
		try {
			response = await responseDone;
		} catch {}
		try {
			await handler.runCallbacks("handlerDidRespond", {
				event,
				request,
				response
			});
			await handler.doneWaiting();
		} catch (waitUntilError) {
			if (waitUntilError instanceof Error) error = waitUntilError;
		}
		await handler.runCallbacks("handlerDidComplete", {
			event,
			request,
			response,
			error
		});
		handler.destroy();
		if (error) throw error;
	}
};
//#endregion
//#region src/lib/strategies/utils/messages.ts
const messages = {
	strategyStart: (strategyName, request) => `Using ${strategyName} to respond to '${getFriendlyURL(request.url)}'`,
	printFinalResponse: (response) => {
		if (response) {
			logger.groupCollapsed("View the final response here.");
			logger.log(response || "[No response returned]");
			logger.groupEnd();
		}
	}
};
//#endregion
//#region src/lib/strategies/NetworkFirst.ts
/**
* An implementation of the [network first](https://developer.chrome.com/docs/workbox/caching-strategies-overview/#network_first_falling_back_to_cache)
* request strategy.
*
* By default, this strategy will cache responses with a 200 status code as
* well as [opaque responses](https://developer.chrome.com/docs/workbox/caching-resources-during-runtime/#opaque_responses).
* Opaque responses are are cross-origin requests where the response doesn't
* support [CORS](https://enable-cors.org/).
*
* If the network request fails, and there is no cache match, this will throw
* a {@linkcode SerwistError} exception.
*/
var NetworkFirst = class extends Strategy {
	_networkTimeoutSeconds;
	/**
	* @param options
	* This option can be used to combat
	* "[lie-fi](https://developers.google.com/web/fundamentals/performance/poor-connectivity/#lie-fi)"
	* scenarios.
	*/
	constructor(options = {}) {
		super(options);
		if (!this.plugins.some((p) => "cacheWillUpdate" in p)) this.plugins.unshift(cacheOkAndOpaquePlugin);
		this._networkTimeoutSeconds = options.networkTimeoutSeconds || 0;
		if (process.env.NODE_ENV !== "production") {
			if (this._networkTimeoutSeconds) finalAssertExports.isType(this._networkTimeoutSeconds, "number", {
				moduleName: "serwist",
				className: this.constructor.name,
				funcName: "constructor",
				paramName: "networkTimeoutSeconds"
			});
		}
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
			paramName: "makeRequest"
		});
		const promises = [];
		let timeoutId;
		if (this._networkTimeoutSeconds) {
			const { id, promise } = this._getTimeoutPromise({
				request,
				logs,
				handler
			});
			timeoutId = id;
			promises.push(promise);
		}
		const networkPromise = this._getNetworkPromise({
			timeoutId,
			request,
			logs,
			handler
		});
		promises.push(networkPromise);
		const response = await handler.waitUntil((async () => {
			return await handler.waitUntil(Promise.race(promises)) || await networkPromise;
		})());
		if (process.env.NODE_ENV !== "production") {
			logger.groupCollapsed(messages.strategyStart(this.constructor.name, request));
			for (const log of logs) logger.log(log);
			messages.printFinalResponse(response);
			logger.groupEnd();
		}
		if (!response) throw new SerwistError("no-response", { url: request.url });
		return response;
	}
	/**
	* @param options
	* @returns
	* @private
	*/
	_getTimeoutPromise({ request, logs, handler }) {
		let timeoutId;
		return {
			promise: new Promise((resolve) => {
				const onNetworkTimeout = async () => {
					if (process.env.NODE_ENV !== "production") logs.push(`Timing out the network response at ${this._networkTimeoutSeconds} seconds.`);
					resolve(await handler.cacheMatch(request));
				};
				timeoutId = setTimeout(onNetworkTimeout, this._networkTimeoutSeconds * 1e3);
			}),
			id: timeoutId
		};
	}
	/**
	* @param options
	* @param options.timeoutId
	* @param options.request
	* @param options.logs A reference to the logs Array.
	* @param options.event
	* @returns
	*
	* @private
	*/
	async _getNetworkPromise({ timeoutId, request, logs, handler }) {
		let error;
		let response;
		try {
			response = await handler.fetchAndCachePut(request);
		} catch (fetchError) {
			if (fetchError instanceof Error) error = fetchError;
		}
		if (timeoutId) clearTimeout(timeoutId);
		if (process.env.NODE_ENV !== "production") if (response) logs.push("Got response from network.");
		else logs.push("Unable to get a response from the network. Will respond with a cached response.");
		if (error || !response) {
			response = await handler.cacheMatch(request);
			if (process.env.NODE_ENV !== "production") if (response) logs.push(`Found a cached response in the '${this.cacheName}' cache.`);
			else logs.push(`No response found in the '${this.cacheName}' cache.`);
		}
		return response;
	}
};
//#endregion
//#region src/lib/strategies/NetworkOnly.ts
/**
* An implementation of the [network only](https://developer.chrome.com/docs/workbox/caching-strategies-overview/#network_only)
* request strategy.
*
* This class is useful if you require specific requests to only be fulfilled from the network.
*
* If the network request fails, this will throw a {@linkcode SerwistError} exception.
*/
var NetworkOnly = class extends Strategy {
	_networkTimeoutSeconds;
	/**
	* @param options
	*/
	constructor(options = {}) {
		super(options);
		this._networkTimeoutSeconds = options.networkTimeoutSeconds || 0;
	}
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
			funcName: "_handle",
			paramName: "request"
		});
		let error;
		let response;
		try {
			const promises = [handler.fetch(request)];
			if (this._networkTimeoutSeconds) {
				const timeoutPromise = timeout(this._networkTimeoutSeconds * 1e3);
				promises.push(timeoutPromise);
			}
			response = await Promise.race(promises);
			if (!response) throw new Error(`Timed out the network response after ${this._networkTimeoutSeconds} seconds.`);
		} catch (err) {
			if (err instanceof Error) error = err;
		}
		if (process.env.NODE_ENV !== "production") {
			logger.groupCollapsed(messages.strategyStart(this.constructor.name, request));
			if (response) logger.log("Got response from network.");
			else logger.log("Unable to get a response from the network.");
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
//#region src/constants.ts
/**
* The list of valid HTTP methods associated with requests that could be routed.
*
* @private
*/
const validMethods = [
	"DELETE",
	"GET",
	"HEAD",
	"PATCH",
	"POST",
	"PUT"
];
//#endregion
//#region src/utils/normalizeHandler.ts
/**
* @param handler Either a function, or an object with a
* 'handle' method.
* @returns An object with a handle method.
*
* @private
*/
const normalizeHandler = (handler) => {
	if (handler && typeof handler === "object") {
		if (process.env.NODE_ENV !== "production") finalAssertExports.hasMethod(handler, "handle", {
			moduleName: "serwist",
			className: "Route",
			funcName: "constructor",
			paramName: "handler"
		});
		return handler;
	}
	if (process.env.NODE_ENV !== "production") finalAssertExports.isType(handler, "function", {
		moduleName: "serwist",
		className: "Route",
		funcName: "constructor",
		paramName: "handler"
	});
	return { handle: handler };
};
//#endregion
//#region src/Route.ts
/**
* A `Route` consists of a pair of callback functions, `match` and `handler`.
* The `match` callback determines if a route should be used to handle a
* request by returning a truthy value if it can. The `handler` callback
* is called when the route matches and should return a promise that resolves
* to a response.
*/
var Route = class {
	handler;
	match;
	method;
	catchHandler;
	/**
	* Constructor for Route class.
	*
	* @param match A callback function that determines whether the
	* route matches a given `fetch` event by returning a truthy value.
	* @param handler A callback function that returns a `Promise` resolving
	* to a `Response`.
	* @param method The HTTP method to match the route against. Defaults
	* to `GET`.
	*/
	constructor(match, handler, method = "GET") {
		if (process.env.NODE_ENV !== "production") {
			finalAssertExports.isType(match, "function", {
				moduleName: "serwist",
				className: "Route",
				funcName: "constructor",
				paramName: "match"
			});
			if (method) finalAssertExports.isOneOf(method, validMethods, { paramName: "method" });
		}
		this.handler = normalizeHandler(handler);
		this.match = match;
		this.method = method;
	}
	/**
	*
	* @param handler A callback function that returns a Promise resolving
	* to a Response.
	*/
	setCatchHandler(handler) {
		this.catchHandler = normalizeHandler(handler);
	}
};
//#endregion
//#region src/lib/strategies/PrecacheStrategy.ts
/**
* A {@linkcode Strategy} implementation specifically designed to both cache
* and fetch precached assets.
*
* Note: an instance of this class is created automatically when creating a
* {@linkcode Serwist} instance; it's generally not necessary to create this yourself.
*/
var PrecacheStrategy = class PrecacheStrategy extends Strategy {
	_fallbackToNetwork;
	static defaultPrecacheCacheabilityPlugin = { async cacheWillUpdate({ response }) {
		if (!response || response.status >= 400) return null;
		return response;
	} };
	static copyRedirectedCacheableResponsesPlugin = { async cacheWillUpdate({ response }) {
		return response.redirected ? await copyResponse(response) : response;
	} };
	/**
	* @param options
	*/
	constructor(options = {}) {
		options.cacheName = cacheNames.getPrecacheName(options.cacheName);
		super(options);
		this._fallbackToNetwork = options.fallbackToNetwork !== false;
		this.plugins.push(PrecacheStrategy.copyRedirectedCacheableResponsesPlugin);
	}
	/**
	* @private
	* @param request A request to run this strategy for.
	* @param handler The event that triggered the request.
	* @returns
	*/
	async _handle(request, handler) {
		const preloadResponse = await handler.getPreloadResponse();
		if (preloadResponse) return preloadResponse;
		const response = await handler.cacheMatch(request);
		if (response) return response;
		if (handler.event && handler.event.type === "install") return await this._handleInstall(request, handler);
		return await this._handleFetch(request, handler);
	}
	async _handleFetch(request, handler) {
		let response;
		const params = handler.params || {};
		if (this._fallbackToNetwork) {
			if (process.env.NODE_ENV !== "production") logger.warn(`The precached response for ${getFriendlyURL(request.url)} in ${this.cacheName} was not found. Falling back to the network.`);
			const integrityInManifest = params.integrity;
			const integrityInRequest = request.integrity;
			const noIntegrityConflict = !integrityInRequest || integrityInRequest === integrityInManifest;
			response = await handler.fetch(new Request(request, { integrity: request.mode !== "no-cors" ? integrityInRequest || integrityInManifest : void 0 }));
			if (integrityInManifest && noIntegrityConflict && request.mode !== "no-cors") {
				this._useDefaultCacheabilityPluginIfNeeded();
				const wasCached = await handler.cachePut(request, response.clone());
				if (process.env.NODE_ENV !== "production") {
					if (wasCached) logger.log(`A response for ${getFriendlyURL(request.url)} was used to "repair" the precache.`);
				}
			}
		} else throw new SerwistError("missing-precache-entry", {
			cacheName: this.cacheName,
			url: request.url
		});
		if (process.env.NODE_ENV !== "production") {
			const cacheKey = params.cacheKey || await handler.getCacheKey(request, "read");
			logger.groupCollapsed(`Precaching is responding to: ${getFriendlyURL(request.url)}`);
			logger.log(`Serving the precached url: ${getFriendlyURL(cacheKey instanceof Request ? cacheKey.url : cacheKey)}`);
			logger.groupCollapsed("View request details here.");
			logger.log(request);
			logger.groupEnd();
			logger.groupCollapsed("View response details here.");
			logger.log(response);
			logger.groupEnd();
			logger.groupEnd();
		}
		return response;
	}
	async _handleInstall(request, handler) {
		this._useDefaultCacheabilityPluginIfNeeded();
		const response = await handler.fetch(request);
		if (!await handler.cachePut(request, response.clone())) throw new SerwistError("bad-precaching-response", {
			url: request.url,
			status: response.status
		});
		return response;
	}
	/**
	* This method is complex, as there a number of things to account for:
	*
	* The `plugins` array can be set at construction, and/or it might be added to
	* to at any time before the strategy is used.
	*
	* At the time the strategy is used (i.e. during an `install` event), there
	* needs to be at least one plugin that implements `cacheWillUpdate` in the
	* array, other than `copyRedirectedCacheableResponsesPlugin`.
	*
	* - If this method is called and there are no suitable `cacheWillUpdate`
	* plugins, we need to add `defaultPrecacheCacheabilityPlugin`.
	*
	* - If this method is called and there is exactly one `cacheWillUpdate`, then
	* we don't have to do anything (this might be a previously added
	* `defaultPrecacheCacheabilityPlugin`, or it might be a custom plugin).
	*
	* - If this method is called and there is more than one `cacheWillUpdate`,
	* then we need to check if one is `defaultPrecacheCacheabilityPlugin`. If so,
	* we need to remove it. (This situation is unlikely, but it could happen if
	* the strategy is used multiple times, the first without a `cacheWillUpdate`,
	* and then later on after manually adding a custom `cacheWillUpdate`.)
	*
	* See https://github.com/GoogleChrome/workbox/issues/2737 for more context.
	*
	* @private
	*/
	_useDefaultCacheabilityPluginIfNeeded() {
		let defaultPluginIndex = null;
		let cacheWillUpdatePluginCount = 0;
		for (const [index, plugin] of this.plugins.entries()) {
			if (plugin === PrecacheStrategy.copyRedirectedCacheableResponsesPlugin) continue;
			if (plugin === PrecacheStrategy.defaultPrecacheCacheabilityPlugin) defaultPluginIndex = index;
			if (plugin.cacheWillUpdate) cacheWillUpdatePluginCount++;
		}
		if (cacheWillUpdatePluginCount === 0) this.plugins.push(PrecacheStrategy.defaultPrecacheCacheabilityPlugin);
		else if (cacheWillUpdatePluginCount > 1 && defaultPluginIndex !== null) this.plugins.splice(defaultPluginIndex, 1);
	}
};
//#endregion
//#region src/NavigationRoute.ts
/**
* A class that makes it easy to create a {@linkcode Route} object that matches navigation requests.
*
* It will only match incoming requests whose [`mode`](https://fetch.spec.whatwg.org/#concept-request-mode) is set to `"navigate"`.
*
* You can optionally only apply this route to a subset of navigation requests
* by using one or both of the `denylist` and `allowlist` parameters.
*/
var NavigationRoute = class extends Route {
	_allowlist;
	_denylist;
	/**
	* If both `denylist` and `allowlist` are provided, `denylist` will
	* take precedence.
	*
	* The regular expressions in `allowlist` and `denylist`
	* are matched against the concatenated
	* [`pathname`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLHyperlinkElementUtils/pathname)
	* and [`search`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLHyperlinkElementUtils/search)
	* portions of the requested URL.
	*
	* *Note*: These RegExps may be evaluated against every destination URL during
	* a navigation. Avoid using
	* [complex RegExps](https://github.com/GoogleChrome/workbox/issues/3077),
	* or else your users may see delays when navigating your site.
	*
	* @param handler A callback function that returns a `Promise` resulting in a `Response`.
	* @param options
	*/
	constructor(handler, { allowlist = [/./], denylist = [] } = {}) {
		if (process.env.NODE_ENV !== "production") {
			finalAssertExports.isArrayOfClass(allowlist, RegExp, {
				moduleName: "serwist",
				className: "NavigationRoute",
				funcName: "constructor",
				paramName: "options.allowlist"
			});
			finalAssertExports.isArrayOfClass(denylist, RegExp, {
				moduleName: "serwist",
				className: "NavigationRoute",
				funcName: "constructor",
				paramName: "options.denylist"
			});
		}
		super((options) => this._match(options), handler);
		this._allowlist = allowlist;
		this._denylist = denylist;
	}
	/**
	* Routes match handler.
	*
	* @param options
	* @returns
	* @private
	*/
	_match({ url, request }) {
		if (request && request.mode !== "navigate") return false;
		const pathnameAndSearch = url.pathname + url.search;
		for (const regExp of this._denylist) if (regExp.test(pathnameAndSearch)) {
			if (process.env.NODE_ENV !== "production") logger.log(`The navigation route ${pathnameAndSearch} is not being used, since the URL matches this denylist pattern: ${regExp.toString()}`);
			return false;
		}
		if (this._allowlist.some((regExp) => regExp.test(pathnameAndSearch))) {
			if (process.env.NODE_ENV !== "production") logger.debug(`The navigation route ${pathnameAndSearch} is being used.`);
			return true;
		}
		if (process.env.NODE_ENV !== "production") logger.log(`The navigation route ${pathnameAndSearch} is not being used, since the URL being navigated to doesn't match the allowlist.`);
		return false;
	}
};
//#endregion
//#region src/navigationPreload.ts
/**
* Checks whether the current browser supports
* navigation preloading.
*
* @returns
* @see https://serwist.pages.dev/docs/serwist/core/is-navigation-preload-supported
*/
const isNavigationPreloadSupported = () => {
	return Boolean(self.registration?.navigationPreload);
};
/**
* If the browser supports navigation preloading, then this will enable it.
*
* @param headerValue Optional. Allows developers to override the value of
* the `Service-Worker-Navigation-Preload` header which will be sent to the
* server when making the navigation request.
* @see https://serwist.pages.dev/docs/serwist/core/enable-navigation-preload
*/
const enableNavigationPreload = (headerValue) => {
	if (isNavigationPreloadSupported()) self.addEventListener("activate", (event) => {
		event.waitUntil(self.registration.navigationPreload.enable().then(() => {
			if (headerValue) self.registration.navigationPreload.setHeaderValue(headerValue);
			if (process.env.NODE_ENV !== "production") logger.log("Navigation preloading is enabled.");
		}));
	});
	else if (process.env.NODE_ENV !== "production") logger.log("Navigation preloading is not supported in this browser.");
};
/**
* If the browser supports navigation preloading, then this will disable it.
*
* @see https://serwist.pages.dev/docs/serwist/core/disable-navigation-preload
*/
const disableNavigationPreload = () => {
	if (isNavigationPreloadSupported()) self.addEventListener("activate", (event) => {
		event.waitUntil(self.registration.navigationPreload.disable().then(() => {
			if (process.env.NODE_ENV !== "production") logger.log("Navigation preloading is disabled.");
		}));
	});
	else if (process.env.NODE_ENV !== "production") logger.log("Navigation preloading is not supported in this browser.");
};
//#endregion
//#region src/utils/removeIgnoredSearchParams.ts
/**
* Removes any URL search parameters that should be ignored.
*
* @param urlObject The original URL.
* @param ignoreURLParametersMatching RegExps to test against
* each search parameter name. Matches mean that the search parameter should be
* ignored.
* @returns The URL with any ignored search parameters removed.
* @private
*/
const removeIgnoredSearchParams = (urlObject, ignoreURLParametersMatching = []) => {
	for (const paramName of [...urlObject.searchParams.keys()]) if (ignoreURLParametersMatching.some((regExp) => regExp.test(paramName))) urlObject.searchParams.delete(paramName);
	return urlObject;
};
//#endregion
//#region src/utils/generateURLVariations.ts
/**
* Generator function that yields possible variations on the original URL to
* check, one at a time.
*
* @param url
* @param options
*
* @private
*/
function* generateURLVariations(url, { directoryIndex = "index.html", ignoreURLParametersMatching = [/^utm_/, /^fbclid$/], cleanURLs = true, urlManipulation } = {}) {
	const urlObject = new URL(url, location.href);
	urlObject.hash = "";
	yield urlObject.href;
	const urlWithoutIgnoredParams = removeIgnoredSearchParams(urlObject, ignoreURLParametersMatching);
	yield urlWithoutIgnoredParams.href;
	if (directoryIndex && urlWithoutIgnoredParams.pathname.endsWith("/")) {
		const directoryURL = new URL(urlWithoutIgnoredParams.href);
		directoryURL.pathname += directoryIndex;
		yield directoryURL.href;
	}
	if (cleanURLs) {
		const cleanURL = new URL(urlWithoutIgnoredParams.href);
		cleanURL.pathname += ".html";
		yield cleanURL.href;
	}
	if (urlManipulation) {
		const additionalURLs = urlManipulation({ url: urlObject });
		for (const urlToAttempt of additionalURLs) yield urlToAttempt.href;
	}
}
//#endregion
//#region src/RegExpRoute.ts
/**
* A class that makes it easy to create a {@linkcode Route} object with a regular expression.
*
* For same-origin requests the `RegExp` only needs to match part of the URL. For
* requests against third-party servers, you must define a `RegExp` that matches
* the start of the URL.
*/
var RegExpRoute = class extends Route {
	/**
	* If the regular expression contains
	* [capture groups](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp#grouping-back-references),
	* the captured values will be passed to the `params` argument.
	*
	* @param regExp The regular expression to match against URLs.
	* @param handler A callback function that returns a `Promise` resulting in a `Response`.
	* @param method The HTTP method to match the {@linkcode Route} against. Defaults to `GET`.
	* against.
	*/
	constructor(regExp, handler, method) {
		if (process.env.NODE_ENV !== "production") finalAssertExports.isInstance(regExp, RegExp, {
			moduleName: "serwist",
			className: "RegExpRoute",
			funcName: "constructor",
			paramName: "pattern"
		});
		const match = ({ url }) => {
			const result = regExp.exec(url.href);
			if (!result) return;
			if (url.origin !== location.origin && result.index !== 0) {
				if (process.env.NODE_ENV !== "production") logger.debug(`The regular expression '${regExp.toString()}' only partially matched against the cross-origin URL '${url.toString()}'. RegExpRoute's will only handle cross-origin requests if they match the entire URL.`);
				return;
			}
			return result.slice(1);
		};
		super(match, handler, method);
	}
};
//#endregion
//#region src/setCacheNameDetails.ts
/**
* Modifies the default cache names used by Serwist packages.
* Cache names are generated as `<prefix>-<Cache Name>-<suffix>`.
*
* @param details
*/
const setCacheNameDetails = (details) => {
	if (process.env.NODE_ENV !== "production") {
		for (const key of Object.keys(details)) finalAssertExports.isType(details[key], "string", {
			moduleName: "@serwist/core",
			funcName: "setCacheNameDetails",
			paramName: `details.${key}`
		});
		if (details.precache?.length === 0) throw new SerwistError("invalid-cache-name", {
			cacheNameId: "precache",
			value: details.precache
		});
		if (details.runtime?.length === 0) throw new SerwistError("invalid-cache-name", {
			cacheNameId: "runtime",
			value: details.runtime
		});
		if (details.googleAnalytics?.length === 0) throw new SerwistError("invalid-cache-name", {
			cacheNameId: "googleAnalytics",
			value: details.googleAnalytics
		});
	}
	cacheNames.updateDetails(details);
};
//#endregion
//#region src/utils/createCacheKey.ts
const REVISION_SEARCH_PARAM = "__WB_REVISION__";
/**
* Converts a manifest entry into a versioned URL suitable for precaching.
*
* @param entry
* @returns A URL with versioning info.
*
* @private
*/
const createCacheKey = (entry) => {
	if (!entry) throw new SerwistError("add-to-cache-list-unexpected-type", { entry });
	if (typeof entry === "string") {
		const urlObject = new URL(entry, location.href);
		return {
			cacheKey: urlObject.href,
			url: urlObject.href
		};
	}
	const { revision, url } = entry;
	if (!url) throw new SerwistError("add-to-cache-list-unexpected-type", { entry });
	if (!revision) {
		const urlObject = new URL(url, location.href);
		return {
			cacheKey: urlObject.href,
			url: urlObject.href
		};
	}
	const cacheKeyURL = new URL(url, location.href);
	const originalURL = new URL(url, location.href);
	cacheKeyURL.searchParams.set(REVISION_SEARCH_PARAM, revision);
	return {
		cacheKey: cacheKeyURL.href,
		url: originalURL.href
	};
};
//#endregion
//#region src/utils/PrecacheInstallReportPlugin.ts
/**
* A plugin designed to determine the number of assets that were updated (or not updated)
* during the `install` event.
*
* @private
*/
var PrecacheInstallReportPlugin = class {
	updatedURLs = [];
	notUpdatedURLs = [];
	handlerWillStart = async ({ request, state }) => {
		if (state) state.originalRequest = request;
	};
	cachedResponseWillBeUsed = async ({ event, state, cachedResponse }) => {
		if (event.type === "install") {
			if (state?.originalRequest && state.originalRequest instanceof Request) {
				const url = state.originalRequest.url;
				if (cachedResponse) this.notUpdatedURLs.push(url);
				else this.updatedURLs.push(url);
			}
		}
		return cachedResponse;
	};
};
//#endregion
//#region src/utils/parseRoute.ts
/**
* Parses a `RegExp`, string, or function with a caching strategy into a {@linkcode Route}. This is for
* when you want to create a {@linkcode Route}, but you don't want to register it just yet: sometimes
* you want to call {@linkcode Route.setCatchHandler} first, for example.
*
* @param capture If the capture param is a {@linkcode Route} object, all other arguments will be ignored.
* @param handler A callback function that returns a promise resulting in a response.
* This parameter is required if `capture` is not a {@linkcode Route} object.
* @param method The HTTP method to match the route against. Defaults to `'GET'`.
* @returns The generated {@linkcode Route}.
*/
const parseRoute = (capture, handler, method) => {
	if (typeof capture === "string") {
		const captureUrl = new URL(capture, location.href);
		if (process.env.NODE_ENV !== "production") {
			if (!(capture.startsWith("/") || capture.startsWith("http"))) throw new SerwistError("invalid-string", {
				moduleName: "serwist",
				funcName: "parseRoute",
				paramName: "capture"
			});
			const valueToCheck = capture.startsWith("http") ? captureUrl.pathname : capture;
			const wildcards = "[*:?+]";
			if (new RegExp(`${wildcards}`).exec(valueToCheck)) logger.debug(`The '$capture' parameter contains an Express-style wildcard character (${wildcards}). Strings are now always interpreted as exact matches; use a RegExp for partial or wildcard matches.`);
		}
		const matchCallback = ({ url }) => {
			if (process.env.NODE_ENV !== "production") {
				if (url.pathname === captureUrl.pathname && url.origin !== captureUrl.origin) logger.debug(`${capture} only partially matches the cross-origin URL ${url.toString()}. This route will only handle cross-origin requests if they match the entire URL.`);
			}
			return url.href === captureUrl.href;
		};
		return new Route(matchCallback, handler, method);
	}
	if (capture instanceof RegExp) return new RegExpRoute(capture, handler, method);
	if (typeof capture === "function") return new Route(capture, handler, method);
	if (capture instanceof Route) return capture;
	throw new SerwistError("unsupported-route-type", {
		moduleName: "serwist",
		funcName: "parseRoute",
		paramName: "capture"
	});
};
//#endregion
//#region src/utils/printCleanupDetails.ts
/**
* @param groupTitle
* @param deletedURLs
*
* @private
*/
const logGroup = (groupTitle, deletedURLs) => {
	logger.groupCollapsed(groupTitle);
	for (const url of deletedURLs) logger.log(url);
	logger.groupEnd();
};
/**
* @param deletedURLs
* @private
*/
const printCleanupDetails = (deletedURLs) => {
	const deletionCount = deletedURLs.length;
	if (deletionCount > 0) {
		logger.groupCollapsed(`During precaching cleanup, ${deletionCount} cached request${deletionCount === 1 ? " was" : "s were"} deleted.`);
		logGroup("Deleted Cache Requests", deletedURLs);
		logger.groupEnd();
	}
};
//#endregion
//#region src/utils/printInstallDetails.ts
/**
* @param groupTitle
* @param urls
*
* @private
*/
function _nestedGroup(groupTitle, urls) {
	if (urls.length === 0) return;
	logger.groupCollapsed(groupTitle);
	for (const url of urls) logger.log(url);
	logger.groupEnd();
}
/**
* @param urlsToPrecache
* @param  urlsAlreadyPrecached
* @private
*/
const printInstallDetails = (urlsToPrecache, urlsAlreadyPrecached) => {
	const precachedCount = urlsToPrecache.length;
	const alreadyPrecachedCount = urlsAlreadyPrecached.length;
	if (precachedCount || alreadyPrecachedCount) {
		let message = `Precaching ${precachedCount} file${precachedCount === 1 ? "" : "s"}.`;
		if (alreadyPrecachedCount > 0) message += ` ${alreadyPrecachedCount} file${alreadyPrecachedCount === 1 ? " is" : "s are"} already cached.`;
		logger.groupCollapsed(message);
		_nestedGroup("View newly precached URLs.", urlsToPrecache);
		_nestedGroup("View previously precached URLs.", urlsAlreadyPrecached);
		logger.groupEnd();
	}
};
//#endregion
export { BackgroundSyncQueue as C, copyResponse as D, disableDevLogs as E, BackgroundSyncPlugin as S, BackgroundSyncQueueStore as T, NetworkFirst as _, createCacheKey as a, StrategyHandler as b, generateURLVariations as c, isNavigationPreloadSupported as d, NavigationRoute as f, NetworkOnly as g, normalizeHandler as h, PrecacheInstallReportPlugin as i, disableNavigationPreload as l, Route as m, printCleanupDetails as n, setCacheNameDetails as o, PrecacheStrategy as p, parseRoute as r, RegExpRoute as s, printInstallDetails as t, enableNavigationPreload as u, messages as v, StorableRequest as w, cacheOkAndOpaquePlugin as x, Strategy as y };

//# sourceMappingURL=printInstallDetails-ESDOoMBE.js.map