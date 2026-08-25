import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  Bell,
  CreditCard,
  Database,
  HelpCircle,
  Server,
  Shield,
  Users,
} from "lucide-react";
import { SettingsScreen } from "@/components/settings/settings-screen";
import {
  SettingsGroup,
  SettingsRows,
} from "@/components/settings/settings-card";
import { SettingsLinkRow } from "@/components/settings/settings-row";
import { IdentityCard } from "@/components/settings/identity-card";
import { AppearanceSummary } from "@/components/settings/appearance-summary";
import { SignOutButton } from "@/components/settings/sign-out-button";
import { getCurrentUser } from "@/lib/security/actor";
import { isInstanceAdmin } from "@/lib/security/admin";
import { appVersion } from "@/lib/telemetry/environment";
import { listPasskeys } from "@/modules/auth/webauthn";
import { getUserPreferredCurrency } from "@/modules/auth/service";
import { listGroupsForUser } from "@/modules/groups/service";
import { getPreferences } from "@/modules/notifications/service";
import { getAvatarVersion } from "@/modules/profile/avatar";
import { resolveFormatPreferences } from "@/i18n/preferences";
import { dateFormatSample } from "@/i18n/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("title") };
}

/**
 * The settings hub.
 *
 * Three short groups of rows, each row carrying the value it leads to. The
 * summary on the right is the point: someone opening settings to check whether
 * reminders are still on, or which currency their totals are in, reads the
 * answer on this screen and never taps. What used to answer those questions was
 * an avatar dropdown of nine destinations and three long pages of controls.
 *
 * Everything here is read on the server in one pass, because every summary is
 * a fact the server already holds — except the theme, which lives in the
 * browser and says so (see `AppearanceSummary`).
 */
export default async function SettingsHubPage() {
  const user = await getCurrentUser();
  // The layout redirected an unauthenticated caller; this narrows the type.
  if (!user) return null;

  const t = await getTranslations("userSettings");

  const [admin, passkeys, groups, preferences, currency, formats, photo] =
    await Promise.all([
      isInstanceAdmin(user.userId),
      listPasskeys(user.userId),
      listGroupsForUser(user.userId),
      getPreferences(user.userId),
      getUserPreferredCurrency(user.userId),
      resolveFormatPreferences(),
      getAvatarVersion(user.userId),
    ]);

  const categories = Object.values(preferences);
  const on = categories.filter(Boolean).length;

  const dateSummary =
    formats.dateFormat === "auto"
      ? t("automatic")
      : dateFormatSample(formats.dateFormat, formats.formatLocale);

  return (
    <SettingsScreen
      title={t("title")}
      close={{ href: "/dashboard", label: t("close") }}
    >
      <IdentityCard name={user.name} email={user.email} photoVersion={photo} />

      <SettingsGroup label={t("groupYou")}>
        <SettingsRows>
          <SettingsLinkRow
            href="/settings/notifications"
            icon={Bell}
            label={t("notifications")}
            summary={
              on === categories.length
                ? t("allOn")
                : t("someOn", { on, total: categories.length })
            }
          />
          <SettingsLinkRow
            href="/settings/security"
            icon={Shield}
            label={t("security")}
            summary={t("passkeyCount", { count: passkeys.length })}
          />
        </SettingsRows>
      </SettingsGroup>

      <SettingsGroup label={t("groupHowItReads")}>
        <SettingsRows>
          <AppearanceSummary />
          <SettingsLinkRow
            href="/settings/money"
            icon={CreditCard}
            label={t("money")}
            summary={`${currency ?? t("automatic")} · ${dateSummary}`}
          />
        </SettingsRows>
      </SettingsGroup>

      <SettingsGroup label={t("groupYourThings")}>
        <SettingsRows>
          <SettingsLinkRow
            href="/settings/groups"
            icon={Users}
            label={t("groups")}
            summary={String(groups.length)}
          />
          <SettingsLinkRow
            href="/settings/data"
            icon={Database}
            label={t("data")}
          />
        </SettingsRows>
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRows>
          {/* Hidden from everybody else. Presentation only: the screen behind
              it resolves the caller again, because a row that is not rendered
              is not a permission check. */}
          {admin && (
            <SettingsLinkRow
              href="/settings/admin"
              icon={Server}
              label={t("administration")}
              badge={
                <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-foreground/10 px-2 text-2xs font-semibold text-muted-foreground">
                  {t("adminBadge")}
                </span>
              }
            />
          )}
          <SettingsLinkRow
            href="/settings/help"
            icon={HelpCircle}
            label={t("help")}
            summary={appVersion()}
          />
        </SettingsRows>
      </SettingsGroup>

      <SignOutButton />
    </SettingsScreen>
  );
}
