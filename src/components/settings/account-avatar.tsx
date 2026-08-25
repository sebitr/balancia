import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * The account's face: its photo, or the letter that stands in for one.
 *
 * The letter is not a placeholder waiting to be replaced — it is what most
 * accounts show, and what every participant who is not a user shows
 * everywhere else in the app, so it is drawn as a deliberate thing rather than
 * as an empty state. `AvatarFallback` also covers the case where the photo
 * exists but the request for it fails, which on a phone that has just lost
 * signal is the difference between a letter and a broken-image glyph.
 *
 * `version` is the photo's timestamp on the query string. The delivery route
 * answers `must-revalidate`, but a replaced photo is a *different* resource as
 * far as the reader is concerned, and changing the URL is what stops a stale
 * one being painted for a frame before the revalidation lands.
 */
export function AccountAvatar({
  initial,
  version,
  className,
  letterClassName,
  alt = "",
}: {
  initial: string;
  version: Date | null;
  /** Sizes the circle. */
  className?: string;
  /** Sizes the letter — `AvatarFallback` states its own, so it needs telling. */
  letterClassName?: string;
  alt?: string;
}) {
  return (
    <Avatar className={cn("size-8", className)}>
      {version && (
        <AvatarImage
          src={`/api/profile/avatar?v=${version.getTime().toString(36)}`}
          alt={alt}
        />
      )}
      <AvatarFallback
        className={cn(
          "bg-secondary font-semibold text-secondary-foreground",
          letterClassName,
        )}
      >
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}
