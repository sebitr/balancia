import { B as RouteHandler, E as InstallResult, G as RouteMatchCallbackOptions, H as RouteHandlerCallbackOptions, J as SerwistPlugin, K as RuntimeCaching, M as PrecacheEntry, P as PrecacheRouteOptions, Q as Strategy, V as RouteHandlerCallback, W as RouteMatchCallback, l as CleanupResult, tt as HTTPMethod, v as HandlerDidErrorCallbackParam } from "./chunks/types-BB8lYSAv.js";
import { t as Route } from "./chunks/Route-BfRIuMhK.js";
//#region src/legacy/addPlugins.d.ts
/**
 * Adds plugins to the precaching strategy.
 *
 * @param plugins
 * @deprecated
 */
declare const addPlugins: (plugins: SerwistPlugin[]) => void;
//#endregion
//#region src/legacy/addRoute.d.ts
/**
 * Add a `fetch` listener that will
 * respond to [network requests](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers#Custom_responses_to_requests)
 * with precached assets to the service worker.
 *
 * As for requests for assets that aren't precached, the `fetch` event will not be
 * responded to, allowing the event to fall through to other `fetch` event listeners.
 *
 * @param options See {@linkcode PrecacheRouteOptions}.
 * @deprecated
 */
declare const addRoute: (options?: PrecacheRouteOptions) => void;
//#endregion
//#region src/legacy/createHandlerBoundToURL.d.ts
/**
 * Helper function that calls {@linkcode PrecacheController.createHandlerBoundToURL}
 * on the default {@linkcode PrecacheController} instance.
 *
 * If you are creating your own {@linkcode PrecacheController}, then call the
 * {@linkcode PrecacheController.createHandlerBoundToURL} function on that instance
 * instead of using this function.
 *
 * @param url The precached URL which will be used to look up the response.
 * @param fallbackToNetwork Whether to attempt to get the
 * response from the network if there's a precache miss.
 * @return
 * @deprecated
 */
declare const createHandlerBoundToURL: (url: string) => RouteHandlerCallback;
//#endregion
//#region src/legacy/PrecacheController.d.ts
interface PrecacheControllerOptions {
  /**
   * The cache to use for precaching.
   */
  cacheName?: string;
  /**
   * Plugins to use when precaching as well as responding to fetch
   * events for precached assets.
   */
  plugins?: SerwistPlugin[];
  /**
   * Whether to attempt to get the response from the network if there's
   * a precache miss.
   */
  fallbackToNetwork?: boolean;
  /**
   * The number of precache requests that should be made concurrently.
   *
   * @default 1
   */
  concurrentPrecaching?: number;
}
/**
 * Performs efficient precaching of assets.
 * @deprecated
 */
declare class PrecacheController {
  private _installAndActiveListenersAdded?;
  private _concurrentPrecaching;
  private readonly _strategy;
  private readonly _urlsToCacheKeys;
  private readonly _urlsToCacheModes;
  private readonly _cacheKeysToIntegrities;
  /**
   * Create a new PrecacheController.
   *
   * @param options
   */
  constructor({ cacheName, plugins, fallbackToNetwork, concurrentPrecaching }?: PrecacheControllerOptions);
  /**
   * The strategy created by this controller and
   * used to cache assets and respond to `fetch` events.
   */
  get strategy(): Strategy;
  /**
   * Adds items to the precache list, removing any duplicates and
   * stores the files in the precache cache when the service
   * worker installs.
   *
   * This method can be called multiple times.
   *
   * @param entries Array of entries to precache.
   */
  precache(entries: (PrecacheEntry | string)[]): void;
  /**
   * This method will add items to the precache list, removing duplicates
   * and ensuring the information is valid.
   *
   * @param entries Array of entries to precache.
   */
  addToCacheList(entries: (PrecacheEntry | string)[]): void;
  /**
   * Precaches new and updated assets. Call this method from the service worker
   * install event.
   *
   * Note: this method calls `event.waitUntil()` for you, so you do not need
   * to call it yourself in your event handlers.
   *
   * @param event
   * @returns
   */
  install(event: ExtendableEvent): Promise<InstallResult>;
  /**
   * Deletes assets that are no longer present in the current precache manifest.
   * Call this method from the service worker activate event.
   *
   * Note: this method calls `event.waitUntil()` for you, so you do not need
   * to call it yourself in your event handlers.
   *
   * @param event
   * @returns
   */
  activate(event: ExtendableEvent): Promise<CleanupResult>;
  /**
   * Returns a mapping of a precached URL to the corresponding cache key, taking
   * into account the revision information for the URL.
   *
   * @returns A URL to cache key mapping.
   */
  getURLsToCacheKeys(): Map<string, string>;
  /**
   * Returns a list of all the URLs that have been precached by the current
   * service worker.
   *
   * @returns The precached URLs.
   */
  getCachedURLs(): string[];
  /**
   * Returns the cache key used for storing a given URL. If that URL is
   * unversioned, like `/index.html', then the cache key will be the original
   * URL with a search parameter appended to it.
   *
   * @param url A URL whose cache key you want to look up.
   * @returns The versioned URL that corresponds to a cache key
   * for the original URL, or undefined if that URL isn't precached.
   */
  getCacheKeyForURL(url: string): string | undefined;
  /**
   * @param url A cache key whose SRI you want to look up.
   * @returns The subresource integrity associated with the cache key,
   * or undefined if it's not set.
   */
  getIntegrityForCacheKey(cacheKey: string): string | undefined;
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
  createHandlerBoundToURL(url: string): RouteHandlerCallback;
}
//#endregion
//#region src/legacy/PrecacheFallbackPlugin.d.ts
/**
 * @deprecated
 */
