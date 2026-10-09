"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/components/backup/format";
import { useNumberLocale } from "@/i18n/format-context";
import { runBackupNowAction } from "@/modules/backup/actions";
import { PROVIDER_NAMES } from "@/modules/backup/providers";
import type { DestinationView } from "@/modules/backup/service";
import { errorCopy } from "@/components/backup/error-copy";

/**
 * "Back up now", and the run it opens, drawn in place.
 *
 * The press returns at once: the server opens the run, queues the work and
 * answers before anything is encrypted. What follows is watched rather than
 * awaited — while the latest run says `running` the screen asks the server for
 * itself again every two seconds, and stops when the run does, when the
 * component goes, or after ten minutes (a run that long is the stale-run
 * reaper's to deal with, not this timer's).
 *
 * ## In place, not in a toast
 *
 * Progress is a bar and a label under the button. The result is a check and
 * the same words the card's "Last backup" would use ("Backed up just now · 14
 * groups · 212 kB"), in the spot where the progress was, and it stays. A toast
 * would be a slower second copy of text already under the finger.
 *
 * The one thing that is spoken is a *failed manual run*, because the screen it
 * would otherwise say it on has just been replaced by a History row the person
 * is not looking at. And "already running" is not a failure at all: someone
 * pressed the button on another device, or twice, and the run that exists is
 * the run this screen is about to show.
 *
 * Which runs count as "this person's": one that was seen running, or one that
 * appeared after the press — a backup of a few groups can be over before the
 * first refresh comes back, and would otherwise leave no trace of having been
 * asked for.
 */

/** How often the screen looks again while a run is under way. */
const POLL_MS = 2000;

/** Past this, polling stops and the next visit finds out how it ended. */
const POLL_GIVE_UP_MS = 10 * 60 * 1000;

export function RunArea({ destination }: { destination: DestinationView }) {
  const t = useTranslations("cloudBackup");
  const router = useRouter();
  const numberLocale = useNumberLocale();
  const provider = PROVIDER_NAMES[destination.provider];

  const latest = destination.latestRun;
  const running = latest?.status === "running";
  const blocked = destination.status === "needs_reconnect";

  const [starting, setStarting] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [pressedFrom, setPressedFrom] = useState<{ id: string | null } | null>(
    null,
  );
  const [watched, setWatched] = useState<string | null>(null);

  // Adjusting state while rendering, from props: a run is "ours" the moment it
  // is seen running, or when a new one shows up after the button was pressed.
  if (
    latest &&
    watched !== latest.id &&
    (running || (pressedFrom && pressedFrom.id !== latest.id))
  ) {
    setWatched(latest.id);
    setPressedFrom(null);
  }

  const busy = starting || refreshing || running;

  // The newest router, for an interval that outlives the render it began in.
  const refresh = useRef(router.refresh);
  useEffect(() => {
    refresh.current = router.refresh;
  });

  useEffect(() => {
    if (!running) return;
    const began = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - began >= POLL_GIVE_UP_MS) {
        clearInterval(timer);
        return;
      }
      refresh.current();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running]);

  // A manual run that failed is the one outcome that is spoken.
  const spoken = useRef<string | null>(null);
  useEffect(() => {
    if (
      latest?.status !== "failed" ||
      latest.trigger !== "manual" ||
      watched !== latest.id ||
      spoken.current === latest.id
    ) {
      return;
    }
    spoken.current = latest.id;
    toast.error(errorCopy(t, latest.errorCode, provider).sentence);
  }, [latest, watched, provider, t]);

  const press = async () => {
    setPressedFrom({ id: latest?.id ?? null });
    setStarting(true);
    try {
      const result = await runBackupNowAction(destination.id);
      if (!result.ok) {
        setPressedFrom(null);
        toast.error(result.error ?? t("overview.startFailed"));
        return;
      }
      if (result.data && !result.data.ok) {
        setPressedFrom(null);
        toast.error(errorCopy(t, result.data.code, provider).sentence);
        return;
      }
      // `started: false` is a run that already exists. Not an error: the
      // refresh below shows it.
      startRefresh(() => router.refresh());
    } catch {
      // The request never arrived; nothing was started.
      setPressedFrom(null);
      toast.error(t("overview.startFailed"));
    } finally {
      setStarting(false);
    }
  };

  const finished =
    latest && watched === latest.id && latest.status === "succeeded"
      ? latest
      : null;
  const unchanged =
    latest && watched === latest.id && latest.status === "unchanged";

  return (
    <div>
      <div aria-live="polite">
        {busy && (
          <div className="mb-3 space-y-2">
            <p className="text-sm font-medium">{t("overview.runningLabel")}</p>
            {/* Nothing in the data says how far along a run is — a run is one
                file for all the groups — so the bar is the indeterminate kind.
                The indicator is drawn full and pulses; `Progress` computes a
                translate from `value`, which has no meaning with none. */}
            <Progress
              value={null}
              aria-label={t("overview.runningLabel")}
              className="[&>[data-slot=progress-indicator]]:transform-none! [&>[data-slot=progress-indicator]]:motion-safe:animate-pulse"
            />
          </div>
        )}
        {!busy && finished && (
          <p className="mb-3 flex items-start gap-2 text-sm font-medium">
            <Check
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
              strokeWidth={2.25}
            />
            <span className="min-w-0 text-pretty">
              {t("overview.lastValue", {
                when: t("overview.done"),
                groups: t("overview.groups", { count: finished.groupCount }),
                size: formatBytes(finished.bytes, numberLocale),
              })}
            </span>
          </p>
        )}
        {!busy && unchanged && (
          <p className="mb-3 text-sm text-muted-foreground">
            {t("overview.skippedReason")}
          </p>
        )}
      </div>

      <Button
        type="button"
        onClick={() => void press()}
        disabled={busy || blocked}
        aria-busy={busy}
        className="w-full md:w-auto"
      >
        {busy ? (
          <>
            <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />
            {t("overview.running")}
          </>
        ) : (
          t("overview.now")
        )}
      </Button>
    </div>
  );
}
