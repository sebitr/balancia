import Link from "next/link";
import { SplittingWordmark } from "@/components/brand/splitting-wordmark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { UmamiScript } from "@/components/analytics/umami-script";
import { AuthPanel } from "@/components/auth/auth-panel";
import { AreaMessages } from "@/i18n/area-messages";
import { getEnv } from "@/lib/env";

/**
 * The surface every signed-out screen stands on.
 *
 * A phone, and anything below `lg`, gets the header with the wordmark and the
 * theme, and the form centred under it. From `lg` (1024px) the window splits
 * in two, as the desktop board "19 · Sign in" draws it: the plum panel on the
 * left with the wordmark and the instance's name (`AuthPanel`), and the same
 * form on the right with only the theme above it. Every class that makes the
 * split is `lg:`; the form itself is not told which width it is in.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  // The instance names itself by the address it is served from — the one
  // fact here a reader can check against the address bar.
  const host = new URL(getEnv().APP_URL).host;

  const page = (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Covers /sign-in, the two password-recovery screens, and
          /register/password and /register/done. Two of those carry a group
          identifier in the query string, which is why the tracker is mounted
          with `data-exclude-search`; see the component. */}
      <UmamiScript />
      <AuthPanel host={host} />
      <div className="flex flex-1 flex-col">
        <header className="border-b lg:border-b-0">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4 lg:justify-end lg:px-8 lg:py-6">
            {/* The panel carries the wordmark from `lg`, so this one stands
                down there rather than naming the way home twice. */}
            <Link
              href="/"
              className="inline-flex rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none lg:hidden"
            >
              <SplittingWordmark />
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center px-4 py-10 lg:px-8 lg:pt-4 lg:pb-16">
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
    </div>
  );

  // The sign-in form's server errors and the password screens' copy, which
  // no other page asks for.
  return <AreaMessages area="auth">{page}</AreaMessages>;
}
