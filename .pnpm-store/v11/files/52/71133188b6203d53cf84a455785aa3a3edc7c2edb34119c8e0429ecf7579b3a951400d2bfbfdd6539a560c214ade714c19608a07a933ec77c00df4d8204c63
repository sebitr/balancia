import { $ as StrategyOptions, A as MaybePromise, B as RouteHandler, C as HandlerWillStartCallback, D as ManualHandlerCallback, E as InstallResult, F as RequestRule, G as RouteMatchCallbackOptions, H as RouteHandlerCallbackOptions, I as RequestRuleCondition, J as SerwistPlugin, K as RuntimeCaching, L as RequestRuleSource, M as PrecacheEntry, N as PrecacheOptions, O as ManualHandlerCallbackOptions, P as PrecacheRouteOptions, Q as Strategy, R as RequestWillFetchCallback, S as HandlerWillRespondCallbackParam, T as InstallEvent, U as RouteHandlerObject, V as RouteHandlerCallback, W as RouteMatchCallback, X as UrlManipulation, Y as SerwistPluginCallbackParam, Z as PrecacheStrategy, _ as HandlerDidErrorCallback, a as CacheWillUpdateCallback, b as HandlerDidRespondCallbackParam, c as CachedResponseWillBeUsedCallbackParam, d as FetchDidFailCallbackParam, et as StrategyHandler, f as FetchDidSucceedCallback, g as HandlerDidCompleteCallbackParam, h as HandlerDidCompleteCallback, i as CacheKeyWillBeUsedCallbackParam, j as PluginState, k as MapLikeObject, l as CleanupResult, m as HandlerCallbackOptions, n as CacheDidUpdateCallbackParam, o as CacheWillUpdateCallbackParam, p as FetchDidSucceedCallbackParam, q as SerwistGlobalConfig, r as CacheKeyWillBeUsedCallback, s as CachedResponseWillBeUsedCallback, t as CacheDidUpdateCallback, tt as HTTPMethod, u as FetchDidFailCallback, v as HandlerDidErrorCallbackParam, w as HandlerWillStartCallbackParam, x as HandlerWillRespondCallback, y as HandlerDidRespondCallback, z as RequestWillFetchCallbackParam } from "./chunks/types-BB8lYSAv.js";
import { t as Route } from "./chunks/Route-BfRIuMhK.js";
import { t as PartialCacheNameDetails } from "./chunks/cacheNames-DlxxHRul.js";
//#region src/cacheNames.d.ts
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
declare const cacheNames: {
  readonly googleAnalytics: string;
  readonly precache: string;
  readonly prefix: string;
  readonly runtime: string;
  readonly suffix: string;
};
//#endregion
//#region src/copyResponse.d.ts
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
declare const copyResponse: (response: Response, modifier?: (responseInit: ResponseInit) => ResponseInit) => Promise<Response>;
//#endregion
//#region src/disableDevLogs.d.ts
/**
 * Disables Serwist's logging in development mode.
 *
 * @see https://serwist.pages.dev/docs/serwist/core/disable-dev-logs
 */
declare const disableDevLogs$1: () => void;
//#endregion
//#region src/lib/backgroundSync/BackgroundSyncQueue.d.ts
interface SyncManager {
  getTags(): Promise<string[]>;
  register(tag: string): Promise<void>;
}
declare global {
  interface ServiceWorkerRegistration {
    readonly sync: SyncManager;
  }
  interface SyncEvent extends ExtendableEvent {
    readonly lastChance: boolean;
    readonly tag: string;
  }
  interface ServiceWorkerGlobalScopeEventMap {
    sync: SyncEvent;
  }
}
interface OnSyncCallbackOptions {
  queue: BackgroundSyncQueue;
}
type OnSyncCallback = (options: OnSyncCallbackOptions) => void | Promise<void>;
interface BackgroundSyncQueueOptions {
  /**
   * If `true`, instead of attempting to use background sync events, always attempt
   * to replay queued request at service worker startup. Most folks will not need
   * this, unless you explicitly target a runtime like Electron that exposes the
   * interfaces for background sync, but does not have a working implementation.
   *
   * @default false
   */
  forceSyncFallback?: boolean;
  /**
   * The amount of time (in minutes) a request may be retried. After this amount
   * of time has passed, the request will be deleted from the queue.
   *
   * @default 60 * 24 * 7
   */
  maxRetentionTime?: number;
  /**
   * A function that gets invoked whenever the 'sync' event fires. The function
   * is invoked with an object containing the `queue` property (referencing this
   * instance), and you can use the callback to customize the replay behavior of
   * the queue. When not set the `replayRequests()` method is called. Note: if the
   * replay fails after a sync event, make sure you throw an error, so the browser
   * knows to retry the sync event later.
   */
  onSync?: OnSyncCallback;
}
interface BackgroundSyncQueueEntry {
  /**
   * The request to store in the queue.
   */
  request: Request;
  /**
   * The timestamp (Epoch time in milliseconds) when the request was first added
   * to the queue. This is used along with `maxRetentionTime` to remove outdated
   * requests. In general you don't need to set this value, as it's automatically
   * set for you (defaulting to `Date.now()`), but you can update it if you don't
   * want particular requests to expire.
   */
  timestamp?: number;
  /**
   * Any metadata you want associated with the stored request. When requests are
   * replayed you'll have access to this metadata object in case you need to modify
   * the request beforehand.
   */
  metadata?: Record<string, unknown>;
}
/**
 * A class to manage storing failed requests in IndexedDB and retrying them
 * later. All parts of the storing and replaying process are observable via
 * callbacks.
 */
