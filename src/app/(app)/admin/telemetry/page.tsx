import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TelemetrySettingsForm } from "@/components/telemetry/telemetry-settings-form";
import { TelemetryPreview } from "@/components/telemetry/telemetry-preview";
import { getCurrentAdmin } from "@/lib/security/admin";
import { buildUsageReport } from "@/lib/telemetry/report";
import { getEffectiveTelemetry } from "@/lib/telemetry/settings";
import { getDateFormatter } from "@/i18n/preferences";

/**
 * Settings → Administration → Telemetry.
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
  const t = await getTranslations("adminTelemetry");
  return { title: t("metaTitle") };
}

export default async function TelemetryAdminPage() {
  const admin = await getCurrentAdmin();
  if (!admin) notFound();

  const t = await getTranslations("adminTelemetry");
  const dates = await getDateFormatter();
  const settings = await getEffectiveTelemetry({ fresh: true });

  // The preview is the report itself. Building it costs two counts and a
  // grouped read over at most fourteen days of counters.
  const report = await buildUsageReport();

  const lastSent = settings.stored.lastReportSentAt;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("switchesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <TelemetrySettingsForm
            usageEnabled={settings.stored.usageReportingEnabled}
            crashEnabled={settings.stored.crashReportingEnabled}
            usageLocked={settings.usageLocked}
            crashLocked={settings.crashLocked}
            canSend={settings.transmitting}
            mode={settings.mode}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("previewTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("previewHelp")}</p>
          <TelemetryPreview report={report} />
          <dl className="grid gap-1 text-xs text-muted-foreground">
            <div className="flex gap-2">
              <dt>{t("endpointLabel")}</dt>
              {/* The configured destination, which only the deployment can set. */}
              <dd className="font-mono">
                {settings.endpoint || t("noEndpoint")}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt>{t("lastSentLabel")}</dt>
              <dd>{lastSent ? dates.at(lastSent) : t("neverSent")}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("notCollectedTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t("notCollectedAmounts")}</li>
            <li>{t("notCollectedNames")}</li>
            <li>{t("notCollectedReceipts")}</li>
            <li>{t("notCollectedIdentifiers")}</li>
            <li>{t("notCollectedInstance")}</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
