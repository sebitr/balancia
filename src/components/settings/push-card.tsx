"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellOff, Loader2, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { toastUndoable } from "@/components/ui/sonner";
import { SettingsControlRow } from "./settings-row";
import { usePushSubscription } from "@/components/notifications/use-push-subscription";

export interface PushDevice {
  readonly id: string;
  readonly label: string;
  readonly added: string;
}

/**
 * Push, for the browser you are looking at, and the list of the ones already
 * subscribed.
 *
 * Deliberately per-device rather than per-account: the permission belongs to
 * this browser, and someone who wants notifications on their phone but not on
 * a shared desktop has to be able to say so. Which is also why the devices are
 * listed — the switch only ever speaks for the browser in front of you, and
 * without the list there is nowhere to see, or stop, the others.
 *
 * The switch has a real way back and offers it. Turning push off leaves the
 * *permission* granted, so turning it on again is a resubscribe rather than
 * another browser prompt — which is what makes Undo honest here. Removing
 * another device from the list is not undoable in the same way: that browser
 * has to ask for itself, so that toast says what happened and stops.
 */
export function PushCard({ devices }: { devices: PushDevice[] }) {
  const t = useTranslations("notificationSettings");
  const tSettings = useTranslations("userSettings");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { status, busy, enable, disable } = usePushSubscription();
  const [removing, setRemoving] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  // Each of these is a dead end for a different reason, and each names the
  // thing the reader can actually do about it.
  const blocked: Partial<Record<typeof status, string>> = {
    unsupported: t("pushUnsupported"),
    installFirst: t("pushInstallFirst"),
    unavailable: t("pushUnavailable"),
    blocked: t("pushBlocked"),
  };
  const message = blocked[status];

  const turnOn = async () => {
    if (await enable()) {
      router.refresh();
    } else {
      toast.error(t("pushFailed"));
    }
  };

  const flip = async (on: boolean) => {
    if (on) {
      await turnOn();
      return;
    }
    if (await disable()) {
      toastUndoable(
        t("deviceRemoved"),
        { label: tCommon("undo"), onUndo: turnOn },
        { id: "push-subscription" },
      );
      router.refresh();
    }
  };

  /**
   * A push sent on purpose, to this device, now.
   *
   * The design does not draw this and the reader mostly does not need it —
   * but push is the one thing in Balancia that can be switched on, report
   * itself on, and still silently never arrive, because the failure is in a
   * service worker or an OS notification setting rather than in anything this
   * screen can see. It is the only way to tell "on" from "working".
   */
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

  const forget = async (id: string) => {
    setRemoving(id);
    try {
      const response = await fetch(`/api/push/subscriptions/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        toast.error(t("pushFailed"));
        return;
      }
      toast.success(t("deviceRemoved"));
      router.refresh();
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section className="shrink-0 overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10">
      <div className="px-4 py-4">
        {message ? (
          <div className="space-y-2">
            <h2 className="font-heading text-base font-semibold">
              {tSettings("pushTitle")}
            </h2>
            <Alert>
              <BellOff aria-hidden="true" />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          </div>
        ) : status === "checking" ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            {tCommon("loading")}
          </p>
        ) : (
          <div className="space-y-2.5">
            <SettingsControlRow
              htmlFor="push-here"
              label={tSettings("pushTitle")}
              description={t("pushDescription")}
              control={
                <Switch
                  id="push-here"
                  size="lg"
                  checked={status === "on"}
                  disabled={busy}
                  onCheckedChange={(on) => void flip(on)}
                />
              }
            />
            {status === "on" && (
              <button
                type="button"
                disabled={testing}
                onClick={() => void sendTest()}
                className="text-xs font-semibold text-primary-ink transition-colors hover:text-primary-ink/80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
              >
                {t("testSend")}
              </button>
            )}
          </div>
        )}
      </div>

      {devices.length > 0 && (
        <div className="border-t border-border px-4 py-3.5">
          <h3 className="text-2xs font-semibold tracking-[0.07em] text-muted-foreground uppercase">
            {t("devicesTitle")}
          </h3>
          <ul className="mt-2 space-y-1">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{device.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {device.added}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={removing === device.id}
                  onClick={() => void forget(device.id)}
                  aria-label={`${t("deviceRemove")} — ${device.label}`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
                >
                  {removing === device.id ? (
                    <Loader2
                      aria-hidden="true"
                      className="size-4 animate-spin"
                    />
                  ) : (
                    <Trash2 aria-hidden="true" className="size-4" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
