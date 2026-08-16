/**
 * Where anonymous reports go, as a constant.
 *
 * Compiled in rather than configured, and that is the point: an installation
 * decides *whether* it reports — `TELEMETRY_MODE`, plus an administrator's
 * switch, both defaulting to sending nothing — but not *where*. There is one
 * address, it is in this file, and reading this line is the whole of finding
 * out who a Balancia instance can talk to.
 *
 * What it rules out:
 *
 *  - An endpoint typed into the administration UI, which would be server-side
 *    request forgery with the instance's own network position.
 *  - An environment variable, which turns "who receives this" into something
 *    an operator can be talked into changing, and into a thing every reader of
 *    the documentation has to check before believing the rest of it.
 *
 * A fork changes this string. That is the intended way, it is one line, and
 * under the AGPL a fork is building from source anyway — so nothing is lost by
 * refusing to make it a runtime setting, and the honesty of the claim is
 * gained.
 *
 * HTTPS is not a validated rule here because there is nothing to validate: the
 * value is a literal, and `endpoint.test.ts` holds it to that.
 */
export const TELEMETRY_ENDPOINT = "https://telemetry.balancia.app";
