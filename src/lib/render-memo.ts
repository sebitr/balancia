import "server-only";
import { cache } from "react";

/**
 * Remembers a read for the length of one server render, and no longer.
 *
 * This is React's `cache` under a name that says what it is for, and it is
 * the one door through which a domain module may reach it. The rule that keeps
 * React out of `src/modules` and `src/lib` exists so that the domain can be
 * tested and run from the worker without a request context — and `cache` asks
 * for none. Outside a render (a Server Action's body, a route handler, the
 * worker, a test) it calls straight through, so code written against it
 * behaves exactly as if it were not there.
 *
 * Inside a render it remembers by argument, so wrap functions of primitives
 * only: an object is compared by identity, and two callers holding equal
 * objects would each read anyway. Every render starts from nothing, including
 * the one Next.js runs after a Server Action, which is what makes it safe to
 * remember a read that an action may just have made stale.
 */
export const oncePerRender = cache;
