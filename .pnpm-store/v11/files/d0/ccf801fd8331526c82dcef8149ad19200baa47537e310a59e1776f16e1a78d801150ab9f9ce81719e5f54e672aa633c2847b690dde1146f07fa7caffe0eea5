import { MaybePromise } from "@serwist/utils";
//#region src/constants.d.ts
type HTTPMethod = "DELETE" | "GET" | "HEAD" | "PATCH" | "POST" | "PUT" | "OPTIONS";
//#endregion
//#region src/lib/strategies/StrategyHandler.d.ts
/**
 * A class created every time a {@linkcode Strategy} instance calls {@linkcode Strategy.handle} or
 * {@linkcode Strategy.handleAll} that wraps all fetch and cache actions around plugin callbacks
 * and keeps track of when the strategy is "done" (i.e. when all added `event.waitUntil()` promises
 * have resolved).
 */
declare class StrategyHandler {
  /**
   * The event associated with this request.
   */
  event: ExtendableEvent;
  /**
   * The request the strategy is processing (passed to the strategy's
   * `handle()` or `handleAll()` method).
   */
  request: Request;
  /**
   * A `URL` instance of `request.url` (if passed to the strategy's
   * `handle()` or `handleAll()` method).
   * Note: the `url` param will be present if the strategy is invoked
   * from a {@linkcode Route} object.
   */
  url?: URL;
  /**
   * Some additional params (if passed to the strategy's
   * `handle()` or `handleAll()` method).
   *
   * Note: the `params` param will be present if the strategy is invoked
   * from a {@linkcode Route} object and that route's matcher returned a truthy
   * value (it will be that value).
   */
  params?: string[] | MapLikeObject;
  private _cacheKeys;
  private readonly _strategy;
  private readonly _handlerDeferred;
  private readonly _extendLifetimePromises;
  private readonly _plugins;
  private readonly _pluginStateMap;
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
  constructor(strategy: Strategy, options: HandlerCallbackOptions & {
    request: HandlerCallbackOptions["request"] & Request;
  });
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
  fetch(input: RequestInfo): Promise<Response>;
  /**
   * Calls `this.fetch()` and (in the background) caches the generated response.
   *
   * The call to `this.cachePut()` automatically invokes `this.waitUntil()`,
   * so you do not have to call `waitUntil()` yourself.
   *
   * @param input The request or URL to fetch and cache.
   * @returns
   */
  fetchAndCachePut(input: RequestInfo): Promise<Response>;
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
  cacheMatch(key: RequestInfo): Promise<Response | undefined>;
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
  cachePut(key: RequestInfo, response: Response): Promise<boolean>;
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
  getCacheKey(request: Request, mode: "read" | "write"): Promise<Request>;
  /**
   * Returns `true` if the strategy has at least one plugin with the given
   * callback.
   *
   * @param name The name of the callback to check for.
   * @returns
   */
  hasCallback<C extends keyof SerwistPlugin>(name: C): boolean;
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
  runCallbacks<C extends keyof NonNullable<SerwistPlugin>>(name: C, param: Omit<SerwistPluginCallbackParam[C], "state">): Promise<void>;
  /**
   * Accepts a callback name and returns an iterable of matching plugin callbacks.
   *
   * @param name The name fo the callback to run
   * @returns
   */
  iterateCallbacks<C extends keyof SerwistPlugin>(name: C): Generator<NonNullable<SerwistPlugin[C]>>;
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
  waitUntil<T>(promise: Promise<T>): Promise<T>;
  /**
   * Returns a promise that resolves once all promises passed to
   * `this.waitUntil()` have settled.
   *
   * Note: any work done after `doneWaiting()` settles should be manually
   * passed to an event's `waitUntil()` method (not `this.waitUntil()`), otherwise
   * the service worker thread may be killed prior to your work completing.
   */
  doneWaiting(): Promise<void>;
  /**
   * Stops running the strategy and immediately resolves any pending
   * `waitUntil()` promise.
   */
  destroy(): void;
  /**
   * This method checks if the navigation preload `Response` is available.
   *
   * @param request
   * @param event
   * @returns
   */
  getPreloadResponse(): Promise<Response | undefined>;
  /**
   * This method will call `cacheWillUpdate` on the available plugins (or use
   * status === 200) to determine if the response is safe and valid to cache.
   *
   * @param response
   * @returns
   * @private
   */
  _ensureResponseSafeToCache(response: Response): Promise<Response | undefined>;
}
//#endregion
//#region src/lib/strategies/Strategy.d.ts
interface StrategyOptions {
  /**
   * Cache name to store and retrieve requests. Defaults to Serwist's default cache names.
   */
  cacheName?: string;
  /**
   * [Plugins](https://serwist.pages.dev/docs/serwist/runtime-caching/plugins) to use in conjunction with this caching strategy.
   */
  plugins?: SerwistPlugin[];
  /**
   * Options passed to [non-navigation](https://github.com/GoogleChrome/workbox/issues/1796) `fetch()` calls made by
   * this strategy.
   */
  fetchOptions?: RequestInit;
  /**
   * The [`CacheQueryOptions`](https://w3c.github.io/ServiceWorker/#dictdef-cachequeryoptions)
   * passed to any `cache.match()` or `cache.put()` call made by this strategy.
   */
  matchOptions?: CacheQueryOptions;
}
/**
 * Abstract class for implementing runtime caching strategies.
 *
 * Custom strategies should extend this class and leverage `StrategyHandler`, which will ensure all relevant cache options,
 * fetch options, and plugins are used (per the current strategy instance), to perform all fetching and caching logic.
 */