interface PrecacheFallbackEntry {
  /**
   * A function that checks whether the fallback entry can be used
   * for a request.
   */
  matcher: (param: HandlerDidErrorCallbackParam) => boolean;
  /**
   * A precached URL to be used as a fallback.
   */
  url: string;
}
/**
 * @deprecated
 */
interface PrecacheFallbackPluginOptions {
  /**
   * Precached URLs to be used as the fallback
   * if the associated strategy can't generate a response.
   */
  fallbackUrls: (string | PrecacheFallbackEntry)[];
  /**
   * An optional {@linkcode PrecacheController} instance. If not provided,
   * the default {@linkcode PrecacheController} will be used.
   */
  precacheController?: PrecacheController;
}
/**
 * A class that allows you to specify offline fallbacks
 * to be used when a given strategy is unable to generate a response.
 *
 * It does this by intercepting the `handlerDidError` plugin callback
 * and returning a precached response, taking the expected revision parameter
 * into account automatically.
 *
 * Unless you explicitly pass in a {@linkcode PrecacheController} instance to the
 * constructor, the default instance will be used.
 *
 * @deprecated
 */
declare class PrecacheFallbackPlugin implements SerwistPlugin {
  private readonly _fallbackUrls;
  private readonly _precacheController;
  /**
   * Constructs a new instance with the associated `fallbackUrls`.
   *
   * @param config
   */
  constructor({ fallbackUrls, precacheController }: PrecacheFallbackPluginOptions);
  /**
   * @returns The precache response for one of the fallback URLs, or `undefined` if
   * nothing satisfies the conditions.
   * @private
   */
  handlerDidError(param: HandlerDidErrorCallbackParam): Promise<Response | undefined>;
}
//#endregion
//#region src/legacy/Router.d.ts
/**
 * A class that can be used to process a `fetch` event using one or more route(s), responding with a response
 * if a matching route exists.
 *
 * If no route matches given a request, the router will use the default handler if one is defined.
 *
 * Should the matching route throw an error, the router will use the catch handler if one is defined to
 * gracefully deal with issues and respond with a response.
 *
 * If a request matches multiple routes, the earliest registered route will be used to respond to the it.
 * @deprecated
 */
