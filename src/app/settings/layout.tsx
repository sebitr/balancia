import { Suspense, use } from "react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/security/actor";
import type { UserActor } from "@/lib/security/authorization";
import { getEnv } from "@/lib/env";
import { Screen } from "@/components/motion/screen";
import { SerwistRegister } from "@/components/pwa/serwist-register";
import { SettingsClose } from "@/components/settings/settings-close";
import { SettingsPane } from "@/components/settings/hub-link";
import { HubPaneBoundary } from "@/components/settings/hub-pane-boundary";
import {
  loadSettingsHub,
  SettingsHub,
  type SettingsHubFacts,
} from "@/components/settings/settings-hub";

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
 *
 * ## From `lg` up, two panes — and still a surface
 *
 * A desk has the room to keep the hub open beside the screen it led to, so it
 * does: the hub's rows down the left, each with its value as a phone shows it,
 * the chosen screen on the right, and the ✕ drawn once along the top of both,
 * where the hub would have drawn it. It is still a surface: no sidebar, no
 * wordmark, no bell, and the ✕ still closes back to the screen settings was
 * opened from (`SettingsClose`). Below `lg` none of it is drawn — the header
 * and the pane are `display: none`, and the hub and its screens are separate
 * pages exactly as they always were.
 *
 * The pane is the left column rather than a sticky one, and the header does
 * not stick either: at this width settings is a page that scrolls, and the
 * hub's rows are as reachable at the top of it as the ✕ is.
 *
 * The surface's name is a heading, and the screen's title stays its page's
 * `h1` as on a phone, so a screen reader meets "Settings", the rows under it,
 * then the screen. The pane is streamed rather than waited for, so it never
 * holds the screen back, and held apart from it (`HubPaneBoundary`) so a
 * summary that cannot be read never takes the screen down with it.
 *
 * Measurements are the board's — "18 · Settings" on the desktop canvas — with
 * one exception: the pane is 20rem rather than 300px. It holds the phone's own
 * rows, tile and chevron included, which were drawn for a phone's column of
 * 330px and more; at 300px the longer of them start losing their values to a
 * second line or an ellipsis, which is the opposite of what the pane is for.
 * The screen on the right fills the rest, as the board's pane does: every
 * settings screen is a column of full-width cards, and none of them was found
 * to need a narrower measure at 1024 or 1280px.
 */
export default async function SettingsLayout({
  children,
}: LayoutProps<"/settings">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const [t, tNav] = await Promise.all([
    getTranslations("userSettings"),
    getTranslations("nav"),
  ]);
  // The instance by the name its address gives it — what somebody running
  // two of them, or signed in to a friend's, needs to tell them apart.
  const instance = new URL(getEnv().appOrigin).host;

  return (
    <div data-slot="app-screen" className="min-h-dvh bg-background">
      <div className="lg:mx-auto lg:flex lg:max-w-280 lg:flex-col lg:gap-5 lg:px-6 lg:pt-9 lg:pb-12 xl:px-10">
        {/* Past the ✕ and a dozen rows to the screen, which is where a
            keyboard came to go. Only where there is a pane to get past;
            parked above the top edge as the app shell parks its own. */}
        <a
          href="#settings-content"
          className="hidden rounded-lg bg-background px-3 py-2 text-sm font-medium text-foreground shadow-lg ring-2 ring-ring outline-none motion-safe:transition-transform lg:fixed lg:top-3 lg:left-3 lg:z-50 lg:block lg:-translate-y-16 lg:focus:translate-y-0"
        >
          {tNav("skipToContent")}
        </a>

        <header className="hidden lg:flex lg:items-center lg:justify-between lg:gap-4">
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-sm text-pretty [overflow-wrap:anywhere] text-muted-foreground">
              {t("signedInTo", { instance, email: user.email })}
            </p>
          </div>
          <SettingsClose label={t("close")} />
        </header>

        <div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-8">
          <nav aria-label={t("title")} className="hidden lg:block">
            <SettingsPane>
              <HubPaneBoundary>
                <Suspense fallback={null}>
                  <HubPane user={user} hub={loadSettingsHub(user.userId)} />
                </Suspense>
              </HubPaneBoundary>
            </SettingsPane>
          </nav>

          <main id="settings-content" className="min-w-0">
            <Screen className="max-w-md px-0 py-0 lg:max-w-none">
              {children}
            </Screen>
          </main>
        </div>
      </div>
      {/* Outside the app shell, so it registers the service worker itself —
          a signed-in surface like any other, reached straight from a link in
          an email as often as from the app. */}
      <SerwistRegister />
    </div>
  );
}

/**
 * The hub's rows, drawn as the left pane once their facts arrive.
 *
 * Handed the read as a promise rather than awaiting it, so the layout returns
 * at once and the screen beside it is never held back by the pane.
 */
function HubPane({
  user,
  hub,
}: {
  user: UserActor;
  hub: Promise<SettingsHubFacts>;
}) {
  return (
    <div className="flex flex-col gap-4.5">
      <SettingsHub user={user} hub={use(hub)} />
    </div>
  );
}