declare abstract class Strategy implements RouteHandlerObject {
  cacheName: string;
  plugins: SerwistPlugin[];
  fetchOptions?: RequestInit;
  matchOptions?: CacheQueryOptions;
  protected abstract _handle(request: Request, handler: StrategyHandler): Promise<Response | undefined>;
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
  constructor(options?: StrategyOptions);
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
  handle(options: FetchEvent | HandlerCallbackOptions): Promise<Response>;
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
  handleAll(options: FetchEvent | HandlerCallbackOptions): [Promise<Response>, Promise<void>];
  _getResponse(handler: StrategyHandler, request: Request, event: ExtendableEvent): Promise<Response>;
  _awaitComplete(responseDone: Promise<Response>, handler: StrategyHandler, request: Request, event: ExtendableEvent): Promise<void>;
}
//#endregion
//#region src/lib/strategies/PrecacheStrategy.d.ts
interface PrecacheStrategyOptions extends StrategyOptions {
  /**
   * Plugins to use when precaching as well as responding to `fetch` events for precached assets.
   */
  plugins?: StrategyOptions["plugins"];
  /**
   * Whether to attempt to get the response from the network
   * if there's a precache miss.
   */
  fallbackToNetwork?: boolean;
}
/**
 * A {@linkcode Strategy} implementation specifically designed to both cache
 * and fetch precached assets.
 *
 * Note: an instance of this class is created automatically when creating a
 * {@linkcode Serwist} instance; it's generally not necessary to create this yourself.
 */
declare class PrecacheStrategy extends Strategy {
  private readonly _fallbackToNetwork;
  static readonly defaultPrecacheCacheabilityPlugin: SerwistPlugin;
  static readonly copyRedirectedCacheableResponsesPlugin: SerwistPlugin;
  /**
   * @param options
   */
  constructor(options?: PrecacheStrategyOptions);
  /**
   * @private
   * @param request A request to run this strategy for.
   * @param handler The event that triggered the request.
   * @returns
   */
  _handle(request: Request, handler: StrategyHandler): Promise<Response>;
  _handleFetch(request: Request, handler: StrategyHandler): Promise<Response>;
  _handleInstall(request: Request, handler: StrategyHandler): Promise<Response>;
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
  _useDefaultCacheabilityPluginIfNeeded(): void;
}
//#endregion
//#region src/types.d.ts
interface MapLikeObject {
  [key: string]: any;
}
/**
 * Using a plain {@linkcode MapLikeObject} for now, but could extend/restrict this
 * in the future.
 */
type PluginState = MapLikeObject;
/**
 * Options passed to a {@linkcode RouteMatchCallback} function.
 */
