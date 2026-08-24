"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Archive,
  Bell,
  CheckCheck,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { toastUndoable } from "@/components/ui/sonner";
import { PUSH } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";
import {
  markReadAction,
  setGroupMutedAction,
  setGroupSnoozedAction,
} from "@/modules/notifications/actions";
import {
  buildSections,
  countRows,
  visibleRows,
  FILTERS,
  type DaySection,
  type InboxFilter,
  type InboxRow,
} from "./grouping";
import {
  ActivityRow,
  BurstRow,
  Dismissible,
  GroupChip,
  ImportDigest,
  ReminderCard,
  RowDivider,
} from "./inbox-rows";
import { GroupSheet, SNOOZE_HOURS } from "./group-sheet";

export type { InboxRow } from "./grouping";

/** One row of the archive: read, old, and kept only to be findable. */
export interface ArchivedRow {
  readonly id: string;
  readonly groupName: string;
  readonly sentence: string;
  readonly amount: string | null;
  readonly createdAt: string;
  readonly url: string;
}

/** A group the reader has quietened, and whether it wears off. */
export interface QuietGroup {
  readonly groupId: string;
  readonly groupName: string;
  /** Null for a mute, which lasts until it is undone. */
  readonly snoozedUntil: string | null;
}

const DAY_LABELS: Record<
  DaySection,
  "dayToday" | "dayYesterday" | "dayEarlier"
> = {
  today: "dayToday",
  yesterday: "dayYesterday",
  earlier: "dayEarlier",
};

/**
 * The inbox.
 *
 * Answers one question — what happened to money I am part of since I last
 * looked — and then lets the reader act on the answer rather than only
 * acknowledge it: open the thing, settle the reminder, or quieten the group.
 *
 * Every row arrives already worded by `renderNotification`, the same function
 * that writes the push message, so a card on a lock screen and the row it
 * corresponds to cannot say different things. What this component adds is
 * shape: which day, which run, what folds, and what is still unread.
 */
