import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RestoreScreen } from "@/components/backup/restore/restore-screen";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { getCurrentUser } from "@/lib/security/actor";
import { PROVIDER_NAMES } from "@/modules/backup/providers";
import { loadBackupScreen } from "@/modules/backup/view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("cloudBackup");
  return { title: t("restore.title") };
}

/**
 * Settings → Cloud backup → Restore from a backup.
 *
 * The server's part is small on purpose: who the person is, and which cloud
 * they have connected, if any. Everything after that happens in their browser
 * — the file is fetched from the cloud through this server as ciphertext or
 * read from their disk, and the recovery key is typed into the page and never
 * leaves it. So the page passes down two plain facts and nothing that could
 * identify a backup, and there is no action here for a key to be sent to.
 *
 * Reachable with no cloud connected at all (the empty state links here for
 * somebody holding a file), which is why a missing destination is a normal
 * input and not a redirect.
 */
export default async function RestoreBackupPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const t = await getTranslations("cloudBackup");
  const screen = await loadBackupScreen(user.userId);

  // One destination is drawn anywhere in the screens. Were there more, the
  // oldest is the one this lists; the file route covers the rest.
  const [destination] = screen.destinations;

  return (
    <SettingsScreen
      title={t("restore.title")}
      back={{ href: "/settings/backup", label: t("title") }}
    >
      <RestoreScreen
        available={screen.available}
        destination={
          destination
            ? {
                id: destination.id,
                provider: PROVIDER_NAMES[destination.provider],
              }
            : null
        }
      />
    </SettingsScreen>
  );
}
