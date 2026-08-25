import path from "node:path";
import { toUnix } from "@serwist/utils";
//#region src/lib/perform-child-compilation.ts
/**
* Perform a child compilation.
*
* @param compiler The parent webpack compiler.
* @param compilation The webpack compilation.
* @param name The name of the child compiler.
* @param src The source file. Should be absolute.
* @param dest The destination file. Should be relative to the compilation.
* @param plugins Additional webpack plugins.
*
* @private
*/
const performChildCompilation = async (compiler, compilation, name, src, dest, plugins) => {
	const childCompiler = compilation.createChildCompiler(name, { filename: dest }, plugins);
	new compiler.webpack.webworker.WebWorkerTemplatePlugin().apply(childCompiler);
	new compiler.webpack.EntryPlugin(compiler.context, src, name).apply(childCompiler);
	await new Promise((resolve, reject) => {
		childCompiler.runAsChild((error, _entries, childCompilation) => {
			if (error) reject(error);
			else {
				if (childCompilation?.warnings) compilation.warnings.push(...childCompilation.warnings);
				if (childCompilation?.errors) compilation.errors.push(...childCompilation.errors);
				resolve();
			}
		});
	});
};
//#endregion
//#region src/lib/relative-to-output-path.ts
/**
* @param compilation The webpack compilation.
* @param originalPath The original path value.
*
* @returns If path was not absolute, the returns path as-is.
* Otherwise, returns path relative to the compilation's output path.
*
* @private
*/
const relativeToOutputPath = (compilation, originalPath) => {
	if (path.resolve(originalPath) === path.normalize(originalPath)) return toUnix(path.relative(compilation.options.output.path, originalPath));
	return originalPath;
};
//#endregion
export { performChildCompilation as n, relativeToOutputPath as t };

//# sourceMappingURL=relative-to-output-path-XTbJJn_G.js.map