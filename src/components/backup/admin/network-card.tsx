import { getTranslations } from "next-intl/server";
import { Info } from "lucide-react";
import { SettingsCard } from "@/components/settings/settings-card";
import { getEnv } from "@/lib/env";
import { AdminState } from "./state-mark";

/**
 * Administration → whether backups may be pointed at this server's own network.
 *
 * A statement, not a switch. `BACKUP_ALLOW_PRIVATE_ENDPOINTS` is read from the
 * environment, which a screen cannot write, and the thing it guards is not a
 * preference: with it on, any account can make this server open a connection to
 * an address on the private network, which is how a request reaches what was
 * meant to stay inside. That is worth a deployment file's worth of deliberation
 * and not a tap, so the card says what the setting is, what it allows, what it
 * costs, and which variable moves it.
 *
 * The state is a word and an icon, off or on, and the warning is plain text:
 * no red and no triangle. It describes a trade the administrator may well want
 * on a household server where every account is family.
 */

const VARIABLE = "BACKUP_ALLOW_PRIVATE_ENDPOINTS";

export async function BackupNetworkCard() {
  const t = await getTranslations("cloudBackup");
  const allowed = getEnv().BACKUP_ALLOW_PRIVATE_ENDPOINTS;

  return (
    <SettingsCard title={t("admin.lanTitle")}>
      <div className="space-y-3">
        <div className="flex min-h-11 items-start justify-between gap-4">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-pretty">
              {t("admin.lanLabel")}
            </p>
            <p className="text-xs text-pretty text-muted-foreground">
              {t("admin.lanHelp")}
            </p>
          </div>
          <div className="shrink-0 pt-0.5">
            <AdminState kind={allowed ? "attention" : "off"}>
              {allowed ? t("admin.lanOn") : t("admin.lanOff")}
            </AdminState>
          </div>
        </div>
        <p className="text-xs text-pretty text-muted-foreground">
          {t("admin.lanEnv", { name: VARIABLE })}
        </p>
        <p className="flex items-start gap-2 text-xs text-pretty text-muted-foreground">
          <Info
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
            strokeWidth={2}
          />
          <span>{t("admin.lanWarn")}</span>
        </p>
      </div>
    </SettingsCard>
  );
}
