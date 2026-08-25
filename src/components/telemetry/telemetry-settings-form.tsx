"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { SettingsControlRow } from "@/components/settings/settings-row";
import {
  setCrashReportingAction,
  setUsageReportingAction,
} from "@/modules/telemetry/actions";

/**
 * The two switches.
 *
 * Both switches are off on every installation until an administrator moves
 * them, and they are independent: helping with feature decisions and helping
 * with error triage are separate questions, asked separately.
 *
 * No dark patterns and none of the usual nudges: no pre-ticked box, no modal
 * asking again later, no "recommended" badge, and the copy beside each switch
 * says what is collected in the same size type as the label. A switch that is
 * disabled says why — the deployment forbade it — rather than silently
 * refusing to move.
 */
export function TelemetrySettingsForm({
  usageEnabled,
  crashEnabled,
  usageLocked,
  crashLocked,
  mode,
}: {
  usageEnabled: boolean;
  crashEnabled: boolean;
  usageLocked: boolean;
  crashLocked: boolean;
  mode: "opt-in" | "local" | "off";
}) {
  const t = useTranslations("adminTelemetry");
  const [usage, setUsage] = useState(usageEnabled);
  const [crash, setCrash] = useState(crashEnabled);
  const [isPending, startTransition] = useTransition();

  const toggle = (
    which: "usage" | "crash",
    value: boolean,
    apply: (next: boolean) => void,
    revert: () => void,
  ) => {
    apply(value);
    startTransition(async () => {
      const action =
        which === "usage" ? setUsageReportingAction : setCrashReportingAction;
      const result = await action(value);
      if (!result.ok) {
        revert();
        toast.error(result.error ?? t("saveFailed"));
        return;
      }
      toast.success(value ? t("savedOn") : t("savedOff"));
    });
  };

  return (
    <div className="space-y-3.5">
      {mode === "local" && (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          {t("modeLocal")}
        </p>
      )}
      {mode === "off" && (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          {t("modeOff")}
        </p>
      )}

      <SettingsControlRow
        htmlFor="telemetry-usage"
        label={t("usageLabel")}
        description={t("usageHelp")}
        control={
          <Switch
            id="telemetry-usage"
            size="lg"
            checked={usage}
            disabled={isPending || usageLocked}
            onCheckedChange={(checked) =>
              toggle("usage", checked, setUsage, () => setUsage(!checked))
            }
          />
        }
      />

      <SettingsControlRow
        htmlFor="telemetry-crash"
        label={t("crashLabel")}
        description={t("crashHelp")}
        control={
          <Switch
            id="telemetry-crash"
            size="lg"
            checked={crash}
            disabled={isPending || crashLocked}
            onCheckedChange={(checked) =>
              toggle("crash", checked, setCrash, () => setCrash(!checked))
            }
          />
        }
      />
    </div>
  );
}
