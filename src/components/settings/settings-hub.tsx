import { cache } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeftRight,
  Bell,
  CircleAlert,
  Cloud,
  CreditCard,
  Database,
  HelpCircle,
  Server,
  Shield,
  Users,
} from "lucide-react";
import { SettingsGroup, SettingsRows } from "./settings-card";
import { SettingsLinkRow } from "./settings-row";
import { IdentityCard } from "./identity-card";
import { AppearanceSummary } from "./appearance-summary";
import { PayoutsSummary } from "./payouts-summary";
import { SignOutButton } from "./sign-out-button";
import { isInstanceAdmin } from "@/lib/security/admin";
import { appVersion } from "@/lib/telemetry/environment";
import { listPasskeys } from "@/modules/auth/webauthn";
import { getUserPreferredCurrency } from "@/modules/auth/service";
import { listDestinations } from "@/modules/backup/service";
import { loadBackupSummary, type BackupSummary } from "@/modules/backup/view";
import { listGroupsForUser } from "@/modules/groups/service";
import { getPreferences } from "@/modules/notifications/service";
import { listPayoutMethods } from "@/modules/payouts/service";
import { getAvatarVersion } from "@/modules/profile/avatar";
import { resolveFormatPreferences } from "@/i18n/preferences";

/**
 * What the Cloud backup row has to say, reduced to what it draws.
 *
 * `loadBackupSummary` answers "none", "on", "paused" or "attention", which is
 * the row's four states. It names the provider for "on" but not for "paused",
 * and "Paused · Google Drive" wants one, so that single case reads the
 * destination for it — an extra read only for the people it applies to, on a
 * screen that is drawn on every visit to settings.
 */
export type BackupFact =
  | { readonly state: "none" }
  | {
      readonly state: "on";
      readonly frequency: "daily" | "weekly";
      readonly provider: string;
    }
  | { readonly state: "paused"; readonly provider: string }
  | { readonly state: "attention" };

/** A destination's label is "Google Drive · ada@example.com": the name is the first part. */
function providerOf(label: string | undefined): string {
  return (label ?? "").split(" · ")[0] ?? "";
}

async function loadBackupFact(userId: string): Promise<BackupFact> {
  const summary: BackupSummary = await loadBackupSummary(userId);
  switch (summary.state) {
    case "none":
      return { state: "none" };
    case "attention":
      return { state: "attention" };
    case "on":
      return {
        state: "on",
        frequency: summary.frequency,
        provider: providerOf(summary.labels[0]),
      };
    case "paused": {
      const [first] = (await listDestinations(userId)).filter(
        (destination) => destination.status !== "setup",
      );
      return { state: "paused", provider: providerOf(first?.label) };
    }
  }
}

/**
 * The settings hub's rows, and every fact their summaries are written from.
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
 *
 * ## Drawn twice, read once
 *
 * The hub is the phone's settings screen (`src/app/settings/page.tsx`) and,
 * from `lg` up, the left pane beside every settings screen
 * (`src/app/settings/layout.tsx`). On `/settings` both are in the document,
 * each hidden at the other's widths, so the read is remembered for the length
 * of the render and the second copy costs nothing.
 *
 * The pane lives in the layout, which a navigation between two settings
 * screens does not render again. Its summaries still keep up with the screen
 * beside them: every control that changes one of these facts either refreshes
 * the route or revalidates a path from its action, and both re-render the
 * whole tree, the layout with it. The two that do neither — the theme and the
 * accent — are the two this pane paints live in the browser.
 */
export const loadSettingsHub = cache(async (userId: string) => {
  const [
    admin,
    passkeys,
    groups,
    preferences,
    currency,
    formats,
    payouts,
    photo,
    backup,
  ] = await Promise.all([
    isInstanceAdmin(userId),
    listPasskeys(userId),
    listGroupsForUser(userId),
    getPreferences(userId),
    getUserPreferredCurrency(userId),
    resolveFormatPreferences(),
    listPayoutMethods(userId),
    getAvatarVersion(userId),
    loadBackupFact(userId),
  ]);

  const categories = Object.values(preferences);

  return {
    admin,
    passkeyCount: passkeys.length,
    groupCount: groups.length,
    notificationsOn: categories.filter(Boolean).length,
    notificationsTotal: categories.length,
    currency,
    dateFormat: formats.dateFormat,
    payoutMethods: payouts.map((entry) => entry.method),
    photo,
    backup,
  };
});

