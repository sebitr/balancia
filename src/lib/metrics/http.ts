import {
  httpDuration,
  httpRequests,
  secondsSince,
  statusClass,
} from "./metrics";

/**
 * Times one route handler.
 *
 * Wraps the *body* of a handler rather than replacing the exported function,
 * so every route keeps the signature Next.js type-checks it against and the
 * route label stays a literal written next to the route it describes:
 *
 *     export async function GET(request: NextRequest) {
 *       return trackRoute("/api/rates", "GET", () => handle(request));
 *     }
 *
 * The label is the *template*, never `request.url`. A real path carries group
 * and attachment identifiers, which would put them in a metric label, in
 * memory, and in whatever the operator's Prometheus federates to. That is the
 * one mistake this file exists to prevent.
 *
 * Errors are re-thrown untouched and are not reported from here: Next.js
 * already routes them to `onRequestError` in `src/instrumentation.ts`, which is
 * where crash classification happens, once.
 */
export async function trackRoute(
  route: string,
  method: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  const startedAt = performance.now();
  try {
    const response = await handler();
    observe(route, method, statusClass(response.status), startedAt);
    return response;
  } catch (error) {
    observe(route, method, "5xx", startedAt);
    throw error;
  }
}

function observe(
  route: string,
  method: string,
  status: string,
  startedAt: number,
): void {
  httpDuration().observe(secondsSince(startedAt), { route, method });
  httpRequests().increment({ route, method, status });
}
