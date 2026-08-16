"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  sendTestReportAction,
  setCrashReportingAction,
  setUsageReportingAction,
} from "@/modules/telemetry/actions";

/**
 * The two switches, and the one button that transmits on purpose.
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
  canSend,
  mode,
}: {
  usageEnabled: boolean;
  crashEnabled: boolean;
  usageLocked: boolean;
  crashLocked: boolean;
  /** Whether a report could actually be transmitted right now. */
  canSend: boolean;
  mode: "opt-in" | "local" | "off";
}) {
  const t = useTranslations("adminTelemetry");
  const [usage, setUsage] = useState(usageEnabled);
  const [crash, setCrash] = useState(crashEnabled);
  const [isPending, startTransition] = useTransition();
  const [isSending, startSending] = useTransition();

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

  const sendTest = () => {
    startSending(async () => {
      const result = await sendTestReportAction();
      if (!result.ok) {
        toast.error(result.error ?? t("testFailed"));
        return;
      }
      // Success and failure both come back as a fixed word from a short list;
      // there is no server message to surface, by design.
      if (result.data?.status === "sent") {
        toast.success(t("testSent"));
        return;
      }
      toast.error(t("testFailed"));
    });
  };

  return (
    <div className="space-y-6">
      {mode === "local" && (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          {t("modeLocal")}
        </p>
      )}
      {mode === "off" && (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          {t("modeOff")}
        </p>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="telemetry-usage">{t("usageLabel")}</Label>
          <p className="text-xs text-muted-foreground">{t("usageHelp")}</p>
          <p className="text-xs text-muted-foreground">{t("usageNever")}</p>
        </div>
        <Switch
          id="telemetry-usage"
          checked={usage}
          disabled={isPending || usageLocked}
          onCheckedChange={(checked) =>
            toggle("usage", checked, setUsage, () => setUsage(!checked))
          }
        />
      </div>

      <div className="flex items-start justify-between gap-4 border-t pt-6">
        <div className="space-y-1">
          <Label htmlFor="telemetry-crash">{t("crashLabel")}</Label>
          <p className="text-xs text-muted-foreground">{t("crashHelp")}</p>
        </div>
        <Switch
          id="telemetry-crash"
          checked={crash}
          disabled={isPending || crashLocked}
          onCheckedChange={(checked) =>
            toggle("crash", checked, setCrash, () => setCrash(!checked))
          }
        />
      </div>

      <div className="border-t pt-6">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isSending || !canSend || !usage}
          onClick={sendTest}
        >
          {isSending ? t("testSending") : t("testButton")}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">{t("testHelp")}</p>
      </div>
    </div>
  );
}
