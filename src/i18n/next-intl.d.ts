import type en from "../../messages/en.json";
import type { AppLocale } from "./locales";

/**
 * Binds the message catalogue to the type system.
 *
 * English is the reference catalogue: every key must exist there, so `t()`
 * calls are checked against it and a typo fails `pnpm typecheck` rather than
 * rendering a raw key in the UI. `messages.test.ts` keeps French in step.
 */
declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: typeof en;
  }
}
