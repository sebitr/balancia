"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Plus,
  Receipt,
  Scale,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bottom navigation for a group, mobile-first.
 *
 * On small screens it is a fixed bar; from `sm` up it becomes a horizontal tab
 * strip inside the page flow. "Add" is centred and visually primary because
 * recording an expense is the action people come here to do.
 */
interface NavItem {
  readonly href: string;
  /** Key in the `nav` namespace; resolved at render time. */
  readonly labelKey: "overview" | "expenses" | "add" | "people" | "settings";
  readonly icon: LucideIcon;
  readonly exact: boolean;
  /** Rendered as a filled action button — the primary thing to do here. */
  readonly primary?: boolean;
}

const ITEMS: readonly NavItem[] = [
  { href: "", labelKey: "overview", icon: Scale, exact: true },
  { href: "/expenses", labelKey: "expenses", icon: Receipt, exact: false },
  {
    href: "/expenses/new",
    labelKey: "add",
    icon: Plus,
    exact: true,
    primary: true,
  },
  { href: "/members", labelKey: "people", icon: Users, exact: false },
  { href: "/settings", labelKey: "settings", icon: Settings, exact: false },
];

export function GroupNav({ groupId }: { groupId: string }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const base = `/groups/${groupId}`;

  return (
    <nav
      aria-label={t("groupSections")}
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/85"
    >
      <ul className="mx-auto flex w-full max-w-3xl items-stretch justify-between px-2">
        {ITEMS.map((item) => {
          const href = `${base}${item.href}`;
          const isActive = item.exact
            ? pathname === href
            : pathname.startsWith(href);

          return (
            <li key={item.labelKey} className="flex-1">
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full transition-colors",
                    item.primary
                      ? "bg-primary text-primary-foreground"
                      : isActive
                        ? "bg-accent"
                        : "bg-transparent",
                  )}
                >
                  <item.icon aria-hidden="true" className="size-4.5" />
                </span>
                {t(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
