import { k as MapLikeObject } from "./chunks/types-BB8lYSAv.js";
import { n as cacheNames } from "./chunks/cacheNames-DlxxHRul.js";
//#region src/utils/assert.d.ts
declare const isArray: (value: any[], details: MapLikeObject) => void;
declare const hasMethod: (object: MapLikeObject, expectedMethod: string, details: MapLikeObject) => void;
declare const isType: (object: unknown, expectedType: string, details: MapLikeObject) => void;
declare const isInstance: (object: unknown, expectedClass: Function, details: MapLikeObject) => void;
declare const isOneOf: (value: any, validValues: any[], details: MapLikeObject) => void;
declare const isArrayOfClass: (value: any, expectedClass: Function, details: MapLikeObject) => void;
declare const finalAssertExports: {
  hasMethod: typeof hasMethod;
  isArray: typeof isArray;
  isInstance: typeof isInstance;
  isOneOf: typeof isOneOf;
  isType: typeof isType;
  isArrayOfClass: typeof isArrayOfClass;
} | null;
//#endregion
//#region src/utils/cacheMatchIgnoreParams.d.ts
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
declare function cacheMatchIgnoreParams(cache: Cache, request: Request, ignoreParams: string[], matchOptions?: CacheQueryOptions): Promise<Response | undefined>;
//#endregion
//#region src/utils/canConstructReadableStream.d.ts
/**
 * A utility function that determines whether the current browser supports
 * constructing a [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/ReadableStream)
 * object.
 *
 * @returns `true`, if the current browser can successfully construct a `ReadableStream`, `false` otherwise.
 *
 * @private
 */
declare function canConstructReadableStream(): boolean;
//#endregion
//#region src/utils/canConstructResponseFromBodyStream.d.ts
/**
 * A utility function that determines whether the current browser supports
 * constructing a new response from a `response.body` stream.
 *
 * @returns `true`, if the current browser can successfully construct
 * a response from a `response.body` stream, `false` otherwise.
 * @private
 */
declare function canConstructResponseFromBodyStream(): boolean;
//#endregion
//#region src/utils/cleanupOutdatedCaches.d.ts
/**
 * Adds an `activate` event listener which will clean up incompatible
 * precaches that were created by older versions of Serwist.
 */
declare const cleanupOutdatedCaches: (cacheName?: string) => void;
//#endregion
//#region src/utils/clientsClaim.d.ts
/**
 * Claims any currently available clients once the service worker
 * becomes active. This is normally used in conjunction with `skipWaiting()`.
 */
declare const clientsClaim: () => void;
//#endregion
//#region src/utils/Deferred.d.ts
/**
 * The Deferred class composes Promises in a way that allows for them to be
 * resolved or rejected from outside the constructor. In most cases promises
 * should be used directly, but Deferreds can be necessary when the logic to
 * resolve a promise must be separate.
 *
 * @private
 */
declare class Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  /**
   * Creates a promise and exposes its resolve and reject functions as methods.
   */
  constructor();
}
//#endregion
//#region src/utils/dontWaitFor.d.ts
/**
 * A helper function that prevents a promise from being flagged as unused.
 *
 * @private
 */
declare function dontWaitFor(promise: Promise<any>): void;
//#endregion
//#region src/utils/executeQuotaErrorCallbacks.d.ts
/**
 * Runs all of the callback functions, one at a time sequentially, in the order
 * in which they were registered.
 *
 * @private
 */
declare const executeQuotaErrorCallbacks: () => Promise<void>;
//#endregion
//#region src/utils/getFriendlyURL.d.ts
declare const getFriendlyURL: (url: URL | string) => string;
//#endregion
//#region src/utils/logger.d.ts
declare global {
  interface WorkerGlobalScope {
    __WB_DISABLE_DEV_LOGS: boolean;
  }
  interface Window {
    __WB_DISABLE_DEV_LOGS: boolean;
  }
}
/**
 * The logger used by Serwist inside of both service workers and the window global scope.
 *
 * Note: This is forcibly `null` in production mode to reduce bundle size. Do check whether
 * you are currently in development mode (by using `process.env.NODE_ENV !== "production"`)
 * before using it.
 */