declare class BackgroundSyncQueue {
  private readonly _name;
  private readonly _onSync;
  private readonly _maxRetentionTime;
  private readonly _queueStore;
  private readonly _forceSyncFallback;
  private _syncInProgress;
  private _requestsAddedDuringSync;
  /**
   * Creates an instance of Queue with the given options
   *
   * @param name The unique name for this queue. This name must be
   * unique as it's used to register sync events and store requests
   * in IndexedDB specific to this instance. An error will be thrown if
   * a duplicate name is detected.
   * @param options
   */
  constructor(name: string, { forceSyncFallback, onSync, maxRetentionTime }?: BackgroundSyncQueueOptions);
  /**
   * @returns
   */
  get name(): string;
  /**
   * Stores the passed request in IndexedDB (with its timestamp and any
   * metadata) at the end of the queue.
   *
   * @param entry
   */
  pushRequest(entry: BackgroundSyncQueueEntry): Promise<void>;
  /**
   * Stores the passed request in IndexedDB (with its timestamp and any
   * metadata) at the beginning of the queue.
   *
   * @param entry
   */
  unshiftRequest(entry: BackgroundSyncQueueEntry): Promise<void>;
  /**
   * Removes and returns the last request in the queue (along with its
   * timestamp and any metadata).
   *
   * @returns
   */
  popRequest(): Promise<BackgroundSyncQueueEntry | undefined>;
  /**
   * Removes and returns the first request in the queue (along with its
   * timestamp and any metadata).
   *
   * @returns
   */
  shiftRequest(): Promise<BackgroundSyncQueueEntry | undefined>;
  /**
   * Returns all the entries that have not expired (per `maxRetentionTime`).
   * Any expired entries are removed from the queue.
   *
   * @returns
   */
  getAll(): Promise<BackgroundSyncQueueEntry[]>;
  /**
   * Returns the number of entries present in the queue.
   * Note that expired entries (per `maxRetentionTime`) are also included in this count.
   *
   * @returns
   */
  size(): Promise<number>;
  /**
   * Adds the entry to the QueueStore and registers for a sync event.
   *
   * @param entry
   * @param operation
   * @private
   */
  _addRequest({ request, metadata, timestamp }: BackgroundSyncQueueEntry, operation: "push" | "unshift"): Promise<void>;
  /**
   * Removes and returns the first or last (depending on `operation`) entry
   * from the {@linkcode BackgroundSyncQueueStore} that's not older than the `maxRetentionTime`.
   *
   * @param operation
   * @returns
   * @private
   */
  _removeRequest(operation: "pop" | "shift"): Promise<BackgroundSyncQueueEntry | undefined>;
  /**
   * Loops through each request in the queue and attempts to re-fetch it.
   * If any request fails to re-fetch, it's put back in the same position in
   * the queue (which registers a retry for the next sync event).
   */
  replayRequests(): Promise<void>;
  /**
   * Registers a sync event with a tag unique to this instance.
   */
  registerSync(): Promise<void>;
  /**
   * In sync-supporting browsers, this adds a listener for the sync event.
   * In non-sync-supporting browsers, or if _forceSyncFallback is true, this
   * will retry the queue on service worker startup.
   *
   * @private
   */
  private _addSyncListener;
  /**
   * Returns the set of queue names. This is primarily used to reset the list
   * of queue names in tests.
   *
   * @returns
   * @private
   */
  static get _queueNames(): Set<string>;
}
//#endregion
//#region src/lib/backgroundSync/BackgroundSyncPlugin.d.ts
/**
 * A class implementing the `fetchDidFail` lifecycle callback. This makes it
 * easier to add failed requests to a {@linkcode BackgroundSyncQueue}.
 */
declare class BackgroundSyncPlugin implements SerwistPlugin {
  private readonly _queue;
  /**
   * @param name See the {@linkcode BackgroundSyncQueue}
   * documentation for parameter details.
   * @param options See the {@linkcode BackgroundSyncQueue}
   * documentation for parameter details.
   * @see https://serwist.pages.dev/docs/serwist/core/background-sync-queue
   */
  constructor(name: string, options?: BackgroundSyncQueueOptions);
  /**
   * @param options
   * @private
   */
  fetchDidFail({ request }: FetchDidFailCallbackParam): Promise<void>;
}
//#endregion
//#region src/lib/backgroundSync/StorableRequest.d.ts
interface RequestData extends MapLikeObject {
  url: string;
  headers: MapLikeObject;
  body?: ArrayBuffer;
}
/**
 * A class to make it easier to serialize and de-serialize requests so they
 * can be stored in IndexedDB.
 *
 * Most developers will not need to access this class directly;
 * it is exposed for advanced use cases.
 */
declare class StorableRequest {
  private readonly _requestData;
  /**
   * Converts a Request object to a plain object that can be structured
   * cloned or stringified to JSON.
   *
   * @param request
   * @returns
   */
  static fromRequest(request: Request): Promise<StorableRequest>;
  /**
   * Accepts an object of request data that can be used to construct a
   * `Request` object but can also be stored in IndexedDB.
   *
   * @param requestData An object of request data that includes the `url` plus any relevant property of
   * [`requestInit`](https://fetch.spec.whatwg.org/#requestinit).
   */
  constructor(requestData: RequestData);
  /**
   * Returns a deep clone of the instance's `requestData` object.
   *
   * @returns
   */
  toObject(): RequestData;
  /**
   * Converts this instance to a Request.
   *
   * @returns
   */
  toRequest(): Request;
  /**
   * Creates and returns a deep clone of the instance.
   *
   * @returns
   */
  clone(): StorableRequest;
}
//#endregion
//#region src/lib/backgroundSync/BackgroundSyncQueueDb.d.ts
interface UnidentifiedQueueStoreEntry {
  requestData: RequestData;
  timestamp: number;
  id?: number;
  queueName?: string;
  metadata?: Record<string, unknown>;
}
interface BackgroundSyncQueueStoreEntry extends UnidentifiedQueueStoreEntry {
  id: number;
}
//#endregion
//#region src/lib/backgroundSync/BackgroundSyncQueueStore.d.ts
/**
 * A class to manage storing requests from a Queue in IndexedDB,
 * indexed by their queue name for easier access.
 *
 * Most developers will not need to access this class directly;
 * it is exposed for advanced use cases.
 */
