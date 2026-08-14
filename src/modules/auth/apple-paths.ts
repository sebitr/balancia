/**
 * The two Apple endpoint paths, and nothing else.
 *
 * They live apart from apple.ts because three unrelated places need them and
 * only one of those may import server code: the callback path is registered
 * with Apple as the Services ID's return URL *and* exempted from the
 * cross-origin check in proxy.ts, while the start path is the href of a button
 * that renders in the browser. A literal repeated in three files is a literal
 * that will eventually be changed in two.
 *
 * Keep this module free of imports so it stays safe on either side.
 */

export const APPLE_START_PATH = "/api/auth/apple/start";
export const APPLE_CALLBACK_PATH = "/api/auth/apple/callback";