declare const logger: {
  debug: (...args: any[]) => void;
  error: (...args: any[]) => void;
  groupCollapsed: (...args: any[]) => void;
  groupEnd: (...args: any[]) => void;
  log: (...args: any[]) => void;
  warn: (...args: any[]) => void;
};
//#endregion
//#region src/utils/resultingClientExists.d.ts
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
declare function resultingClientExists(resultingClientId?: string): Promise<Client | undefined>;
//#endregion
//#region src/models/messages/messages.d.ts
interface LoggableObject {
  [key: string]: string | number;
}
declare const messages: {
  "invalid-value": ({ paramName, validValueDescription, value }: LoggableObject) => string;
  "not-an-array": ({ moduleName, className, funcName, paramName }: LoggableObject) => string;
  "incorrect-type": ({ expectedType, paramName, moduleName, className, funcName }: LoggableObject) => string;
  "incorrect-class": ({ expectedClassName, paramName, moduleName, className, funcName, isReturnValueProblem }: LoggableObject) => string;
  "missing-a-method": ({ expectedMethod, paramName, moduleName, className, funcName }: LoggableObject) => string;
  "add-to-cache-list-unexpected-type": ({ entry }: LoggableObject) => string;
  "add-to-cache-list-conflicting-entries": ({ firstEntry, secondEntry }: LoggableObject) => string;
  "plugin-error-request-will-fetch": ({ thrownErrorMessage }: LoggableObject) => string;
  "invalid-cache-name": ({ cacheNameId, value }: LoggableObject) => string;
  "unregister-route-but-not-found-with-method": ({ method }: LoggableObject) => string;
  "unregister-route-route-not-registered": () => string;
  "queue-replay-failed": ({ name }: LoggableObject) => string;
  "duplicate-queue-name": ({ name }: LoggableObject) => string;
  "expired-test-without-max-age": ({ methodName, paramName }: LoggableObject) => string;
  "unsupported-route-type": ({ moduleName, className, funcName, paramName }: LoggableObject) => string;
  "not-array-of-class": ({ value, expectedClass, moduleName, className, funcName, paramName }: LoggableObject) => string;
  "max-entries-or-age-required": ({ moduleName, className, funcName }: LoggableObject) => string;
  "statuses-or-headers-required": ({ moduleName, className, funcName }: LoggableObject) => string;
  "invalid-string": ({ moduleName, funcName, paramName }: LoggableObject) => string;
  "channel-name-required": () => string;
  "invalid-responses-are-same-args": () => string;
  "expire-custom-caches-only": () => string;
  "unit-must-be-bytes": ({ normalizedRangeHeader }: LoggableObject) => string;
  "single-range-only": ({ normalizedRangeHeader }: LoggableObject) => string;
  "invalid-range-values": ({ normalizedRangeHeader }: LoggableObject) => string;
  "no-range-header": () => string;
  "range-not-satisfiable": ({ size, start, end }: LoggableObject) => string;
  "attempt-to-cache-non-get-request": ({ url, method }: LoggableObject) => string;
  "cache-put-with-no-response": ({ url }: LoggableObject) => string;
  "no-response": ({ url, error }: LoggableObject) => string;
  "bad-precaching-response": ({ url, status }: LoggableObject) => string;
  "non-precached-url": ({ url }: LoggableObject) => string;
  "add-to-cache-list-conflicting-integrities": ({ url }: LoggableObject) => string;
  "missing-precache-entry": ({ cacheName, url }: LoggableObject) => string;
  "cross-origin-copy-response": ({ origin }: LoggableObject) => string;
  "opaque-streams-source": ({ type }: LoggableObject) => string;
};
type MessageKey = keyof typeof messages;
//#endregion
//#region src/utils/SerwistError.d.ts
/**
 * Serwist errors should be thrown with this class.
 * This allows use to ensure the type easily in tests,
 * helps developers identify errors from Serwist
 * easily and allows use to optimise error
 * messages correctly.
 *
 * @private
 */
declare class SerwistError extends Error {
  details?: MapLikeObject;
  /**
   *
   * @param errorCode The error code that
   * identifies this particular error.
   * @param details Any relevant arguments
   * that will help developers identify issues should
   * be added as a key on the context object.
   */
  constructor(errorCode: MessageKey, details?: MapLikeObject);
}
//#endregion
//#region src/utils/timeout.d.ts
/**
 * Returns a promise that resolves and the passed number of milliseconds.
 * This utility is an async/await-friendly version of `setTimeout`.
 *
 * @param ms
 * @returns
 * @private
 */
declare function timeout(ms: number): Promise<unknown>;
//#endregion
//#region src/utils/waitUntil.d.ts
/**
 * A utility method that makes it easier to use `event.waitUntil` with
 * async functions and return the result.
 *
 * @param event
 * @param asyncFn
 * @returns
 * @private
 */
declare const waitUntil: <T = any>(event: ExtendableEvent, asyncFn: () => Promise<T>) => Promise<T>;
//#endregion
export { Deferred, SerwistError, finalAssertExports as assert, cacheMatchIgnoreParams, canConstructReadableStream, canConstructResponseFromBodyStream, cleanupOutdatedCaches, clientsClaim, dontWaitFor, executeQuotaErrorCallbacks, getFriendlyURL, logger, cacheNames as privateCacheNames, resultingClientExists, timeout, waitUntil };
//# sourceMappingURL=index.internal.d.mts.map