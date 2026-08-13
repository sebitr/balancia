import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Empty state: an explanation and a way forward, never a bare "no data".
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Icon aria-hidden="true" className="size-5" />
        </span>
      )}
      <h2 className="font-medium">{title}</h2>
      {description && (
        <p className="max-w-sm text-sm text-pretty text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
