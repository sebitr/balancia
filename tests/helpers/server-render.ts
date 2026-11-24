import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";

/**
 * React's server `cache`, and a way to run code as one server render.
 *
 * `oncePerRender` is React's `cache`, and the `react` a test resolves is the
 * client build, where `cache` is a bare pass-through — so a test that counts
 * reads would pass with the memo missing and prove nothing. This loads the
 * server build instead and gives it the one piece of the Flight renderer that
 * `cache` consults: a dispatcher whose `getCacheForType` answers from the
 * current render's map, or from a fresh map when there is no render at all.
 * It is the renderer's `DefaultAsyncDispatcher` line for line, as in
 * `tests/integration/request-scoped-reads.test.ts`, which explains it at
 * length.
 *
 * Use it from `vi.hoisted`, and mock `react` with the `cache` it returns:
 *
 *     const render = await vi.hoisted(async () =>
 *       (await import("../../../tests/helpers/server-render")).serverRender(),
 *     );
 *     vi.mock("react", async (importOriginal) => ({
 *       ...(await importOriginal<typeof import("react")>()),
 *       cache: render.cache,
 *     }));
 */
export function serverRender() {
  const require = createRequire(import.meta.url);
  const serverReact = require(
    require
      .resolve("react/package.json")
      .replace(/package\.json$/, "react.react-server.js"),
  ) as {
    cache: typeof import("react").cache;
    __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
      A: unknown;
    };
  };

  const current = new AsyncLocalStorage<Map<unknown, unknown>>();
  serverReact.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.A =
    {
      getCacheForType(resourceType: () => unknown) {
        const cache = current.getStore() ?? new Map();
        let entry = cache.get(resourceType);
        if (entry === undefined) {
          entry = resourceType();
          cache.set(resourceType, entry);
        }
        return entry;
      },
    };

  return {
    cache: serverReact.cache,
    /** Runs `body` as one server render, with a memo of its own. */
    inRender<T>(body: () => Promise<T>): Promise<T> {
      return current.run(new Map(), body);
    },
  };
}