declare class BackgroundSyncQueueStore {
  private readonly _queueName;
  private readonly _queueDb;
  /**
   * Associates this instance with a Queue instance, so entries added can be
   * identified by their queue name.
   *
   * @param queueName
   */
  constructor(queueName: string);
  /**
   * Append an entry last in the queue.
   *
   * @param entry
   */
  pushEntry(entry: UnidentifiedQueueStoreEntry): Promise<void>;
  /**
   * Prepend an entry first in the queue.
   *
   * @param entry
   */
  unshiftEntry(entry: UnidentifiedQueueStoreEntry): Promise<void>;
  /**
   * Removes and returns the last entry in the queue matching the `queueName`.
   *
   * @returns
   */
  popEntry(): Promise<BackgroundSyncQueueStoreEntry | undefined>;
  /**
   * Removes and returns the first entry in the queue matching the `queueName`.
   *
   * @returns
   */
  shiftEntry(): Promise<BackgroundSyncQueueStoreEntry | undefined>;
  /**
   * Returns all entries in the store matching the `queueName`.
   *
   * @returns
   */
  getAll(): Promise<BackgroundSyncQueueStoreEntry[]>;
  /**
   * Returns the number of entries in the store matching the `queueName`.
   *
   * @returns
   */
  size(): Promise<number>;
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
  deleteEntry(id: number): Promise<void>;
  /**
   * Removes and returns the first or last entry in the queue (based on the
   * `direction` argument) matching the `queueName`.
   *
   * @returns
   * @private
   */
  _removeEntry(entry?: BackgroundSyncQueueStoreEntry): Promise<BackgroundSyncQueueStoreEntry | undefined>;
}
//#endregion
//#region src/lib/broadcastUpdate/constants.d.ts
declare const BROADCAST_UPDATE_MESSAGE_TYPE = "CACHE_UPDATED";
declare const BROADCAST_UPDATE_MESSAGE_META = "serwist-broadcast-update";
declare const BROADCAST_UPDATE_DEFAULT_HEADERS: string[];
//#endregion
//#region src/lib/broadcastUpdate/types.d.ts
interface BroadcastCacheUpdateOptions {
  /**
   * A list of headers that will be used to determine whether the responses
   * differ.
   *
   * @default
   * ['content-length', 'etag', 'last-modified']`
   */
  headersToCheck?: string[];
  /**
   * A function whose return value
   * will be used as the `payload` field in any cache update messages sent
   * to the window clients.
   * @param options
   * @returns
   */
  generatePayload?: (options: CacheDidUpdateCallbackParam) => Record<string, any>;
  /**
   * If `true` (the default) then all open clients will receive a message. If `false`,
   * then only the client that make the original request will be notified of the update.
   *
   * @default true
   */
  notifyAllClients?: boolean;
}
type BroadcastPayload = Record<string, any>;
type BroadcastPayloadGenerator = (options: CacheDidUpdateCallbackParam) => BroadcastPayload;
interface BroadcastMessage {
  type: typeof BROADCAST_UPDATE_MESSAGE_TYPE;
  meta: typeof BROADCAST_UPDATE_MESSAGE_META;
  payload: BroadcastPayload;
}
//#endregion
//#region src/lib/broadcastUpdate/BroadcastCacheUpdate.d.ts
/**
 * A class that uses the `postMessage()` API to inform any open windows/tabs when
 * a cached response has been updated.
 *
 * For efficiency's sake, the underlying response bodies are not compared;
 * only specific response headers are checked.
 */
declare class BroadcastCacheUpdate {
  private readonly _headersToCheck;
  private readonly _generatePayload;
  private readonly _notifyAllClients;
  /**
   * Construct an instance of `BroadcastCacheUpdate`.
   *
   * @param options
   */
  constructor({ generatePayload, headersToCheck, notifyAllClients }?: BroadcastCacheUpdateOptions);
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
  notifyIfUpdated(options: CacheDidUpdateCallbackParam): Promise<void>;
}
//#endregion
//#region src/lib/broadcastUpdate/BroadcastUpdatePlugin.d.ts
/**
 * A class implementing the `cacheDidUpdate` lifecycle callback. It will automatically
 * broadcast a message whenever a cached response is updated.
 */
declare class BroadcastUpdatePlugin implements SerwistPlugin {
  private readonly _broadcastUpdate;
  /**
   * Construct a {@linkcode BroadcastCacheUpdate} instance with
   * the passed options and calls its {@linkcode BroadcastCacheUpdate.notifyIfUpdated}
   * method whenever the plugin's {@linkcode BroadcastUpdatePlugin.cacheDidUpdate} callback
   * is invoked.
   *
   * @param options
   */
  constructor(options?: BroadcastCacheUpdateOptions);
  /**
   * @private
   * @param options The input object to this function.
   */
  cacheDidUpdate(options: CacheDidUpdateCallbackParam): void;
}
//#endregion
//#region src/lib/broadcastUpdate/responsesAreSame.d.ts
/**
 * Given two responses, compares several header values to see if they are
 * the same or not.
 *
 * @param firstResponse The first response.
 * @param secondResponse The second response.
 * @param headersToCheck A list of headers to check.
 * @returns
 */
