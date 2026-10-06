"use client";

import { useId } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PUSH } from "@/components/motion/transitions";
import {
  Age,
  Avatar,
  spoken,
  useAge,
} from "@/components/notifications/inbox-rows";
import type { RecentRow } from "./recent-rows";

/**
 * "Recent in your groups": Home's right-hand column on a desktop.
 *
 * The latest few notifications, each with whoever did it, what they did, the
 * group and how long ago, and the figure at the right — then the way into the
 * whole inbox. It is the desktop board's answer to a wide Home having nothing
 * beside the groups but empty page, and it is a glance, not the inbox: no
 * unread dots, no dismissing, no muting. Opening a row goes where the inbox's
 * row goes and leaves its unread state for the inbox to settle, because the
 * reader has not been through the list.
 *
 * Only from `lg` (1024px). Below it the phone keeps its one column and its
 * bell, and the column is `hidden` — out of the accessibility tree too, so a
 * phone's screen reader meets no second list of notifications. From `lg` to
 * `xl` it wraps under the groups; from `xl` it stands beside them (see the
 * dashboard page).
 *
 * Flat on the page with hairlines between rows, as the groups beside it are.
 * The board drew it in a card, but the position widget is this screen's one
 * raised surface (see `position-widget.tsx`), and a second one beside it would
 * argue with it.
 */
export function RecentColumn({
  rows,
  now,
}: {
  rows: readonly RecentRow[];
  /** Pinned by the server render, so every age agrees with the markup. */
  now: string;
}) {
  const t = useTranslations("dashboard");
  const tPage = useTranslations("notificationsPage");
  const headingId = useId();

  return (
    <aside
      aria-labelledby={headingId}
      className="hidden min-w-0 lg:flex lg:flex-col"
    >
      <div className="flex items-center justify-between gap-3 pb-2.5">
        <h2
          id={headingId}
          className="text-sm font-medium text-muted-foreground"
        >
          {t("recentTitle")}
        </h2>
        <Link
          href="/notifications"
          transitionTypes={PUSH}
          className="tap-target shrink-0 rounded-md text-xs font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t("recentAll")}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="border-t py-3.5 text-sm text-pretty text-muted-foreground">
          {tPage("emptyHint")}
        </p>
      ) : (
        <ul>
          {rows.map((row) => (
            <RecentItem key={row.id} row={row} now={now} />
          ))}
        </ul>
      )}
    </aside>
  );
}

/**
 * One row, and the whole of it is the link.
 *
 * Named as the inbox names its rows — the sentence, the figure, the group and
 * the age, with the pauses written in — rather than left to a screen reader
 * to run together out of four spans.
 */
function RecentItem({ row, now }: { row: RecentRow; now: string }) {
  const { short } = useAge(row.createdAt, now);

  return (
    <li className="border-t">
      <Link
        href={row.url}
        transitionTypes={PUSH}
        aria-label={spoken([row.sentence, row.amount, row.groupName, short])}
        className="flex items-start gap-3 py-3 transition-colors hover:bg-wash-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
      >
        <Avatar row={row} onCard={false} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm text-pretty">{row.sentence}</span>
          <span className="truncate text-xs text-muted-foreground">
            {row.groupName}
            {" · "}
            <Age value={row.createdAt} now={now} className="text-xs" />
          </span>
        </span>
        {/* What the entry was for, as the inbox prints it: a plain figure,
            not a balance, so it takes no tone and no word. */}
        {row.amount && (
          <span className="shrink-0 text-sm font-medium tabular-nums">
            {row.amount}
          </span>
        )}
      </Link>
    </li>
  );
}
