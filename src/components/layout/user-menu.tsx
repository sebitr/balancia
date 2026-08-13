"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LogOut, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageMenuItems } from "@/components/i18n/language-switcher";
import { InstallMenuItem } from "@/components/pwa/install-menu-item";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/modules/auth/actions";

function initialsOf(label: string): string {
  const parts = label.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function UserMenu({
  label,
  email,
  isGuest,
}: {
  label: string;
  email?: string;
  isGuest: boolean;
}) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");

  if (isGuest) {
    return (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
          {initialsOf(label)}
        </span>
        <span className="hidden sm:inline">
          {label} · {tCommon("guest")}
        </span>
      </span>
    );
  }

  const onSignOut = async () => {
    // The action revokes the session, clears the cookie and redirects.
    await signOutAction();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          aria-label={t("accountMenu")}
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
            {initialsOf(label)}
          </span>
          <span className="hidden max-w-32 truncate sm:inline">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block font-medium">{label}</span>
          {email && (
            <span className="block truncate text-xs text-muted-foreground">
              {email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <User aria-hidden="true" />
            {t("profile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/profile/security">
            <ShieldCheck aria-hidden="true" />
            {t("security")}
          </Link>
        </DropdownMenuItem>
        {/* Renders nothing where the app is installed or uninstallable. */}
        <InstallMenuItem />
        <DropdownMenuSeparator />
        <LanguageMenuItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void onSignOut()}>
          <LogOut aria-hidden="true" />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
