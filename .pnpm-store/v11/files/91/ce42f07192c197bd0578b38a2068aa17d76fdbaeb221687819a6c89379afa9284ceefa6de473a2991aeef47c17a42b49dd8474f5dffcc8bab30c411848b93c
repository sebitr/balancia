//#region src/utils/isCurrentPageOutOfScope.ts
const isCurrentPageOutOfScope = (scope) => {
	const scopeURL = new URL(scope, document.baseURI);
	const scopeURLBasePath = new URL("./", scopeURL.href).pathname;
	return !location.pathname.startsWith(scopeURLBasePath);
};
//#endregion
export { isCurrentPageOutOfScope as t };

//# sourceMappingURL=isCurrentPageOutOfScope-BF6DLxHk.js.map