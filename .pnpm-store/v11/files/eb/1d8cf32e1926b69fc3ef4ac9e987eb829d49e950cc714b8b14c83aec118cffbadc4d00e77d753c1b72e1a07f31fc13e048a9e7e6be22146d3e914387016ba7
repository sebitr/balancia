//#region src/utils/cacheNames.d.ts
interface PartialCacheNameDetails {
  /**
   * The string to add to the beginning of the precache and runtime cache names.
   */
  prefix?: string;
  /**
   * The string to add to the end of the precache and runtime cache names.
   */
  suffix?: string;
  /**
   * The cache name to use for precache caching.
   */
  precache?: string;
  /**
   * The cache name to use for runtime caching.
   */
  runtime?: string;
  /**
   * The cache name to use for {@linkcode initializeGoogleAnalytics}.
   */
  googleAnalytics?: string;
  [propName: string]: string | undefined;
}
declare const cacheNames: {
  updateDetails: (details: PartialCacheNameDetails) => void;
  getGoogleAnalyticsName: (userCacheName?: string) => string;
  getPrecacheName: (userCacheName?: string) => string;
  getPrefix: () => string;
  getRuntimeName: (userCacheName?: string) => string;
  getSuffix: () => string;
};
//#endregion
export { cacheNames as n, PartialCacheNameDetails as t };
//# sourceMappingURL=cacheNames-DlxxHRul.d.ts.map