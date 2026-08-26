import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  ArrowLeftRight,
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
import { PayoutsSummary } from "@/components/settings/payouts-summary";
import { SignOutButton } from "@/components/settings/sign-out-button";
import { getCurrentUser } from "@/lib/security/actor";
import { isInstanceAdmin } from "@/lib/security/admin";
import { appVersion } from "@/lib/telemetry/environment";
import { listPasskeys } from "@/modules/auth/webauthn";
import { getUserPreferredCurrency } from "@/modules/auth/service";
import { listGroupsForUser } from "@/modules/groups/service";
import { getPreferences } from "@/modules/notifications/service";
import { listPayoutMethods } from "@/modules/payouts/service";
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
 * Five short groups of rows, each row carrying the value it leads to. The
 * summary on the right is the point: someone opening settings to check whether
 * reminders are still on, which currency their totals are in, or whether their
 * IBAN is still on the account, reads the answer on this screen and never taps.
 * What used to answer those questions was an avatar dropdown of nine
 * destinations and three long pages of controls.
 *
 * How you are paid back is its own group rather than a card at the bottom of
 * the notation screen. It is the one thing in settings a stranger reads, and it
 * is the one whose summary is worth drawing rather than writing — three marks
 * say which methods are on the account faster than any sentence.
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

  const [
    admin,
    passkeys,
    groups,
    preferences,
    currency,
    formats,
    payouts,
    photo,
  ] = await Promise.all([
    isInstanceAdmin(user.userId),
    listPasskeys(user.userId),
    listGroupsForUser(user.userId),
    getPreferences(user.userId),
    getUserPreferredCurrency(user.userId),
    resolveFormatPreferences(),
    listPayoutMethods(user.userId),
    getAvatarVersion(user.userId),
  ]);

  const categories = Object.values(preferences);
  const on = categories.filter(Boolean).length;

  // The resolved sample rather than the word "Automatic", even where nothing
  // was chosen: the row exists to answer "how will my money read", and the
  // answer is a date, not the name of a setting. It is also the shorter of the
  // two, which is what keeps the label beside it from truncating.
  const dateSummary = dateFormatSample(
    formats.dateFormat,
    formats.formatLocale,
  );

  return (
    <SettingsScreen
      title={t("title")}
      close={{ href: "/dashboard", label: t("close") }}
    >
      <IdentityCard name={user.name} email={user.email} photoVersion={photo} />

      <SettingsGroup label={t("groupAccount")}>
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

      <SettingsGroup label={t("groupPayments")}>
        <SettingsRows>
          <SettingsLinkRow
            href="/settings/payouts"
            icon={ArrowLeftRight}
            label={t("payouts")}
            accent
            trailing={
              <PayoutsSummary methods={payouts.map((entry) => entry.method)} />
            }
          />
        </SettingsRows>
      </SettingsGroup>

      <SettingsGroup label={t("groupPreferences")}>
        <SettingsRows>
          <AppearanceSummary />
          <SettingsLinkRow
            href="/settings/money"
            icon={CreditCard}
            label={t("money")}
            // Same fallback the screen behind it shows, so the two agree.
            summary={`${currency ?? "EUR"} · ${dateSummary}`}
          />
        </SettingsRows>
      </SettingsGroup>

      <SettingsGroup label={t("groupData")}>
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

      <SettingsGroup label={t("groupBalancia")}>
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
            // The `v` belongs to the reader, not to the file: `package.json`
            // stores a bare version, and "0.1.0" on its own reads as an amount.
            summary={`v${appVersion()}`}
          />
        </SettingsRows>
      </SettingsGroup>

      <SignOutButton />
    </SettingsScreen>
  );
}
