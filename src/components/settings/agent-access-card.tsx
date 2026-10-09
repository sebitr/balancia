"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useDateFormatter } from "@/i18n/format-context";
import { Bot, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmSheet } from "./confirm-sheet";
import { disconnectAgentAction } from "@/modules/agent-access/actions";
import type { SerializedConnection } from "@/modules/agent-access/serialize";

/**
 * The assistants connected to this account.
 *
 * Only the list: how to connect another is the guide beside it on the same
 * screen, which is prose and needs no client. Whatever an assistant ends up
 * connected as appears here, because nothing is minted on this screen and no
 * secret passes through it — the assistant asks, the person says yes on
 * Balancia's own page, and the row is the trace.
 *
 * Disconnecting asks first and offers no Undo, as revoking an API key does: the
 * tokens are stored only as hashes, so there is nothing to put back. The
 * assistant's own "connect" button is the way back, and it is the assistant's.
 * The doctrine is at `toastUndoable` in `components/ui/sonner.tsx`.
 */
export function AgentAccessCard({
  connections,
}: {
  connections: readonly SerializedConnection[];
}) {
  const t = useTranslations("agentAccess");
  const dates = useDateFormatter();
  const router = useRouter();

  const [, startTransition] = useTransition();
  const [leaving, setLeaving] = useState<SerializedConnection | null>(null);

  const onDisconnect = (connection: SerializedConnection) => {
    startTransition(async () => {
      const result = await disconnectAgentAction(connection.id);
      setLeaving(null);
      if (!result.ok) {
        toast.error(result.error ?? t("disconnectFailed"));
        return;
      }
      // The row has left the screen and there is no control left to press, so
      // this one does say what happened — and offers no Undo.
      toast.success(t("disconnectedToast", { name: connection.clientName }));
      router.refresh();
    });
  };

  return (
    <section className="shrink-0 overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <h2 className="font-heading text-base font-semibold">{t("title")}</h2>
        {connections.length > 0 && (
          <span className="inline-flex h-5.5 items-center rounded-full bg-positive/15 px-2 text-2xs font-semibold text-positive-ink">
            {t("connectedCount", { count: connections.length })}
          </span>
        )}
      </div>

      {connections.length === 0 ? (
        <p className="flex items-start gap-2.5 px-4 pb-4 text-xs text-pretty text-muted-foreground">
          <Bot aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {t("emptyDescription")}
        </p>
      ) : (
        <ul aria-label={t("listLabel")}>
          {connections.map((connection) => (
            <li
              key={connection.id}
              className="flex items-center gap-3 border-t border-border px-4 py-3"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-wash-3"
              >
                <Bot className="size-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate text-sm font-medium">
                    {connection.clientName}
                  </span>
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {connection.scope === "write"
                      ? t("scopeWrite")
                      : t("scopeRead")}
                    {" · "}
                    {connection.groupName ?? t("allGroups")}
                  </span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t("connectedOn", { date: dates.at(connection.createdAt) })}
                  {" · "}
                  {/* The line that makes a forgotten connection visible: "not
                      used yet" on one added last month means whatever it was
                      added to never got as far as asking. */}
                  {connection.lastUsedAt
                    ? t("lastUsed", { date: dates.at(connection.lastUsedAt) })
                    : t("neverUsed")}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setLeaving(connection)}
                aria-label={t("disconnectLabel", {
                  name: connection.clientName,
                })}
                className="tap-target flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-wash-3 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmSheet
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={t("disconnectTitle")}
        body={t("disconnectBody")}
        confirmLabel={t("disconnectConfirm")}
        cancelLabel={t("disconnectCancel")}
        destructive
        onConfirm={() => leaving && onDisconnect(leaving)}
      />
    </section>
  );
}
