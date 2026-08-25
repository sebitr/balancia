import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { SettingsCard } from "@/components/settings/settings-card";
import { Disclosure } from "@/components/settings/disclosure";
import { TelemetrySettingsForm } from "@/components/telemetry/telemetry-settings-form";
import { TelemetryTestButton } from "@/components/telemetry/telemetry-test-button";
import { TelemetryPreview } from "@/components/telemetry/telemetry-preview";
import { getCurrentAdmin } from "@/lib/security/admin";
import { buildUsageReport } from "@/lib/telemetry/report";
import { getEffectiveTelemetry } from "@/lib/telemetry/settings";
import { getDateFormatter } from "@/i18n/preferences";

/**
 * Settings → Administration.
 *
 * The whole of what Balancia sends, on one screen: two switches that are off
 * until somebody moves them, and the actual payload — built by the same
 * function that would transmit it, not by an example kept beside it.
 *
 * Only an instance administrator can see this. Everybody else gets the
 * not-found screen rather than a permission error, so the page's existence is
 * not something a participant can probe for — and the switches behind it
 * resolve the caller again themselves, because a page that does not render is
 * not an authorization check.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("administration") };
}

export default async function AdminSettingsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) notFound();

  const t = await getTranslations("userSettings");
  const tAdmin = await getTranslations("adminTelemetry");
  const dates = await getDateFormatter();
  const settings = await getEffectiveTelemetry({ fresh: true });

  // The preview is the report itself. Building it costs two counts and a
  // grouped read over at most fourteen days of counters.
  const report = await buildUsageReport();
  const lastSent = settings.stored.lastReportSentAt;

  return (
    <SettingsScreen
      title={t("administration")}
      back={{ href: "/settings", label: t("backToSettings") }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-1.5">
        <span className="inline-flex h-5 items-center rounded-full bg-foreground/10 px-2 text-2xs font-semibold text-muted-foreground">
          {t("instanceAdmin")}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("instanceAdminHelp")}
        </span>
      </div>

      <SettingsCard title={tAdmin("switchesTitle")}>
        <TelemetrySettingsForm
          usageEnabled={settings.usageEnabled}
          crashEnabled={settings.crashEnabled}
          usageLocked={settings.usageLocked}
          crashLocked={settings.crashLocked}
          mode={settings.mode}
        />

        <dl className="mt-3.5 grid gap-1 border-t border-border pt-3.5 text-xs text-muted-foreground">
          <div className="flex gap-2">
            <dt>{tAdmin("endpointLabel")}</dt>
            {/* The configured destination, which only the deployment can set. */}
            <dd className="min-w-0 truncate font-mono">
              {settings.endpoint || tAdmin("noEndpoint")}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt>{tAdmin("lastSentLabel")}</dt>
            <dd>{lastSent ? dates.at(lastSent) : tAdmin("neverSent")}</dd>
          </div>
        </dl>
      </SettingsCard>

      <SettingsCard
        contentClassName="px-0 pt-0 pb-0"
        footer={
          <TelemetryTestButton
            canSend={settings.transmitting}
            usageEnabled={settings.usageEnabled}
          />
        }
      >
        <Disclosure label={tAdmin("previewTitle")}>
          <div className="space-y-2">
            <TelemetryPreview report={report} />
            <p className="text-xs text-pretty text-muted-foreground">
              {tAdmin("previewHelp")}
            </p>
          </div>
        </Disclosure>

        <Disclosure label={tAdmin("notCollectedTitle")}>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            <li>{tAdmin("notCollectedAmounts")}</li>
            <li>{tAdmin("notCollectedNames")}</li>
            <li>{tAdmin("notCollectedReceipts")}</li>
            <li>{tAdmin("notCollectedIdentifiers")}</li>
            <li>{tAdmin("notCollectedInstance")}</li>
          </ul>
        </Disclosure>
      </SettingsCard>
    </SettingsScreen>
  );
}
