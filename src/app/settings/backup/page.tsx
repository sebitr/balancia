import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CircleAlert, CloudOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { BackupEmptyState } from "@/components/backup/overview/empty-state";
import { BackupOverview } from "@/components/backup/overview/backup-overview";
import { errorCopy } from "@/components/backup/error-copy";
import { getCurrentUser } from "@/lib/security/actor";
import { BACKUP_ERROR_CODES } from "@/modules/backup/errors";
import { PROVIDER_NAMES } from "@/modules/backup/providers";
import { listRuns } from "@/modules/backup/service";
import { loadBackupScreen } from "@/modules/backup/view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("cloudBackup");
  return { title: t("title") };
}

/**
 * What the OAuth return may redirect back with after a reconnect that did not
 * work: the outcomes the callback names, and the codes a failure is worded
 * from. An allowlist, because `?connect=` is as easy to type as to be sent and
 * is shown to the reader as a sentence.
 */
const CONNECT_OUTCOMES = new Set<string>([
  "denied",
  "failed",
  "expired",
  "unavailable",
  ...BACKUP_ERROR_CODES,
]);

/**
 * What a failed reconnect says. `denied` is the one outcome with sentences of
 * its own; the rest are a backup error code, worded as a failed run is, or one
 * of the callback's words for "it did not work", which read as the general one.
 */
function connectFailure(
  t: Awaited<ReturnType<typeof getTranslations<"cloudBackup">>>,
  outcome: string,
  provider: string,
): { title: string | null; text: string } {
  if (outcome === "denied") {
    return {
      title: t("connect.deniedTitle"),
      text: t("connect.denied", { provider }),
    };
  }
  const code = (BACKUP_ERROR_CODES as readonly string[]).includes(outcome)
    ? outcome
    : "unknown";
  const copy = errorCopy(t, code, provider);
  return {
    title: null,
    text: copy.hint ? `${copy.sentence} ${copy.hint}` : copy.sentence,
  };
}

/**
 * Settings → Cloud backup.
 *
 * Before anything is set up, the reasons and the way in; after, the one
 * destination — its facts, its one button, Manage, History — with a banner above
 * it when something needs the owner. Everything is read here in one pass and
 * handed to the client components as plain data, because the page is the only
 * thing that knows who is asking; the actions behind the controls resolve the
 * caller again, as they must.
 *
 * The backend allows several destinations and the screens draw one. If more
 * than one exists — which these screens cannot make — each is its own set of
 * cards, so nothing is hidden.
 *
 * `?reconnected=1` is the OAuth return after a good reconnect: there is nothing
 * to say, because the screen now simply looks healthy. `?connect=<code>` is one
 * that failed, and is said above the card.
 */
export default async function BackupSettingsPage({
  searchParams,
}: PageProps<"/settings/backup">) {
  const user = await getCurrentUser();
  if (!user) return null;

  const [t, tSettings, screen, query] = await Promise.all([
    getTranslations("cloudBackup"),
    getTranslations("userSettings"),
    loadBackupScreen(user.userId),
    searchParams,
  ]);

  const back = { href: "/settings", label: tSettings("backToSettings") };

  if (!screen.available) {
    return (
      <SettingsScreen title={t("title")} back={back}>
        <EmptyState
          icon={CloudOff}
          title={t("overview.unavailable")}
          description={t("error.unavailable")}
        />
      </SettingsScreen>
    );
  }

  if (screen.destinations.length === 0) {
    return (
      <SettingsScreen title={t("title")} back={back}>
        <BackupEmptyState
          startHref={
            screen.key
              ? "/settings/backup/setup?step=where"
              : "/settings/backup/setup?step=key"
          }
          ownsGroups={screen.ownedGroups.length > 0}
        />
      </SettingsScreen>
    );
  }

  const now = new Date().toISOString();
  const groups = screen.ownedGroups.map((group) => ({
    id: group.id,
    name: group.name,
    participantCount: group.participantCount,
    lastActivityAt: group.lastActivityAt,
  }));

  const details = await Promise.all(
    screen.destinations.map(async (destination) => ({
      destination,
      runs: await listRuns(user.userId, destination.id, { limit: 10 }),
    })),
  );

  // A failed reconnect, said in the sentences the screen already has.
  const connect = typeof query.connect === "string" ? query.connect : null;
  const subject = screen.destinations[0];
  const failure =
    connect && subject && CONNECT_OUTCOMES.has(connect)
      ? connectFailure(t, connect, PROVIDER_NAMES[subject.provider])
      : null;

  return (
    <SettingsScreen title={t("title")} back={back}>
      {failure && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          {failure.title && <AlertTitle>{failure.title}</AlertTitle>}
          <AlertDescription>{failure.text}</AlertDescription>
        </Alert>
      )}

      {details.map(({ destination, runs }) => (
        <BackupOverview
          key={destination.id}
          destination={destination}
          runs={runs}
          groups={groups}
          keyFingerprint={screen.key?.fingerprint ?? null}
          now={now}
        />
      ))}
    </SettingsScreen>
  );
}
