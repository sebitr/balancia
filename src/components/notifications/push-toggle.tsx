"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellOff, BellRing, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toastUndoable } from "@/components/ui/sonner";
import { usePushSubscription } from "./use-push-subscription";

/**
 * Turning push on or off for the browser you are looking at.
 *
 * Deliberately per-device rather than per-account: the permission belongs to
 * this browser, and someone who wants notifications on their phone but not on
 * a shared desktop has to be able to say so.
 */
export function PushToggle() {
  const t = useTranslations("notificationSettings");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { status, busy, enable, disable } = usePushSubscription();
  const [testing, setTesting] = useState(false);

  // Each of these is a dead end for a different reason, and each names the
  // thing the reader can actually do about it.
  const blockedMessage: Partial<Record<typeof status, string>> = {
    unsupported: t("pushUnsupported"),
    installFirst: t("pushInstallFirst"),
    unavailable: t("pushUnavailable"),
    blocked: t("pushBlocked"),
  };

  const message = blockedMessage[status];
  if (message) {
    return (
      <Alert>
        <BellOff aria-hidden="true" />
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    );
  }

  if (status === "checking") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {tCommon("loading")}
      </p>
    );
  }

  /** Subscribing this browser, whether asked for by the button or by an Undo. */
  const turnOn = async () => {
    if (await enable()) {
      router.refresh();
    } else {
      toast.error(t("pushFailed"));
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const response = await fetch("/api/push/test", { method: "POST" });
      if (!response.ok) {
        const { error } = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(error ?? t("testFailed"));
        return;
      }
      toast.success(t("testSent"));
    } catch {
      toast.error(t("testFailed"));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {status === "on" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={async () => {
              if (await disable()) {
                // The permission is still granted, so turning it back on is a
                // resubscribe rather than another prompt — which makes this a
                // real way back rather than a button that reopens the dialog.
                toastUndoable(
                  t("deviceRemoved"),
                  { label: tCommon("undo"), onUndo: turnOn },
                  { id: "push-subscription" },
                );
                router.refresh();
              }
            }}
          >
            <BellOff aria-hidden="true" />
            {t("pushDisable")}
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={turnOn}>
            <BellRing aria-hidden="true" />
            {t("pushEnable")}
          </Button>
        )}

        {status === "on" && (
          <Button
            variant="ghost"
            size="sm"
            disabled={testing}
            onClick={sendTest}
          >
            {t("testSend")}
          </Button>
        )}
      </div>

      {status === "on" && (
        <p className="text-xs text-muted-foreground">{t("pushOn")}</p>
      )}
    </div>
  );
}
