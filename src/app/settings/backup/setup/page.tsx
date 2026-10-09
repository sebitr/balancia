import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Cloud } from "lucide-react";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { EmptyState } from "@/components/ui/empty-state";
import { resolveSetup } from "@/components/backup/setup/resolve";
import { SetupWizard } from "@/components/backup/setup/setup-wizard";
import { OVERVIEW_PATH } from "@/components/backup/setup/setup-url";
import { getCurrentUser } from "@/lib/security/actor";
import { loadBackupScreen } from "@/modules/backup/view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("cloudBackup");
  return { title: t("setup.title") };
}

/**
 * Settings → Cloud backup → Set up.
 *
 * Four steps on one address (`?step=key|where|connect|what`), or one when a
 * new recovery key is being made (`?rotate=1`). This page decides which of
 * them a request may land on — `resolveSetup` has the rules — and hands the
 * wizard plain values to draw it with. Everything the person decides after
 * that is held by the wizard, in the browser, until the last button.
 *
 * Someone who already has a destination is sent to the overview unless they
 * came to change it (`replace`), to make a new key (`rotate`), or back from a
 * provider with a connection to finish (`connected`).
 */
export default async function BackupSetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;

  const t = await getTranslations("cloudBackup");
  const [screen, query] = await Promise.all([
    loadBackupScreen(user.userId),
    searchParams,
  ]);

  if (!screen.available) {
    return (
      <SettingsScreen
        title={t("setup.title")}
        back={{ href: OVERVIEW_PATH, label: t("setup.back") }}
      >
        <EmptyState
          icon={Cloud}
          title={t("overview.unavailable")}
          description={t("error.unavailable")}
        />
      </SettingsScreen>
    );
  }

  const resolution = resolveSetup(
    {
      hasKey: screen.key !== null,
      destinations: screen.destinations,
      pending: screen.pendingSetup && {
        id: screen.pendingSetup.id,
        provider: screen.pendingSetup.provider,
        label: screen.pendingSetup.label,
      },
      providers: screen.providers,
    },
    query,
  );
  if (resolution.kind === "redirect") redirect(resolution.to);
  if (resolution.kind === "notFound") notFound();

  const { state, backHref } = resolution;

  return (
    <SettingsScreen
      title={state.rotate ? t("rotate.newTitle") : t("setup.title")}
      back={{ href: backHref, label: t("setup.back") }}
    >
      <SetupWizard
        {...state}
        providers={screen.providers}
        ownedGroups={screen.ownedGroups.map((group) => ({
          id: group.id,
          name: group.name,
          participantCount: group.participantCount,
          lastActivityAt: group.lastActivityAt?.toISOString() ?? null,
        }))}
      />
    </SettingsScreen>
  );
}