declare class Router {
  private readonly _routes;
  private readonly _defaultHandlerMap;
  private _fetchListenerHandler;
  private _cacheListenerHandler;
  private _catchHandler?;
  /**
   * Initializes a new Router.
   */
  constructor();
  /**
   * @returns routes A `Map` of HTTP method name (`'GET'`, etc.) to an array of all
   * the corresponding {@linkcode Route} instances that are registered.
   */
  get routes(): Map<HTTPMethod, Route[]>;
  /**
   * Adds a `fetch` event listener to respond to events when a route matches
   * the event's request. Effectively no-op if `addFetchListener` has been
   * called, but `removeFetchListener` has not.
   */
  addFetchListener(): void;
  /**
   * Removes `fetch` event listener added by `addFetchListener`.
   * Effectively no-op if either `addFetchListener` has not been called or,
   * if it has, so has `removeFetchListener`.
   */
  removeFetchListener(): void;
  /**
   * Adds a `message` event listener for URLs to cache from the window.
   * This is useful to cache resources loaded on the page prior to when the
   * service worker started controlling it. Effectively no-op if `addCacheListener`
   * has been called, but `removeCacheListener` hasn't.
   *
   * The format of the message data sent from the window should be as follows.
   * Where the `urlsToCache` array may consist of URL strings or an array of
   * URL string + `requestInit` object (the same as you'd pass to `fetch()`).
   *
   * ```
   * {
   *   type: 'CACHE_URLS',
   *   payload: {
   *     urlsToCache: [
   *       './script1.js',
   *       './script2.js',
   *       ['./script3.js', {mode: 'no-cors'}],
   *     ],
   *   },
   * }
   * ```
   */
  addCacheListener(): void;
  /**
   * Removes the `message` event listener added by `addCacheListener`.
   * Effectively no-op if either `addCacheListener` has not been called or,
   * if it has, so has `removeCacheListener`.
   */
  removeCacheListener(): void;
  /**
   * Apply the routing rules to a `fetch` event to get a response from an
   * appropriate route.
   *
   * @param options
   * @returns A promise is returned if a registered route can handle the request.
   * If there is no matching route and there's no `defaultHandler`, `undefined`
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
  /**
   * Define a default handler that's called when no routes explicitly
   * match the incoming request.
   *
   * Each HTTP method (`'GET'`, `'POST'`, etc.) gets its own default handler.
   *
   * Without a default handler, unmatched requests will go against the
   * network as if there were no service worker present.
   *
   * @param handler A callback function that returns a promise resulting in a response.
   * @param method The HTTP method to associate with this default handler. Each method
   * has its own default. Defaults to `'GET'`.
   */
  setDefaultHandler(handler: RouteHandler, method?: HTTPMethod): void;
  /**
   * If a `Route` throws an error while handling a request, this `handler`
   * will be called and given a chance to provide a response.
   *
   * @param handler A callback function that returns a Promise resulting
   * in a Response.
   */
  setCatchHandler(handler: RouteHandler): void;
  /**
   * Registers a `RegExp`, string, or function with a caching
   * strategy to the router.
   *
   * @param capture If the capture param is a {@linkcode Route} object, all other arguments will be ignored.
   * @param handler A callback function that returns a promise resulting in a response.
   * This parameter is required if `capture` is not a {@linkcode Route} object.
   * @param method The HTTP method to match the route against. Defaults to `'GET'`.
   * @returns The generated {@linkcode Route} object.
   */
  registerCapture(capture: RegExp | string | RouteMatchCallback | Route, handler?: RouteHandler, method?: HTTPMethod): Route;
  /**
   * Registers a route with the router.
   *
   * @param route The route to register.
   */
  registerRoute(route: Route): void;
  /**
   * Unregisters a route from the router.
   *
   * @param route The route to unregister.
   */
  unregisterRoute(route: Route): void;
}
//#endregion
//#region src/legacy/fallbacks.d.ts
interface FallbackEntry extends PrecacheFallbackEntry {
  /**
   * The revision used for precaching.
   */
  revision: string;
}
interface FallbacksOptions {
  /**
   * A list of fallback entries.
   */
  entries: FallbackEntry[];
  /**
   * Precache options that will be used for your
   * fallback entries.
   */
  precacheOptions?: PrecacheRouteOptions;
}
interface FallbacksOptions {
  /**
   * An optional {@linkcode PrecacheController} instance. If not provided, the singleton
   * {@linkcode PrecacheController} will be used.
   */
  precacheController?: PrecacheController;
  /**
   * An optional {@linkcode Router} instance. If not provided, the singleton {@linkcode Router}
   * will be used.
   */
  router?: Router;
  /**
   * Your previous list of caching strategies.
   */
  runtimeCaching: RuntimeCaching[];
  /**
   * A list of fallback entries.
   */
  entries: FallbackEntry[];
  /**
   * Precache options that will be used for your
   * fallback entries.
   */
  precacheOptions?: PrecacheRouteOptions;
}
/**
 * Precaches routes so that they can be used as a fallback when
 * a Strategy fails to generate a response.
 *
 * Note: This function mutates `runtimeCaching`. It also precaches the URLs
 * defined in `entries`, so you must NOT precache any of them beforehand.
 *
 * @param options
 * @returns The modified `runtimeCaching` array.
 * @deprecated
 */
