import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/security/actor";
import { Screen } from "@/components/motion/screen";

/**
 * Settings is a surface, not a page inside the app shell.
 *
 * The hub and its nine screens replace everything that used to live in the
 * avatar dropdown and under `/profile`, and they replace the chrome as well:
 * no wordmark, no bell, no avatar in a corner. A screen whose whole job is to
 * be closed does not need a header offering to take you somewhere else — it
 * needs one control that says ✕, which the hub draws itself.
 *
 * Which is why this sits outside `(app)` and repeats its authentication rather
 * than inheriting it. Guests have no account and nothing here to configure, so
 * the sign-in redirect is the same one every other signed-in surface makes.
 *
 * `Screen` still wraps the column, so pushing from the hub into a screen and
 * coming back animate exactly as they do everywhere else in the app — the
 * padding is the only thing settings does differently, and it is passed rather
 * than assumed.
 */
export default async function SettingsLayout({
  children,
}: LayoutProps<"/settings">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  return (
    <main data-slot="app-screen" className="min-h-dvh bg-background">
      <Screen className="max-w-md px-0 py-0">{children}</Screen>
    </main>
  );
}
