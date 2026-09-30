"use client";

import { RouteError } from "@/components/layout/route-error";

/**
 * A group screen that could not be drawn.
 *
 * Caught here rather than at the root so that it fails *inside* the group:
 * this boundary sits below the group layout, so the header with its group
 * switcher and the tab bar stay on screen around the message. The root
 * boundary replaced all of that with a page of its own, which left somebody
 * whose balances had failed to load with no way to the expenses tab that
 * might have worked — only a link to the list of groups.
 *
 * The tab bar is the way out, so the message offers only the way back in.
 */
export default function GroupError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError error={error} retry={retry} className="py-16" />;
}