interface RouteMatchCallbackOptions {
  event: ExtendableEvent;
  request: Request;
  sameOrigin: boolean;
  url: URL;
}
/**
 * The match callback is used to determine if a route should apply for a
 * particular URL and request.
 *
 * When matching occurs in response to a `fetch` event from the client, the `event`
 * object is also supplied. However, since the match callback can be invoked outside
 * of a `fetch` event, matching logic should not assume the `event` object will always
 * be available.
 *
 * If the match callback returns a truthy value, the matching route's
 * handler will be invoked immediately. If the value returned is a non-empty array
 * or object, that value will be the handler's `options.params` argument.
 */
type RouteMatchCallback = (options: RouteMatchCallbackOptions) => any;
/**
 * Options passed to a {@linkcode RouteHandlerCallback} function.
 */
interface RouteHandlerCallbackOptions {
  /**
   * The event associated with the request.
   */
  event: ExtendableEvent;
  /**
   * A request to run this strategy for.
   */
  request: Request;
  url: URL;
  params?: string[] | MapLikeObject;
}
/**
 * Options passed to a {@linkcode ManualHandlerCallback} function.
 */
interface ManualHandlerCallbackOptions {
  /**
   * The event associated with the request.
   */
  event: ExtendableEvent;
  /**
   * A request to run this strategy for.
   */
  request: Request | string;
  url?: never;
  /**
   * The return value from {@linkcode RouteMatchCallback} (if applicable).
   */
  params?: never;
}
type HandlerCallbackOptions = RouteHandlerCallbackOptions | ManualHandlerCallbackOptions;
/**
 * The "handler" callback is invoked whenever a request is matched to a
 * {@linkcode Route} via its {@linkcode RouteMatchCallback} This handler
 * callback should return a promise that resolves to a response.
 *
 * If a non-empty array or object is returned by the matcher, it
 * will be passed in as this handler's `options.params` argument.
 */
type RouteHandlerCallback = (options: RouteHandlerCallbackOptions) => Promise<Response>;
/**
 * The "handler" callback is invoked whenever a request is matched to a
 * {@linkcode Route} via its {@linkcode RouteMatchCallback} This handler
 * callback should return a promise that resolves to a response.
 *
 * If a non-empty array or object is returned by the matcher, it
 * will be passed in as this handler's `options.params` argument.
 */
type ManualHandlerCallback = (options: ManualHandlerCallbackOptions) => Promise<Response>;
/**
 * An object with a `handle` method of type {@linkcode RouteHandlerCallback}.
 *
 * A {@linkcode Route} object can be created with either an `RouteHandlerCallback`
 * function or this {@linkcode RouteHandler} object.
 */
interface RouteHandlerObject {
  handle: RouteHandlerCallback;
}
/**
 * Either a {@linkcode RouteHandlerCallback} or a {@linkcode RouteHandlerObject}.
 * Most APIs that accept route handlers take either.
 */
