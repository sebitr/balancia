"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendTestReportAction } from "@/modules/telemetry/actions";

/**
 * The one button that transmits on purpose.
 *
 * It sits under the payload rather than beside the switches, because what it
 * proves is that the thing shown above is the thing that leaves: press it, and
 * exactly that JSON goes to exactly the endpoint named on the card. A test
 * button next to the switches would only be testing the network.
 *
 * Disabled unless usage reporting is actually on. Sending a report from an
 * installation that has opted out would make the opt-out a lie.
 */
export function TelemetryTestButton({
  canSend,
  usageEnabled,
}: {
  /** Whether a report could actually be transmitted right now. */
  canSend: boolean;
  usageEnabled: boolean;
}) {
  const t = useTranslations("adminTelemetry");
  const [isSending, startSending] = useTransition();

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
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={isSending || !canSend || !usageEnabled}
        onClick={sendTest}
        className="h-10 w-full rounded-xl text-sm"
      >
        {isSending ? t("testSending") : t("testButton")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("testHelp")}</p>
    </div>
  );
}
