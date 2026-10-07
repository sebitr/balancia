"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AddControlContent, addControlClass } from "./app-sidebar";
import { useOfflineAddFallback } from "./group-nav";
import { SidebarTip, useSidebar } from "./sidebar-context";

/**
 * The sidebar's Add inside a group: the bar's own link, into the entry drawer
 * over the screen, with the same way round a dropped network.
 *
 * Handed to the shell by the group layout rather than drawn by the sidebar
 * itself, because the offline fallback reaches for the group's local drawer —
 * the entry form and everything under it — and the sidebar is on Home too,
 * which should not carry the group's form, or its strings, to get a button.
 */
export function SidebarGroupAdd({ groupId }: { groupId: string }) {
  const t = useTranslations("dashboard");
  const { collapsed } = useSidebar();
  const offlineAdd = useOfflineAddFallback();
  const label = t("addExpense");

  return (
    <SidebarTip content={label}>
      <Link
        href={`/groups/${groupId}/expenses/new`}
        // No direction: what arrives is the entry drawer, over the screen,
        // and the screen underneath stays where it is.
        onClick={offlineAdd}
        // N presses this inside a group, so the key takes the same way into
        // the drawer, offline fallback and all; see `use-shortcuts.ts`.
        data-shortcut="n"
        className={addControlClass(collapsed)}
      >
        <AddControlContent label={label} />
      </Link>
    </SidebarTip>
  );
}
