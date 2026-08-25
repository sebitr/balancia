import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { rebasePath } from "@serwist/build";
import { browserslistToEsbuild } from "@serwist/utils";
import browserslist from "browserslist";
import { MODERN_BROWSERSLIST_TARGET, PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants.js";
//#endregion
//#region src/lib/config/utils.ts
const nextConfig = (/* @__PURE__ */ (() => createRequire(import.meta.url))())("next/dist/server/config.js");
const loadNextConfig = (cwd, isDev) => {
	const nextPhase = isDev ? PHASE_DEVELOPMENT_SERVER : PHASE_PRODUCTION_BUILD;
	return nextConfig.default(nextPhase, cwd, { silent: false });
};
const generateGlobPatterns = (distDir) => [`${distDir}static/**/*.{js,css,html,ico,apng,png,avif,jpg,jpeg,jfif,pjpeg,pjp,gif,svg,webp,json,webmanifest}`, "public/**/*"];
//#endregion
//#region src/index.config.ts
const _cwd = process.cwd();
const _isDev = process.env.NODE_ENV === "development";
const serwist = async (options, nextConfig, { cwd = _cwd, isDev = _isDev } = {}) => {
	if (!nextConfig) nextConfig = await loadNextConfig(cwd, isDev);
	const basePath = nextConfig.basePath || "/";
	let distDir = nextConfig.distDir;
	if (distDir[0] === "/") distDir = distDir.slice(1);
	if (distDir[distDir.length - 1] !== "/") distDir += "/";
	const distServerDir = `${distDir}server/`;
	const distAppDir = `${distServerDir}app/`;
	const distPagesDir = `${distServerDir}pages/`;
	const { precachePrerendered = true, globDirectory = cwd, ...cliOptions } = options;
	for (const file of [cliOptions.swDest, `${cliOptions.swDest}.map`]) fs.rmSync(file, { force: true });
	return {
		dontCacheBustURLsMatching: new RegExp(`^${distDir}static/`),
		disablePrecacheManifest: isDev,
		...cliOptions,
		globDirectory,
		globPatterns: [...cliOptions.globPatterns ?? generateGlobPatterns(distDir), ...precachePrerendered ? [`${distServerDir}{app,pages}/**/*.html`] : []],
		globIgnores: [
			`${distAppDir}**/_not-found.html`,
			`${distAppDir}_global-error*`,
			`${distPagesDir}404.html`,
			`${distPagesDir}500.html`,
			...cliOptions.globIgnores ?? [],
			rebasePath({
				baseDirectory: globDirectory,
				file: cliOptions.swSrc
			}),
			rebasePath({
				baseDirectory: globDirectory,
				file: cliOptions.swDest
			}),
			rebasePath({
				baseDirectory: globDirectory,
				file: `${cliOptions.swDest}.map`
			})
		],
		manifestTransforms: [...cliOptions.manifestTransforms ?? [], (manifestEntries) => {
			return {
				manifest: manifestEntries.map((m) => {
					if (m.url.startsWith(distAppDir)) m.url = m.url.slice(distAppDir.length - 1);
					if (m.url.startsWith(distPagesDir)) m.url = m.url.slice(distPagesDir.length - 1);
					if (m.url.endsWith(".html")) {
						if (m.url.endsWith("/index.html")) m.url = m.url.slice(0, m.url.lastIndexOf("/") + 1);
						else m.url = m.url.substring(0, m.url.lastIndexOf("."));
						m.url = path.posix.join(basePath, m.url);
					}
					if (m.url.startsWith(distDir)) m.url = `${nextConfig.assetPrefix ?? ""}/_next/${m.url.slice(distDir.length)}`;
					if (m.url.startsWith("public/")) m.url = path.posix.join(basePath, m.url.slice(7));
					return m;
				}),
				warnings: []
			};
		}],
		esbuildOptions: {
			...cliOptions.esbuildOptions,
			target: cliOptions.esbuildOptions?.target ?? browserslistToEsbuild(browserslist, cwd, MODERN_BROWSERSLIST_TARGET)
		}
	};
};
serwist.withNextConfig = async (optionsFunction, { cwd = _cwd, isDev = _isDev } = {}) => {
	const nextConfig = await loadNextConfig(cwd, isDev);
	return serwist(await optionsFunction(nextConfig), nextConfig, {
		cwd,
		isDev
	});
};
//#endregion
export { generateGlobPatterns, serwist };

//# sourceMappingURL=index.config.mjs.map