declare const responsesAreSame: (firstResponse: Response, secondResponse: Response, headersToCheck: string[]) => boolean;
//#endregion
//#region src/lib/cacheableResponse/CacheableResponse.d.ts
interface CacheableResponseOptions {
  /**
   * One or more HTTP status codes that a response can have to be considered cacheable.
   */
  statuses?: number[];
  /**
   * A mapping of header names and expected values that a response can have and be
   * considered cacheable. If multiple headers are provided, only one needs to be present.
   */
  headers?: HeadersInit;
}
/**
 * Allows you to set up rules determining what status codes and/or headers need
 * to be present in order for a [response](https://developer.mozilla.org/en-US/docs/Web/API/Response)
 * to be considered cacheable.
 */
declare class CacheableResponse {
  private readonly _statuses?;
  private readonly _headers?;
  /**
   * To construct a new `CacheableResponse` instance you must provide at least
   * one of the `config` properties.
   *
   * If both `statuses` and `headers` are specified, then both conditions must
   * be met for the response to be considered cacheable.
   *
   * @param config
   */
  constructor(config?: CacheableResponseOptions);
  /**
   * Checks a response to see whether it's cacheable or not.
   *
   * @param response The response whose cacheability is being
   * checked.
   * @returns `true` if the response is cacheable, and `false`
   * otherwise.
   */
  isResponseCacheable(response: Response): boolean;
}
//#endregion
//#region src/lib/cacheableResponse/CacheableResponsePlugin.d.ts
/**
 * A class implementing the `cacheWillUpdate` lifecycle callback. This makes it
 * easier to add in cacheability checks to requests made via Serwist's built-in
 * strategies.
 */
declare class CacheableResponsePlugin implements SerwistPlugin {
  private readonly _cacheableResponse;
  /**
   * To construct a new `CacheableResponsePlugin` instance you must provide at
   * least one of the `config` properties.
   *
   * If both `statuses` and `headers` are specified, then both conditions must
   * be met for the response to be considered cacheable.
   *
   * @param config
   */
  constructor(config: CacheableResponseOptions);
  /**
   * @param options
   * @returns
   * @private
   */
  cacheWillUpdate: SerwistPlugin["cacheWillUpdate"];
}
//#endregion
//#region src/lib/expiration/CacheExpiration.d.ts
interface CacheExpirationConfig {
  /**
   * The maximum number of entries to cache. Entries used least recently will
   * be removed as the maximum is reached.
   */
  maxEntries?: number;
  /**
   * The maximum age of an entry before it's treated as stale and removed.
   */
  maxAgeSeconds?: number;
  /**
   * The [`CacheQueryOptions`](https://developer.mozilla.org/en-US/docs/Web/API/Cache/delete#Parameters)
   * that will be used when calling `delete()` on the cache.
   */
  matchOptions?: CacheQueryOptions;
}
/**
 * Allows you to expires cached responses based on age or maximum number of entries.
 * @see https://serwist.pages.dev/docs/serwist/core/cache-expiration
 */
declare class CacheExpiration {
  private _isRunning;
  private _rerunRequested;
  private readonly _maxEntries?;
  private readonly _maxAgeSeconds?;
  private readonly _matchOptions?;
  private readonly _cacheName;
  private readonly _timestampModel;
  /**
   * To construct a new `CacheExpiration` instance you must provide at least
   * one of the `config` properties.
   *
   * @param cacheName Name of the cache to apply restrictions to.
   * @param config
   */
  constructor(cacheName: string, config?: CacheExpirationConfig);
  /**
   * Expires entries for the given cache and given criteria.
   */
  expireEntries(): Promise<void>;
  /**
   * Updates the timestamp for the given URL, allowing it to be correctly
   * tracked by the class.
   *
   * @param url
   */
  updateTimestamp(url: string): Promise<void>;
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
  isURLExpired(url: string): Promise<boolean>;
  /**
   * Removes the IndexedDB used to keep track of cache expiration metadata.
   */
  delete(): Promise<void>;
}
//#endregion
//#region src/lib/expiration/ExpirationPlugin.d.ts
interface ExpirationPluginOptions {
  /**
   * The maximum number of entries to cache. Entries used (if `maxAgeFrom` is
   * `"last-used"`) or fetched from the network (if `maxAgeFrom` is `"last-fetched"`)
   * least recently will be removed as the maximum is reached.
   */
  maxEntries?: number;
  /**
   * The maximum number of seconds before an entry is treated as stale and removed.
   */
  maxAgeSeconds?: number;
  /**
   * Determines whether `maxAgeSeconds` should be calculated from when an
   * entry was last fetched or when it was last used.
   *
   * @default "last-fetched"
   */
  maxAgeFrom?: "last-fetched" | "last-used";
  /**
   * The [`CacheQueryOptions`](https://developer.mozilla.org/en-US/docs/Web/API/Cache/delete#Parameters)
   * that will be used when calling `delete()` on the cache.
   */
  matchOptions?: CacheQueryOptions;
  /**
   * Whether to opt this cache into automatic deletion if the available storage quota has been exceeded.
   */
  purgeOnQuotaError?: boolean;
}
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
declare class ExpirationPlugin implements SerwistPlugin {
  private readonly _config;
  private _cacheExpirations;
  /**
   * @param config
   */
  constructor(config?: ExpirationPluginOptions);
  /**
   * A simple helper method to return a CacheExpiration instance for a given
   * cache name.
   *
   * @param cacheName
   * @returns
   * @private
   */
  private _getCacheExpiration;
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
  cachedResponseWillBeUsed({ event, cacheName, request, cachedResponse }: CachedResponseWillBeUsedCallbackParam): Response | null;
  /**
   * @param cachedResponse
   * @returns
   * @private
   */
  private _isResponseDateFresh;
  /**
   * Extracts the `Date` header and parse it into an useful value.
   *
   * @param cachedResponse
   * @returns
   * @private
   */
  private _getDateHeaderTimestamp;
  /**
   * A lifecycle callback that will be triggered automatically when an entry is added
   * to a cache.
   *
   * @param options
   * @private
   */
  cacheDidUpdate({ cacheName, request }: CacheDidUpdateCallbackParam): Promise<void>;
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
  deleteCacheAndMetadata(): Promise<void>;
}
//#endregion
//#region src/lib/precaching/PrecacheFallbackPlugin.d.ts
interface PrecacheFallbackEntry {
  /**
   * A precached URL to be used as a fallback.
   */
  url: string;
  /**
   * A function that checks whether the fallback entry can be used
   * for a request.
   */
  matcher: (param: HandlerDidErrorCallbackParam) => boolean;
}
interface PrecacheFallbackPluginOptions {
  /**
   * Precached URLs to be used as the fallback
   * if the associated strategy can't generate a response.
   */
  fallbackUrls: (string | PrecacheFallbackEntry)[];
  /**
   * A {@linkcode Serwist} instance.
   */
  serwist: Serwist;
}
/**
 * Allows you to specify offline fallbacks to be used when a given strategy
 * is unable to generate a response.
 *
 * It does this by intercepting the `handlerDidError` plugin callback
 * and returning a precached response, taking the expected revision parameter
 * into account automatically.
 */