export type SettingsHubFacts = Awaited<ReturnType<typeof loadSettingsHub>>;

/**
 * The rows themselves: the identity card, the five groups and the way out of
 * the account. A fragment, so whichever column holds it spaces it.
 */
export function SettingsHub({
  user,
  hub,
}: {
  user: { readonly name: string; readonly email: string };
  hub: SettingsHubFacts;
}) {
  const t = useTranslations("userSettings");
  const tBackup = useTranslations("cloudBackup");

  // The date notation by its name — "DD/MM/YYYY", or "Automatic" — rather than
  // a date written in it. A sample read as a fact: "EUR · Aug 13, 2026" on a
  // screen opened in October looked like the day something had happened, and
  // nothing beside it said otherwise. The screen behind the row is where the
  // notation is shown in use, on the reader's own last entry.
  const dateSummary = t("dateFormatName", { format: hub.dateFormat });

  return (
    <>
      <IdentityCard
        name={user.name}
        email={user.email}
        photoVersion={hub.photo}
      />

      <SettingsGroup label={t("groupAccount")}>
        <SettingsRows>
          <SettingsLinkRow
            href="/settings/notifications"
            icon={Bell}
            label={t("notifications")}
            summary={
              hub.notificationsOn === hub.notificationsTotal
                ? t("allOn")
                : t("someOn", {
                    on: hub.notificationsOn,
                    total: hub.notificationsTotal,
                  })
            }
          />
          <SettingsLinkRow
            href="/settings/security"
            icon={Shield}
            label={t("security")}
            summary={t("passkeyCount", { count: hub.passkeyCount })}
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
            trailing={<PayoutsSummary methods={hub.payoutMethods} />}
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
            summary={`${hub.currency ?? "EUR"} · ${dateSummary}`}
          />
        </SettingsRows>
      </SettingsGroup>

      <SettingsGroup label={t("groupData")}>
        <SettingsRows>
          <SettingsLinkRow
            href="/settings/groups"
            icon={Users}
            label={t("groups")}
            summary={String(hub.groupCount)}
          />
          <SettingsLinkRow
            href="/settings/data"
            icon={Database}
            label={t("data")}
          />
          <SettingsLinkRow
            href="/settings/backup"
            icon={Cloud}
            label={tBackup("hub.label")}
            summary={
              hub.backup.state === "none"
                ? tBackup("hub.none")
                : hub.backup.state === "on"
                  ? tBackup("hub.summary", {
                      schedule: tBackup(`schedule.${hub.backup.frequency}`),
                      provider: hub.backup.provider,
                    })
                  : hub.backup.state === "paused"
                    ? tBackup("hub.paused", { provider: hub.backup.provider })
                    : null
            }
            // A backup that has stopped is the one fact here worth a pill
            // rather than a summary: an icon and the words, so it does not
            // lean on the colour alone.
            trailing={
              hub.backup.state === "attention" ? (
                <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2 text-2xs font-semibold text-destructive">
                  <CircleAlert
                    aria-hidden="true"
                    className="size-3"
                    strokeWidth={2.25}
                  />
                  {tBackup("hub.attention")}
                </span>
              ) : undefined
            }
          />
        </SettingsRows>
      </SettingsGroup>

      <SettingsGroup label={t("groupBalancia")}>
        <SettingsRows>
          {/* Hidden from everybody else. Presentation only: the screen behind
              it resolves the caller again, because a row that is not rendered
              is not a permission check. */}
          {hub.admin && (
            <SettingsLinkRow
              href="/settings/admin"
              icon={Server}
              label={t("administration")}
              badge={
                <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-wash-3 px-2 text-2xs font-semibold text-muted-foreground">
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
    </>
  );
}
