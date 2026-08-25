"use client";
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { forwardRef } from 'react';
import { useLocale } from 'use-intl';
import syncLocaleCookie from './syncLocaleCookie.js';
import { jsx } from 'react/jsx-runtime';

// Somehow the types for `next/link` don't work as expected
// when `moduleResolution: "nodenext"` is used.
const Link = NextLink;

// Links that change the locale are handled in a separate component,
// since reading the pathname (necessary for syncing the locale cookie)
// requires a Suspense boundary when Cache Components are used. Due to
// this split, regular links are not subject to this requirement.
function LocaleChangingLink({
  curLocale,
  linkRef,
  locale,
  localeCookie,
  onClick,
  prefetch,
  ...rest
}) {
  // The types aren't entirely correct here. Outside of Next.js
  // `usePathname` can be called, but the return type is `null`.
  const pathname = usePathname();
  function onLinkClick(event) {
    // Even though we force a prefix when changing locales,
    // this could be a cache hit of the client-side router,
    // therefore we sync the cookie to ensure it's up to date.
    syncLocaleCookie(localeCookie, pathname, curLocale, locale);
    if (onClick) onClick(event);
  }
  if (prefetch && "development" !== 'production') {
    console.error('The `prefetch` prop is currently not supported when using the `locale` prop on `Link` to switch the locale.`');
  }
  return /*#__PURE__*/jsx(Link, {
    ref: linkRef,
    hrefLang: locale,
    onClick: onLinkClick,
    prefetch: false,
    ...rest
  });
}
function BaseLink({
  locale,
  localeCookie,
  ...rest
}, ref) {
  const curLocale = useLocale();
  const isChangingLocale = locale != null && locale !== curLocale;
  if (isChangingLocale) {
    return /*#__PURE__*/jsx(LocaleChangingLink, {
      curLocale: curLocale,
      linkRef: ref,
      locale: locale,
      localeCookie: localeCookie,
      ...rest
    });
  }
  return /*#__PURE__*/jsx(Link, {
    ref: ref,
    ...rest
  });
}
var BaseLink$1 = /*#__PURE__*/forwardRef(BaseLink);

export { BaseLink$1 as default };
