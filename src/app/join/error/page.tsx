import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LinkSlash } from "@/components/icons/link-slash";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("joinError");
  return { title: t("metaTitle") };
}

/** Query values map onto catalogue keys; anything else falls back to invalid. */
const REASON_KEYS = {
  invalid: "invalid",
  "rate-limited": "rateLimited",
  unavailable: "unavailable",
} as const;

type ReasonKey = (typeof REASON_KEYS)[keyof typeof REASON_KEYS];

export default async function JoinErrorPage({
  searchParams,
}: PageProps<"/join/error">) {
  const params = await searchParams;
  const reasonParam = params.reason;
  const reason =
    typeof reasonParam === "string" && reasonParam in REASON_KEYS
      ? REASON_KEYS[reasonParam as keyof typeof REASON_KEYS]
      : ("invalid" satisfies ReasonKey);

  const t = await getTranslations("joinError");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto w-full max-w-5xl px-4 py-4">
          <Wordmark />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="max-w-md space-y-4 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <LinkSlash className="size-6" />
          </span>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {t(`reasons.${reason}.title`)}
          </h1>
          <p className="text-pretty text-muted-foreground">
            {t(`reasons.${reason}.body`)}
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <Button asChild variant="outline">
              <Link href="/">{t("home")}</Link>
            </Button>
            <Button asChild>
              <Link href="/sign-in">{t("signIn")}</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
