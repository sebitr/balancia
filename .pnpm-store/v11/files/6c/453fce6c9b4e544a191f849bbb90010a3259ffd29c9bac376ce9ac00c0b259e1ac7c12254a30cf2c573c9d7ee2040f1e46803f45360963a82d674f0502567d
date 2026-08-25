import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, RangeRequestsPlugin, StaleWhileRevalidate } from "serwist";
//#region src/index.worker.ts
const PAGES_CACHE_NAME = {
	rscPrefetch: "pages-rsc-prefetch",
	rsc: "pages-rsc",
	html: "pages"
};
/**
* The default, recommended list of caching strategies for applications
* built with Next.js.
*
* @see https://serwist.pages.dev/docs/next/worker-exports#default-cache
*/
const defaultCache = process.env.NODE_ENV !== "production" ? [{
	matcher: /.*/i,
	handler: new NetworkOnly()
}] : [
	{
		matcher: /^https:\/\/fonts\.(?:gstatic)\.com\/.*/i,
		handler: new CacheFirst({
			cacheName: "google-fonts-webfonts",
			plugins: [new ExpirationPlugin({
				maxEntries: 4,
				maxAgeSeconds: 365 * 24 * 60 * 60,
				maxAgeFrom: "last-used"
			})]
		})
	},
	{
		matcher: /^https:\/\/fonts\.(?:googleapis)\.com\/.*/i,
		handler: new StaleWhileRevalidate({
			cacheName: "google-fonts-stylesheets",
			plugins: [new ExpirationPlugin({
				maxEntries: 4,
				maxAgeSeconds: 10080 * 60,
				maxAgeFrom: "last-used"
			})]
		})
	},
	{
		matcher: /\.(?:eot|otf|ttc|ttf|woff|woff2|font.css)$/i,
		handler: new StaleWhileRevalidate({
			cacheName: "static-font-assets",
			plugins: [new ExpirationPlugin({
				maxEntries: 4,
				maxAgeSeconds: 10080 * 60,
				maxAgeFrom: "last-used"
			})]
		})
	},
	{
		matcher: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
		handler: new StaleWhileRevalidate({
			cacheName: "static-image-assets",
			plugins: [new ExpirationPlugin({
				maxEntries: 64,
				maxAgeSeconds: 720 * 60 * 60,
				maxAgeFrom: "last-used"
			})]
		})
	},
	{
		matcher: /\/_next\/static.+\.js$/i,
		handler: new CacheFirst({
			cacheName: "next-static-js-assets",
			plugins: [new ExpirationPlugin({
				maxEntries: 64,
				maxAgeSeconds: 1440 * 60,
				maxAgeFrom: "last-used"
			})]
		})
	},
	{
		matcher: /\/_next\/image\?url=.+$/i,
		handler: new StaleWhileRevalidate({
			cacheName: "next-image",
			plugins: [new ExpirationPlugin({
				maxEntries: 64,
				maxAgeSeconds: 1440 * 60,
				maxAgeFrom: "last-used"
			})]
		})
	},
	{
		matcher: /\.(?:mp3|wav|ogg)$/i,
		handler: new CacheFirst({
			cacheName: "static-audio-assets",
			plugins: [new ExpirationPlugin({
				maxEntries: 32,
				maxAgeSeconds: 1440 * 60,
				maxAgeFrom: "last-used"
			}), new RangeRequestsPlugin()]
		})
	},
	{
		matcher: /\.(?:mp4|webm)$/i,
		handler: new CacheFirst({
			cacheName: "static-video-assets",
			plugins: [new ExpirationPlugin({
				maxEntries: 32,
				maxAgeSeconds: 1440 * 60,
				maxAgeFrom: "last-used"
			}), new RangeRequestsPlugin()]
		})
	},
	{
		matcher: /\.(?:js)$/i,
		handler: new StaleWhileRevalidate({
			cacheName: "static-js-assets",
			plugins: [new ExpirationPlugin({
				maxEntries: 48,
				maxAgeSeconds: 1440 * 60,
				maxAgeFrom: "last-used"
			})]
		})
	},
	{
		matcher: /\.(?:css|less)$/i,
		handler: new StaleWhileRevalidate({
			cacheName: "static-style-assets",
			plugins: [new ExpirationPlugin({
				maxEntries: 32,
				maxAgeSeconds: 1440 * 60,
				maxAgeFrom: "last-used"
			})]
		})
	},
	{
		matcher: /\/_next\/data\/.+\/.+\.json$/i,
		handler: new NetworkFirst({
			cacheName: "next-data",
			plugins: [new ExpirationPlugin({
				maxEntries: 32,
				maxAgeSeconds: 1440 * 60,
				maxAgeFrom: "last-used"
			})]
		})
	},
	{
		matcher: /\.(?:json|xml|csv)$/i,
		handler: new NetworkFirst({
			cacheName: "static-data-assets",
			plugins: [new ExpirationPlugin({
				maxEntries: 32,
				maxAgeSeconds: 1440 * 60,
				maxAgeFrom: "last-used"
			})]
		})
	},
	{
		matcher: /\/api\/auth\/.*/,
		handler: new NetworkOnly({ networkTimeoutSeconds: 10 })
	},
	{
		matcher: ({ sameOrigin, url: { pathname } }) => sameOrigin && pathname.startsWith("/api/"),
		method: "GET",
		handler: new NetworkFirst({
			cacheName: "apis",
			plugins: [new ExpirationPlugin({
				maxEntries: 16,
				maxAgeSeconds: 1440 * 60,
				maxAgeFrom: "last-used"
			})],
			networkTimeoutSeconds: 10
		})
	},
	{
		matcher: ({ request, url: { pathname }, sameOrigin }) => request.headers.get("RSC") === "1" && request.headers.get("Next-Router-Prefetch") === "1" && sameOrigin && !pathname.startsWith("/api/"),
		handler: new NetworkFirst({
			cacheName: PAGES_CACHE_NAME.rscPrefetch,
			plugins: [new ExpirationPlugin({
				maxEntries: 32,
				maxAgeSeconds: 1440 * 60
			})]
		})
	},
	{
		matcher: ({ request, url: { pathname }, sameOrigin }) => request.headers.get("RSC") === "1" && sameOrigin && !pathname.startsWith("/api/"),
		handler: new NetworkFirst({
			cacheName: PAGES_CACHE_NAME.rsc,
			plugins: [new ExpirationPlugin({
				maxEntries: 32,
				maxAgeSeconds: 1440 * 60
			})]
		})
	},
	{
		matcher: ({ request, url: { pathname }, sameOrigin }) => request.headers.get("Content-Type")?.includes("text/html") && sameOrigin && !pathname.startsWith("/api/"),
		handler: new NetworkFirst({
			cacheName: PAGES_CACHE_NAME.html,
			plugins: [new ExpirationPlugin({
				maxEntries: 32,
				maxAgeSeconds: 1440 * 60
			})]
		})
	},
	{
		matcher: ({ url: { pathname }, sameOrigin }) => sameOrigin && !pathname.startsWith("/api/"),
		handler: new NetworkFirst({
			cacheName: "others",
			plugins: [new ExpirationPlugin({
				maxEntries: 32,
				maxAgeSeconds: 1440 * 60
			})]
		})
	},
	{
		matcher: ({ sameOrigin }) => !sameOrigin,
		handler: new NetworkFirst({
			cacheName: "cross-origin",
			plugins: [new ExpirationPlugin({
				maxEntries: 32,
				maxAgeSeconds: 3600
			})],
			networkTimeoutSeconds: 10
		})
	},
	{
		matcher: /.*/i,
		method: "GET",
		handler: new NetworkOnly()
	}
];
//#endregion
export { PAGES_CACHE_NAME, defaultCache };

//# sourceMappingURL=index.worker.mjs.map