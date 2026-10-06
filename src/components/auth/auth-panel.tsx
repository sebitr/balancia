import Link from "next/link";
import { Server } from "lucide-react";
import { SplittingWordmark } from "@/components/brand/splitting-wordmark";
import { PanelLine } from "./panel-line";

/**
 * The plum half of the sign-in screens, from `lg` up.
 *
 * Board "19 · Sign in" of the desktop experience: a window this wide has room
 * to say which instance it is before it asks for anything, so the left half
 * carries the wordmark — the way home, which the header beside it gives up at
 * this width — and, at its foot, the instance's own name. A self-hosted
 * reader may run more than one, and the address bar is the only other place
 * that says which this is.
 *
 * Only the name. No version, no database, no health line: before sign-in
 * those tell a stranger what to attack.
 *
 * Plum in both themes. In the light theme that is the foreground drawn as a
 * ground, with the background as ink; in the dark one the page is already
 * plum, so the panel is the raised card a shade off it. Not a nested `.dark`:
 * that block restates `--primary`, and would paint the wordmark's dot in the
 * default accent over the reader's own. Hidden below `lg`, where the header
 * keeps the wordmark and nothing else changes.
 */
export function AuthPanel({ host }: { host: string }) {
  return (
    <div className="hidden bg-foreground text-background lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-1/2 lg:shrink-0 lg:flex-col lg:justify-between lg:gap-10 lg:px-14 lg:py-10 dark:bg-card dark:text-foreground">
      <Link
        href="/"
        className="inline-flex self-start rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-foreground focus-visible:outline-none dark:focus-visible:ring-offset-card"
      >
        <SplittingWordmark />
      </Link>

      <PanelLine />

      <p className="flex items-center gap-2 text-xs text-background/75 dark:text-muted-foreground">
        <Server aria-hidden="true" className="size-3.5 shrink-0" />
        {host}
      </p>
    </div>
  );
}