type RouteHandler = RouteHandlerCallback | RouteHandlerObject;
interface HandlerWillStartCallbackParam {
  request: Request;
  event: ExtendableEvent;
  state?: PluginState;
}
type HandlerWillStartCallback = (param: HandlerWillStartCallbackParam) => Promise<any>;
interface CacheDidUpdateCallbackParam {
  /**
   * Name of the cache the responses belong to. This is included in the
   * broadcast message.
   */
  cacheName: string;
  /**
   * The possibly updated response.
   */
  newResponse: Response;
  /**
   * The request for the cached entry.
   */
  request: Request;
  /**
   * The event that triggered this possible cache update.
   */
  event: ExtendableEvent;
  /**
   * The previous cached response.
   */
  oldResponse?: Response | null;
  state?: PluginState;
}
type CacheDidUpdateCallback = (param: CacheDidUpdateCallbackParam) => MaybePromise<any>;
interface CacheKeyWillBeUsedCallbackParam {
  mode: string;
  request: Request;
  event: ExtendableEvent;
  params?: any;
  state?: PluginState;
}
type CacheKeyWillBeUsedCallback = (param: CacheKeyWillBeUsedCallbackParam) => MaybePromise<Request | string>;
interface CacheWillUpdateCallbackParam {
  request: Request;
  response: Response;
  event: ExtendableEvent;
  state?: PluginState;
}
type CacheWillUpdateCallback = (param: CacheWillUpdateCallbackParam) => MaybePromise<any>;
interface CachedResponseWillBeUsedCallbackParam {
  /**
   * Name of the cache the response is in.
   */
  cacheName: string;
  /**
   * The original request, which may or may not
   * contain a Range: header.
   */
  request: Request;
  /**
   * The complete cached `Response` object that's been read
   * from a cache and whose freshness should be checked.
   */
  cachedResponse?: Response;
  event: ExtendableEvent;
  matchOptions?: CacheQueryOptions;
  state?: PluginState;
}
type CachedResponseWillBeUsedCallback = (param: CachedResponseWillBeUsedCallbackParam) => MaybePromise<any>;
interface FetchDidFailCallbackParam {
  error: Error;
  originalRequest: Request;
  request: Request;
  event: ExtendableEvent;
  state?: PluginState;
}
type FetchDidFailCallback = (param: FetchDidFailCallbackParam) => MaybePromise<any>;
interface FetchDidSucceedCallbackParam {
  request: Request;
  response: Response;
  event: ExtendableEvent;
  state?: PluginState;
}
type FetchDidSucceedCallback = (param: FetchDidSucceedCallbackParam) => MaybePromise<Response>;
interface RequestWillFetchCallbackParam {
  request: Request;
  event: ExtendableEvent;
  state?: PluginState;
}
type RequestWillFetchCallback = (param: RequestWillFetchCallbackParam) => MaybePromise<Request>;
interface HandlerWillRespondCallbackParam {
  request: Request;
  response: Response;
  event: ExtendableEvent;
  state?: PluginState;
}
type HandlerWillRespondCallback = (param: HandlerWillRespondCallbackParam) => MaybePromise<Response>;
interface HandlerDidErrorCallbackParam {
  request: Request;
  event: ExtendableEvent;
  error: Error;
  state?: PluginState;
}
type HandlerDidErrorCallback = (param: HandlerDidErrorCallbackParam) => MaybePromise<Response | undefined>;
interface HandlerDidRespondCallbackParam {
  request: Request;
  event: ExtendableEvent;
  response?: Response;
  state?: PluginState;
}
type HandlerDidRespondCallback = (param: HandlerDidRespondCallbackParam) => MaybePromise<any>;
interface HandlerDidCompleteCallbackParam {
  request: Request;
  error?: Error;
  event: ExtendableEvent;
  response?: Response;
  state?: PluginState;
}
type HandlerDidCompleteCallback = (param: HandlerDidCompleteCallbackParam) => MaybePromise<any>;
/**
 * An object with optional lifecycle callback properties for the fetch and
 * cache operations.
 */
