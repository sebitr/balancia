import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { hasProvisionalName } from "@/modules/auth/service";

/**
 * Asks for the name the signup never got.
 *
 * The code and passkey signups write the account before their name screen,
 * with the address's local part standing in, and anyone who closed the tab
 * there is "cold-mtke" to every group they join. Shown until somebody has
 * chosen a name; the profile page is where that happens.
 *
 * Which accounts those are is a stamp on the row rather than a look at the
 * name — `users.name_chosen_at`. Comparing the name with the address's local
 * part, as this used to, cannot tell a placeholder from a reader called Seb
 * whose address is seb@, and it showed that reader this card on every load
 * with nothing they could do to stop it.
 */
export async function NameNudge({
  userId,
  name,
}: {
  userId: string;
  /** Shown back to them: the placeholder is the whole of the complaint. */
  name: string;
}) {
  if (!(await hasProvisionalName(userId))) return null;
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
