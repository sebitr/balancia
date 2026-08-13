import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  KeyRound,
  Languages,
  Receipt,
  RefreshCw,
  Scale,
  ServerCog,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { getCurrentUser } from "@/lib/security/actor";
import { getEnv } from "@/lib/env";

/**
 * Instance welcome page.
 *
 * Describes what this instance is and links into the app. Claims are limited
 * to what Balancia actually does — no invented statistics, no sample charts.
 */

/** Icons pair with catalogue keys, so wording is translated but order is not. */
const FEATURES = [
  { id: "splits", icon: Scale },
  { id: "payers", icon: Users },
  { id: "currency", icon: Languages },
  { id: "passkeys", icon: KeyRound },
  { id: "receipts", icon: Receipt },
  { id: "recurring", icon: RefreshCw },
] as const;

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/dashboard");
  }
  const env = getEnv();
  const t = await getTranslations("landing");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <Wordmark />
          <nav className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">{t("signIn")}</Link>
            </Button>
            {env.ALLOW_REGISTRATION && (
              <Button asChild size="sm">
                <Link href="/register">{t("createAccount")}</Link>
              </Button>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-primary">{t("eyebrow")}</p>
            <h1 className="mt-3 font-heading text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              {t("title")}
            </h1>
            <p className="mt-5 text-lg text-pretty text-muted-foreground">
              {t("lead")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {env.ALLOW_REGISTRATION ? (
                <Button asChild size="lg">
                  <Link href="/register">
                    {t("getStarted")}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              ) : (
                <Button asChild size="lg">
                  <Link href="/sign-in">
                    {t("signIn")}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              )}
              <Button asChild size="lg" variant="outline">
                <Link href="/sign-in">{t("haveAccount")}</Link>
              </Button>
            </div>
            {!env.ALLOW_REGISTRATION && (
              <p className="mt-4 text-sm text-muted-foreground">
                {t("registrationClosed")}
              </p>
            )}
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto w-full max-w-5xl px-4 py-16">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              {t("whatItDoes")}
            </h2>
            <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <li key={feature.id} className="flex flex-col gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <feature.icon aria-hidden="true" className="size-5" />
                  </span>
                  <h3 className="font-medium">
                    {t(`features.${feature.id}.title`)}
                  </h3>
                  <p className="text-sm text-pretty text-muted-foreground">
                    {t(`features.${feature.id}.body`)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-16">
            <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <ServerCog aria-hidden="true" className="size-5" />
            </span>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              {t("selfHostTitle")}
            </h2>
            <p className="max-w-2xl text-pretty text-muted-foreground">
              {t("selfHostBody")}
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{t("footerTagline")}</p>
          <p>{t("footerLicence")}</p>
        </div>
      </footer>
    </div>
  );
}