declare const fallbacks$1: ({ precacheController, router, runtimeCaching, entries, precacheOptions }: FallbacksOptions) => RuntimeCaching[];
//#endregion
//#region src/legacy/getCacheKeyForURL.d.ts
/**
 * Takes in a URL, and returns the corresponding URL that could be used to
 * lookup the entry in the precache.
 *
 * If a relative URL is provided, the location of the service worker file will
 * be used as the base.
 *
 * For precached entries without revision information, the cache key will be the
 * same as the original URL.
 *
 * For precached entries with revision information, the cache key will be the
 * original URL with the addition of a query parameter used for keeping track of
 * the revision info.
 *
 * @param url The URL whose cache key to look up.
 * @returns The cache key that corresponds to that URL.
 * @deprecated
 */
declare const getCacheKeyForURL: (url: string) => string | undefined;
//#endregion
//#region src/legacy/handlePrecaching.d.ts
/**
 * @deprecated
 */
interface HandlePrecachingOptions {
  /**
   * An optional {@linkcode PrecacheController} instance. If not provided, the singleton
   * {@linkcode PrecacheController} will be used.
   */
  precacheController?: PrecacheController;
  /**
   * An optional {@linkcode Router} instance. If not provided, the singleton {@linkcode Router}
   * will be used.
   */
  router?: Router;
  /**
   * A list of URLs that should be cached.
   */
  precacheEntries?: (PrecacheEntry | string)[];
  /**
   * Options to customize how Serwist precaches the URLs.
   */
  precacheOptions?: PrecacheRouteOptions;
  /**
   * Whether outdated caches should be removed.
   *
   * @default false
   */
  cleanupOutdatedCaches?: boolean;
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
/**
 * Handles a list of precache entries and cleans up outdated caches.
 *
 * @param options
 * @deprecated
 */
declare const handlePrecaching: ({ precacheController, router, precacheEntries, precacheOptions, cleanupOutdatedCaches, navigateFallback, navigateFallbackAllowlist, navigateFallbackDenylist }: HandlePrecachingOptions) => void;
//#endregion
//#region src/legacy/initializeGoogleAnalytics.d.ts
/**
 * @deprecated
 */
interface GoogleAnalyticsInitializeOptions {
  /**
   * An optional {@linkcode Router} instance. If not provided, the singleton {@linkcode Router}
   * will be used.
   */
  router?: Router;
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
 * @deprecated Use `serwist.initializeGoogleAnalytics` instead.
 */
declare const initializeGoogleAnalytics: ({ router, cacheName, ...options }?: GoogleAnalyticsInitializeOptions) => void;
//#endregion
//#region src/legacy/installSerwist.d.ts
/**
 * Options for {@linkcode installSerwist}.
 *
 * @deprecated
 */
interface InstallSerwistOptions extends Omit<HandlePrecachingOptions, "precacheController" | "router"> {
  /**
   * An optional {@linkcode PrecacheController} instance. If not provided, the singleton
   * {@linkcode PrecacheController} will be used.
   */
  precacheController?: PrecacheController;
  /**
   * An optional {@linkcode Router} instance. If not provided, the singleton {@linkcode Router}
   * will be used.
   */
  router?: Router;
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
   * Your configuration for `@serwist/google-analytics`. This plugin is
   * only initialized when this option is not `undefined` or `false`.
   */
  offlineAnalyticsConfig?: GoogleAnalyticsInitializeOptions | boolean;
  /**
   * Disables Serwist's logging in development mode.
   *
   * @default false
   */
  disableDevLogs?: boolean;
  /**
   * Precaches routes so that they can be used as a fallback when
   * a Strategy fails to generate a response.
   */
  fallbacks?: Pick<FallbacksOptions, "entries">;
}
/**
 * Abstracts away the core APIs of Serwist.
 *
 * @param options - `installSerwist` options.
 * @deprecated
 */
declare const installSerwist: ({ precacheController, router, precacheEntries, precacheOptions, cleanupOutdatedCaches, navigateFallback, navigateFallbackAllowlist, navigateFallbackDenylist, skipWaiting, importScripts, navigationPreload, cacheId, clientsClaim, runtimeCaching, offlineAnalyticsConfig, disableDevLogs, fallbacks }: InstallSerwistOptions) => void;
//#endregion
//#region src/legacy/matchPrecache.d.ts
/**
 * Helper function that calls {@linkcode PrecacheController.matchPrecache}
 * on the default {@linkcode PrecacheController} instance.
 *
 * If you are creating your own {@linkcode PrecacheController}, then call
 * the {@linkcode PrecacheController.matchPrecache} function on that instance
 * instead of using this function.
 *
 * @param request The key (without revisioning parameters)
 * to look up in the precache.
 * @returns
 * @deprecated
 */
declare const matchPrecache: (request: string | Request) => Promise<Response | undefined>;
//#endregion
//#region src/legacy/PrecacheRoute.d.ts
/**
 * A subclass of {@linkcode Route} that takes a {@linkcode PrecacheController}
 * instance and uses it to match incoming requests and handle fetching
 * responses from the precache.
 * @deprecated
 */
declare class PrecacheRoute extends Route {
  /**
   * @param precacheController A {@linkcode PrecacheController}
   * instance used to both match requests and respond to `fetch` events.
   * @param options Options to control how requests are matched
   * against the list of precached URLs.
   */
  constructor(precacheController: PrecacheController, options?: PrecacheRouteOptions);
}
//#endregion
//#region src/legacy/precache.d.ts
/**
 * Adds items to the precache list, removing any duplicates and
 * stores the files in the precache cache when the service
 * worker installs.
 *
 * This method can be called multiple times.
 *
 * Please note: This method **will not** serve any of the cached files for you.
 * It only precaches files. To respond to a network request you call
 * {@linkcode addRoute}.
 *
 * If you have a single array of files to precache, you can just call
 * {@linkcode precacheAndRoute}.
 *
 * @param entries Array of entries to precache.
 * @deprecated
 */
declare const precache: (entries: (PrecacheEntry | string)[]) => void;
//#endregion
//#region src/legacy/precacheAndRoute.d.ts
/**
 * This method will add entries to the precache list and add a route to
 * respond to `fetch` events.
 *
 * This is a convenience method that will call
 * {@linkcode precache} and {@linkcode addRoute} in a single call.
 *
 * @param entries Array of entries to precache.
 * @param options See the {@linkcode PrecacheRouteOptions} options.
 * @deprecated
 */
declare const precacheAndRoute: (entries: (PrecacheEntry | string)[], options?: PrecacheRouteOptions) => void;
//#endregion
//#region src/legacy/registerRoute.d.ts
/**
 * Registers a `RegExp`, string, or function with a caching
 * strategy to a singleton {@linkcode Router} instance.
 *
 * @param capture If the capture param is a {@linkcode Route}, all other arguments will be ignored.
 * @param handler A callback function that returns a promise resulting in a response.
 * This parameter is required if `capture` is not a {@linkcode Route} object.
 * @param method The HTTP method to match the route against. Defaults to `'GET'`.
 * @returns The generated {@linkcode Route} object, which can then be provided to {@linkcode unregisterRoute} if needed.
 * @deprecated
 */
declare const registerRoute: (capture: RegExp | string | RouteMatchCallback | Route, handler?: RouteHandler, method?: HTTPMethod) => Route;
//#endregion
//#region src/legacy/registerRuntimeCaching.d.ts
/**
 * Registers caching strategies to a singleton Router instance. It is a simple
 * syntatic sugar for {@linkcode registerRoute}.
 *
 * @param runtimeCachingList
 * @returns
 * @deprecated
 */
declare const registerRuntimeCaching: (...runtimeCachingList: RuntimeCaching[]) => void;
//#endregion
//#region src/legacy/setCatchHandler.d.ts
/**
 * If a route throws an error while handling a request, this handler
 * will be called and given a chance to provide a response.
 *
 * @param handler A callback function that returns a promise resulting in a response.
 * @deprecated
 */
declare const setCatchHandler: (handler: RouteHandler) => void;
//#endregion
//#region src/legacy/setDefaultHandler.d.ts
/**
 * Defines a default handler that's called when no routes explicitly
 * match the incoming request.
 *
 * Without a default handler, unmatched requests will go against the
 * network as if there were no service worker present.
 *
 * @param handler A callback function that returns a promise resulting in a response.
 * @deprecated
 */
declare const setDefaultHandler: (handler: RouteHandler) => void;
//#endregion
//#region src/legacy/singletonPrecacheController.d.ts
/**
 * Creates a new, singleton {@linkcode PrecacheController} if one does not exist. If one does
 * already exist, that instance is returned. This instance is used by Serwist's
 * {@linkcode PrecacheController}-dependent functions and classes unless you provide a different
 * {@linkcode PrecacheController} to them.
 *
 * @returns The singleton {@linkcode PrecacheController}.
 * @deprecated
 */
declare const getSingletonPrecacheController: () => PrecacheController;
/**
 * Changes the singleton {@linkcode PrecacheController} to a different instance. This is meant for when you do not
 * want to pass your own {@linkcode PrecacheController} to every one of Serwist's {@linkcode PrecacheController}-dependent
 * functions and classes.
 *
 * It is highly recommended that you call this before anything else, if you plan on doing so.
 *
 * @example
 * ```js
 * import { PrecacheController, setSingletonPrecacheController } from "serwist/legacy";
 *
 * const controller = new PrecacheController();
 *
 * setSingletonPrecacheController(controller);
 *
 * // Do something with your controller...
 * ```
 * @param router
 * @returns The new singleton {@linkcode PrecacheController}.
 * @deprecated
 */
declare const setSingletonPrecacheController: (precacheController: PrecacheController) => PrecacheController;
//#endregion
//#region src/legacy/singletonRouter.d.ts
/**
 * Creates a new, singleton {@linkcode Router} if one does not exist. If one does
 * already exist, that instance is returned. This instance is used by
 * Serwist's {@linkcode Router}-dependent functions and classes unless you provide
 * a different {@linkcode Router} to them.
 *
 * @returns The singleton {@linkcode Router}.
 * @deprecated
 */
declare const getSingletonRouter: () => Router;
/**
 * Changes the singleton {@linkcode Router} to a different instance. This is meant for when you do not
 * want to pass your own {@linkcode Router} to every one of Serwist's {@linkcode Router}-dependent functions and classes.
 * If this or {@linkcode getSingletonRouter} has been called before, it removes the listeners of the
 * previous singleton {@linkcode Router}. It also adds those of the new one, so you need not do that yourself.
 *
 * It is highly recommended that you call this before anything else, if you plan on doing so.
 *
 * @example
 * ```js
 * import { Router, setSingletonRouter } from "serwist/legacy";
 *
 * const router = new Router();
 *
 * setSingletonRouter(router);
 *
 * router.registerRoute(
 *   new Route(
 *     /\/api\/.*\/*.json/,
 *     new NetworkOnly(),
 *     "POST",
 *   ),
 * );
 * ```
 * @param router
 * @returns The new singleton {@linkcode Router}.
 * @deprecated
 */
declare const setSingletonRouter: (router: Router) => Router;
//#endregion
//#region src/legacy/unregisterRoute.d.ts
/**
 * Unregisters a route from the singleton {@linkcode Router} instance.
 *
 * @param route The route to unregister.
 * @deprecated
 */
declare const unregisterRoute: (route: Route) => void;
//#endregion
export { type FallbackEntry, type FallbacksOptions, type GoogleAnalyticsInitializeOptions, type HandlePrecachingOptions, type InstallSerwistOptions, PrecacheController, type PrecacheFallbackEntry, PrecacheFallbackPlugin, type PrecacheFallbackPluginOptions, PrecacheRoute, Router, addPlugins, addRoute, createHandlerBoundToURL, fallbacks$1 as fallbacks, getCacheKeyForURL, getSingletonPrecacheController, getSingletonRouter, handlePrecaching, initializeGoogleAnalytics, installSerwist, matchPrecache, precache, precacheAndRoute, registerRoute, registerRuntimeCaching, setCatchHandler, setDefaultHandler, setSingletonPrecacheController, setSingletonRouter, unregisterRoute };
//# sourceMappingURL=index.legacy.d.mts.map