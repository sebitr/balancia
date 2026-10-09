import "server-only";
import { getDb, type Database } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { listGroupsForUser } from "@/modules/groups/service";
import {
  BACKUP_PROVIDERS,
  PROVIDERS,
  type BackupProvider,
  type ProviderKind,
} from "./providers";
import { KIND_OF, redirectUri } from "./oauth";
import { rcloneAvailable } from "./rclone";
import { estimateReceipts, type ReceiptEstimate } from "./receipts";
import {
  getBackupKey,
  listDestinations,
  MAX_DESTINATIONS_PER_USER,
  type BackupKeyView,
  type DestinationView,
} from "./service";
import { providerAvailability, instanceApp } from "./transport";

/**
 * Everything the cloud backup screen needs, read once on the server.
 *
 * One function so that the page, the settings hub's one-line summary and the
 * tests all look at the same facts, and so that none of them has to know which
 * of these live in the database, which in the environment and which in whether
 * a binary runs.
 */

export interface ProviderTile {
  readonly id: BackupProvider;
  readonly kind: ProviderKind;
  readonly experimental: boolean;
  /**
   * `available` — can be connected now.
   * `experimental_off` — Proton Drive on an instance that has not switched
   * experimental providers on; drawn disabled, as "not enabled on this server".
   *
   * A provider nothing offers at all (see `ProviderInfo.offered`) has no tile.
   * Google Drive, Dropbox and OneDrive are `available` on every server, whether
   * or not the operator registered an app: see `instanceApp`.
   */
  readonly availability: "available" | "experimental_off";
  /**
   * An account provider only: the operator registered an app that everybody on
   * this server can connect through, so one button does it. Without one the
   * person brings their own app and pastes its client ID and secret.
   */
  readonly instanceApp: boolean;
  /**
   * An account provider only: the address to register as the redirect when
   * creating an app, which is this server's and nobody else's.
   */
  readonly redirectUri: string | null;
}

export interface OwnedGroupRow {
  readonly id: string;
  readonly name: string;
  readonly participantCount: number;
  readonly archived: boolean;
  readonly lastActivityAt: Date | null;
}

export interface BackupScreen {
  /** False when rclone is not installed: the screen says so instead of offering a setup that cannot finish. */
  readonly available: boolean;
  readonly key: BackupKeyView | null;
  /** The destinations that exist: active, paused or waiting to be reconnected. */
  readonly destinations: readonly DestinationView[];
  /**
   * A connection the OAuth return made and step 4 has not finished, if there is
   * one. The wizard resumes at step 3 with it; the overview does not list it.
   */
  readonly pendingSetup: DestinationView | null;
  readonly canAddDestination: boolean;
  readonly providers: readonly ProviderTile[];
  /** Groups this person owns — the ones a backup can include. */
  readonly ownedGroups: readonly OwnedGroupRow[];
  /** What switching receipts on would send, over all the groups they own. */
  readonly receipts: ReceiptEstimate;
  /** Whether a backup may be pointed at the local network, so the form can say so. */
  readonly allowPrivateEndpoints: boolean;
}

export function providerTiles(): ProviderTile[] {
  return BACKUP_PROVIDERS.flatMap((id) => {
    const availability = providerAvailability(id);
    if (availability === "not_offered") return [];
    const account = PROVIDERS[id].kind === "oauth";
    return [
      {
        id,
        kind: PROVIDERS[id].kind,
        experimental: PROVIDERS[id].experimental,
        availability,
        instanceApp: instanceApp(id),
        redirectUri: account
          ? redirectUri(KIND_OF[id as keyof typeof KIND_OF])
          : null,
      },
    ];
  });
}

export async function loadBackupScreen(
  userId: string,
  options: { db?: Database } = {},
): Promise<BackupScreen> {
  const db = options.db ?? getDb();
  const [available, key, everything, groups, receipts] = await Promise.all([
    rcloneAvailable(),
    getBackupKey(userId, { db }),
    listDestinations(userId, { db }),
    listGroupsForUser(userId, { db }),
    estimateReceipts(userId, { db }),
  ]);

  const destinations = everything.filter(
    (destination) => destination.status !== "setup",
  );

  return {
    available,
    key: key
      ? { fingerprint: key.fingerprint, createdAt: key.createdAt }
      : null,
    destinations,
    pendingSetup:
      everything.find((destination) => destination.status === "setup") ?? null,
    canAddDestination: destinations.length < MAX_DESTINATIONS_PER_USER,
    providers: providerTiles(),
    ownedGroups: groups
      .filter((group) => group.role === "owner")
      .map((group) => ({
        id: group.id,
        name: group.name,
        participantCount: group.participantCount,
        archived: group.archivedAt !== null,
        lastActivityAt: group.lastActivityAt ?? null,
      })),
    receipts,
    allowPrivateEndpoints: getEnv().BACKUP_ALLOW_PRIVATE_ENDPOINTS,
  };
}

/**
 * The hub row's one line: nothing set up, how it is going, or that it needs a
 * hand. Kept to facts the hub already has the cheap way of reading — no
 * rclone, no estimates — because it is drawn on every visit to settings.
 */
export type BackupSummary =
  | { readonly state: "none" }
  | {
      readonly state: "on";
      readonly frequency: "daily" | "weekly";
      readonly labels: readonly string[];
    }
  | { readonly state: "attention"; readonly reason: "reconnect" | "failing" }
  | { readonly state: "paused" };

export async function loadBackupSummary(
  userId: string,
  options: { db?: Database } = {},
): Promise<BackupSummary> {
  const destinations = (await listDestinations(userId, options)).filter(
    (destination) => destination.status !== "setup",
  );
  if (destinations.length === 0) return { state: "none" };

  const needy = destinations.find((destination) => destination.attention);
  if (needy?.attention) return { state: "attention", reason: needy.attention };

  const running = destinations.filter(
    (destination) => destination.status === "active",
  );
  const [first] = running;
  if (!first) return { state: "paused" };
  return {
    state: "on",
    frequency: first.frequency,
    labels: running.map((destination) => destination.label),
  };
}