declare interface SerwistPlugin {
  cacheDidUpdate?: CacheDidUpdateCallback;
  cachedResponseWillBeUsed?: CachedResponseWillBeUsedCallback;
  cacheKeyWillBeUsed?: CacheKeyWillBeUsedCallback;
  cacheWillUpdate?: CacheWillUpdateCallback;
  fetchDidFail?: FetchDidFailCallback;
  fetchDidSucceed?: FetchDidSucceedCallback;
  handlerDidComplete?: HandlerDidCompleteCallback;
  handlerDidError?: HandlerDidErrorCallback;
  handlerDidRespond?: HandlerDidRespondCallback;
  handlerWillRespond?: HandlerWillRespondCallback;
  handlerWillStart?: HandlerWillStartCallback;
  requestWillFetch?: RequestWillFetchCallback;
}
interface SerwistPluginCallbackParam {
  cacheDidUpdate: CacheDidUpdateCallbackParam;
  cachedResponseWillBeUsed: CachedResponseWillBeUsedCallbackParam;
  cacheKeyWillBeUsed: CacheKeyWillBeUsedCallbackParam;
  cacheWillUpdate: CacheWillUpdateCallbackParam;
  fetchDidFail: FetchDidFailCallbackParam;
  fetchDidSucceed: FetchDidSucceedCallbackParam;
  handlerDidComplete: HandlerDidCompleteCallbackParam;
  handlerDidError: HandlerDidErrorCallbackParam;
  handlerDidRespond: HandlerDidRespondCallbackParam;
  handlerWillRespond: HandlerWillRespondCallbackParam;
  handlerWillStart: HandlerWillStartCallbackParam;
  requestWillFetch: RequestWillFetchCallbackParam;
}
interface SerwistGlobalConfig {
  /**
   * Whether Serwist should disable development logging.
   *
   * @default false
   */
  __WB_DISABLE_DEV_LOGS: boolean;
}
interface RuntimeCaching {
  /**
   * The HTTP method to match against. The default value of `'GET'` is normally
   * sufficient, unless you explicitly need to match `'POST'`, `'PUT'`, or
   * another type of request.
   * @default "GET"
   */
  method?: HTTPMethod;
  /**
   * The match callback determines whether the configured handler will be used to
   * generate a response for any request that doesn't match one of the precached
   * URLs. If multiple routes are defined, then the first one to match the request
   * will be the one that responds.
   *
   * This value directly maps to the first parameter passed to
   * {@linkcode Serwist.registerRoute}. It's recommended to use a
   * {@linkcode RouteMatchCallback} function for greatest flexibility.
   */
  matcher: RegExp | string | RouteMatchCallback;
  /**
   * This determines how the runtime route will generate a response. It
   * can be a {@linkcode RouteHandler} callback function with custom
   * response logic.
   */
  handler: RouteHandler;
}
interface InstallResult {
  updatedURLs: string[];
  notUpdatedURLs: string[];
}
interface CleanupResult {
  deletedCacheRequests: string[];
}
declare interface PrecacheEntry {
  integrity?: string;
  url: string;
  revision?: string | null;
}
interface PrecacheRouteOptions {
  /**
   * Tells Serwist to check the precache for an entry whose URL is the request URL appended
   * with the specified value. Only applies if the request URL ends with "/".
   *
   * @default "index.html"
   */
  directoryIndex?: string | null;
  /**
   * An array of `RegExp` objects matching search params that should be removed when looking
   * for a precache match.
   */
  ignoreURLParametersMatching?: RegExp[];
  /**
   * Tells Serwist to check the precache for an entry whose URL is the request URL appended
   * with ".html".
   *
   * @default true
   */
  cleanURLs?: boolean;
  /**
   * A function that should take a URL and return an array of alternative URLs that should
   * be checked for precache matches.
   */
  urlManipulation?: UrlManipulation;
}
interface PrecacheOptions extends PrecacheStrategyOptions, PrecacheRouteOptions {
  /**
   * Whether outdated caches should be removed.
   *
   * @default false
   */
  cleanupOutdatedCaches?: boolean;
  /**
   * The number of precache requests that should be made concurrently.
   *
   * @default 10
   */
  concurrency?: number;
  /**
   * An URL that should point to a HTML file with which navigation requests for URLs that aren't
   * precached will be fulfilled.
   */
  navigateFallback?: string;
  /**
   * URLs that should be allowed to use the `navigateFallback` handler.
   */
  navigateFallbackAllowlist?: RegExp[];
  /**
   * URLs that should not be allowed to use the `navigateFallback` handler. This takes precedence
   * over `navigateFallbackAllowlist`.
   */
  navigateFallbackDenylist?: RegExp[];
}
type UrlManipulation = ({ url }: {
  url: URL;
}) => URL[];
/**
 * Represents the condition object that defines which resources should match a rule.
 * Based on the MDN documentation for `InstallEvent.addRoutes()`.
 */
interface RequestRuleCondition {
  /**
   * A condition object defining conditions that must explicitly NOT be met to match the rule.
   * Conditions defined inside a `not` condition are mutually exclusive with other conditions.
   */
  not?: RequestRuleCondition;
  /**
   * An array of condition objects. One set of these defined conditions must be met to match the rule.
   * Conditions defined inside an `or` condition are mutually exclusive with other conditions.
   * Cannot be combined with other condition types.
   */
  or?: RequestRuleCondition[];
  /**
   * A string representing the HTTP method a request should be sent by for it to match the rule.
   *
   * @example "GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"
   */
  requestMethod?: HTTPMethod;
  /**
   * A string representing the mode a request should have for it to match the rule.
   *
   * @example "same-origin", "no-cors", "cors"
   */
  requestMode?: RequestMode;
  /**
   * A string representing the destination of a request, i.e., what content type should be requested.
   *
   * @example "audio", "document", "script", "worker"
   */
  requestDestination?: RequestDestination;
  /**
   * An enumerated value representing the required running status of the service worker for a request to match the rule.
   */
  runningStatus?: "running" | "not-running";
  /**
   * A URLPattern instance, or a URLPattern constructor input pattern representing the URLs that match the rule.
   * Regular expression capturing groups are not allowed, so `URLPattern.hasRegExpGroups` must be `false`.
   */
  urlPattern?: URLPattern | URLPatternInit;
}
/**
 * Represents the source from which matching resources will be loaded.
 * Can be an enumerated value or an object specifying a named cache.
 */
