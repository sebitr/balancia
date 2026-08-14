import { useTranslations } from "next-intl";
import { APPLE_START_PATH } from "@/modules/auth/apple-paths";
import { cn } from "@/lib/utils";

/**
 * The "Sign in with Apple" button.
 *
 * A plain anchor rather than `next/link`, on purpose: the href is a route
 * handler that mints a state cookie and redirects to Apple, and Link would
 * happily prefetch it — starting a ceremony nobody asked for and replacing the
 * cookie of one that was already in progress.
 *
 * It also does not use the app's `Button`. Apple's guidelines are specific
 * about how this control looks — black on light, white on dark, their glyph,
 * and one of their three wordings — and a button that borrows the app's
 * primary colours would be the wrong shape of wrong. The metrics are matched
 * to the buttons above it so the column still reads as one stack.
 */

function AppleLogo() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 814 1000"
      className="size-3.5 fill-current"
    >
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  );
}

export function AppleSignInButton({
  /** Apple allows "Sign in", "Sign up" or "Continue"; use the honest one. */
  intent = "signIn",
  className,
}: {
  intent?: "signIn" | "signUp" | "continue";
  className?: string;
}) {
  const t = useTranslations("auth.apple");

  return (
    <a
      href={APPLE_START_PATH}
      className={cn(
        "inline-flex h-8 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg",
        "bg-black text-sm font-medium whitespace-nowrap text-white transition-all",
        "hover:bg-black/85 active:translate-y-px",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        "dark:bg-white dark:text-black dark:hover:bg-white/85",
        className,
      )}
    >
      <AppleLogo />
      {t(intent)}
    </a>
  );
}
