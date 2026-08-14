"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { markReadAction } from "@/modules/notifications/actions";

/** One already-rendered row. The wording was resolved on the server. */
export interface NotificationRow {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly createdAt: string;
  readonly read: boolean;
}

/**
 * The inbox list.
 *
 * Opening an entry marks it read on the way through, which is what people
 * expect from a list with a badge on it: the count should reflect what has
 * actually been looked at, not require a second deliberate action.
 */
export function NotificationList({ items }: { items: NotificationRow[] }) {
  const t = useTranslations("notificationsPage");
  const format = useFormatter();
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [isPending, startTransition] = useTransition();

  const unread = rows.filter((row) => !row.read).length;

  const open = (row: NotificationRow) => {
    if (!row.read) {
      setRows((current) =>
        current.map((item) =>
          item.id === row.id ? { ...item, read: true } : item,
        ),
      );
      // Not awaited: navigation should not wait on the bookkeeping.
      void markReadAction([row.id]);
    }
    router.push(row.url);
  };

  const markAll = () => {
    const previous = rows;
    setRows((current) => current.map((row) => ({ ...row, read: true })));
    startTransition(async () => {
      const result = await markReadAction();
      if (!result.ok) {
        setRows(previous);
        toast.error(result.error ?? t("markAllReadFailed"));
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {unread > 0 && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={markAll}
            disabled={isPending}
          >
            {t("markAllRead")}
          </Button>
        </div>
      )}

      <ul className="divide-y rounded-lg border">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => open(row)}
              className={cn(
                "flex w-full items-start gap-3 p-4 text-left transition-colors",
                "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                !row.read && "bg-accent/40",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  row.read ? "bg-transparent" : "bg-primary",
                )}
              />
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {row.title}
                  </span>
                  <time
                    dateTime={row.createdAt}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {format.relativeTime(new Date(row.createdAt))}
                  </time>
                </span>
                <span className="block text-sm text-muted-foreground">
                  {row.body}
                </span>
              </span>
              {!row.read && <span className="sr-only">{t("unread")}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
