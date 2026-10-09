import type { AppLocale } from "@/i18n/locales";

/**
 * Every button the public pages count, as literal types.
 *
 * The same shape as `telemetry/events.ts`, for the same reason: there is no
 * `track(name, payload)` to hand a string to. An event is one of these or it
 * does not compile, and every value in one is a literal from the source — a
 * place on the page, a question's key, a language code. Nothing a reader
 * typed and nothing the database holds can be put in one, because no field
 * here has a type that would accept it.
 *
 * What they are for is one funnel: which page and which button the people who
 * create an account came through, and what the ones who did not were looking
 * at instead. `docs/telemetry.md` §17 lists them for an administrator
 * deciding whether to switch telemetry on.
 */

/** Where on a page the button sits. */
export type Placement =
  "header" | "hero" | "comparison" | "self-hosting" | "closing" | "footer";

/** The homepage's questions, by their key in `marketing.faq.items`. */
export type FaqQuestion =
  | "free"
  | "accounts"
  | "sharing"
  | "unequal"
  | "export"
  | "currency"
  | "privacy"
  | "splitwise"
  | "openSource"
  | "selfHost"
  | "devices"
  | "assistants"
  | "comparison";

export type PageEvent =
  /** "Create your account", wherever it appears. */
  | { name: "signup"; at: Placement }
  | { name: "sign-in"; at: Placement }
  | { name: "demo"; at: Placement }
  /** A link to the repository. */
  | { name: "source"; at: Placement }
  | { name: "self-hosting-guide"; at: Placement }
  /** The install commands were copied. */
  | { name: "install-copied" }
  /** A question was opened. */
  | { name: "faq"; question: FaqQuestion }
  | { name: "language"; to: AppLocale }
  /** A link to one of the comparison pages. */
  | { name: "comparison"; with: "splitwise" | "tricount"; at: Placement }
  /**
   * Somebody who arrived at `/register` with no invitation now has an
   * account. The one event the rest exist to explain.
   */
  | { name: "signup-completed" }
  /**
   * The same arrival chose no account, named a group and has its link: a
   * group exists that did not, and whoever made it is a guest in it.
   */
  | { name: "guest-group-started" };

/**
 * The attributes that mark an element as counted: `data-track` for the name,
 * `data-track-<field>` for the rest. Inert on their own — it is the bridge
 * script that reads them, and that is only on the page when telemetry is on.
 */
export function track(event: PageEvent): Record<string, string> {
  const { name, ...fields } = event;
  return {
    "data-track": name,
    ...Object.fromEntries(
      Object.entries(fields).map(([field, value]) => [
        `data-track-${field}`,
        value,
      ]),
    ),
  };
}

/**
 * Counts something that happened without a click to mark — an account coming
 * into being, say.
 *
 * Does nothing unless the tracker is on the page, which is only where
 * telemetry is on and only on a public page. And what it hands over still
 * passes the bridge's hook, which drops anything sent from an address that
 * is not on its list: calling this from inside the application counts
 * nothing, whatever the event.
 */
export function countPageEvent(event: PageEvent): void {
  if (typeof window === "undefined") return;
  const { name, ...fields } = event;
  try {
    (
      window as unknown as {
        umami?: { track: (name: string, data: Record<string, string>) => void };
      }
    ).umami?.track(name, fields);
  } catch {
    // A count that could not be sent is not worth a broken screen.
  }
}
