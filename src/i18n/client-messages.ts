import type { Messages } from "next-intl";

/**
 * Which messages reach the browser, and which provider carries them there.
 *
 * `NextIntlClientProvider` with no `messages` hands its subtree whatever the
 * request config returned, which was the whole catalogue: every page, the
 * homepage and the join link included, carried every string the app has in
 * its RSC payload — the marketing copy to a group screen, the email templates
 * to the sign-in page, and the entry form's four hundred strings to a visitor
 * who had not signed up yet. A Server Component renders its own strings and
 * sends only the result, so the only messages the browser needs are the ones
 * a Client Component asks for with `useTranslations`.
 *
 * So each provider is handed a list:
 *
 *  - The root provider (`app/layout.tsx`) carries `ROOT_NAMESPACES`: what
 *    Client Components ask for in more than one part of the app, or in a part
 *    that has no provider of its own.
 *  - An area's provider (`AreaMessages`, mounted where that area begins)
 *    carries the root's list plus its own. A namespace only one area reads
 *    goes there, and every other page stops paying for it. A nested provider
 *    replaces the one above it rather than adding to it, which is why an
 *    area's provider repeats the root's list.
 *  - The offline screen carries `OFFLINE_NAMESPACES`, in every language, and
 *    nothing else: it is prerendered at build time and picks its language in
 *    the browser — see `components/pwa/offline-notice.tsx`.
 *
 * A path may be a whole namespace or a subtree of one, when a Client Component
 * reads only that subtree: `marketing` is fifteen kilobytes and the homepage's
 * one interactive block reads two corners of it.
 *
 * `client-messages.test.ts` holds this to the code. It follows every import
 * from every `"use client"` file, works out which provider each one renders
 * under, and fails on a `useTranslations` namespace that provider does not
 * carry — which is otherwise a string rendered as its own key, on a screen
 * nobody tested in that language. It also fails on a listed path no Client
 * Component reads any more, so the lists shrink when the code does.
 */

/**
 * Carried to every page: what Client Components outside every area ask for —
 * the dashboard, the settings screens, the error boundary, the shell — which
 * every area then inherits.
 */
export const ROOT_NAMESPACES: readonly string[] = [
  "adminTelemetry",
  "apiTokens",
  "appleAccount",
  "auth.errors",
  "auth.validation",
  "common",
  "countries",
  "currencyPicker",
  "dashboard",
  "emailChange",
  "errorBoundary",
  "groupForm",
  "inviteLink",
  "money",
  // The desktop sidebar, on every signed-in screen — Home's as much as a
  // group's — and the group rows it shares with the phone's switcher.
  "nav",
  "notificationSettings",
  "notificationsPage",
  // The command palette, which ⌘K opens over every signed-in screen, as the
  // sidebar's Search does.
  "palette",
  "passkeys",
  "paymentMethods",
  "payouts",
  "pwa",
  "settingsPage",
  "share",
  "theme",
  "userSettings",
];

/**
 * Carried only inside an area, on top of `ROOT_NAMESPACES`.
 *
 * `marketing` is mounted by the homepage, `auth` by the `(auth)` layout,
 * `onboarding` by the three screens the onboarding flow runs on, and `group`
 * by the group layout, which guests reach too. A namespace two areas read and
 * nothing outside them does, like `group`, is listed in both rather than
 * carried everywhere.
 */
export const AREA_NAMESPACES = {
  marketing: ["marketing.demo", "marketing.selfHosting.install"],
  auth: [
    "auth.apple",
    "auth.signIn",
    "demo",
    "forgotPassword",
    "register",
    "resetPassword",
    "serverErrors",
  ],
  onboarding: ["group", "joinError", "onboarding"],
  group: [
    "activity.restore",
    "addEntry",
    "dangerZone",
    "exchangeRate",
    "expenses",
    "expensesList",
    "group",
    "groupSettings",
    "groupStats",
    "importWizard",
    "memberStats",
    "membersPage",
    "outbox",
    "receiptScanner",
    "receipts",
    "recurring",
    "recurringActions",
    "remind",
    "settleUp",
    "timezoneSelect",
    "transactionDetail.delete",
    "transactionDetail.gone",
  ],
} as const satisfies Record<string, readonly string[]>;

export type MessageArea = keyof typeof AREA_NAMESPACES;

/**
 * What the offline screen needs, in every language: its own copy, and what
 * the entry form it opens asks for — the receipt scanner's strings included,
 * because the form imports the scanner even where it is switched off.
 */
export const OFFLINE_NAMESPACES: readonly string[] = [
  "addEntry",
  "common",
  "countries",
  "currencyPicker",
  "exchangeRate",
  "expenses",
  "offline",
  "paymentMethods",
  "receiptScanner",
  "receipts",
  // The confirmation a recurring entry is saved with, or changed with, and the
  // words its schedule is shown in — which the form reads whether or not it
  // can save one from here.
  "recurring.saved",
  "recurring.schedule",
  "recurring.updated",
];

/**
 * Part of a catalogue: any namespace, or any subtree of one, may be missing.
 * The same shape `NextIntlClientProvider` accepts for its `messages`.
 */
export type PartialMessages<Tree = Messages> = {
  [Key in keyof Tree]?: Tree[Key] extends object
    ? PartialMessages<Tree[Key]>
    : Tree[Key];
};

type Node = { [key: string]: Node | string };

/**
 * The listed paths of a catalogue, and nothing else.
 *
 * Whole subtrees are carried by reference rather than copied: two providers
 * in one render that carry the same namespace hand React the same object for
 * it, and a subtree already carried whole by a shorter path is not written
 * into again — which would be writing into the catalogue itself.
 */
export function pickMessages<Tree extends object>(
  messages: Tree,
  paths: readonly string[],
): PartialMessages<Tree> {
  const picked: Node = {};
  for (const path of paths) {
    const keys = path.split(".");
    let from: Node | string | undefined = messages as unknown as Node;
    let into = picked;
    for (const [index, key] of keys.entries()) {
      if (typeof from !== "object") break;
      const value: Node | string | undefined = from[key];
      if (value === undefined) break;
      if (index === keys.length - 1) {
        into[key] = value;
        break;
      }
      const existing = into[key];
      if (existing === value) break;
      if (typeof existing !== "object") into[key] = {};
      into = into[key] as Node;
      from = value;
    }
  }
  return picked as PartialMessages<Tree>;
}

/** The messages a provider for `area` — or the root, with none — carries. */
export function clientMessages(
  messages: Messages,
  area?: MessageArea,
): PartialMessages {
  return pickMessages(
    messages,
    area ? [...ROOT_NAMESPACES, ...AREA_NAMESPACES[area]] : ROOT_NAMESPACES,
  );
}
