import Link from "next/link";
import { redirect } from "next/navigation";
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
export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/dashboard");
  }
  const env = getEnv();

  const features = [
    {
      icon: Scale,
      title: "Splits that always add up",
      body: "Equal, exact, percentage or share-based. Amounts are whole minor units, so allocations sum to the total exactly — every time.",
    },
    {
      icon: Users,
      title: "Several payers, no workarounds",
      body: "When two people cover one bill, record it once. Balances follow who actually paid what.",
    },
    {
      icon: Languages,
      title: "Multi-currency, two ways",
      body: "Keep each currency balanced separately, or convert everything into one base currency at a rate frozen when you record it.",
    },
    {
      icon: KeyRound,
      title: "Passkeys and guest links",
      body: "Sign in with a passkey or a password. Invite people who do not want an account through a revocable link.",
    },
    {
      icon: Receipt,
      title: "Receipts kept private",
      body: "Attach photos or PDFs. They live in your own storage, behind authorization — never in a public folder.",
    },
    {
      icon: RefreshCw,
      title: "Recurring expenses",
      body: "Rent, subscriptions, the shared internet bill. Generated on schedule in your group's own timezone.",
    },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <Wordmark />
          <nav className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            {env.ALLOW_REGISTRATION && (
              <Button asChild size="sm">
                <Link href="/register">Create account</Link>
              </Button>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-primary">
              Self-hosted shared expenses
            </p>
            <h1 className="mt-3 font-heading text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Shared expenses. Fairly balanced.
            </h1>
            <p className="mt-5 text-lg text-pretty text-muted-foreground">
              Balancia tracks what a group spends and works out who owes whom —
              on a server you control, with no third party in the middle of your
              money.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {env.ALLOW_REGISTRATION ? (
                <Button asChild size="lg">
                  <Link href="/register">
                    Get started
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              ) : (
                <Button asChild size="lg">
                  <Link href="/sign-in">
                    Sign in
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              )}
              <Button asChild size="lg" variant="outline">
                <Link href="/sign-in">I have an account</Link>
              </Button>
            </div>
            {!env.ALLOW_REGISTRATION && (
              <p className="mt-4 text-sm text-muted-foreground">
                Registration is closed on this instance. Ask the administrator
                for an account, or use a guest invitation link if you have one.
              </p>
            )}
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto w-full max-w-5xl px-4 py-16">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              What it does
            </h2>
            <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <li key={feature.title} className="flex flex-col gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <feature.icon aria-hidden="true" className="size-5" />
                  </span>
                  <h3 className="font-medium">{feature.title}</h3>
                  <p className="text-sm text-pretty text-muted-foreground">
                    {feature.body}
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
              Your instance, your data
            </h2>
            <p className="max-w-2xl text-pretty text-muted-foreground">
              Balancia is free software under the AGPL-3.0-or-later licence. It
              runs from one Docker Compose file with PostgreSQL and a background
              worker, sends nothing to third-party services, and includes no
              analytics or telemetry.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Balancia — shared expenses, fairly balanced.</p>
          <p>AGPL-3.0-or-later. Modified network versions must offer source.</p>
        </div>
      </footer>
    </div>
  );
}
