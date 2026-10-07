"use client";

import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PUSH } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";

/**
 * A link on the settings hub, which is two things depending on the width.
 *
 * On a phone the hub is a screen of its own, and each row pushes the screen it
 * names over it — the motion every other row in the app makes into what it
 * leads to.
 *
 * From `lg` up the hub stands beside its screens instead, as the left pane of
 * the settings surface (`src/app/settings/layout.tsx`), and a row is a place in
 * that pane rather than a way forward: pressing one swaps the screen on the
 * right, the way a tab does, so it carries no motion — a peer does not arrive
 * from anywhere. And one row is the screen on the right, so it says so, with
 * `aria-current` and a wash.
 *
 * The pane is told apart by `SettingsPane` above it rather than by a prop on
 * every row: the rows are drawn by the hub, by `AppearanceSummary` and by the
 * identity card, and the hub is drawn twice on `/settings` — once as the
 * phone's screen and once as the desk's pane, each hidden at the other's
 * widths. Only the pane's copy may light a row; on the phone the hub is the
 * page itself, and none of its rows is the page.
 */

const PaneContext = createContext(false);

/** Marks what it wraps as the desk's left pane. */
export function SettingsPane({ children }: { children: ReactNode }) {
  return <PaneContext.Provider value={true}>{children}</PaneContext.Provider>;
}

/**
 * The screen the right pane shows at `/settings` itself, from `lg` up.
 *
 * The first row on the hub, which is the account the rest belong to. The hub
 * page renders this screen beside the pane, so the two have to name the same
 * one: `src/app/settings/page.tsx` imports it.
 */
const FIRST_SCREEN = "/settings/account";

export function HubLink({
  href,
  className,
  currentClassName,
  children,
}: {
  href: string;
  className?: string;
  /** Added when this row is the screen beside the pane. */
  currentClassName?: string;
  children: ReactNode;
}) {
  const pane = useContext(PaneContext);
  const pathname = usePathname();

  const shown = pathname === "/settings" ? FIRST_SCREEN : pathname;
  const current =
    pane && shown !== null && (shown === href || shown.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      transitionTypes={pane ? undefined : PUSH}
      aria-current={current ? "page" : undefined}
      className={cn(className, current && currentClassName)}
    >
      {children}
    </Link>
  );
}