export function NotificationList({
  items,
  archived,
  now,
  quiet: initialQuiet,
}: {
  items: readonly InboxRow[];
  archived: readonly ArchivedRow[];
  /** Pinned by the server render, so every relative time agrees with the markup. */
  now: string;
  quiet: readonly QuietGroup[];
}) {
  const t = useTranslations("notificationsPage");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [filter, setFilter] = useState<InboxFilter>("all");
  const [reads, setReads] = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [quiet, setQuiet] = useState<readonly QuietGroup[]>(initialQuiet);
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [sheetGroup, setSheetGroup] = useState<{
    groupId: string;
    groupName: string;
  } | null>(null);

  /** The server's rows with this session's reads laid over them. */
  const rows = useMemo(
    () => items.map((row) => ({ ...row, read: reads[row.id] ?? row.read })),
    [items, reads],
  );

  const suppressedGroups = useMemo(
    () => quiet.map((group) => group.groupId),
    [quiet],
  );

  const counts = useMemo(
    () => countRows(visibleRows(rows, { dismissed, suppressedGroups })),
    [rows, dismissed, suppressedGroups],
  );

  const sections = useMemo(
    () => buildSections(rows, { filter, dismissed, suppressedGroups }),
    [rows, filter, dismissed, suppressedGroups],
  );

  /** Opening something is also having seen it; the badge should agree. */
  const markRead = (ids: readonly string[]) => {
    const unseen = ids.filter((id) => !rows.find((row) => row.id === id)?.read);
    if (unseen.length === 0) return;
    setReads((current) => ({
      ...current,
      ...Object.fromEntries(unseen.map((id) => [id, true])),
    }));
    // Not awaited: navigation should not wait on the bookkeeping.
    void markReadAction(unseen);
  };

  const open = (row: InboxRow) => {
    markRead([row.id]);
    router.push(row.url);
  };

  const toggle = (key: string, ids: readonly string[]) => {
    markRead(ids);
    setExpanded((current) =>
      current.includes(key)
        ? current.filter((one) => one !== key)
        : [...current, key],
    );
  };

  const markAll = () => {
    const previous = reads;
    setReads(Object.fromEntries(rows.map((row) => [row.id, true])));
    startTransition(async () => {
      const result = await markReadAction();
      if (!result.ok) {
        setReads(previous);
        toast.error(result.error ?? t("markAllReadFailed"));
        return;
      }
      router.refresh();
    });
  };

  /**
   * Swiping a row away hides it for as long as this list is on screen.
   *
   * There is no column behind it: a notification is a record of something that
   * happened, and the reader is clearing their view rather than editing
   * history. It comes back on the next load, by design — which is also why the
   * undo has nothing to call and simply puts the row back.
   */
  const dismiss = (ids: readonly string[]) => {
    setDismissed((current) => [...current, ...ids]);
    toastUndoable(t("dismissed"), {
      label: tCommon("undo"),
      onUndo: () =>
        setDismissed((current) => current.filter((id) => !ids.includes(id))),
    });
  };

  const quieten = (
    group: { groupId: string; groupName: string },
    snoozedUntil: string | null,
  ) => {
    const previous = quiet;
    setQuiet((current) => [
      ...current.filter((one) => one.groupId !== group.groupId),
      { ...group, snoozedUntil },
    ]);
    // The sheet has to be gone before the toast arrives: a toast under an open
    // dialog is inert, and its button takes no taps.
    setSheetGroup(null);

    startTransition(async () => {
      const result = snoozedUntil
        ? await setGroupSnoozedAction(group.groupId, SNOOZE_HOURS)
        : await setGroupMutedAction(group.groupId, true);
      if (!result.ok) {
        setQuiet(previous);
        toast.error(result.error ?? t("quietFailed"));
        return;
      }
      toast.success(
        snoozedUntil
          ? t("snoozed", { group: group.groupName })
          : t("muted", { group: group.groupName }),
      );
    });
  };

  const unquieten = (group: QuietGroup) => {
    const previous = quiet;
    setQuiet((current) =>
      current.filter((one) => one.groupId !== group.groupId),
    );

    startTransition(async () => {
      const result = group.snoozedUntil
        ? await setGroupSnoozedAction(group.groupId, null)
        : await setGroupMutedAction(group.groupId, false);
      if (!result.ok) {
        setQuiet(previous);
        toast.error(result.error ?? t("quietFailed"));
        return;
      }
      toast.success(
        group.snoozedUntil
          ? t("resumed", { group: group.groupName })
          : t("unmuted", { group: group.groupName }),
      );
      router.refresh();
    });
  };

  const copyLink = async (row: InboxRow) => {
    try {
      await navigator.clipboard.writeText(
        new URL(row.url, window.location.origin).toString(),
      );
      toast.success(t("linkCopied"));
    } catch {
      toast.error(t("linkCopyFailed"));
    }
  };

  /** A count is worth showing only when there is one; "Unread 0" is noise. */
  const filterLabel = (one: InboxFilter): string => {
    if (one === "unread") {
      return counts.unread > 0
        ? t("filterUnreadCount", { count: counts.unread })
        : t("filterUnread");
    }
    if (one === "reminders") {
      return counts.reminders > 0
        ? t("filterRemindersCount", { count: counts.reminders })
        : t("filterReminders");
    }
    return t("filterAll");
  };

  const empty = sections.length === 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 pb-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <div className="flex items-center gap-1">
          {counts.unread > 0 && (
            <button
              type="button"
              onClick={markAll}
              disabled={isPending}
              aria-label={t("markAllRead")}
              className={ICON_BUTTON}
            >
              <CheckCheck aria-hidden="true" className="size-[18px]" />
            </button>
          )}
          <Link
            href="/profile/notifications"
            transitionTypes={PUSH}
            aria-label={t("settingsLink")}
            className={cn(ICON_BUTTON, "text-muted-foreground")}
          >
            <SlidersHorizontal aria-hidden="true" className="size-[17px]" />
          </Link>
        </div>
      </div>

      <div
        role="group"
        aria-label={t("filterLabel")}
        className="flex gap-0.5 rounded-xl bg-foreground/5 p-[3px]"
      >
        {FILTERS.map((one) => (
          <button
            key={one}
            type="button"
            onClick={() => setFilter(one)}
            aria-pressed={filter === one}
            className={cn(
              "h-7 flex-1 rounded-[9px] text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
              filter === one
                ? "bg-accent font-semibold text-foreground"
                : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {filterLabel(one)}
          </button>
        ))}
      </div>

      {quiet.map((group) => (
        <div
          key={group.groupId}
          className="mt-2 flex items-center justify-between gap-2 rounded-[11px] bg-foreground/5 py-[7px] pr-2 pl-3"
        >
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {group.snoozedUntil
              ? t("snoozedNotice", { group: group.groupName })
              : t("mutedNotice", { group: group.groupName })}
          </p>
          <button
            type="button"
            onClick={() => unquieten(group)}
            disabled={isPending}
            className="shrink-0 rounded-lg px-2 py-1 text-2xs font-semibold text-primary transition-colors hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
          >
            {group.snoozedUntil ? t("resume") : t("unmute")}
          </button>
        </div>
      ))}

      {empty ? (
        <EmptyState
          className="mt-6"
          icon={Bell}
          title={t(EMPTY_COPY[filter].title)}
          description={t(EMPTY_COPY[filter].hint)}
        />
      ) : (
        <div className="pt-1.5">
          {sections.map((section) => (
            <section key={section.day} className="pt-3.5">
              <h2 className="px-0.5 pb-1.5 text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {t(DAY_LABELS[section.day])}
              </h2>

              <ul>
                {section.items.map((item) => {
                  if (item.kind === "reminder") {
                    return (
                      <li key={item.key}>
                        <Dismissible onDismiss={() => dismiss([item.row.id])}>
                          <ReminderCard
                            row={item.row}
                            now={now}
                            onSettle={() => {
                              markRead([item.row.id]);
                              router.push(`/groups/${item.row.groupId}/settle`);
                            }}
                            onCopy={() => void copyLink(item.row)}
                          />
                        </Dismissible>
                      </li>
                    );
                  }

                  if (item.kind === "digest") {
                    return (
                      <li key={item.key}>
                        <Dismissible
                          onDismiss={() =>
                            dismiss(item.rows.map((row) => row.id))
                          }
                        >
                          <ImportDigest
                            rows={item.rows}
                            now={now}
                            open={expanded.includes(item.key)}
                            onToggle={() =>
                              toggle(
                                item.key,
                                item.rows.map((row) => row.id),
                              )
                            }
                            onOpen={open}
                          />
                        </Dismissible>
                        <RowDivider />
                      </li>
                    );
                  }

                  const lead = item.kind === "burst" ? item.rows[0]! : item.row;
                  return (
                    <li key={item.key}>
                      {item.showChip && (
                        <GroupChip
                          row={lead}
                          onOpen={() =>
                            setSheetGroup({
                              groupId: lead.groupId,
                              groupName: lead.groupName,
                            })
                          }
                        />
                      )}
                      <Dismissible
                        onDismiss={() =>
                          dismiss(
                            item.kind === "burst"
                              ? item.rows.map((row) => row.id)
                              : [item.row.id],
                          )
                        }
                      >
                        {item.kind === "burst" ? (
                          <BurstRow
                            rows={item.rows}
                            now={now}
                            open={expanded.includes(item.key)}
                            onToggle={() =>
                              toggle(
                                item.key,
                                item.rows.map((row) => row.id),
                              )
                            }
                          />
                        ) : (
                          <ActivityRow
                            row={item.row}
                            now={now}
                            onOpen={() => open(item.row)}
                          />
                        )}
                      </Dismissible>
                      <RowDivider />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {filter === "all" && archived.length > 0 && (
            <div className="mt-4 border-t border-foreground/8 pt-0">
              <button
                type="button"
                onClick={() => setArchiveOpen((open) => !open)}
                aria-expanded={archiveOpen}
                className="flex w-full items-center gap-2 px-0.5 py-2.5 text-left text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Archive aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="flex-1">
                  {t("archive", { count: archived.length })}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 shrink-0 transition-transform duration-[160ms] motion-reduce:transition-none",
                    archiveOpen && "rotate-180",
                  )}
                />
              </button>

              {archiveOpen && (
                <>
                  <ul>
                    {archived.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => router.push(row.url)}
                          aria-label={`${row.groupName}, ${row.sentence}`}
                          className="grid w-full grid-cols-[1fr_auto] items-start gap-2.5 py-2 pr-0.5 pl-6 text-left text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <span>
                            <span className="text-foreground/80">
                              {row.groupName}
                            </span>{" "}
                            · {row.sentence}
                          </span>
                          <ArchiveAge value={row.createdAt} now={now} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="px-0.5 py-2 text-2xs text-muted-foreground">
                    {t("archiveNote")}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {sheetGroup && (
        <GroupSheet
          groupId={sheetGroup.groupId}
          groupName={sheetGroup.groupName}
          now={now}
          onOpenChange={(open) => {
            if (!open) setSheetGroup(null);
          }}
          onOpenGroup={() => {
            const { groupId } = sheetGroup;
            setSheetGroup(null);
            router.push(`/groups/${groupId}`);
          }}
          onSnooze={() =>
            quieten(
              sheetGroup,
              new Date(
                Date.parse(now) + SNOOZE_HOURS * 60 * 60 * 1000,
              ).toISOString(),
            )
          }
          onMute={() => quieten(sheetGroup, null)}
        />
      )}
    </div>
  );
}

const ICON_BUTTON =
  "inline-flex size-8 items-center justify-center rounded-[11px] text-foreground/85 transition-colors hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none";

/**
 * The copy each filter shows when it has nothing to show.
 *
 * `as const` so the keys stay literal and `next-intl` can check them against
 * the catalogue; a plain `Record<…, string>` widens them and the check is lost.
 */
const EMPTY_COPY = {
  all: { title: "empty", hint: "emptyHint" },
  unread: { title: "emptyUnread", hint: "emptyUnreadHint" },
  reminders: { title: "emptyReminders", hint: "emptyRemindersHint" },
} as const satisfies Record<InboxFilter, { title: string; hint: string }>;

/** Archive rows are months old, so they are dated rather than aged. */
function ArchiveAge({ value, now }: { value: string; now: string }) {
  const t = useTranslations("notificationsPage");
  const days = Math.max(
    0,
    Math.floor((Date.parse(now) - Date.parse(value)) / 86_400_000),
  );
  return (
    <time dateTime={value} className="shrink-0 text-2xs text-muted-foreground">
      {t("ageDays", { count: days })}
    </time>
  );
}
