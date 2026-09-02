import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { isProvisionalName } from "@/modules/profile/provisional-name";

/**
 * Asks for the name the signup never got.
 *
 * The code signup writes the account before its name screen, with the
 * address's local part standing in, and anyone who closed the tab there is
 * "cold-mtke" to every group they join. Shown on the dashboard until the
 * name is one somebody typed; the profile page is where that happens.
 */
export async function NameNudge({
  name,
  email,
}: {
  name: string;
  email: string;
}) {
  if (!isProvisionalName(name, email)) return null;
  const t = await getTranslations("dashboard");

  return (
    <Link
      href="/profile"
      className="flex items-center gap-3 rounded-xl border border-dashed bg-card px-4 py-3 transition-colors hover:bg-muted"
    >
      <Avatar>
        <AvatarFallback className="bg-accent text-accent-foreground">
          <UserRound aria-hidden="true" className="size-4" />
        </AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{t("nameNudgeTitle")}</span>
        <span className="text-xs text-pretty text-muted-foreground">
          {t("nameNudgeBody", { name })}
        </span>
      </span>
      <span className="shrink-0 text-xs font-medium text-primary-ink">
        {t("nameNudgeAction")}
      </span>
    </Link>
  );
}
