import { n as performChildCompilation, t as relativeToOutputPath } from "./chunks/relative-to-output-path-XTbJJn_G.js";
//#region src/lib/child-compilation-plugin.ts
/**
* Compile a file by creating a child of the hooked compiler.
*
* @private
*/
var ChildCompilationPlugin = class {
	src;
	dest;
	plugins;
	constructor({ src, dest, plugins }) {
		this.src = src;
		this.dest = dest;
		this.plugins = plugins;
	}
	/**
	* @param compiler default compiler object passed from webpack
	*
	* @private
	*/
	apply(compiler) {
		compiler.hooks.make.tapPromise(this.constructor.name, (compilation) => performChildCompilation(compiler, compilation, this.constructor.name, this.src, relativeToOutputPath(compilation, this.dest), this.plugins).catch((error) => {
			compilation.errors.push(error);
		}));
	}
};
//#endregion
export { ChildCompilationPlugin, relativeToOutputPath };

//# sourceMappingURL=index.internal.mjs.map