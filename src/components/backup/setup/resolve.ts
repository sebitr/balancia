import type { ProviderChoice } from "@/components/backup/provider-mark";
import { BACKUP_ERROR_CODES } from "@/modules/backup/errors";
import {
  isBackupProvider,
  PROVIDERS,
  type BackupProvider,
} from "@/modules/backup/providers";
import type { Frequency } from "@/modules/backup/schedule";
import type { ProviderTile } from "@/modules/backup/view";
import { OVERVIEW_PATH, setupUrl } from "./setup-url";
import {
  isSetupStep,
  type SetupPending,
  type SetupReplaced,
  type SetupStep,
  type SetupWizardProps,
} from "./types";

/**
 * Turns the address and what the server knows into the one screen to draw.
 *
 * Kept apart from the page so that every rule about which step a request may
 * land on can be tested without a request: a bookmark, a reload, a link typed
 * by hand and the OAuth return all arrive here as the same query string, and
 * only some of them are allowed to be where they say they are.
 */

type Query = Readonly<Record<string, string | string[] | undefined>>;

/** The facts of `loadBackupScreen` this needs, as plain values. */
export interface SetupFacts {
  readonly hasKey: boolean;
  readonly destinations: readonly {
    readonly id: string;
    readonly provider: BackupProvider;
    readonly frequency: Frequency;
    readonly keepLast: number;
    readonly excludedGroupIds: readonly string[];
    readonly includeReceipts: boolean;
  }[];
  readonly pending: SetupPending | null;
  readonly providers: readonly Pick<ProviderTile, "id" | "availability">[];
}

export type Resolution =
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "notFound" }
  | {
      readonly kind: "ok";
      readonly state: Omit<SetupWizardProps, "providers" | "ownedGroups">;
      /** Where the screen's own back arrow goes. */
      readonly backHref: string;
    };

/**
 * Words the OAuth return may leave in `?connect=`. An allowlist: the query
 * string is as easy to type as to be sent, and what it says is worded by this
 * screen, never echoed.
 */
const CONNECT_OUTCOMES: ReadonlySet<string> = new Set([
  "denied",
  "failed",
  "expired",
  "unavailable",
  ...BACKUP_ERROR_CODES,
  "invalidKey",
  "noKey",
  "tooMany",
  "notFound",
  "invalidDetails",
]);

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The provider the address names, if this server offers it right now. */
function offeredProvider(
  requested: string | undefined,
  providers: SetupFacts["providers"],
): ProviderChoice | null {
  if (!requested) return null;
  const available = (id: BackupProvider) =>
    providers.some(
      (tile) => tile.id === id && tile.availability === "available",
    );

  // Infomaniak is a choice between two services, not a provider: it is there
  // when both of the services it can turn into are.
  if (requested === "infomaniak") {
    return available("s3") && available("webdav") ? "infomaniak" : null;
  }
  return isBackupProvider(requested) && available(requested) ? requested : null;
}

export function kindOfChoice(choice: ProviderChoice): "oauth" | "credentials" {
  return choice === "infomaniak" ? "credentials" : PROVIDERS[choice].kind;
}

function replacedFrom(
  destination: SetupFacts["destinations"][number],
): SetupReplaced {
  return {
    id: destination.id,
    provider: destination.provider,
    frequency: destination.frequency,
    keepLast: destination.keepLast,
    excludedGroupIds: destination.excludedGroupIds,
    includeReceipts: destination.includeReceipts,
  };
}

export function resolveSetup(facts: SetupFacts, query: Query): Resolution {
  // A new key means nothing without an old one to stand in for.
  const rotate = first(query.rotate) === "1" && facts.hasKey;

  let replace: SetupReplaced | null = null;
  const replaceId = first(query.replace);
  if (replaceId) {
    const found = facts.destinations.find((d) => d.id === replaceId);
    if (!found) return { kind: "notFound" };
    replace = replacedFrom(found);
  }

  const pending = facts.pending;
  const connectedId = first(query.connected);
  const linked = Boolean(pending && connectedId && pending.id === connectedId);

  // The OAuth trip leaves the page, and `replace` is not something the provider
  // sends back. Somebody who already has a destination and comes back with a
  // fresh connection can only have been changing where to back up — the screens
  // offer no way to add a second one — so that is what it is.
  const only = facts.destinations.length === 1 ? facts.destinations[0] : null;
  if (linked && !replace && only) replace = replacedFrom(only);

  if (facts.destinations.length > 0 && !replace && !rotate && !linked) {
    return { kind: "redirect", to: OVERVIEW_PATH };
  }

  const provider = offeredProvider(first(query.provider), facts.providers);
  const connected =
    linked &&
    pending !== null &&
    provider !== null &&
    provider !== "infomaniak" &&
    pending.provider === provider;

  const flow: readonly SetupStep[] = rotate
    ? ["key"]
    : facts.hasKey
      ? ["where", "connect", "what"]
      : ["key", "where", "connect", "what"];

  const requested = first(query.step);
  let step: SetupStep = isSetupStep(requested) ? requested : flow[0];
  // The key is made first, and once it is saved it is not made again unless
  // somebody asked for a new one.
  if (!flow.includes(step)) step = flow[0];
  // And nothing past it can be finished without it: the first backup is
  // encrypted to the key, so a destination with none would be refused.
  if (!facts.hasKey) step = "key";
  if ((step === "connect" || step === "what") && provider === null) {
    step = "where";
  }
  // A connection by trip is proved by the connection that came back from it.
  // One by typing is proved by the form, which only the browser holds.
  if (step === "what" && provider && kindOfChoice(provider) === "oauth") {
    if (!connected) step = "connect";
  }

  const outcome = first(query.connect);

  const index = flow.indexOf(step);
  const backHref =
    index <= 0
      ? OVERVIEW_PATH
      : setupUrl({
          step: flow[index - 1],
          provider,
          connected: connected ? pending?.id : null,
          replace: replace?.id,
        });

  return {
    kind: "ok",
    backHref,
    state: {
      step,
      provider,
      hasKey: facts.hasKey,
      rotate,
      connected,
      connectOutcome: outcome && CONNECT_OUTCOMES.has(outcome) ? outcome : null,
      pending,
      replace,
    },
  };
}