type RequestRuleSource = "cache" | "fetch-event" | "network" | "race-network-and-fetch-handler" | {
  cacheName: string;
};
/**
 * Represents a single router rule configuration.
 * Each rule contains a condition (optional) and a source (required).
 */
interface RequestRule {
  /**
   * An object defining one or more conditions that specify which resources should match this rule.
   * If multiple properties are used, a resource must meet all specified conditions to match the rule.
   */
  condition?: RequestRuleCondition;
  /**
   * An enumerated value or an object specifying the source from which matching resources will be loaded.
   */
  source: RequestRuleSource;
}
/**
 * Types based on MDN documentation
 * https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes
 *
 * Extends the standard `ExtendableEvent` interface to include the `addRoutes` method
 * for configuring static routes during the service worker's installation.
 *
 * The `addRoutes()` method specifies one or more static routes, which define rules
 * for fetching specified resources that will be used even before service worker startup.
 * This allows bypassing a service worker in cases where you always want to fetch
 * a resource from the network or a browser cache, avoiding the performance overhead
 * of unnecessary service worker cycles.
 */
interface InstallEvent extends ExtendableEvent {
  /**
   * Specifies one or more static routes for fetching resources.
   *
   * @param requestRules A single object, or an array of one or more objects, representing rules
   * for how certain resources should be fetched.
   * @returns A Promise that fulfills with `undefined`.
   * @throws {TypeError} Thrown if one or more of the rules objects is invalid, or has a source
   * value of `"fetch-event"` when the associated service worker does not have
   * a `fetch` event handler. Also thrown if you try to combine `or` with another condition type.
   */
  addRoutes?(requestRules: RequestRule | RequestRule[]): Promise<void>;
}
//#endregion
export { StrategyOptions as $, MaybePromise as A, RouteHandler as B, HandlerWillStartCallback as C, ManualHandlerCallback as D, InstallResult as E, RequestRule as F, RouteMatchCallbackOptions as G, RouteHandlerCallbackOptions as H, RequestRuleCondition as I, SerwistPlugin as J, RuntimeCaching as K, RequestRuleSource as L, PrecacheEntry as M, PrecacheOptions as N, ManualHandlerCallbackOptions as O, PrecacheRouteOptions as P, Strategy as Q, RequestWillFetchCallback as R, HandlerWillRespondCallbackParam as S, InstallEvent as T, RouteHandlerObject as U, RouteHandlerCallback as V, RouteMatchCallback as W, UrlManipulation as X, SerwistPluginCallbackParam as Y, PrecacheStrategy as Z, HandlerDidErrorCallback as _, CacheWillUpdateCallback as a, HandlerDidRespondCallbackParam as b, CachedResponseWillBeUsedCallbackParam as c, FetchDidFailCallbackParam as d, StrategyHandler as et, FetchDidSucceedCallback as f, HandlerDidCompleteCallbackParam as g, HandlerDidCompleteCallback as h, CacheKeyWillBeUsedCallbackParam as i, PluginState as j, MapLikeObject as k, CleanupResult as l, HandlerCallbackOptions as m, CacheDidUpdateCallbackParam as n, CacheWillUpdateCallbackParam as o, FetchDidSucceedCallbackParam as p, SerwistGlobalConfig as q, CacheKeyWillBeUsedCallback as r, CachedResponseWillBeUsedCallback as s, CacheDidUpdateCallback as t, HTTPMethod as tt, FetchDidFailCallback as u, HandlerDidErrorCallbackParam as v, HandlerWillStartCallbackParam as w, HandlerWillRespondCallback as x, HandlerDidRespondCallback as y, RequestWillFetchCallbackParam as z };
//# sourceMappingURL=types-BB8lYSAv.d.ts.map