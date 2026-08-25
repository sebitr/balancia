import { d as finalAssertExports, f as SerwistError, l as logger, m as cacheNames, n as clientsClaim, r as cleanupOutdatedCaches, t as waitUntil, u as getFriendlyURL } from "./chunks/waitUntil-BDu76Zx7.js";
import { E as disableDevLogs, S as BackgroundSyncPlugin, _ as NetworkFirst, a as createCacheKey, c as generateURLVariations, f as NavigationRoute, g as NetworkOnly, h as normalizeHandler, i as PrecacheInstallReportPlugin, m as Route, n as printCleanupDetails, o as setCacheNameDetails, p as PrecacheStrategy, r as parseRoute, t as printInstallDetails, u as enableNavigationPreload, y as Strategy } from "./chunks/printInstallDetails-ESDOoMBE.js";
import { parallel } from "@serwist/utils";
//#region src/legacy/utils/PrecacheCacheKeyPlugin.ts
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
		const cacheKey = params?.cacheKey || this._precacheController.getCacheKeyForURL(request.url);
		return cacheKey ? new Request(cacheKey, { headers: request.headers }) : request;
	};
};
//#endregion
//#region src/legacy/PrecacheController.ts
/**
* Performs efficient precaching of assets.
* @deprecated
*/
var PrecacheController = class {
	_installAndActiveListenersAdded;
	_concurrentPrecaching;
	_strategy;
	_urlsToCacheKeys = /* @__PURE__ */ new Map();
	_urlsToCacheModes = /* @__PURE__ */ new Map();
	_cacheKeysToIntegrities = /* @__PURE__ */ new Map();
	/**
	* Create a new PrecacheController.
	*
	* @param options
	*/
	constructor({ cacheName, plugins = [], fallbackToNetwork = true, concurrentPrecaching = 1 } = {}) {
		this._concurrentPrecaching = concurrentPrecaching;
		this._strategy = new PrecacheStrategy({
			cacheName: cacheNames.getPrecacheName(cacheName),
			plugins: [...plugins, new PrecacheCacheKeyPlugin({ precacheController: this })],
			fallbackToNetwork
		});
		this.install = this.install.bind(this);
		this.activate = this.activate.bind(this);
	}
	/**
	* The strategy created by this controller and
	* used to cache assets and respond to `fetch` events.
	*/
	get strategy() {
		return this._strategy;
	}
	/**
	* Adds items to the precache list, removing any duplicates and
	* stores the files in the precache cache when the service
	* worker installs.
	*
	* This method can be called multiple times.
	*
	* @param entries Array of entries to precache.
	*/
	precache(entries) {
		this.addToCacheList(entries);
		if (!this._installAndActiveListenersAdded) {
			self.addEventListener("install", this.install);
			self.addEventListener("activate", this.activate);
			this._installAndActiveListenersAdded = true;
		}
	}
	/**
	* This method will add items to the precache list, removing duplicates
	* and ensuring the information is valid.
	*
	* @param entries Array of entries to precache.
	*/
	addToCacheList(entries) {
		if (process.env.NODE_ENV !== "production") finalAssertExports.isArray(entries, {
			moduleName: "serwist/legacy",
			className: "PrecacheController",
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
			if (urlsToWarnAbout.length > 0) {
				const warningMessage = `Serwist is precaching URLs without revision info: ${urlsToWarnAbout.join(", ")}\nThis is generally NOT safe. Learn more at https://bit.ly/wb-precache`;
				if (process.env.NODE_ENV === "production") console.warn(warningMessage);
				else logger.warn(warningMessage);
			}
		}
	}
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
	install(event) {
		return waitUntil(event, async () => {
			const installReportPlugin = new PrecacheInstallReportPlugin();
			this.strategy.plugins.push(installReportPlugin);
			await parallel(this._concurrentPrecaching, Array.from(this._urlsToCacheKeys.entries()), async ([url, cacheKey]) => {
				const integrity = this._cacheKeysToIntegrities.get(cacheKey);
				const cacheMode = this._urlsToCacheModes.get(url);
				const request = new Request(url, {
					integrity,
					cache: cacheMode,
					credentials: "same-origin"
				});
				await Promise.all(this.strategy.handleAll({
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
	* Deletes assets that are no longer present in the current precache manifest.
	* Call this method from the service worker activate event.
	*
	* Note: this method calls `event.waitUntil()` for you, so you do not need
	* to call it yourself in your event handlers.
	*
	* @param event
	* @returns
	*/
	activate(event) {
		return waitUntil(event, async () => {
			const cache = await self.caches.open(this.strategy.cacheName);
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
	* Returns a mapping of a precached URL to the corresponding cache key, taking
	* into account the revision information for the URL.
	*
	* @returns A URL to cache key mapping.
	*/
	getURLsToCacheKeys() {
		return this._urlsToCacheKeys;
	}
	/**
	* Returns a list of all the URLs that have been precached by the current
	* service worker.
	*
	* @returns The precached URLs.
	*/
	getCachedURLs() {
		return [...this._urlsToCacheKeys.keys()];
	}
	/**
	* Returns the cache key used for storing a given URL. If that URL is
	* unversioned, like `/index.html', then the cache key will be the original
	* URL with a search parameter appended to it.
	*
	* @param url A URL whose cache key you want to look up.
	* @returns The versioned URL that corresponds to a cache key
	* for the original URL, or undefined if that URL isn't precached.
	*/
	getCacheKeyForURL(url) {
		const urlObject = new URL(url, location.href);
		return this._urlsToCacheKeys.get(urlObject.href);
	}
	/**
	* @param url A cache key whose SRI you want to look up.
	* @returns The subresource integrity associated with the cache key,
	* or undefined if it's not set.
	*/
	getIntegrityForCacheKey(cacheKey) {
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
		const cacheKey = this.getCacheKeyForURL(url);
		if (cacheKey) return (await self.caches.open(this.strategy.cacheName)).match(cacheKey);
	}
	/**
	* Returns a function that looks up `url` in the precache (taking into
	* account revision information), and returns the corresponding `Response`.
	*
	* @param url The precached URL which will be used to lookup the response.
	* @return
	*/
	createHandlerBoundToURL(url) {
		const cacheKey = this.getCacheKeyForURL(url);
		if (!cacheKey) throw new SerwistError("non-precached-url", { url });
		return (options) => {
			options.request = new Request(url);
			options.params = {
				cacheKey,
				...options.params
			};
			return this.strategy.handle(options);
		};
	}
};
//#endregion
//#region src/legacy/singletonPrecacheController.ts
let defaultPrecacheController;
/**
* Creates a new, singleton {@linkcode PrecacheController} if one does not exist. If one does
* already exist, that instance is returned. This instance is used by Serwist's
* {@linkcode PrecacheController}-dependent functions and classes unless you provide a different
* {@linkcode PrecacheController} to them.
*
* @returns The singleton {@linkcode PrecacheController}.
* @deprecated
*/
const getSingletonPrecacheController = () => {
	if (!defaultPrecacheController) defaultPrecacheController = new PrecacheController();
	return defaultPrecacheController;
};
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
const setSingletonPrecacheController = (precacheController) => {
	defaultPrecacheController = precacheController;
	return defaultPrecacheController;
};
//#endregion
//#region src/legacy/addPlugins.ts
/**
* Adds plugins to the precaching strategy.
*
* @param plugins
* @deprecated
*/
const addPlugins = (plugins) => {
	getSingletonPrecacheController().strategy.plugins.push(...plugins);
};
//#endregion
//#region src/legacy/PrecacheRoute.ts
/**
* A subclass of {@linkcode Route} that takes a {@linkcode PrecacheController}
* instance and uses it to match incoming requests and handle fetching
* responses from the precache.
* @deprecated
*/
var PrecacheRoute = class extends Route {
	/**
	* @param precacheController A {@linkcode PrecacheController}
	* instance used to both match requests and respond to `fetch` events.
	* @param options Options to control how requests are matched
	* against the list of precached URLs.
	*/
	constructor(precacheController, options) {
		const match = ({ request }) => {
			const urlsToCacheKeys = precacheController.getURLsToCacheKeys();
			for (const possibleURL of generateURLVariations(request.url, options)) {
				const cacheKey = urlsToCacheKeys.get(possibleURL);
				if (cacheKey) return {
					cacheKey,
					integrity: precacheController.getIntegrityForCacheKey(cacheKey)
				};
			}
			if (process.env.NODE_ENV !== "production") logger.debug(`Precaching did not find a match for ${getFriendlyURL(request.url)}`);
		};
		super(match, precacheController.strategy);
	}
};
//#endregion
//#region src/legacy/Router.ts
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
var Router = class {
	_routes;
	_defaultHandlerMap;
	_fetchListenerHandler = null;
	_cacheListenerHandler = null;
	_catchHandler;
	/**
	* Initializes a new Router.
	*/
	constructor() {
		this._routes = /* @__PURE__ */ new Map();
		this._defaultHandlerMap = /* @__PURE__ */ new Map();
	}
	/**
	* @returns routes A `Map` of HTTP method name (`'GET'`, etc.) to an array of all
	* the corresponding {@linkcode Route} instances that are registered.
	*/
	get routes() {
		return this._routes;
	}
	/**
	* Adds a `fetch` event listener to respond to events when a route matches
	* the event's request. Effectively no-op if `addFetchListener` has been
	* called, but `removeFetchListener` has not.
	*/
	addFetchListener() {
		if (!this._fetchListenerHandler) {
			this._fetchListenerHandler = (event) => {
				const { request } = event;
				const responsePromise = this.handleRequest({
					request,
					event
				});
				if (responsePromise) event.respondWith(responsePromise);
			};
			self.addEventListener("fetch", this._fetchListenerHandler);
		}
	}
	/**
	* Removes `fetch` event listener added by `addFetchListener`.
	* Effectively no-op if either `addFetchListener` has not been called or,
	* if it has, so has `removeFetchListener`.
	*/
	removeFetchListener() {
		if (this._fetchListenerHandler) {
			self.removeEventListener("fetch", this._fetchListenerHandler);
			this._fetchListenerHandler = null;
		}
	}
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
	addCacheListener() {
		if (!this._cacheListenerHandler) {
			this._cacheListenerHandler = (event) => {
				if (event.data && event.data.type === "CACHE_URLS") {
					const { payload } = event.data;
					if (process.env.NODE_ENV !== "production") logger.debug("Caching URLs from the window", payload.urlsToCache);
					const requestPromises = Promise.all(payload.urlsToCache.map((entry) => {
						if (typeof entry === "string") entry = [entry];
						const request = new Request(...entry);
						return this.handleRequest({
							request,
							event
						});
					}));
					event.waitUntil(requestPromises);
					if (event.ports?.[0]) requestPromises.then(() => event.ports[0].postMessage(true));
				}
			};
			self.addEventListener("message", this._cacheListenerHandler);
		}
	}
	/**
	* Removes the `message` event listener added by `addCacheListener`.
	* Effectively no-op if either `addCacheListener` has not been called or,
	* if it has, so has `removeCacheListener`.
	*/
	removeCacheListener() {
		if (this._cacheListenerHandler) self.removeEventListener("message", this._cacheListenerHandler);
	}
	/**
	* Apply the routing rules to a `fetch` event to get a response from an
	* appropriate route.
	*
	* @param options
	* @returns A promise is returned if a registered route can handle the request.
	* If there is no matching route and there's no `defaultHandler`, `undefined`
	* is returned.
	*/
	handleRequest({ request, event }) {
		if (process.env.NODE_ENV !== "production") finalAssertExports.isInstance(request, Request, {
			moduleName: "serwist/legacy",
			className: "Router",
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
	setDefaultHandler(handler, method = "GET") {
		this._defaultHandlerMap.set(method, normalizeHandler(handler));
	}
	/**
	* If a `Route` throws an error while handling a request, this `handler`
	* will be called and given a chance to provide a response.
	*
	* @param handler A callback function that returns a Promise resulting
	* in a Response.
	*/
	setCatchHandler(handler) {
		this._catchHandler = normalizeHandler(handler);
	}
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
	registerCapture(capture, handler, method) {
		const route = parseRoute(capture, handler, method);
		this.registerRoute(route);
		return route;
	}
	/**
	* Registers a route with the router.
	*
	* @param route The route to register.
	*/
	registerRoute(route) {
		if (process.env.NODE_ENV !== "production") {
			finalAssertExports.isType(route, "object", {
				moduleName: "serwist/legacy",
				className: "Router",
				funcName: "registerRoute",
				paramName: "route"
			});
			finalAssertExports.hasMethod(route, "match", {
				moduleName: "serwist/legacy",
				className: "Router",
				funcName: "registerRoute",
				paramName: "route"
			});
			finalAssertExports.isType(route.handler, "object", {
				moduleName: "serwist/legacy",
				className: "Router",
				funcName: "registerRoute",
				paramName: "route"
			});
			finalAssertExports.hasMethod(route.handler, "handle", {
				moduleName: "serwist/legacy",
				className: "Router",
				funcName: "registerRoute",
				paramName: "route.handler"
			});
			finalAssertExports.isType(route.method, "string", {
				moduleName: "serwist/legacy",
				className: "Router",
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
	* @param route The route to unregister.
	*/
	unregisterRoute(route) {
		if (!this._routes.has(route.method)) throw new SerwistError("unregister-route-but-not-found-with-method", { method: route.method });
		const routeIndex = this._routes.get(route.method).indexOf(route);
		if (routeIndex > -1) this._routes.get(route.method).splice(routeIndex, 1);
		else throw new SerwistError("unregister-route-route-not-registered");
	}
};
//#endregion
//#region src/legacy/singletonRouter.ts
let defaultRouter;
/**
* Creates a new, singleton {@linkcode Router} if one does not exist. If one does
* already exist, that instance is returned. This instance is used by
* Serwist's {@linkcode Router}-dependent functions and classes unless you provide
* a different {@linkcode Router} to them.
*
* @returns The singleton {@linkcode Router}.
* @deprecated
*/
const getSingletonRouter = () => {
	if (!defaultRouter) {
		defaultRouter = new Router();
		defaultRouter.addFetchListener();
		defaultRouter.addCacheListener();
	}
	return defaultRouter;
};
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
const setSingletonRouter = (router) => {
	if (defaultRouter) {
		defaultRouter.removeFetchListener();
		defaultRouter.removeCacheListener();
	}
	defaultRouter = router;
	defaultRouter.addFetchListener();
	defaultRouter.addCacheListener();
	return defaultRouter;
};
//#endregion
//#region src/legacy/registerRoute.ts
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
const registerRoute = (capture, handler, method) => {
	return getSingletonRouter().registerCapture(capture, handler, method);
};
//#endregion
//#region src/legacy/addRoute.ts
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
const addRoute = (options) => {
	registerRoute(new PrecacheRoute(getSingletonPrecacheController(), options));
};
//#endregion
//#region src/legacy/createHandlerBoundToURL.ts
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
const createHandlerBoundToURL = (url) => {
	return getSingletonPrecacheController().createHandlerBoundToURL(url);
};
//#endregion
//#region src/legacy/PrecacheFallbackPlugin.ts
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
var PrecacheFallbackPlugin = class {
	_fallbackUrls;
	_precacheController;
	/**
	* Constructs a new instance with the associated `fallbackUrls`.
	*
	* @param config
	*/
	constructor({ fallbackUrls, precacheController }) {
		this._fallbackUrls = fallbackUrls;
		this._precacheController = precacheController || getSingletonPrecacheController();
	}
	/**
	* @returns The precache response for one of the fallback URLs, or `undefined` if
	* nothing satisfies the conditions.
	* @private
	*/
	async handlerDidError(param) {
		for (const fallback of this._fallbackUrls) if (typeof fallback === "string") {
			const fallbackResponse = await this._precacheController.matchPrecache(fallback);
			if (fallbackResponse !== void 0) return fallbackResponse;
		} else if (fallback.matcher(param)) {
			const fallbackResponse = await this._precacheController.matchPrecache(fallback.url);
			if (fallbackResponse !== void 0) return fallbackResponse;
		}
	}
};
//#endregion
//#region src/legacy/fallbacks.ts
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
const fallbacks = ({ precacheController = getSingletonPrecacheController(), router = getSingletonRouter(), runtimeCaching, entries, precacheOptions }) => {
	precacheController.precache(entries);
	router.registerRoute(new PrecacheRoute(precacheController, precacheOptions));
	const fallbackPlugin = new PrecacheFallbackPlugin({ fallbackUrls: entries });
	runtimeCaching.forEach((cacheEntry) => {
		if (cacheEntry.handler instanceof Strategy && !cacheEntry.handler.plugins.some((plugin) => "handlerDidError" in plugin)) cacheEntry.handler.plugins.push(fallbackPlugin);
	});
	return runtimeCaching;
};
//#endregion
//#region src/legacy/getCacheKeyForURL.ts
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
const getCacheKeyForURL = (url) => {
	return getSingletonPrecacheController().getCacheKeyForURL(url);
};
//#endregion
//#region src/legacy/handlePrecaching.ts
/**
* Handles a list of precache entries and cleans up outdated caches.
*
* @param options
* @deprecated
*/
const handlePrecaching = ({ precacheController = getSingletonPrecacheController(), router = getSingletonRouter(), precacheEntries, precacheOptions, cleanupOutdatedCaches: cleanupOutdatedCaches$1 = false, navigateFallback, navigateFallbackAllowlist, navigateFallbackDenylist }) => {
	if (!!precacheEntries && precacheEntries.length > 0) {
		precacheController.precache(precacheEntries);
		router.registerRoute(new PrecacheRoute(precacheController, precacheOptions));
		if (cleanupOutdatedCaches$1) cleanupOutdatedCaches();
		if (navigateFallback) router.registerRoute(new NavigationRoute(createHandlerBoundToURL(navigateFallback), {
			allowlist: navigateFallbackAllowlist,
			denylist: navigateFallbackDenylist
		}));
	}
};
//#endregion
//#region src/legacy/constants.ts
const QUEUE_NAME = "serwist-google-analytics";
const MAX_RETENTION_TIME = 2880;
const COLLECT_PATHS_REGEX = /^\/(\w+\/)?collect/;
//#endregion
//#region src/legacy/initializeGoogleAnalytics.ts
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
* @deprecated Use `serwist.initializeGoogleAnalytics` instead.
*/
const initializeGoogleAnalytics = ({ router = getSingletonRouter(), cacheName, ...options } = {}) => {
	const resolvedCacheName = cacheNames.getGoogleAnalyticsName(cacheName);
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
	for (const route of routes) router.registerRoute(route);
};
//#endregion
//#region src/legacy/registerRuntimeCaching.ts
/**
* Registers caching strategies to a singleton Router instance. It is a simple
* syntatic sugar for {@linkcode registerRoute}.
*
* @param runtimeCachingList
* @returns
* @deprecated
*/
const registerRuntimeCaching = (...runtimeCachingList) => {
	for (const entry of runtimeCachingList) registerRoute(entry.matcher, entry.handler, entry.method);
};
//#endregion
//#region src/legacy/installSerwist.ts
/**
* Abstracts away the core APIs of Serwist.
*
* @param options - `installSerwist` options.
* @deprecated
*/
const installSerwist = ({ precacheController = getSingletonPrecacheController(), router = getSingletonRouter(), precacheEntries, precacheOptions, cleanupOutdatedCaches, navigateFallback, navigateFallbackAllowlist, navigateFallbackDenylist, skipWaiting, importScripts, navigationPreload = false, cacheId, clientsClaim: clientsClaim$1 = false, runtimeCaching, offlineAnalyticsConfig, disableDevLogs: disableDevLogs$1 = false, fallbacks: fallbacks$1 }) => {
	if (!!importScripts && importScripts.length > 0) self.importScripts(...importScripts);
	if (navigationPreload) enableNavigationPreload();
	if (cacheId !== void 0) setCacheNameDetails({ prefix: cacheId });
	if (skipWaiting) self.skipWaiting();
	else self.addEventListener("message", (event) => {
		if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
	});
	if (clientsClaim$1) clientsClaim();
	handlePrecaching({
		precacheController,
		router,
		precacheEntries,
		precacheOptions,
		cleanupOutdatedCaches,
		navigateFallback,
		navigateFallbackAllowlist,
		navigateFallbackDenylist
	});
	if (runtimeCaching !== void 0) {
		if (fallbacks$1 !== void 0) runtimeCaching = fallbacks({
			precacheController,
			router,
			runtimeCaching,
			entries: fallbacks$1.entries,
			precacheOptions
		});
		registerRuntimeCaching(...runtimeCaching);
	}
	if (offlineAnalyticsConfig !== void 0) if (typeof offlineAnalyticsConfig === "boolean") offlineAnalyticsConfig && initializeGoogleAnalytics({ router });
	else initializeGoogleAnalytics({
		...offlineAnalyticsConfig,
		router
	});
	if (disableDevLogs$1) disableDevLogs();
};
//#endregion
//#region src/legacy/matchPrecache.ts
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
const matchPrecache = (request) => {
	return getSingletonPrecacheController().matchPrecache(request);
};
//#endregion
//#region src/legacy/precache.ts
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
const precache = (entries) => {
	getSingletonPrecacheController().precache(entries);
};
//#endregion
//#region src/legacy/precacheAndRoute.ts
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
const precacheAndRoute = (entries, options) => {
	precache(entries);
	addRoute(options);
};
//#endregion
//#region src/legacy/setCatchHandler.ts
/**
* If a route throws an error while handling a request, this handler
* will be called and given a chance to provide a response.
*
* @param handler A callback function that returns a promise resulting in a response.
* @deprecated
*/
const setCatchHandler = (handler) => {
	getSingletonRouter().setCatchHandler(handler);
};
//#endregion
//#region src/legacy/setDefaultHandler.ts
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
const setDefaultHandler = (handler) => {
	getSingletonRouter().setDefaultHandler(handler);
};
//#endregion
//#region src/legacy/unregisterRoute.ts
/**
* Unregisters a route from the singleton {@linkcode Router} instance.
*
* @param route The route to unregister.
* @deprecated
*/
const unregisterRoute = (route) => {
	getSingletonRouter().unregisterRoute(route);
};
//#endregion
export { PrecacheController, PrecacheFallbackPlugin, PrecacheRoute, Router, addPlugins, addRoute, createHandlerBoundToURL, fallbacks, getCacheKeyForURL, getSingletonPrecacheController, getSingletonRouter, handlePrecaching, initializeGoogleAnalytics, installSerwist, matchPrecache, precache, precacheAndRoute, registerRoute, registerRuntimeCaching, setCatchHandler, setDefaultHandler, setSingletonPrecacheController, setSingletonRouter, unregisterRoute };

//# sourceMappingURL=index.legacy.mjs.map