import { cn } from "@/lib/utils";

/**
 * Somebody's initials in an avatar, drawn by the stylesheet rather than
 * written into the page.
 *
 * An avatar sits inside controls that are named for what they do — "Paid by
 * you", "Include Blaise in the split", "Ada Lovelace, Settings" — and a name
 * like that has to contain the words the control shows, so that somebody
 * driving the page by voice can say what they see (WCAG 2.5.3, Label in
 * Name). Text in the page counts as shown even under `aria-hidden`, which only
 * speaks to a screen reader: "A" beside "You" read as a word the name did not
 * have, and axe failed every such control on it. The initials are a picture of
 * a person, not a label, so they are drawn as one — `content` from a data
 * attribute — and the label the control shows is only its words.
 *
 * Drawn text looks exactly like written text, in the same font and ink. What
 * it gives up is being matched by text in a unit test, which asserts on
 * `data-initials` instead.
 */
export function DrawnInitials({
  initials,
  className,
}: {
  initials: string;
  className?: string;
}) {
  return (
    <span
      data-initials={initials}
      className={cn("before:content-[attr(data-initials)]", className)}
    />
  );
}
