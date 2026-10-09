import { cache } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeftRight,
  Bell,
  Bot,
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
import { getEnv } from "@/lib/env";
import { isInstanceAdmin } from "@/lib/security/admin";
import { appVersion } from "@/lib/telemetry/environment";
import { listConnections } from "@/modules/agent-access/grants";
import { listPasskeys } from "@/modules/auth/webauthn";
import { getUserPreferredCurrency } from "@/modules/auth/service";
import { listGroupsForUser } from "@/modules/groups/service";
import { getPreferences } from "@/modules/notifications/service";
import { listPayoutMethods } from "@/modules/payouts/service";
import { getAvatarVersion } from "@/modules/profile/avatar";
import { resolveFormatPreferences } from "@/i18n/preferences";

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
    assistants,
  ] = await Promise.all([
    isInstanceAdmin(userId),
    listPasskeys(userId),
    listGroupsForUser(userId),
    getPreferences(userId),
    getUserPreferredCurrency(userId),
    resolveFormatPreferences(),
    listPayoutMethods(userId),
    getAvatarVersion(userId),
    // Null, not zero, where the operator has switched agent access off: the row
    // is not drawn at all, and "None" would claim there was somewhere to go.
    getEnv().agentAccessEnabled ? listConnections(userId) : null,
  ]);

  const categories = Object.values(preferences);

  return {
    admin,
    passkeyCount: passkeys.length,
    assistantCount: assistants?.length ?? null,
    groupCount: groups.length,
    notificationsOn: categories.filter(Boolean).length,
    notificationsTotal: categories.length,
    currency,
    dateFormat: formats.dateFormat,
    payoutMethods: payouts.map((entry) => entry.method),
    photo,
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
          {hub.assistantCount !== null && (
            <SettingsLinkRow
              href="/settings/assistants"
              icon={Bot}
              label={t("assistants")}
              summary={t("assistantCount", { count: hub.assistantCount })}
            />
          )}
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