declare class PrecacheFallbackPlugin implements SerwistPlugin {
  private readonly _fallbackUrls;
  private readonly _serwist;
  /**
   * Constructs a new instance with the associated `fallbackUrls`.
   *
   * @param config
   */
  constructor({ fallbackUrls, serwist }: PrecacheFallbackPluginOptions);
  /**
   * @returns The precache response for one of the fallback URLs, or `undefined` if
   * nothing satisfies the conditions.
   * @private
   */
  handlerDidError(param: HandlerDidErrorCallbackParam): Promise<Response | undefined>;
}
//#endregion
//#region src/Serwist.d.ts
interface FallbackEntry extends PrecacheFallbackEntry {}
interface FallbacksOptions {
  /**
   * A list of fallback entries.
   */
  entries: FallbackEntry[];
}
interface SerwistOptions {
  /**
   * A list of URLs that should be cached.
   */
  precacheEntries?: (PrecacheEntry | string)[];
  /**
   * Options to customize how Serwist precaches the URLs in the precache list.
   */
  precacheOptions?: PrecacheOptions;
  /**
   * Forces the waiting service worker to become the active one.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting
   */
  skipWaiting?: boolean;
  /**
   * Imports external scripts. They are executed in the order they
   * are passed.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/importScripts
   */
  importScripts?: string[];
  /**
   * Enables navigation preloading if it is supported.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/navigationPreload
   */
  navigationPreload?: boolean;
  /**
   * Modifies the prefix of the default cache names used by Serwist packages.
   */
  cacheId?: string | undefined;
  /**
   * Claims any currently available clients once the service worker
   * becomes active. This is normally used in conjunction with `skipWaiting()`.
   *
   * @default false
   */
  clientsClaim?: boolean;
  /**
   * A list of caching strategies.
   */
  runtimeCaching?: RuntimeCaching[];
  /**
   * Request rules that define how certain resources should be fetched
   * before the service worker starts up.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes
   * @experimental
   */
  requestRules?: RequestRule | RequestRule[];
  /**
   * Your configuration for {@linkcode initializeGoogleAnalytics}. This plugin is
   * only initialized when this option is not `undefined` or `false`.
   */
  offlineAnalyticsConfig?: Omit<GoogleAnalyticsInitializeOptions, "serwist"> | boolean;
  /**
   * Disables Serwist's logging in development mode.
   *
   * @default false
   */
  disableDevLogs?: boolean;
  /**
   * Precaches routes so that they can be used as a fallback when
   * a {@linkcode Strategy} fails to generate a response.
   *
   * Note: This option mutates `runtimeCaching`. It also expects the URLs
   * defined in `entries` to have been precached beforehand.
   */
  fallbacks?: FallbacksOptions;
}
/**
 * A class that helps bootstrap the service worker.
 *
 * @see https://serwist.pages.dev/docs/serwist/core/serwist
 */
