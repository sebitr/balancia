import type { ReactNode } from "react";
import { Check, CircleAlert, CircleMinus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A setting's state on the Administration cards: an icon and a word.
 *
 * "Ready" is a check, "Off" is a circle with a bar, and "needs something from
 * the administrator" is a circle with a mark — three shapes, so the rows read
 * the same to someone who cannot tell the inks apart. None of them is the
 * destructive ink: an administrator who has not registered a Google app has not
 * broken anything, and the colour that means "this went wrong" is not spent on
 * "this has not been set up".
 */

const MARKS = {
  ready: { Icon: Check, ink: "text-foreground" },
  attention: { Icon: CircleAlert, ink: "text-foreground" },
  off: { Icon: CircleMinus, ink: "text-muted-foreground" },
} as const;

export function AdminState({
  kind,
  children,
}: {
  kind: keyof typeof MARKS;
  children: ReactNode;
}) {
  const { Icon, ink } = MARKS[kind];
  return (
    <span
      data-slot="admin-state"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs font-medium",
        ink,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2} />
      {children}
    </span>
  );
}
