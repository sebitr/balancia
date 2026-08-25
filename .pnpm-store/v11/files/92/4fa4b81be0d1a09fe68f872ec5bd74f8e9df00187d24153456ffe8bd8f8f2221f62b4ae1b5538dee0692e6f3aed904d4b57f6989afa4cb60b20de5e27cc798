import { getAcceptLanguageLocale } from './resolveLocale.js';

function syncCookie(request, response, locale, routing, domain) {
  if (!routing.localeCookie) return;

  // Only document requests indicate that the user is actually
  // navigating to a page—in contrast to background requests of the
  // client-side router like prefetches and cache revalidations.
  // E.g. as of Next.js 16.3, the router revalidates previously
  // visited routes after a navigation, including routes of a locale
  // the user has just switched away from. Updating the cookie based
  // on such a request would overwrite the locale that was just set
  // when switching the locale. Note that Next.js strips router
  // headers like `Next-Router-Prefetch` before invoking the
  // middleware, therefore `Sec-Fetch-Dest` is used to detect
  // background requests. Locale switches via a soft navigation
  // update the cookie on the client side.
  const secFetchDest = request.headers.get('sec-fetch-dest');
  if (secFetchDest != null && secFetchDest !== 'document') return;
  const {
    name,
    ...rest
  } = routing.localeCookie;
  const hasLocaleCookie = request.cookies.has(name);
  const hasOutdatedCookie = hasLocaleCookie && request.cookies.get(name)?.value !== locale;
  if (hasOutdatedCookie) {
    response.cookies.set(name, locale, {
      path: request.nextUrl.basePath || undefined,
      ...rest
    });
  } else if (!hasLocaleCookie) {
    const acceptLanguageLocale = getAcceptLanguageLocale(request.headers, domain?.locales || routing.locales, routing.defaultLocale);
    if (acceptLanguageLocale !== locale) {
      response.cookies.set(name, locale, {
        path: request.nextUrl.basePath || undefined,
        ...rest
      });
    }
  }
}

export { syncCookie as default };
