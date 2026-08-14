import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The shape of a screen before its data arrives.
 *
 * This exists to be a `loading.tsx`, and a `loading.tsx` exists for more than
 * politeness. Every page in this app reads a cookie to find out who is asking,
 * which makes all of them dynamic, and Next does not prefetch a dynamic route
 * unless it has a loading boundary to prefetch *up to*. Without one, no part
 * of a screen can be fetched before the tap, so the navigation waits on a
 * server round trip and the transition cannot begin until it lands — the app
 * feels like a website however good the animation is.
 *
 * With a boundary, the shell and this placeholder are already in the browser
 * when the tap happens, so the screen slides in immediately and fills itself
 * in behind the animation.
 *
 * Deliberately generic. A per-screen skeleton that mirrored each layout would
 * read better for the fraction of a second it is visible, and would be one
 * more thing to keep in step with every page it imitates.
 */
export async function ScreenSkeleton({
  /** Roughly how many blocks the screen it stands in for is made of. */
  rows = 3,
}: {
  rows?: number;
}) {
  const t = await getTranslations("common");

  return (
    <div role="status" aria-label={t("loading")} className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>

      <div className="space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
