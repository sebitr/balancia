import { cache } from 'react';

// See https://github.com/vercel/next.js/discussions/58862
function getCacheImpl() {
  const value = {
    locale: undefined
  };
  return value;
}
const getCache = cache(getCacheImpl);
function getCachedRequestLocale() {
  return getCache().locale;
}

/**
 * @deprecated Please migrate to [`next/root-params`](https://next-intl.dev/blog/nextjs-root-params).
 */
function setCachedRequestLocale(locale) {
  getCache().locale = locale;
}

export { getCachedRequestLocale, setCachedRequestLocale };
