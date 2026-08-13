import { Unlink } from "lucide-react";

/** Broken-link glyph, aliased so call sites read as intent, not icon name. */
export function LinkSlash({ className }: { className?: string }) {
  return <Unlink aria-hidden="true" className={className} />;
}