declare class Serwist {
  private readonly _urlsToCacheKeys;
  private readonly _urlsToCacheModes;
  private readonly _cacheKeysToIntegrities;
  private _concurrentPrecaching;
  private readonly _precacheStrategy;
  private readonly _routes;
  private readonly _defaultHandlerMap;
  private _catchHandler?;
  private _requestRules?;
  constructor({ precacheEntries, precacheOptions, skipWaiting, importScripts, navigationPreload, cacheId, clientsClaim, runtimeCaching, offlineAnalyticsConfig, disableDevLogs, fallbacks, requestRules }?: SerwistOptions);
  /**
   * The strategy used to precache assets and respond to `fetch` events.
   */
  get precacheStrategy(): Strategy;
  /**
   * A `Map` of HTTP method name (`'GET'`, etc.) to an array of all corresponding registered {@linkcode Route}
   * instances.
   */
  get routes(): Map<HTTPMethod, Route[]>;
  /**
   * Adds Serwist's event listeners for you. Before calling it, add your own listeners should you need to.
   */
  addEventListeners(): void;
  /**
   * Adds items to the precache list, removing duplicates and ensuring the information is valid.
   *
   * @param entries Array of entries to precache.
   */
  addToPrecacheList(entries: (PrecacheEntry | string)[]): void;
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
  handleInstall(event: InstallEvent): Promise<InstallResult>;
  /**
   * Registers request rules using the experimental `InstallEvent.addRoutes()` API.
   * These rules allow bypassing the service worker for specific requests to improve performance.
   *
   * @param event The event object of an `install` event handler.
   * @throws {Error} When the route rules are invalid
   */
  registerRequestRules(event: InstallEvent): Promise<void>;
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
  handleActivate(event: ExtendableEvent): Promise<CleanupResult>;
  /**
   * Gets a `Response` from an appropriate `Route`'s handler. Call this method
   * from the service worker's `fetch` event.
   * @param event
   */
  handleFetch(event: FetchEvent): void;
  /**
   * Caches new URLs on demand. Call this method from the service worker's
   * `message` event. To trigger the handler, send a message of type `"CACHE_URLS"`
   * alongside a list of URLs that should be cached as `urlsToCache`.
   * @param event
   */
  handleCache(event: ExtendableMessageEvent): void;
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
  setDefaultHandler(handler: RouteHandler, method?: HTTPMethod): void;
  /**
   * If a {@linkcode Route} throws an error while handling a request, this handler
   * will be called and given a chance to provide a response.
   *
   * @param handler A callback function that returns a `Promise` resulting
   * in a `Response`.
   */
  setCatchHandler(handler: RouteHandler): void;
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
  registerCapture<T extends RegExp | string | RouteMatchCallback | Route>(capture: T, handler?: T extends Route ? never : RouteHandler, method?: T extends Route ? never : HTTPMethod): Route;
  /**
   * Registers a {@linkcode Route} with the router.
   *
   * @param route The {@linkcode Route} to register.
   */
  registerRoute(route: Route): void;
  /**
   * Unregisters a route from the router.
   *
   * @param route The {@linkcode Route} object to unregister.
   */
  unregisterRoute(route: Route): void;
  /**
   * Returns a mapping of a precached URL to the corresponding cache key, taking
   * into account the revision information for the URL.
   *
   * @returns A URL to cache key mapping.
   */
  getUrlsToPrecacheKeys(): Map<string, string>;
  /**
   * Returns a list of all the URLs that have been precached by the current
   * service worker.
   *
   * @returns The precached URLs.
   */
  getPrecachedUrls(): string[];
  /**
   * Returns the cache key used for storing a given URL. If that URL is
   * unversioned, like "/index.html", then the cache key will be the original
   * URL with a search parameter appended to it.
   *
   * @param url A URL whose cache key you want to look up.
   * @returns The versioned URL that corresponds to a cache key
   * for the original URL, or undefined if that URL isn't precached.
   */
  getPrecacheKeyForUrl(url: string): string | undefined;
  /**
   * @param url A cache key whose SRI you want to look up.
   * @returns The subresource integrity associated with the cache key,
   * or undefined if it's not set.
   */
  getIntegrityForPrecacheKey(cacheKey: string): string | undefined;
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
  matchPrecache(request: string | Request): Promise<Response | undefined>;
  /**
   * Returns a function that looks up `url` in the precache (taking into
   * account revision information), and returns the corresponding `Response`.
   *
   * @param url The precached URL which will be used to lookup the response.
   * @return
   */
  createHandlerBoundToUrl(url: string): RouteHandlerCallback;
  /**
   * Applies the routing rules to a `FetchEvent` object to get a response from an
   * appropriate route.
   *
   * @param options
   * @returns A promise is returned if a registered route can handle the request.
   * If there is no matching route and there's no default handler, `undefined`
   * is returned.
   */
  handleRequest({ request, event }: {
    /**
     * The request to handle.
     */
    request: Request;
    /**
     * The event that triggered the request.
     */
    event: ExtendableEvent;
  }): Promise<Response> | undefined;
  /**
   * Checks a request and URL (and optionally an event) against the list of
   * registered routes, and if there's a match, returns the corresponding
   * route along with any params generated by the match.
   *
   * @param options
   * @returns An object with `route` and `params` properties. They are populated
   * if a matching route was found or `undefined` otherwise.
   */
  findMatchingRoute({ url, sameOrigin, request, event }: RouteMatchCallbackOptions): {
    route?: Route;
    params?: RouteHandlerCallbackOptions["params"];
  };
}
//#endregion
//#region src/lib/googleAnalytics/initializeGoogleAnalytics.d.ts
interface GoogleAnalyticsInitializeOptions {
  serwist: Serwist;
  /**
   * The cache name to store and retrieve analytics.js. Defaults to Serwist's default cache names.
   */
  cacheName?: string;
  /**
   * [Measurement Protocol parameters](https://developers.google.com/analytics/devguides/collection/protocol/v1/parameters),
   * expressed as key/value pairs, to be added to replayed Google Analytics
   * requests. This can be used to, e.g., set a custom dimension indicating
   * that the request was replayed.
   */
  parameterOverrides?: {
    [paramName: string]: string;
  };
  /**
   * A function that allows you to modify the hit parameters prior to replaying
   * the hit. The function is invoked with the original hit's URLSearchParams
   * object as its only argument.
   */
  hitFilter?: (params: URLSearchParams) => void;
}
/**
 * Initialize Serwist's offline Google Analytics v3 support.
 *
 * @param options
 */
