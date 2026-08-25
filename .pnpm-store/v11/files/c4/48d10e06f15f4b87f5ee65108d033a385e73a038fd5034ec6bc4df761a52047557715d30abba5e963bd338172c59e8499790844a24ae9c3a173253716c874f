//#region src/utils/cacheNames.ts
const _cacheNameDetails = {
	googleAnalytics: "googleAnalytics",
	precache: "precache-v2",
	prefix: "serwist",
	runtime: "runtime",
	suffix: typeof registration !== "undefined" ? registration.scope : ""
};
const _createCacheName = (cacheName) => {
	return [
		_cacheNameDetails.prefix,
		cacheName,
		_cacheNameDetails.suffix
	].filter((value) => value && value.length > 0).join("-");
};
const eachCacheNameDetail = (fn) => {
	for (const key of Object.keys(_cacheNameDetails)) fn(key);
};
const cacheNames = {
	updateDetails: (details) => {
		eachCacheNameDetail((key) => {
			const detail = details[key];
			if (typeof detail === "string") _cacheNameDetails[key] = detail;
		});
	},
	getGoogleAnalyticsName: (userCacheName) => {
		return userCacheName || _createCacheName(_cacheNameDetails.googleAnalytics);
	},
	getPrecacheName: (userCacheName) => {
		return userCacheName || _createCacheName(_cacheNameDetails.precache);
	},
	getPrefix: () => {
		return _cacheNameDetails.prefix;
	},
	getRuntimeName: (userCacheName) => {
		return userCacheName || _createCacheName(_cacheNameDetails.runtime);
	},
	getSuffix: () => {
		return _cacheNameDetails.suffix;
	}
};
//#endregion
//#region src/utils/canConstructResponseFromBodyStream.ts
let supportStatus;
/**
* A utility function that determines whether the current browser supports
* constructing a new response from a `response.body` stream.
*
* @returns `true`, if the current browser can successfully construct
* a response from a `response.body` stream, `false` otherwise.
* @private
*/
function canConstructResponseFromBodyStream() {
	if (supportStatus === void 0) {
		const testResponse = new Response("");
		if ("body" in testResponse) try {
			new Response(testResponse.body);
			supportStatus = true;
		} catch {
			supportStatus = false;
		}
		supportStatus = false;
	}
	return supportStatus;
}
//#endregion
//#region src/models/messages/messages.ts
const messages = {
	"invalid-value": ({ paramName, validValueDescription, value }) => {
		if (!paramName || !validValueDescription) throw new Error(`Unexpected input to 'invalid-value' error.`);
		return `The '${paramName}' parameter was given a value with an unexpected value. ${validValueDescription} Received a value of ${JSON.stringify(value)}.`;
	},
	"not-an-array": ({ moduleName, className, funcName, paramName }) => {
		if (!moduleName || !className || !funcName || !paramName) throw new Error(`Unexpected input to 'not-an-array' error.`);
		return `The parameter '${paramName}' passed into '${moduleName}.${className}.${funcName}()' must be an array.`;
	},
	"incorrect-type": ({ expectedType, paramName, moduleName, className, funcName }) => {
		if (!expectedType || !paramName || !moduleName || !funcName) throw new Error(`Unexpected input to 'incorrect-type' error.`);
		return `The parameter '${paramName}' passed into '${moduleName}.${className ? `${className}.` : ""}${funcName}()' must be of type ${expectedType}.`;
	},
	"incorrect-class": ({ expectedClassName, paramName, moduleName, className, funcName, isReturnValueProblem }) => {
		if (!expectedClassName || !moduleName || !funcName) throw new Error(`Unexpected input to 'incorrect-class' error.`);
		const classNameStr = className ? `${className}.` : "";
		if (isReturnValueProblem) return `The return value from '${moduleName}.${classNameStr}${funcName}()' must be an instance of class ${expectedClassName}.`;
		return `The parameter '${paramName}' passed into '${moduleName}.${classNameStr}${funcName}()' must be an instance of class ${expectedClassName}.`;
	},
	"missing-a-method": ({ expectedMethod, paramName, moduleName, className, funcName }) => {
		if (!expectedMethod || !paramName || !moduleName || !className || !funcName) throw new Error(`Unexpected input to 'missing-a-method' error.`);
		return `${moduleName}.${className}.${funcName}() expected the '${paramName}' parameter to expose a '${expectedMethod}' method.`;
	},
	"add-to-cache-list-unexpected-type": ({ entry }) => {
		return `An unexpected entry was passed to 'serwist.Serwist.addToPrecacheList()' The entry '${JSON.stringify(entry)}' isn't supported. You must supply an array of strings with one or more characters, objects with a url property or Request objects.`;
	},
	"add-to-cache-list-conflicting-entries": ({ firstEntry, secondEntry }) => {
		if (!firstEntry || !secondEntry) throw new Error("Unexpected input to 'add-to-cache-list-duplicate-entries' error.");
		return `Two of the entries passed to 'serwist.Serwist.addToPrecacheList()' had the URL ${firstEntry} but different revision details. Serwist is unable to cache and version the asset correctly. Please remove one of the entries.`;
	},
	"plugin-error-request-will-fetch": ({ thrownErrorMessage }) => {
		if (!thrownErrorMessage) throw new Error("Unexpected input to 'plugin-error-request-will-fetch', error.");
		return `An error was thrown by a plugin's 'requestWillFetch()' method. The thrown error message was: '${thrownErrorMessage}'.`;
	},
	"invalid-cache-name": ({ cacheNameId, value }) => {
		if (!cacheNameId) throw new Error(`Expected a 'cacheNameId' for error 'invalid-cache-name'`);
		return `You must provide a name containing at least one character for setCacheDetails({${cacheNameId}: '...'}). Received a value of '${JSON.stringify(value)}'`;
	},
	"unregister-route-but-not-found-with-method": ({ method }) => {
		if (!method) throw new Error("Unexpected input to 'unregister-route-but-not-found-with-method' error.");
		return `The route you're trying to unregister was not  previously registered for the method type '${method}'.`;
	},
	"unregister-route-route-not-registered": () => {
		return "The route you're trying to unregister was not previously registered.";
	},
	"queue-replay-failed": ({ name }) => {
		return `Replaying the background sync queue '${name}' failed.`;
	},
	"duplicate-queue-name": ({ name }) => {
		return `The queue name '${name}' is already being used. All instances of 'serwist.BackgroundSyncQueue' must be given unique names.`;
	},
	"expired-test-without-max-age": ({ methodName, paramName }) => {
		return `The '${methodName}()' method can only be used when the '${paramName}' is used in the constructor.`;
	},
	"unsupported-route-type": ({ moduleName, className, funcName, paramName }) => {
		return `The supplied '${paramName}' parameter was an unsupported type. Please check the docs for ${moduleName}.${className}.${funcName} for valid input types.`;
	},
	"not-array-of-class": ({ value, expectedClass, moduleName, className, funcName, paramName }) => {
		return `The supplied '${paramName}' parameter must be an array of '${expectedClass}' objects. Received '${JSON.stringify(value)},'. Please check the call to ${moduleName}.${className}.${funcName}() to fix the issue.`;
	},
	"max-entries-or-age-required": ({ moduleName, className, funcName }) => {
		return `You must define either 'config.maxEntries' or 'config.maxAgeSeconds' in '${moduleName}.${className}.${funcName}'`;
	},
	"statuses-or-headers-required": ({ moduleName, className, funcName }) => {
		return `You must define either 'config.statuses' or 'config.headers' in '${moduleName}.${className}.${funcName}'`;
	},
	"invalid-string": ({ moduleName, funcName, paramName }) => {
		if (!paramName || !moduleName || !funcName) throw new Error(`Unexpected input to 'invalid-string' error.`);
		return `When using strings, the '${paramName}' parameter must start with 'http' (for cross-origin matches) or '/' (for same-origin matches). Please see the docs for ${moduleName}.${funcName}() for more info.`;
	},
	"channel-name-required": () => {
		return "You must provide a channelName to construct a BroadcastCacheUpdate instance.";
	},
	"invalid-responses-are-same-args": () => {
		return "The arguments passed into responsesAreSame() appear to be invalid. Please ensure valid Responses are used.";
	},
	"expire-custom-caches-only": () => {
		return "You must provide a 'cacheName' property when using the expiration plugin with a runtime caching strategy.";
	},
	"unit-must-be-bytes": ({ normalizedRangeHeader }) => {
		if (!normalizedRangeHeader) throw new Error(`Unexpected input to 'unit-must-be-bytes' error.`);
		return `The 'unit' portion of the Range header must be set to 'bytes'. The Range header provided was "${normalizedRangeHeader}"`;
	},
	"single-range-only": ({ normalizedRangeHeader }) => {
		if (!normalizedRangeHeader) throw new Error(`Unexpected input to 'single-range-only' error.`);
		return `Multiple ranges are not supported. Please use a  single start value, and optional end value. The Range header provided was "${normalizedRangeHeader}"`;
	},
	"invalid-range-values": ({ normalizedRangeHeader }) => {
		if (!normalizedRangeHeader) throw new Error(`Unexpected input to 'invalid-range-values' error.`);
		return `The Range header is missing both start and end values. At least one of those values is needed. The Range header provided was "${normalizedRangeHeader}"`;
	},
	"no-range-header": () => {
		return "No Range header was found in the Request provided.";
	},
	"range-not-satisfiable": ({ size, start, end }) => {
		return `The start (${start}) and end (${end}) values in the Range are not satisfiable by the cached response, which is ${size} bytes.`;
	},
	"attempt-to-cache-non-get-request": ({ url, method }) => {
		return `Unable to cache '${url}' because it is a '${method}' request and only 'GET' requests can be cached.`;
	},
	"cache-put-with-no-response": ({ url }) => {
		return `There was an attempt to cache '${url}' but the response was not defined.`;
	},
	"no-response": ({ url, error }) => {
		let message = `The strategy could not generate a response for '${url}'.`;
		if (error) message += ` The underlying error is ${error}.`;
		return message;
	},
	"bad-precaching-response": ({ url, status }) => {
		return `The precaching request for '${url}' failed${status ? ` with an HTTP status of ${status}.` : "."}`;
	},
	"non-precached-url": ({ url }) => {
		return `'createHandlerBoundToURL("${url}")' was called, but that URL is not precached. Please pass in a URL that is precached instead.`;
	},
	"add-to-cache-list-conflicting-integrities": ({ url }) => {
		return `Two of the entries passed to 'serwist.Serwist.addToPrecacheList()' had the URL ${url} with different integrity values. Please remove one of them.`;
	},
	"missing-precache-entry": ({ cacheName, url }) => {
		return `Unable to find a precached response in ${cacheName} for ${url}.`;
	},
	"cross-origin-copy-response": ({ origin }) => {
		return `'@serwist/core.copyResponse()' can only be used with same-origin responses. It was passed a response with origin ${origin}.`;
	},
	"opaque-streams-source": ({ type }) => {
		const message = `One of the '@serwist/streams' sources resulted in an '${type}' response.`;
		if (type === "opaqueredirect") return `${message} Please do not use a navigation request that results in a redirect as a source.`;
		return `${message} Please ensure your sources are CORS-enabled.`;
	}
};
//#endregion
//#region src/models/messages/messageGenerator.ts
const fallback = (code, ...args) => {
	let msg = code;
	if (args.length > 0) msg += ` :: ${JSON.stringify(args)}`;
	return msg;
};
const generatorFunction = (code, details = {}) => {
	const message = messages[code];
	if (!message) throw new Error(`Unable to find message for code '${code}'.`);
	return message(details);
};
const messageGenerator = process.env.NODE_ENV === "production" ? fallback : generatorFunction;
//#endregion
//#region src/utils/SerwistError.ts
/**
* Serwist errors should be thrown with this class.
* This allows use to ensure the type easily in tests,
* helps developers identify errors from Serwist
* easily and allows use to optimise error
* messages correctly.
*
* @private
*/
var SerwistError = class extends Error {
	details;
	/**
	*
	* @param errorCode The error code that
	* identifies this particular error.
	* @param details Any relevant arguments
	* that will help developers identify issues should
	* be added as a key on the context object.
	*/
	constructor(errorCode, details) {
		const message = messageGenerator(errorCode, details);
		super(message);
		this.name = errorCode;
		this.details = details;
	}
};
//#endregion
//#region src/utils/assert.ts
const isArray = (value, details) => {
	if (!Array.isArray(value)) throw new SerwistError("not-an-array", details);
};
const hasMethod = (object, expectedMethod, details) => {
	if (typeof object[expectedMethod] !== "function") {
		details.expectedMethod = expectedMethod;
		throw new SerwistError("missing-a-method", details);
	}
};
const isType = (object, expectedType, details) => {
	if (typeof object !== expectedType) {
		details.expectedType = expectedType;
		throw new SerwistError("incorrect-type", details);
	}
};
const isInstance = (object, expectedClass, details) => {
	if (!(object instanceof expectedClass)) {
		details.expectedClassName = expectedClass.name;
		throw new SerwistError("incorrect-class", details);
	}
};
const isOneOf = (value, validValues, details) => {
	if (!validValues.includes(value)) {
		details.validValueDescription = `Valid values are ${JSON.stringify(validValues)}.`;
		throw new SerwistError("invalid-value", details);
	}
};
const isArrayOfClass = (value, expectedClass, details) => {
	const error = new SerwistError("not-array-of-class", details);
	if (!Array.isArray(value)) throw error;
	for (const item of value) if (!(item instanceof expectedClass)) throw error;
};
const finalAssertExports = process.env.NODE_ENV === "production" ? null : {
	hasMethod,
	isArray,
	isInstance,
	isOneOf,
	isType,
	isArrayOfClass
};
//#endregion
//#region src/utils/getFriendlyURL.ts
const getFriendlyURL = (url) => {
	return new URL(String(url), location.href).href.replace(new RegExp(`^${location.origin}`), "");
};
//#endregion
//#region src/utils/logger.ts
/**
* The logger used by Serwist inside of both service workers and the window global scope.
*
* Note: This is forcibly `null` in production mode to reduce bundle size. Do check whether
* you are currently in development mode (by using `process.env.NODE_ENV !== "production"`)
* before using it.
*/
const logger = process.env.NODE_ENV === "production" || typeof self === "undefined" ? null : (() => {
	if (!("__WB_DISABLE_DEV_LOGS" in globalThis)) self.__WB_DISABLE_DEV_LOGS = false;
	let inGroup = false;
	const methodToColorMap = {
		debug: "#7f8c8d",
		log: "#2ecc71",
		warn: "#f39c12",
		error: "#c0392b",
		groupCollapsed: "#3498db",
		groupEnd: null
	};
	const print = (method, args) => {
		if (self.__WB_DISABLE_DEV_LOGS) return;
		if (method === "groupCollapsed") {
			if (typeof navigator !== "undefined" && /^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
				console[method](...args);
				return;
			}
		}
		const styles = [
			`background: ${methodToColorMap[method]}`,
			"border-radius: 0.5em",
			"color: white",
			"font-weight: bold",
			"padding: 2px 0.5em"
		];
		const logPrefix = inGroup ? [] : ["%cserwist", styles.join(";")];
		console[method](...logPrefix, ...args);
		if (method === "groupCollapsed") inGroup = true;
		if (method === "groupEnd") inGroup = false;
	};
	return Object.keys(methodToColorMap).reduce((api, method) => {
		api[method] = (...args) => {
			print(method, args);
		};
		return api;
	}, {});
})();
//#endregion
//#region src/utils/timeout.ts
/**
* Returns a promise that resolves and the passed number of milliseconds.
* This utility is an async/await-friendly version of `setTimeout`.
*
* @param ms
* @returns
* @private
*/
function timeout(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
//#endregion
//#region src/models/quotaErrorCallbacks.ts
const quotaErrorCallbacks = /* @__PURE__ */ new Set();
//#endregion
//#region src/utils/cacheMatchIgnoreParams.ts
function stripParams(fullURL, ignoreParams) {
	const strippedURL = new URL(fullURL);
	for (const param of ignoreParams) strippedURL.searchParams.delete(param);
	return strippedURL.href;
}
/**
* Matches an item in the cache, ignoring specific URL params. This is similar
* to the `ignoreSearch` option, but it allows you to ignore just specific
* params (while continuing to match on the others).
*
* @private
* @param cache
* @param request
* @param matchOptions
* @param ignoreParams
* @returns
*/
async function cacheMatchIgnoreParams(cache, request, ignoreParams, matchOptions) {
	const strippedRequestURL = stripParams(request.url, ignoreParams);
	if (request.url === strippedRequestURL) return cache.match(request, matchOptions);
	const keysOptions = {
		...matchOptions,
		ignoreSearch: true
	};
	const cacheKeys = await cache.keys(request, keysOptions);
	for (const cacheKey of cacheKeys) if (strippedRequestURL === stripParams(cacheKey.url, ignoreParams)) return cache.match(cacheKey, matchOptions);
}
//#endregion
//#region src/utils/Deferred.ts
/**
* The Deferred class composes Promises in a way that allows for them to be
* resolved or rejected from outside the constructor. In most cases promises
* should be used directly, but Deferreds can be necessary when the logic to
* resolve a promise must be separate.
*
* @private
*/
var Deferred = class {
	promise;
	resolve;
	reject;
	/**
	* Creates a promise and exposes its resolve and reject functions as methods.
	*/
	constructor() {
		this.promise = new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}
};
//#endregion
//#region src/utils/executeQuotaErrorCallbacks.ts
/**
* Runs all of the callback functions, one at a time sequentially, in the order
* in which they were registered.
*
* @private
*/
const executeQuotaErrorCallbacks = async () => {
	if (process.env.NODE_ENV !== "production") logger.log(`About to run ${quotaErrorCallbacks.size} callbacks to clean up caches.`);
	for (const callback of quotaErrorCallbacks) {
		await callback();
		if (process.env.NODE_ENV !== "production") logger.log(callback, "is complete.");
	}
	if (process.env.NODE_ENV !== "production") logger.log("Finished running callbacks.");
};
//#endregion
//#region src/utils/deleteOutdatedCaches.ts
const SUBSTRING_TO_FIND = "-precache-";
/**
* Cleans up incompatible precaches that were created by older versions of
* Serwist, by a service worker registered under the current scope.
*
* This is meant to be called as part of the `activate` event.
*
* This should be safe to use as long as you don't include `substringToFind`
* (defaulting to `-precache-`) in your non-precache cache names.
*
* @param currentPrecacheName The cache name currently in use for
* precaching. This cache won't be deleted.
* @param substringToFind Cache names which include this
* substring will be deleted (excluding `currentPrecacheName`).
* @returns A list of all the cache names that were deleted.
* @private
*/
const deleteOutdatedCaches = async (currentPrecacheName, substringToFind = SUBSTRING_TO_FIND) => {
	const cacheNamesToDelete = (await self.caches.keys()).filter((cacheName) => {
		return cacheName.includes(substringToFind) && cacheName.includes(self.registration.scope) && cacheName !== currentPrecacheName;
	});
	await Promise.all(cacheNamesToDelete.map((cacheName) => self.caches.delete(cacheName)));
	return cacheNamesToDelete;
};
//#endregion
//#region src/utils/cleanupOutdatedCaches.ts
/**
* Adds an `activate` event listener which will clean up incompatible
* precaches that were created by older versions of Serwist.
*/
const cleanupOutdatedCaches = (cacheName) => {
	self.addEventListener("activate", (event) => {
		event.waitUntil(deleteOutdatedCaches(cacheNames.getPrecacheName(cacheName)).then((cachesDeleted) => {
			if (process.env.NODE_ENV !== "production") {
				if (cachesDeleted.length > 0) logger.log("The following out-of-date precaches were cleaned up automatically:", cachesDeleted);
			}
		}));
	});
};
//#endregion
//#region src/utils/clientsClaim.ts
/**
* Claims any currently available clients once the service worker
* becomes active. This is normally used in conjunction with `skipWaiting()`.
*/
const clientsClaim = () => {
	self.addEventListener("activate", () => self.clients.claim());
};
//#endregion
//#region src/utils/waitUntil.ts
/**
* A utility method that makes it easier to use `event.waitUntil` with
* async functions and return the result.
*
* @param event
* @param asyncFn
* @returns
* @private
*/
const waitUntil = (event, asyncFn) => {
	const returnPromise = asyncFn();
	event.waitUntil(returnPromise);
	return returnPromise;
};
//#endregion
export { Deferred as a, timeout as c, finalAssertExports as d, SerwistError as f, executeQuotaErrorCallbacks as i, logger as l, cacheNames as m, clientsClaim as n, cacheMatchIgnoreParams as o, canConstructResponseFromBodyStream as p, cleanupOutdatedCaches as r, quotaErrorCallbacks as s, waitUntil as t, getFriendlyURL as u };

//# sourceMappingURL=waitUntil-BDu76Zx7.js.map