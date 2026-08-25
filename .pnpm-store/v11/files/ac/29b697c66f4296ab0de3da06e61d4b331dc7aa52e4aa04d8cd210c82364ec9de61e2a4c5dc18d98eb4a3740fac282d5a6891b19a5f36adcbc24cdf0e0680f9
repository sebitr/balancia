import { B as RouteHandler, U as RouteHandlerObject, W as RouteMatchCallback, tt as HTTPMethod } from "./types-BB8lYSAv.js";
//#region src/Route.d.ts
/**
 * A `Route` consists of a pair of callback functions, `match` and `handler`.
 * The `match` callback determines if a route should be used to handle a
 * request by returning a truthy value if it can. The `handler` callback
 * is called when the route matches and should return a promise that resolves
 * to a response.
 */
declare class Route {
  handler: RouteHandlerObject;
  match: RouteMatchCallback;
  method: HTTPMethod;
  catchHandler?: RouteHandlerObject;
  /**
   * Constructor for Route class.
   *
   * @param match A callback function that determines whether the
   * route matches a given `fetch` event by returning a truthy value.
   * @param handler A callback function that returns a `Promise` resolving
   * to a `Response`.
   * @param method The HTTP method to match the route against. Defaults
   * to `GET`.
   */
  constructor(match: RouteMatchCallback, handler: RouteHandler, method?: HTTPMethod);
  /**
   *
   * @param handler A callback function that returns a Promise resolving
   * to a Response.
   */
  setCatchHandler(handler: RouteHandler): void;
}
//#endregion
export { Route as t };
//# sourceMappingURL=Route-BfRIuMhK.d.ts.map