declare const initializeGoogleAnalytics: ({ serwist, cacheName, ...options }: GoogleAnalyticsInitializeOptions) => void;
//#endregion
//#region src/lib/rangeRequests/createPartialResponse.d.ts
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
declare const createPartialResponse: (request: Request, originalResponse: Response) => Promise<Response>;
//#endregion
//#region src/lib/rangeRequests/RangeRequestsPlugin.d.ts
/**
 * Makes it easy for a request with a `Range` header to be fulfilled by a cached response.
 *
 * It does this by intercepting the `cachedResponseWillBeUsed` plugin callback
 * and returning the appropriate subset of the cached response body.
 */
declare class RangeRequestsPlugin implements SerwistPlugin {
  /**
   * @param options
   * @returns If request contains a `Range` header, then a
   * partial response whose body is a subset of `cachedResponse` is
   * returned. Otherwise, `cachedResponse` is returned as-is.
   * @private
   */
  cachedResponseWillBeUsed: SerwistPlugin["cachedResponseWillBeUsed"];
}
//#endregion
//#region src/lib/strategies/CacheFirst.d.ts
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
declare class CacheFirst extends Strategy {
  /**
   * @private
   * @param request A request to run this strategy for.
   * @param handler The event that triggered the request.
   * @returns
   */
  _handle(request: Request, handler: StrategyHandler): Promise<Response>;
}
//#endregion
//#region src/lib/strategies/CacheOnly.d.ts
/**
 * An implementation of the [cache only](https://developer.chrome.com/docs/workbox/caching-strategies-overview/#cache_only)
 * request strategy.
 *
 * This class is useful if you already have your own precaching step.
 *
 * If there is no cache match, this will throw a {@linkcode SerwistError} exception.
 */
declare class CacheOnly extends Strategy {
  /**
   * @private
   * @param request A request to run this strategy for.
   * @param handler The event that triggered the request.
   * @returns
   */
  _handle(request: Request, handler: StrategyHandler): Promise<Response>;
}
//#endregion
//#region src/lib/strategies/NetworkFirst.d.ts
interface NetworkFirstOptions extends StrategyOptions {
  /**
   * If set, any network requests that fail to respond within the timeout will fallback to the cache.
   */
  networkTimeoutSeconds?: number;
}
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
declare class NetworkFirst extends Strategy {
  private readonly _networkTimeoutSeconds;
  /**
   * @param options
   * This option can be used to combat
   * "[lie-fi](https://developers.google.com/web/fundamentals/performance/poor-connectivity/#lie-fi)"
   * scenarios.
   */
  constructor(options?: NetworkFirstOptions);
  /**
   * @private
   * @param request A request to run this strategy for.
   * @param handler The event that triggered the request.
   * @returns
   */
  _handle(request: Request, handler: StrategyHandler): Promise<Response>;
  /**
   * @param options
   * @returns
   * @private
   */
  private _getTimeoutPromise;
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
  _getNetworkPromise({ timeoutId, request, logs, handler }: {
    request: Request;
    logs: any[];
    timeoutId?: number;
    handler: StrategyHandler;
  }): Promise<Response | undefined>;
}
//#endregion
//#region src/lib/strategies/NetworkOnly.d.ts
interface NetworkOnlyOptions extends Omit<StrategyOptions, "cacheName" | "matchOptions"> {
  /**
   * If set, any network requests that fail to respond within the timeout will result in a network error.
   */
  networkTimeoutSeconds?: number;
}
/**
 * An implementation of the [network only](https://developer.chrome.com/docs/workbox/caching-strategies-overview/#network_only)
 * request strategy.
 *
 * This class is useful if you require specific requests to only be fulfilled from the network.
 *
 * If the network request fails, this will throw a {@linkcode SerwistError} exception.
 */
declare class NetworkOnly extends Strategy {
  private readonly _networkTimeoutSeconds;
  /**
   * @param options
   */
  constructor(options?: NetworkOnlyOptions);
  /**
   * @private
   * @param request A request to run this strategy for.
   * @param handler The event that triggered the request.
   * @returns
   */
  _handle(request: Request, handler: StrategyHandler): Promise<Response>;
}
//#endregion
//#region src/lib/strategies/StaleWhileRevalidate.d.ts
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
declare class StaleWhileRevalidate extends Strategy {
  /**
   * @param options
   */
  constructor(options?: StrategyOptions);
  /**
   * @private
   * @param request A request to run this strategy for.
   * @param handler The event that triggered the request.
   * @returns
   */
  _handle(request: Request, handler: StrategyHandler): Promise<Response>;
}
//#endregion
//#region src/NavigationRoute.d.ts
interface NavigationRouteMatchOptions {
  /**
   * If any of these patterns
   * match the URL's pathname and search parameter, the route will handle the
   * request (assuming the denylist doesn't match).
   *
   * @default [/./]
   */
  allowlist?: RegExp[];
  /**
   * If any of these patterns match, the route will not handle the request (even if a allowlist RegExp matches).
   */
  denylist?: RegExp[];
}
/**
 * A class that makes it easy to create a {@linkcode Route} object that matches navigation requests.
 *
 * It will only match incoming requests whose [`mode`](https://fetch.spec.whatwg.org/#concept-request-mode) is set to `"navigate"`.
 *
 * You can optionally only apply this route to a subset of navigation requests
 * by using one or both of the `denylist` and `allowlist` parameters.
 */
declare class NavigationRoute extends Route {
  private readonly _allowlist;
  private readonly _denylist;
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
  constructor(handler: RouteHandler, { allowlist, denylist }?: NavigationRouteMatchOptions);
  /**
   * Routes match handler.
   *
   * @param options
   * @returns
   * @private
   */
  private _match;
}
//#endregion
//#region src/navigationPreload.d.ts
/**
 * Checks whether the current browser supports
 * navigation preloading.
 *
 * @returns
 * @see https://serwist.pages.dev/docs/serwist/core/is-navigation-preload-supported
 */
