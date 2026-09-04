import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PUSH } from "@/components/motion/transitions";
import { initialOf } from "@/components/entries/initials";
import { AccountAvatar } from "./account-avatar";

/**
 * Who you are, at the top of the hub.
 *
 * A card rather than a row because it is not one of a set — the groups below
 * are lists of destinations, and this is the account they all belong to. It is
 * also the only row on the hub whose summary is the reader's own address,
 * which is the fastest way to answer "am I signed in as the right person" on a
 * phone somebody else has also used.
 */
export function IdentityCard({
  name,
  email,
  photoVersion,
}: {
  name: string;
  email: string;
  /** When the photo last changed; null for an account showing its initial. */
  photoVersion: Date | null;
}) {
  return (
    <Link
      href="/settings/account"
      transitionTypes={PUSH}
      className="flex shrink-0 items-center gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-colors hover:bg-wash-1 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <AccountAvatar
        initial={initialOf(name)}
        version={photoVersion}
        className="size-11.5"
        letterClassName="text-base"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold tracking-tight">
          {name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {email}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4.5 shrink-0 text-muted-foreground"
      />
    </Link>
  );
}