declare const isNavigationPreloadSupported: () => boolean;
/**
 * If the browser supports navigation preloading, then this will enable it.
 *
 * @param headerValue Optional. Allows developers to override the value of
 * the `Service-Worker-Navigation-Preload` header which will be sent to the
 * server when making the navigation request.
 * @see https://serwist.pages.dev/docs/serwist/core/enable-navigation-preload
 */
declare const enableNavigationPreload: (headerValue?: string) => void;
/**
 * If the browser supports navigation preloading, then this will disable it.
 *
 * @see https://serwist.pages.dev/docs/serwist/core/disable-navigation-preload
 */
declare const disableNavigationPreload: () => void;
//#endregion
//#region src/PrecacheRoute.d.ts
/**
 * A subclass of {@linkcode Route} that takes a {@linkcode Serwist} instance and uses it to match
 * incoming requests and handle fetching responses from the precache.
 */
declare class PrecacheRoute extends Route {
  /**
   * @param serwist A {@linkcode Serwist} instance.
   * @param options Options to control how requests are matched
   * against the list of precached URLs.
   */
  constructor(serwist: Serwist, options?: PrecacheRouteOptions);
}
//#endregion
//#region src/RegExpRoute.d.ts
/**
 * A class that makes it easy to create a {@linkcode Route} object with a regular expression.
 *
 * For same-origin requests the `RegExp` only needs to match part of the URL. For
 * requests against third-party servers, you must define a `RegExp` that matches
 * the start of the URL.
 */
declare class RegExpRoute extends Route {
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
  constructor(regExp: RegExp, handler: RouteHandler, method?: HTTPMethod);
}
//#endregion
//#region src/registerQuotaErrorCallback.d.ts
/**
 * Adds a function to the set of quotaErrorCallbacks that will be executed if
 * there's a quota error.
 *
 * @param callback
 */
declare const registerQuotaErrorCallback: (callback: Function) => void;
//#endregion
//#region src/setCacheNameDetails.d.ts
/**
 * Modifies the default cache names used by Serwist packages.
 * Cache names are generated as `<prefix>-<Cache Name>-<suffix>`.
 *
 * @param details
 */
declare const setCacheNameDetails: (details: PartialCacheNameDetails) => void;
//#endregion
export { BROADCAST_UPDATE_DEFAULT_HEADERS, BackgroundSyncPlugin, BackgroundSyncQueue, type BackgroundSyncQueueEntry, type BackgroundSyncQueueOptions, BackgroundSyncQueueStore, BroadcastCacheUpdate, type BroadcastCacheUpdateOptions, type BroadcastMessage, type BroadcastPayload, type BroadcastPayloadGenerator, BroadcastUpdatePlugin, type CacheDidUpdateCallback, type CacheDidUpdateCallbackParam, CacheExpiration, CacheFirst, type CacheKeyWillBeUsedCallback, type CacheKeyWillBeUsedCallbackParam, CacheOnly, type CacheWillUpdateCallback, type CacheWillUpdateCallbackParam, CacheableResponse, type CacheableResponseOptions, CacheableResponsePlugin, type CachedResponseWillBeUsedCallback, type CachedResponseWillBeUsedCallbackParam, type CleanupResult, ExpirationPlugin, type ExpirationPluginOptions, type FetchDidFailCallback, type FetchDidFailCallbackParam, type FetchDidSucceedCallback, type FetchDidSucceedCallbackParam, type GoogleAnalyticsInitializeOptions, type HTTPMethod, type HandlerCallbackOptions, type HandlerDidCompleteCallback, type HandlerDidCompleteCallbackParam, type HandlerDidErrorCallback, type HandlerDidErrorCallbackParam, type HandlerDidRespondCallback, type HandlerDidRespondCallbackParam, type HandlerWillRespondCallback, type HandlerWillRespondCallbackParam, type HandlerWillStartCallback, type HandlerWillStartCallbackParam, type InstallEvent, type InstallResult, type ManualHandlerCallback, type ManualHandlerCallbackOptions, type MapLikeObject, NavigationRoute, type NavigationRouteMatchOptions, NetworkFirst, type NetworkFirstOptions, NetworkOnly, type NetworkOnlyOptions, type PluginState, type PrecacheEntry, type PrecacheFallbackEntry, PrecacheFallbackPlugin, type PrecacheFallbackPluginOptions, type PrecacheOptions, PrecacheRoute, type PrecacheRouteOptions, PrecacheStrategy, type MaybePromise as PromiseOrNot, RangeRequestsPlugin, RegExpRoute, type RequestRule, type RequestRuleCondition, type RequestRuleSource, type RequestWillFetchCallback, type RequestWillFetchCallbackParam, Route, type RouteHandler, type RouteHandlerCallback, type RouteHandlerCallbackOptions, type RouteHandlerObject, type RouteMatchCallback, type RouteMatchCallbackOptions, type RuntimeCaching, Serwist, type SerwistGlobalConfig, type SerwistOptions, type SerwistPlugin, type SerwistPluginCallbackParam, StaleWhileRevalidate, StorableRequest, Strategy, StrategyHandler, type StrategyOptions, type UrlManipulation, cacheNames, copyResponse, createPartialResponse, disableDevLogs$1 as disableDevLogs, disableNavigationPreload, enableNavigationPreload, initializeGoogleAnalytics, isNavigationPreloadSupported, registerQuotaErrorCallback, responsesAreSame, setCacheNameDetails };
//# sourceMappingURL=index.d.mts.map